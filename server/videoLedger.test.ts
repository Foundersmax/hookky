// The cost ledger, in memory (accounts off) and in Postgres (when TEST_DATABASE_URL is set, as in CI).
import { test } from "node:test";
import assert from "node:assert/strict";

async function scenario(label: string, mk: () => Promise<{ users?: { id: number; email: string }[] }>) {
  const L = await import("./videoLedger");
  const ctx = await mk();
  L._resetLedger();
  const uid = ctx.users?.[0]?.id;
  const ana = { who: uid ? `u:${uid}` : "u:ana", userId: uid, role: "user" as const };
  const boss = { who: "u:boss", role: "admin" as const };
  const stamp = Date.now();
  const id = (n: string) => `${label}-${n}-${stamp}`;

  // allowance: 300 credits a day by default
  assert.equal(L.dailyLimitFor(ana), 300);
  assert.equal(L.dailyLimitFor(boss), null, "admins aren't capped by default");
  assert.equal(L.dailyLimitFor({ ...boss, videoDailyCredits: 50 }), 50, "unless one is set for them");
  assert.equal(L.dailyLimitFor({ ...ana, videoDailyCredits: 0 }), 0);

  const t1 = await L.reserve(ana, 200, 2);
  await assert.rejects(L.reserve(ana, 150, 1.5), /needs about 150 credits and you have 100 left/, "credits in flight count");
  await L.commit(t1, { id: id("a"), actor: ana, model: "veo-31", route: "google" });
  assert.equal(await L.spentToday(ana.who), 200);
  const t2 = await L.reserve(ana, 100, 1);
  await L.commit(t2, { id: id("b"), actor: ana, model: "sora-2", route: "openai" });
  await assert.rejects(L.reserve(ana, 1, 0.01), /used today's 300 video credits/);
  // a failed clip gives its credits back, once
  await L.settle(id("b"), "failed");
  await L.settle(id("b"), "done");
  assert.equal(await L.spentToday(ana.who), 200);
  await L.settle(id("a"), "done");
  assert.equal(await L.spentToday(ana.who), 200, "a finished clip still counts");
  const t3 = await L.reserve(ana, 100, 1);
  L.release(t3); // never sent: costs nothing
  assert.equal(await L.spentToday(ana.who), 200);

  // the monthly budget stops everyone, admins included
  await L.setLimits({ monthlyBudgetUsd: 3 });
  const month0 = await L.spentThisMonth();
  assert.ok(Math.abs(month0 - 2) < 1e-9, `month so far ${month0}`);
  const tb = await L.reserve(boss, 90, 0.9);
  await L.commit(tb, { id: id("c"), actor: boss, model: "kling-3-pro", route: "kling" });
  await assert.rejects(L.reserve(boss, 20, 0.2), /month's AI video budget is used up/);
  await L.setLimits({ monthlyBudgetUsd: null, dailyCredits: 1000 });
  assert.deepEqual(L.limits(), { dailyCredits: 1000, monthlyBudgetUsd: null });
  assert.equal(L.dailyLimitFor(ana), 1000);

  const r = await L.report();
  assert.equal(r.month.clips, 2);
  assert.equal(r.month.failed, 1);
  assert.equal(r.month.credits, 290);
  assert.ok(Math.abs(r.month.usd - 2.9) < 1e-9);
  assert.deepEqual(r.byRoute.map((x) => x.route), ["google", "kling"]);
  assert.equal(r.today.clips, 2);
  if (uid) {
    const p = r.people.find((x) => x.who === ana.who)!;
    assert.equal(p.email, ctx.users![0].email);
    assert.deepEqual([p.clips, p.credits, p.today], [1, 200, 200]);
  }
  await L.setLimits({ dailyCredits: null });
  assert.equal(L.dailyLimitFor(ana), null, "an admin can lift the daily limit");
}

test("ledger in memory", async () => {
  delete process.env.DATABASE_URL;
  await scenario("mem", async () => ({}));
});

const url = process.env.TEST_DATABASE_URL;
test("ledger in Postgres", { skip: !url && "set TEST_DATABASE_URL to run" }, async () => {
  process.env.DATABASE_URL = url;
  const { db, migrate, closeDb } = await import("./db");
  await migrate();
  await db().query("delete from video_jobs; delete from settings where key = 'aivideo.limits'");
  const email = `ledger-${Date.now()}@example.com`;
  const { rows } = await db().query("insert into users (email, name, password_hash, status) values ($1, 'Ana', 'x', 'active') returning id", [email]);
  try {
    await scenario("pg", async () => ({ users: [{ id: Number(rows[0].id), email }] }));
    // saved limits survive a restart
    const L = await import("./videoLedger");
    await L.setLimits({ dailyCredits: 777, monthlyBudgetUsd: 55.5 });
    L._resetLedger();
    await L.loadLimits();
    assert.deepEqual(L.limits(), { dailyCredits: 777, monthlyBudgetUsd: 55.5 });
    // failures are kept with the person's email; budget warnings already sent aren't repeated after a restart
    const uid = Number(rows[0].id);
    await db().query("delete from video_failures; delete from settings where key = 'aivideo.alerts'");
    await L.recordFailure({ who: `u:${uid}`, model: "sora-2", route: "openai", stage: "render", message: "  blocked by   the safety filter " });
    await L.recordFailure({ who: "", model: "veo-31", route: "google", stage: "save", message: "x".repeat(900) });
    const f = await L.recentFailures();
    assert.deepEqual([f.length, f[0].stage, f[0].message.length, f[0].email], [2, "save", 500, undefined]);
    assert.deepEqual([f[1].email, f[1].message, f[1].route], [email, "blocked by the safety filter", "openai"]);
    await L.setLimits({ dailyCredits: null, monthlyBudgetUsd: 10 });
    const t = await L.reserve({ who: `u:${uid}`, userId: uid, role: "admin" }, 600, 6);
    await L.commit(t, { id: `alert-${Date.now()}`, actor: { who: `u:${uid}`, userId: uid }, model: "sora-2", route: "openai" });
    const spentSoFar = await L.spentThisMonth();
    const due = await L.dueAlerts(`u:${uid}`);
    assert.ok(due.some((x) => x.kind === "budget" && x.step === (spentSoFar >= 10 ? 100 : spentSoFar >= 8 ? 80 : 50)), JSON.stringify(due));
    L._resetLedger(); // as after a restart
    await L.setLimits({ dailyCredits: null, monthlyBudgetUsd: 10 });
    assert.ok(!(await L.dueAlerts("u:someone-else")).some((x) => x.kind === "budget"), "not sent twice");
  } finally {
    await db().query("delete from users where email = $1", [email]);
    await db().query("delete from settings where key in ('aivideo.limits', 'aivideo.alerts'); delete from video_failures");
    await closeDb();
    delete process.env.DATABASE_URL;
  }
});
