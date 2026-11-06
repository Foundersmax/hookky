// Brand kits: a saved identity (style preset, colours, fonts, logo, corner radius) to reuse across
// projects. Kits live in the browser's library next to the shared assets.
import type { Brand, BrandKit, Project } from "./types";
import { presetById, STYLE_PRESETS } from "./presets";
import { sanitizeBrand } from "./sanitize";
import { uid } from "./engine/util";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A kit from the project's current look. */
export function kitFromProject(p: Project, name: string, id = uid("kit")): BrandKit {
  return { id, name: str(name, 40) || p.brand.name || "Brand kit", style: p.style, brand: { ...p.brand }, updatedAt: Date.now() };
}

/** The project wearing a kit. A logo the library no longer has is dropped rather than left dangling. */
export function applyKitTo(p: Project, kit: BrandKit, assetIds?: Set<string>): Project {
  const brand: Brand = { ...kit.brand };
  if (brand.logo && assetIds && !assetIds.has(brand.logo)) delete brand.logo;
  return { ...p, style: presetById(kit.style).id, brand };
}

/** Clean a stored or imported kit; null when it's unusable. */
export function sanitizeKit(input: unknown): BrandKit | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const name = str(o.name, 40);
  if (!name) return null;
  const style = STYLE_PRESETS.some((x) => x.id === o.style) ? (o.style as string) : "noir";
  const { style: _s, ...clean } = sanitizeBrand(o.brand);
  const brand = { name: "", ...presetById(style).brand, ...clean } as Brand;
  return { id: str(o.id, 60) || uid("kit"), name, style, brand, ...(o.isDefault === true && { isDefault: true }), updatedAt: Number(o.updatedAt) || 0 };
}

/** Find a kit by the name someone (or the agent) used for it. */
export function findKit(kits: BrandKit[], name: string): BrandKit | undefined {
  const n = name.trim().toLowerCase().replace(/\s+kit$/, "");
  return kits.find((k) => k.name.toLowerCase() === n) ?? kits.find((k) => k.name.toLowerCase().includes(n) || n.includes(k.name.toLowerCase()));
}
