// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { isBlockedAddress, checkUrl, safeFetch, readLimited, BlockedUrlError } from "./safeFetch";

test("blocks private, loopback, link-local and reserved addresses", () => {
  for (const ip of [
    "127.0.0.1", "127.8.8.8", "10.0.0.1", "172.16.5.4", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::a00:1", "2002:7f00:1::",
  ]) assert.equal(isBlockedAddress(ip), true, ip);
});

test("allows public addresses", () => {
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])
    assert.equal(isBlockedAddress(ip), false, ip);
});

test("refuses private literals, numeric tricks, other schemes and credentials before connecting", () => {
  for (const url of [
    "http://127.0.0.1/", "http://[::1]/", "http://2130706433/", "http://0x7f.0.0.1/", "http://0177.0.0.1/", "http://127.1/",
    "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data/", "http://localhost:8787/api/health",
    "http://printer.local/", "http://db.internal/", "file:///etc/passwd", "ftp://example.com/", "http://user:pw@example.com/", "not a url",
  ]) assert.throws(() => checkUrl(url), BlockedUrlError, url);
  assert.equal(checkUrl("https://example.com/a.png").hostname, "example.com");
});

test("refuses a public-looking hostname that resolves to a private address", async () => {
  const lookup = async () => [{ address: "10.0.0.1", family: 4 }];
  await assert.rejects(safeFetch("http://sneaky.example/", {}, { lookup }), BlockedUrlError);
});

test("refuses a hostname if any of its addresses is private", async () => {
  const lookup = async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }];
  await assert.rejects(safeFetch("http://mixed.example/", {}, { lookup }), BlockedUrlError);
});

// A local server plays the "public" site: treat 127.0.0.1 as public for these tests only.
async function withServer(fn: (port: number) => Promise<void>) {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const server = http.createServer((req, res) => {
    const port = (server.address() as AddressInfo).port;
    if (req.url === "/img") return res.writeHead(200, { "Content-Type": "image/png" }).end(png);
    if (req.url === "/to-metadata") return res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
    if (req.url === "/to-name") return res.writeHead(301, { Location: "http://internal-name.example/secret" }).end();
    if (req.url === "/to-img") return res.writeHead(307, { Location: `http://public.example:${port}/img` }).end();
    if (req.url === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
    if (req.url === "/big") return res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.alloc(2048));
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn((server.address() as AddressInfo).port);
  } finally {
    server.close();
  }
}
const testDeps = {
  lookup: async (host: string) =>
    host === "public.example" ? [{ address: "127.0.0.1", family: 4 }] : host === "internal-name.example" ? [{ address: "10.9.8.7", family: 4 }] : [],
  isBlocked: (ip: string) => ip !== "127.0.0.1" && isBlockedAddress(ip),
};

test("loads a normal image and follows a safe redirect", () =>
  withServer(async (port) => {
    const direct = await safeFetch(`http://public.example:${port}/img`, {}, testDeps);
    assert.equal(direct.res.status, 200);
    assert.equal((await readLimited(direct.res, 1000)).subarray(0, 4).toString("hex"), "89504e47");
    const viaRedirect = await safeFetch(`http://public.example:${port}/to-img`, {}, testDeps);
    assert.equal(viaRedirect.res.status, 200);
    assert.equal(viaRedirect.url.pathname, "/img");
    await viaRedirect.res.body?.cancel();
  }));

test("refuses redirects into private space (literal IP or private-resolving name)", () =>
  withServer(async (port) => {
    await assert.rejects(safeFetch(`http://public.example:${port}/to-metadata`, {}, testDeps), BlockedUrlError);
    await assert.rejects(safeFetch(`http://public.example:${port}/to-name`, {}, testDeps), BlockedUrlError);
  }));

test("stops redirect loops and oversized bodies", () =>
  withServer(async (port) => {
    await assert.rejects(safeFetch(`http://public.example:${port}/loop`, {}, testDeps), /Too many redirects/);
    const { res } = await safeFetch(`http://public.example:${port}/big`, {}, testDeps);
    await assert.rejects(readLimited(res, 1024), /too large/);
  }));
