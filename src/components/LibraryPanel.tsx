import { useRef, useState } from "react";
import { useStudio, addAssets, updateProject, setBrand, setState, getState } from "../store";
import type { Asset } from "../types";
import { Icon } from "./Icon";
import { fileToUploadAsset } from "./ChatPanel";
import { extractPalette } from "../engine/images";
import { luminance } from "../engine/util";

const SEARCH_IDS = ["pinterest", "freepik", "envato", "unsplash", "pexels", "openverse"];

export function LibraryPanel({ toast }: { toast: (s: string) => void }) {
  const assets = useStudio((s) => s.assets);
  const health = useStudio((s) => s.health);
  const sel = useStudio((s) => s.selected);
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const connectors = health?.connectors ?? [];
  const configured = (id: string) => connectors.find((c) => c.id === id)?.configured;

  async function search() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&count=18${sources.length ? `&sources=${sources.join(",")}` : ""}`).then((r) => r.json());
      addAssets((r.assets ?? []).map((a: Asset) => ({ ...a, id: `asset:${a.id}` })));
      toast(`${r.assets?.length ?? 0} results${r.notes?.length ? ` · ${r.notes.join(" · ")}` : ""}`);
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
    const pal = a.palette?.length ? a.palette : await extractPalette(a.src);
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
        <label>Search visual sources</label>
        <div className="row" style={{ gap: 6 }}>
          <input type="text" placeholder="e.g. matte black earbuds, studio light" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
          <button className="btn icon primary" onClick={search} disabled={busy} style={{ flex: "none" }}>
            <Icon name="search" />
          </button>
        </div>
        <div className="sources">
          {SEARCH_IDS.map((id) => {
            const c = connectors.find((x) => x.id === id);
            const on = sources.includes(id);
            return (
              <button
                key={id}
                className={`src-chip ${on ? "on" : ""} ${c?.configured ? "ok" : "off"}`}
                title={c?.note}
                onClick={() => setSources((s) => (on ? s.filter((x) => x !== id) : [...s, id]))}
              >
                <span className="dot" />
                {c?.label.split(" ")[0] ?? id}
              </button>
            );
          })}
        </div>
        <span className="tiny">Green = connected. Unselected = search all connected sources. Keys go in <code>.env</code>.</span>
      </div>
      <div className="field">
        <label>Import from any link</label>
        <div className="row" style={{ gap: 6 }}>
          <input type="url" placeholder="Pinterest pin, Behance, Dribbble, product page…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && importUrl()} />
          <button className="btn icon" onClick={importUrl} disabled={busy} style={{ flex: "none" }}>
            <Icon name="link" />
          </button>
        </div>
      </div>
      </>)}
      <div className="drop" onClick={() => fileRef.current?.click()}>
        <Icon name="image" /> Upload product shots, logos, references
        <input ref={fileRef} type="file" hidden multiple accept="image/*" onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          addAssets(await Promise.all(files.map(fileToUploadAsset)));
        }} />
      </div>
      <div className="row">
        <span className="label">{assets.length} assets</span>
        {!!assets.length && <button className="btn ghost" style={{ flex: "none" }} onClick={() => setState({ assets: [] })}>Clear</button>}
      </div>
      <div className="lib-grid">
        {[...assets].reverse().map((a) => (
          <div
            className="lib-item"
            key={a.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-hookky-asset", a.id);
              e.dataTransfer.effectAllowed = "copy";
            }}
            title={`${a.title}${a.author ? ` — ${a.author}` : ""}${a.license ? ` (${a.license})` : ""}`}>
            <img src={a.thumb ?? a.src} alt={a.title} loading="lazy" referrerPolicy="no-referrer" />
            <span className="src">{a.source}</span>
            <div className="acts">
              <button onClick={() => useInScene(a)}>Use in scene {sel + 1}</button>
              <button onClick={() => (setBrand({ logo: a.id }), toast("Logo set"))}>Set as logo</button>
              <button onClick={() => brandFrom(a)}>Brand colours from this</button>
              {configured("magnific") && <button onClick={() => enhance(a)}>Enhance (Magnific)</button>}
              {a.link && <button onClick={() => window.open(a.link, "_blank", "noopener")}>Open source ↗</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
