// Fetching URLs that users (or the agent) supply, without letting them reach the server's
// own network: loopback, private ranges, link-local/cloud metadata, and other reserved space.
//
// - Literal IPs are checked before connecting.
// - Hostnames are checked inside the connection's DNS lookup, so the address that passed the
//   check is the one the socket connects to (no gap for DNS rebinding).
// - Redirects are followed by hand, re-checking every hop.
// - Bodies are read with a byte cap.
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch, type Response } from "undici";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(addr, prefix, "ipv6");

/** True when an IP address must not be fetched from. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped / -compatible IPv6 (::ffff:a.b.c.d, ::ffff:7f00:1): judge the embedded IPv4 address
    const mapped = lower.match(/^::(?:ffff:(?:0:)?)?((?:\d{1,3}\.){3}\d{1,3})$/)?.[1] ?? hexMapped(lower);
    if (mapped) return isBlockedAddress(mapped);
    return blocked.check(ip, "ipv6");
  }
  return blocked.check(ip, "ipv4");
}

function hexMapped(ip: string) {
  const m = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!m) return;
  const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;
const systemLookup: LookupAll = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

export interface SafeFetchDeps {
  lookup?: LookupAll;
  isBlocked?: (ip: string) => boolean;
}

/** Parse and screen a URL before any network activity. Throws BlockedUrlError. */
export function checkUrl(raw: string | URL, isBlocked = isBlockedAddress): URL {
  let u: URL;
  try {
    u = new URL(String(raw)); // WHATWG parsing also normalises 2130706433 / 0x7f.1 to dotted IPv4
  } catch {
    throw new BlockedUrlError("That isn't a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError("Only http and https links are supported.");
  if (u.username || u.password) throw new BlockedUrlError("Links with embedded credentials aren't supported.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isBlocked(host)) throw new BlockedUrlError("That address points to a private network.");
  if (/^localhost$|\.localhost$|\.local$|\.internal$|\.home\.arpa$/i.test(host)) throw new BlockedUrlError("That address points to a private network.");
  return u;
}

function makeAgent(deps: Required<SafeFetchDeps>) {
  return new Agent({
    connect: {
      // Runs for every hostname connection: resolve, refuse if ANY address is private, connect to a checked one.
      lookup(hostname: string, options: any, callback: (...args: any[]) => void) {
        deps
          .lookup(hostname)
          .then((addrs) => {
            if (!addrs.length) throw Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" });
            const bad = addrs.find((a) => deps.isBlocked(a.address));
            if (bad) throw new BlockedUrlError("That address points to a private network.");
            if (options?.all) callback(null, addrs);
            else callback(null, addrs[0].address, addrs[0].family);
          })
          .catch((e) => callback(e));
      },
    },
  });
}

const defaultAgent = makeAgent({ lookup: systemLookup, isBlocked: isBlockedAddress });

export interface SafeFetchResult {
  res: Response;
  url: URL; // final URL after redirects
}

/** GET a user-supplied URL safely. Throws BlockedUrlError for refused targets. */
export async function safeFetch(
  raw: string | URL,
  init: { headers?: Record<string, string>; timeoutMs?: number; maxRedirects?: number } = {},
  deps: SafeFetchDeps = {},
): Promise<SafeFetchResult> {
  const d = { lookup: deps.lookup ?? systemLookup, isBlocked: deps.isBlocked ?? isBlockedAddress };
  const dispatcher = deps.lookup || deps.isBlocked ? makeAgent(d) : defaultAgent;
  const signal = AbortSignal.timeout(init.timeoutMs ?? 15000);
  let url = checkUrl(raw, d.isBlocked);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: init.headers, redirect: "manual", signal, dispatcher });
    } catch (e: any) {
      const cause = e?.cause ?? e;
      if (cause instanceof BlockedUrlError) throw cause;
      throw new Error(`Couldn't reach ${url.hostname}${cause?.code ? ` (${cause.code})` : ""}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      if (hop >= (init.maxRedirects ?? 5)) throw new Error("Too many redirects.");
      url = checkUrl(new URL(res.headers.get("location")!, url), d.isBlocked);
      continue;
    }
    return { res, url };
  }
}

/** Read a response body, refusing anything over maxBytes. */
export async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error("The file is too large.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body ?? []) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new Error("The file is too large.");
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
