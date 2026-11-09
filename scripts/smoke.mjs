// Runs the engine smoke test (smoke.html) in headless Chromium via the Vite dev server.
// Usage: npm run test:engine   (needs the "playwright" dev dependency and a Chromium for it)
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5199;
const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
const stop = () => vite.kill("SIGTERM");
process.on("exit", stop);

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("Vite didn't start in 30s")), 30000);
  vite.stdout.on("data", (d) => String(d).includes("Local") && (clearTimeout(t), resolve()));
});

const browser = await chromium.launch();
let code = 0;
try {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  // A cold dev server compiles the whole engine on first load; give it time on slow CI machines.
  await page.goto(`http://localhost:${port}/smoke.html`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.__smoke, null, { timeout: 180000 });
  const r = await page.evaluate(() => window.__smoke);
  console.log(`Engine smoke test: ${r.frames} frames rendered, ${r.failureCount} failure(s).`);
  for (const f of [...pageErrors.map((e) => `page error: ${e}`), ...r.failures]) console.log("  ✗ " + f);
  code = r.failureCount || pageErrors.length || r.frames === 0 ? 1 : 0;
} finally {
  await browser.close();
  stop();
}
process.exit(code);
