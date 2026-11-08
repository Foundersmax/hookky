import { useMemo, useState } from "react";
import { useStudio, setState } from "../store";
import { lintStoryboard, type Note } from "../agent/lint";
import { sendToAgent } from "../agent/client";
import { timeline } from "../engine/render";
import { clock } from "../clock";

/** Director's notes for the current project, recomputed when scenes, brand, assets or voice-over change. */
export function useNotes(): Note[] {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  return useMemo(() => {
    const audio = project.audio && { duration: project.audio.duration, pauses: project.audio.pauses, hasWords: !!project.audio.words?.length };
    return lintStoryboard({ scenes: project.scenes, brand: project.brand, assetIds: new Set(assets.map((a) => a.id)), audio });
  }, [project.scenes, project.brand, project.audio, assets]);
}

export function DirectorNotes() {
  const notes = useNotes();
  const busy = useStudio((s) => s.busy);
  const scenes = useStudio((s) => s.project.scenes);
  const [open, setOpen] = useState(true);
  const warns = notes.filter((n) => n.level === "warn");
  const tips = notes.length - warns.length;

  const jump = (i: number | null) => {
    if (i === null) return;
    setState({ selected: i });
    const e = timeline(scenes)[i];
    if (e) clock.seek(e.start + Math.min(1, e.scene.duration / 2));
  };
  const fix = () =>
    sendToAgent(
      `Please fix these director's notes, keeping the idea and the voice-over timing:\n${warns
        .slice(0, 10)
        .map((n) => `- ${n.message}`)
        .join("\n")}`,
    );

  if (!scenes.length) return null;
  if (!notes.length)
    return (
      <div className="notes-clear" title="Director's notes: copy, pacing, contrast and voice-over sync all check out">
        <span className="notes-dot ok" aria-hidden /> Passes review
      </div>
    );

  return (
    <section className="notes" aria-label="Director's notes">
      <button className="notes-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="label">Director's notes</span>
        {!!warns.length && <span className="notes-count warn">{warns.length} to fix</span>}
        {!!tips && <span className="notes-count tip">{tips} tip{tips === 1 ? "" : "s"}</span>}
        <span className="notes-caret" aria-hidden>{open ? "–" : "+"}</span>
      </button>
      {open && (
        <>
          <ul className="notes-list">
            {notes.slice(0, 12).map((n, k) => (
              <li key={k}>
                <button className={`note ${n.level}`} onClick={() => jump(n.scene)} disabled={n.scene === null} title={n.scene === null ? undefined : "Show this scene"}>
                  <span className={`notes-dot ${n.level}`} aria-hidden />
                  <span>{n.message}</span>
                </button>
              </li>
            ))}
          </ul>
          {notes.length > 12 && <span className="tiny">+{notes.length - 12} more</span>}
          {!!warns.length && (
            <button className="btn" disabled={busy} onClick={fix}>
              Fix {warns.length === 1 ? "it" : `all ${warns.length}`} with the agent
            </button>
          )}
        </>
      )}
    </section>
  );
}
