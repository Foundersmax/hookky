import { useState } from "react";
import { useStudio, setState } from "../store";
import { licenseClips, watermarkedInUse } from "../footage/license";
import { Icon } from "./Icon";

/** Shown while the cut uses watermarked Freepik previews: one click licenses the real files. */
export function LicenseCard({ compact }: { compact?: boolean }) {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const todo = watermarkedInUse(project, assets);
  if (!todo.length && !error) return null;

  async function go() {
    setError(null);
    try {
      const r = await licenseClips(setBusy);
      const msg = `${r.licensed} clip${r.licensed === 1 ? "" : "s"} licensed${r.today !== undefined ? ` (${r.today} Freepik download${r.today === 1 ? "" : "s"} today)` : ""}.`;
      if (r.failed.length) setError(`${msg} Not licensed: ${r.failed.slice(0, 3).join("; ")}`);
      setState({ notice: r.failed.length ? `${msg} ${r.failed.length} couldn't be licensed.` : `${msg} The watermark is gone.` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={`license-card ${compact ? "compact" : ""}`} role="status">
      <div className="license-text">
        <b>{todo.length ? `${todo.length} Freepik clip${todo.length === 1 ? " is a" : "s are"} watermarked preview${todo.length === 1 ? "" : "s"}` : "Licensing"}</b>
        <small>{todo.length ? `License them for a clean export. Each uses one of your 100 daily Freepik downloads and is kept in this browser.` : ""}</small>
        {error && <small className="sound-error">{error}</small>}
      </div>
      {todo.length > 0 && (
        <button className="btn primary" disabled={!!busy} onClick={go}>
          {busy ? busy : <><Icon name="download" size={13} /> License {todo.length} clip{todo.length === 1 ? "" : "s"}</>}
        </button>
      )}
    </div>
  );
}
