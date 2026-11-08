// The footage director's shot list, written by Claude: for each spoken line, the kind of shot and
// concrete stock-footage searches a cinematographer would use. The studio plans locally first and
// sends that plan here to be improved; if Claude isn't available it keeps the local plan.
import { claude, claudeConfigured, explainClaudeError } from "./agent";
import { SHOT_TYPES } from "../src/footage/plan";

export interface ShotIn {
  line: string;
  type: string;
  queries: string[];
}
export interface ShotOut {
  type: string;
  queries: string[];
  overlay: string;
}

const clean = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

const TOOL = {
  name: "shot_list",
  description: "Return one shot per spoken line, in order.",
  input_schema: {
    type: "object" as const,
    properties: {
      shots: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: [...SHOT_TYPES] },
            queries: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "Stock video searches, best first: 2-4 concrete visual words each (subject + action or setting), no brand names, no abstract words." },
            overlay: { type: "string", description: "Words on screen for this shot (max 5, one *accent* word) or empty for clean footage. Use text on at most a third of the shots." },
          },
          required: ["type", "queries", "overlay"],
        },
      },
    },
    required: ["shots"],
  },
};

/** Ask Claude for a better shot list. Throws with a readable message when it can't. */
export async function claudeShotList(input: { shots: ShotIn[]; brief: string; aspect: string; look: string; text: string }): Promise<ShotOut[]> {
  if (!claudeConfigured()) throw new Error("Claude isn't configured on the server.");
  const shots = input.shots.slice(0, 40);
  const lines = shots.map((s, i) => `${i + 1}. "${clean(s.line, 300) || "(no words)"}"  [draft: ${s.type}; ${s.queries.slice(0, 2).join(" / ")}]`).join("\n");
  const { client, model } = claude();
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 4000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "shot_list" },
      system:
        "You are a commercial director and editor building a shot list for an ad cut entirely from stock footage (Pixabay, Coverr). For each line of the voice-over, choose the shot that makes the line land: literal when the line is concrete, a strong visual metaphor when it's abstract. Vary coverage (establishing, wide, medium, close-up, detail, people) like a real edit, keep one visual world and one cast feel across the ad, and show the product category whenever the line names it. Searches must be things a stock library actually has: concrete subjects, actions and settings, 2-4 words, no brand names.",
      messages: [
        {
          role: "user",
          content: `Brief: ${clean(input.brief, 400) || "(none, infer from the voice-over)"}\nFormat: ${clean(input.aspect, 8)} · Look: ${clean(input.look, 20)} · Text: ${clean(input.text, 12)}\n\nVoice-over lines (${shots.length}):\n${lines}\n\nReturn exactly ${shots.length} shots in the same order.`,
        },
      ],
    });
    const use = msg.content.find((b) => b.type === "tool_use") as { input?: { shots?: unknown[] } } | undefined;
    const out = Array.isArray(use?.input?.shots) ? use!.input!.shots! : [];
    if (out.length !== shots.length) throw new Error(`Claude returned ${out.length} shots for ${shots.length} lines.`);
    return out.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const queries = (Array.isArray(r.queries) ? r.queries : []).map((q) => clean(q, 60).toLowerCase()).filter(Boolean).slice(0, 4);
      return {
        type: (SHOT_TYPES as readonly string[]).includes(String(r.type)) ? String(r.type) : shots[i].type,
        queries: [...new Set([...queries, ...shots[i].queries])].slice(0, 5),
        overlay: input.text === "keywords" ? clean(r.overlay, 60) : "",
      };
    });
  } catch (e) {
    const known = explainClaudeError(e);
    throw new Error(known ? known.message.replace(/ Using the local director for now\./, "") : String((e as Error)?.message ?? e));
  }
}
