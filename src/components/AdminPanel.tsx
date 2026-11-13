import { useEffect, useMemo, useState } from "react";
import { useStudio, setState } from "../store";

interface Row {
  id: number;
  email: string;
  name: string;
  role: "user" | "admin";
  status: "unverified" | "pending" | "active" | "disabled";
  daily_limit: number | null;
  limit: number | null;
  video_daily_credits: number | null;
  video_limit: number | null;
  video_today: number;
  today: number;
  last30: number;
  created_at: string;
  last_login_at: string | null;
}

const FILTERS = [
  { id: "pending", label: "Waiting" },
  { id: "active", label: "Active" },
  { id: "unverified", label: "Unconfirmed" },
  { id: "disabled", label: "Disabled" },
  { id: "", label: "All" },
] as const;

const STATUS_LABEL: Record<Row["status"], string> = { pending: "Waiting for approval", active: "Active", unverified: "Email not confirmed", disabled: "Disabled" };

function ago(iso: string | null) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Everyone with an account: approve sign-ups, switch accounts off, set roles and daily agent limits. */
export function AdminPanel() {
  const me = useStudio((s) => s.auth.user);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [defaultLimit, setDefaultLimit] = useState(100);
  const [defaultVideo, setDefaultVideo] = useState<number | null>(300);
  const [filter, setFilter] = useState<string>(() => (new URL(location.href).searchParams.get("admin") === "pending" ? "pending" : ""));
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Couldn't load users (${res.status})`);
      const j = await res.json();
      setRows(j.users);
      setDefaultLimit(j.defaultLimit);
      setDefaultVideo(j.defaultVideoLimit ?? null);
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function act(u: Row, action: string, extra: Record<string, unknown> = {}, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setState({ notice: j.error || "That didn't work." });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { "": rows?.length ?? 0 };
    for (const r of rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);
  const shown = (rows ?? []).filter((r) => (!filter || r.status === filter) && (!q.trim() || `${r.email} ${r.name}`.toLowerCase().includes(q.trim().toLowerCase())));

  return (
    <main className="admin">
      <div className="admin-wrap">
        <header className="admin-head">
          <h2>People</h2>
          <input type="search" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        </header>
        <nav className="admin-filters" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button key={f.id} className={`src-chip filter ${filter === f.id ? "on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
              {!!counts[f.id] && <span className="count">{counts[f.id]}</span>}
            </button>
          ))}
        </nav>
        {error && <div className="auth-note warn">{error}</div>}
        {!rows && !error && <p className="muted">Loading…</p>}
        {rows && !shown.length && <p className="muted">{filter === "pending" ? "Nobody is waiting for approval." : "No one matches."}</p>}
        <ul className="admin-list">
          {shown.map((u) => {
            const self = u.id === me?.id;
            const busy = busyId === u.id;
            return (
              <li key={u.id} className={`person ${u.status}`}>
                <div className="person-main">
                  <span className="avatar" aria-hidden="true">{(u.name || u.email)[0].toUpperCase()}</span>
                  <span className="person-id">
                    <span className="person-name">
                      {u.name || u.email.split("@")[0]}
                      {u.role === "admin" && <span className="badge">Admin</span>}
                      {self && <span className="badge quiet">You</span>}
                    </span>
                    <span className="tiny">{u.email}</span>
                  </span>
                  <span className={`status-pill ${u.status}`}>{STATUS_LABEL[u.status]}</span>
                </div>
                <div className="person-meta tiny">
                  <span>Joined {ago(u.created_at)}</span>
                  <span>Last sign-in {ago(u.last_login_at)}</span>
                  <span>
                    Agent today {u.today}
                    {u.limit === null ? " (no limit)" : ` / ${u.limit}`} · 30 days {u.last30}
                  </span>
                  <span>
                    Video credits today {u.video_today ?? 0}
                    {u.video_limit === null || u.video_limit === undefined ? " (no limit)" : ` / ${u.video_limit}`}
                  </span>
                </div>
                <div className="person-actions">
                  {u.status === "pending" && <button className="btn primary" disabled={busy} onClick={() => act(u, "approve")}>Approve</button>}
                  {u.status === "unverified" && (
                    <>
                      <button className="btn" disabled={busy} onClick={() => act(u, "resend_verify")}>Resend confirmation</button>
                      <button className="btn ghost" disabled={busy} onClick={() => act(u, "approve", {}, `Approve ${u.email} without email confirmation?`)}>Approve anyway</button>
                    </>
                  )}
                  {u.status === "disabled" && <button className="btn" disabled={busy} onClick={() => act(u, "enable")}>Turn back on</button>}
                  {u.status === "active" && !self && <button className="btn ghost" disabled={busy} onClick={() => act(u, "disable", {}, `Disable ${u.email}? They're signed out at once.`)}>Disable</button>}
                  {u.role === "user" && u.status === "active" && <button className="btn ghost" disabled={busy} onClick={() => act(u, "make_admin", {}, `Make ${u.email} an admin? Admins can manage everyone.`)}>Make admin</button>}
                  {u.role === "admin" && !self && <button className="btn ghost" disabled={busy} onClick={() => act(u, "remove_admin")}>Remove admin</button>}
                  {u.role === "user" && (
                    <label className="limit-field" title={`Empty uses the default (${defaultLimit} a day)`}>
                      Daily limit
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        placeholder={String(defaultLimit)}
                        defaultValue={u.daily_limit ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v === String(u.daily_limit ?? "")) return;
                          act(u, "set_limit", { limit: v === "" ? null : Number(v) });
                        }}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    </label>
                  )}
                  <label className="limit-field" title={u.role === "admin" ? "Admins have no daily video limit unless you set one here" : `Empty uses the default (${defaultVideo === null ? "no limit" : `${defaultVideo} credits a day`})`}>
                    Video credits/day
                    <input
                      type="number"
                      min={0}
                      max={1000000}
                      placeholder={u.role === "admin" ? "No limit" : defaultVideo === null ? "No limit" : String(defaultVideo)}
                      defaultValue={u.video_daily_credits ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v === String(u.video_daily_credits ?? "")) return;
                        act(u, "set_video_limit", { limit: v === "" ? null : Number(v) });
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  </label>
                  {!self && <button className="btn ghost danger" disabled={busy} onClick={() => act(u, "delete", {}, `Delete ${u.email}? This can't be undone.`)}>Delete</button>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
