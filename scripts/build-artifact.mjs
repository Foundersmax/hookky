// Packs the Vite build into one self-contained page for hosting as a claude.ai Artifact.
// Usage: npm run build:artifact  →  dist-artifact/hookky.html
import fs from "node:fs";
import path from "node:path";

const dist = "dist";
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.?\//, "")), "utf8");

const cssHrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
const jsSrcs = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]);
const fonts = html.match(/<link[^>]+href="https:\/\/fonts\.googleapis\.com[^"]+"[^>]*>/)?.[0] ?? "";
const extraChunks = fs.readdirSync(path.join(dist, "assets")).filter((f) => f.endsWith(".js") && !jsSrcs.some((s) => s.endsWith(f)));
if (extraChunks.length) throw new Error(`Code-split chunks can't be inlined: ${extraChunks.join(", ")}`);

const css = cssHrefs.map(read).join("\n");
// keep a literal "</script" inside the bundle from closing the inline tag
const js = jsSrcs.map(read).join("\n").replace(/<\/script/gi, "<\\/script");

const page = `<title>Rookker</title>
<meta name="description" content="Rookker turns briefs, references and voice-overs into minimal animated graphics for product ads and launches.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
fs.mkdirSync("dist-artifact", { recursive: true });
fs.writeFileSync("dist-artifact/hookky.html", page);
console.log(`dist-artifact/hookky.html  ${(page.length / 1024).toFixed(0)} KB`);
