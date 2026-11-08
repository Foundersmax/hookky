import { useEffect, useRef, useState } from "react";
import { useStudio, setState } from "../store";
import { checkSession, signOut } from "../auth";

/** Signed-in person: name, today's agent use, admin and sign out. */
export function UserMenu() {
  const auth = useStudio((s) => s.auth);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    checkSession(); // fresh usage numbers
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (auth.status !== "signed_in" || !auth.user) return null;
  const u = auth.user;
  const usage = auth.usage;
  return (
    <div className="pop-anchor user-menu" ref={ref}>
      <button className="avatar-btn" aria-label={`Account: ${u.email}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {(u.name || u.email)[0].toUpperCase()}
      </button>
      {open && (
        <div className="pop user-pop" role="menu">
          <div className="user-head">
            <strong>{u.name || u.email.split("@")[0]}</strong>
            <span className="tiny">{u.email}</span>
          </div>
          {usage && (
            <div className="user-usage tiny">
              Agent today: {usage.today}
              {usage.limit === null ? "" : ` of ${usage.limit}`}
              {usage.limit !== null && (
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, (usage.today / Math.max(1, usage.limit)) * 100)}%` }} />
                </span>
              )}
            </div>
          )}
          {u.role === "admin" && (
            <button role="menuitem" className="pop-item" onClick={() => (setOpen(false), setState({ view: "admin" }))}>
              People and approvals
            </button>
          )}
          <button role="menuitem" className="pop-item" onClick={() => (setOpen(false), signOut())}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
