import { useEffect, useState } from "react";
import { setState } from "../store";
import { authCall, checkSession } from "../auth";
import { Logo } from "./Logo";

type Mode = "signin" | "signup" | "forgot" | "reset";

const BANNERS: Record<string, { tone: "ok" | "warn"; text: string }> = {
  verified: { tone: "ok", text: "Email confirmed. An admin will approve your account, and you'll get an email when it's ready." },
  "verified-admin": { tone: "ok", text: "Email confirmed. You're an admin: sign in to get started." },
  "link-expired": { tone: "warn", text: "That link has expired or was already used. Sign in, or ask for a new one." },
};

/** Read and clear the one-off URL parameters that email links carry. */
function takeUrlParams() {
  const u = new URL(location.href);
  const reset = u.searchParams.get("reset");
  const auth = u.searchParams.get("auth");
  const admin = u.searchParams.get("admin");
  if (reset || auth) {
    u.searchParams.delete("reset");
    u.searchParams.delete("auth");
    history.replaceState(null, "", u.pathname + (u.search === "?" ? "" : u.search) + u.hash);
  }
  return { reset, auth, admin };
}

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [info, setInfo] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  useEffect(() => {
    const { reset, auth } = takeUrlParams();
    if (reset) {
      setResetToken(reset);
      setMode("reset");
    }
    if (auth && BANNERS[auth]) setInfo(BANNERS[auth]);
  }, []);

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setPassword("");
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "signin") {
        const r = await authCall("login", { email, password });
        if (!r.ok) return setError({ text: r.error!, code: r.code });
        await checkSession();
        setState({ notice: `Welcome back${r.user?.name ? `, ${r.user.name}` : ""}` });
      } else if (mode === "signup") {
        const r = await authCall("signup", { email, password, name });
        if (!r.ok) return setError({ text: r.error! });
        setInfo({ tone: "ok", text: r.message! });
        go("signin");
      } else if (mode === "forgot") {
        const r = await authCall("forgot", { email });
        if (!r.ok) return setError({ text: r.error! });
        setInfo({ tone: "ok", text: r.message! });
        go("signin");
      } else {
        const r = await authCall("reset", { token: resetToken, password });
        if (!r.ok) return setError({ text: r.error! });
        if (r.signedIn) {
          await checkSession();
          setState({ notice: "Password changed. You're signed in." });
        } else {
          setInfo({ tone: "ok", text: r.message || "Password saved. Sign in with it." });
          go("signin");
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    const r = await authCall("resend", { email });
    setBusy(false);
    setError(null);
    setInfo(r.ok ? { tone: "ok", text: "If that address is waiting for confirmation, a new link is on its way." } : { tone: "warn", text: r.error! });
  }

  const title = { signin: "Sign in", signup: "Create an account", forgot: "Reset your password", reset: "Choose a new password" }[mode];
  const cta = { signin: "Sign in", signup: "Create account", forgot: "Email me a link", reset: "Save password" }[mode];

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Logo height={24} />
        <h1>{title}</h1>
        {mode === "signup" && <p className="auth-sub">After you confirm your email, an admin approves your account.</p>}
        {mode === "forgot" && <p className="auth-sub">We'll email you a link to choose a new password.</p>}
        {info && <div className={`auth-note ${info.tone}`} role="status">{info.text}</div>}

        {mode === "signup" && (
          <label className="auth-field">
            <span>Name</span>
            <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
        )}
        {mode !== "reset" && (
          <label className="auth-field">
            <span>Email</span>
            <input type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {mode !== "forgot" && (
          <label className="auth-field">
            <span>{mode === "reset" ? "New password" : "Password"}</span>
            <input
              type="password"
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              minLength={mode === "signin" ? undefined : 10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus={mode === "reset"}
            />
            {mode !== "signin" && <small>At least 10 characters. A short phrase works well.</small>}
          </label>
        )}

        {error && (
          <div className="auth-note warn" role="alert">
            {error.text}
            {error.code === "unverified" && (
              <button type="button" className="link" onClick={resend} disabled={busy}>
                Send the link again
              </button>
            )}
          </div>
        )}

        <button className="btn primary auth-submit" type="submit" disabled={busy || (mode !== "reset" && !email.trim()) || (mode !== "forgot" && !password)}>
          {busy ? "One moment…" : cta}
        </button>

        <div className="auth-links">
          {mode === "signin" && (
            <>
              <button type="button" className="link" onClick={() => go("forgot")}>Forgot password?</button>
              <span>
                New here? <button type="button" className="link" onClick={() => go("signup")}>Create an account</button>
              </span>
            </>
          )}
          {mode !== "signin" && (
            <button type="button" className="link" onClick={() => go("signin")}>
              Back to sign in
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
