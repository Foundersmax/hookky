import { CaptionControls } from "./CaptionControls";
import { useRef, useState } from "react";
import { useStudio, setAudio, getState, setState, updateProject, fitToVoiceover } from "../store";
import { alignScript } from "../audio/analyze";
import { prepareVoice, type OnStages, type Stage } from "../audio/prepare";
import { StageList, VoiceReport } from "./AudioLab";
import { clock, useClock } from "../clock";
import { sendToAgent } from "../agent/client";
import { Icon } from "./Icon";
import { MusicControls, Slider } from "./MusicControls";
import { fmt } from "./Stage";

/** Listen to a voice-over in full (words, stress, pace, mood, message) and attach it to the project. */
export async function ingestVoiceover(file: File, onStages?: OnStages) {
  const track = await prepareVoice(file, onStages ?? (() => {}), getState().health?.transcription !== "none");
  if (track.duration > 120) console.warn("Voice-over longer than 2 minutes");
  setAudio(track);
}

export function VoicePanel({ toast }: { toast: (s: string) => void }) {
  const audio = useStudio((s) => s.project.audio);
  const music = useStudio((s) => s.project.music);
  const health = useStudio((s) => s.health);
  const captions = useStudio((s) => s.project.captions);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState<Stage[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const c = useClock();

  async function onFile(f?: File) {
    if (!f) return;
    setBusy(true);
    try {
      await ingestVoiceover(f, setStages);
      const a = getState().project.audio!;
      toast(`Voice-over ${a.duration.toFixed(1)}s · ${a.pauses.length} pauses${a.words ? ` · ${a.words.length} words transcribed` : ""}`);
    } catch (e: any) {
      toast(`Couldn't read audio: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!audio ? (
        <div className="drop" onClick={() => fileRef.current?.click()}>
          <Icon name="mic" /> <b>Upload voice-over</b>
          <div className="tiny" style={{ marginTop: 4 }}>MP3 / WAV / M4A · 30s–1min works best</div>
        </div>
      ) : (
        <div className="card">
          <h4>{audio.name}</h4>
          <div className="muted">
            {audio.duration.toFixed(1)}s · {audio.pauses.length} natural pauses · {audio.words ? `${audio.words.length} words (${audio.wordsSource})` : "no transcript yet"}
          </div>
          <Slider label="Volume" value={audio.volume ?? 1} min={0} max={1.5} step={0.01} show={`${Math.round((audio.volume ?? 1) * 100)}%`} onChange={(volume) => updateProject((p) => (p.audio ? { ...p, audio: { ...p.audio, volume } } : p))} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>Replace</button>
            <button className="btn ghost" onClick={() => setAudio(undefined)}>Remove</button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" hidden accept="audio/*" onChange={(e) => onFile(e.target.files?.[0])} />

      {busy && stages && <StageList title="Listening to the voice-over" stages={stages} />}
      {audio?.insight && !busy && <VoiceReport track={audio} />}
      {audio && (
        <>
          <div className="field">
            <label>Script {health?.transcription === "none" ? "(paste for word sync)" : "(optional — overrides transcript)"}</label>
            <textarea rows={5} placeholder="Paste the exact voice-over script. Words are aligned to the speech in the audio." value={script} onChange={(e) => setScript(e.target.value)} />
            <button
              className="btn"
              disabled={!script.trim()}
              onClick={() => {
                const words = alignScript(script, audio);
                setAudio({ ...audio, words, wordsSource: "script-estimate" });
                toast(`Aligned ${words.length} words to speech`);
              }}
            >
              Align script to audio
            </button>
            {health?.transcription === "none" && <span className="tiny">Add DEEPGRAM_API_KEY or OPENAI_API_KEY to transcribe automatically with exact word timings.</span>}
          </div>
          {audio.words && (
            <div className="field">
              <label>Words · click to seek</label>
              <div className="word-strip">
                {audio.words.map((w, i) => (
                  <span key={i} className={c.time >= w.s && c.time <= w.e ? "on" : ""} onClick={() => clock.seek(w.s)} title={fmt(w.s)}>
                    {w.w}
                  </span>
                ))}
              </div>
            </div>
          )}
          <button className="btn primary" disabled={busy || getState().busy} onClick={() => sendToAgent("Storyboard an animated ad that follows my voice-over line by line, in sync. Use kinetic type for punchy lines and visuals for product beats.")}>
            <Icon name="sparkle" /> Auto-animate this voice-over
          </button>
          <button className="btn" onClick={() => (updateProject((p) => ({ ...p, scenes: fitToVoiceover(p.scenes, audio) })), toast("Scenes fitted and snapped to pauses"))}>
            Fit current scenes to voice-over
          </button>
          <label className="toggle">
            <input type="checkbox" checked={captions} onChange={(e) => updateProject((p) => ({ ...p, captions: e.target.checked }))} />
            Burn-in captions
          </label>
          {captions && <CaptionControls />}
        </>
      )}

      <button className="btn" onClick={() => setState({ sheet: "footage" })}>
        <Icon name="clip" /> {audio ? "Create footage for every line" : "Footage from a voice-over"}
      </button>
      <button className="btn" onClick={() => setState({ sheet: "sound" })}>
        <Icon name="wave" /> Sound templates: cut an ad to this audio
      </button>
      <div className="divider" />
      <MusicControls />
    </>
  );
}
