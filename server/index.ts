import "./env";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { claudeShotList, claudePickClip } from "./shots";
import { claudeWriteFormat, claudeWriteScript, claudeListen } from "./formats";
import { speak, voiceAvailable } from "./voice";
import { resolveIcons } from "./icons";
import { claudeMotionScript } from "./mograph";
import { KITS } from "../src/mograph/icons";
import { licenseFreepikVideo, licensesToday, freepikVideoStatus, probeFreepikVideo } from "./freepikVideo";
import { runAgentTurn, claudeConfigured, resetConversation, claudeCheck, probeClaude } from "./agent";
import { listConnectors, searchVisuals, searchVideos, importFromUrl, magnificUpscale, reportStockUse, type Orientation } from "./connectors";
import { proxyVideo } from "./videoProxy";
import { accountsEnabled, migrate } from "./db";
import { loadSwitches, setSwitch, envOff, ALL_ROUTES } from "./aivideoSwitches";
import { storageOn, storageBucket } from "./storage";
import { loadLimits, setLimits, limits as videoLimits, report as videoReport, type Actor } from "./videoLedger";
import { toAac, aacAvailable } from "./aac";
import { generate as aiVideoGenerate, jobStatus as aiVideoStatus, aiVideoConfigured, aiVideoUsage, prices as aiVideoPrices, aiVideoProviders, aiVideoRoutes, aiVideoConnections, serveFile as aiVideoFile, serveInput as aiVideoInput, AiVideoError } from "./aivideo";
import { accountRoutes, requireUser, sameOrigin, takeAgentTurn, authCors } from "./accounts";
import { mailConfigured } from "./mailer";
import { safeFetch, readLimited, BlockedUrlError } from "./safeFetch";
import { transcribe, transcriptionProvider } from "./transcribe";

const here = path.dirname(fileURLToPath(import.meta.url));

// A stray rejected promise must not take the studio down for everyone; log it and keep serving.
process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));
/** The app bundle this server serves (lets CI confirm a deploy without signing in). */
const build = (() => {
  try {
    return fs.readFileSync(path.join(here, "..", "dist", "index.html"), "utf8").match(/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0];
  } catch {
    return undefined;
  }
})();

const app = express();
app.set("trust proxy", 1);

// Optional password gate for public deploys: set HOOKKY_PASSWORD and the whole app
// (pages and API) asks for it via the browser's sign-in prompt. Any username works.
// The health check stays open so the host can probe it.
// With accounts on (DATABASE_URL), sign-in replaces this shared password.
const accounts = accountsEnabled();
if (accounts) {
  await migrate();
  await loadSwitches().catch((e) => console.error("Couldn't read the AI video switches:", e.message));
  await loadLimits().catch((e) => console.error("Couldn't read the AI video limits:", e.message));
  if (!process.env.ADMIN_EMAILS?.trim()) console.warn("ADMIN_EMAILS is not set: nobody can approve new accounts. Set it to your email address.");
  if (!mailConfigured()) console.warn("BREVO_API_KEY is not set: account emails are printed to this log instead of sent.");
}
const password = process.env.HOOKKY_PASSWORD?.trim();
if (password && !accounts) {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  const expected = digest(password);
  app.use((req, res, next) => {
    if (req.path === "/api/health") return next();
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    const given = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString("utf8").split(":").slice(1).join(":") : "";
    if (given && timingSafeEqual(digest(given), expected)) return next();
    res.setHeader("WWW-Authenticate", 'Basic realm="Rookker", charset="UTF-8"');
    res.status(401).send("Sign in to use Rookker.");
  });
}

app.use(express.json({ limit: "40mb" }));
if (accounts) {
  app.use(authCors);
  app.use("/api", sameOrigin);
  app.use(requireUser);
  app.use(accountRoutes());
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

app.get("/api/health", (_req, res) => {
  void recheckClaude();
  res.json({ agent: claudeConfigured() ? "claude" : "local", claude: claudeCheck(), voice: voiceAvailable(), exportAac: aacAvailable(), aiVideo: aiVideoConfigured(), aiVideoProviders: aiVideoProviders(), storage: storageOn() ? "r2" : null, ...(freepikVideoStatus() && { freepikVideo: { ...freepikVideoStatus(), licensedToday: licensesToday() } }), transcription: transcriptionProvider(), connectors: listConnectors(), accounts, ...(build && { build }), ...(process.env.RENDER_GIT_COMMIT && { commit: process.env.RENDER_GIT_COMMIT }) });
});

app.post("/api/agent", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  // Keep-alive: proxies drop quiet connections, and Claude can think for a while before it speaks.
  const beat = setInterval(() => !res.writableEnded && res.write(": ping\n\n"), 15000);
  res.on("close", () => clearInterval(beat));
  try {
    if (req.user) {
      const turn = await takeAgentTurn(req.user);
      if (!turn.ok) {
        res.write(`data: ${JSON.stringify({ type: "error", message: `You've used today's ${turn.limit} agent turns. The limit resets at midnight UTC, or ask your admin for more.` })}\n\n`);
        res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        return void res.end();
      }
    }
    await runAgentTurn(req.body, res);
  } catch (e: any) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: "error", message: e?.message ?? String(e) })}\n\n`);
  }
  clearInterval(beat);
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  }
});

// The footage director's shot list (counts as an agent turn: it's one Claude call).
app.post("/api/shots", async (req, res) => {
  try {
    if (req.user) {
      const turn = await takeAgentTurn(req.user);
      if (!turn.ok) return void res.status(429).json({ error: `You've used today's ${turn.limit} agent turns.` });
    }
    const b = req.body ?? {};
    const shots = (Array.isArray(b.shots) ? b.shots : []).map((s: any) => ({ line: String(s?.line ?? ""), type: String(s?.type ?? "medium"), queries: Array.isArray(s?.queries) ? s.queries.map(String) : [] }));
    if (!shots.length) return void res.status(400).json({ error: "No shots to plan." });
    res.json({ shots: await claudeShotList({ shots, brief: String(b.brief ?? ""), aspect: String(b.aspect ?? "16:9"), look: String(b.look ?? "cinematic"), text: String(b.text ?? "subtitles") }) });
  } catch (e: any) {
    res.status(503).json({ error: e?.message ?? String(e) });
  }
});

// Claude writes a creative format from its draft (one agent turn).
app.post("/api/format", async (req, res) => {
  try {
    if (req.user) {
      const turn = await takeAgentTurn(req.user);
      if (!turn.ok) return void res.status(429).json({ error: `You've used today's ${turn.limit} agent turns.` });
    }
    const b = req.body ?? {};
    res.json(await claudeWriteFormat({ format: b.format ?? {}, brief: b.brief ?? {}, draft: b.draft ?? [] }));
  } catch (e: any) {
    res.status(503).json({ error: e?.message ?? String(e) });
  }
});

// Claude writes a voice-over script for a format (one agent turn).
app.post("/api/script", async (req, res) => {
  try {
    if (req.user) {
      const turn = await takeAgentTurn(req.user);
      if (!turn.ok) return void res.status(429).json({ error: `You've used today's ${turn.limit} agent turns.` });
    }
    const b = req.body ?? {};
    res.json({ script: await claudeWriteScript({ format: b.format ?? {}, brief: b.brief ?? {}, seconds: b.seconds }) });
  } catch (e: any) {
    res.status(503).json({ error: e?.message ?? String(e) });
  }
});

// Claude listens to the analysed audio: fills the brief and recommends formats (one agent turn).
app.post("/api/listen", async (req, res) => {
  try {
    if (req.user) {
      const turn = await takeAgentTurn(req.user);
      if (!turn.ok) return void res.status(429).json({ error: `You've used today's ${turn.limit} agent turns.` });
    }
    const b = req.body ?? {};
    res.json(await claudeListen({ transcript: String(b.transcript ?? ""), voice: b.voice, music: b.music, formats: b.formats ?? [] }));
  } catch (e: any) {
    res.status(503).json({ error: e?.message ?? String(e) });
  }
});

// Icons for a motion-graphics script: one kit, an icon per idea (Iconify web search, then local kits).
app.post("/api/icons/resolve", async (req, res) => {
  try {
    const b = req.body ?? {};
    const kit = KITS.some((k) => k.id === b.kit) ? b.kit : "lucide";
    if (!Array.isArray(b.ideas)) return void res.status(400).json({ error: "ideas must be a list." });
    const ideas = b.ideas.filter((x: unknown) => typeof x === "string" || typeof x === "number").map((x: unknown) => String(x).replace(/\s+/g, " ").trim().slice(0, 60)).filter(Boolean).slice(0, 40);
    res.json({ kit, icons: await resolveIcons(ideas, kit) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

// AI video: each generation costs money, so it's charged in credits against a daily allowance per
// person and a monthly budget for the app (see videoLedger.ts).
const aiActor = (req: express.Request): Actor => (req.user ? { who: `u:${req.user.id}`, userId: req.user.id, role: req.user.role, videoDailyCredits: req.user.video_daily_credits ?? null } : { who: "everyone" });
app.get("/api/aivideo/usage", async (req, res) => {
  try {
    const u = await aiVideoUsage(aiActor(req));
    res.json({ configured: aiVideoConfigured(), ...u, providers: aiVideoProviders(), routes: aiVideoRoutes(), storage: storageOn(), prices: aiVideoPrices() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});
app.post("/api/aivideo/generate", async (req, res) => {
  try {
    const origin = (process.env.APP_URL?.trim() || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const out = await aiVideoGenerate(req.body ?? {}, aiActor(req), origin);
    res.json({ ...out, ...(await aiVideoUsage(aiActor(req))) });
  } catch (e: any) {
    res.status(e instanceof AiVideoError ? e.status : 500).json({ error: e?.message ?? String(e) });
  }
});
// Admins switch video connections off and on for everyone (needs accounts; otherwise use AI_VIDEO_OFF).
app.get("/api/admin/aivideo", (req, res) => {
  if (!accounts || req.user?.role !== "admin") return void res.status(403).json({ error: "Admins only." });
  res.json({ connections: aiVideoConnections(), storage: { on: storageOn(), bucket: storageOn() ? storageBucket() : null }, limits: videoLimits() });
});
app.post("/api/admin/aivideo", async (req, res) => {
  if (!accounts || req.user?.role !== "admin") return void res.status(403).json({ error: "Admins only." });
  const { route, on } = req.body ?? {};
  if (!(ALL_ROUTES as string[]).includes(route) || typeof on !== "boolean") return void res.status(400).json({ error: "Say which connection and whether it's on." });
  if (on && envOff().has(route)) return void res.status(409).json({ error: `${route} is switched off in the server's environment (AI_VIDEO_OFF), so it can't be turned on here.` });
  try {
    await setSwitch(route, on);
    res.json({ connections: aiVideoConnections(), storage: { on: storageOn(), bucket: storageOn() ? storageBucket() : null }, limits: videoLimits() });
  } catch (e: any) {
    res.status(500).json({ error: `Couldn't save the switch (${e?.message ?? e}).` });
  }
});
app.get("/api/admin/aivideo/spend", async (req, res) => {
  if (!accounts || req.user?.role !== "admin") return void res.status(403).json({ error: "Admins only." });
  try {
    res.json({ report: await videoReport(), limits: videoLimits() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});
app.post("/api/admin/aivideo/limits", async (req, res) => {
  if (!accounts || req.user?.role !== "admin") return void res.status(403).json({ error: "Admins only." });
  const b = req.body ?? {};
  const read = (v: unknown, max: number) => (v === null || v === "" ? null : Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : undefined);
  const next: { dailyCredits?: number | null; monthlyBudgetUsd?: number | null } = {};
  if ("dailyCredits" in b) {
    const v = read(b.dailyCredits, 1_000_000);
    if (v === undefined) return void res.status(400).json({ error: "Daily credits must be a number from 0 to 1000000, or empty for no limit." });
    next.dailyCredits = v === null ? null : Math.floor(v);
  }
  if ("monthlyBudgetUsd" in b) {
    const v = read(b.monthlyBudgetUsd, 10_000_000);
    if (v === undefined) return void res.status(400).json({ error: "The monthly budget must be an amount in dollars, or empty for no budget." });
    next.monthlyBudgetUsd = v === null ? null : Math.round(v * 100) / 100;
  }
  try {
    await setLimits(next);
    res.json({ limits: videoLimits() });
  } catch (e: any) {
    res.status(500).json({ error: `Couldn't save the limits (${e?.message ?? e}).` });
  }
});
app.get("/api/aivideo/file", (req, res) => void aiVideoFile(req, res));
app.get("/api/aivideo/input/:token", aiVideoInput);
app.get("/api/aivideo/status", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.json(await aiVideoStatus(String(req.query.id ?? "")));
  } catch (e: any) {
    res.status(e instanceof AiVideoError ? e.status : 500).json({ error: e?.message ?? String(e) });
  }
});

// Exports: AAC for browsers that can only encode Opus (the body is the export's audio, Opus in MP4).
app.post("/api/export/aac", express.raw({ type: () => true, limit: "30mb" }), async (req, res) => {
  try {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return void res.status(400).json({ error: "Send the audio as the request body." });
    const aac = await toAac(body);
    res.setHeader("Content-Type", "audio/aac");
    res.setHeader("Cache-Control", "no-store");
    res.send(aac);
  } catch (e: any) {
    res.status(422).json({ error: e?.message ?? String(e) });
  }
});

// Claude designs the motion-graphics script from the studio's draft (one agent turn).
app.post("/api/mograph/plan", async (req, res) => {
  try {
    const b = req.body ?? {};
    // Check the request before spending a turn on it.
    if (!Array.isArray(b.draft) || !b.draft.length || b.draft.length > 40) return void res.status(400).json({ error: "Send a draft of 1–40 beats." });
    if (b.brief !== undefined && (typeof b.brief !== "object" || Array.isArray(b.brief))) return void res.status(400).json({ error: "The brief must be an object." });
    if (req.user) {
      const turn = await takeAgentTurn(req.user);
      if (!turn.ok) return void res.status(429).json({ error: `You've used today's ${turn.limit} agent turns.` });
    }
    res.json(await claudeMotionScript({ draft: b.draft, brief: b.brief ?? {}, style: b.style ?? {}, delivery: b.delivery }));
  } catch (e: any) {
    res.status(503).json({ error: e?.message ?? String(e) });
  }
});

// A voice-over from a script (counts as an agent turn: it's a paid call). Returns MP3.
app.post("/api/voice", async (req, res) => {
  try {
    if (req.user) {
      const turn = await takeAgentTurn(req.user);
      if (!turn.ok) return void res.status(429).json({ error: `You've used today's ${turn.limit} agent turns.` });
    }
    const b = req.body ?? {};
    const mp3 = await speak(String(b.text ?? ""), String(b.voice ?? "nova"), String(b.tone ?? "energetic"));
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(mp3);
  } catch (e: any) {
    res.status(e?.status ?? 502).json({ error: e?.message ?? String(e) });
  }
});

// Claude picks the best of a shot's candidate clips by looking at them (not counted as a turn: one small call).
app.post("/api/shots/pick", async (req, res) => {
  try {
    const b = req.body ?? {};
    const candidates = (Array.isArray(b.candidates) ? b.candidates : []).slice(0, 6).map((c: any) => ({ thumb: String(c?.thumb ?? ""), title: String(c?.title ?? "") }));
    res.json(await claudePickClip({ line: String(b.line ?? ""), shot: String(b.shot ?? ""), brief: String(b.brief ?? ""), candidates }));
  } catch (e: any) {
    res.status(503).json({ error: e?.message ?? String(e) });
  }
});

app.post("/api/agent/reset", (req, res) => {
  resetConversation(String(req.body?.conversationId ?? ""));
  res.json({ ok: true });
});

app.get("/api/search", async (req, res) => {
  try {
    const sources = req.query.sources ? String(req.query.sources).split(",").filter(Boolean) : undefined;
    const q = String(req.query.q ?? "");
    const count = Math.min(30, Math.max(1, Number(req.query.count ?? 18) || 18));
    if (req.query.type === "video") {
      const o = String(req.query.orientation ?? "");
      const minDur = Number(req.query.min) || undefined;
      return void res.json(await searchVideos(q, sources, count, ["landscape", "portrait", "square"].includes(o) ? (o as Orientation) : undefined, minDur && minDur > 0 && minDur < 60 ? minDur : undefined));
    }
    res.json(await searchVisuals(q, sources, count));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/import", async (req, res) => {
  try {
    res.json(await importFromUrl(String(req.body?.url ?? "")));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/enhance", async (req, res) => {
  try {
    res.json({ url: await magnificUpscale(String(req.body?.image ?? ""), req.body?.scale === "4x" ? "4x" : "2x") });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) throw new Error("No audio uploaded");
    res.json(await transcribe(req.file.buffer, req.file.mimetype || "audio/mpeg", req.file.originalname));
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Same-origin image proxy so remote references can be drawn on (and exported from) the canvas.
const cache = new Map<string, { type: string; body: Buffer }>();
app.get("/api/img", async (req, res) => {
  try {
    const raw = String(req.query.u ?? "");
    let hit = cache.get(raw);
    if (!hit) {
      const origin = (() => { try { return new URL(raw).origin; } catch { return ""; } })();
      const { res: r } = await safeFetch(raw, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Rookker/0.1)", ...(origin && { Referer: origin }) }, timeoutMs: 20000 });
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !/^image\/(png|jpe?g|webp|gif|avif)/i.test(type)) {
        await r.body?.cancel().catch(() => {});
        throw new Error(`Not an image (${r.status})`);
      }
      hit = { type, body: await readLimited(r, 15_000_000) };
      if (hit.body.length < 12_000_000) {
        cache.set(raw, hit);
        if (cache.size > 300) cache.delete(cache.keys().next().value!);
      }
    }
    res.setHeader("Content-Type", hit.type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(hit.body);
  } catch (e: any) {
    res.status(e instanceof BlockedUrlError ? 400 : 502).send(e.message);
  }
});

// Usage reports some stock sources require (Coverr): the browser says which clip went into a scene.
// License a stock clip the user has committed to (Freepik caps downloads at 100 a day, so only on demand).
app.post("/api/stock/license", async (req, res) => {
  try {
    const { source, id, maxEdge } = req.body ?? {};
    if (source !== "freepik") return void res.status(400).json({ error: "Only Freepik clips need licensing." });
    res.json({ ...(await licenseFreepikVideo(String(id ?? ""), Math.min(3840, Math.max(720, Number(maxEdge) || 1920)))), today: licensesToday() });
  } catch (e: any) {
    res.status(e?.status === 429 ? 429 : 502).json({ error: e?.message ?? String(e) });
  }
});

app.post("/api/stock/used", async (req, res) => {
  try {
    const ok = await reportStockUse(String(req.body?.source ?? ""), String(req.body?.id ?? ""));
    res.status(ok ? 204 : 400).end();
  } catch {
    res.status(502).end();
  }
});

// Same-origin stream for stock video, so clips can be drawn on (and exported from) the canvas.
app.get("/api/video", (req, res) => proxyVideo(req, res));

// API errors: a database outage gets a clear "try again" instead of a bare 500.
app.use("/api", (err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  // A malformed or oversized request body is the caller's mistake, not ours.
  if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "The request body isn't valid JSON." });
  if (err?.type === "entity.too.large") return void res.status(413).json({ error: "That request is too large." });
  const dbDown = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|terminat|Connection|too many clients|the database system/i.test(String(err?.message ?? err) + String(err?.code ?? ""));
  console.error(dbDown ? `Database unavailable: ${err?.message ?? err}` : err);
  res.status(dbDown ? 503 : 500).json({ error: dbDown ? "Rookker can't reach its database right now. Try again in a minute." : "Something went wrong on our side. Try again." });
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(here, "..", "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

// A key that failed may have been replaced in the meantime; look again at most every 5 minutes.
let lastRecheck = 0;
async function recheckClaude() {
  const state = claudeCheck().state;
  if (state === "ok" || state === "missing" || state === "unchecked" || Date.now() - lastRecheck < 300_000) return;
  lastRecheck = Date.now();
  await probeClaude();
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  if (process.env.NODE_ENV === "production" && !password && !accounts) console.warn("Neither DATABASE_URL (accounts) nor HOOKKY_PASSWORD is set: anyone with the URL can use this deploy and its API keys.");
  console.log(`Rookker API on http://localhost:${port}  ·  agent: ${claudeConfigured() ? "Claude" : "local director"}  ·  transcription: ${transcriptionProvider()}`);
  if (process.env.NODE_ENV !== "test") void probeFreepikVideo();
  if (claudeConfigured() && process.env.NODE_ENV !== "test") void probeClaude().then((c) => c === "ok" && console.log("Claude key check: ok"));
});
