// Accounts on the client: the session check, sign-in calls, and noticing when a session ends.
import { getState, setState, type AuthUser } from "./store";

export interface AuthResult {
  ok: boolean;
  error?: string;
  code?: string;
  message?: string;
  user?: AuthUser;
  signedIn?: boolean;
}

/** POST to an auth endpoint; network failures come back as a readable error, never a throw. */
export async function authCall(path: string, body: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(`/api/auth/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error || `Something went wrong (${res.status}). Try again.`, code: json.code };
    return { ok: true, ...json };
  } catch {
    return { ok: false, error: "Can't reach Hookky. Check your connection and try again." };
  }
}

/** Ask the server who's signed in (and today's usage). */
export async function checkSession() {
  try {
    const res = await fetch("/api/auth/me");
    if (res.status === 401) return setState({ auth: { status: "signed_out" } });
    if (!res.ok) throw new Error(String(res.status));
    const { user, usage } = await res.json();
    setState({ auth: { status: "signed_in", user, usage } });
  } catch {
    // Server hiccup: keep whoever was signed in rather than throwing them out.
    if (getState().auth.status === "checking") setState({ auth: { status: "signed_out" } });
  }
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  setState({ auth: { status: "signed_out" }, view: "home" });
}

let watching = false;
/** Any API call that finds the session gone (expired, signed out elsewhere, disabled) shows sign-in again. */
export function watchSession() {
  if (watching) return;
  watching = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await original(input, init);
    if (res.status === 401) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const path = url.startsWith("http") ? new URL(url).pathname : url;
      if (path.startsWith("/api/") && !path.startsWith("/api/auth/") && getState().auth.status === "signed_in") setState({ auth: { status: "signed_out" }, notice: "Your session ended. Sign in again." });
    }
    return res;
  };
}
