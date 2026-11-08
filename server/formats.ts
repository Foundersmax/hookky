// Claude writes a creative format: given the format's beat structure, the brief and the studio's
// own draft, it returns a sharper, scroll-stopping storyboard in the same shape. The studio keeps
// the draft if Claude isn't available.
import { claude, claudeConfigured, explainClaudeError, sceneSchema } from "./agent";
import { directorPrompt } from "../src/agent/prompt";
import { sanitizeScene } from "../src/sanitize";
import type { Scene } from "../src/types";

const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

const TOOL = {
  name: "write_ad",
  description: "Return the finished storyboard for this format.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string" },
      scenes: { type: "array", items: sceneSchema, minItems: 3, maxItems: 10 },
    },
    required: ["scenes"],
  },
};

const CRAFT = `
# Writing a creative format
You are the creative director of a top social-first agency. You get a format (a proven attention structure), the client's brief and a working draft. Return the finished ad.

Rules of attention:
- The first second decides everything: open on the most surprising, specific or emotionally charged line you can make true to the brief. No logos first, no "Introducing".
- Specific beats generic: numbers, concrete moments, the audience's own words ("3am", "day 30", "my coffee went cold").
- Curiosity gaps, contrast (problem → relief, myth → fact, them → us), social proof and urgency, each where the format calls for it.
- Write like the platform: POV captions and chats in lowercase, casual, emoji where natural; manifestos punchy; trailers sparse and dramatic.
- One idea per scene, short lines, one *accent* word per headline. Every scene earns its place; cut filler.
- Effects are punctuation: zoom-punch or flash on the hook and the reveal, whip/glitch/spin transitions between related beats, confetti only on the payoff. One grade across the ad unless the format contrasts (mono problem → colour solution).

Keep the format's beats and order (you may merge or add one beat if it makes the ad stronger), keep each scene's template unless another fits clearly better, keep every image reference exactly as in the draft and never invent new ones, end on a cta-end with the brief's call to action. Never invent statistics, prices, reviews or claims beyond the brief: where the draft uses a placeholder number or review, keep it modest and generic.`;

export async function claudeWriteFormat(input: { format: { name: string; hook: string; beats: string; aspect: string }; brief: Record<string, unknown>; draft: unknown[] }): Promise<{ title?: string; scenes: Scene[] }> {
  if (!claudeConfigured()) throw new Error("Claude isn't configured on the server.");
  const draft = (Array.isArray(input.draft) ? input.draft : []).slice(0, 12).map((s) => sanitizeScene(s));
  const refs = new Set(draft.flatMap((s) => [s.image, ...(s.images ?? []), ...(s.backdrop ?? [])]).filter(Boolean) as string[]);
  const brief = Object.fromEntries(Object.entries(input.brief ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => clean(x, 120)).slice(0, 6) : clean(v, 300)]));
  const { client, model } = claude();
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 6000,
      system: directorPrompt("server") + "\n" + CRAFT,
      tools: [TOOL as any],
      tool_choice: { type: "tool", name: "write_ad" },
      messages: [
        {
          role: "user",
          content: `Format: ${clean(input.format?.name, 60)} (${clean(input.format?.hook, 80)}), ${clean(input.format?.aspect, 6)}.\nBeats: ${clean(input.format?.beats, 600)}\n\nBrief:\n${JSON.stringify(brief, null, 1)}\n\nDraft storyboard (improve it):\n${JSON.stringify(draft.map(({ id, ...s }) => s))}`,
        },
      ],
    });
    const use = msg.content.find((b) => b.type === "tool_use") as { input?: { title?: unknown; scenes?: unknown[] } } | undefined;
    const scenes = (Array.isArray(use?.input?.scenes) ? use!.input!.scenes! : []).map((s) => sanitizeScene(s));
    if (scenes.length < 3) throw new Error("Claude returned too few scenes.");
    // Only the draft's images: a made-up reference would show as a blank.
    const keep = (r?: string) => (r && refs.has(r) ? r : undefined);
    for (const s of scenes) {
      s.image = keep(s.image);
      if (s.images) s.images = s.images.filter((r) => refs.has(r));
      if (s.backdrop) s.backdrop = s.backdrop.filter((r) => refs.has(r));
    }
    return { title: clean(use?.input?.title, 80) || undefined, scenes };
  } catch (e) {
    const known = explainClaudeError(e);
    throw new Error(known ? known.message.replace(/ Using the local director for now\./, "") : String((e as Error)?.message ?? e));
  }
}
