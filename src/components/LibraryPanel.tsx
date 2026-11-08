import { useRef, useState } from "react";
import { useStudio, addAssets, updateProject, setBrand, setState, getState } from "../store";
import type { Asset } from "../types";
import { Icon } from "./Icon";
import { fileToUploadAsset, fileToVideoAsset, isVideoFile } from "./ChatPanel";
import { images } from "../runtime";
import { extractPalette } from "../engine/images";
import { luminance } from "../engine/util";

const SEARCH_IDS = ["pinterest", "freepik", "envato", "unsplash", "pexels", "pixabay", "openverse"];
const VIDEO_IDS = ["pixabay", "coverr", "pexels"];

const clock = (s?: number) => (s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);

/** Library card media: the poster, and for clips a muted preview that plays on hover. */
function Thumb({ a, hover }: { a: Asset; hover: boolean }) {
  const src = a.kind === "video" ? images.videoSrc(a) : undefined;
  return (
    <div className="lib-media">
      {a.kind === "video" && !a.thumb ? (
        src && <video src={`${src}#t=0.5`} muted playsInline preload="metadata" crossOrigin="anonymous" aria-hidden="true" />
      ) : (
        <img src={a.thumb ?? a.src} alt={a.title} loading="lazy" referrerPolicy="no-referrer" />
      )}
      {src && hover && <video src={src} muted autoPlay loop playsInline crossOrigin="anonymous" aria-hidden="true" />}
      {a.kind === "video" && <span className="dur"><Icon name="play" size={9} /> {clock(a.duration)}</span>}
    </div>
  );
}

export function LibraryPanel({ toast }: { toast: (s: string) => void }) {
  const assets = useStudio((s) => s.assets);
  const health = useStudio((s) => s.health);
  const sel = useStudio((s) => s.selected);
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const [media, setMedia] = useState<"photo" | "video">("photo");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const aspect = useStudio((s) => s.project.aspect);
  const fileRef = useRef<HTMLInputElement>(null);
  const connectors = health?.connectors ?? [];
  const configured = (id: string) => connectors.find((c) => c.id === id)?.configured;

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const ids = media === "video" ? sources.filter((s) => VIDEO_IDS.includes(s)) : sources;
      const orientation = aspect === "9:16" || aspect === "4:5" ? "portrait" : aspect === "1:1" ? "square" : "landscape";
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&count=18${ids.length ? `&sources=${ids.join(",")}` : ""}${media === "video" ? `&type=video&orientation=${orientation}` : ""}`).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      addAssets((r.assets ?? []).map((a: Asset) => ({ ...a, id: `asset:${a.id}` })));
      toast(`${r.assets?.length ?? 0} ${media === "video" ? "clips" : "results"}${r.notes?.length ? ` · ${r.notes.join(" · ")}` : ""}`);
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function importUrl() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const r = await fetch("/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      addAssets(r.assets.map((a: Asset) => ({ ...a, id: `asset:${a.id}` })));
      toast(`Imported ${r.assets.length} image(s)`);
      setUrl("");
    } catch (e: any) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }

  const useInScene = (a: Asset) =>
    updateProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) => {
        if (i !== sel) return s;
        if (s.template === "image-mosaic") return { ...s, images: [...(s.images ?? []), a.id].slice(-6) };
        return { ...s, image: a.id };
      }),
    }));

  async function brandFrom(a: Asset) {
    const pal = a.palette?.length ? a.palette : await extractPalette(a.kind === "video" ? a.thumb ?? "" : a.src);
    if (pal.length < 2) return;
    const byLum = [...pal].sort((x, y) => luminance(x) - luminance(y));
    const dark = byLum[0], light = byLum[byLum.length - 1];
    const sat = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    const accent = [...pal].sort((x, y) => sat(y) - sat(x))[0];
    const darkMode = getState().project.brand.bg && luminance(getState().project.brand.bg) < 0.2;
    setBrand(darkMode ? { bg: dark, fg: light, accent } : { bg: light, fg: dark, accent });
    toast("Brand colours pulled from reference");
  }

  async function enhance(a: Asset) {
    toast("Upscaling with Magnific…");
    try {
      const img = a.src.startsWith("data:") ? a.src.split(",")[1] : a.src;
      const r = await fetch("/api/enhance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: img }) }).then((r) => r.json());
      if (r.error) throw new Error(r.error);
      addAssets([{ ...a, id: `${a.id}_hd`, src: r.url, thumb: r.url, title: `${a.title} (Magnific 2×)`, source: "magnific" }]);
      toast("Enhanced copy added");
    } catch (e: any) {
      toast(e.message);
    }
  }

  const hasServer = connectors.length > 0;
  return (
    <>
      {!hasServer && (
        <div className="card">
          <h4>Upload your visuals</h4>
          <span className="muted">Searching Pinterest, Freepik, Envato and other sources, and importing from links, need the self-hosted Hookky server. Here, upload product shots, logos and references.</span>
        </div>
      )}
      {hasServer && (<>
      <div className="field">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <label>Search</label>
          <div className="seg opt-seg" role="radiogroup" aria-label="Media type">
            {(["photo", "video"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={media === m} className={media === m ? "on" : ""} onClick={() => setMedia(m)}>
                {m === "photo" ? "Photos" : "Videos"}
              </button>
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <input type="text" placeholder={media === "video" ? "Clips, e.g. slow coffee pour" : "Photos, e.g. matte black earbuds"} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className="btn icon primary" onClick={search} disabled={busy} style={{ flex: "none" }}>
            <Icon name="search" />
          </button>
        </div>
        <div className="sources">
          {(media === "video" ? VIDEO_IDS : SEARCH_IDS).filter((id) => configured(id)).map((id) => {
            const c = connectors.find((x) => x.id === id);
            const on = sources.includes(id);
            return (
              <button
                key={id}
                className={`src-chip filter ${on ? "on" : ""}`}
                aria-pressed={on}
                title={on ? `Searching only the selected sources` : `Search only ${c?.label.split(" ")[0] ?? id} (none selected = all)`}
                onClick={() => setSources((s) => (on ? s.filter((x) => x !== id) : [...s, id]))}
              >
                {c?.label.split(" ")[0] ?? id}
              </button>
            );
          })}
        </div>
        {media === "video" && !VIDEO_IDS.some((id) => configured(id)) && <span className="tiny">No stock video source is connected yet.</span>}
      </div>
      <div className="field">
        <label>Import from a link</label>
        <div className="row" style={{ gap: 6 }}>
          <input type="url" placeholder="Pinterest, Behance, any page…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && importUrl()} />
          <button className="btn icon" onClick={importUrl} disabled={busy} style={{ flex: "none" }}>
            <Icon name="link" />
          </button>
        </div>
      </div>
      </>)}
      <div className="drop" onClick={() => fileRef.current?.click()}>
        <Icon name="image" /> Upload images or clips
        <input ref={fileRef} type="file" hidden multiple accept="image/*,video/*" onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          for (const f of files) {
            try {
              addAssets([isVideoFile(f) ? await fileToVideoAsset(f) : await fileToUploadAsset(f)]);
            } catch (err: any) {
              toast(err.message);
            }
          }
        }} />
      </div>
      <div className="row">
        <span className="label">
          {assets.filter((a) => a.kind !== "font").length} assets
          {assets.some((a) => a.kind === "video") && ` · ${assets.filter((a) => a.kind === "video").length} videos`}
        </span>
        {!!assets.length && <button className="btn ghost" style={{ flex: "none" }} onClick={() => setState({ assets: [] })}>Clear</button>}
      </div>
      <div className="lib-grid">
        {[...assets].reverse().filter((a) => a.kind !== "font").map((a) => (
          <div
            className="lib-item"
            key={a.id}
            draggable
            onPointerEnter={() => setHoverId(a.id)}
            onPointerLeave={() => setHoverId((h) => (h === a.id ? null : h))}
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-hookky-asset", a.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={`${a.title}${a.author ? ` — ${a.author}` : ""}${a.license ? ` (${a.license})` : ""}`}>
            <Thumb a={a} hover={hoverId === a.id} />
            <span className="src">{a.source}</span>
            <div className="acts">
              <button onClick={() => useInScene(a)}>Use in scene {sel + 1}</button>
              {a.kind !== "video" && <button onClick={() => (setBrand({ logo: a.id }), toast("Logo set"))}>Set as logo</button>}
              <button onClick={() => brandFrom(a)}>Brand colours from this</button>
              {configured("magnific") && a.kind !== "video" && <button onClick={() => enhance(a)}>Enhance (Magnific)</button>}
              {a.link && <button onClick={() => window.open(a.link, "_blank", "noopener")}>Open source ↗</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
