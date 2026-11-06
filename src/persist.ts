// Durable storage in IndexedDB for a library of projects.
//
//   kv "index"           ProjectMeta[]   (the dashboard list)
//   kv "current"         id of the project open in the studio
//   kv "library"         Asset[]         (shared by every project)
//   kv "project:<id>"    { project, chat, savedAt }
//   kv "versions:<id>"   Version[]       (named snapshots)
//   blobs "audio:<id>" / "music:<id>"    the voice-over and music files
//
// Older single-project saves (kv "studio", or localStorage "hookky.v1") migrate on first load.
// Where IndexedDB is unavailable, the open project and chat fall back to localStorage.
import type { Asset, ChatMessage, Project } from "./types";

const DB = "hookky";
const VERSION = 1;
const LEGACY_KEY = "hookky.v1";

export interface ProjectMeta {
  id: string;
  title: string;
  aspect: Project["aspect"];
  style: string;
  scenes: number;
  duration: number;
  updatedAt: number;
  createdAt: number;
  thumb?: string;
  hasAudio?: boolean;
}

export interface Version {
  id: string;
  name: string;
  createdAt: number;
  project: unknown;
}

let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("blobs")) d.createObjectStore("blobs");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      setTimeout(() => resolve(null), 3000);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function tx<T>(store: "kv" | "blobs", mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve, reject) => {
        if (!d) return reject(new Error("IndexedDB unavailable"));
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
        t.onerror = () => reject(t.error ?? new Error("IndexedDB error"));
        t.onabort = () => reject(t.error ?? new Error("IndexedDB write aborted"));
      }),
  );
}
const get = <T>(key: string, store: "kv" | "blobs" = "kv") => tx<T>(store, "readonly", (s) => s.get(key)).catch(() => undefined);
const put = (key: string, value: unknown, store: "kv" | "blobs" = "kv") => tx(store, "readwrite", (s) => s.put(value, key));
const del = (key: string, store: "kv" | "blobs" = "kv") => tx(store, "readwrite", (s) => s.delete(key));

export const isDurable = async () => !!(await db());

// ---------------------------------------------------------------- migration from single-project saves
async function migrate(): Promise<void> {
  const old = await get<{ project?: any; assets?: Asset[]; chat?: ChatMessage[]; savedAt?: number }>("studio");
  let legacy: { project?: any; chat?: ChatMessage[] } | null = null;
  if (!old) {
    try {
      legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
    } catch {}
  }
  const src = old ?? legacy;
  if (!src?.project || !Array.isArray(src.project.scenes)) return;
  const id = typeof src.project.id === "string" && src.project.id ? src.project.id : `p_${Date.now().toString(36)}`;
  const now = Date.now();
  await put(`project:${id}`, { project: { ...src.project, id }, chat: src.chat ?? [], savedAt: old?.savedAt ?? now });
  const [audio, music] = await Promise.all([get<Blob>("audio", "blobs"), get<Blob>("music", "blobs")]);
  if (audio) await put(`audio:${id}`, audio, "blobs");
  if (music) await put(`music:${id}`, music, "blobs");
  await put("index", [metaFor({ ...src.project, id }, now, now)]);
  await put("current", id);
  if (old?.assets) await put("library", old.assets);
  await del("studio").catch(() => {});
  await del("audio", "blobs").catch(() => {});
  await del("music", "blobs").catch(() => {});
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {}
}

export function metaFor(p: any, createdAt: number, updatedAt: number, thumb?: string): ProjectMeta {
  const scenes = Array.isArray(p?.scenes) ? p.scenes : [];
  return {
    id: String(p.id),
    title: String(p.title || "Untitled"),
    aspect: p.aspect ?? "16:9",
    style: String(p.style ?? "noir"),
    scenes: scenes.length,
    duration: +scenes.reduce((a: number, s: any) => a + (Number(s?.duration) || 0), 0).toFixed(2),
    createdAt,
    updatedAt,
    thumb,
    hasAudio: !!p.audio,
  };
}

// ---------------------------------------------------------------- workspace
export interface Workspace {
  projects: ProjectMeta[];
  currentId?: string;
  assets: Asset[];
  durable: boolean;
}

export async function loadWorkspace(): Promise<Workspace> {
  if (!(await db())) {
    // No IndexedDB: a single project in localStorage.
    try {
      const s = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if (s?.project?.id) return { projects: [metaFor(s.project, Date.now(), Date.now())], currentId: s.project.id, assets: [], durable: false };
    } catch {}
    return { projects: [], assets: [], durable: false };
  }
  if (!(await get("index"))) await migrate().catch(() => {});
  const projects = ((await get<ProjectMeta[]>("index")) ?? []).filter((m) => m && typeof m.id === "string");
  const currentId = await get<string>("current");
  const assets = ((await get<Asset[]>("library")) ?? []).filter((a) => a && typeof a.src === "string" && !a.src.startsWith("blob:"));
  return { projects, currentId: projects.some((p) => p.id === currentId) ? currentId : projects[0]?.id, assets, durable: true };
}

/** Load one project's record and media. The caller cleans the project. */
export async function loadProject(id: string): Promise<{ project?: any; chat: ChatMessage[]; audio?: Blob; music?: Blob }> {
  if (!(await db())) {
    try {
      const s = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
      if (s?.project?.id === id) return { project: s.project, chat: s.chat ?? [] };
    } catch {}
    return { chat: [] };
  }
  const rec = await get<{ project?: any; chat?: ChatMessage[] }>(`project:${id}`);
  const [audio, music] = await Promise.all([get<Blob>(`audio:${id}`, "blobs"), get<Blob>(`music:${id}`, "blobs")]);
  return { project: rec?.project, chat: Array.isArray(rec?.chat) ? rec!.chat!.filter((m) => m && typeof m.text === "string") : [], audio, music };
}

const syncedMedia = new Map<string, string | undefined>(); // "<kind>:<id>" → last saved object URL

/** Remember which media URLs were just loaded, so saving doesn't rewrite them. */
export function markRestored(id: string, audioUrl?: string, musicUrl?: string) {
  syncedMedia.set(`audio:${id}`, audioUrl);
  syncedMedia.set(`music:${id}`, musicUrl);
}

async function syncBlob(key: string, url: string | undefined) {
  if (syncedMedia.has(key) && syncedMedia.get(key) === url) return;
  if (!url) await del(key, "blobs");
  else await put(key, await (await fetch(url)).blob(), "blobs");
  syncedMedia.set(key, url);
}

/** Save a project, its chat and media, and refresh its entry in the index. Throws if the browser refuses. */
export async function saveProject(project: Project, chat: ChatMessage[], thumb?: string): Promise<void> {
  const { audio, music, ...rest } = project;
  const record = {
    project: { ...rest, audio: audio && { ...audio, url: "" }, music: music && { ...music, url: "" } },
    chat: chat.slice(-80).map((m) => ({ ...m, pending: false })),
    savedAt: Date.now(),
  };
  if (!(await db())) {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(record));
    return;
  }
  await put(`project:${project.id}`, record);
  await syncBlob(`audio:${project.id}`, audio?.url);
  await syncBlob(`music:${project.id}`, music?.url);
  const index = (await get<ProjectMeta[]>("index")) ?? [];
  const prev = index.find((m) => m.id === project.id);
  const meta = metaFor(record.project, prev?.createdAt ?? Date.now(), record.savedAt, thumb ?? prev?.thumb);
  await put("index", [meta, ...index.filter((m) => m.id !== project.id)]);
  await put("current", project.id);
}

export async function saveLibrary(assets: Asset[]) {
  if (await db()) await put("library", assets);
}

export async function setCurrent(id: string) {
  if (await db()) await put("current", id);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  return (await get<ProjectMeta[]>("index")) ?? [];
}

/** Add a brand-new project record (no media). */
export async function createProjectRecord(project: Project, chat: ChatMessage[] = []) {
  await saveProject(project, chat);
}

export async function renameProjectRecord(id: string, title: string) {
  const rec = await get<{ project: any; chat: ChatMessage[]; savedAt: number }>(`project:${id}`);
  if (rec) await put(`project:${id}`, { ...rec, project: { ...rec.project, title } });
  const index = (await get<ProjectMeta[]>("index")) ?? [];
  await put("index", index.map((m) => (m.id === id ? { ...m, title, updatedAt: Date.now() } : m)));
}

export async function deleteProjectRecord(id: string) {
  await Promise.all([del(`project:${id}`), del(`versions:${id}`), del(`audio:${id}`, "blobs"), del(`music:${id}`, "blobs")]);
  syncedMedia.delete(`audio:${id}`);
  syncedMedia.delete(`music:${id}`);
  const index = (await get<ProjectMeta[]>("index")) ?? [];
  await put("index", index.filter((m) => m.id !== id));
}

/** Copy a project's record and media under a new id. */
export async function duplicateProjectRecord(id: string, newId: string, title: string) {
  const rec = await get<{ project: any; chat: ChatMessage[] }>(`project:${id}`);
  if (!rec) throw new Error("That project couldn't be found.");
  const now = Date.now();
  await put(`project:${newId}`, { project: { ...rec.project, id: newId, title }, chat: [], savedAt: now });
  const [audio, music] = await Promise.all([get<Blob>(`audio:${id}`, "blobs"), get<Blob>(`music:${id}`, "blobs")]);
  if (audio) await put(`audio:${newId}`, audio, "blobs");
  if (music) await put(`music:${newId}`, music, "blobs");
  const index = (await get<ProjectMeta[]>("index")) ?? [];
  const src = index.find((m) => m.id === id);
  await put("index", [{ ...metaFor({ ...rec.project, id: newId, title }, now, now, src?.thumb) }, ...index]);
}

// ---------------------------------------------------------------- versions
export async function listVersions(id: string): Promise<Version[]> {
  return (await get<Version[]>(`versions:${id}`)) ?? [];
}
export async function addVersion(id: string, v: Version) {
  const list = await listVersions(id);
  await put(`versions:${id}`, [v, ...list].slice(0, 40));
}
export async function deleteVersion(id: string, versionId: string) {
  const list = await listVersions(id);
  await put(`versions:${id}`, list.filter((v) => v.id !== versionId));
}

/** Ask the browser not to evict our data under storage pressure (best effort, silent). */
export function requestPersistence() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {}
}
