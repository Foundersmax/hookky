// Brand fonts uploaded by the user: stored in the asset library as data URLs and registered
// with the browser from their bytes (no network fetch), so preview, thumbnails and export use them.
import type { Asset } from "./types";

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi.?bold|demi.?bold/i, 600], [/extra.?bold|ultra.?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
];
const STYLE_WORDS = /\b(thin|hairline|extra ?light|ultra ?light|light|regular|book|normal|medium|semi ?bold|demi ?bold|extra ?bold|ultra ?bold|bold|black|heavy|italic|oblique|variable|vf)\b/gi;

/** "AcmeSans-SemiBold.woff2" → { family: "Acme Sans", weight: 600, italic: false } */
export function parseFontName(filename: string) {
  const base = filename.replace(/\.(woff2?|ttf|otf)$/i, "");
  const weight = WEIGHTS.find(([re]) => re.test(base))?.[1] ?? 400;
  const italic = /italic|oblique/i.test(base);
  const family =
    base
      .replace(/([a-z])([A-Z])/g, "$1 $2") // AcmeSans → Acme Sans
      .replace(/[^A-Za-z0-9]+/g, " ") // separators (- _ .) → spaces, so word boundaries work
      .replace(STYLE_WORDS, "")
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40) || "Brand Font";
  return { family: family.length < 2 ? `${family} Font` : family, weight, italic };
}

export const isFontFile = (f: File) => /\.(woff2?|ttf|otf)$/i.test(f.name) || /font/.test(f.type);

function dataUrlToBuffer(url: string): ArrayBuffer {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

const registered = new Map<string, Promise<boolean>>();

/** Register every font asset with the browser. Resolves true if anything new loaded. */
export async function registerFonts(assets: Asset[]): Promise<boolean> {
  if (typeof FontFace === "undefined") return false;
  const todo = assets.filter((a) => a.kind === "font" && a.family && !registered.has(a.id));
  for (const a of todo) {
    registered.set(
      a.id,
      (async () => {
        try {
          const face = new FontFace(a.family!, dataUrlToBuffer(a.src), { weight: String(a.weight ?? 400), style: /italic/i.test(a.title) ? "italic" : "normal" });
          await face.load();
          document.fonts.add(face);
          return true;
        } catch {
          return false;
        }
      })(),
    );
  }
  const results = await Promise.all(todo.map((a) => registered.get(a.id)!));
  return results.some(Boolean);
}

export const fontFamilies = (assets: Asset[]) => [...new Set(assets.filter((a) => a.kind === "font" && a.family).map((a) => a.family!))];

/** Read a font file into a library asset (refuses files over 4 MB). */
export async function fontFileToAsset(f: File): Promise<Asset> {
  if (f.size > 4 * 1024 * 1024) throw new Error(`${f.name} is over 4 MB. Use a .woff2 version of the font.`);
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error(`Couldn't read ${f.name}.`));
    r.readAsDataURL(f);
  });
  const { family, weight } = parseFontName(f.name);
  // check it really is a font before keeping it
  if (typeof FontFace !== "undefined") {
    try {
      await new FontFace(`__check_${Date.now()}`, dataUrlToBuffer(src)).load();
    } catch {
      throw new Error(`${f.name} isn't a font the browser can read.`);
    }
  }
  return { id: `asset:font_${Math.random().toString(36).slice(2, 9)}`, title: f.name, src, source: "upload", kind: "font", family, weight };
}
