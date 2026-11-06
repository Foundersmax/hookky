import "./env";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { runAgentTurn, claudeConfigured, resetConversation } from "./agent";
import { listConnectors, searchVisuals, importFromUrl, magnificUpscale } from "./connectors";
import { assertPublicUrl, safeFetch } from "./safeFetch";
import { transcribe, transcriptionProvider } from "./transcribe";

const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.set("trust proxy", 1);

// Optional password gate for public deploys: set HOOKKY_PASSWORD and the whole app
// (pages and API) asks for it via the browser's sign-in prompt. Any username works.
// The health check stays open so the host can probe it.
const password = process.env.HOOKKY_PASSWORD?.trim();
if (password) {
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
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

app.get("/api/health", (_req, res) => {
  res.json({ agent: claudeConfigured() ? "claude" : "local", transcription: transcriptionProvider(), connectors: listConnectors() });
});

app.post("/api/agent", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  try {
    await runAgentTurn(req.body, res);
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ type: "error", message: e?.message ?? String(e) })}\n\n`);
  }
  res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  res.end();
});

app.post("/api/agent/reset", (req, res) => {
  resetConversation(String(req.body?.conversationId ?? ""));
  res.json({ ok: true });
});

app.get("/api/search", async (req, res) => {
  try {
    const sources = req.query.sources ? String(req.query.sources).split(",").filter(Boolean) : undefined;
    res.json(await searchVisuals(String(req.query.q ?? ""), sources, Number(req.query.count ?? 18)));
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
    const u = await assertPublicUrl(String(req.query.u ?? ""));
    let hit = cache.get(u.href);
    if (!hit) {
      const { res: r } = await safeFetch(u, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Hookky/0.1)", Referer: u.origin }, timeoutMs: 20000 });
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !type.startsWith("image/")) throw new Error(`Not an image (${r.status})`);
      hit = { type, body: Buffer.from(await r.arrayBuffer()) };
      if (hit.body.length < 12_000_000) {
        cache.set(u.href, hit);
        if (cache.size > 300) cache.delete(cache.keys().next().value!);
      }
    }
    res.setHeader("Content-Type", hit.type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.end(hit.body);
  } catch (e: any) {
    res.status(502).send(e.message);
  }
});

if (process.env.NODE_ENV === "production") {
  const dist = path.join(here, "..", "dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  if (process.env.NODE_ENV === "production" && !password) console.warn("HOOKKY_PASSWORD is not set: anyone with the URL can use this deploy and its API keys.");
  console.log(`Hookky API on http://localhost:${port}  ·  agent: ${claudeConfigured() ? "Claude" : "local director"}  ·  transcription: ${transcriptionProvider()}`);
});
