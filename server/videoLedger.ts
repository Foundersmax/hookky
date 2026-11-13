// What AI video costs: every generation is recorded with its estimated credits and dollars, so
// each person has a daily credit allowance and the whole app a monthly budget. A clip that fails
// gives its credits back. Kept in Postgres when accounts are on, in memory otherwise.
import { accountsEnabled, db } from "./db";

export interface Actor {
  /** "u:<id>" for a signed-in person, "everyone" when accounts are off */
  who: string;
  userId?: number;
  role?: "user" | "admin";
  /** this person's own daily allowance (null: the default) */
  videoDailyCredits?: number | null;
}
export interface Limits {
  /** default daily credits per person (null: no daily limit) */
  dailyCredits: number | null;
  /** cap on the whole app's estimated spend in a calendar month, in dollars (null: none) */
  monthlyBudgetUsd: number | null;
}
const LIMITS_KEY = "aivideo.limits";
const num = (raw: string | undefined) => {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
let saved: Partial<Limits> = {};
/** Admin-set limits win; then AI_VIDEO_DAILY_CREDITS / AI_VIDEO_MONTHLY_BUDGET; then 300 credits a day and no monthly cap. */
export function limits(): Limits {
  const envDaily = num(process.env.AI_VIDEO_DAILY_CREDITS);
  return {
    dailyCredits: saved.dailyCredits !== undefined ? saved.dailyCredits : envDaily !== null ? Math.floor(envDaily) : 300,
    monthlyBudgetUsd: saved.monthlyBudgetUsd !== undefined ? saved.monthlyBudgetUsd : num(process.env.AI_VIDEO_MONTHLY_BUDGET),
  };
}
export async function loadLimits() {
  if (!accountsEnabled()) return;
  const r = await db().query("select value from settings where key = $1", [LIMITS_KEY]);
  const v = r.rows[0]?.value;
  saved = v && typeof v === "object" ? v : {};
}
export async function setLimits(next: Partial<Limits>) {
  const merged = { ...saved, ...next };
  if (accountsEnabled()) await db().query("insert into settings (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()", [LIMITS_KEY, JSON.stringify(merged)]);
  saved = merged;
}
/** A person's daily allowance; admins have none unless one was set for them. */
export const dailyLimitFor = (a: Actor): number | null => (a.videoDailyCredits !== undefined && a.videoDailyCredits !== null ? a.videoDailyCredits : a.role === "admin" ? null : limits().dailyCredits);

// ---------------------------------------------------------------- the record
type Row = { id: string; userId?: number; who: string; model: string; route: string; credits: number; usd: number; state: "queued" | "done" | "failed"; at: number };
const mem: Row[] = []; // when accounts are off
const pending = new Map<string, { who: string; credits: number; usd: number }>(); // reserved while a request is being sent
const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const utcMonth = (t = Date.now()) => new Date(t).toISOString().slice(0, 7);
const pendingFor = (who?: string) => [...pending.values()].filter((p) => !who || p.who === who);

/** Credits this person has used today (UTC), failed clips excluded, requests in flight included. */
export async function spentToday(who: string): Promise<number> {
  const inFlight = pendingFor(who).reduce((s, p) => s + p.credits, 0);
  if (!accountsEnabled()) return inFlight + mem.filter((r) => r.who === who && r.state !== "failed" && utcDay(r.at) === utcDay()).reduce((s, r) => s + r.credits, 0);
  const r = await db().query("select coalesce(sum(credits), 0)::int as c from video_jobs where who = $1 and state <> 'failed' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'", [who]);
  return inFlight + Number(r.rows[0].c);
}
/** Estimated dollars spent this calendar month (UTC), across everyone. */
export async function spentThisMonth(): Promise<number> {
  const inFlight = pendingFor().reduce((s, p) => s + p.usd, 0);
  if (!accountsEnabled()) return inFlight + mem.filter((r) => r.state !== "failed" && utcMonth(r.at) === utcMonth()).reduce((s, r) => s + r.usd, 0);
  const r = await db().query("select coalesce(sum(usd), 0)::float as u from video_jobs where state <> 'failed' and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'");
  return inFlight + Number(r.rows[0].u);
}

export class OverLimit extends Error {}
let seq = 0;
/** Hold credits for a request about to be sent; refused when it would pass a limit. */
export async function reserve(a: Actor, credits: number, usd: number): Promise<string> {
  const daily = dailyLimitFor(a);
  if (daily !== null) {
    const used = await spentToday(a.who);
    if (used + credits > daily) {
      const left = Math.max(0, daily - used);
      throw new OverLimit(left === 0 ? `You've used today's ${daily} video credits. They reset at midnight UTC.` : `This clip needs about ${credits} credits and you have ${left} left today. Try a shorter clip, a lower quality or a cheaper model.`);
    }
  }
  const budget = limits().monthlyBudgetUsd;
  if (budget !== null && (await spentThisMonth()) + usd > budget) throw new OverLimit("This month's AI video budget is used up. An admin can raise it in the AI video page's settings.");
  const token = `r${++seq}`;
  pending.set(token, { who: a.who, credits, usd });
  return token;
}
export const release = (token: string) => void pending.delete(token);
/** The request was queued: record it for good. */
export async function commit(token: string, job: { id: string; actor: Actor; model: string; route: string }) {
  const p = pending.get(token);
  if (!p) return;
  try {
    if (!accountsEnabled()) {
      mem.push({ id: job.id, userId: job.actor.userId, who: p.who, model: job.model, route: job.route, credits: p.credits, usd: p.usd, state: "queued", at: Date.now() });
      if (mem.length > 20000) mem.splice(0, 4000);
    } else {
      await db().query("insert into video_jobs (id, user_id, who, model, route, credits, usd) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing", [job.id, job.actor.userId ?? null, p.who, job.model, job.route, p.credits, p.usd]);
    }
  } finally {
    pending.delete(token);
  }
}
/** A job ended: a failure gives its credits back (once). */
export async function settle(id: string, state: "done" | "failed") {
  if (!accountsEnabled()) {
    const r = mem.find((x) => x.id === id);
    if (r && r.state === "queued") r.state = state;
    return;
  }
  await db().query("update video_jobs set state = $2, settled_at = now() where id = $1 and state = 'queued'", [id, state]);
}

// ---------------------------------------------------------------- the admin's view
export interface Report {
  month: { usd: number; credits: number; clips: number; failed: number; budgetUsd: number | null };
  today: { usd: number; clips: number };
  byRoute: { route: string; clips: number; usd: number }[];
  byModel: { model: string; clips: number; usd: number }[];
  people: { who: string; email?: string; name?: string; clips: number; credits: number; usd: number; today: number }[];
}
export async function report(): Promise<Report> {
  const budgetUsd = limits().monthlyBudgetUsd;
  if (!accountsEnabled()) {
    const month = mem.filter((r) => utcMonth(r.at) === utcMonth());
    const ok = month.filter((r) => r.state !== "failed");
    const group = <K extends "route" | "model">(k: K) => Object.values(ok.reduce((acc, r) => ((acc[r[k]] ??= { [k]: r[k], clips: 0, usd: 0 } as any), acc[r[k]].clips++, (acc[r[k]].usd += r.usd), acc), {} as Record<string, any>)).sort((a: any, b: any) => b.usd - a.usd);
    const td = ok.filter((r) => utcDay(r.at) === utcDay());
    return {
      month: { usd: ok.reduce((s, r) => s + r.usd, 0), credits: ok.reduce((s, r) => s + r.credits, 0), clips: ok.length, failed: month.length - ok.length, budgetUsd },
      today: { usd: td.reduce((s, r) => s + r.usd, 0), clips: td.length },
      byRoute: group("route"),
      byModel: group("model"),
      people: [{ who: "everyone", clips: ok.length, credits: ok.reduce((s, r) => s + r.credits, 0), usd: ok.reduce((s, r) => s + r.usd, 0), today: td.reduce((s, r) => s + r.credits, 0) }],
    };
  }
  const month = "created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'";
  const today = "created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'";
  const q = (sql: string) => db().query(sql).then((r) => r.rows);
  const [[m], [t], byRoute, byModel, people] = await Promise.all([
    q(`select coalesce(sum(usd) filter (where state <> 'failed'), 0)::float as usd, coalesce(sum(credits) filter (where state <> 'failed'), 0)::int as credits, count(*) filter (where state <> 'failed')::int as clips, count(*) filter (where state = 'failed')::int as failed from video_jobs where ${month}`),
    q(`select coalesce(sum(usd), 0)::float as usd, count(*)::int as clips from video_jobs where state <> 'failed' and ${today}`),
    q(`select route, count(*)::int as clips, sum(usd)::float as usd from video_jobs where state <> 'failed' and ${month} group by route order by usd desc`),
    q(`select model, count(*)::int as clips, sum(usd)::float as usd from video_jobs where state <> 'failed' and ${month} group by model order by usd desc limit 20`),
    q(`select j.who, u.email, u.name, count(*)::int as clips, sum(j.credits)::int as credits, sum(j.usd)::float as usd,
              coalesce(sum(j.credits) filter (where j.${today}), 0)::int as today
       from video_jobs j left join users u on u.id = j.user_id
       where j.state <> 'failed' and j.${month} group by j.who, u.email, u.name order by usd desc limit 50`),
  ]);
  return { month: { ...m, budgetUsd }, today: t, byRoute, byModel, people };
}
/** Tests only. */
export const _resetLedger = () => (mem.splice(0), pending.clear(), (saved = {}));
