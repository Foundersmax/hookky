import { useRef, useState } from "react";
import { useStudio, getState, importProject, createProject } from "../store";
import type { Aspect, Project } from "../types";
import { ASPECT_SIZE } from "../types";
import { exportVideo, download, pickMime, posterPng } from "../export";
import { totalDuration } from "../engine/render";
import { clock } from "../clock";
import { Icon } from "./Icon";

const ASPECTS: Aspect[] = ["16:9", "9:16", "1:1", "4:5"];

export function ExportPanel({ toast }: { toast: (s: string) => void }) {
  const project = useStudio((s) => s.project);
  const [formats, setFormats] = useState<Aspect[]>([project.aspect]);
  const [progress, setProgress] = useState<{ label: string; p: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const save = async (fn: () => Promise<boolean>) => {
    try {
      if (!(await fn())) toast("Save cancelled");
    } catch (e: any) {
      toast(e.message);
    }
  };
  const ext = typeof VideoEncoder !== "undefined" ? "mp4" : pickMime().ext;
  const slug = (project.title || "hookky").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  async function run() {
    clock.pause();
    abort.current = new AbortController();
    try {
      for (const a of formats) {
        setProgress({ label: `Rendering ${a}`, p: 0 });
        const { blob, ext } = await exportVideo(getState().project, a, { onProgress: (p) => setProgress({ label: `Rendering ${a}`, p }), signal: abort.current.signal });
        const saved = await download(blob, `${slug}-${a.replace(":", "x")}.${ext}`);
        if (!saved) {
          toast("Save cancelled");
          return;
        }
      }
      toast("Export complete");
    } catch (e: any) {
      toast(e.name === "AbortError" ? "Export cancelled" : `Export failed: ${e.message}`);
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <div className="card">
        <h4>Video</h4>
        <div className="muted">
          {totalDuration(project).toFixed(1)}s · 30 fps · {ext.toUpperCase()} {project.audio ? "· with voice-over" : ""} {project.music ? "· with music" : ""}
        </div>
        <div className="field">
          <label>Formats</label>
          <div className="sources">
            {ASPECTS.map((a) => (
              <button key={a} className={`src-chip ${formats.includes(a) ? "on ok" : ""}`} onClick={() => setFormats((f) => (f.includes(a) ? f.filter((x) => x !== a) : [...f, a]))}>
                <span className="dot" /> {a} <span className="tiny">{ASPECT_SIZE[a].join("×")}</span>
              </button>
            ))}
          </div>
          <span className="tiny">Layouts adapt automatically per format — render every cut-down in one go.</span>
        </div>
        {progress ? (
          <>
            <div className="muted">{progress.label} · {Math.round(progress.p * 100)}%</div>
            <div className="progress"><i style={{ width: `${progress.p * 100}%` }} /></div>
            <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
          </>
        ) : (
          <button className="btn primary" disabled={!formats.length} onClick={run}>
            <Icon name="download" /> Export {formats.length > 1 ? `${formats.length} videos` : "video"}
          </button>
        )}
        <span className="tiny">{typeof VideoEncoder !== "undefined" ? "Frame-accurate WebCodecs render, usually faster than real time." : "This browser renders in real time — keep the tab visible until it finishes."}</span>
      </div>

      <div className="card">
        <h4>Stills & project</h4>
        <button className="btn" onClick={() => save(async () => download(await posterPng(getState().project, clock.time), `${slug}-frame.png`))}>Current frame as PNG</button>
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
