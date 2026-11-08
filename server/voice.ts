// Voice-over from a script (OpenAI text-to-speech). The studio then transcribes it like any
// uploaded voice-over, so every word has its timing.
const key = () => process.env.OPENAI_API_KEY?.trim() || "";
export const voiceAvailable = () => !!key();

export const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"] as const;
const TONES: Record<string, string> = {
  energetic: "An energetic, confident social ad read. Upbeat pace, a smile in the voice, punchy on key words.",
  warm: "A warm, friendly, trustworthy read, like recommending something to a friend. Natural pace.",
  calm: "Calm, soft and reassuring. Unhurried, with gentle pauses.",
  dramatic: "A cinematic trailer read. Low, slow and dramatic, with weight on every line and real pauses.",
  bold: "Bold and direct. Short, emphatic delivery that commands attention.",
};

/** Speak `text` in `voice`; returns MP3 bytes. Falls back to the classic model if the newer one isn't available. */
export async function speak(text: string, voice: string, tone: string): Promise<Buffer> {
  if (!key()) throw Object.assign(new Error("Voice generation needs OPENAI_API_KEY on the server."), { status: 503 });
  const input = text.replace(/\s+/g, " ").trim().slice(0, 1800);
  if (input.length < 2) throw Object.assign(new Error("Write a script first."), { status: 400 });
  const v = (VOICES as readonly string[]).includes(voice) ? voice : "nova";
  const attempts = [
    { model: "gpt-4o-mini-tts", voice: v, input, instructions: TONES[tone] ?? TONES.energetic, response_format: "mp3" },
    { model: "tts-1-hd", voice: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"].includes(v) ? v : "nova", input, response_format: "mp3" },
  ];
  let last = "";
  for (const body of attempts) {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    last = `${r.status} ${(await r.text()).slice(0, 200)}`;
    if (r.status === 401 || r.status === 429) break;
  }
  throw Object.assign(new Error(`The voice service refused: ${last}`), { status: 502 });
}
