import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { parseIcon, cleanIcon } from "../src/mograph/icons";
import { localSearch, resolveIcons, iconSpec } from "./icons";

const require = createRequire(import.meta.url);

test("icons: Iconify bodies become drawable parts (line and solid kits)", () => {
  const lucide = require("@iconify-json/lucide/icons.json");
  const moon = parseIcon(lucide.icons["moon"].body)!;
  assert.equal(moon.kind, "line");
  assert.equal(moon.parts[0].stroke, true);
  assert.equal(moon.parts[0].sw, 2);
  const ph = require("@iconify-json/ph/icons.json");
  const pm = parseIcon(ph.icons["moon-light"].body, 256, 256)!;
  assert.equal(pm.kind, "solid");
  assert.deepEqual([pm.w, pm.h], [256, 256]);
  // every icon in the line kits parses
  for (const kit of ["lucide", "tabler", "iconoir"]) {
    const set = require(`@iconify-json/${kit}/icons.json`);
    const names = Object.keys(set.icons);
    const bad = names.filter((n) => !parseIcon(set.icons[n].body, set.icons[n].width ?? set.width, set.icons[n].height ?? set.height));
    assert.ok(bad.length / names.length < 0.01, `${kit}: ${bad.length} of ${names.length} unparsable (${bad.slice(0, 5)})`);
  }
});

test("icons: shapes, groups and hidden content", () => {
  const ic = parseIcon('<g fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><rect x="2" y="2" width="8" height="6" rx="2"/><polyline points="1 1 5 5 9 1"/><line x1="0" y1="0" x2="4" y2="4"/></g><mask id="m"><path d="M0 0h24v24H0z" fill="#fff"/></mask>')!;
  assert.equal(ic.parts.length, 4, "the mask's content isn't drawn");
  assert.ok(ic.parts.every((p) => p.stroke && !p.fill && p.sw === 2));
  assert.match(ic.parts[0].d, /^M2 12a10 10/);
  assert.equal(parseIcon("<title>x</title>"), null);
  assert.equal(cleanIcon({ parts: [{ d: "M0 0<script>" }] }), undefined);
  assert.equal(cleanIcon({ w: 24, h: 24, parts: [{ d: "M0 0L4 4", stroke: true, sw: 2 }] })?.parts.length, 1);
});

test("icons: ideas find fitting icons inside one kit", () => {
  assert.equal(localSearch("moon", "lucide")[0], "lucide:moon");
  assert.ok(localSearch("sleep", "lucide").some((n) => /moon|bed/.test(n)), localSearch("sleep", "lucide").join());
  assert.ok(localSearch("fast charging", "lucide").some((n) => /zap|battery-charging|plug-zap/.test(n)));
  assert.ok(localSearch("money", "tabler").every((n) => n.startsWith("tabler:")));
  assert.ok(localSearch("heart", "ph").every((n) => n.endsWith("-light")), localSearch("heart", "ph").join());
});

test("icons: resolving a script's ideas gives distinct icons with specs (offline)", async () => {
  const r = await resolveIcons(["sleep", "battery", "coffee", "sleep", "zzqxv"], "lucide");
  assert.equal(r.length, 5);
  assert.ok(r[0].spec && r[1].spec && r[2].spec);
  assert.notEqual(r[0].name, r[3].name, "the same idea twice gets a second icon");
  assert.equal(r[4].name, null);
  assert.ok((await iconSpec("tabler:bolt"))?.parts.length);
});
