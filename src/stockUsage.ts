// Some stock sources require the app to report when a file is actually used (Coverr's API terms:
// PATCH /videos/:id/stats/downloads). Report each such clip once, when it first appears in a scene.
import type { Asset, Project } from "./types";

const REPORTING = new Set(["coverr"]);
const KEY = "hookky:reported";

function loadReported(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]"));
  } catch {
    return new Set();
  }
}
const reported = loadReported();
const inFlight = new Set<string>();

/** Stock items placed in the project's scenes that still need a usage report. */
export function pendingReports(p: Project, assets: Asset[]): { source: string; id: string }[] {
  const used = new Set(p.scenes.flatMap((s) => [s.image, ...(s.images ?? [])]).filter(Boolean) as string[]);
  return assets
    .filter((a) => used.has(a.id) && REPORTING.has(a.source) && a.sourceId)
    .map((a) => ({ source: a.source, id: a.sourceId! }))
    .filter((r) => !reported.has(`${r.source}:${r.id}`) && !inFlight.has(`${r.source}:${r.id}`));
}

export function reportStockUse(p: Project, assets: Asset[]) {
  for (const r of pendingReports(p, assets)) {
    const k = `${r.source}:${r.id}`;
    inFlight.add(k);
    fetch("/api/stock/used", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r) })
      .then((res) => {
        if (!res.ok) return;
        reported.add(k);
        try {
          localStorage.setItem(KEY, JSON.stringify([...reported].slice(-2000)));
        } catch {
          /* still reported for this session */
        }
      })
      .catch(() => {})
      .finally(() => inFlight.delete(k));
  }
}
