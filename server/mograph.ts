// Claude designs the motion-graphics script: for each spoken line, the motion device, the words on
// screen and the icon ideas, with web search to understand the product when the brief is thin.
// The studio's own plan is the draft and the fallback.
import Anthropic from "@anthropic-ai/sdk";
import { claude, claudeConfigured, explainClaudeError } from "./agent";
import { MOTION_TEMPLATES } from "../src/mograph/plan";

const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

const TOOL = {
  name: "motion_script",
  description: "Return the finished motion-graphics script: exactly one beat per draft beat, in order.",
  input_schema: {
    type: "object" as const,
    properties: {
      beats: {
        type: "array",
        items: {
          type: "object",
          properties: {
            template: { type: "string", enum: MOTION_TEMPLATES },
            kicker: { type: "string", description: "tiny label above the headline, 1-2 words, optional" },
            headline: { type: "string", description: "≤ 6 words, taken from what is said, one *accent* word" },
            items: { type: "array", items: { type: "string" }, maxItems: 4, description: "icon-list ideas / process-flow steps (≤ 3 words each) / bar-compare rows as 'label | value'" },
            stat: { type: "object", properties: { value: { type: "number" }, prefix: { type: "string" }, suffix: { type: "string" }, label: { type: "string" } }, required: ["value"] },
            ideas: { type: "array", items: { type: "string" }, maxItems: 7, description: "what each icon shows, in order: concrete nouns an icon kit has (moon, battery, shield, chart, coffee cup), 1-2 words" },
          },
          required: ["template", "ideas"],
        },
      },
    },
    required: ["beats"],
  },
};

const SYSTEM = `You are a senior motion designer making a minimal, top-grade motion-graphics explainer (think Apple, Stripe, Linear product films) over a client's voice-over. Every line of the voice-over gets one beat, timed to it. The studio animates a single icon kit (line icons that draw on), one accent colour, generous space.

Templates:
- icon-hero: one icon drawing on inside a sweeping ring, a short headline below. For a single strong idea or the hook.
- icon-list: 2-4 short ideas, each with an icon, drawn on as they are said.
- metric-ring: a number counting up as a ring fills (stat: value, prefix, suffix like "%", label). Only for a number that is actually said.
- process-flow: 2-4 steps joined by a line with a travelling dot. For sequences ("first… then…", "sign up, connect, launch").
- bar-compare: 2-4 bars "label | value". Only with real numbers from the voice-over or brief.
- icon-orbit: the product at the centre (ideas[0]) with its world orbiting (ideas[1..6]). Once, where the product is named.
- cta-end: the end card. The last beat.

Craft: one idea per beat; the screen should say less than the voice, never more; headlines are the key words of what is said with one *accent* word (prefer the words the speaker stresses); vary templates (never three alike in a row); icon ideas must be concrete, drawable nouns that exist in icon libraries (not abstractions like "innovation"); never invent numbers, prices or claims. If the brief is thin, use web search (at most twice) to understand what the product is and who it's for, then design. Keep the draft's beat count and order; improve its choices. Finish by calling motion_script.`;

export async function claudeMotionScript(input: { draft: unknown[]; brief: Record<string, unknown>; style: Record<string, unknown>; delivery?: Record<string, unknown> }) {
  if (!claudeConfigured()) throw new Error("Claude isn't configured on the server.");
  const draft = (Array.isArray(input.draft) ? input.draft : []).slice(0, 40) as Record<string, unknown>[];
  if (!draft.length) throw new Error("No draft to work from.");
  const brief = Object.fromEntries(Object.entries(input.brief ?? {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => clean(x, 120)).slice(0, 6) : clean(v, 300)]));
  const lines = draft.map((b, i) => `${i + 1}. [${Number(b.s ?? 0).toFixed(1)}–${Number(b.e ?? 0).toFixed(1)}s] "${clean(b.line, 240)}"  draft: ${clean(b.template, 20)}${b.ideas ? ` · icons: ${(b.ideas as unknown[]).map((x) => clean(x, 30)).join(", ")}` : ""}`).join("\n");
  const { client, model } = claude();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Brief: ${JSON.stringify(brief)}\nStyle: ${JSON.stringify(input.style ?? {}).slice(0, 400)}\nDelivery: ${JSON.stringify(input.delivery ?? {}).slice(0, 500)}\n\nVoice-over lines and the studio's draft (${draft.length} beats):\n${lines}\n\nDesign the motion script: exactly ${draft.length} beats, same order.`,
    },
  ];
  try {
    for (let round = 0; round < 3; round++) {
      const msg = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 } as Anthropic.Beta.BetaToolUnion, TOOL as Anthropic.Beta.BetaToolUnion],
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        betas: ["server-side-fallback-2026-07-01"],
        ...({ fallbacks: "default" } as object),
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      const use = msg.content.find((b) => b.type === "tool_use" && (b as { name?: string }).name === "motion_script") as { input?: { beats?: unknown[] } } | undefined;
      if (use) {
        const beats = Array.isArray(use.input?.beats) ? use.input!.beats! : [];
        if (beats.length !== draft.length) throw new Error(`Claude returned ${beats.length} beats for ${draft.length} lines.`);
        const searched = msg.content.filter((b) => (b as { type: string }).type === "server_tool_use").length;
        return { beats: beats.map(cleanBeat), searched };
      }
      // No script yet (it was researching or thinking aloud): keep going.
      messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });
      messages.push({ role: "user", content: "Now call motion_script with the finished script." });
    }
    throw new Error("Claude didn't return a script.");
  } catch (e) {
    const known = explainClaudeError(e);
    throw new Error(known ? known.message.replace(/ Using the local director for now\./, "") : String((e as Error)?.message ?? e));
  }
}

function cleanBeat(raw: unknown) {
  const r = (raw ?? {}) as Record<string, any>;
  const template = (MOTION_TEMPLATES as string[]).includes(r.template) ? r.template : "icon-hero";
  const stat = r.stat && Number.isFinite(Number(r.stat.value)) ? { value: Number(r.stat.value), ...(r.stat.prefix && { prefix: clean(r.stat.prefix, 4) }), ...(r.stat.suffix && { suffix: clean(r.stat.suffix, 12) }), ...(r.stat.label && { label: clean(r.stat.label, 80) }) } : undefined;
  return {
    template,
    ...(r.kicker && { kicker: clean(r.kicker, 30) }),
    ...(r.headline && { headline: clean(r.headline, 80) }),
    ...(Array.isArray(r.items) && { items: r.items.map((x: unknown) => clean(x, 40)).filter(Boolean).slice(0, 4) }),
    ...(stat && { stat }),
    ideas: (Array.isArray(r.ideas) ? r.ideas : []).map((x: unknown) => clean(x, 40)).filter(Boolean).slice(0, 7),
  };
}
