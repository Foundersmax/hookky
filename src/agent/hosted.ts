// Claude agent for the claude.ai-hosted build: the page calls Claude through the `sample`
// capability and Claude edits the studio through page-side tools.
import { TEMPLATES, TRANSITIONS, BACKGROUNDS, MOTIONS, PACES } from "../types";
import type { ChatAttachment } from "../types";
import { STYLE_PRESETS } from "../presets";
import { getState, applyStoryboard, applyPatch, setBrand, updateProject, applyKit } from "../store";
import { totalDuration } from "../engine/render";
import { sampleCap, sampleLimits } from "../host";
import { directorPrompt } from "./prompt";
import { sanitizeBrand, sanitizeDirections } from "../sanitize";
import { lintStoryboard, notesForAgent } from "./lint";

const SCENE_FIELDS = `Each scene: {template (${TEMPLATES.join("|")}), duration (s), kicker?, headline? (*word* = accent), subline?, items?: string[], stat?: {value, prefix?, suffix?, decimals?, label?}, image?: asset id, images?: asset ids, cta?, url?, author?, background? (${BACKGROUNDS.join("|")}), align? (left|center), transition? (${TRANSITIONS.join("|")}), motion? (${MOTIONS.join("|")}), accent? (hex), clipStart?, clipSpeed?, backdrop?: banner asset ids, font?, grade?, effects?: [], fxAmount? (see Effects)}`;

/** Director's notes on the live project, for tool results. */
function review() {
  const { project: p, assets } = getState();
  const audio = p.audio && { duration: p.audio.duration, pauses: p.audio.pauses, hasWords: !!p.audio.words?.length };
  return notesForAgent(lintStoryboard({ scenes: p.scenes, brand: p.brand, assetIds: new Set(assets.map((a) => a.id)), audio }));
}

const asObj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, any>) : {});

export const hostedTools = (activity: (label: string) => void, onDirections: (d: unknown) => void = () => {}) => [
  {
    name: "propose_directions",
    description: `Pitch 3 distinct creative directions as cards the user picks from, before building. Each: {name (2-3 words), pitch (1 sentence), style (preset id), motion (${MOTIONS.join("|")}), pace (${PACES.join("|")}), hook (opening headline, *word* = accent), accent? (hex), look? (effects look id)}. Then stop and wait for the pick.`,
    inputSchema: {
      type: "object" as const,
      properties: { directions: { type: "array", items: { type: "object" }, minItems: 3, maxItems: 3 } },
      required: ["directions"],
    },
    execute(input: Record<string, unknown>) {
      activity("Sketching directions");
      const list = sanitizeDirections(input.directions);
      if (list.length < 2) throw new Error("Send 3 directions, each with at least a name and a hook.");
      onDirections(list);
      return `Showing ${list.length} direction cards. Don't build yet: reply with one short sentence inviting the user to pick one (or mix two).`;
    },
  },
  {
    name: "create_storyboard",
    description: `Replace the whole animation with a new storyboard. ${SCENE_FIELDS}. Returns a short confirmation.`,
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        aspect: { type: "string", enum: ["16:9", "9:16", "1:1", "4:5"] },
        style: { type: "string", enum: STYLE_PRESETS.map((p) => p.id) },
        fit_to_voiceover: { type: "boolean" },
        scenes: { type: "array", items: { type: "object" } },
      },
      required: ["scenes"],
    },
    execute(input: Record<string, unknown>) {
      activity("Composing storyboard");
      const scenes = Array.isArray(input.scenes) ? input.scenes.map(asObj).filter((s) => s.template) : [];
      if (!scenes.length) throw new Error("scenes must be a non-empty array of scene objects with a template");
      applyStoryboard({ title: input.title as string, aspect: input.aspect as any, style: input.style as string, fit_to_voiceover: input.fit_to_voiceover as boolean, scenes: scenes as any });
      return `Applied ${scenes.length} scenes, ${totalDuration(getState().project).toFixed(1)}s total.\n\n${review()}`;
    },
  },
  {
    name: "update_scenes",
    description: "Edit existing scenes by 0-based index. ops: [{op: update|insert|delete|move, index, to?, scene?}]; for update send only changed fields. Returns a confirmation.",
    inputSchema: {
      type: "object" as const,
      properties: { ops: { type: "array", items: { type: "object" } } },
      required: ["ops"],
    },
    execute(input: Record<string, unknown>) {
      activity("Editing scenes");
      const ops = (Array.isArray(input.ops) ? input.ops : []).map(asObj).filter((o) => ["update", "insert", "delete", "move"].includes(o.op) && Number.isFinite(Number(o.index)));
      if (!ops.length) throw new Error("ops must contain at least one valid op");
      applyPatch(ops.map((o) => ({ ...o, index: Number(o.index), to: Number(o.to ?? 0), scene: asObj(o.scene) })) as any);
      return `Applied ${ops.length} edit(s).\n\n${review()}`;
    },
  },
  {
    name: "set_brand",
    description: "Set the look: kit (name of a saved brand kit; applies its whole look), style preset id and/or name, bg, fg, accent, muted (hex), fontDisplay, fontBody, logo (asset id), aspect, captions (bool). Returns a confirmation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kit: { type: "string" },
        style: { type: "string", enum: STYLE_PRESETS.map((p) => p.id) },
        name: { type: "string" }, bg: { type: "string" }, fg: { type: "string" }, accent: { type: "string" }, muted: { type: "string" },
        fontDisplay: { type: "string" }, fontBody: { type: "string" }, logo: { type: "string" },
        aspect: { type: "string", enum: ["16:9", "9:16", "1:1", "4:5"] }, captions: { type: "boolean" },
      },
    },
    execute(input: Record<string, unknown>) {
      activity("Setting brand");
      const { aspect, captions, kit, ...brand } = input as Record<string, any>;
      let kitNote = "";
      if (typeof kit === "string" && kit.trim()) {
        const k = applyKit(kit);
        kitNote = k ? ` Applied the "${k.name}" kit.` : ` No brand kit called "${kit}" (kits: ${getState().kits.map((x) => x.name).join(", ") || "none"}).`;
      }
      const clean = sanitizeBrand(brand);
      if (Object.keys(clean).length) setBrand(clean);
      if (aspect || typeof captions === "boolean") updateProject((p) => ({ ...p, ...(aspect && { aspect }), ...(typeof captions === "boolean" && { captions }) }));
      return `Brand updated.${kitNote}\n\n${review()}`;
    },
  },
];

async function dataUrlToBlob(src: string) {
  return (await fetch(src)).blob();
}

export interface HostedCallbacks {
  onText: (text: string) => void;
  onActivity: (label: string) => void;
  onDirections?: (d: unknown) => void;
}

/** One agent turn on claude.ai. Rejects with the sample error shape on failure. */
export async function hostedTurn(text: string, attachments: ChatAttachment[], stateJson: unknown, cb: HostedCallbacks, signal?: AbortSignal, frames: Blob[] = []) {
  const sample = await sampleCap;
  if (!sample) throw { code: "not_granted" };
  const limits = await sampleLimits();
  const { chat, assets } = getState();

  const images: Blob[] = [];
  const imgAtts = attachments.filter((a) => a.kind === "image" && a.assetId);
  if (limits?.images) {
    for (const a of imgAtts.slice(0, limits.images.maxCount)) {
      const asset = assets.find((x) => x.id === a.assetId);
      const still = asset?.kind === "video" ? asset.thumb : asset?.src;
      if (still?.startsWith("data:")) images.push(await dataUrlToBlob(still));
    }
  }
  const refCount = images.length;
  // Rendered frames for a visual review go after the references, within the host's image limit.
  if (limits?.images) images.push(...frames.slice(0, Math.max(0, limits.images.maxCount - images.length)));
  const frameCount = images.length - refCount;

  // The page keeps the conversation: standing rules, recent turns, then this turn.
  const prior = chat
    .filter((m) => !m.pending && m.text && (m.role === "user" || m.role === "assistant"))
    .slice(-10, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.text.slice(0, 2000) }));
  while (prior.length && prior[0].role !== "user") prior.shift();
  const imageNote =
    (refCount ? `\n\nAttached images, in order: ${imgAtts.slice(0, refCount).map((a) => a.assetId).join(", ")}. Reference them by these asset ids.` : "") +
    (frameCount ? `\n\n${refCount ? "The last " : ""}${frameCount === 1 ? "attached image is the contact sheet" : `${frameCount} attached images are the contact sheets`} of rendered frames.` : frames.length ? "\n\n(The contact sheet couldn't be attached here, so review from the scene list instead.)" : "");
  const turns = [
    { role: "user" as const, content: directorPrompt("hosted") + "\n\nAlways change the workspace by calling the tools; then reply to the user in 2-5 sentences." },
    ...prior,
    { role: "user" as const, content: `<studio_state>\n${JSON.stringify(stateJson)}\n</studio_state>\n\n${text}${imageNote}` },
  ];

  return sample(turns, {
    tools: hostedTools(cb.onActivity, cb.onDirections),
    ...(images.length && { images }),
    onText: ({ text }: { text: string }) => cb.onText(text),
    signal,
  });
}
