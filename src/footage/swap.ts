// Swapping the footage of one scene in the editor: what to change on the scene when a new clip or
// photo is chosen, the words spoken over the scene, and searches worth trying for it.
import type { Asset, Project, Scene } from "../types";
import { getState, libraryId, updateProject, editedScene } from "../store";
import { timingFor } from "./cast";
import { preferLicensed } from "./license";
import { LOOKS_PROD, wordsIn, type ProdLook } from "./plan";
import { phrasesOf, topicOf } from "./mind";

/** Which production look a scene was cut with (from its grade), for timing a new take the same way. */
export const lookOf = (s: Scene): ProdLook => ((Object.keys(LOOKS_PROD) as ProdLook[]).find((k) => LOOKS_PROD[k].grade === s.grade) ?? "commercial");

/** The asset a scene shows as footage (an end card shows it as its backdrop). */
export const footageOf = (s: Scene) => (s.template === "cta-end" ? s.backdrop?.[0] : s.image);
/** Scenes whose picture can be swapped for stock footage. */
export const takesFootage = (s: Scene) => !!s.shot || s.template === "fullbleed" || (s.template === "cta-end" && !!s.backdrop?.length);

/** The change that puts a clip or photo into a scene, timed into the clip's middle. */
export function footagePatch(scene: Scene, a: Asset, assets: Asset[], query?: string): Partial<Scene> {
  const id = libraryId(preferLicensed(a, assets));
  const timing = timingFor(a, { s: 0, e: scene.duration, line: "", type: "medium", queries: [], overlay: "" }, lookOf(scene));
  const still = a.kind !== "video";
  const effects = scene.effects ?? [];
  const base: Partial<Scene> = {
    clipStart: timing.clipStart,
    clipSpeed: timing.clipSpeed,
    shot: { ...scene.shot, type: scene.shot?.type ?? "medium", query: query || scene.shot?.query || a.title.slice(0, 80) },
    // a photo gets a slow push so it isn't frozen; a clip moves by itself
    ...(still && !effects.includes("push-in") && effects.length < 4 && { effects: ["push-in", ...effects] }),
  };
  return scene.template === "cta-end" ? { ...base, backdrop: [id] } : { ...base, image: id, ...(scene.template !== "fullbleed" && { template: "fullbleed" }) };
}

/** Put a clip or photo into a scene of the open project (one undo step). */
export function swapFootage(index: number, a: Asset, query?: string) {
  updateProject((p) => ({ ...p, scenes: p.scenes.map((s, i) => (i === index ? editedScene({ ...s, ...footagePatch(s, a, getState().assets, query) }) : s)) }));
}

/** When a scene starts on the timeline, and the words of the voice-over spoken during it. */
export function sceneLine(p: Project, index: number): string {
  const s = p.scenes[index];
  if (!s) return "";
  if (s.shot?.line) return s.shot.line;
  const start = p.scenes.slice(0, index).reduce((t, x) => t + x.duration, 0);
  return wordsIn(p.audio?.words, start, start + s.duration) || [s.headline, s.subline].filter(Boolean).join(" ").replace(/\*/g, "");
}

/** Searches worth trying for a scene: what the director searched, then the filmable phrases of its line. */
export function suggestionsFor(p: Project, index: number): string[] {
  const s = p.scenes[index];
  if (!s) return [];
  const all = (p.audio?.words ?? []).map((w) => w.w).join(" ");
  const topic = topicOf(all, []);
  const line = sceneLine(p, index);
  const fromLine = phrasesOf(line, topic).filter((x) => x.score >= 1).map((x) => x.text);
  const world = topic.main;
  return [...new Set([s.shot?.query, ...(s.shot?.queries ?? []), ...fromLine, ...fromLine.slice(0, 2).map((x) => (world && !x.includes(world) ? `${x} ${world}` : "")), world].filter((q): q is string => !!q && q.trim().length > 2).map((q) => q.toLowerCase()))].slice(0, 8);
}
