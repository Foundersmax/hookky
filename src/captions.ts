// Caption files (.srt / .vtt) for uploads to YouTube, LinkedIn, Meta and editors. Cues come from
// the voice-over's timed words when there are any, otherwise from the on-screen copy per scene.
import type { Project, Scene, Word } from "./types";

export interface Cue {
  s: number;
  e: number;
  text: string;
}

const MAX_CHARS = 42; // one comfortable line on a phone
const MAX_WORDS_SECONDS = 3.2;
const MIN_CUE = 0.7;

const plain = (t: string) => t.replace(/\*/g, "").replace(/\s+/g, " ").trim();

/** Group timed words into readable cues: break at sentence ends, pauses, ~42 characters or ~3 s. */
export function cuesFromWords(words: Word[]): Cue[] {
  const out: Cue[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) out.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(" ") });
    cur = [];
  };
  words.forEach((w, i) => {
    const next = words[i + 1];
    const text = [...cur, w].map((x) => x.w).join(" ");
    // Start a new cue before this word if it would make the line too long.
    if (cur.length && text.length > MAX_CHARS) flush();
    cur.push(w);
    const gap = next ? next.s - w.e : 1;
    if (!next || /[.!?]$/.test(w.w) || gap > 0.45 || (/[,;:—]$/.test(w.w) && cur.map((x) => x.w).join(" ").length > 18) || w.e - cur[0].s > MAX_WORDS_SECONDS) flush();
  });
  return settle(out);
}

/** Text a scene shows on screen, as one caption line. */
function sceneText(s: Scene): string {
  const stat = s.stat && `${s.stat.prefix ?? ""}${s.stat.value.toFixed(s.stat.decimals ?? 0)}${s.stat.suffix ?? ""}${s.stat.label ? ` ${s.stat.label}` : ""}`;
  const parts = [s.kicker, s.headline, stat, s.subline, s.template === "testimonials" ? undefined : s.items?.join(" · "), s.author && `— ${s.author}`, s.cta, s.url];
  if (s.template === "testimonials") parts.push(...(s.items ?? []));
  // Join with a dash, or just a space after text that already ends a sentence.
  return plain(parts.filter((x): x is string => !!x && !!plain(x)).reduce((acc, x) => (acc ? `${acc}${/[.!?…:]$/.test(plain(acc)) ? " " : " — "}${x}` : x), ""));
}

/** One cue per scene with on-screen copy, for cuts without a transcript. */
export function cuesFromScenes(scenes: Scene[]): Cue[] {
  const out: Cue[] = [];
  let t = 0;
  for (const s of scenes) {
    const text = sceneText(s);
    if (text) out.push({ s: t, e: t + s.duration, text });
    t += s.duration;
  }
  return out;
}

/** Cues for a project, and where they came from. */
export function captionCues(p: Project): { cues: Cue[]; source: "voice-over" | "on-screen text" | "none" } {
  if (p.audio?.words?.length) return { cues: cuesFromWords(p.audio.words), source: "voice-over" };
  const cues = cuesFromScenes(p.scenes);
  return { cues, source: cues.length ? "on-screen text" : "none" };
}

/** Clean timing: sorted, non-overlapping, at least MIN_CUE long where the gap allows. */
function settle(cues: Cue[]): Cue[] {
  const out = cues.filter((c) => c.text.trim() && Number.isFinite(c.s) && Number.isFinite(c.e)).map((c) => ({ ...c, text: plain(c.text), e: Math.max(c.e, c.s) }));
  out.sort((a, b) => a.s - b.s);
  out.forEach((c, i) => {
    const next = out[i + 1];
    const limit = next ? next.s : Infinity;
    if (c.e - c.s < MIN_CUE) c.e = Math.min(c.s + MIN_CUE, limit);
    if (c.e > limit) c.e = limit;
  });
  return out;
}

/** Wrap a cue onto at most two balanced lines. */
export function wrapCue(text: string, max = MAX_CHARS): string {
  if (text.length <= max) return text;
  const words = text.split(" ");
  let best = text, score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
    const s = Math.max(a.length, b.length);
    if (s < score) (score = s), (best = `${a}\n${b}`);
  }
  return best;
}

const stamp = (t: number, sep: "," | ".") => {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3_600_000), m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
};

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.s, ",")} --> ${stamp(c.e, ",")}\n${wrapCue(c.text)}\n`).join("\n");
}

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.s, ".")} --> ${stamp(c.e, ".")}\n${wrapCue(c.text).replace(/-->/g, "→")}\n`).join("\n")}`;
}
