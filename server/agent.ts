import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Response } from "express";
import type { AgentEvent } from "../src/types";
import { TEMPLATES, TRANSITIONS, BACKGROUNDS } from "../src/types";
import { STYLE_PRESETS } from "../src/presets";
import { searchVisuals, importFromUrl } from "./connectors";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
let webSearchEnabled = (process.env.CLAUDE_WEB_SEARCH || "on").toLowerCase() !== "off";

export function claudeConfigured() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || process.env.CLAUDE_ENABLED);
}

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// ---------------------------------------------------------------- system prompt (frozen → cacheable)
const SYSTEM = `You are Motif, the creative director and motion designer inside Motif Studio — a tool that turns briefs, references and voice-overs into modern, minimalist animated graphics for product ads and launches.

The user sees a chat console on the left and a live canvas workspace on the right. You change the workspace by calling tools; your chat replies should be short, warm and specific (2–5 sentences), describing the creative idea, not the JSON.

# How you work
- Read the <studio_state> block in each user turn: it is the current project (aspect, style, brand, scenes), asset library (ids you can reference), and voice-over analysis (duration, pauses, timed transcript when available).
- New idea or "make me an ad" → call create_storyboard with a complete scene list. Edits ("make scene 3 punchier", "swap the image") → update_scenes with the smallest set of ops.
- Need imagery? Call search_visuals (Pinterest, Freepik/Magnific, Envato, Unsplash, Pexels, Openverse) with concrete, art-directable queries ("matte black wireless earbuds on stone, studio light", not "earbuds"). If the user pastes a link, call import_url. Use web_search to research a product, brand or competitor when you need facts or inspiration, then import_url on the most useful page.
- Reference images in scenes by asset id exactly as listed (e.g. "asset:up_3"). Prefer the user's uploads for the hero product.
- When the user uploads reference images, look at them: infer palette, typography mood and composition, and reflect that via set_brand and your scene choices.

# Voice-over sync
- If a voice-over exists, total scene duration must equal its duration (set fit_to_voiceover: true — the studio snaps cuts to natural pauses). Plan one scene per spoken idea and put the words being spoken on screen (shortened). Use kinetic-words for punchy spoken lines — it animates the transcript word-by-word in sync.
- Without a voice-over, pace 2.5–4s per scene; 15s ads ≈ 5 scenes, 30s ≈ 8–10, 60s ≈ 14–18.

# Design principles (modern & minimal)
- One idea per scene. Headlines ≤ 6 words; sublines ≤ 12 words. Mark one or two emphasis words with *asterisks* (rendered in the accent colour).
- Rhythm: alternate dense and airy scenes; vary templates; never use the same template three times in a row.
- Arc: hook (0–3s) → problem/desire → product reveal → 2–4 benefits/features/proof → social proof or stat → CTA end card with logo/url.
- Restraint: lots of negative space, 1 accent colour, at most 2 typefaces. Use "invert" or "accent" backgrounds sparingly for punctuation beats.
- Transitions: mostly fade/slide/push-up; save circle/zoom for the reveal; "cut" lands on beats.

# Templates
title-reveal (headline+kicker+subline, masked line reveal) · kinetic-words (headline words or VO transcript animated in sync) · product-hero (image floating with soft shadow + label) · split-feature (image one side, kicker/headline/subline other) · feature-list (items[] 2–4 short lines, numbered stagger) · stat-counter (stat {value,prefix,suffix,decimals,label} counts up) · image-mosaic (images[] 3–6 tiles reveal) · fullbleed (image fills frame, headline overlay) · quote (headline = quote, author) · marquee (headline scrolls as giant band) · shape-burst (abstract geometric beat, optional headline) · logo-sting (brand logo/name build) · cta-end (headline, cta button text, url, logo).

Backgrounds: ${BACKGROUNDS.join(", ")}. Transitions: ${TRANSITIONS.join(", ")}. Motion: calm | snappy | bouncy.
Style presets: ${STYLE_PRESETS.map((p) => `${p.id} (${p.mood})`).join("; ")}.

Never invent statistics, prices or claims about a real product; use what the user gave you or what you found via search, and say so if you used a placeholder.`;

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
    motion: { type: "string", enum: ["calm", "snappy", "bouncy"] },
    accent: { type: "string", description: "hex override" },
    notes: { type: "string", description: "director's note, not rendered" },
  },
  required: ["template", "duration"],
} as const;

const tools: Anthropic.Beta.BetaToolUnion[] = [
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
    description: "Set the visual identity: style preset and/or explicit colours and fonts.",
    input_schema: {
      type: "object",
      properties: {
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
}

export async function runAgentTurn(input: TurnInput, res: Response) {
  const send = (e: AgentEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const history = conversations.get(input.conversationId) ?? [];
  conversations.set(input.conversationId, history);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const img of input.images ?? []) {
    content.push({ type: "text", text: `Uploaded reference → ${img.assetId}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType as "image/png", data: img.data } });
  }
  content.push({ type: "text", text: `<studio_state>\n${JSON.stringify(input.state)}\n</studio_state>` });
  content.push({ type: "text", text: input.text || "(no message)" });
  history.push({ role: "user", content });

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
          return { type: "tool_result", tool_use_id: tu.id, content: await runTool(tu.name, tu.input, send) };
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
    { create_storyboard: "Composing storyboard", update_scenes: "Editing scenes", set_brand: "Setting brand", search_visuals: "Searching visual sources", import_url: "Importing from URL" } as Record<string, string>
  )[name] ?? name;
}

async function runTool(name: string, input: unknown, send: (e: AgentEvent) => void): Promise<string> {
  const i = input as any;
  switch (name) {
    case "create_storyboard": {
      const p = ZStoryboard.safeParse(input);
      if (!p.success) throw new Error(`Invalid storyboard: ${p.error.issues.slice(0, 3).map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
      send({ type: "storyboard", storyboard: p.data as any });
      const total = p.data.scenes.reduce((a, s) => a + s.duration, 0);
      return `Storyboard applied: ${p.data.scenes.length} scenes, ${total.toFixed(1)}s${i.fit_to_voiceover ? " (fitted to voice-over)" : ""}. The user is previewing it now.`;
    }
    case "update_scenes": {
      const p = ZPatch.safeParse(input);
      if (!p.success) throw new Error("Invalid ops");
      send({ type: "patch", ops: p.data.ops as any });
      return `Applied ${p.data.ops.length} edit(s).`;
    }
    case "set_brand": {
      const { aspect, captions, ...brand } = i ?? {};
      if (Object.keys(brand).length) send({ type: "brand", brand });
      if (aspect || typeof captions === "boolean") send({ type: "settings", settings: { ...(aspect && { aspect }), ...(typeof captions === "boolean" && { captions }) } });
      return "Brand updated.";
    }
    case "search_visuals": {
      const { assets, notes } = await searchVisuals(String(i.query ?? ""), i.sources, Math.min(24, i.count ?? 12));
      const tagged = assets.map((a) => ({ ...a, id: `asset:${a.id}` }));
      if (tagged.length) send({ type: "assets", assets: tagged });
      return JSON.stringify({ found: tagged.map((a) => ({ id: a.id, title: a.title.slice(0, 80), source: a.source, w: a.w, h: a.h })), notes });
    }
    case "import_url": {
      const { assets, title } = await importFromUrl(String(i.url));
      const tagged = assets.map((a) => ({ ...a, id: `asset:${a.id}` }));
      if (tagged.length) send({ type: "assets", assets: tagged });
      return JSON.stringify({ page: title, found: tagged.map((a) => ({ id: a.id, src: a.src.slice(0, 120) })) });
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

export function resetConversation(id: string) {
  conversations.delete(id);
}
