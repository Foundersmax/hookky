// Making a creative format in the studio: voice-over (uploaded or generated), music, the format
// built around them, Claude's rewrite when available, then stock footage cast for every shot the
// library can't fill. The scenes land at once and fill in as footage arrives; one undo step.
import type { Aspect, AudioTrack, MusicTrack, Scene } from "./types";
import { mixLevel } from "./audio/insight";
import { getState, setState, applyStoryboard, setAudio, libraryId, updateProject } from "./store";
import { sanitizeScene } from "./sanitize";
import { ingestVoiceover } from "./components/VoicePanel";
import { buildFormat, buildWithVoice, fill, isStockRef, snapToBeats, stockRef, type Brief, type Format } from "./formats";
import { pickImages, loadMusic } from "./soundApply";
import { musicWindow } from "./soundTemplates";
import { beatsInCut } from "./audio/beats";
import { castOne, timingFor } from "./footage/cast";
import { preferLicensed } from "./footage/license";
import { queriesFor, type Shot, type ShotType } from "./footage/plan";
import { clock } from "./clock";
import { planMotion, motionScenes, pseudoVoice, type MotionBeat } from "./mograph/plan";
import { builtinIcon } from "./mograph/ideas";
import { cleanIcon, type IconSpec } from "./mograph/icons";

/**
 * A motion-graphics edit: the studio's beat plan, Claude's motion script (it can search the web to
 * understand the product), then each icon idea found in the style's kit. Falls back step by step.
 */
async function motionEdit(f: Format, brief: ReturnType<typeof fill>, audio: AudioTrack | undefined, withClaude: boolean, step: (s: string) => void, notes: string[]) {
  const st = f.motion!;
  const voice = audio ? { duration: audio.duration, pauses: audio.pauses, words: audio.words, insight: audio.insight } : pseudoVoice(brief);
  step("Planning a beat per line");
  let beats: MotionBeat[] = planMotion(voice, brief, { prefer: st.prefer });
  let searched = 0;
  if (withClaude) {
    step("Claude is designing the motion script");
    try {
      const r = await fetch("/api/mograph/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: beats.map((b) => ({ s: b.s, e: b.e, line: b.line, template: b.template, ideas: b.ideas })),
          brief,
          style: { name: st.name, kit: st.kit, blurb: st.blurb, ...(st.prefer && { leads_with: st.prefer }) },
          delivery: audio?.insight ? { mood: audio.insight.mood, pace: audio.insight.pace, stressed: audio.insight.stressedWords?.slice(0, 12) } : undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.beats) && j.beats.length === beats.length) {
        // The timing and the words said are ours; the design is Claude's. The end card stays the end card.
        beats = beats.map((b, i) => {
          const c = j.beats[i] ?? {};
          const last = i === beats.length - 1;
          return { ...b, ...c, s: b.s, e: b.e, line: b.line, template: last ? b.template : c.template ?? b.template, ideas: c.ideas?.length ? c.ideas : b.ideas };
        });
        if (j.searched) searched = j.searched;
      } else notes.push(`Claude unavailable (${String(j.error ?? r.status).replace(/\.$/, "")}), used the studio's motion plan`);
    } catch (e: any) {
      notes.push(`couldn't reach Claude (${e.message})`);
    }
  }

  // Icons: every idea looked up in the kit (local kit first, then Iconify's web index).
  const label = st.kit === "ph" ? "Phosphor" : st.kit[0].toUpperCase() + st.kit.slice(1);
  step(`Searching ${label} for ${beats.reduce((a, b) => a + b.ideas.length, 0)} icons`);
  const specs: Record<string, IconSpec> = {};
  let found: (string | null)[][] = [];
  try {
    const all = [...new Set(beats.flatMap((b) => b.ideas))].slice(0, 60);
    const r = await fetch("/api/icons/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ideas: all, kit: st.kit }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.status);
    const byIdea = new Map<string, string>();
    for (const x of j.icons ?? []) {
      const spec = cleanIcon(x.spec);
      if (spec && x.name) (specs[x.name] = spec), byIdea.set(x.query, x.name);
    }
    found = beats.map((b) => b.ideas.map((i) => byIdea.get(i) ?? null));
  } catch (e: any) {
    notes.push(`icon search unavailable (${e.message}), used built-in icons`);
  }
  const used = new Set<string>();
  const icons = beats.map((b, i) => b.ideas.map((idea, k) => {
    const n = found[i]?.[k] ?? builtinIcon(idea, used) ?? null;
    if (n) used.add(n);
    return n;
  }));
  step("Animating");
  const n = Object.keys(specs).length;
  if (n) notes.push(`${n} ${label} icons`);
  if (searched) notes.push(`Claude researched the product (${searched} web search${searched > 1 ? "es" : ""})`);
  return { scenes: motionScenes(beats, icons, st, brief), icons: specs };
}

export interface CreateInput {
  format: Format;
  brief: Partial<Brief>;
  aspect: Aspect;
  keepBrand: boolean;
  /** a new voice-over file (uploaded or generated); `dropVoice` removes the project's */
  voiceFile?: File;
  /** a voice-over already listened to (words and insight), used as is */
  voiceTrack?: AudioTrack;
  dropVoice?: boolean;
  musicFile?: File;
  /** a music track already analysed */
  musicTrack?: MusicTrack;
  dropMusic?: boolean;
  /** fill shots the library can't with stock footage */
  useStock: boolean;
  withClaude: boolean;
  /** one background for every scene, or "auto" for each format's own */
  background?: Scene["background"] | "auto";
  onStep?: (label: string) => void;
}

const IMAGE_FIELDS = (s: Scene) => [s.image, ...(s.images ?? []), ...(s.backdrop ?? [])];

/** Make the format; resolves with a one-line summary. */
export async function createFormat(input: CreateInput): Promise<string> {
  const step = input.onStep ?? (() => {});
  const f = input.format;
  const brief = fill(input.brief);
  const notes: string[] = [];

  // 1. Sound.
  if (input.dropVoice) setAudio(undefined);
  if (input.voiceTrack) setAudio(input.voiceTrack);
  else if (input.voiceFile) {
    step("Listening to the voice-over");
    await ingestVoiceover(input.voiceFile);
  }
  let music: MusicTrack | undefined = input.dropMusic ? undefined : input.musicTrack ?? getState().project.music;
  if (!input.musicTrack && (input.musicFile || music)) {
    step("Finding the beat");
    try {
      music = await loadMusic(input.musicFile ?? music!);
    } catch (e: any) {
      notes.push(e.message);
      music = undefined;
    }
  }
  const audio = getState().project.audio;

  // 2. Pictures: the library first; stock placeholders for the rest (cast below).
  const lib = f.section === "text" ? [] : pickImages(getState().assets).filter((id) => getState().assets.find((a) => a.id === id)?.kind !== "logo");
  const images = f.section === "text" ? [] : [...lib, ...(input.useStock ? Array.from({ length: 16 }, (_, i) => stockRef(i)) : [])];

  // 3. The draft: around the voice-over, or on the format's own timing.
  step(audio ? "Cutting to the voice-over" : "Building the draft");
  let scenes: Omit<Scene, "id">[];
  let captions = false;
  let icons: Record<string, IconSpec> | undefined;
  if (f.section === "mograph" && f.motion) ({ scenes, icons } = await motionEdit(f, brief, audio, input.withClaude, step, notes));
  else if (audio) ({ scenes, captions } = buildWithVoice(f, brief, { duration: audio.duration, pauses: audio.pauses, words: audio.words, insight: audio.insight }, images));
  else scenes = buildFormat(f, brief, images);
  let title = `${brief.product} · ${f.name}`;

  // 4. Claude's pass (copy and choices; the timing stays when there's a voice-over).
  if (input.withClaude && f.section !== "footage" && f.section !== "mograph") {
    step("Claude is writing");
    try {
      const r = await fetch("/api/format", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: { name: f.name, hook: f.hook, beats: f.beats + (audio ? " (Timed to a voice-over: keep the number of scenes, their order and durations; headlines should echo what is said.)" : ""), aspect: input.aspect }, brief, draft: scenes }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.scenes) && j.scenes.length >= 3) {
        const next = j.scenes as Omit<Scene, "id">[];
        // With a voice-over the cut is fixed: take Claude's copy and effects, keep our durations.
        scenes = audio && next.length === scenes.length ? next.map((s, i) => ({ ...s, duration: scenes[i].duration })) : audio ? scenes : next;
        if (j.title) title = j.title;
      } else notes.push(`Claude unavailable (${String(j.error ?? r.status).replace(/\.$/, "")}), used the studio's draft`);
    } catch (e: any) {
      notes.push(`couldn't reach Claude (${e.message})`);
    }
  }

  // The chosen background on every scene (scenes over footage still show their footage).
  if (input.background && input.background !== "auto") scenes = withBackground(scenes, input.background);

  // 5. Music: start on a bar; without a voice-over the cuts land on its beats.
  let musicStart: number | undefined;
  if (music) {
    const total = scenes.reduce((a, s) => a + s.duration, 0);
    const win = musicWindow({ duration: music.duration ?? 0, bpm: music.bpm, beats: music.beats, downbeats: music.downbeats, energy: music.energy, drop: music.drop }, total, 0.35);
    musicStart = win.start;
    // With a voice-over, the music's drop lands where the product is revealed.
    if (audio && music.drop !== undefined) {
      const k = scenes.findIndex((x) => x.template === "logo-reveal" || ((x.template === "spotlight" || x.template === "text-mask" || x.template === "product-hero") && (x.headline ?? "").toLowerCase().includes(brief.product.toLowerCase())));
      const at = k > 0 ? scenes.slice(0, k).reduce((a, x) => a + x.duration, 0) : -1;
      if (at > 0 && music.drop - at >= 0) {
        musicStart = +(music.drop - at).toFixed(3);
        notes.push(`the music's drop lands on the reveal at ${at.toFixed(1)}s`);
      }
    }
    if (!audio && music.beats?.length && f.section !== "mograph") scenes = snapToBeats(scenes, beatsInCut({ ...music, start: musicStart }, total + 1));
  }

  applyStoryboard({ title, aspect: input.aspect, ...(input.keepBrand ? {} : { style: f.style }), fit_to_voiceover: false, scenes: scenes as never });
  const ids = getState().project.scenes.map((s) => s.id);
  setState((st) => ({
    project: {
      ...st.project,
      captions,
      ...(icons && { icons: { ...st.project.icons, ...icons } }),
      brand: input.keepBrand ? st.project.brand : { ...st.project.brand, name: brief.product },
      // The mix from the analysis: music about 12 dB under the voice, dipping more under a slow read.
      music: music
        ? {
            ...music,
            start: musicStart ?? 0,
            volume: audio ? (audio.insight?.rms && music.insight?.rms ? mixLevel(audio.insight.rms, music.insight.rms) : Math.min(music.volume, 0.35)) : Math.max(music.volume, 0.8),
            duck: audio ? (audio.insight?.pace === "fast" || audio.insight?.pace === "brisk" ? 0.55 : 0.7) : 0,
          }
        : undefined,
    },
  }));
  clock.seek(0);

  // 6. Stock footage for the placeholders, a few at a time; each scene fills in as it lands.
  const stockScenes = getState().project.scenes.map((s, i) => ({ s, i })).filter(({ s }) => IMAGE_FIELDS(s).some(isStockRef));
  if (stockScenes.length) {
    const used = new Set<string>();
    const look = f.look ?? (f.style === "noir" ? "cinematic" : "commercial");
    const briefText = `${brief.product}, ${brief.what}, for ${brief.audience}`;
    let done = 0, found = 0;
    const work = [...stockScenes];
    const worker = async () => {
      for (let job = work.shift(); job; job = work.shift()) {
        const { s, i } = job;
        const type = (s.shot?.type as ShotType) ?? (s.template === "product-hero" || s.template === "spotlight" ? "product" : "medium");
        const line = [s.headline, s.subline, s.kicker].filter(Boolean).join(" ").replace(/\*/g, "") || brief.what;
        const shot: Shot = { s: 0, e: s.duration, line, type, queries: [...new Set([...(s.shot?.query ? [s.shot.query] : []), ...queriesFor(line, briefText, type, brief.product)])].slice(0, 4), overlay: "" };
        const c = await castOne(shot, input.aspect, look, used).catch(() => ({ pick: undefined }));
        done++;
        step(`Casting footage · ${done} of ${stockScenes.length}`);
        const p = getState().project;
        if (p.scenes.length !== ids.length || p.scenes.some((x, k) => x.id !== ids[k])) return; // the user moved on
        const id = c.pick ? libraryId(preferLicensed(c.pick, getState().assets)) : undefined;
        if (id) found++;
        const swap = (r?: string) => (isStockRef(r) ? id : r);
        const timing = c.pick && s.template !== "cta-end" ? timingFor(c.pick, shot, look) : {};
        setState({
          project: {
            ...p,
            scenes: p.scenes.map((x, k) =>
              k !== i
                ? x
                : sanitizeScene(
                    {
                      ...x,
                      image: swap(x.image),
                      images: x.images?.map(swap).filter(Boolean),
                      backdrop: x.backdrop?.map(swap).filter(Boolean),
                      ...timing,
                      shot: { type, query: shot.queries[0] ?? line },
                      // Nothing found: an image-led beat becomes type rather than a blank frame.
                      ...(!id && (x.template === "fullbleed" || x.template === "product-hero" || x.template === "spotlight" || x.template === "device-mockup") && { template: "kinetic-words", headline: x.headline || brief.what, background: "gradient" }),
                    },
                    x.id,
                  ),
            ),
          },
        });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    notes.unshift(`${found} of ${stockScenes.length} shots cast with stock footage`);
  }
  const p = getState().project;
  return `${f.name}: ${p.scenes.length} scenes, ${p.scenes.reduce((a, s) => a + s.duration, 0).toFixed(1)}s${audio ? ", cut to the voice-over" : music ? ", cut on the beat" : ""}${notes.length ? `; ${notes.join("; ")}` : ""}.`;
}

/** A voice-over from a script, as a file the studio takes in like an upload. */
export async function generateVoice(text: string, voice: string, tone: string): Promise<File> {
  const r = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice, tone }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Voice service error ${r.status}`);
  const blob = await r.blob();
  return new File([blob], `voice-${voice}.mp3`, { type: "audio/mpeg" });
}

/** Claude's script for a format, or null (the caller keeps the studio's own). */
export async function writeScript(f: Format, brief: Partial<Brief>, seconds = 20): Promise<{ script?: string; error?: string }> {
  try {
    const r = await fetch("/api/script", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: { name: f.name, hook: f.hook, beats: f.beats, section: f.section }, brief: fill(brief), seconds }) });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.script ? { script: j.script } : { error: j.error ?? `error ${r.status}` };
  } catch (e: any) {
    return { error: e.message };
  }
}

/** Leave the current audio alone but make sure music is cleared when asked. */
export const clearMusic = () => updateProject((p) => ({ ...p, music: undefined }));

/** Give every scene one background; the end card keeps its accent if it had one. */
export function withBackground<S extends { background?: Scene["background"]; template: Scene["template"] }>(scenes: S[], bg: Scene["background"]): S[] {
  return scenes.map((s) => (s.background === "accent" && s.template !== "cta-end" ? s : { ...s, background: bg }));
}
