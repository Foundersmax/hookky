// Making a creative format in the studio: voice-over (uploaded or generated), music, the format
// built around them, Claude's rewrite when available, then stock footage cast for every shot the
// library can't fill. The scenes land at once and fill in as footage arrives; one undo step.
import type { Aspect, MusicTrack, Scene } from "./types";
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

export interface CreateInput {
  format: Format;
  brief: Partial<Brief>;
  aspect: Aspect;
  keepBrand: boolean;
  /** a new voice-over file (uploaded or generated); `dropVoice` removes the project's */
  voiceFile?: File;
  dropVoice?: boolean;
  musicFile?: File;
  dropMusic?: boolean;
  /** fill shots the library can't with stock footage */
  useStock: boolean;
  withClaude: boolean;
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
  if (input.voiceFile) {
    step("Listening to the voice-over");
    await ingestVoiceover(input.voiceFile);
  }
  let music: MusicTrack | undefined = input.dropMusic ? undefined : getState().project.music;
  if (input.musicFile || music) {
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
  if (audio) ({ scenes, captions } = buildWithVoice(f, brief, { duration: audio.duration, pauses: audio.pauses, words: audio.words }, images));
  else scenes = buildFormat(f, brief, images);
  let title = `${brief.product} · ${f.name}`;

  // 4. Claude's pass (copy and choices; the timing stays when there's a voice-over).
  if (input.withClaude && f.section !== "footage") {
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

  // 5. Music: start on a bar; without a voice-over the cuts land on its beats.
  let musicStart: number | undefined;
  if (music) {
    const total = scenes.reduce((a, s) => a + s.duration, 0);
    const win = musicWindow({ duration: music.duration ?? 0, bpm: music.bpm, beats: music.beats, downbeats: music.downbeats, energy: music.energy, drop: music.drop }, total, 0.35);
    musicStart = win.start;
    if (!audio && music.beats?.length) scenes = snapToBeats(scenes, beatsInCut({ ...music, start: musicStart }, total + 1));
  }

  applyStoryboard({ title, aspect: input.aspect, ...(input.keepBrand ? {} : { style: f.style }), fit_to_voiceover: false, scenes: scenes as never });
  const ids = getState().project.scenes.map((s) => s.id);
  setState((st) => ({
    project: {
      ...st.project,
      captions,
      brand: input.keepBrand ? st.project.brand : { ...st.project.brand, name: brief.product },
      music: music ? { ...music, start: musicStart ?? 0, volume: audio ? Math.min(music.volume, 0.35) : Math.max(music.volume, 0.8), duck: audio ? Math.max(music.duck ?? 0.6, 0.6) : 0 } : undefined,
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
