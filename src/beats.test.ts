import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBeats, beatsInCut } from "./audio/beats";

/** A synthetic track: a kick on every beat (accented bar starts), hats between, quiet then loud at `dropAt`. */
function track(bpm: number, seconds: number, opts: { offset?: number; dropAt?: number; sr?: number } = {}) {
  const sr = opts.sr ?? 22050, x = new Float32Array(Math.floor(seconds * sr));
  const beat = 60 / bpm;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let k = 0, t = opts.offset ?? 0; t < seconds; k++, t += beat) {
    const loud = opts.dropAt === undefined || t >= opts.dropAt ? 1 : 0.25;
    const amp = (k % 4 === 0 ? 1 : 0.7) * loud;
    const i0 = Math.floor(t * sr);
    for (let i = 0; i < sr * 0.15 && i0 + i < x.length; i++) {
      const tt = i / sr;
      x[i0 + i] += amp * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 18);
    }
    const h0 = Math.floor((t + beat / 2) * sr);
    for (let i = 0; i < sr * 0.03 && h0 + i < x.length; i++) x[h0 + i] += 0.15 * loud * rnd() * Math.exp((-i / sr) * 120);
  }
  return { x, sr };
}

test("beats: finds the tempo of a steady track", () => {
  for (const bpm of [90, 110, 128, 150]) {
    const { x, sr } = track(bpm, 20, { offset: 0.37 });
    const m = detectBeats(x, sr)!;
    assert.ok(Math.abs(m.bpm - bpm) < 2, `bpm ${m.bpm} vs ${bpm}`);
    // beats land on the kicks (within 30 ms)
    const beat = 60 / bpm;
    const off = m.beats.map((b) => { const r = ((b - 0.37) % beat + beat) % beat; return Math.min(r, beat - r); });
    assert.ok(off.filter((o) => o < 0.03).length / off.length > 0.9, `on-beat ratio ${bpm}`);
  }
});

test("beats: bars start on the accented beat and the drop is found", () => {
  const { x, sr } = track(120, 40, { offset: 0.5, dropAt: 16.5 });
  const m = detectBeats(x, sr)!;
  // accented beats at 0.5 + 2k
  for (const d of m.downbeats.slice(1, 6)) assert.ok(Math.abs(((d - 0.5) % 2 + 2) % 2) < 0.04 || Math.abs(((d - 0.5) % 2 + 2) % 2 - 2) < 0.04, `downbeat ${d}`);
  assert.ok(m.drop !== undefined && Math.abs(m.drop - 16.5) < 0.1, `drop ${m.drop}`);
  assert.ok(m.energy[m.beats.findIndex((b) => b > 20)] > m.energy[m.beats.findIndex((b) => b > 5)] + 0.4);
});

test("beats: silence and tiny clips give nothing", () => {
  assert.equal(detectBeats(new Float32Array(22050 * 5), 22050), undefined);
  assert.equal(detectBeats(new Float32Array(1000), 22050), undefined);
});

test("beats: shifted by the start point and repeated when the music loops", () => {
  assert.deepEqual(beatsInCut({ beats: [0, 1, 2, 3], start: 1.5, duration: 4 }, 6), [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]);
  assert.deepEqual(beatsInCut({ beats: [0.5], start: 0 }, 3), [0.5]);
  assert.deepEqual(beatsInCut({ start: 0 }, 3), []);
});
