import test from "node:test";
import assert from "node:assert/strict";
import { cleanCaptionStyle } from "./sanitize";
import { captionPhrases, CAPTION_DESIGNS } from "./engine/captions";

test("captions: style is cleaned to known values", () => {
  assert.deepEqual(cleanCaptionStyle({ design: "box", position: "top", size: "l", words: 99, color: "#FFE600", upper: true }), { design: "box", position: "top", size: "l", words: 8, color: "#FFE600", upper: true });
  assert.equal(cleanCaptionStyle({ design: "comic-sans", color: "red", words: 0 }), undefined);
  assert.deepEqual(cleanCaptionStyle({ highlight: false, color: "javascript:alert(1)" }), { highlight: false });
  assert.equal(cleanCaptionStyle("pill"), undefined);
  assert.ok(CAPTION_DESIGNS.length >= 8);
});

test("captions: phrases break at the word limit, punctuation and pauses", () => {
  const words = "One two three, four five six seven eight.".split(" ").map((w, i) => ({ w, s: i * 0.3 + (i >= 6 ? 1 : 0), e: i * 0.3 + 0.25 + (i >= 6 ? 1 : 0) }));
  assert.deepEqual(captionPhrases(words, 4).map((p) => p.map((w) => w.w).join(" ")), ["One two three,", "four five six", "seven eight."]);
  assert.deepEqual(captionPhrases(words, 1).length, 8);
});

test("captions: a dragged position is kept as fractions inside the frame; presets clear it", () => {
  assert.deepEqual(cleanCaptionStyle({ design: "pop", x: 0.31234, y: 1.7 }), { x: 0.312, y: 1, design: "pop" });
  assert.deepEqual(cleanCaptionStyle({ design: "pop", x: 0.3 }), { design: "pop" }, "half a position is no position");
  assert.deepEqual(cleanCaptionStyle({ position: "top", x: undefined, y: undefined }), { position: "top" });
});

test("captions: typed words are spread across the video in order, inside its length", async () => {
  const { spreadWords } = await import("./captionWords");
  const w = spreadWords("Look at this. A very extraordinary rabbit!", 6);
  assert.equal(w.length, 7);
  for (let i = 0; i < w.length; i++) {
    assert.ok(w[i].e > w[i].s && w[i].e <= 6, `word ${i} inside the video`);
    if (i) assert.ok(w[i].s >= w[i - 1].e, "in order, no overlap");
  }
  assert.ok(w[5].e - w[5].s > w[1].e - w[1].s, "longer words get longer");
  assert.deepEqual(spreadWords("   ", 5), []);
  assert.deepEqual(spreadWords("hi", 0), []);
});
