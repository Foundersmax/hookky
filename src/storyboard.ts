// Pure storyboard operations (no DOM, no store), shared by the studio and the server agent.
import type { AudioTrack, Brand, PatchOp, Scene, StoryboardInput } from "./types";
import { sanitizeScene } from "./sanitize";
import { presetById } from "./presets";
import { clamp } from "./engine/util";

/** The parts of a voice-over that timing needs. */
export type Timing = Pick<AudioTrack, "duration" | "pauses">;

/** Clean a storyboard's scenes, default their background, and fit them to the voice-over if asked. */
export function buildScenes(sb: StoryboardInput, defaultBackground?: Scene["background"], audio?: Timing): Scene[] {
  let scenes = (Array.isArray(sb.scenes) ? sb.scenes : []).map((s) => sanitizeScene({ background: defaultBackground, ...(s as object) }));
  if (scenes[0]) scenes[0].transition = "cut";
  if (audio && sb.fit_to_voiceover !== false) scenes = fitToVoiceover(scenes, audio);
  return scenes;
}

/** Apply update/insert/delete/move ops in order. Out-of-range indexes are clamped; the last scene is never deleted. */
export function patchScenes(input: Scene[], ops: PatchOp[]): Scene[] {
  const scenes = [...input];
  for (const o of Array.isArray(ops) ? ops : []) {
    if (!o || typeof o !== "object" || !Number.isFinite(Number(o.index))) continue;
    const i = clamp(Math.round(Number(o.index)), 0, Math.max(0, scenes.length - (o.op === "insert" ? 0 : 1)));
    if (o.op === "update" && scenes[i]) scenes[i] = sanitizeScene({ ...scenes[i], ...(o.scene ?? {}) }, scenes[i].id);
    else if (o.op === "insert") scenes.splice(i, 0, sanitizeScene(o.scene));
    else if (o.op === "delete" && scenes.length > 1) scenes.splice(i, 1);
    else if (o.op === "move" && scenes[i]) {
      const [s] = scenes.splice(i, 1);
      scenes.splice(clamp(Math.round(Number(o.to) || 0), 0, scenes.length), 0, s);
    }
  }
  return scenes;
}

/** A style preset's colours and fonts, keeping the brand's own name and logo. */
export function brandWithStyle(brand: Brand, styleId: string): Brand {
  const pr = presetById(styleId);
  return { ...brand, ...pr.brand, name: brand.name, logo: brand.logo };
}

/** Points where a cut sounds natural: the middle of each pause, plus the end of the voice-over. */
export function snapPoints(audio: Timing): number[] {
  return [...audio.pauses.map((p) => +((p.s + p.e) / 2).toFixed(2)), +audio.duration.toFixed(2)];
}

/** Move each cut onto the nearest pause within `maxShift` seconds, keeping scene order and roughly the same lengths. */
export function snapCutsToPauses(scenes: Scene[], audio: Timing, maxShift = 0.75): { scenes: Scene[]; moved: number } {
  const points = snapPoints(audio);
  let t = 0, prev = 0, moved = 0;
  const out = scenes.map((s, i) => {
    t += s.duration;
    let end = t;
    if (i < scenes.length - 1 || Math.abs(t - audio.duration) <= maxShift) {
      let best = Infinity;
      for (const m of points) if (Math.abs(m - t) <= maxShift && Math.abs(m - t) < Math.abs(best - t) && m - prev >= 0.8) best = m;
      if (best !== Infinity && Math.abs(best - t) > 0.005) (end = best), moved++;
    }
    const d = +(end - prev).toFixed(2);
    prev = end;
    return { ...s, duration: d };
  });
  return { scenes: out, moved };
}

/** Scale scenes to the voice-over's length, then snap each cut to the nearest natural pause. */
export function fitToVoiceover(scenes: Scene[], audio: Timing): Scene[] {
  if (!scenes.length) return scenes;
  const total = scenes.reduce((a, s) => a + s.duration, 0) || 1;
  const k = audio.duration / total;
  let t = 0;
  const cuts = scenes.map((s) => (t += s.duration * k));
  const mids = audio.pauses.map((p) => (p.s + p.e) / 2);
  const snapped = cuts.map((c, i) => {
    if (i === cuts.length - 1) return audio.duration;
    let best = c, bd = 0.7;
    for (const m of mids) if (Math.abs(m - c) < bd) (bd = Math.abs(m - c)), (best = m);
    return best;
  });
  let prev = 0;
  return scenes.map((s, i) => {
    const end = Math.max(prev + 0.8, snapped[i]);
    const d = +(end - prev).toFixed(2);
    prev = end;
    return { ...s, duration: d };
  });
}
