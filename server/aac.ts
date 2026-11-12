// AAC for exports from browsers that can't encode it (Chromium on Linux, Firefox): the studio
// sends the export's mixed audio as a small Opus-in-MP4 file; this returns it as AAC (ADTS) so
// the MP4 plays everywhere (QuickTime, iOS Photos, Instagram, TikTok). The video never leaves
// the user's machine.
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
/** The bundled ffmpeg (ffmpeg-static), else one on PATH. */
function ffmpegPath(): string {
  try {
    const p = require("ffmpeg-static") as string | null;
    if (p) return p;
  } catch {}
  return "ffmpeg";
}

let available: boolean | undefined;
/** Whether exports can get AAC from this server (ffmpeg runs). Checked once. */
export function aacAvailable(): boolean {
  if (available === undefined) {
    try {
      available = spawnSync(ffmpegPath(), ["-hide_banner", "-version"], { timeout: 5000 }).status === 0;
    } catch {
      available = false;
    }
  }
  return available;
}

const MAX_BYTES = 30 * 1024 * 1024; // ~20 min of 192 kbps audio

/** Opus/any audio in → AAC-LC 192 kbps stereo 48 kHz, as an ADTS stream. */
export function toAac(input: Buffer, timeoutMs = 60_000): Promise<Buffer> {
  if (!input.length) return Promise.reject(new Error("No audio sent."));
  if (input.length > MAX_BYTES) return Promise.reject(new Error("That audio is too long to convert."));
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-f", "adts", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => {
      ff.kill("SIGKILL");
      reject(new Error("The audio conversion took too long."));
    }, timeoutMs);
    ff.stdout.on("data", (d: Buffer) => out.push(d));
    ff.stderr.on("data", (d: Buffer) => (err += d.toString()).slice(-2000));
    ff.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg isn't available here (${e.message}).`));
    });
    ff.on("close", (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(out);
      if (code === 0 && buf.length) resolve(buf);
      else reject(new Error(`The audio couldn't be converted${err ? `: ${err.trim().split("\n").pop()}` : "."}`));
    });
    ff.stdin.on("error", () => {}); // ffmpeg may close stdin early on bad input; the close handler reports it
    ff.stdin.end(input);
  });
}
