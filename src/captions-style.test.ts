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
