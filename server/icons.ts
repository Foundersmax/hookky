// Icon kits for motion graphics. Finds icons for ideas ("sleep", "fast charging") inside one kit,
// so an ad's icons share a stroke and a style: first through Iconify's web search (200k+ icons
// across 150+ kits), then the kits shipped with the server, matched by name, aliases and a small
// dictionary of ideas → icon words. Returns ready-to-draw specs.
import { createRequire } from "node:module";
import { parseIcon, KITS, type IconSpec, type KitId } from "../src/mograph/icons";
import { IDEAS } from "../src/mograph/ideas";

const require = createRequire(import.meta.url);
type IconSet = { prefix: string; width?: number; height?: number; icons: Record<string, { body: string; width?: number; height?: number; hidden?: boolean }>; aliases?: Record<string, { parent: string }> };
const sets = new Map<string, IconSet>();
function kitSet(prefix: string): IconSet | undefined {
  if (!sets.has(prefix)) {
    try {
      sets.set(prefix, require(`@iconify-json/${prefix}/icons.json`));
    } catch {
      return undefined;
    }
  }
  return sets.get(prefix);
}
const kitOf = (id: string) => KITS.find((k) => k.id === id) ?? KITS[0];

const stem = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "").replace(/([b-df-hj-np-tv-z])\1$/, "$1"); // running → run

/** Icon names in a kit for an idea, best first, from its names, aliases and the ideas dictionary. */
export function localSearch(query: string, kit: KitId, limit = 6): string[] {
  const k = kitOf(kit);
  const set = kitSet(k.id);
  if (!set) return [];
  const suffix = "suffix" in k ? (k as { suffix: string }).suffix : "";
  const names = Object.keys(set.icons).filter((n) => !set.icons[n].hidden && (!suffix || n.endsWith(suffix)));
  const base = (n: string) => (suffix ? n.slice(0, -suffix.length) : n);
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const wanted = [...new Set([query.toLowerCase().trim().replace(/\s+/g, "-"), ...words.flatMap((w) => IDEAS[w] ?? IDEAS[stem(w)] ?? []), ...words])];
  const scored = new Map<string, number>();
  wanted.forEach((term, ti) => {
    for (const n of names) {
      const b = base(n);
      let sc = 0;
      if (b === term) sc = 100;
      else if (b.split("-").includes(term)) sc = 60 - b.length * 0.5;
      else if (b.startsWith(term)) sc = 40 - b.length * 0.5;
      // "-off", "-x", "-slash" variants mean the opposite; "-filled" breaks a line kit.
      if (sc > 0 && term !== "off" && /-(off|x|slash|minus|filled|cancel|exclamation|question)(?=-|$)/.test(b)) sc -= 45;
      if (sc > 0) scored.set(n, Math.max(scored.get(n) ?? 0, sc - ti * 3));
    }
    for (const [alias, { parent }] of Object.entries(set.aliases ?? {})) if (base(alias) === term && set.icons[parent]) scored.set(parent, Math.max(scored.get(parent) ?? 0, 90 - ti * 3));
  });
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => `${set.prefix}:${n}`);
}

/** Iconify's search across the web library, limited to one kit (returns full names). */
async function webSearch(query: string, kit: KitId, limit = 6): Promise<string[]> {
  const r = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(query)}&limit=${Math.max(32, limit)}&prefixes=${kit}`, { signal: AbortSignal.timeout(3500) });
  if (!r.ok) throw new Error(`iconify ${r.status}`);
  const j = (await r.json()) as { icons?: string[] };
  const k = kitOf(kit);
  const suffix = "suffix" in k ? (k as { suffix: string }).suffix : "";
  return (j.icons ?? []).filter((n) => n.startsWith(`${kit}:`) && (!suffix || n.endsWith(suffix))).slice(0, limit);
}

/** The drawable spec for a full icon name ("lucide:moon"), from the local kit or the Iconify API. */
export async function iconSpec(full: string): Promise<IconSpec | null> {
  const [prefix, name] = full.split(":");
  const set = kitSet(prefix);
  const local = set?.icons[name] ?? (set?.aliases?.[name] && set.icons[set.aliases[name].parent]);
  if (local && set) return parseIcon(local.body, local.width ?? set.width ?? 24, local.height ?? set.height ?? 24);
  const r = await fetch(`https://api.iconify.design/${prefix}.json?icons=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(3500) });
  if (!r.ok) return null;
  const j = (await r.json()) as IconSet;
  const ic = j.icons?.[name];
  return ic ? parseIcon(ic.body, ic.width ?? j.width ?? 24, ic.height ?? j.height ?? 24) : null;
}

let webOk = true;
/** For each idea, the best icon in the kit that isn't already used; null when nothing fits. */
export async function resolveIcons(ideas: string[], kit: KitId): Promise<{ query: string; name: string | null; spec: IconSpec | null; via: "web" | "local" | "none" }[]> {
  const used = new Set<string>();
  const out = [];
  for (const q of ideas.slice(0, 40)) {
    let names: string[] = [];
    let via: "web" | "local" | "none" = "none";
    if (webOk) {
      try {
        names = await webSearch(q, kit);
        if (names.length) via = "web";
      } catch {
        webOk = false; // the web library is unreachable from here; use the kits on disk
        setTimeout(() => (webOk = true), 60_000);
      }
    }
    const local = localSearch(q, kit);
    // Prefer an icon the dictionary meant (it knows ideas the web search may read literally).
    names = [...new Set([...local.slice(0, 2), ...names, ...local])];
    if (via === "none" && local.length) via = "local";
    const name = names.find((n) => !used.has(n)) ?? names[0] ?? null;
    const spec = name ? await iconSpec(name).catch(() => null) : null;
    if (name) used.add(name);
    out.push({ query: q, name: spec ? name : null, spec, via: spec ? via : "none" });
  }
  return out;
}
