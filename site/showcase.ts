// The promo storyboard the landing page plays live with the Hookky engine.
import type { Project } from "../src/types";
import { STYLE_PRESETS } from "../src/presets";

const noir = STYLE_PRESETS.find((p) => p.id === "noir")!;

export const showcase: Project = {
  id: "showcase",
  title: "Hookky",
  aspect: "16:9",
  style: "noir",
  brand: { name: "Hookky", ...noir.brand },
  captions: false,
  grain: true,
  scenes: [
    { id: "s1", template: "shape-burst", duration: 1.8, background: "dots", transition: "cut" },
    { id: "s2", template: "title-reveal", duration: 3.4, kicker: "Launch week", headline: "Ads that *move*.", subline: "From a brief to a finished cut.", background: "dots", transition: "circle" },
    { id: "s3", template: "kinetic-words", duration: 3, headline: "Brief. Voice-over. *Done.*", background: "solid", transition: "push-up" },
    { id: "s4", template: "feature-list", duration: 4.6, kicker: "In the studio", headline: "Built for launches", items: ["Chat your *brief*", "Sync to the voice-over", "Export every format"], background: "grid", transition: "slide" },
    { id: "s5", template: "stat-counter", duration: 3, kicker: "One storyboard", stat: { value: 4, label: "formats, laid out for you" }, background: "invert", transition: "wipe" },
    { id: "s6", template: "cta-end", duration: 3.6, headline: "Make it *move*", cta: "Open the studio", url: "hookky", background: "blobs", transition: "zoom" },
  ],
};
