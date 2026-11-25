import { useEffect, useRef, useState } from "react";
import { setState } from "../store";
import { download } from "../export";
import { Icon } from "./Icon";
import { takeHandoff, handoff } from "../handoff";
import { Upscaler } from "../upscale/gl";
import { probe, seek, upscaleVideo, targetSize, pickCodec, upscaleBitrate, TARGETS, CODEC_NAME, type TargetId, type SourceInfo, type UpscaleProgress } from "../upscale/run";
import { DEFAULT_LOOK, PRESETS, presetOf, frameRange, outputBytes, MEMORY_LIMIT, timeLeft, formatDuration, type Look } from "../upscale/size";

type Loaded = SourceInfo & { url: string; video: HTMLVideoElement; file: File };
type Cap = { ok: boolean; why?: string; codec?: string; size: [number, number] };
type Busy = { p: number; label: string; info?: UpscaleProgress; started: number };
type Done = { line: string; notes: string[]; url?: string; blob?: Blob; name: string; disk: boolean };

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const SLIDERS: { key: keyof Look; label: string; hint: string }[] = [
  { key: "clean", label: "Clean-up", hint: "Removes compression blocks and noise before scaling" },
  { key: "sharp", label: "Sharpness", hint: "Brings back edge detail after scaling, without halos" },
  { key: "rich", label: "Colour", hint: "Lifts flat colour and adds a touch of contrast" },
  { key: "grain", label: "Texture", hint: "Fine grain, so smooth areas don't look plastic" },
];
const canSaveToDisk = () => typeof window !== "undefined" && "showSaveFilePicker" in window && window.self === window.top;

/** Upscale a video file to 1080p, 1440p, 4K or 8K in the browser, with a before/after preview. */
export function UpscaleSheet() {
  const [src, setSrc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<TargetId>("4k");
  const [caps, setCaps] = useState<Partial<Record<TargetId, Cap>>>({});
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [custom, setCustom] = useState(false);
  const [at, setAt] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const [split, setSplit] = useState(0.5);
  const [detail, setDetail] = useState(false);
  const [toDisk, setToDisk] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [opening, setOpening] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const up = useRef<Upscaler | null>(null);
  const abort = useRef<AbortController | null>(null);
  const drawId = useRef(0);
  const [, tick] = useState(0);

  const close = () => {
    if (busy) return;
    setState({ sheet: undefined });
  };
  // Free the video and the GPU when the sheet goes away or the file changes.
  useEffect(
    () => () => {
      up.current?.dispose();
      up.current = null;
      if (src) {
        src.video.removeAttribute("src");
        src.video.load();
        URL.revokeObjectURL(src.url);
      }
    },
    [src],
  );
  useEffect(() => () => void (done?.url && URL.revokeObjectURL(done.url)), [done]);
  // Leaving the page mid-upscale loses the work: ask first. Escape closes when idle.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => (e.preventDefault(), (e.returnValue = ""));
    window.addEventListener("beforeunload", warn);
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => (window.removeEventListener("beforeunload", warn), clearInterval(t));
  }, [!!busy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && (e.stopPropagation(), close());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  async function open(file?: File) {
    if (!file) return;
    if (!/^video\//.test(file.type) && !/\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name)) return setError("That isn't a video file. MP4, MOV and WebM work best.");
    setError(null);
    setDone(null);
    setOpening(true);
    try {
      const p = await probe(file);
      setSrc({ ...p, file });
      setAt(Math.min(p.duration * 0.3, p.duration - 0.05));
      setRange([0, p.duration]);
      // What each size needs: bigger than the source, within the GPU's reach, and encodable here.
      const probeGl = document.createElement("canvas").getContext("webgl2");
      const max = probeGl ? Math.min(probeGl.getParameter(probeGl.MAX_TEXTURE_SIZE), probeGl.getParameter(probeGl.MAX_RENDERBUFFER_SIZE)) : 0;
      probeGl?.getExtension("WEBGL_lose_context")?.loseContext();
      const next: Partial<Record<TargetId, Cap>> = {};
      for (const t of TARGETS) {
        const size = targetSize(p, t.id);
        if (Math.min(p.w, p.h) >= t.short) next[t.id] = { ok: false, why: "The video is already this size or larger", size };
        else if (!max) next[t.id] = { ok: false, why: "This browser can't run the upscaler (WebGL2 is off)", size };
        else if (Math.max(...size) > max) next[t.id] = { ok: false, why: `This device's graphics stop at ${max} px`, size };
        else {
          const c = await pickCodec(size[0], size[1], p.fps, upscaleBitrate(size[0], size[1], p.fps));
          next[t.id] = c ? { ok: true, codec: CODEC_NAME[c.mux], size } : { ok: false, why: "This browser can't encode video this large; try Chrome or Edge on a desktop", size };
        }
      }
      setCaps(next);
      const best = (["4k", "1440p", "1080p", "8k"] as TargetId[]).find((id) => next[id]?.ok);
      if (best) setTarget(best);
      else setError(Math.min(p.w, p.h) >= 4320 ? "This video is already 8K-class: there's nothing to upscale." : "This browser can't upscale this video. Chrome or Edge on a computer works best.");
    } catch (e: any) {
      setSrc(null);
      setError(e?.message ?? "That file couldn't be opened.");
    } finally {
      setOpening(false);
    }
  }

  // The preview: the chosen frame, plain on the left of the divider and upscaled on the right.
  useEffect(() => {
    const c = view.current;
    const cap = caps[target];
    if (!src || !c || !cap?.ok || busy) return;
    const id = ++drawId.current;
    (async () => {
      // preview at the target size, capped so dragging a slider stays quick
      const k = Math.min(1, 2560 / Math.max(...cap.size));
      const pw = Math.round((cap.size[0] * k) / 2) * 2, ph = Math.round((cap.size[1] * k) / 2) * 2;
      try {
        if (!up.current || up.current.lost || up.current.outW !== pw || up.current.outH !== ph) {
          try {
            up.current?.dispose();
          } catch {}
          up.current = new Upscaler(pw, ph);
        }
        await seek(src.video, at, 5000);
        if (id !== drawId.current) return;
        up.current.render(src.video, src.w, src.h, look);
        const box = c.parentElement!.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const fit = Math.min(box.width / pw, (window.innerHeight * 0.46) / ph);
        const cw = Math.round(pw * fit), ch = Math.round(ph * fit);
        c.style.width = `${cw}px`;
        c.style.height = `${ch}px`;
        c.width = Math.round(cw * dpr);
        c.height = Math.round(ch * dpr);
        const x = c.getContext("2d")!;
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = "low"; // the "before" is what plain stretching gives
        // fit shows the whole frame; detail shows the centre at one screen pixel per output pixel
        const sw = detail ? Math.min(pw, c.width) : pw, sh = detail ? Math.min(ph, c.height) : ph;
        const sx = (pw - sw) / 2, sy = (ph - sh) / 2;
        x.drawImage(src.video, (sx / pw) * src.w, (sy / ph) * src.h, (sw / pw) * src.w, (sh / ph) * src.h, 0, 0, c.width, c.height);
        const cut = Math.round(c.width * split);
        x.save();
        x.beginPath();
        x.rect(cut, 0, c.width - cut, c.height);
        x.clip();
        x.imageSmoothingQuality = "high";
        x.drawImage(up.current.canvas as HTMLCanvasElement, sx, sy, sw, sh, 0, 0, c.width, c.height);
        x.restore();
        x.fillStyle = "#fff";
        x.fillRect(cut - dpr, 0, 2 * dpr, c.height);
        if (error && /preview/.test(error)) setError(null);
      } catch (e: any) {
        if (id === drawId.current) setError(`The preview couldn't be drawn: ${e?.message ?? e}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, target, caps, look, at, split, detail, busy]);

  const cap = caps[target];
  const part = src ? frameRange(src.duration, src.fps, range[0], range[1]) : null;
  const seconds = part && src ? part.count / src.fps : 0;
  const est = src && cap?.ok ? outputBytes(cap.size[0], cap.size[1], src.fps, seconds) : 0;
  const disk = canSaveToDisk();
  const mustDisk = est > MEMORY_LIMIT;
  const whole = !!src && range[0] <= 0.01 && range[1] >= src.duration - 0.01;
  // big files go straight to disk where the browser allows it
  useEffect(() => setToDisk(disk && est > 500e6), [disk, est > 500e6]);

  async function run() {
    if (!src || !cap?.ok) return;
    setError(null);
    setDone(null);
    const name = `${src.file.name.replace(/\.[^.]+$/, "") || "video"}-${target}${whole ? "" : `-${Math.round(range[0])}s-${Math.round(range[1])}s`}.mp4`;
    let sink: FileSystemWritableFileStream | undefined;
    if (toDisk || mustDisk) {
      if (!disk) return setError(`This would be about ${mb(est)}, more than a browser tab can hold. Use Chrome or Edge on a computer to save straight to disk, or pick a smaller size or a shorter part.`);
      try {
        // asked first, while the click still counts as the person's choice
        const handle = await (window as any).showSaveFilePicker({ suggestedName: name, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
        sink = await handle.createWritable();
      } catch (e: any) {
        if (e?.name === "AbortError") return; // they closed the save dialog
        return setError(`Couldn't open a file to save into: ${e?.message ?? e}`);
      }
    }
    abort.current = new AbortController();
    const started = Date.now();
    setBusy({ p: 0, label: "Starting", started });
    try {
      up.current?.dispose(); // one GPU context at a time: the export makes its own
    } catch {}
    up.current = null;
    try {
      const r = await upscaleVideo(src.file, {
        target,
        look,
        sink,
        ...(!whole && { range: { start: range[0], end: range[1] } }),
        signal: abort.current.signal,
        onProgress: (p, label, info) => setBusy({ p, label, info, started }),
      });
      const took = Date.now() - started;
      let saved = r.savedToDisk;
      if (r.blob) saved = await download(r.blob, name);
      const size = r.blob ? mb(r.blob.size) : `about ${mb(est)}`;
      setDone({
        line: `${saved ? (r.savedToDisk ? "Saved to disk" : "Saved") : "Ready"}: ${r.w}×${r.h} · ${r.seconds.toFixed(1)}s · ${r.frames} frames · ${CODEC_NAME[r.codec]}${r.audio ? ` + ${r.audio.toUpperCase()}` : ", no sound"} · ${size}${took > 60_000 ? ` · took ${formatDuration(took / 1000).replace(/^about /, "")}` : ""}`,
        notes: r.notes,
        ...(r.blob && { url: URL.createObjectURL(r.blob), blob: r.blob }),
        name,
        disk: r.savedToDisk,
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "The upscale failed.");
      else setError(sink ? "Cancelled. The unfinished file was discarded." : null);
    } finally {
      setBusy(null);
    }
  }

  // a clip handed over from another tool (AI video) opens straight away
  useEffect(() => {
    const f = takeHandoff();
    if (f) void open(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preset = presetOf(look);
  const left = busy ? timeLeft(busy.p, Date.now() - busy.started) : undefined;

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet sound-sheet upscale-sheet" role="dialog" aria-modal="true" aria-labelledby="upscale-title">
        <div className="sheet-head">
          <div>
            <h3 id="upscale-title">Upscale a video</h3>
            <p className="sound-sub">Turn a small or soft video into 1080p, 1440p, 4K or 8K. It runs on this device; your video isn't uploaded.</p>
          </div>
          <button className="btn icon ghost" onClick={close} aria-label="Close" disabled={!!busy}>
            <Icon name="minus" />
          </button>
        </div>

        {!src ? (
          <div
            className={`upscale-drop ${dragOver ? "over" : ""}`}
            onDragOver={(e) => (e.preventDefault(), setDragOver(true))}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => (e.preventDefault(), setDragOver(false), void open([...e.dataTransfer.files].find((f) => f.type.startsWith("video/")) ?? e.dataTransfer.files[0]))}
          >
            <Icon name="expand" size={26} />
            <b>{opening ? "Opening…" : "Drop a video here"}</b>
            <span>MP4, MOV or WebM</span>
            <button className="btn primary" disabled={opening} onClick={() => fileIn.current?.click()}>Choose a video</button>
          </div>
        ) : (
          <div className="upscale-body">
            <div className="upscale-view">
              {done?.url ? (
                <div className="upscale-result">
                  <video src={done.url} controls playsInline preload="metadata" />
                </div>
              ) : (
                <div className="upscale-canvas">
                  <canvas
                    ref={view}
                    aria-label="Before and after preview. Drag to move the divider."
                    onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), setSplit(Math.min(0.98, Math.max(0.02, (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width))))}
                    onPointerMove={(e) => e.buttons === 1 && setSplit(Math.min(0.98, Math.max(0.02, (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width)))}
                  />
                  <span className="upscale-tag left">Before</span>
                  <span className="upscale-tag right">After</span>
                  {busy && <span className="upscale-busy-veil">Upscaling… the preview pauses while it works</span>}
                </div>
              )}
              {!done?.url && (
                <div className="upscale-scrub">
                  <input type="range" min={0} max={Math.max(0.05, src.duration - 0.05)} step={0.01} value={at} aria-label="Preview frame" disabled={!!busy} onChange={(e) => setAt(+e.target.value)} />
                  <span className="tiny upscale-time">{clock(at)}</span>
                  <div className="seg" role="group" aria-label="Preview zoom">
                    <button className={!detail ? "on" : ""} onClick={() => setDetail(false)}>Whole frame</button>
                    <button className={detail ? "on" : ""} onClick={() => setDetail(true)}>Detail</button>
                  </div>
                </div>
              )}
              {!done?.url && src.duration > 2 && (
                <div className="upscale-trim" aria-label="Part to upscale">
                  <span className="label">Part to upscale</span>
                  <div className="upscale-trim-row">
                    <label>
                      From
                      <input type="range" min={0} max={src.duration} step={0.1} value={range[0]} disabled={!!busy} onChange={(e) => (setRange(([, b]) => [Math.min(+e.target.value, b - 0.5), b]), setAt(Math.min(+e.target.value, src.duration - 0.05)))} />
                      <em>{clock(range[0])}</em>
                    </label>
                    <label>
                      To
                      <input type="range" min={0} max={src.duration} step={0.1} value={range[1]} disabled={!!busy} onChange={(e) => (setRange(([a]) => [a, Math.max(+e.target.value, a + 0.5)]), setAt(Math.max(0, Math.min(+e.target.value, src.duration) - 0.05)))} />
                      <em>{clock(range[1])}</em>
                    </label>
                  </div>
                  <span className="tiny">
                    {whole ? `The whole video: ${src.duration.toFixed(1)}s.` : `${seconds.toFixed(1)}s of ${src.duration.toFixed(1)}s.`}{" "}
                    {!whole && !busy && <button className="link" onClick={() => setRange([0, src.duration])}>Whole video</button>}
                  </span>
                </div>
              )}
            </div>

            <aside className="upscale-side">
              <div className="upscale-file">
                <b title={src.file.name}>{src.file.name}</b>
                <span>{src.w}×{src.h} · {src.duration.toFixed(1)}s · {src.fps} fps · {mb(src.file.size)}</span>
                <button className="link" disabled={!!busy} onClick={() => (setSrc(null), setCaps({}), setDone(null), setError(null))}>Choose another</button>
              </div>

              <div className="field">
                <span className="label">Upscale to</span>
                <div className="upscale-targets" role="radiogroup" aria-label="Output size">
                  {TARGETS.map((t) => {
                    const c = caps[t.id];
                    return (
                      <button key={t.id} role="radio" aria-checked={target === t.id} disabled={!c?.ok || !!busy} className={`upscale-target ${target === t.id ? "on" : ""}`} title={c?.why} onClick={() => (setTarget(t.id), setDone(null))}>
                        <b>{t.label}</b>
                        <small>{c ? `${c.size[0]}×${c.size[1]}` : ""}</small>
                        <small>{c?.ok ? c.codec : c?.why ? "Not available" : ""}</small>
                      </button>
                    );
                  })}
                </div>
                {TARGETS.filter((t) => caps[t.id] && !caps[t.id]!.ok && caps[t.id]!.why !== "The video is already this size or larger").map((t) => (
                  <span className="tiny" key={t.id}>{t.label}: {caps[t.id]!.why}.</span>
                ))}
              </div>

              <div className="field">
                <span className="label">Look</span>
                <div className="upscale-presets" role="radiogroup" aria-label="Look">
                  {PRESETS.map((p) => (
                    <button key={p.id} role="radio" aria-checked={preset === p.id} className={preset === p.id ? "on" : ""} title={p.hint} disabled={!!busy} onClick={() => (setLook({ ...p.look }), setDone(null))}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <span className="tiny">{PRESETS.find((p) => p.id === preset)?.hint ?? "Your own settings."}</span>
              </div>
              <button className="link upscale-fine" aria-expanded={custom} onClick={() => setCustom((v) => !v)}>{custom ? "Hide fine-tuning" : "Fine-tune"}</button>
              {custom && (
                <>
                  {SLIDERS.map((s) => (
                    <label className="upscale-slider" key={s.key} title={s.hint}>
                      <span>{s.label}</span>
                      <input type="range" min={0} max={1} step={0.05} value={look[s.key]} disabled={!!busy} onChange={(e) => (setLook({ ...look, [s.key]: +e.target.value }), setDone(null))} />
                      <em>{Math.round(look[s.key] * 100)}</em>
                    </label>
                  ))}
                  <button className="link" disabled={!!busy} onClick={() => setLook(DEFAULT_LOOK)}>Reset to recommended</button>
                </>
              )}

              {cap?.ok && disk && !busy && (
                <label className="toggle" title="Writes the file to your disk as it's made, so there's no size limit">
                  <input type="checkbox" checked={toDisk || mustDisk} disabled={mustDisk} onChange={(e) => setToDisk(e.target.checked)} /> Save straight to disk{mustDisk ? " (needed at this size)" : " (no size limit)"}
                </label>
              )}

              {error && <p className="sound-error" role="alert">{error}</p>}
              {busy ? (
                <div className="upscale-progress" role="status" aria-live="polite">
                  <div className="bar"><i style={{ width: `${Math.round(busy.p * 100)}%` }} /></div>
                  <span>
                    {busy.label} · {Math.round(busy.p * 100)}%
                    {busy.info ? ` · frame ${busy.info.frame} of ${busy.info.frames}` : ""}
                    {busy.info?.speed ? ` · ${busy.info.speed.toFixed(1)} frames/s` : ""}
                  </span>
                  {left !== undefined && <span>{formatDuration(left)} left</span>}
                  <span className="tiny">Keep this tab open. It keeps working in the background, and the screen is kept awake.</span>
                  <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
                </div>
              ) : (
                <button className="btn primary sound-build" disabled={!cap?.ok} onClick={run}>
                  <Icon name="expand" /> Upscale {whole ? "" : "this part "}to {TARGETS.find((t) => t.id === target)!.label} and save
                </button>
              )}
              {!busy && cap?.ok && !done && (
                <span className="tiny">
                  About {mb(est)}.{mustDisk && !disk ? " That's more than a browser tab can hold: use Chrome or Edge on a computer, or pick a smaller size or a shorter part." : ""}
                </span>
              )}
              {done && (
                <div className="upscale-done" role="status">
                  <b>{done.line}</b>
                  {done.notes.map((n) => <span key={n}>{n}</span>)}
                  {done.blob && (
                    <div className="row">
                      <button className="btn" onClick={() => void download(done.blob!, done.name)}>
                        <Icon name="download" /> Save again
                      </button>
                      <button className="btn" onClick={() => ((handoff.file = new File([done.blob!], done.name, { type: "video/mp4" })), setState({ sheet: "caption" }))}>
                        <Icon name="mic" /> Caption it
                      </button>
                    </div>
                  )}
                  <button className="link" onClick={() => setDone(null)}>Back to the preview</button>
                </div>
              )}
            </aside>
          </div>
        )}
        {!src && error && <p className="sound-error" role="alert">{error}</p>}
        <input ref={fileIn} type="file" hidden accept="video/*" onChange={(e) => (void open(e.target.files?.[0]), (e.target.value = ""))} />
      </div>
    </div>
  );
}
