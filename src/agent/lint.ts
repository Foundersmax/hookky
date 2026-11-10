// Director's notes: reviews a storyboard the way a motion-design lead would.
// Pure (no DOM), so the studio, the hosted agent and the server agent all use the same rules.
import type { Asset, Brand, Scene } from "../types";
import { contrast } from "../engine/util";

export interface Note {
  /** scene index, or null for the whole cut */
  scene: number | null;
  level: "warn" | "tip";
  code: string;
  message: string;
}

export interface LintInput {
  scenes: Scene[];
  brand: Pick<Brand, "bg" | "fg" | "accent" | "logo" | "name">;
  assetIds?: Set<string>;
  audio?: { duration: number; pauses: { s: number; e: number }[]; hasWords?: boolean };
}

const words = (s?: string) => (s ? s.replace(/\*/g, "").trim().split(/\s+/).filter(Boolean).length : 0);
const IMAGE_TEMPLATES = new Set(["product-hero", "split-feature", "fullbleed", "device-mockup", "spotlight"]);
const HEADLINE_MAX: Record<string, number> = { "hero-type": 9, "word-slam": 10, scramble: 10, "zoom-through": 10, "letter-wave": 10, "outline-fill": 12, "flip-words": 10, typewriter: 14, "echo-stack": 8, "text-mask": 3, "word-stack": 8, "pov-caption": 12, rating: 22, quote: 22, "kinetic-words": 10, "feature-list": 5, "image-mosaic": 6, testimonials: 5, "before-after": 5 };
const READ_WPS = 3.2;
/** Text animations that carry a voice-over word by word: a run of one style is the design, not repetition. */
const VOICE_TYPE = new Set(["word-slam", "scramble", "zoom-through", "letter-wave", "outline-fill", "flip-words", "typewriter", "echo-stack"]); // comfortable on-screen reading speed, words per second

export function lintStoryboard({ scenes, brand, assetIds, audio }: LintInput): Note[] {
  const notes: Note[] = [];
  const add = (scene: number | null, level: Note["level"], code: string, message: string) => notes.push({ scene, level, code, message });
  const hasAsset = (ref?: string) => !!ref && (!assetIds || assetIds.has(ref) || /^(https?:|data:|blob:)/.test(ref));

  // whole-cut checks
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  if (contrast(brand.fg, brand.bg) < 4.5) add(null, "warn", "contrast", `Text and background colours are too close (contrast ${contrast(brand.fg, brand.bg).toFixed(1)}:1, aim for 4.5:1).`);
  if (audio && Math.abs(total - audio.duration) > 0.5)
    add(null, "warn", "vo-length", `The cut runs ${total.toFixed(1)}s but the voice-over is ${audio.duration.toFixed(1)}s. Fit the scenes to the voice-over.`);
  if (scenes.length >= 4 && !scenes.some((s) => s.template === "cta-end" || s.cta)) add(null, "tip", "no-cta", "There's no call to action. End on a cta-end card.");
  if (total > 62) add(null, "tip", "long", `At ${Math.round(total)}s this runs long for an ad; 15, 30 or 60 seconds is typical.`);
  if (scenes[0] && scenes[0].duration > 3.6 && !["shape-burst", "kinetic-words", "marquee"].includes(scenes[0].template))
    add(0, "tip", "hook", "Open faster: land the hook within the first 3 seconds.");
  if (audio && audio.pauses.length) {
    const mids = audio.pauses.map((p) => (p.s + p.e) / 2);
    let t = 0;
    const off: number[] = [];
    scenes.slice(0, -1).forEach((s, i) => {
      t += s.duration;
      // Footage cut on a spoken word is deliberate (the picture changes as the word lands).
      const onWord = !!(s.shot && scenes[i + 1]?.shot);
      if (!onWord && t < audio.duration - 0.3 && !mids.some((m) => Math.abs(m - t) <= 0.35)) off.push(i + 1);
    });
    if (off.length) add(null, "tip", "cuts-off-pause", `${off.length} cut${off.length > 1 ? "s land" : " lands"} mid-speech (after scene ${off.slice(0, 4).join(", ")}${off.length > 4 ? "…" : ""}). Snap cuts to pauses.`);
  }

  // effects: one look per ad, punctuation used as punctuation
  const graded = [...new Set(scenes.map((s) => s.grade).filter((g) => g && g !== "none"))];
  if (graded.length > 2) add(null, "tip", "fx-grades", `${graded.length} different colour grades across the cut. One grade on every scene reads as one campaign.`);
  const loud = scenes.filter((s) => s.effects?.some((e) => e === "flash" || e === "glitch" || e === "shake")).length;
  if (scenes.length >= 4 && loud / scenes.length > 0.6) add(null, "tip", "fx-overused", "Flash, glitch or shake on most cuts loses its punch. Keep them for two or three beats.");
  scenes.forEach((s, i) => {
    if (s.effects?.includes("confetti") && i < scenes.length - 2 && !s.cta && s.template !== "stat-counter") add(i, "tip", "fx-confetti", `Scene ${i + 1}: confetti lands best on the payoff (a stat, the offer or the end card).`);
    if (s.effects?.includes("focus-pull") && s.duration < 1.6) add(i, "tip", "fx-short", `Scene ${i + 1}: a focus pull needs about 1.6 s to read.`);
  });

  // per-scene checks
  scenes.forEach((s, i) => {
    const n = i + 1;
    const hw = words(s.headline);
    const max = HEADLINE_MAX[s.template] ?? 6;
    if (hw > max) add(i, "warn", "headline-long", `Scene ${n}: the headline is ${hw} words. Cut it to ${max} or fewer.`);
    if (words(s.subline) > 14) add(i, "tip", "subline-long", `Scene ${n}: the subline is ${words(s.subline)} words. Keep it under 14.`);
    const em = (s.headline?.match(/\*[^*]+\*/g) ?? []).length;
    if (em > 2) add(i, "tip", "emphasis", `Scene ${n}: ${em} accent highlights. One or two keeps the emphasis meaningful.`);

    if (IMAGE_TEMPLATES.has(s.template) && !hasAsset(s.image)) add(i, "warn", "image-missing", `Scene ${n} (${s.template}) has no image, so it shows a placeholder.`);
    if (s.backdrop?.length) {
      const gone = s.backdrop.filter((r) => !hasAsset(r)).length;
      if (gone) add(i, "warn", "backdrop-missing", `Scene ${n}: ${gone} background banner${gone > 1 ? "s are" : " is"} missing from the library.`);
      if (s.duration / s.backdrop.length < 1.2) add(i, "tip", "backdrop-fast", `Scene ${n}: ${s.backdrop.length} banners in ${s.duration.toFixed(1)}s change too fast to read. Lengthen the scene or spread the banners across scenes.`);
    }
    if (s.template === "image-mosaic") {
      const k = (s.images ?? []).filter(hasAsset).length || (hasAsset(s.image) ? 1 : 0);
      if (k < 3) add(i, "warn", "mosaic-thin", `Scene ${n}: the mosaic has ${k} image${k === 1 ? "" : "s"}. Give it 3 to 6.`);
    }
    if (s.template === "feature-list") {
      const items = s.items ?? [];
      if (items.length < 2) add(i, "warn", "items", `Scene ${n}: a feature list needs 2 to 4 items.`);
      else if (items.length > 4) add(i, "tip", "items", `Scene ${n}: ${items.length} items is a lot to read. Keep it to 4.`);
      const longItem = items.findIndex((it) => words(it) > 5);
      if (longItem >= 0) add(i, "tip", "item-long", `Scene ${n}: item ${longItem + 1} is ${words(items[longItem])} words. Keep items to 5 or fewer.`);
    }
    if (s.template === "stat-counter" && !s.stat) add(i, "warn", "stat-missing", `Scene ${n}: the stat counter has no number.`);
    if (s.template === "price-card" && !s.stat) add(i, "warn", "price-missing", `Scene ${n}: the price card has no price.`);
    if (s.template === "price-card" && (s.items?.length ?? 0) > 4) add(i, "tip", "items", `Scene ${n}: the price card shows 4 features at most.`);
    if (s.template === "testimonials" && (s.items?.length ?? 0) < 2) add(i, "warn", "quotes", `Scene ${n}: testimonials need 2 or 3 quotes, one per line.`);
    if (s.template === "before-after") {
      const k = (s.images ?? []).filter(hasAsset).length;
      if (k < 2) add(i, "warn", "before-after", `Scene ${n}: before/after needs two images (it has ${k}).`);
    }
    if (s.template === "countdown" && s.duration < (Math.round(s.stat?.value ?? 3) + 1) * 0.7) add(i, "tip", "countdown-fast", `Scene ${n}: the countdown ticks faster than one beat every 0.7s. Give it more time or count from a lower number.`);
    if (s.template === "logo-reveal" && !hasAsset(s.image || brand.logo) && !brand.name && !s.headline) add(i, "tip", "logo-missing", `Scene ${n}: the logo reveal has no logo or brand name.`);
    if (s.template === "cta-end" && !s.cta) add(i, "warn", "cta-missing", `Scene ${n}: the end card has no button text.`);
    if (s.template === "logo-sting" && !hasAsset(s.image || brand.logo) && !brand.name) add(i, "tip", "logo-missing", `Scene ${n}: the logo sting has no logo or brand name.`);
    if (s.template === "kinetic-words" && audio && !audio.hasWords) add(i, "tip", "no-transcript", `Scene ${n}: paste the script in the Voice tab so the words sync to speech.`);
    if (s.accent && contrast(s.accent, s.background === "invert" ? brand.fg : brand.bg) < 2) add(i, "tip", "accent-contrast", `Scene ${n}: the accent colour barely shows against the background.`);

    // reading time: text that's on screen too briefly to read (the small kicker label is glanced, not read)
    const textWords = hw + words(s.subline) + (s.items ?? []).reduce((a, it) => a + words(it), 0) + words(s.stat?.label);
    // Chats and notifications reveal one line at a time: each needs about a second to land.
    const staged = s.template === "chat" || s.template === "notification";
    const needed = staged ? 0.6 + (s.items?.length ?? 0) * 1.1 + hw / READ_WPS : textWords / READ_WPS + 0.8;
    if (!["kinetic-words", "word-slam", "scramble", "zoom-through", "letter-wave", "outline-fill", "flip-words", "typewriter", "echo-stack"].includes(s.template) && textWords && s.duration < needed) {
      const short = s.duration < needed * 0.8;
      add(i, short ? "warn" : "tip", "too-fast", `Scene ${n}: ${textWords} words in ${s.duration.toFixed(1)}s ${short ? "is too quick to read" : "is a little quick"}. Give it about ${needed.toFixed(1)}s or trim the copy.`);
    }
    if (s.duration > 7 && s.template !== "kinetic-words") add(i, "tip", "too-slow", `Scene ${n} holds for ${s.duration.toFixed(1)}s. Consider splitting it.`);

    // Footage cut back to back is an edit, not repetition; the rule is for designed scenes.
    if (i >= 2 && scenes[i - 1].template === s.template && scenes[i - 2].template === s.template && !(s.shot && scenes[i - 1].shot && scenes[i - 2].shot) && !VOICE_TYPE.has(s.template))
      add(i, "tip", "repeat", `Scenes ${n - 2}–${n} all use ${s.template}. Vary the template to keep the rhythm.`);
  });

  return notes.sort((a, b) => (a.level === b.level ? (a.scene ?? -1) - (b.scene ?? -1) : a.level === "warn" ? -1 : 1));
}

/** Notes as plain text for the agent, capped so tool results stay small. */
export function notesForAgent(notes: Note[], max = 8): string {
  if (!notes.length) return "Director's notes: none. The cut passes review.";
  const lines = notes.slice(0, max).map((n, i) => `${i + 1}. [${n.level}] ${n.message}`);
  const more = notes.length > max ? `\n(+${notes.length - max} more)` : "";
  return `Director's notes (${notes.filter((n) => n.level === "warn").length} warnings, ${notes.filter((n) => n.level === "tip").length} tips):\n${lines.join("\n")}${more}\nFix the warnings with update_scenes unless you have a creative reason to keep them, then tell the user briefly.`;
}

export function lintAssets(assets: Asset[]) {
  return new Set(assets.map((a) => a.id));
}
