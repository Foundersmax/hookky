// Accounts end to end against a real Postgres. Runs when TEST_DATABASE_URL is set (CI provides
// one); skipped otherwise. The test database is wiped first: never point this at real data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";

const url = process.env.TEST_DATABASE_URL;
const skip = !url && "set TEST_DATABASE_URL to run the accounts tests";

let base = "";
let server: ReturnType<express.Express["listen"]>;
let outbox: { to: string; subject: string; text: string }[] = [];

before(async () => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  process.env.MAIL_SINK = "memory";
  process.env.ADMIN_EMAILS = "owner@hookky.test";
  process.env.AGENT_DAILY_LIMIT = "2";
  const { db, migrate } = await import("./db");
  await db().query("drop table if exists usage, auth_tokens, sessions, users cascade");
  await migrate();
  const acc = await import("./accounts");
  outbox = (await import("./mailer")).outbox;
  const app = express();
  app.use(express.json());
  app.use("/api", acc.sameOrigin);
  app.use(acc.requireUser);
  app.use(acc.accountRoutes());
  app.post("/api/agent-turn", async (req, res) => res.json(await acc.takeAgentTurn(req.user!)));
  app.get("/api/thing", (req, res) => res.json({ hello: req.user!.email }));
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  if (!url) return;
  server?.close();
  (await import("./db")).closeDb();
});

/** A tiny cookie-keeping client per person. */
function client() {
  let cookie = "";
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, redirect: "manual", headers: { ...(body !== undefined && { "Content-Type": "application/json" }), ...(cookie && { Cookie: cookie }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = /Max-Age=0/.test(set) ? "" : set.split(";")[0];
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, location: res.headers.get("location"), setCookie: set };
  };
  return { call, get cookie() { return cookie; } };
}
const linkIn = (to: string, re: RegExp) => {
  const m = [...outbox].reverse().find((x) => x.to === to && re.test(x.text));
  return m && new URL(m.text.match(/https?:\/\/\S+/)![0]);
};

test("sign-up → confirm email → admin approval → sign in", { skip }, async () => {
  const owner = client();
  // The owner (in ADMIN_EMAILS) becomes an active admin as soon as they confirm.
  assert.equal((await owner.call("POST", "/api/auth/signup", { email: "Owner@Hookky.test", password: "correct horse battery", name: "Owner" })).status, 200);
  let link = linkIn("owner@hookky.test", /Confirm email/)!;
  let r = await owner.call("GET", link.pathname + link.search);
  assert.deepEqual([r.status, r.location], [303, "/?auth=verified-admin"]);
  r = await owner.call("POST", "/api/auth/login", { email: "owner@hookky.test", password: "correct horse battery" });
  assert.equal(r.status, 200);
  assert.match(r.setCookie!, /HttpOnly; SameSite=Lax/);
  assert.equal((await owner.call("GET", "/api/auth/me")).json.user.role, "admin");

  // A regular user: short password refused, then sign-up, confirm, wait for approval.
  const ana = client();
  assert.match((await ana.call("POST", "/api/auth/signup", { email: "ana@hookky.test", password: "short" })).json.error, /at least 10/);
  await ana.call("POST", "/api/auth/signup", { email: "ana@hookky.test", password: "ana's long password", name: "Ana" });
  assert.equal((await ana.call("POST", "/api/auth/login", { email: "ana@hookky.test", password: "ana's long password" })).json.code, "unverified");
  link = linkIn("ana@hookky.test", /Confirm email/)!;
  assert.equal((await ana.call("GET", link.pathname + link.search)).location, "/?auth=verified");
  assert.equal((await ana.call("GET", link.pathname + link.search)).location, "/?auth=link-expired", "links work once");
  assert.ok(outbox.some((m) => m.to === "owner@hookky.test" && /New Hookky sign-up: ana@hookky.test/.test(m.subject)), "admins hear about it");
  r = await ana.call("POST", "/api/auth/login", { email: "ana@hookky.test", password: "ana's long password" });
  assert.deepEqual([r.status, r.json.code], [403, "pending"]);
  assert.equal((await ana.call("GET", "/api/thing")).status, 401, "no session yet");

  // The admin approves; Ana gets an email and can sign in.
  const users = (await owner.call("GET", "/api/admin/users")).json.users;
  const anaRow = users.find((u: any) => u.email === "ana@hookky.test");
  assert.equal(anaRow.status, "pending");
  assert.equal((await owner.call("POST", `/api/admin/users/${anaRow.id}`, { action: "approve" })).status, 200);
  assert.ok(outbox.some((m) => m.to === "ana@hookky.test" && /ready/.test(m.subject)));
  assert.equal((await ana.call("POST", "/api/auth/login", { email: "ana@hookky.test", password: "ana's long password" })).status, 200);
  assert.deepEqual((await ana.call("GET", "/api/thing")).json, { hello: "ana@hookky.test" });
  assert.equal((await ana.call("GET", "/api/admin/users")).status, 403, "users can't reach admin");

  // Wrong password and unknown email look the same.
  const x = client();
  const wrong = await x.call("POST", "/api/auth/login", { email: "ana@hookky.test", password: "nope nope nope" });
  const ghost = await x.call("POST", "/api/auth/login", { email: "ghost@hookky.test", password: "nope nope nope" });
  assert.deepEqual([wrong.status, wrong.json.error], [ghost.status, ghost.json.error]);

  // Daily agent limit (2 in this test), admins unlimited.
  assert.deepEqual((await ana.call("POST", "/api/agent-turn", {})).json, { ok: true, used: 1, limit: 2 });
  await ana.call("POST", "/api/agent-turn", {});
  assert.equal((await ana.call("POST", "/api/agent-turn", {})).json.ok, false);
  assert.equal((await owner.call("POST", `/api/admin/users/${anaRow.id}`, { action: "set_limit", limit: 5 })).status, 200);
  assert.equal((await ana.call("POST", "/api/agent-turn", {})).json.ok, true, "a raised limit applies at once");
  for (let i = 0; i < 4; i++) assert.equal((await owner.call("POST", "/api/agent-turn", {})).json.limit, null);

  // Disabling signs Ana out everywhere.
  assert.equal((await owner.call("POST", `/api/admin/users/${anaRow.id}`, { action: "disable" })).status, 200);
  assert.equal((await ana.call("GET", "/api/thing")).status, 401);
  assert.equal((await ana.call("POST", "/api/auth/login", { email: "ana@hookky.test", password: "ana's long password" })).json.code, "disabled");

  // Admin guard rails.
  const ownerId = (await owner.call("GET", "/api/auth/me")).json.user.id;
  assert.match((await owner.call("POST", `/api/admin/users/${ownerId}`, { action: "disable" })).json.error, /own account/);
  assert.match((await owner.call("POST", `/api/admin/users/${ownerId}`, { action: "remove_admin" })).json.error, /another admin/);
});

test("password reset signs out other sessions and proves the address", { skip }, async () => {
  const bo = client();
  await bo.call("POST", "/api/auth/signup", { email: "bo@hookky.test", password: "bo's first password" });
  // Never confirmed: a reset confirms the address but approval is still needed.
  const forgot = await bo.call("POST", "/api/auth/forgot", { email: "bo@hookky.test" });
  assert.match(forgot.json.message, /If that address/);
  const generic = await bo.call("POST", "/api/auth/forgot", { email: "nobody@hookky.test" });
  assert.equal(generic.json.message, forgot.json.message, "no account enumeration");
  const link = linkIn("bo@hookky.test", /new password/)!;
  const t = link.searchParams.get("reset")!;
  assert.match((await bo.call("POST", "/api/auth/reset", { token: t, password: "tiny" })).json.error, /at least 10/);
  const r = await bo.call("POST", "/api/auth/reset", { token: t, password: "bo's second password" });
  assert.deepEqual([r.json.ok, r.json.signedIn], [true, false]);
  assert.match(r.json.message, /waiting for an admin/);
  assert.equal((await bo.call("POST", "/api/auth/reset", { token: t, password: "bo's third password" })).status, 400, "single use");
  assert.equal((await bo.call("POST", "/api/auth/login", { email: "bo@hookky.test", password: "bo's second password" })).json.code, "pending");
});

test("cross-site writes are refused and sign-in attempts are rate limited", { skip }, async () => {
  const c = client();
  const r = await c.call("POST", "/api/auth/login", { email: "a@b.co", password: "x" }, { Origin: "https://evil.example" });
  assert.equal(r.status, 403);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await c.call("POST", "/api/auth/login", { email: "spray@hookky.test", password: "wrong password!" })).status;
  assert.equal(last, 429);
});

test("an unset or invalid AGENT_DAILY_LIMIT means 100, not 0", { skip }, async () => {
  const { defaultLimit } = await import("./accounts");
  const prev = process.env.AGENT_DAILY_LIMIT;
  for (const [v, want] of [["", 100], ["  ", 100], ["abc", 100], ["-5", 100], ["0", 0], ["25", 25]] as const) {
    process.env.AGENT_DAILY_LIMIT = v;
    assert.equal(defaultLimit(), want, JSON.stringify(v));
  }
  process.env.AGENT_DAILY_LIMIT = prev;
});
