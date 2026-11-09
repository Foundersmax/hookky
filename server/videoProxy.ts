// Streams stock video from the stock sources' CDNs to the browser, same-origin, so clips can be
// drawn on the canvas and exported. Range requests pass through so the browser can seek.
import type { Request, Response } from "express";
import { Readable } from "node:stream";
import { safeFetch, BlockedUrlError } from "./safeFetch";
import { videoHostAllowed } from "./connectors";

type Fetcher = (url: string, init: { headers?: Record<string, string>; timeoutMs?: number }) => Promise<{ res: Awaited<ReturnType<typeof safeFetch>>["res"] }>;

export async function proxyVideo(req: Request, res: Response, fetcher: Fetcher = safeFetch) {
  const raw = String(req.query.u ?? "");
  if (!videoHostAllowed(raw)) return void res.status(400).send("Only clips from the connected stock video sources can be streamed.");
  const range = typeof req.headers.range === "string" && /^bytes=\d*-\d*$/.test(req.headers.range) ? req.headers.range : undefined;
  try {
    const { res: r } = await fetcher(raw, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Rookker/0.1)", ...(range && { Range: range }) }, timeoutMs: 300_000 });
    let type = (r.headers.get("content-type") || "").toLowerCase();
    if (type.startsWith("application/octet-stream") || type.startsWith("binary/octet-stream")) type = /\.webm(\?|$)/i.test(raw) ? "video/webm" : "video/mp4";
    if (!(r.status === 200 || r.status === 206) || !/^video\/(mp4|webm|quicktime)/.test(type) || !r.body) {
      await r.body?.cancel().catch(() => {});
      return void res.status(502).send(`Not a video (${r.status})`);
    }
    res.status(r.status);
    res.setHeader("Content-Type", type);
    for (const h of ["content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const body = Readable.fromWeb(r.body as any);
    res.on("close", () => body.destroy());
    body.on("error", () => res.destroy());
    body.pipe(res);
  } catch (e: any) {
    if (!res.headersSent) res.status(e instanceof BlockedUrlError ? 400 : 502).send(e.message);
  }
}
