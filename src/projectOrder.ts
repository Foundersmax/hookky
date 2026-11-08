// How the projects page is arranged: most recent, by name, or the user's own order.
import type { ProjectMeta } from "./persist";

export type SortMode = "recent" | "name" | "custom";

export function arrange(projects: ProjectMeta[], mode: SortMode, order: string[]): ProjectMeta[] {
  const list = [...projects];
  if (mode === "name") return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
  const recent = (a: ProjectMeta, b: ProjectMeta) => b.updatedAt - a.updatedAt;
  if (mode === "recent") return list.sort(recent);
  // Custom: the saved order; projects it doesn't know yet (new ones) come first, newest first.
  const pos = new Map(order.map((id, i) => [id, i]));
  const fresh = list.filter((p) => !pos.has(p.id)).sort(recent);
  const known = list.filter((p) => pos.has(p.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
  return [...fresh, ...known];
}

/** Move `id` to sit before `beforeId` (or to the end when beforeId is null). */
export function moveId(ids: string[], id: string, beforeId: string | null): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  rest.splice(at < 0 ? rest.length : at, 0, id);
  return rest;
}
