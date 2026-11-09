import { useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, AudioTrack, MusicTrack, Project } from "../types";
import { ASPECT_SIZE } from "../types";
import { useStudio, setState, getState } from "../store";
import { Renderer } from "../engine/render";
import { images } from "../runtime";
import { sanitizeScene } from "../sanitize";
import { brandWithStyle } from "../storyboard";
import { SOUND_TEMPLATES, buildSound, type Copy, type SoundTemplate } from "../soundTemplates";
import { demoMusic, demoVoice } from "../soundDemo";
import { applySoundTemplate, initialCopy, loadMusic, pickImages } from "../soundApply";
import { Icon } from "./Icon";

const LENGTHS = [
  { v: 10, label: "10s" },
  { v: 15, label: "15s" },
  { v: 30, label: "30s" },
  { v: 0, label: "Full" },
];
const ASPECTS: Aspect[] = ["9:16", "1:1", "4:5", "16:9"];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Sound {
  voice?: AudioTrack;
  music?: MusicTrack;
}

/** A project that previews a template: the user's own audio if they've added it, else stand-ins. */
function previewProject(t: SoundTemplate, base: Project, copy: Copy, imgs: string[], sound: Sound, aspect: Aspect, keepBrand: boolean): Project {
  const lines = [copy.line || "Made to move", ...copy.points, copy.cta || "Shop now"].filter(Boolean);
  const voice = sound.voice ?? (t.needs === "voice" ? demoVoice(lines) : undefined);
  const music = sound.music ?? (t.needs !== "voice" || !voice ? demoMusic(t.id === "trailer" ? 96 : 124, 40, t.id === "trailer" ? 10 : 7.8) : undefined);
  const b = buildSound(t, {
    voice: voice && { duration: voice.duration, pauses: voice.pauses, words: voice.words },
    music: music && { duration: music.duration ?? 0, bpm: music.bpm, beats: music.beats, downbeats: music.downbeats, energy: music.energy, drop: music.drop },
    copy,
    images: imgs,
    length: t.length,
  });
  const brand = keepBrand ? base.brand : brandWithStyle(base.brand, t.style);
  return {
    ...base,
    aspect,
    style: keepBrand ? base.style : t.style,
    brand: { ...brand, name: copy.brand || brand.name },
    scenes: b.scenes.map((s) => sanitizeScene(s)),
    captions: b.captions,
    grain: false,
    audio: voice,
    music: music && { ...music, ...(b.music ?? {}) },
  };
}

/** A canvas that plays a project in a loop (only while `live`), or holds one telling frame. */
const SIGNATURE = new Set(["dashboard", "dashboard-focus", "live-metrics", "icon-orbit", "world-map", "route-map", "line-chart", "column-chart", "donut-chart", "kpi-grid", "metric-ring", "process-flow", "icon-list"]);

export function LoopPreview({ project, height, live, clockRef }: { project: Project; height: number; live: boolean; clockRef?: { current: (() => number) | null } }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [W, H] = ASPECT_SIZE[project.aspect];
  const total = project.scenes.reduce((a, s) => a + s.duration, 0);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !total) return;
    const scale = (height * Math.min(2, window.devicePixelRatio || 1)) / H;
    const r = new Renderer(c, W, H, scale);
    // The still frame: just after the drop (or a third in), where the template shows itself.
    let t2 = 0;
    // A reveal if there is one (not a punch on an accent background), else a third of the way in.
    const drop = project.scenes.findIndex((s, i) => i > 0 && (s.template === "logo-reveal" || s.template === "audiogram" || (s.effects?.includes("flash") && s.background !== "accent")));
    // Motion graphics show their signature beat (the dashboard, the orbit, a chart), well into its build.
    const sig = drop >= 0 ? -1 : project.scenes.findIndex((s) => SIGNATURE.has(s.template));
    const at = (k: number, f: number, cap: number) => project.scenes.slice(0, k).reduce((a, s) => a + s.duration, 0) + Math.min(cap, project.scenes[k].duration * f);
    const still = drop >= 0 ? at(drop, 0.6, 1.2) : sig >= 0 ? at(sig, 0.85, 3) : total * 0.33;
    const draw = (t: number) => {
      try {
        r.render(project, t, images.still);
      } catch {
        /* a preview never breaks the sheet */
      }
    };
    if (!live) {
      draw(still);
      const off = images.listen(() => draw(still));
      return off;
    }
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      const from = clockRef?.current?.();
      t2 = from ?? ((performance.now() - t0) / 1000) % total;
      draw(Math.min(t2, total - 0.01));
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [project, live, height]);
  return <canvas ref={canvas} style={{ height, aspectRatio: `${W} / ${H}`, width: "auto", maxWidth: "100%" }} />;
}

/** Pick a sound template, bring a voice-over and/or music, and build the cut. */
export function SoundTemplates() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const [pick, setPick] = useState<SoundTemplate>(SOUND_TEMPLATES[0]);
  const [hover, setHover] = useState<string | null>(null);
  const [copy, setCopy] = useState<Copy>(() => initialCopy(getState().project));
  const [aspect, setAspect] = useState<Aspect>(SOUND_TEMPLATES[0].aspect);
  const [aspectTouched, setAspectTouched] = useState(false);
  const [length, setLength] = useState(SOUND_TEMPLATES[0].length);
  const [keepBrand, setKeepBrand] = useState(() => !!getState().kits.find((k) => k.isDefault));
  const [voiceFile, setVoiceFile] = useState<File>();
  const [musicFile, setMusicFile] = useState<File>();
  const [dropVoice, setDropVoice] = useState(false);
  const [dropMusic, setDropMusic] = useState(false);
  const [sound, setSound] = useState<Sound>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const voiceIn = useRef<HTMLInputElement>(null);
  const musicIn = useRef<HTMLInputElement>(null);
  const players = useRef<{ voice?: HTMLAudioElement; music?: HTMLAudioElement }>({});
  const clockRef = useRef<(() => number) | null>(null);
  const imgs = useMemo(() => pickImages(assets), [assets]);
  const close = () => setState({ sheet: undefined });

  // The project's own audio counts unless the user swapped or removed it.
  const voice = voiceFile ? sound.voice : dropVoice ? undefined : project.audio;
  const music = musicFile ? sound.music : dropMusic ? undefined : sound.music ?? project.music;

  // Map the beats of the project's current music once, so the preview cuts to it.
  useEffect(() => {
    const m = project.music;
    if (!m || m.beats?.length || musicFile) return;
    let off = false;
    loadMusic(m).then((x) => !off && setSound((s) => ({ ...s, music: x })), () => {});
    return () => void (off = true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), close());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  useEffect(() => () => stop(), []);

  const choose = (t: SoundTemplate) => {
    setPick(t);
    if (!aspectTouched) setAspect(t.aspect);
    setLength(t.length);
    stop();
  };

  async function takeVoice(f?: File) {
    if (!f) return;
    setError(null);
    setBusy("Reading the voice-over");
    try {
      const { analyzeAudio } = await import("../audio/analyze");
      const track = await analyzeAudio(f);
      setVoiceFile(f);
      setDropVoice(false);
      setSound((s) => ({ ...s, voice: track }));
    } catch {
      setError(`${f.name} can't be played in this browser. Try MP3, M4A or WAV.`);
    } finally {
      setBusy(null);
    }
  }
  async function takeMusic(f?: File) {
    if (!f) return;
    setError(null);
    setBusy("Finding the beat");
    try {
      const m = await loadMusic(f);
      setMusicFile(f);
      setDropMusic(false);
      setSound((s) => ({ ...s, music: m }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  const preview = useMemo(
    () => previewProject(pick, project, copy, imgs, { voice, music }, aspect, keepBrand),
    [pick, project.brand, project.style, copy, imgs, voice, music, aspect, keepBrand],
  );
  const cards = useMemo(
    () => SOUND_TEMPLATES.map((t) => ({ t, p: previewProject(t, project, copy, imgs, {}, t.aspect, keepBrand) })),
    [project.brand, project.style, copy.brand, copy.line, imgs, keepBrand],
  );
  const total = preview.scenes.reduce((a, s) => a + s.duration, 0);
  const real = !!(voice || music);

  // Listen: play the real audio with the preview, the preview following the audio's clock.
  function stop() {
    for (const a of Object.values(players.current)) a?.pause();
    players.current = {};
    clockRef.current = null;
    setPlaying(false);
  }
  function listen() {
    if (playing) return stop();
    const v = voice?.url ? new Audio(voice.url) : undefined;
    const pm = preview.music;
    const m = music?.url && pm ? new Audio(music.url) : undefined;
    if (v) v.volume = Math.min(1, voice?.volume ?? 1);
    if (m && pm) {
      m.currentTime = pm.start ?? 0;
      m.volume = Math.min(1, v ? (pm.volume ?? 0.3) * (1 - (pm.duck ?? 0.6) * 0.5) : pm.volume ?? 0.9);
      m.loop = true;
    }
    const lead = v ?? m;
    if (!lead) return;
    const t0 = lead === m ? pm?.start ?? 0 : 0;
    clockRef.current = () => {
      const t = lead.currentTime - t0;
      if (t >= total) stop();
      return Math.max(0, t);
    };
    players.current = { voice: v, music: m };
    const ended = () => stop();
    lead.addEventListener("ended", ended);
    Promise.all([v?.play(), m?.play()]).catch(() => stop());
    setPlaying(true);
  }

  async function build() {
    stop();
    setError(null);
    try {
      const b = await applySoundTemplate({ template: pick, voiceFile, musicFile, dropVoice, dropMusic, copy, length, aspect, keepBrand, onStep: setBusy });
      setState({ notice: `${pick.name}: ${b.summary}. Press play.` });
    } catch (e: any) {
      setError(e.message || "Couldn't build the cut.");
    } finally {
      setBusy(null);
    }
  }

  const field = (k: keyof Copy, label: string, placeholder: string) => (
    <label className="field">
      <span className="label">{label}</span>
      <input type="text" value={copy[k] as string} placeholder={placeholder} onChange={(e) => setCopy({ ...copy, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet sound-sheet" role="dialog" aria-modal="true" aria-labelledby="sound-title">
        <div className="sheet-head">
          <div>
            <h3 id="sound-title">Sound templates</h3>
            <p className="sound-sub">Pick a look, bring your voice-over or a track. Every cut lands on a word or a beat.</p>
          </div>
          <button className="btn icon ghost" onClick={close} aria-label="Close">
            <Icon name="minus" />
          </button>
        </div>

        <div className="sound-body">
          <div className="sound-grid" role="listbox" aria-label="Sound templates">
            {cards.map(({ t, p }) => (
              <button
                key={t.id}
                role="option"
                aria-selected={pick.id === t.id}
                className={`sound-card ${pick.id === t.id ? "on" : ""}`}
                onClick={() => choose(t)}
                onPointerEnter={() => setHover(t.id)}
                onPointerLeave={() => setHover((h) => (h === t.id ? null : h))}
                onFocus={() => setHover(t.id)}
                onBlur={() => setHover(null)}
              >
                <span className="sound-frame" style={{ background: p.brand.bg }}>
                  <LoopPreview project={p} height={132} live={hover === t.id} />
                </span>
                <span className="sound-meta">
                  <b>{t.name}</b>
                  <span className={`sound-need ${t.needs}`}>
                    <Icon name={t.needs === "voice" ? "mic" : t.needs === "music" ? "music" : "wave"} size={12} />
                    {t.needs === "voice" ? "Voice-over" : t.needs === "music" ? "Music" : "Either"} · {t.aspect}
                  </span>
                  <small>{t.blurb}</small>
                </span>
              </button>
            ))}
          </div>

          <aside className="sound-side">
            <div className="sound-stage" style={{ background: preview.brand.bg }}>
              <LoopPreview project={preview} height={300} live clockRef={clockRef} />
              <span className="sound-badge">{real ? `Your sound · ${total.toFixed(1)}s` : `Preview · ${total.toFixed(1)}s`}</span>
            </div>
            {real && (
              <button className="btn" onClick={listen}>
                <Icon name={playing ? "pause" : "play"} size={13} /> {playing ? "Stop" : "Listen with the cut"}
              </button>
            )}

            <div className="sound-slots">
              <div className={`sound-slot ${voice ? "has" : ""}`}>
                <Icon name="mic" />
                <span className="sound-slot-text">
                  <b>Voice-over</b>
                  <small>{voice ? `${voice.name} · ${voice.duration.toFixed(1)}s${voice.words ? ` · ${voice.words.length} words` : ""}` : pick.needs === "voice" ? "Recommended for this template" : "Optional"}</small>
                </span>
                <button className="btn ghost" onClick={() => voiceIn.current?.click()}>{voice ? "Replace" : "Add"}</button>
                {voice && <button className="btn icon ghost" aria-label="Remove voice-over" onClick={() => (setVoiceFile(undefined), setDropVoice(true), setSound((s) => ({ ...s, voice: undefined })))}><Icon name="trash" size={14} /></button>}
              </div>
              <div className={`sound-slot ${music ? "has" : ""}`}>
                <Icon name="music" />
                <span className="sound-slot-text">
                  <b>Music</b>
                  <small>{music ? `${music.name} · ${music.bpm ? `${Math.round(music.bpm)} BPM` : "no steady beat"}${music.drop !== undefined ? ` · drop at ${mmss(music.drop)}` : ""}` : pick.needs === "music" ? "Recommended: cuts land on the beat" : "Optional"}</small>
                </span>
                <button className="btn ghost" onClick={() => musicIn.current?.click()}>{music ? "Replace" : "Add"}</button>
                {music && <button className="btn icon ghost" aria-label="Remove music" onClick={() => (setMusicFile(undefined), setDropMusic(true), setSound((s) => ({ ...s, music: undefined })))}><Icon name="trash" size={14} /></button>}
              </div>
            </div>

            {!voice && (
              <div className="opt-row">
                <span className="opt-label">Length</span>
                <div className="seg" role="group" aria-label="Length">
                  {LENGTHS.map((l) => (
                    <button key={l.v} className={length === l.v ? "on" : ""} onClick={() => setLength(l.v)}>{l.label}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="opt-row">
              <span className="opt-label">Format</span>
              <div className="seg" role="group" aria-label="Format">
                {ASPECTS.map((a) => (
                  <button key={a} className={aspect === a ? "on" : ""} onClick={() => (setAspect(a), setAspectTouched(true))}>{a}</button>
                ))}
              </div>
            </div>

            <details className="sound-copy" open={!voice?.words?.length}>
              <summary>Words on screen {voice?.words?.length ? "(the voice-over's own words are used; these fill the end card)" : ""}</summary>
              {field("brand", "Brand", "Orbit")}
              {field("line", "Main line", "Time, rethought")}
              <label className="field">
                <span className="label">Points, one per line</span>
                <textarea rows={3} value={copy.points.join("\n")} placeholder={"Ten-day battery\n50% off this week"} onChange={(e) => setCopy({ ...copy, points: e.target.value.split("\n") })} />
              </label>
              <div className="row">
                {field("cta", "Button", "Shop now")}
                {field("url", "Link", "orbit.watch")}
              </div>
            </details>
            <label className="toggle">
              <input type="checkbox" checked={keepBrand} onChange={(e) => setKeepBrand(e.target.checked)} />
              Keep my brand colours and fonts
            </label>
            <span className="tiny">{imgs.length ? `Cuts with ${imgs.length} image${imgs.length > 1 ? "s" : ""} from your library.` : "Add product images in the Library and they're cut in too."}</span>

            {error && <p className="sound-error" role="alert">{error}</p>}
            <button className="btn primary sound-build" disabled={!!busy} onClick={build}>
              {busy ? <span className="wave" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />)}</span> : <Icon name="sparkle" />} {busy ?? `Build ${pick.name}`}
            </button>
            {project.scenes.length > 0 && <span className="tiny">Replaces this project's scenes. Undo brings them back.</span>}
          </aside>
        </div>
        <input ref={voiceIn} type="file" hidden accept="audio/*" onChange={(e) => (takeVoice(e.target.files?.[0]), (e.target.value = ""))} />
        <input ref={musicIn} type="file" hidden accept="audio/*" onChange={(e) => (takeMusic(e.target.files?.[0]), (e.target.value = ""))} />
      </div>
    </div>
  );
}
