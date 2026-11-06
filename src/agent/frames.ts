// Contact sheets for the agent's visual review: every scene rendered at its settled moment,
// numbered, on one image Claude can look at like an art director looks at a cut.
import type { Project, Scene } from "../types";
import { ASPECT_SIZE } from "../types";
import { Renderer } from "../engine/render";
import { images } from "../runtime";

/** Long edge of a sheet; Claude sees images at about this size without downscaling. */
const MAX_EDGE = 1568;
const PER_SHEET = 16;
const GAP = 14;
const LABEL = 26;

export interface Sheet {
  /** JPEG data URL. */
  url: string;
  width: number;
  height: number;
  /** 0-based indices of the scenes on this sheet. */
  scenes: number[];
}

/** The frame a viewer mostly sees: animated in, not yet leaving. */
export const settledMoment = (s: Scene) => Math.min(s.duration - 0.08, Math.max(1, s.duration * 0.72));

/** Columns and tile width that make the tiles as large as possible inside MAX_EDGE. */
export function sheetLayout(n: number, aspect: number) {
  let best = { cols: 1, w: 0, h: 0, width: 0, height: 0 };
  for (let cols = 1; cols <= Math.min(n, 8); cols++) {
    const rows = Math.ceil(n / cols);
    let w = Math.min(560, (MAX_EDGE - GAP * (cols + 1)) / cols);
    const height = (tw: number) => rows * (tw / aspect + LABEL) + GAP * (rows + 1);
    if (height(w) > MAX_EDGE) w = (MAX_EDGE - GAP * (rows + 1) - rows * LABEL) * aspect / rows;
    w = Math.floor(w);
    const cand = { cols, w, h: Math.round(w / aspect), width: Math.round(cols * w + GAP * (cols + 1)), height: Math.round(height(w)) };
    // Biggest tiles win; on a tie, the squarer sheet (a 2×2 grid beats a tall column).
    const squareness = (x: typeof cand) => Math.abs(Math.log(x.width / x.height));
    if (w > best.w || (w === best.w && squareness(cand) < squareness(best))) best = cand;
  }
  return best;
}

function imageRefs(p: Project) {
  const refs = new Set<string>();
  if (p.brand.logo) refs.add(p.brand.logo);
  for (const s of p.scenes) {
    if (s.image) refs.add(s.image);
    for (const r of s.images ?? []) refs.add(r);
  }
  return [...refs];
}

/** Wait (briefly) for the scenes' images so the sheet shows what the viewer will see. */
async function preload(p: Project, timeoutMs = 2500) {
  const refs = imageRefs(p).filter((r) => images.resolve(r));
  const missing = () => refs.filter((r) => !images.get(r));
  if (!missing().length) return;
  await new Promise<void>((done) => {
    const t = setTimeout(finish, timeoutMs);
    const off = images.listen(() => !missing().length && finish());
    function finish() {
      clearTimeout(t);
      off();
      done();
    }
  });
}

/** Render the project as 1–2 numbered contact sheets (16 scenes each). */
export async function contactSheets(p: Project, maxSheets = 2): Promise<Sheet[]> {
  if (!p.scenes.length) return [];
  await preload(p);
  const [W, H] = ASPECT_SIZE[p.aspect];
  const sheets: Sheet[] = [];
  const tile = document.createElement("canvas");
  let renderer: Renderer | null = null;
  for (let start = 0; start < p.scenes.length && sheets.length < maxSheets; start += PER_SHEET) {
    const idx = p.scenes.map((_, i) => i).slice(start, start + PER_SHEET);
    const L = sheetLayout(idx.length, W / H);
    const scale = L.w / W;
    if (!renderer) renderer = new Renderer(tile, W, H, scale);
    else renderer.resize(W, H, scale);
    const c = document.createElement("canvas");
    c.width = L.width;
    c.height = L.height;
    const g = c.getContext("2d")!;
    g.fillStyle = "#18181b";
    g.fillRect(0, 0, c.width, c.height);
    g.textBaseline = "middle";
    idx.forEach((si, k) => {
      const s = p.scenes[si];
      const x = GAP + (k % L.cols) * (L.w + GAP);
      const y = GAP + Math.floor(k / L.cols) * (L.h + LABEL + GAP);
      g.font = "600 15px Inter, system-ui, sans-serif";
      g.fillStyle = "#fafafa";
      g.fillText(String(si + 1), x, y + LABEL / 2 - 2);
      g.font = "13px Inter, system-ui, sans-serif";
      g.fillStyle = "#a1a1aa";
      g.fillText(`${s.template} · ${s.duration.toFixed(1)}s`, x + 22, y + LABEL / 2 - 2);
      try {
        renderer!.render({ ...p, scenes: [{ ...s, transition: "cut" }], captions: false, grain: false }, settledMoment(s), images.get);
        g.drawImage(tile, x, y + LABEL, L.w, L.h);
      } catch {
        g.fillStyle = "#3f3f46";
        g.fillRect(x, y + LABEL, L.w, L.h);
      }
    });
    sheets.push({ url: c.toDataURL("image/jpeg", 0.86), width: c.width, height: c.height, scenes: idx });
  }
  return sheets;
}

/** A small copy of a sheet for the chat bubble (the full one goes to Claude only). */
export async function sheetPreview(url: string, maxW = 520): Promise<string> {
  const im = new Image();
  im.src = url;
  await im.decode();
  const s = Math.min(1, maxW / im.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(im.naturalWidth * s);
  c.height = Math.round(im.naturalHeight * s);
  c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

export const REVIEW_PROMPT = (sheets: Sheet[], total: number) =>
  `Visual review. Attached ${sheets.length === 1 ? "is a contact sheet" : `are ${sheets.length} contact sheets`} of the current animation: ${sheets.length < Math.ceil(total / PER_SHEET) ? `the first ${sheets.reduce((a, s) => a + s.scenes.length, 0)} of ${total} scenes` : `all ${total} scenes`}, each rendered at its settled moment and labelled with its number (scene index + 1), template and length.

Look at it like an art director reviewing a cut. Check for: text that is cramped, clipped, overlapping or too small to read on a phone; weak contrast; awkward crops or frames that look empty or broken; a hierarchy that doesn't read at a glance; scenes that don't look like one campaign; neighbours that look too alike.

Fix real problems with update_scenes or set_brand, using the smallest edits. Don't re-concept the ad and don't change copy that already works. Then reply in 1–3 sentences: what you changed and why, or that it holds up.`;
