import { useRef } from "react";
import type { MusicTrack } from "../types";
import { useStudio, updateProject, setState } from "../store";
import { cleanMusic, DEFAULT_DUCK } from "../audio/mix";
import { clock } from "../clock";
import { Icon } from "./Icon";

const MAX_MUSIC = 60e6;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Read a music file's length (so "start at" knows its range). */
function probeDuration(url: string): Promise<number> {
  return new Promise((res) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => res(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => res(0);
    a.src = url;
  });
}

export function Slider({ label, value, min, max, step, show, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="opt-row">
      <span className="opt-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} onChange={(e) => onChange(+e.target.value)} style={{ flex: 1, minWidth: 0, maxWidth: 150 }} />
      <span className="tiny clip-num">{show}</span>
    </div>
  );
}

/** Background music: the track, and how it sits under the voice-over in preview and export. */
export function MusicControls() {
  const music = useStudio((s) => s.project.music);
  const audio = useStudio((s) => s.project.audio);
  const file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<MusicTrack>) => updateProject((p) => (p.music ? { ...p, music: { ...p.music, ...patch } } : p));
  const voice = (volume: number) => updateProject((p) => (p.audio ? { ...p, audio: { ...p.audio, volume } } : p));

  async function add(f?: File) {
    if (!f) return;
    if (!f.type.startsWith("audio/") && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) return setState({ notice: `${f.name} isn't an audio file.` });
    if (f.size > MAX_MUSIC) return setState({ notice: `${f.name} is over 60 MB. Use a compressed MP3 or M4A.` });
    const url = URL.createObjectURL(f);
    const duration = await probeDuration(url);
    if (!duration) {
      URL.revokeObjectURL(url);
      return setState({ notice: `${f.name} can't be played in this browser. Try MP3, M4A or WAV.` });
    }
    // Keep the mix settings when replacing a track; start fresh otherwise.
    updateProject((p) => ({ ...p, music: cleanMusic({ ...(p.music ?? {}), name: f.name, duration, start: 0 }, url) }));
    setState({ notice: `Music added (${mmss(duration)}). It loops to fill the cut.` });
  }

  const listen = () => {
    clock.seek(0);
    clock.play();
  };

  return (
    <div className="field music">
      <span className="label">Background music</span>
      {music ? (
        <div className="music-card">
          <div className="music-head">
            <Icon name="mic" size={14} />
            <span className="music-name" title={music.name}>{music.name}</span>
            {music.duration ? <span className="tiny">{mmss(music.duration)}</span> : null}
          </div>
          <Slider label="Music volume" value={music.volume} min={0} max={1} step={0.01} show={pct(music.volume)} onChange={(volume) => set({ volume })} />
          {audio && <Slider label="Voice-over volume" value={audio.volume ?? 1} min={0} max={1.5} step={0.01} show={pct(audio.volume ?? 1)} onChange={voice} />}
          {audio && <Slider label="Under the voice" value={music.duck ?? DEFAULT_DUCK} min={0} max={0.95} step={0.05} show={`−${pct(music.duck ?? DEFAULT_DUCK)}`} onChange={(duck) => set({ duck })} />}
          <Slider label="Fade in" value={music.fadeIn ?? 0.5} min={0} max={5} step={0.1} show={`${(music.fadeIn ?? 0.5).toFixed(1)}s`} onChange={(fadeIn) => set({ fadeIn })} />
          <Slider label="Fade out" value={music.fadeOut ?? 1.5} min={0} max={5} step={0.1} show={`${(music.fadeOut ?? 1.5).toFixed(1)}s`} onChange={(fadeOut) => set({ fadeOut })} />
          <Slider
            label="Start at"
            value={music.start ?? 0}
            min={0}
            max={Math.max(0, (music.duration ?? 0) - 1)}
            step={0.5}
            disabled={!music.duration}
            show={mmss(music.start ?? 0)}
            onChange={(start) => (set({ start }), clock.seek(clock.time))}
          />
          <div className="music-actions">
            <button className="btn" onClick={listen} title="Play the cut from the start to hear the mix">
              <Icon name="play" size={13} /> Listen
            </button>
            <button className="btn ghost" onClick={() => file.current?.click()}>Replace</button>
            <button className="btn ghost" onClick={() => updateProject((p) => ({ ...p, music: undefined }))}>Remove</button>
          </div>
          <span className="tiny">{audio ? "The music dips while the voice speaks. Exports use exactly this mix." : "Exports use exactly this mix."}</span>
        </div>
      ) : (
        <>
          <button className="btn" onClick={() => file.current?.click()}>
            <Icon name="plus" /> Add music track
          </button>
          <span className="tiny">MP3, M4A or WAV. It loops to fill the cut and fades at the ends.</span>
        </>
      )}
      <input
        ref={file}
        type="file"
        hidden
        accept="audio/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          add(f);
        }}
      />
    </div>
  );
}
