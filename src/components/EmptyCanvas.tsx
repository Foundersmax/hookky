import { useRef, useState } from "react";
import { addScene, addBackdrop, addAssets, setState, useStudio } from "../store";
import { fileToUploadAsset, fileToVideoAsset, isVideoFile } from "./ChatPanel";
import { Icon } from "./Icon";

/** Turn picked files into library assets; images and clips both work as banners. */
export async function uploadBanners(files: File[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    try {
      if (isVideoFile(f)) {
        const a = await fileToVideoAsset(f);
        addAssets([a]);
        ids.push(a.id);
      } else if (f.type.startsWith("image/")) {
        const a = await fileToUploadAsset(f);
        addAssets([a]);
        ids.push(a.id);
      } else setState({ notice: `${f.name} isn't an image or a video clip.` });
    } catch (e: any) {
      setState({ notice: e.message });
    }
  }
  return ids;
}

/** What an empty project shows on the stage: the two quickest ways to a first scene. */
export function EmptyCanvas() {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const fg = useStudio((s) => s.project.brand.fg);
  return (
    <div className="empty-canvas" style={{ color: fg }}>
      <p className="empty-title">An empty canvas</p>
      <p className="empty-sub">Describe your ad to the creative agent, or start here.</p>
      <div className="empty-actions">
        <button className="btn primary" onClick={() => addScene()}>
          <Icon name="plus" /> Add a title scene
        </button>
        <button className="btn" disabled={busy} onClick={() => file.current?.click()}>
          <Icon name="image" /> {busy ? "Adding…" : "Upload banners"}
        </button>
      </div>
      <p className="empty-hint">Banners crossfade behind your animated text. Pick several at once.</p>
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
          if (!ids.length) return;
          const i = addScene({ template: "kinetic-words", headline: "Your *message* here", transition: "cut" });
          addBackdrop(i, ids);
          setState({ notice: `${ids.length} banner${ids.length > 1 ? "s" : ""} behind your first scene. Click the text to change it.` });
        }}
      />
    </div>
  );
}
