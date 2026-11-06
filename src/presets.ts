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
];

export const FONT_CHOICES = ["Inter", "Inter Tight", "Space Grotesk", "Instrument Serif", "Syne", "DM Sans", "JetBrains Mono", "Fraunces", "Manrope"];

export function presetById(id: string): StylePreset {
  return STYLE_PRESETS.find((p) => p.id === id) ?? STYLE_PRESETS[0];
}
