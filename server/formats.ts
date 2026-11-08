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

/** Claude writes the voice-over script for a format: spoken, timed for ~15-30 s, no stage directions. */
export async function claudeWriteScript(input: { format: { name: string; hook: string; beats: string; section?: string }; brief: Record<string, unknown>; seconds?: number }): Promise<string> {
  if (!claudeConfigured()) throw new Error("Claude isn't configured on the server.");
  const brief = Object.fromEntries(Object.entries(input.brief ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => clean(x, 120)).slice(0, 6) : clean(v, 300)]));
  const secs = Math.min(60, Math.max(10, Number(input.seconds) || 20));
  const { client, model } = claude();
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 800,
      system: `You write voice-over scripts for short social ads that stop the scroll. Write only the words to be spoken: no stage directions, no labels, no emoji, no quotation marks. Short sentences, one idea each, each ending with punctuation so the edit can cut between them. Open with a hook in the first sentence (a specific moment, a question, a bold claim the brief supports). Natural, human, platform-native. About ${Math.round(secs * 2.4)} words (${secs} seconds). End with the call to action. Never invent statistics, prices or reviews beyond the brief.`,
      messages: [{ role: "user", content: `Format: ${clean(input.format?.name, 60)} (${clean(input.format?.hook, 80)}). Structure: ${clean(input.format?.beats, 500)}\n\nBrief:\n${JSON.stringify(brief, null, 1)}` }],
    });
    const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ").replace(/\s+/g, " ").trim();
    if (text.length < 20) throw new Error("Claude returned an empty script.");
    return text.slice(0, 1800);
  } catch (e) {
    const known = explainClaudeError(e);
    throw new Error(known ? known.message.replace(/ Using the local director for now\./, "") : String((e as Error)?.message ?? e));
  }
}

/** Claude listens (through the transcript and the audio analysis) and fills the brief and picks formats. */
export async function claudeListen(input: { transcript: string; voice?: Record<string, unknown>; music?: Record<string, unknown>; formats: { id: string; name: string; section: string; hook: string }[] }) {
  if (!claudeConfigured()) throw new Error("Claude isn't configured on the server.");
  const formats = (Array.isArray(input.formats) ? input.formats : []).slice(0, 40).map((f) => `${clean(f.id, 30)} (${clean(f.section, 10)}): ${clean(f.name, 40)}, ${clean(f.hook, 60)}`).join("\n");
  const { client, model } = claude();
  const tool = {
    name: "audio_brief",
    description: "What the ad is about and which formats suit this audio.",
    input_schema: {
      type: "object" as const,
      properties: {
        product: { type: "string" }, what: { type: "string", description: "what it is, under 10 words" }, audience: { type: "string" },
        benefits: { type: "array", items: { type: "string" }, maxItems: 4, description: "short, from what's said" },
        offer: { type: "string" }, cta: { type: "string", description: "button text, 1-3 words" }, url: { type: "string" },
        recommended: { type: "array", items: { type: "object", properties: { id: { type: "string" }, why: { type: "string", description: "under 10 words" } }, required: ["id", "why"] }, maxItems: 4 },
      },
      required: ["recommended"],
    },
  };
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 1200,
      tools: [tool],
      tool_choice: { type: "tool", name: "audio_brief" },
      system: "You are a creative director listening to a client's voice-over (and music) before editing an ad. From the transcript and the audio analysis, fill in the brief using only what is actually said, and recommend the formats from the list whose structure, energy and mood best fit this audio. Leave fields empty rather than guessing.",
      messages: [{ role: "user", content: `Transcript:\n${clean(input.transcript, 4000)}\n\nVoice analysis: ${JSON.stringify(input.voice ?? {}).slice(0, 1500)}\nMusic analysis: ${JSON.stringify(input.music ?? {}).slice(0, 800)}\n\nFormats:\n${formats}` }],
    });
    const use = msg.content.find((b) => b.type === "tool_use") as { input?: Record<string, any> } | undefined;
    const r = use?.input ?? {};
    const ids = new Set((input.formats ?? []).map((f) => f.id));
    return {
      brief: { product: clean(r.product, 60), what: clean(r.what, 120), audience: clean(r.audience, 80), benefits: (Array.isArray(r.benefits) ? r.benefits : []).map((b: unknown) => clean(b, 80)).filter(Boolean).slice(0, 4), offer: clean(r.offer, 80), cta: clean(r.cta, 30), url: clean(r.url, 80) },
      recommended: (Array.isArray(r.recommended) ? r.recommended : []).filter((x: any) => ids.has(x?.id)).map((x: any) => ({ id: String(x.id), why: clean(x.why, 80) })).slice(0, 4),
    };
  } catch (e) {
    const known = explainClaudeError(e);
    throw new Error(known ? known.message.replace(/ Using the local director for now\./, "") : String((e as Error)?.message ?? e));
  }
}
