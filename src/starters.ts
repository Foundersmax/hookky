// Starter kits for new projects. Each is a complete storyboard that passes Director's notes.
import type { Project, Scene } from "./types";
import { presetById } from "./presets";
import { uid } from "./engine/util";

export interface Starter {
  id: string;
  name: string;
  blurb: string;
  build: () => Project;
}

const make = (title: string, style: string, aspect: Project["aspect"], name: string, scenes: Omit<Scene, "id">[], extra: Partial<Project> = {}): Project => ({
  id: uid("p"),
  title,
  aspect,
  style,
  brand: { name, ...presetById(style).brand },
  captions: false,
  grain: true,
  scenes: scenes.map((s) => ({ ...s, id: uid() })),
  ...extra,
});

export const STARTERS: Starter[] = [
  {
    id: "launch",
    name: "Product launch",
    blurb: "16:9 · Swiss · hook, reveal, three benefits, a stat, end card",
    build: () =>
      make("Product launch", "swiss", "16:9", "Orbit", [
        { template: "shape-burst", duration: 1.8, background: "grid", transition: "cut" },
        { template: "title-reveal", duration: 3.6, kicker: "Introducing", headline: "Meet *Orbit*", subline: "The watch that knows you.", transition: "circle" },
        { template: "product-hero", duration: 3.4, headline: "Titanium *light*", transition: "zoom" },
        { template: "feature-list", duration: 4.8, kicker: "Why it matters", headline: "Built for every day", items: ["Ten-day battery", "Sleep coaching", "Titanium body"], transition: "push-up" },
        { template: "stat-counter", duration: 3, kicker: "Battery", stat: { value: 10, suffix: " days", label: "on one charge" }, background: "invert", transition: "wipe" },
        { template: "cta-end", duration: 3.6, headline: "Pre-order *Orbit*", cta: "Pre-order now", url: "orbit.watch", background: "gradient", transition: "zoom" },
      ]),
  },
  {
    id: "reel",
    name: "Vertical reel",
    blurb: "9:16 · Blush · kinetic type for Reels, TikTok and Shorts",
    build: () =>
      make("Vertical reel", "blush", "9:16", "Lumière", [
        { template: "kinetic-words", duration: 2.8, headline: "Your skin, *rested*.", background: "gradient", transition: "cut" },
        { template: "title-reveal", duration: 3.9, kicker: "New", headline: "The *night* serum", subline: "Wake up to calm, even skin.", transition: "push-up" },
        { template: "product-hero", duration: 3.2, headline: "Clean formula", transition: "zoom" },
        { template: "quote", duration: 4.6, headline: "My skin has never looked this calm.", author: "Maya, early tester", transition: "fade" },
        { template: "cta-end", duration: 3.4, headline: "Shop the *drop*", cta: "Shop now", url: "lumiere.co", background: "gradient", transition: "zoom" },
      ], { captions: true }),
  },
  {
    id: "voiceover",
    name: "Voice-over ad",
    blurb: "16:9 · Noir · upload a voice-over and the cuts follow it",
    build: () =>
      make("Voice-over ad", "noir", "16:9", "Signal", [
        { template: "shape-burst", duration: 2, background: "dots", transition: "cut" },
        { template: "kinetic-words", duration: 4, headline: "Every word *lands*.", transition: "circle" },
        { template: "split-feature", duration: 4.4, kicker: "Synced", headline: "Cuts on your *pauses*", subline: "Upload a voice-over in the Voice tab.", transition: "slide" },
        { template: "marquee", duration: 3, headline: "Motion that listens", transition: "push-up" },
        { template: "cta-end", duration: 3.6, headline: "Make it *move*", cta: "Get started", url: "rookker.com", background: "blobs", transition: "zoom" },
      ]),
  },
  {
    id: "blank",
    name: "Blank",
    blurb: "An empty canvas: brief the agent or add your first scene",
    build: () => make("Untitled project", "noir", "16:9", "", [], { grain: false }),
  },
];
