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
  /** what the shot shows, in a few words */
  visual?: string;
  /** one or two words a clip's description must contain to be on subject */
  must?: string[];
  media?: "video" | "photo" | "any";
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
            queries: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4, description: "Stock video searches, best first. Each is a short natural description (3-8 words) of real live-action footage: who, doing what, where (e.g. 'young woman pouring coffee in sunlit kitchen'). No brand names, no abstract words, nothing animated." },
            overlay: { type: "string", description: "Words on screen for this shot (max 5, one *accent* word) or empty for clean footage. Use text on at most a third of the shots." },
            visual: { type: "string", description: "What the viewer sees in this shot, in 3-8 words ('aerial of terraced coffee farms at dawn')." },
            must: { type: "array", items: { type: "string" }, maxItems: 2, description: "One or two single lowercase words that a matching clip's title would almost certainly contain: the concrete subject of the shot ('coral', 'istanbul'). Never style words." },
            media: { type: "string", enum: ["video", "photo", "any"], description: "'photo' when a photograph tells it better than stock video could (a historical moment, a specific real person, place or object, an old document or map); 'video' for anything that moves; 'any' when unsure." },
          },
          required: ["type", "queries", "overlay", "visual", "must", "media"],
        },
      },
    },
    required: ["shots"],
  },
};

const ROLE: Record<string, string> = {
  ad: "You are a commercial director and editor building a shot list for an ad cut from real, live-action stock footage. Keep one visual world: the same kind of person (the ad's audience), the same kind of places and light across the ad, so it feels shot for one campaign. Show the product category whenever the line names it, and in the closing shot.",
  documentary:
    "You are a documentary director and archive researcher building a shot list for a documentary cut from stock footage and photographs. Show the actual thing being talked about: the real place, animal, object, process or era, by name. Establish each new place or subject with a wide shot before going closer. When the narration is about history or a specific real thing stock video won't have, ask for a photograph. Never illustrate a fact with generic lifestyle footage, and never show something the narration doesn't support.",
  story:
    "You are an editor building a shot list for a narrated explainer cut from stock footage. One clear, literal picture per idea: the thing itself, then a detail of it. Keep the same setting and subjects across neighbouring shots so the story reads as one piece.",
};

/** Ask Claude for a better shot list. Throws with a readable message when it can't. */
export async function claudeShotList(input: { shots: ShotIn[]; brief: string; aspect: string; look: string; text: string; genre?: string; direction?: string; topic?: string }): Promise<ShotOut[]> {
  if (!claudeConfigured()) throw new Error("Claude isn't configured on the server.");
  const shots = input.shots.slice(0, 40);
  const lines = shots.map((s, i) => `${i + 1}. "${clean(s.line, 300) || "(no words)"}"  [draft: ${s.type}; ${s.queries.slice(0, 2).join(" / ")}]`).join("\n");
  const { client, model } = claude();
  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 8000,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "shot_list" },
      system: `${ROLE[input.genre ?? "ad"] ?? ROLE.ad} The libraries (Freepik, Pexels, Pixabay, Coverr) are searched in plain language, and they match on clip titles. First read the whole voice-over and decide what it is about and where it takes place; a line that says "it" or "they" is about what the lines before it named. Then, for each line, choose the shot that makes the line land as it's spoken: literal when the line is concrete, a strong visual metaphor when it's abstract, never the opposite of what's said ("stress less" shows calm, not stress). Vary coverage (establishing, wide, medium, close-up, detail, people) like a real edit, and don't repeat the same picture for neighbouring lines. Write each search the way a clip would be titled: subject, action, setting ("sea turtle swimming over coral reef"), most specific first, then a simpler fallback a small library would still answer ("sea turtle underwater"). When the person describes the footage they want, follow it in every shot: its style words go into the searches where a library would understand them (aerial, slow motion, night, black and white), and anything they ask to keep out must not appear in any search.`,
      messages: [
        {
          role: "user",
          content: `Kind of film: ${clean(input.genre, 20) || "ad"}\nBrief: ${clean(input.brief, 400) || "(none, infer from the voice-over)"}\nFootage the person wants: ${clean(input.direction, 600) || "(not described: choose what suits the voice-over)"}\nA first reading says it's about: ${clean(input.topic, 200) || "(unclear)"}\nFormat: ${clean(input.aspect, 8)} · Look: ${clean(input.look, 20)} · Text: ${clean(input.text, 12)}\n\nVoice-over lines (${shots.length}), each with a draft from a keyword-based planner that you should improve on:\n${lines}\n\nReturn exactly ${shots.length} shots in the same order.`,
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
        ...(clean(r.visual, 80) && { visual: clean(r.visual, 80) }),
        must: (Array.isArray(r.must) ? r.must : []).map((m) => clean(m, 30).toLowerCase().split(" ")[0]).filter((m) => /^[a-z0-9-]{3,}$/.test(m)).slice(0, 2),
        ...(["video", "photo", "any"].includes(String(r.media)) && { media: r.media as ShotOut["media"] }),
      };
    });
  } catch (e) {
    const known = explainClaudeError(e);
    throw new Error(known ? known.message.replace(/ Using the local director for now\./, "") : String((e as Error)?.message ?? e));
  }
}

const PICK_TOOL = {
  name: "pick_clip",
  description: "Choose the clip that best shows the spoken line.",
  input_schema: {
    type: "object" as const,
    properties: {
      index: { type: "integer", description: "1-based number of the best clip, or 0 if none of them fit the line at all." },
      reason: { type: "string", description: "A few words on why." },
    },
    required: ["index"],
  },
};

/** Claude looks at the candidate thumbnails for one shot and picks the one that fits the line best. */
export async function claudePickClip(input: { line: string; shot: string; brief: string; candidates: { thumb: string; title: string }[] }): Promise<{ index: number; reason?: string }> {
  if (!claudeConfigured()) throw new Error("Claude isn't configured on the server.");
  const cands = input.candidates.filter((c) => /^https:\/\//.test(c.thumb)).slice(0, 6);
  if (cands.length < 2) return { index: cands.length ? 1 : 0 };
  const { client, model } = claude();
  const content: any[] = [
    { type: "text", text: `Ad: ${clean(input.brief, 200) || "(no brief)"}\nSpoken line: "${clean(input.line, 300)}"\nShot wanted: ${clean(input.shot, 120)}\n\nCandidates:` },
  ];
  cands.forEach((c, i) => {
    content.push({ type: "text", text: `${i + 1}. ${clean(c.title, 100)}` });
    content.push({ type: "image", source: { type: "url", url: c.thumb } });
  });
  content.push({ type: "text", text: "Pick the clip a good editor would cut to while this line is spoken: real-looking footage that shows what's said (or its feeling), well lit and in focus, no visible text or watermark-heavy graphics, consistent with a premium ad." });
  try {
    const msg = await client.messages.create({ model, max_tokens: 300, tools: [PICK_TOOL], tool_choice: { type: "tool", name: "pick_clip" }, messages: [{ role: "user", content }] });
    const use = msg.content.find((b) => b.type === "tool_use") as { input?: { index?: unknown; reason?: unknown } } | undefined;
    const index = Math.round(Number(use?.input?.index));
    return { index: Number.isFinite(index) && index >= 0 && index <= cands.length ? index : 1, reason: clean(use?.input?.reason, 120) || undefined };
  } catch (e) {
    const known = explainClaudeError(e);
    throw new Error(known ? known.message.replace(/ Using the local director for now\./, "") : String((e as Error)?.message ?? e));
  }
}
