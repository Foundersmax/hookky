// Sign in and create accounts from the landing page. The API lives on the studio's origin
// (app.rookker.com); both share the site rookker.com, so the session cookie it sets is the one
// the studio reads, and a successful sign-in goes straight into the studio.
import { studioUrl } from "./studio";

type Mode = "signin" | "signup" | "forgot" | "reset";
const API = studioUrl();
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

const dlg = $<HTMLDialogElement>("#auth");
const form = $<HTMLFormElement>("form", dlg);
const input = (n: string) => $<HTMLInputElement>(`input[name="${n}"]`, form);
let mode: Mode = "signin";
let resetToken = "";
let accountsOff = false;

const COPY: Record<Mode, { title: string; sub: string; cta: string; pw: string }> = {
  signin: { title: "Welcome back", sub: "", cta: "Sign in", pw: "Password" },
  signup: { title: "Create your account", sub: "Confirm your email, then our team approves your account.", cta: "Create account", pw: "Password" },
  forgot: { title: "Reset your password", sub: "We'll email you a link to choose a new one.", cta: "Email me a link", pw: "Password" },
  reset: { title: "Choose a new password", sub: "", cta: "Save password", pw: "New password" },
};

function note(text: string, tone: "ok" | "warn" = "ok") {
  const n = $("[data-note]", dlg);
  n.textContent = text;
  n.className = `note${tone === "warn" ? " warn" : ""}`;
  n.hidden = !text;
}

function error(text: string, offerResend = false) {
  const e = $("[data-error]", dlg);
  e.hidden = !text;
  e.textContent = text;
  if (!offerResend) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "link";
  b.textContent = "Send the confirmation link again";
  b.onclick = async () => {
    const r = await call("resend", { email: input("email").value.trim() });
    error("");
    note(r.ok ? "If that address is waiting for confirmation, a new link is on its way." : r.error, r.ok ? "ok" : "warn");
  };
  e.append(b);
}

function setMode(m: Mode) {
  mode = m;
  const c = COPY[m];
  $("#auth-title").textContent = c.title;
  $("[data-sub]", dlg).textContent = c.sub;
  $("[data-submit]", dlg).textContent = c.cta;
  $("[data-pw-label]", dlg).textContent = c.pw;
  $("[data-tabs]", dlg).hidden = !(m === "signin" || m === "signup");
  for (const t of $$<HTMLButtonElement>("[data-tabs] [data-mode]", dlg)) t.setAttribute("aria-selected", String(t.dataset.mode === m));
  for (const el of $$<HTMLElement>("[data-only]", dlg)) el.hidden = !el.dataset.only!.split(" ").includes(m);
  const pw = input("password");
  pw.autocomplete = m === "signin" ? "current-password" : "new-password";
  pw.value = "";
  error("");
}

function open(m: Mode, banner?: { text: string; tone?: "ok" | "warn" }) {
  // Without accounts (or if the studio can't be reached) the buttons simply open the studio.
  if (accountsOff) return void (location.href = API);
  setMode(m);
  note(banner?.text ?? "", banner?.tone);
  if (!dlg.open) dlg.showModal();
  (m === "reset" ? input("password") : m === "signup" ? input("name") : input("email")).focus();
}

interface Reply {
  ok: boolean;
  error: string;
  code?: string;
  message?: string;
  signedIn?: boolean;
}

async function call(path: string, body: unknown): Promise<Reply> {
  try {
    const res = await fetch(`${API}/api/auth/${path}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    return { ...j, ok: res.ok, error: j.error || (res.ok ? "" : `Something went wrong (${res.status}). Try again.`) };
  } catch {
    return { ok: false, error: "Can't reach Hookky right now. Check your connection and try again." };
  }
}

async function submit() {
  const email = input("email").value.trim();
  const password = input("password").value;
  if (mode !== "reset" && !email) return error("Enter your email address.");
  if (mode !== "forgot" && !password) return error("Enter a password.");
  error("");
  if (mode === "signin") {
    const r = await call("login", { email, password });
    if (!r.ok) return error(r.error, r.code === "unverified");
    note("Signed in. Opening the studio…");
    location.href = API;
    return "leaving";
  }
  if (mode === "signup") {
    const r = await call("signup", { email, password, name: input("name").value.trim() });
    if (!r.ok) return error(r.error);
    setMode("signin");
    input("email").value = email;
    return note(r.message || "Check your email to confirm your address.");
  }
  if (mode === "forgot") {
    const r = await call("forgot", { email });
    if (!r.ok) return error(r.error);
    setMode("signin");
    input("email").value = email;
    return note(r.message || "Check your email.");
  }
  const r = await call("reset", { token: resetToken, password });
  if (!r.ok) return error(r.error);
  if (r.signedIn) {
    note("Password saved. Opening the studio…");
    location.href = API;
    return "leaving";
  }
  setMode("signin");
  note(r.message || "Password saved. Sign in with it.");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $<HTMLButtonElement>("[data-submit]", dlg);
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "One moment…";
  const result = await submit();
  if (result !== "leaving") {
    btn.disabled = false;
    btn.textContent = COPY[mode].cta;
  }
});

for (const b of $$<HTMLButtonElement>("[data-auth]")) b.addEventListener("click", () => open(b.dataset.auth as Mode));
for (const b of $$<HTMLButtonElement>("[data-mode]", dlg)) b.addEventListener("click", () => setMode(b.dataset.mode as Mode));
$("[data-close]", dlg).addEventListener("click", () => dlg.close());
dlg.addEventListener("click", (e) => e.target === dlg && dlg.close()); // a click on the backdrop

/** Show the signed-in or signed-out controls. */
function signedIn(user: { name?: string; email: string } | null) {
  for (const el of $$("[data-signed-in]")) el.hidden = !user;
  for (const el of $$("[data-signed-out]")) el.hidden = !!user;
  if (user) for (const el of $$("[data-initial]")) el.textContent = (user.name || user.email)[0].toUpperCase();
}

const BANNERS: Record<string, { text: string; tone: "ok" | "warn" }> = {
  verified: { text: "Email confirmed. Our team will approve your account, and you'll get an email when it's ready.", tone: "ok" },
  "verified-admin": { text: "Email confirmed. You're an admin: sign in to get started.", tone: "ok" },
  "link-expired": { text: "That link has expired or was already used. Sign in, or ask for a new one.", tone: "warn" },
};

export async function initAuth() {
  for (const a of $$<HTMLAnchorElement>("[data-studio]")) a.href = API;
  // Email links land here (?reset=TOKEN, ?auth=verified…): read them, then tidy the address bar.
  const url = new URL(location.href);
  const reset = url.searchParams.get("reset");
  const banner = url.searchParams.get("auth");
  if (reset || banner) {
    url.searchParams.delete("reset");
    url.searchParams.delete("auth");
    const rest = url.searchParams.toString();
    history.replaceState(null, "", url.pathname + (rest ? `?${rest}` : "") + url.hash);
  }
  try {
    const res = await fetch(`${API}/api/auth/me`, { credentials: "include" });
    if (res.ok) signedIn((await res.json()).user);
    else if (res.status !== 401) accountsOff = true;
  } catch {
    accountsOff = true; // no accounts on the studio, or it can't be reached
  }
  if (reset && !accountsOff) {
    resetToken = reset;
    open("reset");
  } else if (banner && BANNERS[banner] && !accountsOff) open("signin", BANNERS[banner]);
}
