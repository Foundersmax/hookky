import type { Brand } from "./types";

export interface StylePreset {
  id: string;
  label: string;
  mood: string;
  brand: Omit<Brand, "name" | "logo">;
  defaultBackground: "solid" | "gradient" | "grid" | "dots" | "blobs";
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "swiss",
    label: "Swiss",
    mood: "Grid-driven, bold sans, warm paper, signal orange",
    brand: { bg: "#F3F0E9", fg: "#111111", accent: "#FF4D1A", muted: "#8A867D", fontDisplay: "Inter Tight", fontBody: "Inter", radius: 0 },
    defaultBackground: "grid",
  },
  {
    id: "noir",
    label: "Noir",
    mood: "Dark, high-contrast, electric lime accent, techy",
    brand: { bg: "#0B0B0C", fg: "#F4F4EF", accent: "#C8FF3D", muted: "#6E6E6A", fontDisplay: "Space Grotesk", fontBody: "Inter", radius: 999 },
    defaultBackground: "dots",
  },
  {
    id: "editorial",
    label: "Editorial",
    mood: "Serif headlines, magazine calm, cobalt ink",
    brand: { bg: "#EEEAE3", fg: "#1B1A18", accent: "#2F55FF", muted: "#8B867E", fontDisplay: "Instrument Serif", fontBody: "Inter", radius: 4 },
    defaultBackground: "solid",
  },
  {
    id: "aurora",
    label: "Aurora",
    mood: "Deep navy, soft glowing gradients, premium launch",
    brand: { bg: "#0C0D19", fg: "#FFFFFF", accent: "#8B6CFF", muted: "#7A7C99", fontDisplay: "Syne", fontBody: "DM Sans", radius: 24 },
    defaultBackground: "blobs",
  },
  {
    id: "clean",
    label: "Clean Tech",
    mood: "White space, crisp blue, product-first SaaS",
    brand: { bg: "#FFFFFF", fg: "#0A0A0A", accent: "#0A66FF", muted: "#8C8C8C", fontDisplay: "DM Sans", fontBody: "DM Sans", radius: 16 },
    defaultBackground: "solid",
  },
  {
    id: "mono",
    label: "Mono",
    mood: "Monospace, brutalist, black on bone",
    brand: { bg: "#E9E7E1", fg: "#0D0D0D", accent: "#0D0D0D", muted: "#77746D", fontDisplay: "JetBrains Mono", fontBody: "JetBrains Mono", radius: 0 },
    defaultBackground: "grid",
  },
  {
    id: "blush",
    label: "Blush",
    mood: "Soft beauty/lifestyle, rosy neutrals, elegant serif",
    brand: { bg: "#F6E9E4", fg: "#2A1E1B", accent: "#C8553D", muted: "#A08A83", fontDisplay: "Instrument Serif", fontBody: "DM Sans", radius: 999 },
    defaultBackground: "gradient",
  },
  {
    id: "midnight",
    label: "Midnight",
    mood: "Deep blue-black, sky-blue accent, crisp product UI",
    brand: { bg: "#070B14", fg: "#EAF2FF", accent: "#38BDF8", muted: "#5B6B86", fontDisplay: "Manrope", fontBody: "Inter", radius: 14 },
    defaultBackground: "grid",
  },
  {
    id: "terminal",
    label: "Terminal",
    mood: "Black screen, phosphor green, monospace, live data",
    brand: { bg: "#050805", fg: "#D7FFD9", accent: "#39FF88", muted: "#4F6B55", fontDisplay: "JetBrains Mono", fontBody: "JetBrains Mono", radius: 6 },
    defaultBackground: "grid",
  },
  {
    id: "sunset",
    label: "Sunset",
    mood: "Warm plum dusk, tangerine glow, friendly grotesk",
    brand: { bg: "#1A0F1F", fg: "#FFF1E6", accent: "#FF7A45", muted: "#8A6F7E", fontDisplay: "Bricolage Grotesque", fontBody: "DM Sans", radius: 20 },
    defaultBackground: "gradient",
  },
  {
    id: "pastel",
    label: "Pastel",
    mood: "Soft lilac, violet pop, rounded and playful",
    brand: { bg: "#F4F1FF", fg: "#1E1B3A", accent: "#7C5CFF", muted: "#8D88AD", fontDisplay: "Unbounded", fontBody: "DM Sans", radius: 22 },
    defaultBackground: "blobs",
  },
  {
    id: "forest",
    label: "Forest",
    mood: "Deep green, amber accent, considered serif",
    brand: { bg: "#0E1A14", fg: "#EEF5EC", accent: "#F2B544", muted: "#6A8172", fontDisplay: "Fraunces", fontBody: "Inter", radius: 12 },
    defaultBackground: "dots",
  },
];

/** Built-in typefaces, grouped for the font picker. Display faces are made for big animated type. */
export const FONT_GROUPS: { label: string; fonts: string[] }[] = [
  { label: "Display", fonts: ["Bebas Neue", "Anton", "Archivo Black", "Unbounded", "Syne", "Bricolage Grotesque"] },
  { label: "Sans", fonts: ["Inter Tight", "Inter", "Space Grotesk", "Manrope", "DM Sans"] },
  { label: "Serif", fonts: ["Instrument Serif", "Playfair Display", "DM Serif Display", "Fraunces"] },
  { label: "Character", fonts: ["Caveat", "JetBrains Mono"] },
];
export const FONT_CHOICES = FONT_GROUPS.flatMap((g) => g.fonts);

export function presetById(id: string): StylePreset {
  return STYLE_PRESETS.find((p) => p.id === id) ?? STYLE_PRESETS[0];
}
