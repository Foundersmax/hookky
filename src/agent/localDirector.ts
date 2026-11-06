// Offline creative director: a deterministic, rule-based storyboard generator so the studio
// works with no API key. Claude replaces this when ANTHROPIC_API_KEY is configured.
import type { Asset, Project, StoryboardInput, Scene } from "../types";
import { STYLE_PRESETS } from "../presets";
import { sentences } from "../audio/analyze";

export interface LocalResult {
  reply: string;
  name?: string;
  storyboard?: StoryboardInput;
  style?: string;
  settings?: Partial<Pick<Project, "aspect" | "captions">>;
}

const short = (s: string, n = 6) => {
  const w = s.replace(/[“”"]/g, "").split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(" ") : w.slice(0, n).join(" ").replace(/[,;:]$/, "") + "…";
};

function emphasize(s: string) {
  const w = s.split(" ");
  if (w.length < 2) return s;
  const i = w.reduce((bi, x, idx) => (x.replace(/\W/g, "").length > w[bi].replace(/\W/g, "").length ? idx : bi), 0);
  w[i] = `*${w[i].replace(/[.,!?]$/, "")}*${w[i].match(/[.,!?]$/)?.[0] ?? ""}`;
  return w.join(" ");
}

export function localDirector(text: string, p: Project, assets: Asset[]): LocalResult {
  const t = text.toLowerCase();
  const style = STYLE_PRESETS.find((s) => t.includes(s.id) || t.includes(s.label.toLowerCase()))?.id;
  const settings: LocalResult["settings"] = {};
  if (/9:16|vertical|reel|tiktok|story|shorts/.test(t)) settings.aspect = "9:16";
  else if (/1:1|square/.test(t)) settings.aspect = "1:1";
  else if (/4:5|portrait|feed/.test(t)) settings.aspect = "4:5";
  else if (/16:9|landscape|youtube|wide/.test(t)) settings.aspect = "16:9";
  if (/captions? (on|please)|add captions|subtitles/.test(t)) settings.captions = true;
  if (/captions? off|no captions/.test(t)) settings.captions = false;

  const wantsNew = /make|create|build|generate|storyboard|ad|launch|promo|video|animate|turn/.test(t) || !!p.audio?.words?.length;
  if (!wantsNew) {
    return { reply: style || Object.keys(settings).length ? "Done — updated the look." : "Tell me about the product (name, what it does, 2–3 benefits, a CTA) and I'll storyboard it. You can also drop a voice-over.", style, settings };
  }

  const isInstruction = (l: string) =>
    /^(make|create|build|generate|turn|use|give|do|i want|please|can you)\b/i.test(l) ||
    /\b(style|aspect|9:16|16:9|1:1|4:5|vertical|captions?|cta|storyboard|\d+\s?s(ec(ond)?s?)?\b ad|voice-?over)\b/i.test(l) ||
    STYLE_PRESETS.some((s) => new RegExp(`^${s.label}\\b`, "i").test(l));
  const ctaLine = text.split(/(?<=[.!?])\s+|\n+/).find((l) => /\b(pre-?order|buy|shop|order|get|download|try|sign up|join|visit)\b.*\b(at|on|now|today)\b/i.test(l));
  const url = text.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|io|co|app|studio|ai|watch|store|shop|xyz|net|org|dev|design|so|me)\b/i)?.[0];

  const name = text.match(/["“]([^"”]+)["”]/)?.[1] || text.match(/(?:for|called|named|launch(?:ing)?|introducing)\s+([A-Z][\w\-]+(?:\s[A-Z][\w\-]+)?)/)?.[1] || p.brand.name || "Your product";
  const productImg = assets.find((a) => a.source === "upload")?.id || assets[0]?.id;
  const gallery = assets.slice(0, 6).map((a) => a.id);

  // source lines: VO transcript sentences > user's lines > generic
  let lines: string[] = [];
  if (p.audio?.words?.length) lines = sentences(p.audio.words).map((s) => s.text);
  else {
    const body = text.replace(/^.*?:\s*/, "");
    lines = body
      .split(/(?<=[.!?])\s+|\n+|;\s*/)
      .map((s) => s.trim())
      .filter((s) => s.split(" ").length >= 2 && !isInstruction(s) && s !== ctaLine);
  }
  const feats = lines.filter((l) => /\b(with|no|zero|faster|better|more|less|all-day|up to|\d)/i.test(l)).slice(0, 3);

  const scenes: Omit<Scene, "id">[] = [];
  scenes.push({ template: "shape-burst", duration: 1.8, background: "dots", transition: "cut" });
  scenes.push({ template: "title-reveal", duration: 3, kicker: "Introducing", headline: emphasize(name), subline: p.audio?.words?.length && lines[0] ? short(lines[0], 12) : undefined, transition: "circle" });
  const beats = p.audio?.words?.length ? lines.slice(1) : lines;
  if (productImg) scenes.push({ template: "product-hero", duration: 3.4, image: productImg, headline: beats[0] ? emphasize(short(beats[0])) : `Meet *${name}*`, transition: "zoom" });
  beats.slice(productImg ? 1 : 0, 6).forEach((l, i) => {
    const num = l.match(/(\d+(?:\.\d+)?)\s*-?\s*(%|x|k|\+|days?|hours?|hrs?|weeks?|months?|years?|minutes?|mins?|grams?|g\b|mm\b)?/i);
    if (num && !p.audio) {
      const unit = (num[2] ?? "").toLowerCase();
      const plural = unit && unit.length > 2 && parseFloat(num[1]) !== 1 ? unit.replace(/s?$/, "s") : unit;
      scenes.push({ template: "stat-counter", duration: 2.8, stat: { value: parseFloat(num[1]), suffix: plural.length > 2 ? ` ${plural}` : plural, label: short(l.replace(num[0], "").replace(/^[\s-]+/, ""), 10) }, background: "invert", transition: "wipe" });
    }
    else if (i % 3 === 1 && gallery[i % gallery.length]) scenes.push({ template: "split-feature", duration: 3.2, image: gallery[i % gallery.length], kicker: `0${i + 1}`, headline: emphasize(short(l)), transition: "slide" });
    else scenes.push({ template: "kinetic-words", duration: Math.max(2.4, l.split(" ").length * 0.38), headline: emphasize(short(l, 9)), transition: "push-up" });
  });
  if (feats.length >= 2) scenes.push({ template: "feature-list", duration: 3.6, kicker: "Why it matters", items: feats.map((f) => short(f, 5)), transition: "fade" });
  if (gallery.length >= 3) scenes.push({ template: "image-mosaic", duration: 3, images: gallery, transition: "fade" });
  scenes.push({ template: "cta-end", duration: 3.4, headline: `Get *${name}*`, cta: /pre-?order/.test(t) ? "Pre-order now" : /download|app/.test(t) ? "Download now" : "Shop now", url, background: "gradient", transition: "zoom" });

  return {
    name: name !== p.brand.name && name !== "Your product" ? name : undefined,
    reply: `Here's a first cut for ${name}: a geometric hook, title reveal, ${productImg ? "product hero, " : ""}${scenes.length - 3} story beats and an end card${p.audio ? ", fitted to your voice-over" : ""}. (Local director — add an Anthropic key for the full Claude creative agent.)`,
    storyboard: { title: `${name} — launch`, style, aspect: settings.aspect, fit_to_voiceover: !!p.audio, scenes },
    style,
    settings,
  };
}
