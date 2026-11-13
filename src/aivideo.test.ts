import { test } from "node:test";
import assert from "node:assert/strict";
import { VIDEO_MODELS, buildInput, normalize, modelById, supports, onFal } from "./aivideo/models";

const IMG = "data:image/jpeg;base64,/9j/4AAQ";

test("the catalog is well formed", () => {
  const ids = new Set<string>();
  for (const m of VIDEO_MODELS) {
    assert.match(m.id, /^[a-z0-9-]{2,40}$/, m.id);
    assert.ok(!ids.has(m.id), `duplicate ${m.id}`);
    ids.add(m.id);
    assert.ok(m.t2v || m.i2v || m.direct?.modes?.length, `${m.id} runs somewhere`);
    if (!m.t2v && !m.i2v) assert.ok(m.direct, `${m.id}: a model without fal.ai needs its maker`);
    for (const e of [m.t2v, m.i2v]) if (e) assert.match(e, /^[a-z0-9-]+\/[A-Za-z0-9./-]+$/, e);
    if (m.durations) assert.deepEqual([...m.durations].sort((a, b) => a - b), m.durations);
  }
  for (const f of ["Seedance", "Kling", "MiniMax", "Veo", "Sora", "Wan", "Luma"]) assert.ok(VIDEO_MODELS.some((m) => m.family === f), f);
});

test("every model builds a text and an image request", () => {
  for (const m of VIDEO_MODELS)
    for (const mode of ["text", "image"] as const) {
      if (!supports(m, mode)) {
        assert.throws(() => buildInput({ model: m.id, mode, prompt: "a cat", image: IMG }), /doesn't do/);
        continue;
      }
      if (!onFal(m, mode)) {
        assert.throws(() => buildInput({ model: m.id, mode, prompt: "a cat", image: IMG }), /isn't on fal\.ai/);
        const n = normalize({ model: m.id, mode, prompt: "a cat", image: IMG, duration: 7 });
        assert.equal(n.prompt, "a cat");
        if (m.durations) assert.ok(m.durations.includes(n.duration!));
        continue;
      }
      const { endpoint, input } = buildInput({ model: m.id, mode, prompt: "  a   cat  ", image: IMG, endImage: IMG, aspect: "9:16", duration: 7, resolution: "1080p", audio: false, negative: "blur", seed: 7 });
      assert.equal(endpoint, mode === "text" ? m.t2v : m.i2v);
      assert.equal(input.prompt, "a cat");
      if (mode === "image") assert.equal(input[m.imageParam ?? "image_url"], IMG);
      else assert.ok(!("image_url" in input) && !("start_image_url" in input));
      if (m.durations) assert.ok(m.durations.includes(parseInt(String(input.duration))), `${m.id} duration ${input.duration}`);
      else assert.ok(!("duration" in input));
      if (!m.negative) assert.ok(!("negative_prompt" in input));
      if (!m.seed) assert.ok(!("seed" in input));
    }
});

test("each maker's own parameter names and value shapes", () => {
  const kling = buildInput({ model: "kling-3-pro", mode: "image", prompt: "x", image: IMG, endImage: IMG, duration: 9 }).input;
  assert.equal(kling.start_image_url, IMG);
  assert.equal(kling.end_image_url, IMG);
  assert.equal(kling.duration, "8");
  assert.equal(kling.generate_audio, true);
  assert.ok(!("aspect_ratio" in kling), "image to video follows the picture");
  assert.equal(buildInput({ model: "kling-25-turbo", mode: "image", prompt: "x", image: IMG, endImage: IMG }).input.tail_image_url, IMG);
  const veo = buildInput({ model: "veo-31", mode: "text", prompt: "x", duration: 8, aspect: "1:1", audio: false }).input;
  assert.equal(veo.duration, "8s");
  assert.equal(veo.aspect_ratio, "16:9", "an aspect the model lacks falls to its first");
  assert.equal(veo.generate_audio, false);
  assert.equal(veo.resolution, "720p");
  const pix = buildInput({ model: "pixverse-6", mode: "text", prompt: "x", duration: 8 }).input;
  assert.equal(pix.duration, 8);
  assert.equal(pix.generate_audio_switch, true);
  assert.equal(buildInput({ model: "ltx-23-fast", mode: "text", prompt: "x" }).input.resolution, "1080p");
  const hailuo = buildInput({ model: "hailuo-23-pro", mode: "text", prompt: "x", duration: 10, seed: 3 }).input;
  assert.deepEqual(hailuo, { prompt: "x" });
});

test("bad requests are refused in plain words", () => {
  assert.throws(() => buildInput({ model: "nope", mode: "text", prompt: "x" }), /isn't available/);
  assert.throws(() => buildInput({ model: "sora-2", mode: "text", prompt: "   " }), /Describe/);
  assert.throws(() => buildInput({ model: "sora-2", mode: "image", prompt: "x" }), /Add an image/);
  assert.throws(() => buildInput({ model: "sora-2", mode: "image", prompt: "x", image: "http://insecure/x.png" }), /Add an image/);
  assert.throws(() => buildInput({ model: "sora-2", mode: "image", prompt: "x", image: "data:text/html;base64,AAAA" }), /Add an image/);
  assert.throws(() => buildInput({} as never), /isn't available/);
  assert.equal(buildInput({ model: "sora-2", mode: "text", prompt: "x".repeat(5000) }).input.prompt, "x".repeat(2000));
  assert.equal(buildInput({ model: "veo-31", mode: "text", prompt: "x", seed: -4 }).input.seed, undefined);
  assert.ok(modelById("seedance-15-pro"));
});
