import type { AudioTrack, MusicTrack } from "../types";
import type { Stage } from "../audio/prepare";
import { Icon } from "./Icon";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The processing stages, each ticking off with what it found. */
export function StageList({ title, stages }: { title: string; stages: Stage[] }) {
  const done = stages.filter((s) => s.state === "done" || s.state === "skipped").length;
  return (
    <div className="lab-stages" role="status" aria-live="polite">
      <div className="lab-head">
        <b>{title}</b>
        <span className="tiny">{done} of {stages.length}</span>
      </div>
      <div className="lab-progress"><i style={{ width: `${(done / stages.length) * 100}%` }} /></div>
      <ol>
        {stages.map((s) => (
          <li key={s.id} className={`lab-stage ${s.state}`}>
            <span className="lab-dot" aria-hidden="true">
              {s.state === "done" ? <Icon name="up" size={11} /> : s.state === "running" ? <span className="wave">{[0, 1, 2].map((i) => <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />)}</span> : null}
            </span>
            <span className="lab-label">
              {s.label}
              {s.note && <small>{s.note}</small>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** What the voice-over analysis found. */
export function VoiceReport({ track }: { track: AudioTrack }) {
  const ins = track.insight;
  if (!ins) return null;
  return (
    <div className="lab-report">
      <div className="lab-facts">
        <span>{track.duration.toFixed(1)}s</span>
        {track.words?.length ? <span>{track.words.length} words</span> : <span>no transcript</span>}
        {ins.wpm ? <span>{ins.wpm} wpm · {ins.pace}</span> : null}
        <span className="lab-mood">{ins.mood}</span>
      </div>
      <div className="lab-energy" aria-label="Energy over time">
        {ins.energy.map((e, i) => <i key={i} style={{ height: `${Math.max(6, e * 100)}%` }} />)}
      </div>
      {ins.stressedWords.length > 0 && (
        <div className="lab-row">
          <span className="tiny">Leans on</span>
          <div className="lab-chips">{ins.stressedWords.slice(0, 10).map((w) => <em key={w}>{w}</em>)}</div>
        </div>
      )}
      {ins.hook && <p className="lab-quote"><span className="tiny">Hook</span> “{ins.hook}”</p>}
      {ins.cta && ins.cta !== ins.hook && <p className="lab-quote"><span className="tiny">Ask</span> “{ins.cta}”</p>}
      {ins.dramatic.length > 0 && <span className="tiny">{ins.dramatic.length} dramatic pause{ins.dramatic.length > 1 ? "s" : ""}: cuts land there.</span>}
    </div>
  );
}

const KIND_COLOR: Record<string, string> = { intro: "var(--line-2)", build: "color-mix(in srgb, var(--accent) 45%, var(--line-2))", drop: "var(--accent)", break: "var(--text-3)", outro: "var(--line-2)" };

/** What the music analysis found: tempo, mood and the track's shape. */
export function MusicReport({ track, start, length }: { track: MusicTrack; start?: number; length?: number }) {
  const ins = track.insight;
  const dur = track.duration ?? 0;
  if (!ins || !dur) return track.bpm ? <div className="lab-facts"><span>{Math.round(track.bpm)} BPM</span></div> : null;
  return (
    <div className="lab-report">
      <div className="lab-facts">
        {track.bpm ? <span>{Math.round(track.bpm)} BPM</span> : null}
        <span className="lab-mood">{ins.mood}</span>
        {track.drop !== undefined && <span>drop at {mmss(track.drop)}</span>}
        <span>{mmss(dur)}</span>
      </div>
      <div className="lab-shape" aria-label={`Sections: ${ins.sections.map((s) => s.kind).join(", ")}`}>
        {ins.sections.map((s, i) => (
          <i key={i} title={`${s.kind} ${mmss(s.s)}–${mmss(s.e)}`} style={{ left: `${(s.s / dur) * 100}%`, width: `${((s.e - s.s) / dur) * 100}%`, background: KIND_COLOR[s.kind] }}>
            {(s.e - s.s) / dur > 0.12 ? <span>{s.kind}</span> : null}
          </i>
        ))}
        {start !== undefined && length ? <b className="lab-window" style={{ left: `${(start / dur) * 100}%`, width: `${Math.min(100 - (start / dur) * 100, (length / dur) * 100)}%` }} /> : null}
      </div>
    </div>
  );
}
