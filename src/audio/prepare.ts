// Taking the time to listen: the stages a voice-over and a music track go through before the
// studio builds anything, each reported as it runs.
import type { AudioTrack, MusicTrack } from "../types";
import { analyzeAudio } from "./analyze";
import { analyzeVoice, analyzeMusic, decode } from "./insight";
import { analyzeMusicFile } from "./beats";
import { cleanMusic } from "./mix";

export type Stage = { id: string; label: string; state: "waiting" | "running" | "done" | "skipped"; note?: string };
export type OnStages = (stages: Stage[]) => void;

/** Runs named stages in order, reporting each; a stage can mark itself skipped with a note. */
function runner(labels: [string, string][], on: OnStages) {
  const stages: Stage[] = labels.map(([id, label]) => ({ id, label, state: "waiting" }));
  const emit = () => on(stages.map((s) => ({ ...s })));
  emit();
  return async <T>(id: string, fn: () => Promise<T>, note?: (v: T) => string | undefined): Promise<T> => {
    const s = stages.find((x) => x.id === id)!;
    s.state = "running";
    emit();
    const t0 = performance.now();
    try {
      const v = await fn();
      // Each stage stays on screen long enough to read.
      const left = 450 - (performance.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      s.state = "done";
      s.note = note?.(v);
      emit();
      return v;
    } catch (e: any) {
      s.state = "skipped";
      s.note = e?.message ?? String(e);
      emit();
      throw e;
    }
  };
}

export const VOICE_STAGES: [string, string][] = [
  ["decode", "Decoding the recording"],
  ["words", "Transcribing every word"],
  ["stress", "Finding the words the voice leans on"],
  ["pace", "Reading pace, energy and mood"],
  ["meaning", "Picking out the hook, the offer and the ask"],
];

/** Listen to a voice-over end to end: the track, its words with timings, and what they say and how. */
export async function prepareVoice(file: File, on: OnStages, transcribeOk = true): Promise<AudioTrack> {
  const step = runner(VOICE_STAGES, on);
  const track = await step("decode", () => analyzeAudio(file), (t) => `${t.duration.toFixed(1)}s, ${t.pauses.length} pauses`);
  let words = track.words;
  try {
    words = await step(
      "words",
      async () => {
        if (!transcribeOk) throw new Error("no transcription service on the server; paste the script in the Voice tab for word timing");
        const fd = new FormData();
        fd.append("audio", file);
        const r = await fetch("/api/transcribe", { method: "POST", body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(j.words) || !j.words.length) throw new Error(j.error ?? "the transcription came back empty");
        return j.words as AudioTrack["words"];
      },
      (w) => `${w?.length ?? 0} words`,
    );
  } catch {
    /* carry on without words; later stages say what they could */
  }
  const pcm = await decode(file);
  const insight = analyzeVoice(pcm.x, pcm.sr, words ?? [], track.pauses, track.duration);
  await step("stress", async () => insight, (i) => (i.stressedWords.length ? i.stressedWords.slice(0, 6).join(", ") : "no transcript to weigh"));
  await step("pace", async () => insight, (i) => `${i.wpm ? `${i.wpm} wpm, ` : ""}${i.pace}, ${i.mood}`);
  await step("meaning", async () => insight, (i) => [i.product && `product: ${i.product}`, i.url, i.cta && "call to action found"].filter(Boolean).join(" · ") || "nothing specific found");
  return { ...track, ...(words?.length && { words, wordsSource: "transcription" as const }), insight };
}

export const MUSIC_STAGES: [string, string][] = [
  ["decode", "Decoding the track"],
  ["beats", "Finding the tempo, beats and bars"],
  ["shape", "Mapping intro, build, drop and outro"],
  ["mood", "Reading mood and loudness"],
];

/** Listen to a music track: beats, bars, the drop, its sections, mood and loudness. */
export async function prepareMusic(src: File | MusicTrack, on: OnStages): Promise<MusicTrack> {
  const step = runner(MUSIC_STAGES, on);
  const blob = src instanceof File ? src : await fetch(src.url).then((r) => r.blob());
  const url = src instanceof File ? URL.createObjectURL(src) : src.url;
  const pcm = await step("decode", () => decode(blob), (p) => `${Math.floor(p.duration / 60)}:${String(Math.floor(p.duration % 60)).padStart(2, "0")}`);
  const res = await step("beats", () => analyzeMusicFile(blob), (r) => (r.map ? `${Math.round(r.map.bpm)} BPM, ${r.map.downbeats.length} bars` : "no steady beat"));
  const map = res.map;
  const insight = map ? analyzeMusic(pcm.x, pcm.sr, map, pcm.duration) : undefined;
  await step("shape", async () => insight, (i) => (i ? i.sections.map((s) => s.kind).join(" → ") : "free-flowing, no sections"));
  await step("mood", async () => insight, (i) => (i ? `${i.mood}${map?.drop !== undefined ? `, drop at ${Math.floor(map.drop / 60)}:${String(Math.floor(map.drop % 60)).padStart(2, "0")}` : ""}` : "—"));
  const base = src instanceof File ? { name: src.name } : src;
  return cleanMusic({ ...base, duration: pcm.duration, ...(map ?? {}), ...(insight && { insight }) }, url);
}
