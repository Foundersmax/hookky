import { useEffect, useRef } from "react";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: "Playback", keys: [["Space", "Play / pause"], ["Home", "Back to the start"], ["← / →", "Previous / next scene"], ["Esc", "Leave fullscreen"]] },
  {
    title: "Timeline",
    keys: [["Drag a scene", "Reorder"], ["Alt + ← / →", "Move the selected scene"], ["Drag a scene's edge", "Resize (snaps to pauses)"], ["Alt while resizing", "Resize without snapping"], ["= / -", "Zoom in / out"], ["0", "Fit the whole timeline"], ["⌘/Ctrl + scroll", "Zoom around the cursor"], ["Double-click a scene", "Zoom to it"]],
  },
  { title: "Studio", keys: [["⌘/Ctrl + K", "Command bar: search, run, or ask the agent"], ["F", "Focus on the canvas"], ["⌘/Ctrl + Z", "Undo"], ["⇧ + ⌘/Ctrl + Z", "Redo"], ["?", "Show this sheet"]] },
  { title: "Canvas", keys: [["Click text (paused)", "Edit it in place"], ["Enter / Esc", "Save / cancel the edit"], ["Drop an image", "Use it in the scene on screen"], ["Drop on a timeline scene", "Use it in that scene"]] },
  { title: "Chat", keys: [["Enter", "Send"], ["Shift + Enter", "New line"]] },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="keys-title">
        <div className="sheet-head">
          <h3 id="keys-title">Keyboard shortcuts</h3>
          <button ref={closeRef} className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="sheet-grid">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h4 className="label">{g.title}</h4>
              <dl>
                {g.keys.map(([k, v]) => (
                  <div key={k} className="sheet-row">
                    <dt>
                      <kbd>{k}</kbd>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
