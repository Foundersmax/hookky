import { useEffect, useMemo, useRef, useState } from "react";
import { addAssets, setState, useStudio } from "../store";
import { uid } from "../engine/util";
import { download } from "../export";
import { handoff } from "../handoff";
import { Icon } from "./Icon";
import { VIDEO_MODELS, supports, type GenMode, type VideoModel } from "../aivideo/models";
import { useGenerations, startGeneration, removeGeneration, clearFinished, refreshUsage, pending, playable, fetchClip, fileName, type Generation } from "../aivideo/store";

const MAX_MODELS = 3;

type Connection = { id: string; name: string; keyName: string; keySet: boolean; on: boolean; locked: boolean; models: string[] };
/** Admins: switch each video connection on or off for everyone. */
function Connections({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Connection[] | null>(null);
  const [storage, setStorage] = useState<{ on: boolean; bucket: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => {
    fetch("/api/admin/aivideo")
      .then(async (r) => ((await r.json().catch(() => ({}))) as any))
      .then((j) => (j.connections ? (setList(j.connections), setStorage(j.storage ?? null)) : setError(j.error ?? "Couldn't load the connections.")))
      .catch(() => setError("Couldn't load the connections."));
  }, []);
  const flip = async (c: Connection) => {
    setBusy(c.id);
    setError(null);
    try {
      const r = await fetch("/api/admin/aivideo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route: c.id, on: !c.on }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `The server answered ${r.status}.`);
      setList(j.connections);
      void refreshUsage();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet vs-conn" role="dialog" aria-modal="true" aria-labelledby="vs-conn-title">
        <div className="sheet-head">
          <h3 id="vs-conn-title">Video connections</h3>
          <button className="btn ghost icon" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="vs-conn-lead">Switch a maker off to stop new videos on its account, for everyone. Clips already rendering still finish. A model whose maker is off runs on fal.ai instead, if fal.ai is on.</p>
        {error && <p className="vs-error" role="alert">{error}</p>}
        {!list && !error && <p className="vs-conn-lead">Loading…</p>}
        {storage && (
          <p className={`vs-conn-store ${storage.on ? "on" : ""}`}>
            {storage.on ? (
              <>
                <b>Storage: Cloudflare R2</b> · every finished clip is copied to the <code>{storage.bucket}</code> bucket, so it outlives the makers' links.
              </>
            ) : (
              <>
                <b>No storage yet</b> · clips last only as long as each maker keeps them (hours to days). Add <code>R2_ACCOUNT_ID</code>, <code>R2_ACCESS_KEY_ID</code>, <code>R2_SECRET_ACCESS_KEY</code> and <code>R2_BUCKET</code> in the server's environment to keep them.
              </>
            )}
          </p>
        )}
        <ul className="vs-conn-list">
          {list?.map((c) => (
            <li key={c.id}>
              <div>
                <b>{c.name}</b>
                <small>{c.keySet ? c.models.join(", ") : `No key yet: add ${c.keyName} in the server's environment`}</small>
                {c.locked && <small className="vs-conn-locked">Switched off in the environment (AI_VIDEO_OFF)</small>}
              </div>
              <label className="vs-switch" title={c.locked ? "Off in the server's environment" : c.on ? "Switch off" : "Switch on"}>
                <input type="checkbox" role="switch" checked={c.on && !c.locked} disabled={c.locked || busy === c.id} aria-label={`${c.name} ${c.on ? "on" : "off"}`} onChange={() => void flip(c)} />
                <span aria-hidden />
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
const IDEAS = [
  "A barista pours latte art in slow motion, warm morning light, shallow depth of field",
  "Macro shot of a sneaker splashing through a neon puddle at night, camera tracking low",
  "Drone flight over a foggy pine forest at sunrise, golden rays breaking through",
  "A phone rotates on a glossy black surface, studio lighting, soft reflections, product ad",
];
const FAMILIES = [...new Set(VIDEO_MODELS.map((m) => m.family))];
const union = <T,>(lists: (T[] | undefined)[]) => [...new Set(lists.flatMap((l) => l ?? []))];
const resRank = (r: string) => parseInt(r) || 0;

/** A picture as a JPEG data URL no longer than 1536 px a side (what the models take). */
async function toDataUrl(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("That isn't an image.");
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error("That image couldn't be read.");
  });
  const k = Math.min(1, 1536 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(bmp.width * k));
  c.height = Math.max(2, Math.round(bmp.height * k));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", 0.9);
}

function Frame({ label, hint, value, onChange, onError }: { label: string; hint: string; value?: string; onChange: (v?: string) => void; onError: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f?: File) => f && toDataUrl(f).then(onChange, (e) => onError(e.message));
  return (
    <div
      className={`vs-frame ${over ? "over" : ""} ${value ? "has" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={value ? `${label}: replace` : `${label}: choose an image`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), input.current?.click())}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), void take(e.dataTransfer.files?.[0]))}
    >
      {value ? <img src={value} alt="" /> : <span className="vs-frame-empty"><Icon name="image" /><b>{label}</b><small>{hint}</small></span>}
      {value && (
        <button className="vs-frame-x" aria-label={`Remove ${label.toLowerCase()}`} onClick={(e) => (e.stopPropagation(), onChange(undefined))}>
          ×
        </button>
      )}
      {value && <span className="vs-frame-tag">{label}</span>}
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => (void take(e.target.files?.[0]), (e.target.value = ""))} />
    </div>
  );
}

const badges = (m: VideoModel) => [m.audio && "Sound", m.resolutions?.length ? m.resolutions.reduce((a, b) => (resRank(b) > resRank(a) ? b : a)).replace("2160p", "4K") : null, m.durations?.length ? `≤ ${Math.max(...m.durations)} s` : null, m.speed === "fast" ? "Fast" : m.speed === "premium" ? "Best" : null].filter(Boolean) as string[];

function elapsed(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function Card({ g, onReuse }: { g: Generation; onReuse: (g: Generation) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!pending(g)) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [g.state]);
  const say = (notice: string) => setState({ notice });
  const withClip = async (what: string, fn: (f: File) => void) => {
    setBusy(what);
    try {
      fn(await fetchClip(g));
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const toLibrary = () => {
    const v = video.current;
    let thumb: string | undefined;
    try {
      if (v && v.videoWidth) {
        const c = document.createElement("canvas");
        c.width = 480;
        c.height = Math.round((480 * v.videoHeight) / v.videoWidth);
        c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
        thumb = c.toDataURL("image/jpeg", 0.8);
      }
    } catch {}
    addAssets([{ id: uid("a"), kind: "video", title: g.prompt.slice(0, 60), src: g.url!, thumb, source: `AI · ${g.modelName}`, w: v?.videoWidth || g.w, h: v?.videoHeight || g.h, duration: v && Number.isFinite(v.duration) ? v.duration : g.settings.duration }]);
    say("Added to your library. Open a project and find it under Assets.");
  };
  const meta = [g.mode === "image" ? "Image → video" : "Text → video", g.settings.aspect, g.settings.duration && `${g.settings.duration}s`, g.settings.resolution, g.via && `via ${g.via}`].filter(Boolean).join(" · ");
  return (
    <article className={`vs-card ${g.state}`}>
      <div className="vs-media">
        {g.state === "done" && g.url && !broken ? (
          <video ref={video} src={playable(g.url)} controls loop playsInline preload="metadata" crossOrigin="anonymous" onError={() => setBroken(true)} />
        ) : g.state === "failed" || broken ? (
          <div className="vs-wait failed" role="status">
            <b>{broken ? "This clip is no longer available" : "Didn't finish"}</b>
            <small>{broken ? "It was never saved to storage, and the model's host only keeps clips for a limited time. Generate it again to get a fresh one." : g.error}</small>
          </div>
        ) : (
          <div className="vs-wait" role="status" aria-live="polite">
            <span className="vs-pulse" aria-hidden />
            <b>{g.state === "sending" ? "Sending…" : g.state === "queued" ? (g.position ? `In the queue (${g.position} ahead)` : "In the queue") : "Rendering…"}</b>
            <small>{elapsed(Date.now() - g.at)} · most clips take 1–4 minutes</small>
          </div>
        )}
      </div>
      <div className="vs-info">
        <div className="vs-info-top">
          <b>{g.modelName}</b>
          <small>{meta}</small>
        </div>
        <p title={g.prompt}>{g.prompt}</p>
        {g.note && <small className="vs-note-card">{g.note}</small>}
        <div className="vs-actions">
          {g.state === "done" && !broken && (
            <>
              <button className="btn" disabled={!!busy} onClick={() => void withClip("download", (f) => download(f, f.name))}>
                <Icon name="download" /> {busy === "download" ? "Fetching…" : "Download"}
              </button>
              <button className="btn" disabled={!!busy} onClick={toLibrary} title="Use this clip in a project">
                <Icon name="plus" /> Library
              </button>
              <button className="btn" disabled={!!busy} onClick={() => void withClip("caption", (f) => ((handoff.file = f), setState({ sheet: "caption" })))}>
                <Icon name="mic" /> {busy === "caption" ? "Fetching…" : "Caption"}
              </button>
              <button className="btn" disabled={!!busy} onClick={() => void withClip("upscale", (f) => ((handoff.file = f), setState({ sheet: "upscale" })))}>
                <Icon name="expand" /> {busy === "upscale" ? "Fetching…" : "Upscale"}
              </button>
            </>
          )}
          <span className="spacer" />
          <button className="btn ghost icon" title="Use this prompt and settings again" aria-label="Reuse prompt" onClick={() => onReuse(g)}>
            <Icon name="reset" />
          </button>
          {g.state !== "sending" && (
            <button className="btn ghost icon" title={pending(g) ? "Stop watching this one" : "Remove"} aria-label="Remove" onClick={() => removeGeneration(g.id)}>
              <Icon name="trash" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** The AI video workspace: one prompt, any model (or a few side by side), every clip kept in a gallery. */
export function VideoStudio() {
  const { list, usage } = useGenerations();
  const [mode, setMode] = useState<GenMode>("text");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<string>();
  const [endImage, setEndImage] = useState<string>();
  const [picked, setPicked] = useState<string[]>(["seedance-25"]);
  const [family, setFamily] = useState<string>("All");
  const [aspect, setAspect] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState("720p");
  const [audio, setAudio] = useState(true);
  const [negative, setNegative] = useState("");
  const [seed, setSeed] = useState("");
  const [more, setMore] = useState(false);
  const [conn, setConn] = useState(false);
  const admin = useStudio((s) => s.auth.user?.role === "admin");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const promptBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => void refreshUsage(), []);

  const models = useMemo(() => picked.map((id) => VIDEO_MODELS.find((m) => m.id === id)!).filter((m) => m && supports(m, mode) && (!usage?.configured || !!usage.routes?.[m.id]?.modes.includes(mode))), [picked, mode, usage]);
  // options on offer: everything any picked model has (each model takes its nearest)
  const aspects = union(models.map((m) => (mode === "text" || m.i2vAspect ? m.aspects : undefined)));
  const durations = union(models.map((m) => m.durations)).sort((a, b) => a - b);
  const resolutions = union(models.map((m) => m.resolutions)).sort((a, b) => resRank(a) - resRank(b));
  const hasAudio = models.some((m) => m.audio && m.audio !== "always");
  const hasNegative = models.some((m) => m.negative);
  const hasSeed = models.some((m) => m.seed);
  const hasEnd = mode === "image" && models.some((m) => m.endParam);
  useEffect(() => {
    if (aspects.length && !aspects.includes(aspect)) setAspect(aspects[0]);
    if (durations.length && !durations.includes(duration)) setDuration(durations.reduce((a, b) => (Math.abs(b - duration) < Math.abs(a - duration) ? b : a)));
    if (resolutions.length && !resolutions.includes(resolution)) setResolution(resolutions.includes("720p") ? "720p" : resolutions[0]);
  }, [aspects.join(), durations.join(), resolutions.join()]);

  const toggle = (m: VideoModel) => {
    setError(null);
    setPicked((p) => (p.includes(m.id) ? (p.length > 1 ? p.filter((x) => x !== m.id) : p) : p.length >= MAX_MODELS ? [...p.slice(1), m.id] : [...p, m.id]));
  };
  const left = usage ? Math.max(0, usage.limit - usage.used) : 0;
  const why = !usage ? "Checking the server…" : !usage.configured ? null : !models.length ? `Pick a model that does ${mode === "text" ? "text to video" : "image to video"}.` : !prompt.trim() ? "Describe the video." : mode === "image" && !image ? "Add the image to animate." : left < models.length ? (left ? `Only ${left} left today: pick fewer models.` : `You've made today's ${usage.limit} videos. The count resets at midnight UTC.`) : null;
  const canGo = !!usage?.configured && !why && !sending;

  async function go() {
    if (!canGo) return;
    setError(null);
    setSending(true);
    const seedN = /^\d{1,9}$/.test(seed.trim()) ? Number(seed.trim()) : undefined;
    await Promise.all(models.map((m) => startGeneration({ model: m.id, mode, prompt, image: mode === "image" ? image : undefined, endImage: mode === "image" && m.endParam ? endImage : undefined, aspect, duration, resolution, audio, negative: negative.trim() || undefined, seed: seedN })));
    setSending(false);
    void refreshUsage();
  }
  const reuse = (g: Generation) => {
    setPrompt(g.prompt);
    setMode(g.mode);
    setPicked([g.model]);
    if (g.settings.aspect) setAspect(g.settings.aspect);
    if (g.settings.duration) setDuration(g.settings.duration);
    if (g.settings.resolution) setResolution(g.settings.resolution);
    if (g.settings.audio !== undefined) setAudio(g.settings.audio);
    setNegative(g.settings.negative ?? "");
    setSeed(g.settings.seed !== undefined ? String(g.settings.seed) : "");
    promptBox.current?.focus();
    promptBox.current?.scrollIntoView({ block: "nearest" });
  };

  const shown = VIDEO_MODELS.filter((m) => family === "All" || m.family === family);
  const active = list.filter(pending).length;
  const finished = list.length - active;

  return (
    <div className="vs">
      {conn && <Connections onClose={() => setConn(false)} />}
      <aside className="vs-compose" aria-label="New video">
        <div className="vs-scroll">
          <div className="seg vs-mode" role="tablist" aria-label="Start from">
            {(["text", "image"] as GenMode[]).map((m) => (
              <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                {m === "text" ? "Text → video" : "Image → video"}
              </button>
            ))}
          </div>

          {mode === "image" && (
            <div className={`vs-frames ${hasEnd ? "two" : ""}`}>
              <Frame label="First frame" hint="Drop or choose an image" value={image} onChange={setImage} onError={setError} />
              {hasEnd && <Frame label="Last frame" hint="Optional: where it ends" value={endImage} onChange={setEndImage} onError={setError} />}
            </div>
          )}

          <div className="field">
            <label htmlFor="vs-prompt">{mode === "text" ? "Describe the video" : "Describe the motion"}</label>
            <textarea
              id="vs-prompt"
              ref={promptBox}
              value={prompt}
              maxLength={2000}
              rows={5}
              placeholder={mode === "text" ? "Subject, action, setting, camera move, light and mood…" : "What moves, and how the camera moves…"}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void go()}
            />
            {!prompt && mode === "text" && (
              <div className="vs-ideas">
                {IDEAS.map((t) => (
                  <button key={t} onClick={() => setPrompt(t)}>
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label>
              Model <span className="vs-count">{picked.length > 1 ? `${models.length} side by side` : `pick up to ${MAX_MODELS} to compare`}</span>
            </label>
            <div className="vs-fams" role="tablist" aria-label="Maker">
              {["All", ...FAMILIES].map((f) => (
                <button key={f} role="tab" aria-selected={family === f} className={family === f ? "on" : ""} onClick={() => setFamily(f)}>
                  {f}
                </button>
              ))}
            </div>
            <div className="vs-models">
              {shown.map((m) => {
                const route = usage?.routes?.[m.id];
                const connected = !usage?.configured || (!!route && route.modes.includes(mode));
                const ok = supports(m, mode) && connected;
                const on = picked.includes(m.id);
                return (
                  <button key={m.id} className={`vs-model ${on ? "on" : ""}`} aria-pressed={on} disabled={!ok} onClick={() => toggle(m)} title={!connected ? `${m.name} isn't connected on this server` : ok ? m.blurb : `${m.name} doesn't do ${mode === "text" ? "text to video" : "image to video"}`}>
                    <span className="vs-check" aria-hidden />
                    <span className="vs-model-text">
                      <b>
                        {m.name} <i>{m.maker}</i>
                      </b>
                      <small>{!supports(m, mode) ? "Text to video only" : !connected ? (route ? `${mode === "image" ? "Image" : "Text"} to video isn't connected` : "Not connected") : m.blurb}</small>
                    </span>
                    <span className="vs-badges">
                      {badges(m).map((b) => (
                        <em key={b}>{b}</em>
                      ))}
                      {route && <em className="vs-via" title={`Runs on ${route.via}`}>{route.route === "fal" ? "fal.ai" : "Direct"}</em>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {aspects.length > 0 && (
            <div className="field">
              <label>Shape</label>
              <div className="seg vs-opts">
                {aspects.map((a) => (
                  <button key={a} className={aspect === a ? "on" : ""} onClick={() => setAspect(a)}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mode === "image" && !aspects.length && models.length > 0 && <p className="vs-note">The clip keeps your image's shape.</p>}
          <div className="vs-two">
            {durations.length > 0 && (
              <div className="field">
                <label>Length</label>
                <div className="seg vs-opts">
                  {durations.map((d) => (
                    <button key={d} className={duration === d ? "on" : ""} onClick={() => setDuration(d)}>
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            )}
            {resolutions.length > 0 && (
              <div className="field">
                <label>Quality</label>
                <div className="seg vs-opts">
                  {resolutions.map((r) => (
                    <button key={r} className={resolution === r ? "on" : ""} onClick={() => setResolution(r)}>
                      {r === "2160p" ? "4K" : r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {models.length > 1 && <p className="vs-note">Each model uses the closest length and quality it offers.</p>}
          {hasAudio && (
            <label className="toggle">
              <input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Generate sound (voices, effects, ambience)
            </label>
          )}
          {(hasNegative || hasSeed) && (
            <>
              <button className="vs-more" aria-expanded={more} onClick={() => setMore((v) => !v)}>
                {more ? "Fewer options" : "More options"}
              </button>
              {more && (
                <div className="vs-two">
                  {hasNegative && (
                    <div className="field">
                      <label htmlFor="vs-neg">Avoid</label>
                      <input id="vs-neg" type="text" value={negative} maxLength={500} placeholder="blur, text, watermark…" onChange={(e) => setNegative(e.target.value)} />
                    </div>
                  )}
                  {hasSeed && (
                    <div className="field">
                      <label htmlFor="vs-seed">Seed</label>
                      <input id="vs-seed" type="text" inputMode="numeric" value={seed} placeholder="Random" onChange={(e) => setSeed(e.target.value.replace(/\D/g, "").slice(0, 9))} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="vs-go">
          {usage && !usage.configured && (
            <p className="vs-setup" role="status">
              <b>AI video isn't switched on yet.</b> In the server's environment (Render → Environment), add a video maker's own API key (<code>VERTEX_API_KEY</code>, <code>OPENAI_API_KEY</code>, <code>KLING_API_KEY</code>, <code>MINIMAX_API_KEY</code>, <code>BYTEPLUS_ARK_API_KEY</code>, <code>LUMA_API_KEY</code>) or <code>FAL_KEY</code> to reach every model at once, then reload.
            </p>
          )}
          {error && <p className="vs-error" role="alert">{error}</p>}
          <button className="btn primary vs-generate" disabled={!canGo} onClick={() => void go()} title={why ?? "Generate (⌘↵)"}>
            <Icon name="sparkle" /> {sending ? "Sending…" : models.length > 1 ? `Generate on ${models.length} models` : "Generate"}
          </button>
          <small className="vs-usage">{why ?? (usage?.configured ? `${usage.used} of ${usage.limit} made today${usage.storage ? " · clips are kept" : ""} · each clip is billed by the model's maker${models.length === 1 && usage.routes?.[models[0].id] ? ` (${usage.routes[models[0].id]!.via})` : ""}` : "")}</small>
        </div>
      </aside>

      <main className="vs-gallery" aria-label="Your videos">
        <div className="home-head">
          <h2>
            Your videos <span className="count">{list.length ? `${finished} made${active ? ` · ${active} rendering` : ""}` : ""}</span>
          </h2>
          <span className="row" style={{ flex: "none", gap: 6 }}>
            {finished > 0 && (
              <button className="btn ghost" onClick={clearFinished}>
                Clear finished
              </button>
            )}
            {admin && (
              <button className="btn" onClick={() => setConn(true)} title="Switch video makers on or off for everyone">
                <Icon name="link" /> Connections
              </button>
            )}
          </span>
        </div>
        {list.length === 0 ? (
          <div className="vs-empty">
            <Icon name="sparkle" />
            <h3>One prompt, every video model</h3>
            <p>Seedance (up to 2.5), Kling, MiniMax Hailuo, Veo, Sora, Wan, Luma, PixVerse, Vidu, LTX and Grok. Write a prompt, pick a model (or three, to compare), and the clips land here. Then caption them, upscale them, or drop them into a project.</p>
          </div>
        ) : (
          <div className="vs-grid">
            {list.map((g) => (
              <Card key={g.id} g={g} onReuse={reuse} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
