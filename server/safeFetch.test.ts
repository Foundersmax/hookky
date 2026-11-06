// Run with: npm test
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import dns from "node:dns";
import { assertPublicUrl, isBlockedAddress, safeFetch, _setTestOverrides } from "./safeFetch";

// A stand-in "public" server. It listens on 127.0.0.2, and the tests tell the guard to treat
// exactly that address as public, so it plays the role of an internet host.
const FAKE_PUBLIC = "127.0.0.2";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a80000000049454e44ae426082", "hex");
let base = "";
const server = http.createServer((req, res) => {
  const u = new URL(req.url!, "http://x");
  if (u.pathname === "/img.png") return res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
  if (u.pathname === "/redirect") return res.writeHead(302, { Location: u.searchParams.get("to")! }).end();
  if (u.pathname === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
  res.writeHead(404).end();
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, FAKE_PUBLIC, r));
  base = `http://public.test:${(server.address() as AddressInfo).port}`;
});
after(() => {
  _setTestOverrides();
  server.close();
});

const dnsTable: Record<string, string[]> = {
  "public.test": [FAKE_PUBLIC],
  "intranet.test": ["10.0.0.1"],
  "mixed.test": [FAKE_PUBLIC, "192.168.1.5"],
  "metadata.test": ["169.254.169.254"],
  "v6local.test": ["fd00::1"],
};
const mockLookup = async (h: string) => {
  const ips = dnsTable[h];
  if (!ips) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};
const withMocks = () => _setTestOverrides({ lookup: mockLookup, allow: [FAKE_PUBLIC] });

const refused = (p: Promise<unknown>) => assert.rejects(p, /Private addresses are not allowed/);

test("address classification", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:7f00:1::"])
    assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) assert.equal(isBlockedAddress(ip), false, ip);
});

test("refuses loopback, private and numeric-trick literals", async () => {
  withMocks();
  for (const u of ["http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://127.1/",
    "http://[::ffff:127.0.0.1]/", "http://[fe80::1]/", "http://[fd00::1]/", "http://169.254.169.254/latest/meta-data/", "http://0.0.0.0/"])
    await refused(assertPublicUrl(u));
  await assert.rejects(assertPublicUrl("file:///etc/passwd"), /Only http/);
  await assert.rejects(assertPublicUrl("gopher://example.com/"), /Only http/);
});

test("refuses hostnames that resolve to private addresses (mocked DNS)", async () => {
  withMocks();
  await refused(assertPublicUrl("http://intranet.test/"));
  await refused(assertPublicUrl("http://mixed.test/")); // any bad address is enough
  await refused(assertPublicUrl("http://metadata.test/"));
  await refused(assertPublicUrl("http://v6local.test/"));
  await refused(safeFetch("http://intranet.test/img.png"));
});

test("system DNS: localhost is refused", async () => {
  _setTestOverrides({ allow: [] });
  await refused(assertPublicUrl("http://localhost/"));
});

test("fetches a public image", async () => {
  withMocks();
  const { res, url } = await safeFetch(`${base}/img.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG);
  assert.equal(url.pathname, "/img.png");
});

test("follows a public→public redirect and reports the final URL", async () => {
  withMocks();
  const { res, url } = await safeFetch(`${base}/redirect?to=${encodeURIComponent("/img.png")}`);
  assert.equal(res.status, 200);
  assert.equal(url.pathname, "/img.png");
});

test("refuses a public URL that redirects to an internal address", async () => {
  withMocks();
  for (const to of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://intranet.test/"])
    await refused(safeFetch(`${base}/redirect?to=${encodeURIComponent(to)}`));
  await assert.rejects(safeFetch(`${base}/redirect?to=${encodeURIComponent("file:///etc/passwd")}`), /Only http/);
});

test("caps redirect chains", async () => {
  withMocks();
  await assert.rejects(safeFetch(`${base}/loop`), /Too many redirects/);
});

test("connection is pinned: DNS rebinding after the check is refused", async () => {
  // First answer (the pre-check) is public; every later answer (at connect time) is the metadata IP.
  let calls = 0;
  _setTestOverrides({
    allow: [FAKE_PUBLIC],
    lookup: async () => [{ address: calls++ === 0 ? FAKE_PUBLIC : "169.254.169.254", family: 4 }],
  });
  const port = (server.address() as AddressInfo).port;
  await refused(safeFetch(`http://rebind.test:${port}/img.png`));
  assert.ok(calls >= 2, "connect-time lookup should run");
});

// Real internet check; skipped where the sandbox has no direct DNS/network.
test("real public image URL loads", async (t) => {
  _setTestOverrides();
  const url = "https://upload.wikimedia.org/wikipedia/commons/7/70/Example.png";
  const ok = await dns.promises.lookup("upload.wikimedia.org").then(() => true, () => false);
  if (!ok) return t.skip("no direct DNS in this environment");
  const { res } = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Hookky/0.1)" }, timeoutMs: 20000 });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /^image\//);
});
