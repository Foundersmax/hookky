// Tests the server agent's tool layer without calling the Claude API: edits applied to the
// shadow storyboard, voice-over fitting, brand validation and the Director's notes it returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { __test } from "./agent";
import type { AgentEvent } from "../src/types";

const { Shadow, runTool } = __test;
const clientState = {
  project: { title: "t", aspect: "16:9", style: "noir", brand: { name: "Orbit", bg: "#0B0B0C", fg: "#F4F4EF", accent: "#C8FF3D" } },
  scenes: [{ index: 0, template: "title-reveal", duration: 3, headline: "Hello" }],
  assets: [{ id: "asset:up_1" }],
  voiceover: { duration: 20, pauses: [[4.8, 5.4], [9.7, 10.3], [14.6, 15.2]], sentences: [{ s: 0, e: 4.8, text: "Hi." }] },
};

test("create_storyboard fits the shadow to the voice-over and returns notes", async () => {
  const shadow = new Shadow(clientState);
  const events: AgentEvent[] = [];
  const out = await runTool(
    "create_storyboard",
    { fit_to_voiceover: true, scenes: [{ template: "title-reveal", duration: 3, headline: "Meet *Orbit*" }, { template: "product-hero", duration: 3 }, { template: "cta-end", duration: 3, cta: "Buy" }] },
    (e) => events.push(e),
    shadow,
  );
  assert.equal(events[0].type, "storyboard");
  const total = shadow.scenes.reduce((a, s) => a + s.duration, 0);
  assert.ok(Math.abs(total - 20) < 0.02, `fitted total ${total}`);
  assert.match(out, /fitted to the voice-over/);
  assert.match(out, /Director's notes/);
  assert.match(out, /Scene 2 \(product-hero\) has no image/);
});

test("update_scenes edits the shadow, and fixing the issue clears the note", async () => {
  const shadow = new Shadow(clientState);
  await runTool("create_storyboard", { scenes: [{ template: "product-hero", duration: 3 }, { template: "cta-end", duration: 3, cta: "Buy" }] }, () => {}, shadow);
  const out = await runTool("update_scenes", { ops: [{ op: "update", index: 0, scene: { image: "asset:up_1" } }] }, () => {}, shadow);
  assert.equal(shadow.scenes[0].image, "asset:up_1");
  assert.doesNotMatch(out, /has no image/);
});

test("set_brand drops invalid colours and says so", async () => {
  const shadow = new Shadow(clientState);
  const events: AgentEvent[] = [];
  const out = await runTool("set_brand", { accent: "neon", bg: "#ffffff", fg: "#fefefe" }, (e) => events.push(e), shadow);
  const brandEvent = events.find((e) => e.type === "brand") as Extract<AgentEvent, { type: "brand" }>;
  assert.deepEqual(brandEvent.brand, { bg: "#ffffff", fg: "#fefefe" });
  assert.match(out, /Ignored invalid values for: accent/);
  assert.match(out, /contrast/, "near-identical text and background is flagged");
});

test("the shadow tolerates a malformed studio state", () => {
  for (const st of [null, undefined, 7, { scenes: "x", voiceover: { duration: "a" } }, { scenes: [null, { template: 3 }] }]) {
    const s = new Shadow(st);
    assert.ok(Array.isArray(s.scenes));
    assert.match(s.review(), /Director's notes/);
  }
});

test("propose_directions sends cleaned cards and tells Claude to wait", async () => {
  const shadow = new Shadow(clientState);
  const events: AgentEvent[] = [];
  const out = await runTool(
    "propose_directions",
    {
      directions: [
        { name: "Bold & graphic", pitch: "Big type.", style: "swiss", motion: "snappy", pace: "punchy", hook: "Meet *Orbit*", accent: "#FF4D1A" },
        { name: "Cinematic", pitch: "Slow glow.", style: "not-a-style", motion: "warp", pace: "slow", hook: "Orbit is here", accent: "red" },
        { name: "Calm", pitch: "Air.", style: "clean", motion: "smooth", pace: "steady", hook: "Breathe *easy*" },
        { name: "Extra", hook: "Ignored fourth" },
      ],
    },
    (e) => events.push(e),
    shadow,
  );
  assert.equal(events.length, 1);
  const ev = events[0] as Extract<AgentEvent, { type: "directions" }>;
  assert.equal(ev.type, "directions");
  assert.equal(ev.directions.length, 3);
  assert.deepEqual([ev.directions[1].style, ev.directions[1].motion, ev.directions[1].pace, ev.directions[1].accent], ["noir", "snappy", "steady", undefined]);
  assert.equal(ev.directions[0].accent, "#FF4D1A");
  assert.match(out, /Don't build yet/);
  assert.equal(shadow.scenes.length, 1, "pitching doesn't touch the storyboard");
});

test("propose_directions rejects empty pitches", async () => {
  await assert.rejects(runTool("propose_directions", { directions: [{ pitch: "no name or hook" }] }, () => {}, new Shadow(clientState)), /3 directions/);
});

test("turnContent attaches valid contact sheets before the studio state and drops bad ones", () => {
  const { turnContent } = __test;
  const content = turnContent({
    conversationId: "c",
    text: "Visual review.",
    state: { a: 1 },
    frames: [
      { mediaType: "image/jpeg", data: "AAAA" },
      { mediaType: "text/html", data: "PGgxPg==" },
      { mediaType: "image/png", data: "" },
      { mediaType: "image/png", data: "BBBB" },
    ],
  });
  const kinds = content.map((b) => (b.type === "text" ? `text:${b.text.slice(0, 24)}` : b.type));
  assert.deepEqual(kinds, ["text:Rendered frames, contact", "image", "text:Rendered frames, contact", "image", "text:<studio_state>\n{\"a\":1}\n<", "text:Visual review."]);
  assert.match((content[2] as { text: string }).text, /2 of 2/);
});

test("set_brand applies a saved brand kit by name and reports unknown ones", async () => {
  const shadow = new Shadow({ ...clientState, brand_kits: [{ name: "Acme", style: "swiss", brand: { bg: "#F3F0E9", fg: "#111111", accent: "#FF4D1A", fontDisplay: "Fraunces" } }] });
  const events: AgentEvent[] = [];
  const out = await runTool("set_brand", { kit: "acme kit" }, (e) => events.push(e), shadow);
  assert.deepEqual(events[0], { type: "kit", name: "Acme" });
  assert.match(out, /Applied the "Acme" kit/);
  assert.deepEqual([shadow.style, shadow.brand.accent, shadow.brand.fontDisplay], ["swiss", "#FF4D1A", "Fraunces"]);
  const miss = await runTool("set_brand", { kit: "Orbit" }, () => {}, shadow);
  assert.match(miss, /No brand kit called "Orbit" \(kits: Acme\)/);
});
