// Outbound fetches to user-supplied URLs (image proxy, link import).
// Guards against SSRF: only http(s), only public addresses, redirects followed by hand
// with every hop re-checked, and the socket pinned to the address that passed the check.
import dns from "node:dns";
import net from "node:net";
import { Agent, fetch, type Response, type RequestInit } from "undici";

type LookupAddress = { address: string; family: number };
type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

const blocked = new net.BlockList();
for (const [net4, prefix] of [
  ["0.0.0.0", 8], // "this network" / unspecified
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const)
  blocked.addSubnet(net4, prefix, "ipv4");
for (const [net6, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["::", 96], // IPv4-compatible (deprecated)
  ["64:ff9b::", 96], // NAT64 well-known prefix
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard-only
  ["2001::", 23], // IETF protocol assignments (Teredo, ORCHID, ...)
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4 (embeds an arbitrary IPv4)
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const)
  blocked.addSubnet(net6, prefix, "ipv6");

/** If `ip` is an IPv4-mapped IPv6 address (::ffff:a.b.c.d), return the IPv4 part. */
function mappedIPv4(ip: string): string | null {
  const g = expandIPv6(ip).split(":");
  if (g.slice(0, 5).some((x) => x !== "0000") || g[5] !== "ffff") return null;
  const a = parseInt(g[6], 16), b = parseInt(g[7], 16);
  return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
}

function expandIPv6(ip: string): string {
  let s = ip.toLowerCase();
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, tail] = s.includes("::") ? s.split("::") : [s, undefined];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return groups.map((x) => x.padStart(4, "0")).join(":");
}

/** True if the address is anything other than a globally routable unicast address. */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return blocked.check(ip, "ipv4");
  if (family === 6) {
    const v4 = mappedIPv4(ip);
    if (v4) return blocked.check(v4, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return true; // not an IP at all
}

// ---- DNS (overridable for tests)
const systemLookup: LookupFn = (h) => dns.promises.lookup(h, { all: true, verbatim: true });
let lookupFn: LookupFn = systemLookup;
let allowedForTests = new Set<string>();

/** Test hook: replace DNS resolution and/or treat specific addresses as public. Call with no args to reset. */
export function _setTestOverrides(o: { lookup?: LookupFn; allow?: string[] } = {}) {
  lookupFn = o.lookup ?? systemLookup;
  allowedForTests = new Set(o.allow ?? []);
}

const isRefused = (ip: string) => !allowedForTests.has(ip) && isBlockedAddress(ip);

/** Resolve a hostname (or IP literal) and return its addresses, refusing if any is non-public. */
async function resolvePublic(hostname: string): Promise<LookupAddress[]> {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const family = net.isIP(host);
  const addrs = family ? [{ address: host, family }] : await lookupFn(host).catch(() => [] as LookupAddress[]);
  if (!addrs.length) throw new Error(`Could not resolve ${host}`);
  if (addrs.some((a) => isRefused(a.address))) throw new Error("Private addresses are not allowed");
  return addrs;
}

/** Parse and validate a user-supplied URL: http(s) only, and every address its host resolves to must be public. */
export async function assertPublicUrl(raw: string | URL): Promise<URL> {
  // WHATWG URL parsing normalises numeric hosts (2130706433, 0x7f.1, 0177.0.0.1, 127.1 → 127.0.0.1)
  // and IPv6 literals ([::ffff:127.0.0.1] → [::ffff:7f00:1]).
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs are supported");
  if (u.username || u.password) throw new Error("URLs with credentials are not supported");
  await resolvePublic(u.hostname);
  return u;
}

// The dispatcher re-resolves at connect time and connects only to addresses that pass the check,
// so a DNS answer that changes between assertPublicUrl and the connection cannot slip through.
const agent = new Agent({
  connect: {
    lookup(hostname: string, options: dns.LookupOptions, cb: (...args: any[]) => void) {
      resolvePublic(hostname).then(
        (addrs) => {
          const want = options?.family === 4 || options?.family === 6 ? addrs.filter((a) => a.family === options.family) : addrs;
          if (!want.length) return cb(Object.assign(new Error(`No IPv${options.family} address for ${hostname}`), { code: "ENOTFOUND" }));
          if (options?.all) cb(null, want);
          else cb(null, want[0].address, want[0].family);
        },
        (err) => cb(err),
      );
    },
  } as any,
});

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * GET a user-supplied URL safely. Redirects are followed manually (up to `maxRedirects`)
 * and each Location is re-validated. Returns the final response and the URL it came from.
 */
export async function safeFetch(
  raw: string | URL,
  init: { headers?: Record<string, string>; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<{ res: Response; url: URL }> {
  const signal = AbortSignal.timeout(init.timeoutMs ?? 15000);
  const maxRedirects = init.maxRedirects ?? 5;
  let url = await assertPublicUrl(raw);
  for (let hop = 0; ; hop++) {
    const opts: RequestInit = { method: "GET", headers: init.headers, redirect: "manual", signal, dispatcher: agent };
    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (e: any) {
      // surface the guard's message rather than undici's generic "fetch failed"
      throw new Error(e?.cause?.message || e?.message || "Fetch failed");
    }
    const loc = res.headers.get("location");
    if (!REDIRECTS.has(res.status) || !loc) return { res, url };
    await res.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw new Error("Too many redirects");
    url = await assertPublicUrl(new URL(loc, url));
  }
}
