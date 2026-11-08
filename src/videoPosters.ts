// Stock clips that arrive without a poster image (some sources don't send one) get one made from
// the clip itself, once, so the Library, timeline thumbnails and Claude's contact sheets show it.
import type { Asset } from "./types";
import { VideoStore } from "./engine/videos";
import { images } from "./runtime";
import { setState } from "./store";

const tried = new Set<string>();

export function fillVideoPosters(assets: Asset[]) {
  for (const a of assets) {
    if (a.kind !== "video" || a.thumb || tried.has(a.id)) continue;
    tried.add(a.id);
    const src = images.videoSrc(a);
    if (!src) continue;
    VideoStore.probe(src)
      .then((m) =>
        setState((s) => ({
          assets: s.assets.map((x) => (x.id === a.id ? { ...x, thumb: m.poster, w: x.w ?? m.w, h: x.h ?? m.h, duration: x.duration ?? +m.duration.toFixed(2) } : x)),
        })),
      )
      .catch(() => {});
  }
}
