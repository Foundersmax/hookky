import { useEffect, useRef, useState } from "react";
import { useStudio, addAssets, setAudio, getState } from "../store";
import { sendToAgent, resetAgent } from "../agent/client";
import type { Asset, ChatAttachment } from "../types";
import { Icon } from "./Icon";
import { uid } from "../engine/util";
import { extractPalette } from "../engine/images";
import { ingestVoiceover } from "./VoicePanel";

const STARTERS = [
  { t: "30s launch ad for a minimalist smartwatch", s: "\"Orbit\" — titanium, 10-day battery, sleep coaching. Swiss style, pre-order CTA." },
  { t: "Vertical reel for a skincare drop", s: "Blush style, 9:16, soft and premium, captions on." },
  { t: "Turn my voice-over into motion graphics", s: "Upload a 30–60s VO and I'll storyboard it in sync." },
  { t: "Find references on Pinterest & Freepik", s: "Moodboard for matte-black audio gear, studio lighting." },
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
    // keep transparency for PNG/SVG (logos, cut-out products)
    return /png|svg|webp/.test(f.type) ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ChatPanel() {
  const chat = useStudio((s) => s.chat);
  const busy = useStudio((s) => s.busy);
  const health = useStudio((s) => s.health);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [chat]);

  async function addFiles(files: FileList | File[]) {
    for (const f of Array.from(files)) {
      if (f.type.startsWith("image/")) {
        const a = await fileToUploadAsset(f);
        addAssets([a]);
        setPending((p) => [...p, { kind: "image", name: f.name, assetId: a.id, preview: a.thumb }]);
      } else if (f.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) {
        setPending((p) => [...p, { kind: "audio", name: f.name }]);
        await ingestVoiceover(f);
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
          <span className={`pill ${health?.agent === "claude" ? "ok" : ""}`} title={health?.agent === "claude" ? "Claude is directing" : "No API key — using the built-in local director"}>
            <span className="dot" />
            {health ? (health.agent === "claude" ? "Claude" : "Local director") : "…"}
          </span>
          <button className="btn icon ghost" title="New conversation" onClick={resetAgent}>
            <Icon name="reset" />
          </button>
        </div>
      </div>

      <div className="messages" ref={listRef}>
        {!chat.length && (
          <div className="welcome">
            <div className="tiny">MOTIF STUDIO</div>
            <h3>What are we launching?</h3>
            <p>Describe the product, drop references or a voice-over, or paste a link from Pinterest, Freepik, Envato — anywhere.</p>
            <div className="chips">
              {STARTERS.map((s) => (
                <button key={s.t} className="chip" onClick={() => submit(`${s.t}. ${s.s}`)}>
                  {s.t}
                  <small>{s.s}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.error ? "error" : ""}`}>
            {!!m.attachments?.length && (
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
            {(m.text || !m.pending) && <div className="bubble">{m.text}</div>}
            {m.pending && !m.text && (
              <div className="bubble">
                <span className="typing"><i /><i /><i /></span>
              </div>
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
            <input ref={fileRef} type="file" hidden multiple accept="image/*,audio/*" onChange={(e) => e.target.files && addFiles(e.target.files)} />
            <span className="tiny" style={{ flex: 1 }}>Images · voice-over · links</span>
            <button className="btn primary" disabled={busy || (!text.trim() && !pending.length)} onClick={() => submit()}>
              <Icon name="send" size={14} /> {busy ? "Working" : "Send"}
            </button>
          </div>
        </div>
        <div className="hint">
          <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline · drop files anywhere here
        </div>
      </div>
    </aside>
  );
}
