import { useEffect, useRef, useState } from "react";
import { listVersions, saveVersion, restoreVersion, deleteVersion, useStudio } from "../store";
import type { Version } from "../persist";
import { Icon } from "./Icon";

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Named snapshots of the open project: save, restore (undoable), delete. */
export function Versions({ toast }: { toast: (s: string) => void }) {
  const projectId = useStudio((s) => s.project.id);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Version[]>([]);
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);

  const refresh = () => listVersions().then(setList).catch(() => setList([]));
  useEffect(() => {
    if (open) refresh();
  }, [open, projectId]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const save = async () => {
    const v = await saveVersion(name);
    setName("");
    toast(`Saved version “${v.name}”`);
    refresh();
  };

  return (
    <div className="pop-anchor" ref={box}>
      <button className="btn icon ghost" title="Versions" aria-label="Versions" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="history" />
      </button>
      {open && (
        <div className="pop versions" role="dialog" aria-label="Versions">
          <div className="pop-head">
            <b>Versions</b>
            <span className="tiny">Snapshots of this project</span>
          </div>
          <form
            className="versions-save"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input placeholder="Name this version (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Version name" />
            <button className="btn primary" type="submit">Save</button>
          </form>
          {list.length ? (
            <ul className="versions-list">
              {list.map((v) => (
                <li key={v.id}>
                  <div>
                    <b>{v.name}</b>
                    <span className="tiny">{when(v.createdAt)}</span>
                  </div>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      restoreVersion(v);
                      toast(`Restored “${v.name}” (⌘Z to undo)`);
                      setOpen(false);
                    }}
                  >
                    Restore
                  </button>
                  <button className="btn icon ghost" aria-label={`Delete ${v.name}`} onClick={() => deleteVersion(v.id).then(refresh)}>
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="tiny versions-empty">No versions yet. Save one before big changes so you can come back to it.</p>
          )}
        </div>
      )}
    </div>
  );
}
