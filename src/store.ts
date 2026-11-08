import { useSyncExternalStore } from "react";
import type { Asset, AudioTrack, Brand, BrandKit, ChatMessage, PatchOp, Project, Scene, StoryboardInput } from "./types";
import { kitFromProject, applyKitTo, sanitizeKit, findKit } from "./kits";
import { cleanMusic } from "./audio/mix";
import { TEMPLATES, TRANSITIONS, BACKGROUNDS } from "./types";
import { presetById } from "./presets";
import { uid, clamp } from "./engine/util";
import { sanitizeScene, sanitizeProject } from "./sanitize";
import { buildScenes, patchScenes, brandWithStyle } from "./storyboard";
import * as db from "./persist";
import type { ProjectMeta, Version } from "./persist";
import { STARTERS } from "./starters";
import { posterFor } from "./components/thumbs";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
}

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
  /** dashboard list of every project */
  projects: ProjectMeta[];
  /** saved brand kits, shared by every project */
  kits: BrandKit[];
  /** what the app shows */
  view: "home" | "studio" | "admin";
  /** an open sheet over the studio */
  sheet?: "sound" | "footage" | "formats";
  health?: { agent: "claude" | "hosted" | "local"; claude?: { state: string }; voice?: boolean; transcription: string; connectors: { id: string; label: string; configured: boolean; kind: string; note: string }[]; accounts?: boolean };
  /** Accounts (server with a database): who is signed in. "off" when the server has no accounts. */
  auth: { status: "checking" | "signed_out" | "signed_in" | "off"; user?: AuthUser; usage?: { today: number; limit: number | null } };
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
  projects: [],
  kits: [],
  auth: { status: "checking" },
  view: "studio",
};

/** Turn a stored record into a clean, playable project (restoring voice-over and music files). */
function revive(raw: any, audio?: Blob, music?: Blob): Project {
  const project = sanitizeProject(raw, defaultProject());
  if (typeof raw?.id === "string" && raw.id) project.id = raw.id.slice(0, 40);
  if (audio && raw?.audio && typeof raw.audio.duration === "number") project.audio = { ...raw.audio, url: URL.createObjectURL(audio) };
  if (music && raw?.music) project.music = cleanMusic(raw.music, URL.createObjectURL(music));
  db.markRestored(project.id, project.audio?.url, project.music?.url);
  return project;
}

/**
 * Restore the workspace before the first render: the project list, the shared asset library,
 * and the last open project with its chat and media. Never throws; a damaged project falls back
 * to the demo. A first visit seeds the library with the demo project.
 */
export async function hydrate() {
  const ws = await db.loadWorkspace().catch(() => ({ projects: [], assets: [], durable: false, currentId: undefined }) as db.Workspace);
  const patch: Partial<StudioState> = { projects: ws.projects, assets: ws.assets };
  patch.kits = (await db.loadKits().catch(() => [])).map(sanitizeKit).filter((k): k is BrandKit => !!k);
  if (ws.currentId) {
    const rec = await db.loadProject(ws.currentId).catch(() => ({ chat: [] as ChatMessage[] }) as Awaited<ReturnType<typeof db.loadProject>>);
    if (rec.project && Array.isArray(rec.project.scenes)) {
      patch.project = revive({ ...rec.project, id: ws.currentId }, rec.audio, rec.music);
      patch.chat = rec.chat;
    }
  }
  state = { ...state, ...patch };
  if (!ws.projects.length) scheduleSave(); // first visit: put the demo into the library
  db.requestPersistence();
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
let lastLibrary: Asset[] | null = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 500);
}
/** Save the open project (with a fresh dashboard thumbnail) and, if it changed, the shared library. */
export async function flushSave() {
  clearTimeout(saveTimer);
  const { project, chat, assets } = state;
  let thumb: string | undefined;
  try {
    thumb = posterFor(project);
  } catch {}
  try {
    await db.saveProject(project, chat, thumb);
    if (assets !== lastLibrary) {
      await db.saveLibrary(assets);
      lastLibrary = assets;
    }
    const projects = await db.listProjects();
    if (projects.length) setStateQuiet({ projects });
    if (saveFailed) setState({ notice: "Saving works again." });
    saveFailed = false;
  } catch {
    if (!saveFailed) setState({ notice: "Couldn't save your project: this browser's storage is full or blocked. Save a copy from Export → Save project." });
    saveFailed = true;
  }
}
/** Update state without scheduling another save (used for the project list itself). */
function setStateQuiet(p: Partial<StudioState>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------- projects
function resetHistory() {
  past.length = 0;
  future.length = 0;
}

/** Open a project from the library (saving the current one first). */
export async function openProject(id: string) {
  if (id === state.project.id) return setState({ view: "studio" });
  await flushSave();
  const rec = await db.loadProject(id);
  if (!rec.project) {
    setState({ notice: "That project couldn't be opened. It may have been deleted in another tab." });
    return;
  }
  resetHistory();
  setStateQuiet({ project: revive({ ...rec.project, id }, rec.audio, rec.music), chat: rec.chat, selected: 0, conversationId: uid("c"), view: "studio" });
  await db.setCurrent(id);
}

/** Create a project from a starter kit and open it. */
export async function createProject(starterId = "blank") {
  await flushSave();
  const starter = STARTERS.find((s) => s.id === starterId) ?? STARTERS[STARTERS.length - 1];
  const starter_ = starter.build();
  // A default brand kit dresses every new project.
  const kit = state.kits.find((k) => k.isDefault);
  const project = kit ? applyKitTo(starter_, kit, new Set(state.assets.map((a) => a.id))) : starter_;
  resetHistory();
  setStateQuiet({ project, chat: [], selected: 0, conversationId: uid("c"), view: "studio" });
  await flushSave();
}

/** Import a project file (e.g. from Export → Save project) as a new project in the library, and open it. */
export async function importProject(data: unknown) {
  await flushSave();
  const project = sanitizeProject(data, defaultProject());
  project.id = uid("p");
  resetHistory();
  setStateQuiet({ project, chat: [], selected: 0, conversationId: uid("c"), view: "studio" });
  await flushSave();
}

export async function duplicateProject(id: string) {
  await flushSave();
  const src = state.projects.find((p) => p.id === id);
  await db.duplicateProjectRecord(id, uid("p"), `${src?.title ?? "Project"} copy`);
  setStateQuiet({ projects: await db.listProjects() });
}

export async function renameProject(id: string, title: string) {
  const t = title.trim().slice(0, 120) || "Untitled";
  if (id === state.project.id) setState({ project: { ...state.project, title: t } });
  else {
    await db.renameProjectRecord(id, t);
    setStateQuiet({ projects: await db.listProjects() });
  }
}

/** Delete a project. Deleting the open one opens the next most recent (or a fresh blank). */
export async function deleteProject(id: string) {
  clearTimeout(saveTimer);
  await db.deleteProjectRecord(id);
  const projects = await db.listProjects();
  setStateQuiet({ projects });
  if (id === state.project.id) {
    if (projects[0]) {
      const rec = await db.loadProject(projects[0].id);
      resetHistory();
      setStateQuiet({ project: revive({ ...rec.project, id: projects[0].id }, rec.audio, rec.music), chat: rec.chat, selected: 0, conversationId: uid("c") });
      await db.setCurrent(projects[0].id);
    } else {
      resetHistory();
      setStateQuiet({ project: STARTERS[STARTERS.length - 1].build(), chat: [], selected: 0, conversationId: uid("c") });
      await flushSave();
    }
  }
}

// ---------------------------------------------------------------- versions
export const listVersions = () => db.listVersions(state.project.id);

export async function saveVersion(name?: string): Promise<Version> {
  const { audio, music, ...rest } = state.project;
  const v: Version = { id: uid("v"), name: (name ?? "").trim().slice(0, 80) || new Date().toLocaleString(), createdAt: Date.now(), project: rest };
  await db.addVersion(state.project.id, v);
  return v;
}

/** Restore a version into the open project (undoable; keeps the voice-over and music). */
export function restoreVersion(v: Version) {
  const cur = state.project;
  const restored = sanitizeProject(v.project, cur);
  updateProject(() => ({ ...restored, id: cur.id, audio: cur.audio, music: cur.music }));
  setState({ selected: 0 });
}

export const deleteVersion = (versionId: string) => db.deleteVersion(state.project.id, versionId);

/** Listen to every state change outside React (returns an unsubscribe). */
export function subscribeStore(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
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

let builds = 0;
/** How many storyboards have been applied this session (lets the agent client tell a turn built one). */
export const buildCount = () => builds;

export function applyStoryboard(sb: StoryboardInput) {
  builds++;
  updateProject((p) => {
    let next: Project = { ...p, title: sb.title ?? p.title, aspect: sb.aspect ?? p.aspect };
    if (sb.style) next = withStyle(next, sb.style);
    return { ...next, scenes: buildScenes(sb, presetById(next.style).defaultBackground, p.audio) };
  });
  setState({ selected: 0, time: 0 });
}

/** Insert a scene after the selected one (or first, in an empty project) and select it. */
export function addScene(partial: Partial<Scene> = {}): number {
  const at = state.project.scenes.length ? Math.min(state.selected + 1, state.project.scenes.length) : 0;
  const s = normalizeScene({ template: "title-reveal", duration: 3.5, kicker: "Introducing", headline: "Your *headline*", transition: at ? "fade" : "cut", ...partial });
  updateProject((p) => ({ ...p, scenes: [...p.scenes.slice(0, at), s, ...p.scenes.slice(at)] }));
  setState({ selected: at });
  return at;
}

/** Add banners to a scene's backdrop (they crossfade behind its text). */
export function addBackdrop(index: number, refs: string[]) {
  updateProject((p) => ({
    ...p,
    scenes: p.scenes.map((s, i) => {
      if (i !== index) return s;
      const backdrop = [...new Set([...(s.backdrop ?? []), ...refs])].slice(0, 8);
      // Give every banner at least ~1.6 s on screen.
      return editedScene({ ...s, backdrop, duration: +Math.max(s.duration, Math.min(15, backdrop.length * 1.6)).toFixed(1) });
    }),
  }));
}

/** One banner per scene, in order, over the scenes that show text (wraps when there are fewer banners). */
export function spreadBackdrops(refs: string[]) {
  if (!refs.length) return 0;
  const TEXTY = new Set(["title-reveal", "kinetic-words", "quote", "marquee", "feature-list", "stat-counter", "cta-end", "countdown", "testimonials", "price-card", "logo-reveal", "shape-burst"]);
  let k = 0;
  updateProject((p) => ({ ...p, scenes: p.scenes.map((s) => (TEXTY.has(s.template) ? editedScene({ ...s, backdrop: [refs[k++ % refs.length]] }) : s)) }));
  return k;
}

export function applyPatch(ops: PatchOp[]) {
  updateProject((p) => ({ ...p, scenes: patchScenes(p.scenes, ops) }));
}

export function withStyle(p: Project, styleId: string): Project {
  const pr = presetById(styleId);
  return { ...p, style: pr.id, brand: brandWithStyle(p.brand, styleId) };
}

// ---------------------------------------------------------------- brand kits
const storeKits = (kits: BrandKit[]) => {
  setStateQuiet({ kits });
  db.saveKits(kits).catch(() => setState({ notice: "Couldn't save brand kits in this browser." }));
};

/** Save the current look as a new kit, or over an existing one (by id). */
export function saveKit(name: string, overId?: string): BrandKit {
  const prev = state.kits.find((k) => k.id === overId);
  const kit = { ...kitFromProject(state.project, name || prev?.name || "", prev?.id), ...(prev?.isDefault && { isDefault: true }) };
  storeKits(prev ? state.kits.map((k) => (k.id === prev.id ? kit : k)) : [...state.kits, kit]);
  return kit;
}

/** Dress the open project in a kit (undoable like any brand edit). */
export function applyKit(idOrName: string): BrandKit | undefined {
  const kit = state.kits.find((k) => k.id === idOrName) ?? findKit(state.kits, idOrName);
  if (!kit) return;
  const ids = new Set(state.assets.map((a) => a.id));
  updateProject((p) => applyKitTo(p, kit, ids));
  return kit;
}

export const renameKit = (id: string, name: string) => storeKits(state.kits.map((k) => (k.id === id && name.trim() ? { ...k, name: name.trim().slice(0, 40), updatedAt: Date.now() } : k)));
export const deleteKit = (id: string) => storeKits(state.kits.filter((k) => k.id !== id));
/** Make a kit the default for new projects (or clear the default with null). */
export function setDefaultKit(id: string | null) {
  storeKits(
    state.kits.map((k) => {
      const { isDefault: _was, ...rest } = k;
      return k.id === id ? { ...rest, isDefault: true } : rest;
    }),
  );
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

/** Add to the library (a file already there by its source is skipped; see `libraryId`). */
export function addAssets(list: Asset[]) {
  setState((s) => {
    const seen = new Set(s.assets.map((a) => a.src));
    return { assets: [...s.assets, ...list.filter((a) => !seen.has(a.src))] };
  });
}

/** Add an asset if new, and return the id the library knows it by (an existing copy's id when the file is already there). */
export function libraryId(a: Asset): string {
  const have = state.assets.find((x) => x.src === a.src);
  if (have) return have.id;
  addAssets([a]);
  return a.id;
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

// ---------------------------------------------------------------- direct editing
const IMAGE_SLOT = new Set(["product-hero", "split-feature", "fullbleed", "logo-sting", "device-mockup", "logo-reveal", "audiogram", "text-mask", "notification", "pov-caption", "spotlight"]);

/** Put an image into a scene: its image slot, a mosaic tile, or (for text-only scenes) a soft image backdrop. */
export function assignImage(index: number, assetId: string) {
  updateProject((p) => ({
    ...p,
    scenes: p.scenes.map((s, i) => {
      if (i !== index) return s;
      if (s.template === "image-mosaic") return { ...s, images: [...(s.images ?? []).filter((x) => x !== assetId), assetId].slice(-6) };
      if (s.template === "before-after") {
        // fill "before" first, then "after"; a third drop replaces "after"
        const cur = (s.images ?? []).filter((x) => x !== assetId);
        return { ...s, images: cur.length < 2 ? [...cur, assetId] : [cur[0], assetId] };
      }
      if (IMAGE_SLOT.has(s.template)) return { ...s, image: assetId, focus: undefined, zoom: undefined };
      return { ...s, image: assetId, background: "image" as const };
    }),
  }));
  setState({ selected: index });
}

/** Read an editable field ("headline", "items.2", "stat.value", …) from a scene as text. */
export function readField(s: Scene, field: string): string {
  if (field.startsWith("items.")) return s.items?.[Number(field.slice(6))] ?? "";
  if (field === "stat.value") return s.stat ? String(s.stat.value) : "";
  if (field === "stat.label") return s.stat?.label ?? "";
  const v = (s as unknown as Record<string, unknown>)[field];
  return typeof v === "string" ? v : "";
}

/** Write an edited field back into a scene (undoable). Returns false if the value was rejected. */
export function writeField(index: number, field: string, value: string): boolean {
  const s = state.project.scenes[index];
  if (!s) return false;
  let next: Scene = { ...s };
  const v = value.replace(/\s+$/g, "");
  if (field.startsWith("items.")) {
    const k = Number(field.slice(6));
    const items = [...(s.items ?? [])];
    if (v.trim()) items[k] = v.trim();
    else items.splice(k, 1);
    next.items = items;
  } else if (field === "stat.value") {
    const n = parseFloat(v.replace(/[^0-9.\-]/g, ""));
    if (!Number.isFinite(n)) return false;
    next.stat = { ...(s.stat ?? { value: 0 }), value: n };
  } else if (field === "stat.label") {
    next.stat = { ...(s.stat ?? { value: 0 }), label: v.trim() || undefined };
  } else if (["headline", "subline", "kicker", "cta", "url", "author"].includes(field)) {
    (next as unknown as Record<string, unknown>)[field] = v.trim() || undefined;
  } else return false;
  if (readField(next, field) === readField(s, field) && field !== "stat.value") return true;
  updateProject((p) => ({ ...p, scenes: p.scenes.map((x, i) => (i === index ? editedScene(next) : x)) }));
  return true;
}
