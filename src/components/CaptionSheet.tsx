import { useEffect, useRef, useState } from "react";
import { getState, setState } from "../store";
import { download } from "../export";
import { Icon } from "./Icon";
import { takeHandoff } from "../handoff";
import { CaptionControls } from "./CaptionControls";
import { renderCaptions, type CaptionBox } from "../engine/captions";
import { probe, type SourceInfo } from "../upscale/run";
import { captionVideo, transcribeVideo, spreadWords } from "../captionVideo";
import type { CaptionStyle, Word } from "../types";
import { FRAMES, QUALITIES, DEFAULT_FRAMING, captionZoom, outputSize, drawFramed, panFocus, keptShare, frameSuffix, frameById, type FrameId, type Quality, type Framing, type Backdrop } from "../captionFrame";

const BACKDROPS: { id: Backdrop; label: string }[] = [
  { id: "blur", label: "Blurred" },
  { id: "black", label: "Black" },
  { id: "white", label: "White" },
  { id: "brand", label: "Brand colour" },
];
/** A small rectangle in the shape's proportions. */
function ShapeIcon({ ratio }: { ratio: number }) {
  const r = ratio || 16 / 9;
  const w = r >= 1 ? 22 : 22 * r, h = r >= 1 ? 22 / r : 22;
  return <i className="cap-shape-icon" style={{ width: w, height: h }} aria-hidden />;
}

type Loaded = SourceInfo & { url: string; video: HTMLVideoElement; file: File };
const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(1)} MB`);

/** Caption an uploaded video: transcribe its speech, pick a design, drag it into place, save. */
export function CaptionSheet() {
  const [src, setSrc] = useState<Loaded | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [style, setStyle] = useState<CaptionStyle | undefined>({ design: "karaoke" });
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [script, setScript] = useState("");
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState<{ p: number; label: string } | null>(null);
  const [done, setDone] = useState<{ line: string; notes: string[] } | null>(null);
  const [opening, setOpening] = useState(false);
  const [guide, setGuide] = useState(false);
  // screen size: the shape being previewed, more shapes to save alongside it, and each shape's framing
  const [frame, setFrame] = useState<FrameId>("original");
  const [quality, setQuality] = useState<Quality>("source");
  const [also, setAlso] = useState<FrameId[]>([]);
  const [framings, setFramings] = useState<Partial<Record<FrameId, Framing>>>({});
  const framing = framings[frame] ?? DEFAULT_FRAMING;
  const setFraming = (p: Partial<Framing>) => setFramings((m) => ({ ...m, [frame]: { ...(m[frame] ?? DEFAULT_FRAMING), ...p } }));
  const scratch = useRef({});
  const pan = useRef<{ x: number; y: number } | null>(null);
  const out = src ? outputSize(src.w, src.h, frame, quality) : { w: 16, h: 9 };
  const liveFrame = useRef({ frame, framing, out });
  liveFrame.current = { frame, framing, out };
  const view = useRef<HTMLCanvasElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<CaptionBox | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const live = useRef({ words, style });
  live.current = { words, style };
  const brand = getState().project.brand;

  const close = () => {
    if (busy) return;
    setState({ sheet: undefined });
  };
  useEffect(
    () => () => {
      if (src) {
        src.video.pause();
        src.video.removeAttribute("src");
        src.video.load();
        URL.revokeObjectURL(src.url);
      }
    },
    [src],
  );

  async function listen(file: File) {
    setListening(true);
    setNote(null);
    try {
      const w = await transcribeVideo(file);
      setWords(w);
      setNote(`${w.length} words transcribed. Click any word to fix it.`);
    } catch (e: any) {
      setWords([]);
      setNote(`${e?.message ?? "The speech couldn't be transcribed."} You can type the words below instead.`);
    } finally {
      setListening(false);
    }
  }
  async function open(file?: File) {
    if (!file) return;
    setError(null);
    setDone(null);
    setOpening(true);
    try {
      const p = await probe(file);
      p.video.muted = false;
      setSrc({ ...p, file });
      setAt(0);
      setWords([]);
      void listen(file);
    } catch (e: any) {
      setSrc(null);
      setError(e?.message ?? "That file couldn't be opened.");
    } finally {
      setOpening(false);
    }
  }

  // Draw the frame with its captions; while playing, every animation frame.
  const paint = () => {
    const c = view.current;
    if (!c || !src) return;
    const { frame: fr, framing: fg, out: o } = liveFrame.current;
    const wrap = c.parentElement!.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fit = Math.min(wrap.width / o.w, (window.innerHeight * 0.5) / o.h);
    const cw = Math.round(o.w * fit), ch = Math.round(o.h * fit);
    if (c.style.width !== `${cw}px` || c.style.height !== `${ch}px`) (c.style.width = `${cw}px`), (c.style.height = `${ch}px`);
    if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) (c.width = Math.round(cw * dpr)), (c.height = Math.round(ch * dpr));
    const x = c.getContext("2d")!;
    // draw in the output's own pixel units, so captions sit exactly where the export puts them
    x.setTransform(c.width / o.w, 0, 0, c.height / o.h, 0, 0);
    x.imageSmoothingQuality = "high";
    if (fr === "original") x.drawImage(src.video, 0, 0, o.w, o.h);
    else drawFramed(x, src.video, src.w, src.h, o.w, o.h, fg, brand.accent, scratch.current);
    box.current = renderCaptions(x, o.w, o.h, { words: live.current.words, style: live.current.style, brand, t: src.video.currentTime, zoom: captionZoom(o.w, o.h) });
  };
  useEffect(() => {
    if (!src || busy) return;
    let raf = 0;
    const v = src.video;
    if (playing) {
      const loop = () => {
        paint();
        setAt(v.currentTime);
        if (v.ended || v.paused) return setPlaying(false);
        raf = requestAnimationFrame(loop);
      };
      v.play().then(() => (raf = requestAnimationFrame(loop))).catch(() => setPlaying(false));
      return () => (cancelAnimationFrame(raf), v.pause());
    }
    const onSeek = () => paint();
    v.addEventListener("seeked", onSeek);
    if (Math.abs(v.currentTime - at) > 0.01) v.currentTime = at;
    else paint();
    return () => v.removeEventListener("seeked", onSeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, playing, at, words, style, busy, frame, quality, framings]);

  // Dragging on the preview: the captions move them; elsewhere, on a cropped shape, the video moves in the frame.
  const toVideo = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * out.w, y: ((e.clientY - r.top) / r.height) * out.h };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!src || busy) return;
    const b = box.current;
    const p = toVideo(e), m = Math.min(out.w, out.h) * 0.02;
    const onCaption = b && !(p.x < b.x - m || p.x > b.x + b.w + m || p.y < b.y - m || p.y > b.y + b.h + m);
    if (!onCaption) {
      if (frame === "original" || framing.fit !== "fill") return;
      e.currentTarget.setPointerCapture(e.pointerId);
      pan.current = p;
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { dx: p.x - (b!.x + b!.w / 2), dy: p.y - (b!.y + b!.h / 2) };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!src) return;
    if (pan.current) {
      const p = toVideo(e);
      setFraming(panFocus(src.w, src.h, out.w, out.h, framing, p.x - pan.current.x, p.y - pan.current.y));
      pan.current = p;
      return;
    }
    if (!drag.current) return;
    const p = toVideo(e);
    let x = Math.min(1, Math.max(0, (p.x - drag.current.dx) / out.w));
    const y = Math.min(1, Math.max(0, (p.y - drag.current.dy) / out.h));
    const snap = Math.abs(x - 0.5) < 0.02;
    if (snap) x = 0.5;
    setGuide(snap);
    setStyle((s) => ({ ...s, x: +x.toFixed(3), y: +y.toFixed(3) }));
  };
  const onUp = () => ((drag.current = null), (pan.current = null), setGuide(false));

  async function run() {
    if (!src || !words.length) return;
    setError(null);
    setDone(null);
    setPlaying(false);
    abort.current = new AbortController();
    setBusy({ p: 0, label: "Starting" });
    // the previewed shape first, then any others ticked; each saved as its own file
    const shapes = [frame, ...also.filter((f) => f !== frame)];
    const lines: string[] = [];
    const notes = new Set<string>();
    try {
      for (const [k, shape] of shapes.entries()) {
        const tag = shapes.length > 1 ? `${frameById(shape).label} (${k + 1} of ${shapes.length}) · ` : "";
        const r = await captionVideo(src.file, {
          words, style, brand, signal: abort.current.signal,
          frame: { frame: shape, quality, framing: framings[shape] ?? DEFAULT_FRAMING },
          onProgress: (p, label) => setBusy({ p: (k + p) / shapes.length, label: tag + label }),
        });
        const saved = await download(r.blob, `${src.file.name.replace(/\.[^.]+$/, "") || "video"}-captioned${frameSuffix(shape)}.mp4`);
        lines.push(`${saved ? "Saved" : "Ready"}${shapes.length > 1 ? ` ${frameById(shape).label}` : ""}: ${r.w}×${r.h} · ${r.frames} frames · ${r.codec}${r.audio ? ` + ${r.audio.toUpperCase()}` : ", no sound"} · ${mb(r.blob.size)}`);
        r.notes.forEach((n) => notes.add(n));
        setDone({ line: lines.join("\n"), notes: [...notes] });
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message ?? "The captions couldn't be added.");
    } finally {
      setBusy(null);
    }
  }

  const now = words.findIndex((w) => at >= w.s && at <= w.e + 0.05);
  // a clip handed over from another tool (AI video) opens straight away
  useEffect(() => {
    const f = takeHandoff();
    if (f) void open(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet sound-sheet upscale-sheet" role="dialog" aria-modal="true" aria-labelledby="caption-title">
        <div className="sheet-head">
          <div>
            <h3 id="caption-title">Caption a video</h3>
            <p className="sound-sub">Upload a video and its speech is transcribed into captions. Pick a design, drag them where you want, and save.</p>
          </div>
          <button className="btn icon ghost" onClick={close} aria-label="Close" disabled={!!busy}>
            <Icon name="minus" />
          </button>
        </div>
        {!src ? (
          <div className="upscale-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void open([...e.dataTransfer.files].find((f) => f.type.startsWith("video/")) ?? e.dataTransfer.files[0]))}>
            <Icon name="mic" size={26} />
            <b>{opening ? "Opening…" : "Drop a video here"}</b>
            <span>MP4, MOV or WebM, with speech</span>
            <button className="btn primary" disabled={opening} onClick={() => fileIn.current?.click()}>Choose a video</button>
          </div>
        ) : (
          <div className="upscale-body">
            <div className="upscale-view">
              <div className="upscale-canvas">
                <canvas ref={view} aria-label={frame !== "original" && framing.fit === "fill" ? "Preview. Drag the captions to move them, or the video to reframe it." : "Preview. Drag the captions to move them."} style={{ cursor: "grab", touchAction: "none" }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
                {guide && <i className="cap-guide" style={{ left: "50%", top: 0, bottom: 0 }} aria-hidden />}
              </div>
              <div className="upscale-scrub">
                <button className="btn icon" aria-label={playing ? "Pause" : "Play"} disabled={!!busy} onClick={() => setPlaying(!playing)}>
                  <Icon name={playing ? "pause" : "play"} />
                </button>
                <input type="range" min={0} max={Math.max(0.05, src.duration - 0.05)} step={0.01} value={at} aria-label="Position in the video" disabled={!!busy} onChange={(e) => (setPlaying(false), setAt(+e.target.value))} />
                <span className="tiny">{at.toFixed(1)}s / {src.duration.toFixed(1)}s</span>
              </div>
              <div className="caption-words" aria-label="Transcript">
                {listening && <span className="tiny">Listening to the speech…</span>}
                {words.map((w, i) =>
                  editing === i ? (
                    <input
                      key={i}
                      autoFocus
                      defaultValue={w.w}
                      size={Math.max(2, w.w.length)}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        setWords(v ? words.map((x, k) => (k === i ? { ...x, w: v } : x)) : words.filter((_, k) => k !== i));
                        setEditing(null);
                      }}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && e.currentTarget.blur()}
                    />
                  ) : (
                    <button key={i} className={i === now ? "on" : ""} title="Click to fix this word (empty it to remove)" disabled={!!busy} onClick={() => (setPlaying(false), setAt(w.s + 0.01), setEditing(i))}>{w.w}</button>
                  ),
                )}
              </div>
              {note && <span className="tiny">{note}</span>}
              {!listening && !words.length && (
                <div className="field">
                  <span className="label">Type or paste what's said</span>
                  <textarea rows={3} value={script} placeholder="The words spoken in the video, in order" onChange={(e) => setScript(e.target.value)} />
                  <div className="row">
                    <button className="btn" disabled={!script.trim()} onClick={() => (setWords(spreadWords(script, src.duration)), setNote("Timed evenly across the video. Scrub to check; click a word to fix it."))}>Use these words</button>
                    <button className="btn ghost" onClick={() => void listen(src.file)}>Try transcribing again</button>
                  </div>
                </div>
              )}
            </div>
            <aside className="upscale-side">
              <div className="upscale-file">
                <b title={src.file.name}>{src.file.name}</b>
                <span>{src.w}×{src.h} · {src.duration.toFixed(1)}s · {src.fps} fps · {mb(src.file.size)}</span>
                <button className="link" disabled={!!busy} onClick={() => (setPlaying(false), setSrc(null), setWords([]), setDone(null), setError(null), setNote(null))}>Choose another</button>
              </div>
              <section className="cap-frame" aria-labelledby="cap-frame-title">
                <div className="cap-frame-head">
                  <span className="label" id="cap-frame-title">Screen size</span>
                  <span className="tiny">{out.w}×{out.h}</span>
                </div>
                <div className="cap-shapes" role="radiogroup" aria-label="Screen shape">
                  {FRAMES.map((f) => (
                    <button
                      key={f.id}
                      role="radio"
                      aria-checked={frame === f.id}
                      className={`cap-shape ${frame === f.id ? "on" : ""} ${also.includes(f.id) && frame !== f.id ? "also" : ""}`}
                      title={f.hint}
                      disabled={!!busy}
                      onClick={() => setFrame(f.id)}
                    >
                      <ShapeIcon ratio={f.ratio || src.w / src.h} />
                      <b>{f.label}</b>
                      <small>{f.hint}</small>
                    </button>
                  ))}
                </div>
                {frame !== "original" && (
                  <>
                    <div className="sheet-row">
                      <span>Framing</span>
                      <div className="seg" role="radiogroup" aria-label="Framing">
                        <button role="radio" aria-checked={framing.fit === "fill"} className={framing.fit === "fill" ? "on" : ""} onClick={() => setFraming({ fit: "fill" })} title="Crop to fill the screen; drag the video to choose what stays in">Fill (crop)</button>
                        <button role="radio" aria-checked={framing.fit === "fit"} className={framing.fit === "fit" ? "on" : ""} onClick={() => setFraming({ fit: "fit" })} title="Show the whole video, with a background around it">Fit (whole)</button>
                      </div>
                    </div>
                    {framing.fit === "fill" ? (
                      <>
                        <label className="sheet-row cap-zoom">
                          <span>Zoom</span>
                          <input type="range" min={1} max={2.5} step={0.05} value={framing.zoom} aria-label="Zoom" onChange={(e) => setFraming({ zoom: +e.target.value })} />
                          <span className="tiny">{Math.round(framing.zoom * 100)}%</span>
                        </label>
                        <span className="tiny">Drag the video in the preview to choose what stays in the frame.{" "}
                          <button className="link" onClick={() => setFraming({ focusX: 0.5, focusY: 0.5, zoom: 1 })}>Centre it</button>
                        </span>
                        {keptShare(src.w, src.h, out.w, out.h, framing) < 0.45 && <span className="tiny cap-warn">This crop keeps less than half of the picture. "Fit" shows all of it.</span>}
                      </>
                    ) : (
                      <div className="sheet-row">
                        <span>Background</span>
                        <div className="seg" role="radiogroup" aria-label="Background">
                          {BACKDROPS.map((b) => (
                            <button key={b.id} role="radio" aria-checked={framing.backdrop === b.id} className={framing.backdrop === b.id ? "on" : ""} onClick={() => setFraming({ backdrop: b.id })}>{b.label}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="sheet-row">
                  <span>Quality</span>
                  <div className="seg" role="radiogroup" aria-label="Quality">
                    {QUALITIES.map((q) => (
                      <button key={q.id} role="radio" aria-checked={quality === q.id} className={quality === q.id ? "on" : ""} title={q.id === "source" ? "Keep the video's own sharpness (no upscaling)" : `${q.label} on the short side`} onClick={() => setQuality(q.id)}>{q.label}</button>
                    ))}
                  </div>
                </div>
                <details className="cap-also">
                  <summary>Also save in other sizes{also.filter((f) => f !== frame).length ? ` (${also.filter((f) => f !== frame).length})` : ""}</summary>
                  <div className="cap-also-list">
                    {FRAMES.filter((f) => f.id !== frame).map((f) => (
                      <label key={f.id} className="toggle">
                        <input type="checkbox" checked={also.includes(f.id)} disabled={!!busy} onChange={(e) => setAlso((a) => (e.target.checked ? [...a, f.id] : a.filter((x) => x !== f.id)))} />
                        {f.label} <span className="tiny">{f.hint}</span>
                      </label>
                    ))}
                    <span className="tiny">Each size uses its own framing: pick it above to adjust. Captions keep their place in every size.</span>
                  </div>
                </details>
              </section>
              <CaptionControls value={style} onChange={setStyle} />
              {error && <p className="sound-error" role="alert">{error}</p>}
              {busy ? (
                <div className="upscale-progress" role="status">
                  <div className="bar"><i style={{ width: `${Math.round(busy.p * 100)}%` }} /></div>
                  <span>{busy.label} · {Math.round(busy.p * 100)}%</span>
                  <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
                </div>
              ) : (
                <button className="btn primary sound-build" disabled={!words.length || listening} onClick={run}>
                  <Icon name="download" /> {listening ? "Listening…" : also.some((f) => f !== frame) ? `Save ${1 + also.filter((f) => f !== frame).length} sizes with captions` : "Save with captions"}
                </button>
              )}
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
