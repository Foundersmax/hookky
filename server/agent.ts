import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Response } from "express";
import type { AgentEvent } from "../src/types";
import { TEMPLATES, TRANSITIONS, BACKGROUNDS, MOTIONS, PACES } from "../src/types";
import { STYLE_PRESETS } from "../src/presets";
import { searchVisuals, searchVideos, importFromUrl, type Orientation } from "./connectors";
import { directorPrompt } from "../src/agent/prompt";
import { lintStoryboard, notesForAgent } from "../src/agent/lint";
import { buildScenes, patchScenes, brandWithStyle, type Timing } from "../src/storyboard";
import { sanitizeScene, sanitizeBrand, sanitizeDirections } from "../src/sanitize";
import { presetById } from "../src/presets";
import type { Brand, Scene } from "../src/types";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
let webSearchEnabled = (process.env.CLAUDE_WEB_SEARCH || "on").toLowerCase() !== "off";

export function claudeConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || process.env.CLAUDE_ENABLED);
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

const SYSTEM = directorPrompt("server");

// ---------------------------------------------------------------- tools
const sceneSchema = {
  type: "object",
  properties: {
    template: { type: "string", enum: [...TEMPLATES] },
    duration: { type: "number", description: "seconds, 1.2–8" },
    kicker: { type: "string" },
    headline: { type: "string", description: "Use *word* for accent emphasis" },
    subline: { type: "string" },
    items: { type: "array", items: { type: "string" } },
    stat: {
      type: "object",
      properties: { value: { type: "number" }, prefix: { type: "string" }, suffix: { type: "string" }, decimals: { type: "integer" }, label: { type: "string" } },
      required: ["value"],
    },
    image: { type: "string", description: "asset id like asset:up_1" },
    images: { type: "array", items: { type: "string" } },
    cta: { type: "string" },
    url: { type: "string" },
    author: { type: "string" },
    background: { type: "string", enum: [...BACKGROUNDS] },
    align: { type: "string", enum: ["left", "center"] },
    transition: { type: "string", enum: [...TRANSITIONS], description: "transition INTO this scene" },
    motion: { type: "string", enum: [...MOTIONS] },
    accent: { type: "string", description: "hex override" },
    clipStart: { type: "number", description: "video clips only: seconds into the clip where the scene starts" },
    clipSpeed: { type: "number", description: "video clips only: 0.25–2, e.g. 0.5 for slow motion" },
    notes: { type: "string", description: "director's note, not rendered" },
  },
  required: ["template", "duration"],
} as const;

const tools: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "propose_directions",
    description: "Pitch 3 distinct creative directions for a new brief as cards the user picks from. Use before create_storyboard when starting a new ad, unless the user already fixed the look or asked you to just build. After calling it, stop and wait for the pick.",
    input_schema: {
      type: "object",
      properties: {
        directions: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "2–3 words" },
              pitch: { type: "string", description: "one sentence: the idea, the feel, why it fits" },
              style: { type: "string", enum: STYLE_PRESETS.map((p) => p.id) },
              motion: { type: "string", enum: [...MOTIONS] },
              pace: { type: "string", enum: [...PACES] },
              hook: { type: "string", description: "opening headline, ≤ 6 words, *word* = accent" },
              accent: { type: "string", description: "optional hex accent override" },
            },
            required: ["name", "pitch", "style", "motion", "pace", "hook"],
          },
        },
      },
      required: ["directions"],
    },
  },
  {
    name: "create_storyboard",
    description: "Replace the whole animation with a new storyboard. Use for first drafts or full re-concepts.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        aspect: { type: "string", enum: ["16:9", "9:16", "1:1", "4:5"] },
        style: { type: "string", enum: STYLE_PRESETS.map((p) => p.id) },
        fit_to_voiceover: { type: "boolean" },
        scenes: { type: "array", items: sceneSchema, minItems: 1 },
      },
      required: ["scenes"],
    },
  },
  {
    name: "update_scenes",
    description: "Apply targeted edits to existing scenes by 0-based index. ops run in order.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["update", "insert", "delete", "move"] },
              index: { type: "integer" },
              to: { type: "integer" },
              scene: { type: "object", description: "For update: only the fields to change. For insert: full scene (template, duration…)." },
            },
            required: ["op", "index"],
          },
        },
      },
      required: ["ops"],
    },
  },
  {
    name: "set_brand",
    description: "Set the visual identity: a saved brand kit, a style preset, and/or explicit colours and fonts (applied in that order).",
    input_schema: {
      type: "object",
      properties: {
        kit: { type: "string", description: "name of one of the user's brand_kits: applies its whole look" },
        style: { type: "string", enum: STYLE_PRESETS.map((p) => p.id) },
        name: { type: "string" },
        bg: { type: "string" },
        fg: { type: "string" },
        accent: { type: "string" },
        muted: { type: "string" },
        fontDisplay: { type: "string", enum: ["Inter", "Inter Tight", "Space Grotesk", "Instrument Serif", "Syne", "DM Sans", "JetBrains Mono", "Fraunces", "Manrope"] },
        fontBody: { type: "string", enum: ["Inter", "DM Sans", "JetBrains Mono", "Manrope"] },
        logo: { type: "string", description: "asset id of the logo" },
        aspect: { type: "string", enum: ["16:9", "9:16", "1:1", "4:5"] },
        captions: { type: "boolean", description: "burn-in captions from the voice-over" },
      },
    },
  },
  {
    name: "search_visuals",
    description: "Search image sources for references/banners/product shots. Results are added to the user's library and returned with asset ids.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sources: { type: "array", items: { type: "string", enum: ["pinterest", "freepik", "envato", "unsplash", "pexels", "openverse"] }, description: "omit for all configured" },
        count: { type: "integer", minimum: 3, maximum: 24 },
      },
      required: ["query"],
    },
  },
  {
    name: "search_videos",
    description: "Search stock video (Pexels, Pixabay) for motion b-roll: textures, lifestyle, product-in-use, macro shots. Clips are added to the library and returned with asset ids, sizes and lengths. Use a clip id anywhere an image id goes (fullbleed, split-feature, product-hero, device-mockup, image-mosaic, before-after, or background: \"image\"); it plays from the start of its scene and loops if shorter.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "concrete and filmable: \"slow pour of cold brew over ice, macro\", not \"coffee\"" },
        orientation: { type: "string", enum: ["landscape", "portrait", "square"], description: "match the project's format" },
        count: { type: "integer", minimum: 3, maximum: 12 },
      },
      required: ["query"],
    },
  },
  {
    name: "import_url",
    description: "Pull images from any web page or image URL (Pinterest pin, Behance, Dribbble, product page) into the library.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
];

const ZScene = z.object({ template: z.enum(TEMPLATES), duration: z.number() }).passthrough();
const ZStoryboard = z.object({ scenes: z.array(ZScene).min(1) }).passthrough();
const ZPatch = z.object({ ops: z.array(z.object({ op: z.enum(["update", "insert", "delete", "move"]), index: z.number() }).passthrough()) });

// ---------------------------------------------------------------- conversations (append-only, server-held)
type Msg = Anthropic.Beta.BetaMessageParam;
const conversations = new Map<string, Msg[]>();

export interface TurnInput {
  conversationId: string;
  text: string;
  state: unknown;
  images?: { assetId: string; mediaType: string; data: string }[];
  /** Contact sheets of rendered frames, for a visual review. */
  frames?: { mediaType: string; data: string }[];
}

const FRAME_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_FRAME_B64 = 6_000_000;

/** The user turn sent to Claude: references, rendered frames, studio state, then the message. */
export function turnContent(input: TurnInput): Anthropic.Beta.BetaContentBlockParam[] {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of input.images ?? []) {
    content.push({ type: "text", text: `Uploaded reference → ${img.assetId}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType as "image/png", data: img.data } });
  }
  const frames = (Array.isArray(input.frames) ? input.frames : []).filter((f) => f && FRAME_TYPES.has(f.mediaType) && typeof f.data === "string" && f.data.length > 0 && f.data.length <= MAX_FRAME_B64).slice(0, 3);
  frames.forEach((f, i) => {
    content.push({ type: "text", text: `Rendered frames, contact sheet ${i + 1} of ${frames.length}` });
    content.push({ type: "image", source: { type: "base64", media_type: f.mediaType as "image/jpeg", data: f.data } });
  });
  content.push({ type: "text", text: `<studio_state>\n${JSON.stringify(input.state)}\n</studio_state>` });
  content.push({ type: "text", text: input.text || "(no message)" });
  return content;
}

export async function runAgentTurn(input: TurnInput, res: Response) {
  const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const history = conversations.get(input.conversationId) ?? [];
  conversations.set(input.conversationId, history);

  history.push({ role: "user", content: turnContent(input) });
  const shadow = new Shadow(input.state);

  let closed = false;
  res.on("close", () => (closed = true));

  for (let step = 0; step < 10 && !closed; step++) {
    const message = await streamOnce(history, send);
    if (!message) return;
    history.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (message.stop_reason === "refusal") {
      send({ type: "error", message: "The model declined this request. Try rephrasing the brief." });
      return;
    }
    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) return;

    const truncated = message.stop_reason === "max_tokens";
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        if (truncated) return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Output was truncated before this call finished. Retry with a more compact call." };
        try {
          return { type: "tool_result", tool_use_id: tu.id, content: await runTool(tu.name, tu.input, send, shadow) };
        } catch (e: any) {
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: String(e?.message ?? e) };
        }
      }),
    );
    history.push({ role: "user", content: results });
  }
}

async function streamOnce(history: Msg[], send: (e: AgentEvent) => void): Promise<Anthropic.Beta.BetaMessage | null> {
  const allTools: Anthropic.Beta.BetaToolUnion[] = webSearchEnabled
    ? [...tools, { type: "web_search_20260209", name: "web_search", max_uses: 3 } as Anthropic.Beta.BetaToolUnion]
    : tools;
  try {
    const stream = getClient().beta.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: allTools,
      messages: history,
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      // Server-side refusal fallback, routed by category.
      ...({ fallbacks: "default" } as object),
    });
    stream.on("text", (delta) => send({ type: "text", delta }));
    stream.on("thinking", (delta) => send({ type: "thinking", delta }));
    stream.on("streamEvent", (ev) => {
      if (ev.type === "content_block_start") {
        const b = ev.content_block;
        if (b.type === "tool_use") send({ type: "activity", label: toolLabel(b.name) });
        if (b.type === "server_tool_use") send({ type: "activity", label: "Searching the web" });
      }
    });
    return await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError && webSearchEnabled && /web_search/i.test(e.message)) {
      webSearchEnabled = false; // org has web search disabled — continue without it
      return streamOnce(history, send);
    }
    const authProblem = e instanceof Anthropic.AuthenticationError || /authentication method|api[_ ]?key/i.test(String((e as Error)?.message));
    if (authProblem) send({ type: "error", message: "Claude credentials are missing or invalid — using the local director. Add ANTHROPIC_API_KEY to .env." });
    else if (e instanceof Anthropic.RateLimitError) send({ type: "error", message: "Rate limited by the API — try again in a moment." });
    else if (e instanceof Anthropic.APIError) send({ type: "error", message: `API error ${e.status ?? ""}: ${e.message}` });
    else send({ type: "error", message: String((e as Error)?.message ?? e) });
    return null;
  }
}

function toolLabel(name: string) {
  return (
    { propose_directions: "Sketching directions", create_storyboard: "Composing storyboard", update_scenes: "Editing scenes", set_brand: "Setting brand", search_visuals: "Searching visual sources", search_videos: "Searching stock video", import_url: "Importing from URL" } as Record<string, string>
  )[name] ?? name;
}

/**
 * The server's copy of the storyboard for this turn. The browser applies the real edits; the
 * server applies the same edits here so it can review the result and hand Claude its notes.
 */
class Shadow {
  scenes: Scene[];
  brand: Brand;
  style: string;
  assetIds: Set<string>;
  audio?: Timing & { hasWords: boolean };
  kits: { name: string; style: string; brand: Partial<Brand> }[];

  constructor(state: any) {
    const st = state && typeof state === "object" ? state : {};
    this.scenes = (Array.isArray(st.scenes) ? st.scenes : []).map((x: unknown) => sanitizeScene(x));
    this.style = typeof st.project?.style === "string" ? st.project.style : "noir";
    const preset = presetById(this.style);
    this.brand = { name: "", ...preset.brand, ...sanitizeBrand(st.project?.brand) } as Brand;
    this.assetIds = new Set((Array.isArray(st.assets) ? st.assets : []).map((a: any) => String(a?.id)));
    this.kits = (Array.isArray(st.brand_kits) ? st.brand_kits : [])
      .filter((k: any) => k && typeof k.name === "string")
      .map((k: any) => ({ name: String(k.name), style: presetById(String(k.style ?? "")).id, brand: sanitizeBrand(k.brand) }));
    const vo = st.voiceover;
    if (vo && typeof vo.duration === "number") {
      const pauses = (Array.isArray(vo.pauses) ? vo.pauses : []).filter((x: any) => Array.isArray(x)).map(([s, e]: number[]) => ({ s: Number(s), e: Number(e) }));
      this.audio = { duration: vo.duration, pauses, hasWords: Array.isArray(vo.sentences) && vo.sentences.length > 0 };
    }
  }
  kit(name: string) {
    const n = name.trim().toLowerCase().replace(/\s+kit$/, "");
    return this.kits.find((k) => k.name.toLowerCase() === n) ?? this.kits.find((k) => k.name.toLowerCase().includes(n));
  }
  review() {
    return notesForAgent(lintStoryboard({ scenes: this.scenes, brand: this.brand, assetIds: this.assetIds, audio: this.audio }));
  }
}

async function runTool(name: string, input: unknown, send: (e: AgentEvent) => void, shadow: Shadow): Promise<string> {
  const i = input as any;
  switch (name) {
    case "propose_directions": {
      const list = sanitizeDirections(i?.directions);
      if (list.length < 2) throw new Error("Send 3 directions, each with at least a name and a hook.");
      send({ type: "directions", directions: list });
      return `Showing ${list.length} direction cards to the user. Don't build yet: end your turn with one short sentence inviting them to pick one (or mix two).`;
    }
    case "create_storyboard": {
      const p = ZStoryboard.safeParse(input);
      if (!p.success) throw new Error(`Invalid storyboard: ${p.error.issues.slice(0, 3).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
      send({ type: "storyboard", storyboard: p.data as any });
      if (typeof i.style === "string") {
        shadow.style = i.style;
        shadow.brand = brandWithStyle(shadow.brand, i.style);
      }
      shadow.scenes = buildScenes(p.data as any, presetById(shadow.style).defaultBackground, shadow.audio);
      const total = shadow.scenes.reduce((a, s) => a + s.duration, 0);
      return `Storyboard applied: ${shadow.scenes.length} scenes, ${total.toFixed(1)}s${shadow.audio && i.fit_to_voiceover !== false ? " (fitted to the voice-over)" : ""}. The user is previewing it now.\n\n${shadow.review()}`;
    }
    case "update_scenes": {
      const p = ZPatch.safeParse(input);
      if (!p.success) throw new Error("Invalid ops");
      send({ type: "patch", ops: p.data.ops as any });
      shadow.scenes = patchScenes(shadow.scenes, p.data.ops as any);
      return `Applied ${p.data.ops.length} edit(s).\n\n${shadow.review()}`;
    }
    case "set_brand": {
      const { aspect, captions, kit: kitName, ...brand } = i ?? {};
      let kitNote = "";
      if (typeof kitName === "string" && kitName.trim()) {
        const kit = shadow.kit(kitName);
        if (!kit) kitNote = ` No brand kit called "${kitName}" (kits: ${shadow.kits.map((k) => k.name).join(", ") || "none"}).`;
        else {
          send({ type: "kit", name: kit.name });
          shadow.style = kit.style;
          shadow.brand = { ...shadow.brand, ...kit.brand };
          kitNote = ` Applied the "${kit.name}" kit.`;
        }
      }
      const clean = sanitizeBrand(brand);
      if (Object.keys(clean).length) send({ type: "brand", brand: clean });
      if (clean.style) {
        shadow.style = clean.style;
        shadow.brand = brandWithStyle(shadow.brand, clean.style);
      }
      const { style: _s, ...colours } = clean;
      shadow.brand = { ...shadow.brand, ...colours };
      if (aspect || typeof captions === "boolean") send({ type: "settings", settings: { ...(aspect && { aspect }), ...(typeof captions === "boolean" && { captions }) } });
      const ignored = Object.keys(brand).filter((k) => !(k in clean));
      return `Brand updated.${kitNote}${ignored.length ? ` Ignored invalid values for: ${ignored.join(", ")} (colours must be #RGB or #RRGGBB hex).` : ""}\n\n${shadow.review()}`;
    }
    case "search_visuals": {
      const { assets, notes } = await searchVisuals(String(i.query ?? ""), i.sources, Math.min(24, i.count ?? 12));
      const tagged = assets.map((a) => ({ ...a, id: `asset:${a.id}` }));
      if (tagged.length) send({ type: "assets", assets: tagged });
      for (const a of tagged) shadow.assetIds.add(a.id);
      return JSON.stringify({ found: tagged.map((a) => ({ id: a.id, title: a.title.slice(0, 80), source: a.source, w: a.w, h: a.h })), notes });
    }
    case "search_videos": {
      const o = ["landscape", "portrait", "square"].includes(i.orientation) ? (i.orientation as Orientation) : undefined;
      const { assets, notes } = await searchVideos(String(i.query ?? ""), undefined, Math.min(12, Math.max(3, i.count ?? 6)), o);
      const tagged = assets.map((a) => ({ ...a, id: `asset:${a.id}` }));
      if (tagged.length) send({ type: "assets", assets: tagged });
      for (const a of tagged) shadow.assetIds.add(a.id);
      return JSON.stringify({ found: tagged.map((a) => ({ id: a.id, title: a.title.slice(0, 80), source: a.source, w: a.w, h: a.h, seconds: a.duration })), notes });
    }
    case "import_url": {
      const { assets, title } = await importFromUrl(String(i.url));
      const tagged = assets.map((a) => ({ ...a, id: `asset:${a.id}` }));
      if (tagged.length) send({ type: "assets", assets: tagged });
      for (const a of tagged) shadow.assetIds.add(a.id);
      return JSON.stringify({ page: title, found: tagged.map((a) => ({ id: a.id, src: a.src.slice(0, 120) })) });
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

export function resetConversation(id: string) {
  conversations.delete(id);
}

/** Internals exposed for unit tests only. */
export const __test = { Shadow, runTool, turnContent };
