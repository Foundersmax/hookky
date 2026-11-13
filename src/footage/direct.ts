// Directing footage in the open project: plan the shots, lay them on the timeline at once, then
// fill each with footage as it's cast. The whole thing is one undo step.
import type { Aspect, Asset, Project } from "../types";
import { getState, setState, updateProject, libraryId, setAudio } from "../store";
import { sanitizeScene } from "../sanitize";
import { alignScript } from "../audio/analyze";
import { ingestVoiceover } from "../components/VoicePanel";
import { assemble, type EditOptions, type ProdLook, type Shot, type TextMode } from "./plan";
import { planFilm, type Genre } from "./mind";
import { castAll, refinePlan, timingFor, visionPicker, type Sources } from "./cast";
import { preferLicensed } from "./license";
import { clock } from "../clock";

export interface DirectInput {
  voiceFile?: File;
  script?: string;
  brief: string;
  /** ad, documentary or story: pacing, coverage and how the edit closes */
  genre?: Genre;
  /** the person's description of the footage they want */
  direction?: string;
  /** the stock libraries to search */
  sources?: Sources;
  look: ProdLook;
  text: TextMode;
  aspect: Aspect;
  brand: string;
  title: string;
  cta: string;
  url: string;
  onStep?: (label: string) => void;
  /** the shot list once written, and each shot as it's cast (for a live view) */
  onPlan?: (shots: Shot[], by: "claude" | "local") => void;
  onCast?: (i: number, pick: Asset | undefined) => void;
}

let running: AbortController | null = null;
export const stopDirecting = () => running?.abort();

/** Build the edit from the voice-over. Resolves with a one-line summary. */
export async function directFootage(input: DirectInput): Promise<string> {
  running?.abort();
  const ctl = (running = new AbortController());
  const step = input.onStep ?? (() => {});
  if (input.voiceFile) {
    step("Listening to the voice-over");
    await ingestVoiceover(input.voiceFile);
  }
  let audio = getState().project.audio;
  if (!audio) throw new Error("Add a voice-over first.");
  if (input.script?.trim() && !audio.words?.length) {
    setAudio({ ...audio, words: alignScript(input.script, audio), wordsSource: "script-estimate" });
    audio = getState().project.audio!;
  }

  step("Understanding the voice-over");
  const genre = input.genre ?? "ad";
  const film = planFilm(audio, input.brief, { genre, direction: input.direction, text: input.text, brand: input.brand });
  const local = film.shots;
  step("Writing the shot list");
  const timeout = new Promise<{ shots: Shot[]; by: "local"; note: string }>((r) => setTimeout(() => r({ shots: local, by: "local", note: "Claude took too long" }), 45000));
  const about = [film.topic.main, ...film.topic.entities].filter(Boolean).slice(0, 5).join(", ");
  const plan = await Promise.race([refinePlan(local, input.brief, input.aspect, input.look, input.text, { genre, direction: input.direction, topic: about }), timeout]);
  if (ctl.signal.aborted) return "Stopped.";
  let shots: Shot[] = plan.shots;
  input.onPlan?.(shots, plan.by);

  const edit: EditOptions = { genre, look: input.look, text: input.text, brand: input.brand, title: input.title, cta: input.cta, url: input.url };
  // Lay the shots on the timeline straight away (type placeholders), as one undoable change.
  const projectId = getState().project.id;
  const first = assemble(shots, edit).map((s) => sanitizeScene(s));
  const ids = first.map((s) => s.id);
  updateProject((p) => ({ ...p, aspect: input.aspect, captions: input.text === "subtitles" && !!audio!.words?.length, grain: true, title: /^untitled/i.test(p.title) || !p.title ? input.title || input.brand || "Footage cut" : p.title, scenes: first }));
  setState({ selected: 0 });
  clock.seek(0);

  // Cast the footage; each shot drops in as it's found.
  step(`Casting footage · 0 of ${shots.length}`);
  const picks: (Asset | undefined)[] = [];
  let done = 0;
  await castAll(
    shots,
    input.aspect,
    input.look,
    (i, c) => {
      done++;
      step(`Casting footage · ${done} of ${shots.length}`);
      const p = getState().project;
      if (p.id !== projectId || p.scenes.length !== ids.length || p.scenes.some((s, k) => s.id !== ids[k])) return ctl.abort();
      picks[i] = c.pick;
      input.onCast?.(i, c.pick);
      const clipId = c.pick ? libraryId(preferLicensed(c.pick, getState().assets)) : undefined;
      shots = shots.map((s, k) => (k === i ? { ...s, clip: clipId, still: !!c.pick && c.pick.kind !== "video", ...timingFor(c.pick, s, input.look) } : s));
      const scenes = assemble(shots, edit).map((s, k) => sanitizeScene(s, ids[k]));
      // Quiet update: the plan step above is the undo point.
      setState({ project: { ...p, scenes: p.scenes.map((old, k) => (k === i ? scenes[k] : old)) } as Project });
    },
    ctl.signal,
    [],
    // With Claude available it also looks at the top candidates for each shot.
    plan.by === "claude" ? visionPicker([input.brief, input.direction].filter(Boolean).join(" · Footage wanted: ")) : undefined,
    input.sources,
  );
  if (running === ctl) running = null;
  if (ctl.signal.aborted) return "Stopped casting: the project changed.";
  const found = picks.filter(Boolean).length;
  const video = picks.filter((a) => a?.kind === "video").length;
  return `${shots.length} shots, ${video} with stock footage${found > video ? `, ${found - video} with photos` : ""}${found < shots.length ? `, ${shots.length - found} as type (nothing found)` : ""}. Shot list by ${plan.by === "claude" ? "Claude" : "the local director"}${plan.by === "local" && plan.note ? ` (${plan.note.replace(/\.$/, "")})` : ""}.`;
}
