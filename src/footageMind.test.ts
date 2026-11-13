import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirection, topicOf, phrasesOf, planFilm } from "./footage/mind";
import { scoreClip, castShot, subjectMatch, assemble, type Shot } from "./footage/plan";
import { sanitizeScene } from "./sanitize";
import { pexelsTitle } from "../server/connectors";

function voice(lines: string[]) {
  const words: { w: string; s: number; e: number }[] = [], pauses: { s: number; e: number }[] = [];
  let t = 0.3;
  lines.forEach((l, i) => {
    for (const w of l.split(" ")) words.push({ w, s: +t.toFixed(2), e: +(t + 0.3).toFixed(2) }), (t += 0.34);
    if (i < lines.length - 1) pauses.push({ s: +t.toFixed(2), e: +(t + 0.9).toFixed(2) }), (t += 0.9);
  });
  return { duration: +(t + 0.3).toFixed(2), pauses, words };
}
const COFFEE = voice([
  "Coffee began in the highlands of Ethiopia.",
  "Legend says a goat herder noticed his animals dancing after eating red berries.",
  "From there, the beans travelled across the Red Sea to Yemen.",
  "By the sixteenth century, coffee houses filled the streets of Istanbul.",
  "And that changed everything.",
  "Today, more than two billion cups of coffee are poured every single day.",
]);
const REEF = voice([
  "The Great Barrier Reef stretches for more than two thousand kilometres along the coast of Australia.",
  "It is home to thousands of species of fish, turtles and sharks.",
  "But rising ocean temperatures are bleaching the coral white.",
  "Scientists are racing to save it.",
]);

test("direction: style, feel, what to cast, what to keep out, and subjects are read from plain words", () => {
  const d = parseDirection("Cinematic aerial drone shots, moody, no people or faces, some black and white photos for the history parts");
  assert.deepEqual(d.styles, ["aerial drone", "black and white"]);
  assert.deepEqual(d.moods, ["cinematic", "moody"]);
  assert.deepEqual(d.avoid, ["people", "face"]);
  assert.equal(d.media, "any", "shots and photos: both");
  assert.deepEqual(d.subjects, [], "'the history parts' isn't something to search for");
  const t = parseDirection("I want real documentary footage of Tokyo street food at night, handheld, without text or logos");
  assert.deepEqual(t.subjects, ["tokyo street food"]);
  assert.deepEqual(t.styles, ["night", "handheld"]);
  assert.deepEqual(t.avoid, ["text", "logo"]);
  assert.equal(t.media, "video");
  assert.equal(parseDirection("old photographs only").media, "photo");
  assert.equal(parseDirection("").media, undefined);
  assert.deepEqual(parseDirection("slow-mo and timelapse, golden hour").styles, ["slow motion", "time lapse", "golden hour"]);
  assert.deepEqual(parseDirection("no animals").avoid, ["animal"]);
});

test("topic: named places and the word a voice-over keeps saying", () => {
  const t = topicOf(COFFEE.words.map((w) => w.w).join(" "));
  assert.deepEqual(t.entities.slice().sort(), ["ethiopia", "istanbul", "red sea", "yemen"]);
  assert.equal(t.main, "coffee", "said most, so it's what the film is about");
  const r = topicOf(REEF.words.map((w) => w.w).join(" "), ["barrier reef"]);
  assert.equal(r.main, "great barrier reef", "the brief's subject, by the name the voice-over uses");
  assert.equal(topicOf("In 1969 Apollo landed on the Moon. Apollo changed space travel.").era, "1969");
  assert.ok(!topicOf("Meet Orbit. Orbit keeps time.", [], ["Orbit"]).entities.length, "the brand isn't a subject");
});

test("phrases: what a line is talking about, without the verbs of narration", () => {
  const topic = topicOf(COFFEE.words.map((w) => w.w).join(" "));
  const p = (l: string) => phrasesOf(l, topic).map((x) => x.text);
  assert.deepEqual(p("By the sixteenth century, coffee houses filled the streets of Istanbul.").slice(0, 2), ["coffee houses", "istanbul"]);
  assert.equal(phrasesOf("The Barrier Reef is vast.", { entities: ["great barrier reef"], terms: [] })[0].text, "great barrier reef", "part of a name is the whole name");
  assert.deepEqual(p("From there, the beans travelled across the Red Sea to Yemen.").slice(0, 2).sort(), ["red sea", "yemen"]);
  assert.ok(!p("And that changed everything.").some((x) => phrasesOf("And that changed everything.", topic).find((y) => y.text === x)!.score >= 1), "nothing to film in it");
  assert.ok(!p("No more waiting in line, stress less.").join(" ").match(/waiting|stress/));
});

test("documentary plan: every shot searches the subject of its line, in the film's world, never filler", () => {
  const { shots } = planFilm(REEF, "The Great Barrier Reef", { genre: "documentary", text: "subtitles" });
  const by = (re: RegExp) => shots.find((s) => re.test(s.line))!;
  assert.match(by(/stretches/).queries[0], /great barrier reef/);
  assert.equal(by(/stretches/).type, "establishing");
  assert.deepEqual(by(/turtles/).queries.slice(0, 2), ["turtles great barrier reef", "turtles"], "the specific search, then one a small library can answer");
  assert.ok(by(/turtles/).queries.some((q) => q.includes("sharks")));
  assert.deepEqual(by(/turtles/).must, ["turtles", "sharks"]);
  assert.ok(by(/Scientists/).queries[0].startsWith("scientists"));
  assert.ok(shots.every((s) => s.media === "any"), "a documentary may use photographs");
  assert.ok(shots.slice(1).every((s) => s.breath), "each sentence after a long pause is a new thought");
  const all = shots.flatMap((s) => s.queries).join(" | ");
  assert.ok(!/lifestyle|city sunrise|abstract light/.test(all), all);
  assert.ok(shots.every((s) => s.type !== "product" && s.type !== "abstract"));
  assert.ok(shots.every((s) => s.e - s.s >= 2.5), "documentary shots breathe");
});

test("a line with nothing to film stays on the subject; the description shapes every shot", () => {
  const { shots, direction } = planFilm(COFFEE, "", { genre: "documentary", text: "subtitles", direction: "aerial drone shots, moody, no people, black and white photos for the old parts" });
  const changed = shots.find((s) => /changed everything/.test(s.line))!;
  assert.ok(changed.queries.some((q) => /coffee|cups/.test(q)), changed.queries.join(" | "));
  assert.ok(!changed.queries.some((q) => /\bchanged\b|\btwo\b/.test(q)), changed.queries.join(" | "));
  assert.deepEqual(direction.avoid, ["people"]);
  assert.ok(shots.every((s) => s.avoid?.includes("people")));
  assert.ok(shots.every((s) => s.type !== "people"));
  assert.ok(shots.some((s) => s.queries.some((q) => q.endsWith("aerial drone"))) && shots.some((s) => s.queries.some((q) => q.endsWith("black and white"))), "styles rotate through the searches");
  assert.ok(shots.every((s) => s.style?.includes("moody")));
  assert.match(shots[0].queries[0], /ethiopia/);
  assert.equal(shots.find((s) => /Istanbul/.test(s.line))!.queries[0], "coffee houses istanbul", "the subject, where the line places it");
  const sea = shots.find((s) => /Red Sea/.test(s.line))!;
  assert.equal(sea.queries[0], "red sea", "a named place is searched by its own name");
  assert.ok(shots.every((s) => s.queries.every((q) => q.split(" ").length <= 6 && new Set(q.split(" ")).size === q.split(" ").length)), "short searches, no word twice");
});

test("ads keep their crafted pictures and audience; the description adds its style", () => {
  const VO = voice(["Every morning starts too fast.", "Your phone buzzes, your coffee goes cold.", "Meet Orbit, the smartwatch that keeps time for you.", "Sleep better, run further, stress less."]);
  const { shots } = planFilm(VO, "Orbit, a smartwatch for runners", { genre: "ad", text: "subtitles", brand: "Orbit", direction: "slow motion" });
  assert.ok(shots.find((s) => /coffee/.test(s.line))!.queries.slice(0, 2).some((q) => /coffee pouring/.test(q)));
  assert.ok(shots.every((s) => s.queries[1]?.endsWith("slow motion")), JSON.stringify(shots.map((s) => s.queries)));
  assert.ok(!shots.some((s) => s.queries.some((q) => /orbit|stress/.test(q))));
  assert.ok(shots.every((s) => s.media === "video" && !s.breath));
  assert.ok(shots.some((s) => s.type === "product"));
});

test("casting: a clip that shows the subject beats a prettier one that doesn't; what's unwanted sinks", () => {
  const shot: Shot = { s: 0, e: 4, line: "", type: "medium", overlay: "", queries: ["turtles great barrier reef", "turtles"], must: ["turtles", "sharks"], avoid: ["people"], style: ["aerial drone"], media: "any" };
  const c = (id: string, title: string, extra: object = {}) => ({ id, title, w: 1920, h: 1080, duration: 12, source: "pexels", kind: "video" as const, rank: 0, q: 0, ...extra });
  const turtle = c("t", "Green sea turtle swimming over coral reef", { rank: 4 });
  const generic = c("g", "Beautiful ocean waves at sunset 4k", { rank: 0 });
  const diver = c("d", "Woman diver photographing turtles underwater", { rank: 0 });
  const echo = c("e", "turtles great barrier reef", { rank: 1 });
  const photo = c("p", "Sea turtles on the Great Barrier Reef", { kind: "image" as const, duration: undefined });
  const sc = (x: ReturnType<typeof c>) => scoreClip(x, shot, "16:9", 1);
  assert.ok(sc(turtle) > sc(generic) + 5, `${sc(turtle)} vs ${sc(generic)}`);
  assert.ok(sc(turtle) > sc(diver) + 5, "a person in it, when asked for none");
  assert.ok(sc(turtle) > sc(echo), "a title that's only the search echoed back proves nothing");
  assert.ok(sc(echo) > sc(generic), "but it isn't punished like an off-subject clip");
  assert.ok(sc(turtle) > sc(photo), "footage first when both show it");
  assert.ok(sc(photo) > sc(generic), "a photograph of the real thing beats footage of something else");
  assert.equal(castShot([generic, diver, photo, turtle, echo], shot, "16:9", 1, new Set()).clip?.id, "t");
  assert.equal(castShot([generic, diver, photo], shot, "16:9", 1, new Set()).clip?.id, "p");
  assert.ok(scoreClip(photo, { ...shot, media: "photo" }, "16:9", 1) > scoreClip(turtle, { ...shot, media: "photo" }, "16:9", 1), "photos when photos are asked for");
  assert.equal(subjectMatch("Sharks circling a reef", ["turtles", "sharks"]), 0.5);
  assert.equal(subjectMatch("coral", ["coral"]), undefined);
  // the first search and earlier results count for more
  assert.ok(scoreClip(c("a", "x", { rank: 0, q: 0 }), { ...shot, must: [] }, "16:9", 1) > scoreClip(c("b", "x", { rank: 9, q: 3 }), { ...shot, must: [] }, "16:9", 1));
});

test("the edit: dissolves into new thoughts, photos move, a documentary has no forced end card, scenes remember their shot", () => {
  const { shots } = planFilm(REEF, "The Great Barrier Reef", { genre: "documentary", text: "subtitles" });
  const cast = shots.map((s, i) => ({ ...s, clip: `asset:v${i}`, still: i === 2 }));
  const doc = assemble(cast, { genre: "documentary", look: "documentary", text: "subtitles", brand: "", title: "The Reef", cta: "", url: "" }).map((s) => sanitizeScene(s));
  assert.ok(doc.every((s) => s.template === "fullbleed"), "no end card without a button or link");
  assert.ok(doc.slice(1).every((s) => s.transition === "fade"));
  assert.ok(doc[2].effects?.includes("push-in") && !doc[1].effects?.includes("push-in"));
  assert.equal(doc[1].shot?.line, shots[1].line);
  assert.deepEqual(doc[1].shot?.must, ["turtles", "sharks"]);
  assert.ok((doc[1].shot?.queries?.length ?? 0) >= 2);
  const linked = assemble(cast, { genre: "documentary", look: "documentary", text: "subtitles", brand: "", title: "", cta: "Watch the film", url: "reef.org" });
  assert.equal(linked.at(-1)!.template, "cta-end");
  const ad = assemble(cast, { genre: "ad", look: "commercial", text: "clean", brand: "Reef Co", title: "", cta: "", url: "" });
  assert.equal(ad.at(-1)!.template, "cta-end", "an ad always closes on its end card");
  assert.equal(sanitizeScene({ template: "fullbleed", duration: 3, shot: { type: "wide", query: "x", queries: Array(20).fill("q"), must: [1, "ok"], line: "y".repeat(999) } } as never).shot?.queries?.length, 6);
});

test("Pexels clips are described by their page address", () => {
  assert.equal(pexelsTitle("https://www.pexels.com/video/a-barista-pouring-latte-art-4820343/", "coffee"), "a barista pouring latte art");
  assert.equal(pexelsTitle("https://www.pexels.com/video/853889/", "coffee"), "coffee");
  assert.equal(pexelsTitle(undefined, "coffee"), "coffee");
});
