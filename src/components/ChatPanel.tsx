import { useEffect, useRef, useState } from "react";
import { useStudio, addAssets, setAudio, getState, pushChat, setState, updateChat } from "../store";
import { sendToAgent, resetAgent, reviewFrames, askForDirections, stopAgent } from "../agent/client";
import { DirectionCards } from "./DirectionCards";
import type { Asset, ChatAttachment } from "../types";
import { Icon } from "./Icon";
import { LogoMark } from "./Logo";
import { uid } from "../engine/util";
import { extractPalette } from "../engine/images";
import { ingestVoiceover } from "./VoicePanel";
import { VideoStore } from "../engine/videos";

const STARTERS: { t: string; s: string; directions?: boolean; upload?: boolean }[] = [
  { t: "Pitch me 3 directions", s: "Type your product first, then tap this for three looks to pick from.", directions: true },
  { t: "30s launch ad for a smartwatch", s: "30s launch ad for a minimalist smartwatch called \"Orbit\": titanium, 10-day battery, sleep coaching. Swiss style, pre-order CTA." },
  { t: "Vertical reel for a skincare drop", s: "Vertical 9:16 reel for a skincare drop. Blush style, soft and premium, captions on." },
  { t: "Animate my voice-over", s: "Upload a 30–60s voice-over and I'll storyboard it in sync.", upload: true },
];

export async function fileToUploadAsset(f: File): Promise<Asset> {
  const dataUrl = await downscaleToDataUrl(f, 1800);
  const dims = await new Promise<[number, number]>((res) => {
    const i = new Image();
    i.onload = () => res([i.naturalWidth, i.naturalHeight]);
    i.onerror = () => res([0, 0]);
    i.src = dataUrl;
  });
  const palette = await extractPalette(dataUrl).catch(() => []);
  const isLogo = /logo|mark|brand/i.test(f.name) || f.type === "image/svg+xml";
  return { id: `asset:up_${uid("").slice(1)}`, title: f.name, src: dataUrl, thumb: dataUrl, source: "upload", w: dims[0], h: dims[1], palette, kind: isLogo ? "logo" : "image" };
}

export const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
const MAX_VIDEO = 250e6;

/** A video clip from the user's computer, kept as a blob in the library (saved to IndexedDB). */
export async function fileToVideoAsset(f: File): Promise<Asset> {
  if (f.size > MAX_VIDEO) throw new Error(`${f.name} is over 250 MB. Trim it or export a smaller copy first.`);
  const src = URL.createObjectURL(f);
  try {
    const m = await VideoStore.probe(src);
    const palette = await extractPalette(m.poster).catch(() => []);
    return { id: `asset:vid_${uid("").slice(1)}`, title: f.name, src, thumb: m.poster, source: "upload", w: m.w, h: m.h, duration: +m.duration.toFixed(2), palette, kind: "video" };
  } catch (e) {
    URL.revokeObjectURL(src);
    throw e;
  }
}

async function downscaleToDataUrl(f: File, max: number): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const im = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(im.naturalWidth * s);
    c.height = Math.round(im.naturalHeight * s);
    c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
    // Keep PNG only when the image really has transparent areas (logos, cut-out products);
    // photos become high-quality JPEG, several times smaller to store and to send to Claude.
    return /png|svg|webp|gif/.test(f.type) && hasTransparency(c) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hasTransparency(c: HTMLCanvasElement) {
  try {
    const step = Math.max(1, Math.floor(Math.max(c.width, c.height) / 128));
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y += step) for (let x = 0; x < c.width; x += step) if (d[(y * c.width + x) * 4 + 3] < 250) return true;
    return false;
  } catch {
    return true; // can't inspect: keep PNG to be safe
  }
}

/** The agent is working: a soft wave with what it's doing right now. */
function Thinking({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <div className={`thinking-wave ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <span className="wave" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />
        ))}
      </span>
      <span className="wave-label">{label}…</span>
    </div>
  );
}

export function ChatPanel() {
  const chat = useStudio((s) => s.chat);
  const busy = useStudio((s) => s.busy);
  const health = useStudio((s) => s.health);
  const sceneCount = useStudio((s) => s.project.scenes.length);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chat.length) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  async function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (isVideoFile(f)) {
        try {
          const a = await fileToVideoAsset(f);
          addAssets([a]);
          setPending((p) => [...p, { kind: "image", name: f.name, assetId: a.id, preview: a.thumb }]);
        } catch (e: any) {
          pushChat({ id: uid("m"), role: "assistant", text: e.message, error: true });
        }
      } else if (f.type.startsWith("image/")) {
        const a = await fileToUploadAsset(f);
        addAssets([a]);
        setPending((p) => [...p, { kind: "image", name: f.name, assetId: a.id, preview: a.thumb }]);
      } else if (f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) {
        setPending((p) => [...p, { kind: "audio", name: f.name }]);
        await ingestVoiceover(f);
      } else {
        setState({ notice: `${f.name} isn't supported here. Drop images, video clips or audio.` });
      }
    }
  }

  function submit(t = text) {
    const msg = t.trim();
    if ((!msg && !pending.length) || busy) return;
    const hasAudio = pending.some((a) => a.kind === "audio") || !!getState().project.audio;
    const fallback = hasAudio ? "Turn my voice-over into an animated ad." : "Use these references.";
    sendToAgent(msg || fallback, pending);
    setText("");
    setPending([]);
  }

  return (
    <aside className="chat">
      <div className="chat-head">
        <h2>Creative agent</h2>
        <div className="row" style={{ flex: "none", gap: 6 }}>
          <span className={`pill ${health && health.agent !== "local" ? "ok" : ""}`} title={health?.agent === "local" ? "Claude isn't available here, so the built-in local director writes drafts" : "Claude is directing"}>
            <span className="dot" />
            {health ? (health.agent === "local" ? "Local director" : "Claude") : "…"}
          </span>
          {health && health.agent !== "local" && (
            <button className="btn icon ghost" title="Visual review: Claude looks at the rendered frames and fixes what it sees" aria-label="Review the rendered frames" disabled={busy || !sceneCount} onClick={() => reviewFrames()}>
              <Icon name="eye" />
            </button>
          )}
          <button className="btn icon ghost" title="New conversation" onClick={resetAgent}>
            <Icon name="reset" />
          </button>
        </div>
      </div>

      <div className="messages" ref={listRef}>
        {!chat.length && (
          <div className="welcome">
            <LogoMark size={36} />
            <h3>What are we launching?</h3>
            <p>Describe a product, drop images or a voice-over, or paste a link.</p>
            <div className="chips">
              {STARTERS.map((s) => (
                <button
                  key={s.t}
                  className={`chip ${s.directions ? "accent" : ""}`}
                  title={s.s}
                  onClick={() => (s.directions ? (text.trim() ? (askForDirections(text), setText("")) : askForDirections()) : s.upload ? fileRef.current?.click() : submit(s.s))}
                >
                  {s.t}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {m.review && m.attachments?.[0]?.preview ? (
              <figure className="review-sheet">
                <img src={m.attachments[0].preview} alt="Contact sheet of the rendered frames Claude reviewed" />
                <figcaption>{m.text}</figcaption>
              </figure>
            ) : !!m.attachments?.length && (
              <div className="att-row">
                {m.attachments.map((a, i) => (
                  <span className="att" key={i}>
                    {a.preview ? <img src={a.preview} alt="" /> : <span className="wave"><Icon name="mic" size={14} /></span>}
                    {a.name.slice(0, 22)}
                  </span>
                ))}
              </div>
            )}
            {m.thinking && (
              <details className="thinking">
                <summary>Thought process</summary>
                <div>{m.thinking}</div>
              </details>
            )}
            {!!m.activity?.length && (
              <div className="activity">
                {[...new Set(m.activity)].map((a) => (
                  <span key={a}>{a}</span>
                ))}
              </div>
            )}
            {(m.text || !m.pending) && !(m.review && m.attachments?.[0]?.preview) && <div className="bubble">{m.text}</div>}
            <DirectionCards m={m} />
            {m.pending && <Thinking label={m.activity?.length ? m.activity[m.activity.length - 1] : m.text ? "Working" : "Thinking"} compact={!!m.text} />}
            {m.error && m.retry && !busy && (
              <button
                className="btn retry-btn"
                onClick={() => {
                  updateChat(m.id, (x) => ({ ...x, retry: undefined }));
                  if (m.retry!.review) reviewFrames();
                  else sendToAgent(m.retry!.text, m.retry!.attachments ?? [], { display: m.retry!.display });
                }}
              >
                <Icon name="reset" size={13} /> Retry
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="composer">
        <div
          className={`composer-box ${drag ? "drag" : ""}`}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          {!!pending.length && (
            <div className="att-row" style={{ justifyContent: "flex-start", marginBottom: 6 }}>
              {pending.map((a, i) => (
                <span className="att" key={i}>
                  {a.preview ? <img src={a.preview} alt="" /> : <span className="wave"><Icon name="mic" size={14} /></span>}
                  {a.name.slice(0, 18)}
                  <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={text}
            placeholder="Describe the ad, paste a link, or ask for edits…"
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
          />
          <div className="composer-actions">
            <button className="btn icon ghost" title="Attach images or a voice-over" onClick={() => fileRef.current?.click()}>
              <Icon name="clip" />
            </button>
            <input ref={fileRef} type="file" hidden multiple accept="image/*,audio/*,video/*" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <span className="tiny" style={{ flex: 1 }}>Images · voice-over · links</span>
            {busy ? (
              <button className="btn" onClick={stopAgent} title="Stop the agent's reply">
                <span className="stop-square" aria-hidden="true" /> Stop
              </button>
            ) : (
              <button className="btn primary" disabled={!text.trim() && !pending.length} onClick={() => submit()}>
                <Icon name="send" size={14} /> Send
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
