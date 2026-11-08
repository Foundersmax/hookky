import { LicenseCard } from "./LicenseCard";
import { useMemo, useRef, useState } from "react";
import { useStudio, getState, importProject, createProject } from "../store";
import type { Aspect } from "../types";
import { exportVideo, download, pickMime, posterPng, outputSize, coverMoment } from "../export";
import { exportGif, estimateGifBytes } from "../gif";
import { captionCues, toSrt, toVtt } from "../captions";
import { timeline, totalDuration } from "../engine/render";
import { clock } from "../clock";
import { Icon } from "./Icon";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "4:5"];
const GIF_WIDTHS = [480, 720, 1080];
const GIF_FPS = [12, 20, 25];

interface Prefs {
  scale: 1 | 2;
  fps: 30 | 60;
  gifWidth: number;
  gifFps: number;
  gifRange: "all" | "scene";
  posterAt: "cover" | "playhead";
}
const DEFAULTS: Prefs = { scale: 1, fps: 30, gifWidth: 720, gifFps: 20, gifRange: "scene", posterAt: "cover" };
const PREFS_KEY = "hookky:export";
function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return {
      scale: v.scale === 2 ? 2 : 1,
      fps: v.fps === 60 ? 60 : 30,
      gifWidth: GIF_WIDTHS.includes(v.gifWidth) ? v.gifWidth : DEFAULTS.gifWidth,
      gifFps: GIF_FPS.includes(v.gifFps) ? v.gifFps : DEFAULTS.gifFps,
      gifRange: v.gifRange === "all" ? "all" : "scene",
      posterAt: v.posterAt === "playhead" ? "playhead" : "cover",
    };
  } catch {
    return DEFAULTS;
  }
}

const mb = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`);

function Seg<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="opt-row">
      <span className="opt-label">{label}</span>
      <div className="seg opt-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.v)} role="radio" aria-checked={o.v === value} className={o.v === value ? "on" : ""} title={o.hint} onClick={() => onChange(o.v)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExportPanel({ toast }: { toast: (s: string) => void }) {
  const project = useStudio((s) => s.project);
  const selected = useStudio((s) => s.selected);
  const [formats, setFormats] = useState<Aspect[]>([project.aspect]);
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const [progress, setProgress] = useState<{ label: string; p: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const setPrefs = (patch: Partial<Prefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* per-browser convenience only */
      }
      return next;
    });

  const ext = typeof VideoEncoder !== "undefined" ? "mp4" : pickMime().ext;
  const slug = (project.title || "hookky").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hookky";
  const total = totalDuration(project);
  const busy = !!progress;

  // GIF range: the selected scene, or the whole cut.
  const tl = timeline(project.scenes);
  const scene = tl[Math.min(selected, tl.length - 1)];
  const gifSpan = prefs.gifRange === "scene" && scene ? { from: scene.start, to: scene.end } : { from: 0, to: total };
  const [gw, gh] = outputSize(project.aspect, prefs.gifWidth / outputSize(project.aspect)[0]);
  const gifSeconds = gifSpan.to - gifSpan.from;
  const gifEstimate = estimateGifBytes(gw, gh, prefs.gifFps, gifSeconds);

  const captions = useMemo(() => captionCues(project), [project.audio, project.scenes]);

  async function task(label: string, fn: (signal: AbortSignal, step: (label: string, p: number) => void) => Promise<boolean | void>, done: string | (() => string)) {
    clock.pause();
    abort.current = new AbortController();
    setProgress({ label, p: 0 });
    try {
      const ok = await fn(abort.current.signal, (l, p) => setProgress({ label: l, p }));
      toast(ok === false ? "Save cancelled" : typeof done === "function" ? done() : done);
    } catch (e: any) {
      toast(e?.name === "AbortError" ? "Export cancelled" : `Export failed: ${e?.message ?? e}`);
    } finally {
      setProgress(null);
    }
  }

  const quality = prefs.scale === 2 ? "4K" : "1080p";
  const videoName = (a: Aspect) => `${slug}-${a.replace(":", "x")}${prefs.scale === 2 ? "-4k" : ""}${prefs.fps === 60 ? "-60fps" : ""}`;

  const exportVideos = () =>
    task(`Rendering ${formats[0]}`, async (signal, step) => {
      for (const [i, a] of formats.entries()) {
        const label = `Rendering ${a} · ${quality} ${prefs.fps} fps${formats.length > 1 ? ` (${i + 1}/${formats.length})` : ""}`;
        step(label, 0);
        const { blob, ext } = await exportVideo(getState().project, a, { fps: prefs.fps, scale: prefs.scale, onProgress: (p) => step(label, p), signal });
        if (!(await download(blob, `${videoName(a)}.${ext}`))) return false;
      }
    }, formats.length > 1 ? `Exported ${formats.length} videos` : "Export complete");

  let gifSize = 0;
  const exportGifFile = () =>
    task("Rendering GIF", async (signal, step) => {
      const blob = await exportGif(getState().project, getState().project.aspect, { width: prefs.gifWidth, fps: prefs.gifFps, ...gifSpan, signal, onProgress: (p) => step("Rendering GIF", p) });
      const name = `${slug}${prefs.gifRange === "scene" ? `-scene-${selected + 1}` : ""}-${prefs.gifWidth}w.gif`;
      gifSize = blob.size;
      return download(blob, name);
    }, () => `GIF saved · ${mb(gifSize)}`);

  const exportPosters = () =>
    task("Rendering posters", async (_signal, step) => {
      const p = getState().project;
      const t = prefs.posterAt === "playhead" ? clock.time : coverMoment(p);
      for (const [i, a] of formats.entries()) {
        step(`Poster ${a}`, i / formats.length);
        const blob = await posterPng(p, t, { aspect: a, scale: prefs.scale });
        if (!(await download(blob, `${slug}-poster-${a.replace(":", "x")}${prefs.scale === 2 ? "-4k" : ""}.png`))) return false;
      }
    }, formats.length > 1 ? `Saved ${formats.length} posters` : "Poster saved");

  const saveCaptions = (kind: "srt" | "vtt") => {
    const body = kind === "srt" ? toSrt(captions.cues) : toVtt(captions.cues);
    download(new Blob([body], { type: kind === "srt" ? "application/x-subrip" : "text/vtt" }), `${slug}.${kind}`)
      .then((ok) => toast(ok ? `Saved ${captions.cues.length} captions (.${kind})` : "Save cancelled"))
      .catch((e) => toast(e.message));
  };

  const save = async (fn: () => Promise<boolean>) => {
    try {
      if (!(await fn())) toast("Save cancelled");
    } catch (e: any) {
      toast(e.message);
    }
  };

  return (
    <>
      <LicenseCard compact />
      {progress && (
        <div className="card export-progress" aria-live="polite">
          <div className="muted">{progress.label} · {Math.round(progress.p * 100)}%</div>
          <div className="progress"><i style={{ width: `${progress.p * 100}%` }} /></div>
          <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
        </div>
      )}

      <div className="card">
        <h4>Video</h4>
        <div className="field">
          <label>Formats</label>
          <div className="sources">
            {ASPECTS.map((a) => (
              <button key={a} className={`src-chip filter ${formats.includes(a) ? "on" : ""}`} title={outputSize(a, prefs.scale).join("×")} aria-pressed={formats.includes(a)} onClick={() => setFormats((f) => (f.includes(a) ? f.filter((x) => x !== a) : [...f, a]))}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <Seg label="Quality" value={prefs.scale} onChange={(scale) => setPrefs({ scale })} options={[{ v: 1, label: "1080p" }, { v: 2, label: "4K", hint: "Twice the resolution; files are about 4× larger and take longer" }]} />
        <Seg label="Frame rate" value={prefs.fps} onChange={(fps) => setPrefs({ fps })} options={[{ v: 30, label: "30 fps" }, { v: 60, label: "60 fps", hint: "Smoother motion; twice the frames to render" }]} />
        <div className="muted">
          {formats.length === 1 ? outputSize(formats[0], prefs.scale).join("×") : `${formats.length} formats`} · {total.toFixed(1)}s · {ext.toUpperCase()}
          {project.audio ? " · with voice-over" : ""}
          {project.music ? " · with music" : ""}
          {project.captions ? " · captions burned in" : ""}
        </div>
        {!project.scenes.length && <span className="tiny">Add a scene first. There's nothing to export yet.</span>}
        <button className="btn primary" disabled={!formats.length || busy || !project.scenes.length} onClick={exportVideos}>
          <Icon name="download" /> Export {formats.length > 1 ? `${formats.length} videos` : "video"}
        </button>
        {typeof VideoEncoder === "undefined" && <span className="tiny">This browser renders in real time: keep the tab visible until it finishes.</span>}
      </div>

      <div className="card">
        <h4>GIF</h4>
        <Seg label="Length" value={prefs.gifRange} onChange={(gifRange) => setPrefs({ gifRange })} options={[{ v: "scene", label: `Scene ${Math.min(selected, tl.length - 1) + 1}` }, { v: "all", label: "Whole cut" }]} />
        <Seg label="Width" value={prefs.gifWidth} onChange={(gifWidth) => setPrefs({ gifWidth })} options={GIF_WIDTHS.map((v) => ({ v, label: `${v}px` }))} />
        <Seg label="Frame rate" value={prefs.gifFps} onChange={(gifFps) => setPrefs({ gifFps })} options={GIF_FPS.map((v) => ({ v, label: `${v}` }))} />
        <div className="muted">
          {project.aspect} · {gw}×{gh} · {gifSeconds.toFixed(1)}s · about {mb(gifEstimate)} · loops, no sound
        </div>
        {gifEstimate > 15e6 && <span className="tiny warn-text">That's a big GIF. Pick one scene, a smaller width or fewer frames for chat and email.</span>}
        <button className="btn" disabled={busy || !tl.length} onClick={exportGifFile}>
          <Icon name="download" /> Export GIF
        </button>
      </div>

      <div className="card">
        <h4>Captions</h4>
        <div className="muted">
          {captions.source === "voice-over"
            ? `${captions.cues.length} captions from the voice-over${project.audio?.wordsSource === "script-estimate" ? " (timed from your script)" : ""}.`
            : captions.source === "on-screen text"
              ? `${captions.cues.length} captions from the on-screen text. Add a voice-over transcript for spoken captions.`
              : "No text to caption yet."}
        </div>
        {!!captions.cues.length && (
          <ol className="cue-list" aria-label="First captions">
            {captions.cues.slice(0, 3).map((c, i) => (
              <li key={i}>
                <span className="tiny">{c.s.toFixed(1)}s</span> {c.text}
              </li>
            ))}
          </ol>
        )}
        <div className="row" style={{ gap: 6 }}>
          <button className="btn" disabled={!captions.cues.length} onClick={() => saveCaptions("srt")}>Download .srt</button>
          <button className="btn" disabled={!captions.cues.length} onClick={() => saveCaptions("vtt")}>Download .vtt</button>
        </div>
      </div>

      <div className="card">
        <h4>Posters & project</h4>
        <Seg label="Frame" value={prefs.posterAt} onChange={(posterAt) => setPrefs({ posterAt })} options={[{ v: "cover", label: "Best frame", hint: "The first headline, fully animated in" }, { v: "playhead", label: "Playhead" }]} />
        <button className="btn" disabled={busy || !formats.length || !project.scenes.length} onClick={exportPosters}>
          Poster{formats.length > 1 ? `s for ${formats.length} formats` : ` (${formats[0] ?? project.aspect})`} · {quality} PNG
        </button>
        <button className="btn" onClick={() => save(() => download(new Blob([JSON.stringify({ ...getState().project, audio: undefined, music: undefined }, null, 2)], { type: "application/json" }), `${slug}.hookky.json`))}>
          Save project (.json)
        </button>
        <button className="btn" onClick={() => jsonRef.current?.click()}>Import a project file…</button>
        <input ref={jsonRef} type="file" hidden accept=".json,application/json" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const p = JSON.parse(await f.text());
            if (!Array.isArray(p?.scenes) || !p.scenes.length) throw new Error("That file isn't a Hookky project.");
            await importProject(p);
            toast("Imported as a new project");
          } catch (err: any) {
            toast(err.message);
          }
        }} />
        <button className="btn ghost" onClick={() => createProject("blank")}>New blank project</button>
      </div>
    </>
  );
}
