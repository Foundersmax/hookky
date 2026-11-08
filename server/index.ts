import "./env";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { claudeShotList, claudePickClip } from "./shots";
import { licenseFreepikVideo, licensesToday, freepikVideoStatus, probeFreepikVideo } from "./freepikVideo";
import { runAgentTurn, claudeConfigured, resetConversation, claudeCheck, probeClaude } from "./agent";
import { listConnectors, searchVisuals, searchVideos, importFromUrl, magnificUpscale, reportStockUse, type Orientation } from "./connectors";
import { proxyVideo } from "./videoProxy";
import { accountsEnabled, migrate } from "./db";
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
    res.setHeader("WWW-Authenticate", 'Basic realm="Hookky", charset="UTF-8"');
    res.status(401).send("Sign in to use Hookky.");
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
  res.json({ agent: claudeConfigured() ? "claude" : "local", claude: claudeCheck(), ...(freepikVideoStatus() && { freepikVideo: { ...freepikVideoStatus(), licensedToday: licensesToday() } }), transcription: transcriptionProvider(), connectors: listConnectors(), accounts, ...(build && { build }), ...(process.env.RENDER_GIT_COMMIT && { commit: process.env.RENDER_GIT_COMMIT }) });
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
      const { res: r } = await safeFetch(raw, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Hookky/0.1)", ...(origin && { Referer: origin }) }, timeoutMs: 20000 });
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
  const dbDown = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|terminat|Connection|too many clients|the database system/i.test(String(err?.message ?? err) + String(err?.code ?? ""));
  console.error(dbDown ? `Database unavailable: ${err?.message ?? err}` : err);
  res.status(dbDown ? 503 : 500).json({ error: dbDown ? "Hookky can't reach its database right now. Try again in a minute." : "Something went wrong on our side. Try again." });
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
  console.log(`Hookky API on http://localhost:${port}  ·  agent: ${claudeConfigured() ? "Claude" : "local director"}  ·  transcription: ${transcriptionProvider()}`);
  if (process.env.NODE_ENV !== "test") void probeFreepikVideo();
  if (claudeConfigured() && process.env.NODE_ENV !== "test") void probeClaude().then((c) => c === "ok" && console.log("Claude key check: ok"));
});
