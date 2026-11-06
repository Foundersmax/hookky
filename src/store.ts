import { useSyncExternalStore } from "react";
import type { Asset, AudioTrack, Brand, ChatMessage, PatchOp, Project, Scene, StoryboardInput } from "./types";
import { TEMPLATES, TRANSITIONS, BACKGROUNDS } from "./types";
import { presetById } from "./presets";
import { uid, clamp } from "./engine/util";
import { sanitizeScene, sanitizeProject } from "./sanitize";
import { buildScenes, patchScenes, brandWithStyle } from "./storyboard";
import { loadSaved, save as saveStudio, markRestored, requestPersistence } from "./persist";

export interface StudioState {
  project: Project;
  assets: Asset[];
  chat: ChatMessage[];
  selected: number;
  time: number;
  playing: boolean;
  conversationId: string;
  busy: boolean;
  /** one-off message for the toast */
  notice?: string;
  health?: { agent: "claude" | "hosted" | "local"; transcription: string; connectors: { id: string; label: string; configured: boolean; kind: string; note: string }[] };
}


export function defaultProject(): Project {
  const preset = presetById("noir");
  return {
    id: uid("p"),
    title: "Untitled launch",
    aspect: "16:9",
    style: preset.id,
    brand: { name: "Lumen", ...preset.brand },
    captions: false,
    grain: true,
    scenes: [
      { id: uid(), template: "shape-burst", duration: 2.2, background: "dots", transition: "cut" },
      { id: uid(), template: "title-reveal", duration: 4.3, kicker: "Introducing", headline: "Motion, *made simple.*", subline: "Describe it. Add a voice-over. Watch it move.", background: "dots", transition: "circle" },
      { id: uid(), template: "feature-list", duration: 5, kicker: "How it works", headline: "Three steps", items: ["Chat your *brief*", "Pull references from anywhere", "Sync to your *voice-over*"], background: "solid", transition: "push-up" },
      { id: uid(), template: "stat-counter", duration: 2.8, kicker: "Render time", stat: { value: 60, suffix: "s", label: "From idea to animated ad" }, background: "invert", transition: "wipe" },
      { id: uid(), template: "cta-end", duration: 3.4, headline: "Start *creating*", cta: "Open the studio", url: "hookky.app", background: "blobs", transition: "zoom" },
    ],
  };
}

let state: StudioState = {
  project: defaultProject(),
  assets: [],
  chat: [],
  selected: 0,
  time: 0,
  playing: false,
  conversationId: uid("c"),
  busy: false,
};

/**
 * Restore the last session before the first render: project (cleaned), assets, chat, and the
 * voice-over / music files. Never throws; a damaged save falls back to the demo project.
 */
export async function hydrate() {
  const { saved, audioBlob, musicBlob } = await loadSaved().catch(() => ({ saved: {} as Record<string, any>, audioBlob: undefined, musicBlob: undefined }));
  const raw = (saved.project ?? null) as Record<string, any> | null;
  const patch: Partial<StudioState> = {};
  if (raw && Array.isArray(raw.scenes)) {
    const project = sanitizeProject(raw, defaultProject());
    if (audioBlob && raw.audio && typeof raw.audio.duration === "number") {
      project.audio = { ...raw.audio, url: URL.createObjectURL(audioBlob) };
    }
    if (musicBlob && raw.music) project.music = { name: String(raw.music.name ?? "music"), volume: Number(raw.music.volume) || 0.25, url: URL.createObjectURL(musicBlob) };
    patch.project = project;
    markRestored(project.audio?.url, project.music?.url);
  }
  if (Array.isArray(saved.assets)) patch.assets = (saved.assets as Asset[]).filter((a) => a && typeof a.src === "string" && !a.src.startsWith("blob:"));
  if (Array.isArray(saved.chat)) patch.chat = (saved.chat as ChatMessage[]).filter((m) => m && typeof m.text === "string");
  state = { ...state, ...patch };
  requestPersistence();
}

// ---------------------------------------------------------------- undo history (project only)
const past: Project[] = [];
const future: Project[] = [];

const listeners = new Set<() => void>();
let saveTimer: number | undefined;

export function getState() {
  return state;
}
export function setState(patch: Partial<StudioState> | ((s: StudioState) => Partial<StudioState>), opts: { history?: boolean } = {}) {
  const p = typeof patch === "function" ? patch(state) : patch;
  if (opts.history && p.project && p.project !== state.project) {
    past.push(state.project);
    if (past.length > 80) past.shift();
    future.length = 0;
  }
  state = { ...state, ...p };
  listeners.forEach((l) => l());
  if (p.project || p.assets || p.chat) scheduleSave();
}

let saveFailed = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveStudio(state.project, state.assets, state.chat).then(
      () => {
        if (saveFailed) setState({ notice: "Saving works again." });
        saveFailed = false;
      },
      () => {
        if (!saveFailed) setState({ notice: "Couldn't save your project: this browser's storage is full or blocked. Save a copy from Export → Save project." });
        saveFailed = true;
      },
    );
  }, 500);
}
export function useStudio<T>(sel: (s: StudioState) => T): T {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => sel(state),
  );
}
export function undo() {
  const prev = past.pop();
  if (!prev) return;
  future.push(state.project);
  setState({ project: prev });
}
export function redo() {
  const next = future.pop();
  if (!next) return;
  past.push(state.project);
  setState({ project: next });
}

// ---------------------------------------------------------------- project operations
export function updateProject(fn: (p: Project) => Project) {
  setState((s) => ({ project: fn(s.project) }), { history: true });
}

/** Strict clean for scenes from Claude, the local director, patches and files. */
export const normalizeScene = (s: Partial<Scene> | unknown, keepId?: string): Scene => sanitizeScene(s, keepId);

/** Light check for edits typed in the Scene panel: keeps spaces and blank lines while typing. */
export function editedScene(s: Scene): Scene {
  return {
    ...s,
    duration: clamp(Number(s.duration) || 3, 0.8, 15),
    template: (TEMPLATES as readonly string[]).includes(s.template) ? s.template : "title-reveal",
    transition: (TRANSITIONS as readonly string[]).includes(s.transition as string) ? s.transition : "fade",
    background: (BACKGROUNDS as readonly string[]).includes(s.background as string) ? s.background : undefined,
  };
}

export function applyStoryboard(sb: StoryboardInput) {
  updateProject((p) => {
    let next: Project = { ...p, title: sb.title ?? p.title, aspect: sb.aspect ?? p.aspect };
    if (sb.style) next = withStyle(next, sb.style);
    return { ...next, scenes: buildScenes(sb, presetById(next.style).defaultBackground, p.audio) };
  });
  setState({ selected: 0, time: 0 });
}

export function applyPatch(ops: PatchOp[]) {
  updateProject((p) => ({ ...p, scenes: patchScenes(p.scenes, ops) }));
}

export function withStyle(p: Project, styleId: string): Project {
  const pr = presetById(styleId);
  return { ...p, style: pr.id, brand: brandWithStyle(p.brand, styleId) };
}

export function setBrand(b: Partial<Brand> & { style?: string }) {
  updateProject((p) => {
    let next = b.style ? withStyle(p, b.style) : p;
    const { style, ...rest } = b;
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ""));
    return { ...next, brand: { ...next.brand, ...clean } };
  });
}

export { snapPoints, snapCutsToPauses, fitToVoiceover } from "./storyboard";

export function addAssets(list: Asset[]) {
  setState((s) => {
    const seen = new Set(s.assets.map((a) => a.src));
    return { assets: [...s.assets, ...list.filter((a) => !seen.has(a.src))] };
  });
}

export function setAudio(audio: AudioTrack | undefined) {
  setState((s) => ({ project: { ...s.project, audio } }));
}

export function pushChat(m: ChatMessage) {
  setState((s) => ({ chat: [...s.chat, m] }));
}
export function updateChat(id: string, fn: (m: ChatMessage) => ChatMessage) {
  setState((s) => ({ chat: s.chat.map((m) => (m.id === id ? fn(m) : m)) }));
}
