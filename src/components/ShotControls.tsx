import { useRef, useState } from "react";
import type { Asset, Scene } from "../types";
import { useStudio, libraryId, setState } from "../store";
import { castOne, timingFor } from "../footage/cast";
import { LOOKS_PROD, type ProdLook } from "../footage/plan";
import { fileToVideoAsset, fileToUploadAsset, isVideoFile } from "./ChatPanel";
import { Icon } from "./Icon";

/** Which production look a scene was cut with (from its grade), for timing a new take the same way. */
const lookOf = (s: Scene): ProdLook => ((Object.keys(LOOKS_PROD) as ProdLook[]).find((k) => LOOKS_PROD[k].grade === s.grade) ?? "commercial");

/** A footage shot: search again, pick another take, or use your own clip. */
export function ShotControls({ scene, onChange }: { scene: Scene; onChange: (patch: Partial<Scene>) => void }) {
  const aspect = useStudio((s) => s.project.aspect);
  const assets = useStudio((s) => s.assets);
  const [q, setQ] = useState(scene.shot?.query ?? "");
  const [takes, setTakes] = useState<Asset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const isEnd = scene.template === "cta-end";
  const current = isEnd ? scene.backdrop?.[0] : scene.image;

  const use = (a: Asset) => {
    const id = libraryId(a);
    const len = scene.duration;
    const timing = timingFor(a, { s: 0, e: len, line: "", type: "medium", queries: [], overlay: "" }, lookOf(scene));
    const base = { clipStart: timing.clipStart, clipSpeed: timing.clipSpeed, shot: { type: scene.shot?.type ?? "medium", query: q || scene.shot?.query || "" } };
    onChange(isEnd ? { ...base, backdrop: [id] } : { ...base, image: id, ...(scene.template !== "fullbleed" && { template: "fullbleed" }) });
  };

  async function find() {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const used = new Set(assets.filter((a) => a.id === current).map((a) => a.src));
      const c = await castOne({ s: 0, e: scene.duration, line: "", type: "medium", queries: [q.trim()], overlay: "" }, aspect, lookOf(scene), used);
      const list = [c.pick, ...c.alts].filter(Boolean) as Asset[];
      setTakes(list);
      if (!list.length) setState({ notice: `No footage found for “${q}”. Try simpler words: a subject and an action.` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field shot-controls">
      <span className="label">Footage{scene.shot ? ` · ${scene.shot.type} shot` : ""}</span>
      <form className="row" onSubmit={(e) => (e.preventDefault(), find())}>
        <input type="text" value={q} placeholder="coffee pouring slow motion" aria-label="Search footage for this shot" onChange={(e) => setQ(e.target.value)} />
        <button className="btn" style={{ flex: "none" }} disabled={busy || !q.trim()}>{busy ? "…" : "Find takes"}</button>
      </form>
      {takes && takes.length > 0 && (
        <div className="take-grid">
          {takes.map((a) => (
            <button key={a.src} type="button" className={`take ${assets.find((x) => x.id === current)?.src === a.src ? "on" : ""}`} title={`${a.source} · ${a.title}`} onClick={() => use(a)}>
              {a.thumb ? <img src={a.thumb} alt="" /> : <Icon name="image" />}
              {a.kind === "video" && a.duration ? <em>{a.duration.toFixed(0)}s</em> : null}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="btn ghost" onClick={() => file.current?.click()}>
        <Icon name="plus" /> Use my own clip
      </button>
      <input
        ref={file}
        type="file"
        hidden
        accept="video/*,image/*"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            use(isVideoFile(f) ? await fileToVideoAsset(f) : await fileToUploadAsset(f));
          } catch (err: any) {
            setState({ notice: err.message });
          }
        }}
      />
    </div>
  );
}
