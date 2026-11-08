// Applying a sound template in the studio: take in the voice-over and music, map the beats,
// build the cut and drop it into the open project (one undo step).
import type { Asset, MusicTrack, Project } from "./types";
import { getState, setState, updateProject, withStyle, setAudio } from "./store";
import { sanitizeScene } from "./sanitize";
import { cleanMusic } from "./audio/mix";
import { analyzeMusicFile } from "./audio/beats";
import { buildSound, type Copy, type SoundBuild, type SoundTemplate } from "./soundTemplates";
import { ingestVoiceover } from "./components/VoicePanel";
import { clock } from "./clock";

const COPY_KEY = "hookky.soundCopy";

/** The copy the user typed last time (per browser), else what the project already says. */
export function initialCopy(p: Project): Copy {
  let saved: Partial<Copy> = {};
  try {
    saved = JSON.parse(localStorage.getItem(COPY_KEY) || "{}");
  } catch {
    /* private mode */
  }
  const scenes = p.scenes;
  const cta = scenes.find((s) => s.cta);
  const firstLine = scenes.find((s) => s.headline)?.headline?.replace(/\*/g, "");
  return {
    brand: p.brand.name || saved.brand || "",
    line: saved.line || firstLine || "",
    points: saved.points ?? [],
    cta: cta?.cta || saved.cta || "",
    url: cta?.url || saved.url || "",
  };
}
export function rememberCopy(c: Copy) {
  try {
    localStorage.setItem(COPY_KEY, JSON.stringify(c));
  } catch {
    /* private mode */
  }
}

/** Images and clips to cut with, newest uploads first; logos last. */
export function pickImages(assets: Asset[]): string[] {
  const media = assets.filter((a) => a.kind === "image" || a.kind === "video");
  const uploads = media.filter((a) => a.source === "upload" || a.source === "Upload");
  const rest = media.filter((a) => !uploads.includes(a));
  return [...uploads.reverse(), ...rest.reverse(), ...assets.filter((a) => a.kind === "logo")].map((a) => a.id).slice(0, 12);
}

/** Read a music file (or the project's current track) into a MusicTrack with its beat map. */
export async function loadMusic(src: File | MusicTrack): Promise<MusicTrack> {
  if (src instanceof File) {
    const url = URL.createObjectURL(src);
    try {
      const { duration, map } = await analyzeMusicFile(src);
      return cleanMusic({ name: src.name, duration, ...map }, url);
    } catch (e) {
      URL.revokeObjectURL(url);
      throw new Error(`${src.name} can't be played in this browser. Try MP3, M4A or WAV.`);
    }
  }
  if (src.beats?.length) return src;
  const blob = await fetch(src.url).then((r) => r.blob());
  const { duration, map } = await analyzeMusicFile(blob);
  return cleanMusic({ ...src, duration: src.duration ?? duration, ...map }, src.url);
}

export interface ApplyInput {
  template: SoundTemplate;
  voiceFile?: File;
  musicFile?: File;
  /** drop the project's current voice-over / music */
  dropVoice?: boolean;
  dropMusic?: boolean;
  copy: Copy;
  length: number;
  aspect: Project["aspect"];
  /** keep the brand's colours and fonts instead of the template's look */
  keepBrand: boolean;
  onStep?: (label: string) => void;
}

/** Build the cut into the open project. Resolves with what was built. */
export async function applySoundTemplate(input: ApplyInput): Promise<SoundBuild> {
  const step = input.onStep ?? (() => {});
  rememberCopy(input.copy);
  if (input.dropVoice) setAudio(undefined);
  if (input.voiceFile) {
    step("Listening to the voice-over");
    await ingestVoiceover(input.voiceFile);
  }
  let music = input.dropMusic ? undefined : getState().project.music;
  if (input.musicFile || music) {
    step("Finding the beat");
    const prev = music;
    music = await loadMusic(input.musicFile ?? music!);
    // A replaced track keeps its mix settings; its old file can go.
    if (input.musicFile && prev) music = { ...music, volume: prev.volume };
  }
  step("Cutting to the sound");
  const audio = getState().project.audio;
  const build = buildSound(input.template, {
    voice: audio && { duration: audio.duration, pauses: audio.pauses, words: audio.words },
    music: music && { duration: music.duration ?? 0, bpm: music.bpm, beats: music.beats, downbeats: music.downbeats, energy: music.energy, drop: music.drop },
    copy: input.copy,
    images: pickImages(getState().assets),
    length: input.length,
  });
  updateProject((p) => {
    const looked = input.keepBrand ? p : withStyle(p, build.style);
    const untitled = !p.title || /^untitled/i.test(p.title);
    return {
      ...looked,
      title: untitled ? build.title : p.title,
      aspect: input.aspect,
      captions: build.captions,
      grain: build.grain,
      scenes: build.scenes.map((s) => sanitizeScene(s)),
      music: music ? { ...music, ...(build.music ?? {}) } : undefined,
      brand: { ...looked.brand, name: input.copy.brand || looked.brand.name },
    };
  });
  setState({ selected: 0, sheet: undefined });
  clock.seek(0);
  return build;
}
