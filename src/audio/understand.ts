// The last listening step: what the audio means for the ad. Claude reads the transcript and the
// analysis when it's available; otherwise the studio reads them itself.
import type { AudioTrack, MusicTrack } from "../types";
import { briefFrom } from "./insight";
import { FORMATS, recommend, type Brief } from "../formats";

export interface Understanding {
  brief: Partial<Brief>;
  recommended: { id: string; why: string }[];
  by: "claude" | "studio";
  note?: string;
}

export async function understand(voice: AudioTrack | undefined, music: MusicTrack | undefined, askClaude: boolean): Promise<Understanding> {
  const text = voice?.words?.map((w) => w.w).join(" ") ?? "";
  const local = (): Understanding => {
    const b = voice?.insight ? briefFrom(voice.insight) : { benefits: [] as string[] };
    return {
      brief: { ...b, benefits: b.benefits },
      recommended: recommend(voice?.insight ? { ...voice.insight, text } : undefined, music?.insight, "offer" in b ? (b as { offer?: string }).offer : undefined),
      by: "studio",
    };
  };
  if (!askClaude || !text) return local();
  try {
    const v = voice?.insight;
    const r = await fetch("/api/listen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: text,
        voice: v && { seconds: voice!.duration, wpm: v.wpm, pace: v.pace, mood: v.mood, stressed: v.stressedWords, dramaticPauses: v.dramatic.length, hook: v.hook, cta: v.cta },
        music: music?.insight && { bpm: music.bpm, mood: music.insight.mood, sections: music.insight.sections.map((s) => s.kind), drop: music.drop },
        formats: FORMATS.map((f) => ({ id: f.id, name: f.name, section: f.section, hook: f.hook })),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.brief) return { ...local(), note: j.error };
    const loc = local();
    return { brief: j.brief, recommended: j.recommended?.length ? j.recommended : loc.recommended, by: "claude" };
  } catch (e: any) {
    return { ...local(), note: e?.message };
  }
}
