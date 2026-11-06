// Speech-to-text with word timestamps for voice-over sync.
import type { Word } from "../src/types";

export function transcriptionProvider(): "deepgram" | "whisper" | "none" {
  if (process.env.DEEPGRAM_API_KEY) return "deepgram";
  if (process.env.OPENAI_API_KEY) return "whisper";
  return "none";
}

export async function transcribe(buf: Buffer, mime: string, filename: string): Promise<{ words: Word[]; text: string; provider: string }> {
  const provider = transcriptionProvider();
  if (provider === "deepgram") {
    const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true", {
      method: "POST",
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": mime },
      body: new Uint8Array(buf),
    });
    if (!r.ok) throw new Error(`Deepgram ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const alt = (await r.json())?.results?.channels?.[0]?.alternatives?.[0];
    const words: Word[] = (alt?.words ?? []).map((w: any) => ({ w: w.punctuated_word || w.word, s: w.start, e: w.end }));
    return { words, text: alt?.transcript ?? "", provider };
  }
  if (provider === "whisper") {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buf)], { type: mime }), filename || "voiceover.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    return { words: (d.words ?? []).map((w: any) => ({ w: w.word, s: w.start, e: w.end })), text: d.text ?? "", provider };
  }
  throw new Error("No transcription provider configured (set DEEPGRAM_API_KEY or OPENAI_API_KEY), or paste the script instead.");
}
