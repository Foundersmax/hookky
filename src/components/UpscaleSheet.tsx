import { useEffect, useRef, useState } from "react";
import { setState } from "../store";
import { download } from "../export";
import { Icon } from "./Icon";
import { takeHandoff } from "../handoff";
import { Upscaler, DEFAULT_LOOK, type Look } from "../upscale/gl";
import { probe, upscaleVideo, targetSize, pickCodec, upscaleBitrate, TARGETS, CODEC_NAME, type TargetId, type SourceInfo } from "../upscale/run";

type Loaded = SourceInfo & { url: string; video: HTMLVideoElement; file: File };
type Cap = { ok: boolean; why?: string; codec?: string; size: [number, number] };

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);
const SLIDERS: { key: keyof Look; label: string; hint: string }[] = [
  { key: "clean", label: "Clean-up", hint: "Removes compression blocks and noise before scaling" },
  { key: "sharp", label: "Sharpness", hint: "Brings back edge detail after scaling, without halos" },
  { key: "rich", label: "Colour", hint: "Lifts flat colour and adds a touch of contrast" },
  { key: "grain", label: "Texture", hint: "Fine grain, so smooth areas don't look plastic" },
];

/** Upscale a video file to 1080p, 4K or 8K in the browser, with a before/after preview. */
export function UpscaleSheet() {
  const [src, setSrc] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<TargetId>("4k");
  const [caps, setCaps] = useState<Partial<Record<TargetId, Cap>>>({});
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [at, setAt] = useState(0);
  const [split, setSplit] = useState(0.5);
  const [detail, setDetail] = useState(false);
  const [busy, setBusy] = useState<{ p: number; label: string } | null>(null);
  const [done, setDone] = useState<{ line: string; notes: string[] } | null>(null);
  const [opening, setOpening] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const view = useRef<HTMLCanvasElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const up = useRef<Upscaler | null>(null);
  const abort = useRef<AbortController | null>(null);
  const drawId = useRef(0);

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

  async function open(file?: File) {
    if (!file) return;
    setError(null);
    setDone(null);
    setOpening(true);
    try {
      const p = await probe(file);
      setSrc({ ...p, file });
      setAt(Math.min(p.duration * 0.3, p.duration - 0.05));
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
      const best = (["4k", "1080p", "8k"] as TargetId[]).find((id) => next[id]?.ok);
      if (best) setTarget(best);
      else setError("This video is already 8K-class or this browser can't upscale it.");
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
        if (!up.current || up.current.outW !== pw || up.current.outH !== ph) {
          up.current?.dispose();
          up.current = new Upscaler(pw, ph);
        }
        if (Math.abs(src.video.currentTime - at) > 1e-3) {
          await new Promise<void>((res) => {
            const ok = () => (src.video.removeEventListener("seeked", ok), res());
            src.video.addEventListener("seeked", ok);
            src.video.currentTime = at;
          });
        }
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
        // before: the source frame stretched
        x.drawImage(src.video, (sx / pw) * src.w, (sy / ph) * src.h, (sw / pw) * src.w, (sh / ph) * src.h, 0, 0, c.width, c.height);
        // after: the upscaled frame, right of the divider
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
      } catch (e: any) {
        setError(e?.message ?? "The preview couldn't be drawn.");
      }
    })();
  }, [src, target, caps, look, at, split, detail, busy]);

  async function run() {
    if (!src) return;
    setError(null);
    setDone(null);
    abort.current = new AbortController();
    setBusy({ p: 0, label: "Starting" });
    up.current?.dispose(); // one GPU context at a time: the export makes its own
    up.current = null;
    try {
      const r = await upscaleVideo(src.file, { target, look, signal: abort.current.signal, onProgress: (p, label) => setBusy({ p, label }) });
      const name = `${src.file.name.replace(/\.[^.]+$/, "") || "video"}-${target}.mp4`;
      const saved = await download(r.blob, name);
      setDone({ line: `${saved ? "Saved" : "Ready"}: ${r.w}×${r.h} · ${r.frames} frames · ${CODEC_NAME[r.codec]}${r.audio ? ` + ${r.audio.toUpperCase()}` : ", no sound"} · ${mb(r.blob.size)}`, notes: r.notes });
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "The upscale failed.");
    } finally {
      setBusy(null);
    }
  }

  const cap = caps[target];
  const est = src && cap?.ok ? (upscaleBitrate(cap.size[0], cap.size[1], src.fps) * src.duration) / 8 : 0;

  // a clip handed over from another tool (AI video) opens straight away
  useEffect(() => {
    const f = takeHandoff();
    if (f) void open(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet sound-sheet upscale-sheet" role="dialog" aria-modal="true" aria-labelledby="upscale-title">
        <div className="sheet-head">
          <div>
            <h3 id="upscale-title">Upscale a video</h3>
            <p className="sound-sub">Turn a small or soft video into 1080p, 4K or 8K. It runs on this device; your video isn't uploaded.</p>
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
              <div className="upscale-canvas">
                <canvas
                  ref={view}
                  aria-label="Before and after preview. Drag to move the divider."
                  onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), setSplit(Math.min(0.98, Math.max(0.02, (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width))))}
                  onPointerMove={(e) => e.buttons === 1 && setSplit(Math.min(0.98, Math.max(0.02, (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width)))}
                />
                <span className="upscale-tag left">Before</span>
                <span className="upscale-tag right">After</span>
              </div>
              <div className="upscale-scrub">
                <input type="range" min={0} max={Math.max(0.05, src.duration - 0.05)} step={0.01} value={at} aria-label="Preview frame" disabled={!!busy} onChange={(e) => setAt(+e.target.value)} />
                <div className="seg" role="group" aria-label="Preview zoom">
                  <button className={!detail ? "on" : ""} onClick={() => setDetail(false)}>Whole frame</button>
                  <button className={detail ? "on" : ""} onClick={() => setDetail(true)}>Detail</button>
                </div>
              </div>
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
                      <button key={t.id} role="radio" aria-checked={target === t.id} disabled={!c?.ok || !!busy} className={`upscale-target ${target === t.id ? "on" : ""}`} title={c?.why} onClick={() => setTarget(t.id)}>
                        <b>{t.label}</b>
                        <small>{c ? `${c.size[0]}×${c.size[1]}` : ""}</small>
                        <small>{c?.ok ? c.codec : c?.why ? "Not available" : ""}</small>
                      </button>
                    );
                  })}
                </div>
                {TARGETS.filter((t) => caps[t.id] && !caps[t.id]!.ok).map((t) => (
                  <span className="tiny" key={t.id}>{t.label}: {caps[t.id]!.why}.</span>
                ))}
              </div>

              {SLIDERS.map((s) => (
                <label className="upscale-slider" key={s.key} title={s.hint}>
                  <span>{s.label}</span>
                  <input type="range" min={0} max={1} step={0.05} value={look[s.key]} disabled={!!busy} onChange={(e) => setLook({ ...look, [s.key]: +e.target.value })} />
                  <em>{Math.round(look[s.key] * 100)}</em>
                </label>
              ))}
              <button className="link" disabled={!!busy} onClick={() => setLook(DEFAULT_LOOK)}>Reset to recommended</button>

              {error && <p className="sound-error" role="alert">{error}</p>}
              {busy ? (
                <div className="upscale-progress" role="status">
                  <div className="bar"><i style={{ width: `${Math.round(busy.p * 100)}%` }} /></div>
                  <span>{busy.label} · {Math.round(busy.p * 100)}%</span>
                  <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
                </div>
              ) : (
                <button className="btn primary sound-build" disabled={!cap?.ok} onClick={run}>
                  <Icon name="expand" /> Upscale to {TARGETS.find((t) => t.id === target)!.label} and save
                </button>
              )}
              {!busy && cap?.ok && <span className="tiny">About {mb(est)}. Keep this tab open while it works; long or 8K videos take a while.</span>}
              {done && (
                <div className="upscale-done" role="status">
                  <b>{done.line}</b>
                  {done.notes.map((n) => <span key={n}>{n}</span>)}
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
