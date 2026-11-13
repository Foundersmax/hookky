// Which video connections are switched on. An admin turns makers (or fal.ai) off and on in the AI
// video workspace; the choice is kept in Postgres so it survives deploys. AI_VIDEO_OFF=openai,kling
// turns makers off from the environment, and the app can't turn those back on.
import { accountsEnabled, db } from "./db";

export type Route = "google" | "openai" | "kling" | "minimax" | "byteplus" | "luma" | "fal";
export const ALL_ROUTES: Route[] = ["google", "openai", "kling", "minimax", "byteplus", "luma", "fal"];
const KEY = "aivideo.off";
let off = new Set<Route>();

export const envOff = (): Set<Route> => new Set((process.env.AI_VIDEO_OFF ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter((s): s is Route => (ALL_ROUTES as string[]).includes(s)));
export const isOff = (r: Route) => envOff().has(r) || off.has(r);
export const switchedOff = () => [...off];

/** Read the saved switches (at startup, when accounts are on). */
export async function loadSwitches() {
  if (!accountsEnabled()) return;
  const r = await db().query("select value from settings where key = $1", [KEY]);
  const v = r.rows[0]?.value;
  off = new Set(Array.isArray(v) ? v.filter((s: unknown): s is Route => (ALL_ROUTES as string[]).includes(s as string)) : []);
}

/** Turn a connection on or off for everyone; saved when accounts are on. */
export async function setSwitch(route: Route, on: boolean) {
  const next = new Set(off);
  on ? next.delete(route) : next.add(route);
  if (accountsEnabled()) await db().query("insert into settings (key, value, updated_at) values ($1, $2::jsonb, now()) on conflict (key) do update set value = excluded.value, updated_at = now()", [KEY, JSON.stringify([...next])]);
  off = next;
}
/** Tests only. */
export const _resetSwitches = () => (off = new Set());
