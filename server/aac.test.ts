// The export's AAC conversion: Opus/WAV in, ADTS out that splits into 1024-sample AAC-LC frames.
import test from "node:test";
import assert from "node:assert/strict";
import { toAac } from "./aac";
import { parseAdts } from "../src/adts";

/** A 1-second 48 kHz stereo 16-bit WAV of a 440 Hz tone. */
function wav(seconds = 1) {
  const sr = 48000, n = sr * seconds, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 12000);
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test("aac: a second of sound becomes ~47 AAC-LC frames at 48 kHz stereo", async () => {
  const out = await toAac(wav(1));
  const a = parseAdts(new Uint8Array(out));
  assert.ok(a, "parses as ADTS");
  assert.equal(a!.sampleRate, 48000);
  assert.equal(a!.channels, 2);
  assert.deepEqual([...a!.asc], [0x11, 0x90], "AudioSpecificConfig: AAC-LC, 48 kHz, stereo");
  // 48000 / 1024 = 46.9 frames, plus the encoder's priming frame
  assert.ok(a!.frames.length >= 47 && a!.frames.length <= 49, `${a!.frames.length} frames`);
});

test("aac: garbage and empty input are refused with a message, not a crash", async () => {
  await assert.rejects(toAac(Buffer.alloc(0)), /No audio/);
  await assert.rejects(toAac(Buffer.from("this is not audio at all, just some text")), /couldn't be converted/);
});

test("adts: a stream that isn't ADTS parses as null", () => {
  assert.equal(parseAdts(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), null);
});
