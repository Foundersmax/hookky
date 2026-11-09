// Icons as drawable data: an Iconify SVG body turned into plain path parts the engine can stroke
// on (draw-on animation) or fill. Pure, so the server (which finds icons) and the studio (which
// draws them) share it.

/** One drawable part of an icon: an SVG path, stroked (line icons) and/or filled. */
export interface IconPart {
  d: string;
  stroke?: boolean;
  fill?: boolean;
  /** stroke width in the icon's own units */
  sw?: number;
}
/** An icon ready to draw: its box and parts. */
export interface IconSpec {
  w: number;
  h: number;
  parts: IconPart[];
  /** "line" kits draw on stroke by stroke; "solid" kits reveal by a wipe */
  kind: "line" | "solid";
}

/** The icon kits rookker draws from: one per ad keeps the visual system consistent. */
export const KITS = [
  { id: "lucide", label: "Lucide", note: "Clean, rounded line icons", kind: "line" as const },
  { id: "tabler", label: "Tabler", note: "Even, geometric line icons", kind: "line" as const },
  { id: "iconoir", label: "Iconoir", note: "Fine 1.5 px line icons", kind: "line" as const },
  { id: "ph", label: "Phosphor Light", note: "Light outlined icons", kind: "solid" as const, suffix: "-light" },
];
export type KitId = (typeof KITS)[number]["id"];

const num = (v: string | undefined, d = 0) => (v === undefined || v === "" || isNaN(+v) ? d : +v);
const attrs = (tag: string) => {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
};

/** A basic shape as path data. */
function shapeToPath(name: string, a: Record<string, string>): string | undefined {
  switch (name) {
    case "path":
      return a.d;
    case "circle": {
      const cx = num(a.cx), cy = num(a.cy), r = num(a.r);
      return r > 0 ? `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z` : undefined;
    }
    case "ellipse": {
      const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx), ry = num(a.ry);
      return rx > 0 && ry > 0 ? `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0Z` : undefined;
    }
    case "rect": {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      const rx = Math.min(num(a.rx, num(a.ry)), w / 2), ry = Math.min(num(a.ry, rx), h / 2);
      if (!(w > 0 && h > 0)) return undefined;
      if (!rx) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h - 2 * ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${-(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${-(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
    }
    case "line":
      return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case "polyline":
    case "polygon": {
      const pts = (a.points ?? "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return undefined;
      let d = `M${pts[0]} ${pts[1]}`;
      for (let i = 2; i + 1 < pts.length; i += 2) d += `L${pts[i]} ${pts[i + 1]}`;
      return name === "polygon" ? d + "Z" : d;
    }
  }
  return undefined;
}

/**
 * Parse an Iconify SVG body (paths, basic shapes, nested <g> with inherited fill/stroke) into
 * parts. Masks, gradients and anything else are skipped; an icon with no usable parts is null.
 */
export function parseIcon(body: string, w = 24, h = 24): IconSpec | null {
  const parts: IconPart[] = [];
  const stack: Record<string, string>[] = [{}];
  const HIDDEN = /^(defs|mask|clipPath|linearGradient|radialGradient|pattern|symbol|title|desc|style)$/i;
  let hidden = 0; // inside an element whose content isn't drawn
  for (const m of body.matchAll(/<\s*(\/?)\s*([a-zA-Z]+)([^>]*?)(\/?)\s*>/g)) {
    const [, close, name, rest, self] = m;
    if (HIDDEN.test(name)) {
      if (close) hidden = Math.max(0, hidden - 1);
      else if (!self) hidden++;
      continue;
    }
    if (hidden) continue;
    if (close) {
      if (name === "g" && stack.length > 1) stack.pop();
      continue;
    }
    const a = { ...stack[stack.length - 1], ...attrs(rest) };
    if (name === "g") {
      if (!self) stack.push(a);
      continue;
    }
    const d = shapeToPath(name, a);
    if (!d) continue;
    const fill = a.fill === undefined ? !a.stroke : a.fill !== "none";
    const stroke = !!a.stroke && a.stroke !== "none";
    if (a.opacity === "0" || (!fill && !stroke)) continue;
    parts.push({ d: d.slice(0, 6000), ...(stroke && { stroke: true, sw: num(a["stroke-width"], 1) }), ...(fill && { fill: true }) });
  }
  return finish();
  function finish(): IconSpec | null {
    if (!parts.length) return null;
    return { w, h, parts: parts.slice(0, 40), kind: parts.some((p) => p.stroke) && !parts.some((p) => p.fill && !p.stroke) ? "line" : "solid" };
  }
}

/** A clean icon spec from anywhere (saved projects, the network): parts with bounded path data. */
export function cleanIcon(v: unknown): IconSpec | undefined {
  const o = v as Partial<IconSpec>;
  if (!o || typeof o !== "object" || !Array.isArray(o.parts)) return undefined;
  const parts = o.parts
    .filter((p) => p && typeof p.d === "string" && p.d.length < 6000 && /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+-eE]+$/.test(p.d))
    .slice(0, 40)
    .map((p) => ({ d: p.d, ...(p.stroke && { stroke: true, sw: Math.max(0.1, Math.min(8, Number(p.sw) || 1)) }), ...(p.fill && { fill: true }) }));
  if (!parts.length) return undefined;
  const w = Number(o.w) > 0 && Number(o.w) < 2000 ? Number(o.w) : 24, h = Number(o.h) > 0 && Number(o.h) < 2000 ? Number(o.h) : 24;
  return { w, h, parts, kind: o.kind === "solid" ? "solid" : "line" };
}

export const ICON_NAME = /^[a-z0-9-]{1,30}:[a-z0-9-]{1,60}$/;
