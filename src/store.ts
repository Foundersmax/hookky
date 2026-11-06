import { useSyncExternalStore } from "react";
import type { Asset, AudioTrack, Brand, ChatMessage, PatchOp, Project, Scene, StoryboardInput } from "./types";
import { TEMPLATES, TRANSITIONS, BACKGROUNDS } from "./types";
import { presetById } from "./presets";
import { uid, clamp } from "./engine/util";

export interface StudioState {
  project: Project;
  assets: Asset[];
  chat: ChatMessage[];
  selected: number;
  time: number;
  playing: boolean;
  conversationId: string;
  busy: boolean;
  health?: { agent: "claude" | "local"; transcription: string; connectors: { id: string; label: string; configured: boolean; kind: string; note: string }[] };
}

const STORAGE_KEY = "motif.studio.v1";

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
      { id: uid(), template: "title-reveal", duration: 3.2, kicker: "Introducing", headline: "Motion, *made simple.*", subline: "Describe your product. Drop a voice-over. Watch it move.", background: "dots", transition: "circle" },
      { id: uid(), template: "feature-list", duration: 3.6, kicker: "How it works", headline: "Three steps", items: ["Chat your *brief*", "Pull references from anywhere", "Sync to your *voice-over*"], background: "solid", transition: "push-up" },
      { id: uid(), template: "stat-counter", duration: 2.8, kicker: "Render time", stat: { value: 60, suffix: "s", label: "From idea to animated ad" }, background: "invert", transition: "wipe" },
      { id: uid(), template: "cta-end", duration: 3.4, headline: "Start *creating*", cta: "Open the studio", url: "motif.studio", background: "blobs", transition: "zoom" },
    ],
  };
}

function load(): Partial<StudioState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const s = JSON.parse(raw);
    if (s.project?.audio) delete s.project.audio; // blob URLs don't survive reloads
    return { project: s.project, assets: (s.assets ?? []).filter((a: Asset) => !a.src.startsWith("blob:")), chat: s.chat ?? [] };
  } catch {
    return {};
  }
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
  ...load(),
};

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
  if (p.project || p.assets || p.chat) {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ project: state.project, assets: state.assets.slice(-200), chat: state.chat.slice(-60).map((m) => ({ ...m, pending: false })) }));
      } catch {
        /* storage full or blocked — non-fatal */
      }
    }, 400);
  }
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

export function normalizeScene(s: Partial<Scene>, keepId?: string): Scene {
  return {
    ...s,
    id: keepId ?? s.id ?? uid(),
    template: (TEMPLATES as readonly string[]).includes(s.template as string) ? (s.template as Scene["template"]) : "title-reveal",
    duration: clamp(Number(s.duration) || 3, 0.8, 15),
    transition: (TRANSITIONS as readonly string[]).includes(s.transition as string) ? s.transition : "fade",
    background: (BACKGROUNDS as readonly string[]).includes(s.background as string) ? s.background : undefined,
  };
}

export function applyStoryboard(sb: StoryboardInput) {
  updateProject((p) => {
    let next: Project = { ...p, title: sb.title ?? p.title, aspect: sb.aspect ?? p.aspect };
    if (sb.style) next = withStyle(next, sb.style);
    const def = presetById(next.style).defaultBackground;
    let scenes = sb.scenes.map((s) => normalizeScene({ background: def, ...s }));
    if (scenes[0]) scenes[0].transition = "cut";
    if (p.audio && sb.fit_to_voiceover !== false) scenes = fitToVoiceover(scenes, p.audio);
    return { ...next, scenes };
  });
  setState({ selected: 0, time: 0 });
}

export function applyPatch(ops: PatchOp[]) {
  updateProject((p) => {
    const scenes = [...p.scenes];
    for (const o of ops) {
      const i = clamp(Math.round(o.index), 0, Math.max(0, scenes.length - (o.op === "insert" ? 0 : 1)));
      if (o.op === "update" && scenes[i]) scenes[i] = normalizeScene({ ...scenes[i], ...o.scene }, scenes[i].id);
      else if (o.op === "insert") scenes.splice(i, 0, normalizeScene(o.scene as Scene));
      else if (o.op === "delete" && scenes.length > 1) scenes.splice(i, 1);
      else if (o.op === "move" && scenes[i]) {
        const [s] = scenes.splice(i, 1);
        scenes.splice(clamp(o.to, 0, scenes.length), 0, s);
      }
    }
    return { ...p, scenes };
  });
}

export function withStyle(p: Project, styleId: string): Project {
  const pr = presetById(styleId);
  return { ...p, style: pr.id, brand: { ...p.brand, ...pr.brand, name: p.brand.name, logo: p.brand.logo } };
}

export function setBrand(b: Partial<Brand> & { style?: string }) {
  updateProject((p) => {
    let next = b.style ? withStyle(p, b.style) : p;
    const { style, ...rest } = b;
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== ""));
    return { ...next, brand: { ...next.brand, ...clean } };
  });
}

/** Scale scenes to the VO length, then snap each cut to the nearest natural pause. */
export function fitToVoiceover(scenes: Scene[], audio: AudioTrack): Scene[] {
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
