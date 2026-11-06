// Durable autosave in IndexedDB: the project, the asset library (uploads included), the chat,
// and the voice-over and music files themselves, so a reload brings everything back.
// Falls back to a small localStorage copy (project + chat only) where IndexedDB is unavailable.
import type { Asset, ChatMessage, Project } from "./types";

const DB = "hookky";
const VERSION = 1;
const LEGACY_KEY = "hookky.v1";

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

export interface Saved {
  project?: unknown;
  assets?: Asset[];
  chat?: ChatMessage[];
  savedAt?: number;
}

/** Load the last save. Prefers IndexedDB, falls back to (and migrates from) the old localStorage copy. */
export async function loadSaved(): Promise<{ saved: Saved; audioBlob?: Blob; musicBlob?: Blob; durable: boolean }> {
  try {
    const saved = await tx<Saved>("kv", "readonly", (s) => s.get("studio"));
    if (saved) {
      const [audioBlob, musicBlob] = await Promise.all([
        tx<Blob>("blobs", "readonly", (s) => s.get("audio")).catch(() => undefined),
        tx<Blob>("blobs", "readonly", (s) => s.get("music")).catch(() => undefined),
      ]);
      return { saved, audioBlob, musicBlob, durable: true };
    }
  } catch {
    /* fall through to legacy */
  }
  let legacy: Saved = {};
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}");
  } catch {}
  return { saved: legacy, durable: !!(await db()) };
}

let lastAudioUrl: string | undefined;
let lastMusicUrl: string | undefined;

/** Save everything. Throws when the browser refuses (e.g. storage full). */
export async function save(project: Project, assets: Asset[], chat: ChatMessage[]): Promise<void> {
  const { audio, music, ...rest } = project;
  const record: Saved = {
    project: { ...rest, audio: audio && { ...audio, url: "" }, music: music && { ...music, url: "" } },
    assets,
    chat: chat.slice(-80).map((m) => ({ ...m, pending: false })),
    savedAt: Date.now(),
  };
  const d = await db();
  if (!d) {
    // No IndexedDB: keep at least the storyboard and chat.
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ project: record.project, chat: record.chat }));
    return;
  }
  await tx("kv", "readwrite", (s) => s.put(record, "studio"));
  await syncBlob("audio", audio?.url, lastAudioUrl).then((u) => (lastAudioUrl = u));
  await syncBlob("music", music?.url, lastMusicUrl).then((u) => (lastMusicUrl = u));
  try {
    localStorage.removeItem(LEGACY_KEY); // migrated
  } catch {}
}

async function syncBlob(key: "audio" | "music", url: string | undefined, last: string | undefined) {
  if (url === last) return last;
  if (!url) {
    await tx("blobs", "readwrite", (s) => s.delete(key));
    return undefined;
  }
  const blob = await (await fetch(url)).blob();
  await tx("blobs", "readwrite", (s) => s.put(blob, key));
  return url;
}

/** Remember which media URLs were restored, so the first save doesn't rewrite them. */
export function markRestored(audioUrl?: string, musicUrl?: string) {
  lastAudioUrl = audioUrl;
  lastMusicUrl = musicUrl;
}

/** Ask the browser not to evict our data under storage pressure (best effort, silent). */
export function requestPersistence() {
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch {}
}
