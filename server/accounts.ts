// Accounts: sign-up with email verification and admin approval, sessions, password reset, an
// admin API, and per-user daily limits on agent turns. Active only when DATABASE_URL is set.
import { dailyLimitFor, limits as videoLimits } from "./videoLedger";
import express, { type Request, type Response, type NextFunction } from "express";
import { randomBytes, scrypt as scryptCb, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./db";
import { sendMail } from "./mailer";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const env = (k: string) => process.env[k]?.trim() || "";

export type Role = "user" | "admin";
export type Status = "unverified" | "pending" | "active" | "disabled";
export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: Status;
  daily_limit: number | null;
  /** AI video credits a day (null: the default) */
  video_daily_credits?: number | null;
}
declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}

export const COOKIE = "hk_session";
const SESSION_DAYS = 30;
const VERIFY_HOURS = 48;
const RESET_MINUTES = 60;
export const PASSWORD_MIN = 10;

// ---------------------------------------------------------------- primitives
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, key] = stored.split("$");
  if (algo !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
/** Spent on unknown emails so a login takes the same time whether or not the account exists. */
let dummyHash: Promise<string> | null = null;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");
export const validEmail = (e: string) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string" || pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 200) return "That password is too long.";
  return null;
}
const adminEmails = () => new Set(env("ADMIN_EMAILS").split(/[,\s]+/).map(normEmail).filter(Boolean));
/** Daily agent turns for regular users. Unset or invalid → 100 (an empty value must not mean 0). */
export const defaultLimit = () => {
  const raw = env("AGENT_DAILY_LIMIT");
  const n = raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
};

/** The public address of the app, for links in emails. */
function appUrl(req: Request) {
  return (env("APP_URL") || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
}

/** The marketing site where people sign in and sign up (e.g. https://rookker.com); the app itself when unset. */
function siteUrl(req: Request) {
  return (env("SITE_URL") || appUrl(req)).replace(/\/+$/, "");
}

/** Origins allowed to call the sign-in endpoints with cookies: SITE_URL (plus its www twin) and SITE_ORIGINS. */
export function siteOrigins(): Set<string> {
  const out = new Set<string>();
  const add = (u: string) => {
    try {
      const x = new URL(u);
      const local = /^((.+\.)?localhost|127\.0\.0\.1)$/.test(x.hostname);
      if (x.protocol !== "https:" && !local) return;
      out.add(x.origin);
      const twin = x.hostname.startsWith("www.") ? x.hostname.slice(4) : `www.${x.hostname}`;
      if (x.hostname !== "localhost" && x.hostname !== "127.0.0.1") out.add(`${x.protocol}//${twin}${x.port ? `:${x.port}` : ""}`);
    } catch {}
  };
  if (env("SITE_URL")) add(env("SITE_URL"));
  for (const o of env("SITE_ORIGINS").split(/[,\s]+/).filter(Boolean)) add(o);
  return out;
}

/** CORS for the landing page: only the sign-in endpoints, only the site's own origins, with cookies. */
export function authCors(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/auth/")) return next();
  const origin = req.get("origin");
  if (origin && siteOrigins().has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return void res.status(204).end();
  next();
}

// ---------------------------------------------------------------- rate limiting (in memory)
const hits = new Map<string, number[]>();
/** True when `key` has been seen `max` times within `windowMs`; records this attempt either way. */
export function limited(key: string, max: number, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 20000) for (const k of [...hits.keys()].slice(0, 5000)) hits.delete(k);
  return list.length > max;
}

// ---------------------------------------------------------------- sessions
function setCookie(req: Request, res: Response, value: string, maxAgeSec: number) {
  // Behind Render's proxy (trust proxy is on) req.secure reflects the visitor's HTTPS connection.
  const secure = req.secure;
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`);
}
function readCookie(req: Request): string {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return "";
}

async function startSession(req: Request, res: Response, userId: number) {
  const t = token();
  await db().query("insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + $3::interval)", [sha(t), userId, `${SESSION_DAYS} days`]);
  await db().query("update users set last_login_at = now() where id = $1", [userId]);
  setCookie(req, res, t, SESSION_DAYS * 86400);
}

/** The signed-in, active user for this request, if any. */
export async function sessionUser(req: Request): Promise<User | null> {
  const t = readCookie(req);
  if (!t || t.length > 100) return null;
  const { rows } = await db().query(
    `update sessions s set last_seen_at = now() from users u
     where s.token_hash = $1 and s.expires_at > now() and u.id = s.user_id and u.status = 'active'
     returning u.id, u.email, u.name, u.role, u.status, u.daily_limit, u.video_daily_credits`,
    [sha(t)],
  );
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

// ---------------------------------------------------------------- one-time tokens
async function issueToken(userId: number, kind: "verify" | "reset") {
  const t = token();
  const life = kind === "verify" ? `${VERIFY_HOURS} hours` : `${RESET_MINUTES} minutes`;
  await db().query("update auth_tokens set used_at = now() where user_id = $1 and kind = $2 and used_at is null", [userId, kind]);
  await db().query("insert into auth_tokens (token_hash, user_id, kind, expires_at) values ($1, $2, $3, now() + $4::interval)", [sha(t), userId, kind, life]);
  return t;
}
async function spendToken(t: unknown, kind: "verify" | "reset"): Promise<number | null> {
  if (typeof t !== "string" || !t || t.length > 100) return null;
  const { rows } = await db().query(
    "update auth_tokens set used_at = now() where token_hash = $1 and kind = $2 and used_at is null and expires_at > now() returning user_id",
    [sha(t), kind],
  );
  return rows[0] ? Number(rows[0].user_id) : null;
}

// ---------------------------------------------------------------- emails
async function sendVerify(req: Request, u: { id: number; email: string; name: string }) {
  const t = await issueToken(u.id, "verify");
  return sendMail({
    to: u.email,
    toName: u.name,
    subject: "Confirm your email for Rookker",
    lines: [`Hi${u.name ? ` ${u.name}` : ""},`, "Confirm your email address to finish signing up for Rookker."],
    action: { label: "Confirm email", url: `${appUrl(req)}/api/auth/verify?token=${t}` },
    footer: `This link works for ${VERIFY_HOURS} hours. If you didn't sign up, ignore this email.`,
  });
}

async function notifyAdmins(req: Request, u: { email: string; name: string }) {
  const { rows } = await db().query("select email, name from users where role = 'admin' and status = 'active'");
  const to = new Set<string>([...rows.map((r) => r.email as string), ...adminEmails()]);
  await Promise.all(
    [...to].map((email) =>
      sendMail({
        to: email,
        subject: `New Rookker sign-up: ${u.email}`,
        lines: [`${u.name || u.email} (${u.email}) confirmed their email and is waiting for approval.`],
        action: { label: "Review sign-ups", url: `${appUrl(req)}/?admin=pending` },
      }),
    ),
  );
}

// ---------------------------------------------------------------- usage limits
export function limitFor(u: Pick<User, "role" | "daily_limit">): number | null {
  if (u.role === "admin") return null; // admins aren't capped
  return u.daily_limit ?? defaultLimit();
}

/** Count one agent turn for today. Returns false (and counts nothing) when the user is at their limit. */
export async function takeAgentTurn(u: User): Promise<{ ok: boolean; used: number; limit: number | null }> {
  const limit = limitFor(u);
  const { rows } = await db().query(
    `insert into usage (user_id, day, agent_turns) values ($1, current_date, 1)
     on conflict (user_id, day) do update set agent_turns = usage.agent_turns + 1
     where $2::int is null or usage.agent_turns < $2::int
     returning agent_turns`,
    [u.id, limit],
  );
  if (rows[0]) return { ok: true, used: rows[0].agent_turns, limit };
  return { ok: false, used: limit ?? 0, limit };
}

// ---------------------------------------------------------------- middleware
const PUBLIC_API = new Set(["/api/health"]);

/** Every /api route except health and auth needs an active, signed-in user. Pages stay public (the app shows sign-in). */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  // the video makers fetch the frames people animate from /api/aivideo/input/<unguessable token>
  if (!req.path.startsWith("/api/") || PUBLIC_API.has(req.path) || req.path.startsWith("/api/auth/") || req.path.startsWith("/api/aivideo/input/")) return next();
  try {
    const u = await sessionUser(req);
    if (!u) return void res.status(401).json({ error: "Sign in to use Rookker.", code: "signed_out" });
    req.user = u;
    if (req.path.startsWith("/api/admin/") && u.role !== "admin") return void res.status(403).json({ error: "Admins only." });
    next();
  } catch (e) {
    next(e);
  }
}

/** Refuse cross-site state changes: a POST from another origin is rejected even with a cookie. */
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("origin");
  if (!origin) return next(); // same-origin fetches from older browsers, and non-browser clients without cookies
  try {
    if (new URL(origin).host === req.get("host")) return next();
  } catch {}
  // The landing page may sign people in, and nothing else.
  // (req.path is relative to where this is mounted, so read the full path.)
  if (req.originalUrl.split("?")[0].startsWith("/api/auth/") && siteOrigins().has(origin)) return next();
  res.status(403).json({ error: "Cross-site request refused." });
}

// ---------------------------------------------------------------- routes
const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const generic = "If that address can sign in to Rookker, we've sent it an email. Check your inbox (and spam).";

export function accountRoutes() {
  const r = express.Router();
  const ip = (req: Request) => req.ip ?? "?";

  r.get("/api/auth/me", async (req, res) => {
    const u = await sessionUser(req);
    if (!u) return void res.status(401).json({ code: "signed_out" });
    const { rows } = await db().query("select agent_turns from usage where user_id = $1 and day = current_date", [u.id]);
    res.json({ user: publicUser(u), usage: { today: rows[0]?.agent_turns ?? 0, limit: limitFor(u) } });
  });

  r.post("/api/auth/signup", async (req, res) => {
    if (limited(`signup:${ip(req)}`, 10)) return void res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    const email = normEmail(req.body?.email);
    const name = String(req.body?.name ?? "").trim().slice(0, 80);
    if (!validEmail(email)) return void res.status(400).json({ error: "Enter a valid email address." });
    const bad = passwordProblem(req.body?.password);
    if (bad) return void res.status(400).json({ error: bad });
    const hash = await hashPassword(req.body.password);
    const { rows } = await db().query(
      "insert into users (email, name, password_hash) values ($1, $2, $3) on conflict (email) do nothing returning id, email, name",
      [email, name, hash],
    );
    if (rows[0]) await sendVerify(req, { ...rows[0], id: Number(rows[0].id) });
    else {
      // Already registered: re-send the confirmation if it's still pending; otherwise say nothing new.
      const ex = await db().query("select id, email, name, status from users where email = $1", [email]);
      if (ex.rows[0]?.status === "unverified") await sendVerify(req, { ...ex.rows[0], id: Number(ex.rows[0].id) });
    }
    res.json({ ok: true, message: "Check your email to confirm your address. After that, an admin approves your account." });
  });

  r.get("/api/auth/verify", async (req, res) => {
    const userId = await spendToken(req.query.token, "verify");
    if (!userId) return void res.redirect(303, `${siteUrl(req)}/?auth=link-expired`);
    const { rows } = await db().query("select id, email, name, status from users where id = $1", [userId]);
    const u = rows[0];
    if (!u || u.status !== "unverified") return void res.redirect(303, `${siteUrl(req)}/?auth=verified`);
    const admin = adminEmails().has(u.email);
    await db().query(
      `update users set verified_at = now(), status = $2, role = case when $3 then 'admin' else role end, approved_at = case when $3 then now() else approved_at end where id = $1`,
      [userId, admin ? "active" : "pending", admin],
    );
    if (!admin) await notifyAdmins(req, u);
    res.redirect(303, `${siteUrl(req)}/?auth=${admin ? "verified-admin" : "verified"}`);
  });

  r.post("/api/auth/resend", async (req, res) => {
    const email = normEmail(req.body?.email);
    if (limited(`resend:${ip(req)}`, 5) || limited(`resend:${email}`, 3)) return void res.status(429).json({ error: "Too many emails requested. Try again later." });
    const { rows } = await db().query("select id, email, name, status from users where email = $1", [email]);
    if (rows[0]?.status === "unverified") await sendVerify(req, { ...rows[0], id: Number(rows[0].id) });
    res.json({ ok: true, message: generic });
  });

  r.post("/api/auth/login", async (req, res) => {
    const email = normEmail(req.body?.email);
    const pw = typeof req.body?.password === "string" ? req.body.password : "";
    if (limited(`login:${ip(req)}`, 30) || limited(`login:${email}`, 10)) return void res.status(429).json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
    const { rows } = await db().query("select id, email, name, role, status, daily_limit, password_hash from users where email = $1", [email]);
    const u = rows[0];
    const ok = u ? await checkPassword(pw, u.password_hash) : (await checkPassword(pw, await (dummyHash ??= hashPassword("not-a-real-password"))), false);
    if (!ok) return void res.status(401).json({ error: "That email and password don't match." });
    if (u.status === "unverified") return void res.status(403).json({ code: "unverified", error: "Confirm your email first. We can send the link again." });
    if (u.status === "pending") return void res.status(403).json({ code: "pending", error: "Your account is waiting for an admin to approve it. You'll get an email when it's ready." });
    if (u.status === "disabled") return void res.status(403).json({ code: "disabled", error: "This account has been disabled. Contact your Rookker admin." });
    await startSession(req, res, Number(u.id));
    res.json({ user: publicUser({ ...u, id: Number(u.id) }) });
  });

  r.post("/api/auth/logout", async (req, res) => {
    const t = readCookie(req);
    if (t) await db().query("delete from sessions where token_hash = $1", [sha(t)]);
    setCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  r.post("/api/auth/forgot", async (req, res) => {
    const email = normEmail(req.body?.email);
    if (limited(`forgot:${ip(req)}`, 5) || limited(`forgot:${email}`, 3)) return void res.status(429).json({ error: "Too many emails requested. Try again later." });
    const { rows } = await db().query("select id, email, name, status from users where email = $1", [email]);
    const u = rows[0];
    if (u && u.status !== "disabled") {
      const t = await issueToken(Number(u.id), "reset");
      await sendMail({
        to: u.email,
        toName: u.name,
        subject: "Reset your Rookker password",
        lines: ["Someone (hopefully you) asked to reset the password for this Rookker account."],
        action: { label: "Choose a new password", url: `${siteUrl(req)}/?reset=${t}` },
        footer: `This link works for ${RESET_MINUTES} minutes. If you didn't ask for it, ignore this email; your password stays the same.`,
      });
    }
    res.json({ ok: true, message: generic });
  });

  r.post("/api/auth/reset", async (req, res) => {
    if (limited(`reset:${ip(req)}`, 10)) return void res.status(429).json({ error: "Too many attempts. Try again later." });
    const bad = passwordProblem(req.body?.password);
    if (bad) return void res.status(400).json({ error: bad });
    const userId = await spendToken(req.body?.token, "reset");
    if (!userId) return void res.status(400).json({ error: "This reset link has expired or was already used. Ask for a new one." });
    const hash = await hashPassword(req.body.password);
    const { rows } = await db().query(
      // A reset proves the address, so an unconfirmed account counts as confirmed (still needs approval).
      `update users set password_hash = $2,
         verified_at = coalesce(verified_at, now()),
         status = case when status = 'unverified' then 'pending' else status end
       where id = $1 returning status, email, name`,
      [userId, hash],
    );
    await db().query("delete from sessions where user_id = $1", [userId]); // sign out everywhere
    const status = rows[0]?.status as Status;
    if (status === "active") {
      await startSession(req, res, userId);
      return void res.json({ ok: true, signedIn: true });
    }
    res.json({ ok: true, signedIn: false, message: status === "pending" ? "Password saved. Your account is waiting for an admin to approve it." : "Password saved." });
  });

  // ------------------------------------------------------------ admin
  r.get("/api/admin/users", async (req, res) => {
    const q = String(req.query.q ?? "").trim().toLowerCase().slice(0, 100);
    const status = String(req.query.status ?? "");
    const { rows } = await db().query(
      `select u.id, u.email, u.name, u.role, u.status, u.daily_limit, u.video_daily_credits, u.created_at, u.verified_at, u.approved_at, u.last_login_at,
              coalesce((select sum(credits) from video_jobs where user_id = u.id and state <> 'failed' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'), 0)::int as video_today,
              coalesce((select agent_turns from usage where user_id = u.id and day = current_date), 0) as today,
              coalesce((select sum(agent_turns) from usage where user_id = u.id and day > current_date - 30), 0)::int as last30
       from users u
       where ($1 = '' or u.email like '%' || $1 || '%' or lower(u.name) like '%' || $1 || '%')
         and ($2 = '' or u.status = $2)
       order by case u.status when 'pending' then 0 when 'active' then 1 when 'unverified' then 2 else 3 end, u.created_at desc
       limit 500`,
      [q, ["unverified", "pending", "active", "disabled"].includes(status) ? status : ""],
    );
    res.json({ users: rows.map((u) => ({ ...u, id: Number(u.id), limit: limitFor(u), video_limit: dailyLimitFor({ who: `u:${u.id}`, role: u.role, videoDailyCredits: u.video_daily_credits }) })), defaultLimit: defaultLimit(), defaultVideoLimit: videoLimits().dailyCredits });
  });

  r.post("/api/admin/users/:id", async (req, res) => {
    const id = Number(req.params.id);
    const me = req.user!;
    const action = String(req.body?.action ?? "");
    const { rows } = await db().query("select id, email, name, role, status from users where id = $1", [id]);
    const u = rows[0];
    if (!u) return void res.status(404).json({ error: "No such user." });
    const self = Number(u.id) === me.id;
    const admins = async () => Number((await db().query("select count(*) from users where role = 'admin' and status = 'active'")).rows[0].count);

    switch (action) {
      case "approve":
      case "enable": {
        if (u.status === "unverified" && action === "approve") {
          // An admin can vouch for an address that never confirmed.
          await db().query("update users set verified_at = coalesce(verified_at, now()) where id = $1", [id]);
        }
        await db().query("update users set status = 'active', approved_at = coalesce(approved_at, now()) where id = $1", [id]);
        if (u.status !== "active")
          await sendMail({
            to: u.email,
            toName: u.name,
            subject: "Your Rookker account is ready",
            lines: [`Hi${u.name ? ` ${u.name}` : ""},`, action === "approve" ? "An admin approved your account. You can sign in now." : "Your account has been turned back on. You can sign in again."],
            action: { label: "Open Rookker", url: appUrl(req) },
          });
        break;
      }
      case "disable":
        if (self) return void res.status(400).json({ error: "You can't disable your own account." });
        if (u.role === "admin" && (await admins()) <= 1) return void res.status(400).json({ error: "Keep at least one active admin." });
        await db().query("update users set status = 'disabled' where id = $1", [id]);
        await db().query("delete from sessions where user_id = $1", [id]);
        break;
      case "make_admin":
        await db().query("update users set role = 'admin' where id = $1", [id]);
        break;
      case "remove_admin":
        if (self) return void res.status(400).json({ error: "Ask another admin to remove your admin role." });
        await db().query("update users set role = 'user' where id = $1", [id]);
        break;
      case "set_limit": {
        const v = req.body?.limit;
        const limit = v === null || v === "" || v === undefined ? null : Math.floor(Number(v));
        if (limit !== null && !(Number.isFinite(limit) && limit >= 0 && limit <= 100000)) return void res.status(400).json({ error: "Limit must be a number from 0 to 100000, or empty for the default." });
        await db().query("update users set daily_limit = $2 where id = $1", [id, limit]);
        break;
      }
      case "set_video_limit": {
        const v = req.body?.limit;
        const limit = v === null || v === "" || v === undefined ? null : Math.floor(Number(v));
        if (limit !== null && !(Number.isFinite(limit) && limit >= 0 && limit <= 1_000_000)) return void res.status(400).json({ error: "Video credits must be a number from 0 to 1000000, or empty for the default." });
        await db().query("update users set video_daily_credits = $2 where id = $1", [id, limit]);
        break;
      }
      case "resend_verify":
        if (u.status !== "unverified") return void res.status(400).json({ error: "This address is already confirmed." });
        await sendVerify(req, { ...u, id });
        break;
      case "delete":
        if (self) return void res.status(400).json({ error: "You can't delete your own account." });
        if (u.role === "admin" && (await admins()) <= 1) return void res.status(400).json({ error: "Keep at least one active admin." });
        await db().query("delete from users where id = $1", [id]);
        break;
      default:
        return void res.status(400).json({ error: "Unknown action." });
    }
    res.json({ ok: true });
  });

  return r;
}
