// AAC in ADTS framing (what ffmpeg streams): the raw frames an MP4 needs, and their decoder config.

/** Split an ADTS stream into raw AAC frames, with the AudioSpecificConfig from its first header. */
export function parseAdts(buf: Uint8Array): { frames: Uint8Array[]; asc: Uint8Array; sampleRate: number; channels: number } | null {
  const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const frames: Uint8Array[] = [];
  let asc: Uint8Array | null = null, sampleRate = 0, channels = 0;
  for (let i = 0; i + 7 <= buf.length; ) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xf6) !== 0xf0) return frames.length ? { frames, asc: asc!, sampleRate, channels } : null;
    const protAbsent = buf[i + 1] & 1;
    const profile = (buf[i + 2] >> 6) + 1; // audio object type
    const fi = (buf[i + 2] >> 2) & 0xf;
    const ch = ((buf[i + 2] & 1) << 2) | (buf[i + 3] >> 6);
    const len = ((buf[i + 3] & 3) << 11) | (buf[i + 4] << 3) | (buf[i + 5] >> 5);
    const head = protAbsent ? 7 : 9;
    if (len <= head || i + len > buf.length) break;
    if (!asc) {
      sampleRate = RATES[fi] ?? 48000;
      channels = ch;
      asc = new Uint8Array([(profile << 3) | (fi >> 1), ((fi & 1) << 7) | (ch << 3)]);
    }
    frames.push(buf.subarray(i + head, i + len));
    i += len;
  }
  return frames.length && asc ? { frames, asc, sampleRate, channels } : null;
}
