import { useMemo } from "react";
import type { Brand, Scene } from "../types";
import { BACKGROUNDS } from "../types";
import { Renderer } from "../engine/render";
import { sanitizeScene } from "../sanitize";

type Bg = NonNullable<Scene["background"]>;
const LABEL: Partial<Record<Bg, string>> = { synthwave: "Synth", starfield: "Stars", checker: "Check" };
const ANIMATED = new Set<Bg>(["gradient", "blobs", "mesh", "rays", "stripes", "waves", "checker", "rings", "aurora", "starfield", "synthwave", "split", "dots", "orbs", "spotlight", "beams", "horizon"]);
const cache = new Map<string, string>();
let renderer: Renderer | null = null;

/** A small still of a background in the brand's colours (cached). */
function thumb(bg: Bg, brand: Brand): string {
  const key = `${bg}|${brand.bg}|${brand.fg}|${brand.accent}|${brand.fontDisplay}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = renderer?.canvas ?? document.createElement("canvas");
  if (!renderer) renderer = new Renderer(canvas, 480, 300, 0.25);
  const scene = sanitizeScene({ template: "title-reveal", duration: 4, headline: "Aa", background: bg });
  try {
    renderer.render({ id: "t", title: "", aspect: "16:9", style: "noir", brand, scenes: [scene], captions: false, grain: false }, 1.6, () => undefined);
    const url = canvas.toDataURL("image/jpeg", 0.8);
    cache.set(key, url);
    return url;
  } catch {
    return "";
  }
}

/**
 * Pick a background from live-rendered swatches. `auto` adds a first option that keeps whatever
 * each scene already has (for applying across a whole format).
 */
export function BackgroundPicker({ value, onChange, brand, auto, image }: { value?: Bg | "auto"; onChange: (bg: Bg | "auto") => void; brand: Brand; auto?: boolean; image?: boolean }) {
  const list = BACKGROUNDS.filter((b) => b !== "image" || image) as Bg[];
  const thumbs = useMemo(() => Object.fromEntries(list.map((b) => [b, thumb(b, brand)])), [brand.bg, brand.fg, brand.accent, brand.fontDisplay, image]);
  return (
    <div className="bg-picker" role="radiogroup" aria-label="Background">
      {auto && (
        <button type="button" role="radio" aria-checked={value === "auto"} className={`bg-swatch auto ${value === "auto" ? "on" : ""}`} onClick={() => onChange("auto")} title="Each scene keeps the format's own background">
          <span className="bg-thumb">Auto</span>
          <small>Format's own</small>
        </button>
      )}
      {list.map((b) => (
        <button key={b} type="button" role="radio" aria-checked={value === b} className={`bg-swatch ${value === b ? "on" : ""}`} onClick={() => onChange(b)} title={`${b}${ANIMATED.has(b) ? " (animated)" : ""}`}>
          <span className="bg-thumb" style={thumbs[b] ? { backgroundImage: `url("${thumbs[b]}")` } : { backgroundColor: brand.bg }} />
          <small>{LABEL[b] ?? b[0].toUpperCase() + b.slice(1)}{ANIMATED.has(b) ? " ·" : ""}</small>
        </button>
      ))}
    </div>
  );
}
