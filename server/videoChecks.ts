// Checking a video connection without spending anything: is the key accepted, is there credit, is
// the model there. Each maker has some free account or lookup call; the answer is put in plain
// words. A check proves the key, not the whole path: the test clip (see aivideo.ts) proves that.
import { call, MAKERS, makerModel, type Answer } from "./videoProviders";
import { VIDEO_MODELS, PROVIDER_NAMES, type Provider } from "../src/aivideo/models";

export type CheckState = "ok" | "no-key" | "key-rejected" | "no-credit" | "model-missing" | "unreachable" | "unclear";
export interface Check {
  state: CheckState;
  /** one sentence a person can act on */
  message: string;
  /** credit or balance, where the maker reports it */
  balance?: string;
}
type Route = Provider | "fal";
const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean) ?? "";
const said = (a: Answer) => String(a.json?.error?.message ?? a.json?.message ?? a.json?.detail ?? a.json?.base_resp?.status_msg ?? a.text ?? "").replace(/\s+/g, " ").slice(0, 160);
const rejected = (name: string, key: string, a?: Answer): Check => ({ state: "key-rejected", message: `${name} rejected the key${a && said(a) ? ` (${said(a)})` : ""}. Paste a fresh one into ${key}.` });
const unclear = (name: string, a: Answer): Check => ({ state: "unclear", message: `${name} answered ${a.status}${said(a) ? `: ${said(a)}` : ""}. The key may still be fine: make a test clip to be sure.` });
const firstModel = (p: Provider) => {
  const m = VIDEO_MODELS.find((x) => x.direct?.provider === p)!;
  return makerModel(m.id, m.direct!);
};

const CHECKS: Record<Route, () => Promise<Check>> = {
  // the model's own record: proves the key and that this account can see the model
  async openai() {
    const model = firstModel("openai");
    const a = await call(`${MAKERS.openai.base()}/models/${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` } });
    if (a.ok) return { state: "ok", message: `Key accepted, and this account can see ${model}.` };
    if (a.status === 401) return rejected("OpenAI", "OPENAI_API_KEY", a);
    if (a.status === 404 || a.status === 403) return { state: "model-missing", message: `The key works, but this OpenAI account can't use ${model} yet. Video access may need your organization to be verified in OpenAI's settings.` };
    if (a.status === 429) return { state: "no-credit", message: `OpenAI says this account is out of quota (${said(a)}).` };
    return unclear("OpenAI", a);
  },
  async google() {
    const model = firstModel("google");
    const a = await call(`${MAKERS.google.base()}/publishers/google/models/${encodeURIComponent(model)}`, { headers: { "x-goog-api-key": env("VERTEX_API_KEY", "GOOGLE_VERTEX_API_KEY") } });
    if (a.ok) return { state: "ok", message: `Key accepted, and ${model} is there.` };
    if (a.status === 401 || (a.status === 400 && /API key/i.test(said(a)))) return rejected("Google", "VERTEX_API_KEY", a);
    if (a.status === 403) return { state: "key-rejected", message: `Google accepted the key but refused access (${said(a) || "permission denied"}). It must be a Vertex AI key from a Cloud project with billing and the Vertex AI API switched on.` };
    if (a.status === 404) return { state: "model-missing", message: `The key works, but Google doesn't know ${model}. Set its current name with AIV_MODEL_VEO_31.` };
    return unclear("Google", a);
  },
  async kling() {
    const a = await call(`${MAKERS.kling.base()}/account/billing/balance`, { headers: { Authorization: `Bearer ${env("KLING_API_KEY")}` } });
    const code = a.json?.code;
    if (a.status === 401 || code === 1000 || code === 1001 || code === 1002 || code === 1004) return rejected("Kling", "KLING_API_KEY", a);
    if (a.ok && (code === 0 || code === undefined)) {
      const d = a.json?.data ?? {};
      const bal = d.balance ?? d.available_balance ?? d.total_balance;
      const none = typeof bal === "number" && bal <= 0;
      return { state: none ? "no-credit" : "ok", message: none ? "The key works, but the Kling account has no balance. Buy a video resource pack." : "Key accepted.", ...(bal !== undefined && { balance: String(bal) }) };
    }
    return unclear("Kling", a);
  },
  // asking after a task that doesn't exist: a bad key fails before the task is looked for
  async minimax() {
    const a = await call(`${MAKERS.minimax.base()}/v1/query/video_generation?task_id=0`, { headers: { Authorization: `Bearer ${env("MINIMAX_API_KEY")}` } });
    const code = a.json?.base_resp?.status_code;
    if (a.status === 401 || code === 1004 || code === 2049) return rejected("MiniMax", "MINIMAX_API_KEY", a);
    if (code === 1008) return { state: "no-credit", message: "The key works, but the MiniMax account has no balance." };
    if (a.ok) return { state: "ok", message: "Key accepted." };
    return unclear("MiniMax", a);
  },
  async byteplus() {
    const a = await call(`${MAKERS.byteplus.base()}/contents/generations/tasks?page_size=1`, { headers: { Authorization: `Bearer ${env("BYTEPLUS_ARK_API_KEY", "ARK_API_KEY")}` } });
    if (a.ok) return { state: "ok", message: "Key accepted. Each Seedance model must also be activated in the ModelArk console: a test clip confirms that." };
    if (a.status === 401 || /AuthenticationError|InvalidApiKey|Unauthorized/i.test(String(a.json?.error?.code ?? ""))) return rejected("BytePlus", "BYTEPLUS_ARK_API_KEY", a);
    if (a.status === 403) return { state: "no-credit", message: `BytePlus refused the request (${said(a) || "account overdue or not allowed"}).` };
    return unclear("BytePlus", a);
  },
  async luma() {
    const a = await call(`${MAKERS.luma.base()}/credits`, { headers: { Authorization: `Bearer ${env("LUMA_API_KEY", "LUMAAI_API_KEY")}` } });
    if (a.status === 401 || a.status === 403) return rejected("Luma", "LUMA_API_KEY", a);
    if (a.ok) {
      const bal = a.json?.credit_balance;
      const none = typeof bal === "number" && bal <= 0;
      return { state: none ? "no-credit" : "ok", message: none ? "The key works, but the Luma account has no credits." : "Key accepted.", ...(typeof bal === "number" && { balance: `${bal} credits` }) };
    }
    return unclear("Luma", a);
  },
  // fal.ai has no free account call: asking after a request that doesn't exist still checks the key first
  async fal() {
    const base = (process.env.FAL_QUEUE_URL || "https://queue.fal.run").replace(/\/+$/, "");
    const a = await call(`${base}/fal-ai/minimax/requests/00000000-0000-0000-0000-000000000000/status`, { headers: { Authorization: `Key ${process.env.FAL_KEY?.trim() || process.env.FAL_API_KEY?.trim() || ""}` } });
    if (a.status === 401) return rejected("fal.ai", "FAL_KEY", a);
    if (a.status === 403) return { state: "no-credit", message: `fal.ai refused the request (${said(a) || "the account may be out of credit or locked"}).` };
    if (a.ok || a.status === 404 || a.status === 422 || a.status === 400) return { state: "ok", message: "Key accepted. fal.ai doesn't report its balance here: check it in the fal.ai dashboard." };
    return unclear("fal.ai", a);
  },
};

const keySet = (r: Route) => (r === "fal" ? !!(process.env.FAL_KEY?.trim() || process.env.FAL_API_KEY?.trim()) : MAKERS[r].configured());
const keyName = (r: Route) => (r === "fal" ? "FAL_KEY" : MAKERS[r].keyName);

/** Check one connection. Never throws: an unreachable maker is an answer too. */
export async function checkConnection(route: Route): Promise<Check> {
  if (!keySet(route)) return { state: "no-key", message: `No key yet: add ${keyName(route)} in the server's environment.` };
  try {
    return await CHECKS[route]();
  } catch (e) {
    return { state: "unreachable", message: `${PROVIDER_NAMES[route]} ${(e as Error)?.message ?? "couldn't be reached"}.` };
  }
}

// The health check shows each maker's state without calling them on every probe.
const last = new Map<Route, { at: number; check: Check }>();
export async function cachedCheck(route: Route, maxAgeMs = 10 * 60_000): Promise<Check> {
  const hit = last.get(route);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.check;
  const check = await checkConnection(route);
  last.set(route, { at: Date.now(), check });
  return check;
}
export const rememberCheck = (route: Route, check: Check) => void last.set(route, { at: Date.now(), check });

/** For the health check: each keyed connection's last known state, refreshed in the background (never waits on a maker). */
export function checkStates(routes: Route[]): Record<string, CheckState | "unchecked"> {
  for (const r of routes) {
    const hit = last.get(r);
    if (!hit || Date.now() - hit.at > 10 * 60_000) void cachedCheck(r, 0).catch(() => {});
  }
  return Object.fromEntries(routes.map((r) => [r, last.get(r)?.check.state ?? "unchecked"]));
}
export const hasKey = keySet;
