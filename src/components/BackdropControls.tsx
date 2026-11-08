import { useRef, useState } from "react";
import type { Asset, Scene } from "../types";
import { addBackdrop, spreadBackdrops, setState, useStudio } from "../store";
import { uploadBanners } from "./EmptyCanvas";
import { Icon } from "./Icon";

/** Banners behind a scene's text: add several at once, remove, or spread them one per scene. */
export function BackdropControls({ scene, index, onChange }: { scene: Scene; index: number; onChange: (patch: Partial<Scene>) => void }) {
  const assets = useStudio((s) => s.assets);
  const sceneCount = useStudio((s) => s.project.scenes.length);
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const list = scene.backdrop ?? [];
  const byId = (id: string) => assets.find((a) => a.id === id) as Asset | undefined;

  return (
    <div className="field backdrop">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">Background banners{list.length ? ` · ${list.length}` : ""}</span>
        {list.length > 1 && sceneCount > 1 && (
          <button
            type="button"
            className="link-btn"
            title="Put one banner behind each text scene, in order"
            onClick={() => {
              const n = spreadBackdrops(list);
              setState({ notice: `Spread across ${n} scene${n === 1 ? "" : "s"}` });
            }}
          >
            One per scene
          </button>
        )}
      </div>
      {!!list.length && (
        <div className="backdrop-strip">
          {list.map((id, i) => {
            const a = byId(id);
            return (
              <span className="backdrop-thumb" key={`${id}-${i}`} title={a?.title ?? "Missing from the library"}>
                {a ? <img src={a.thumb ?? a.src} alt="" /> : <span className="missing">?</span>}
                <span className="n">{i + 1}</span>
                <button type="button" aria-label={`Remove banner ${i + 1}`} onClick={() => onChange({ backdrop: list.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => file.current?.click()}>
          <Icon name="image" /> {busy ? "Adding…" : list.length ? "Add more" : "Add banners"}
        </button>
        {!!list.length && (
          <button type="button" className="btn ghost" onClick={() => onChange({ backdrop: undefined })}>
            Clear
          </button>
        )}
      </div>
      <span className="tiny">{list.length > 1 ? "They crossfade behind the text, each with a slow drift." : "Pick several images at once; they crossfade behind the text."}</span>
      <input
        ref={file}
        type="file"
        hidden
        multiple
        accept="image/*,video/*"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          const ids = await uploadBanners(files);
          setBusy(false);
          if (ids.length) addBackdrop(index, ids);
        }}
      />
    </div>
  );
}
