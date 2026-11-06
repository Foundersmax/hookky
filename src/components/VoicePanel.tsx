import { useRef, useState } from "react";
import { useStudio, setAudio, getState, setState, updateProject, fitToVoiceover } from "../store";
import { analyzeAudio, alignScript } from "../audio/analyze";
import { clock, useClock } from "../clock";
import { sendToAgent } from "../agent/client";
import { Icon } from "./Icon";
import { fmt } from "./Stage";

/** Analyse a VO file, attach it to the project, and transcribe if a provider is configured. */
export async function ingestVoiceover(file: File) {
  const track = await analyzeAudio(file);
  if (track.duration > 120) console.warn("Voice-over longer than 2 minutes");
  setAudio(track);
  if (getState().health?.transcription !== "none") {
    try {
      const fd = new FormData();
      fd.append("audio", file);
      const r = await fetch("/api/transcribe", { method: "POST", body: fd }).then((r) => r.json());
      if (r.words?.length) setAudio({ ...getState().project.audio!, words: r.words, wordsSource: "transcription" });
    } catch {
      /* fall back to pasted script */
    }
  }
}

export function VoicePanel({ toast }: { toast: (s: string) => void }) {
  const audio = useStudio((s) => s.project.audio);
  const music = useStudio((s) => s.project.music);
  const health = useStudio((s) => s.health);
  const captions = useStudio((s) => s.project.captions);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const musicRef = useRef<HTMLInputElement>(null);
  const c = useClock();

  async function onFile(f?: File) {
    if (!f) return;
    setBusy(true);
    try {
      await ingestVoiceover(f);
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
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>Replace</button>
            <button className="btn ghost" onClick={() => setAudio(undefined)}>Remove</button>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" hidden accept="audio/*" onChange={(e) => onFile(e.target.files?.[0])} />

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
        </>
      )}

      <div className="divider" />
      <div className="field">
        <label>Music bed</label>
        {music ? (
          <>
            <div className="muted">{music.name}</div>
            <input type="range" min={0} max={1} step={0.01} value={music.volume} onChange={(e) => setState((s) => ({ project: { ...s.project, music: { ...music, volume: +e.target.value } } }))} />
            <button className="btn ghost" onClick={() => setState((s) => ({ project: { ...s.project, music: undefined } }))}>Remove music</button>
          </>
        ) : (
          <button className="btn" onClick={() => musicRef.current?.click()}>Add music track</button>
        )}
        <input ref={musicRef} type="file" hidden accept="audio/*" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setState((s) => ({ project: { ...s.project, music: { name: f.name, url: URL.createObjectURL(f), volume: 0.25 } } }));
        }} />
        <span className="tiny">Ducked under the voice-over in preview and export.</span>
      </div>
    </>
  );
}
