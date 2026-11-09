import { useEffect, useMemo, useRef, useState } from "react";
import type { Aspect, AudioTrack, MusicTrack, Project, Scene } from "../types";
import { useStudio, setState, getState } from "../store";
import { sanitizeScene } from "../sanitize";
import { brandWithStyle } from "../storyboard";
import { CATEGORIES, FORMATS, SECTIONS, buildFormat, buildWithVoice, scriptFor, type Brief, type Category, type Format, type Section } from "../formats";
import { pickImages } from "../soundApply";
import { createFormat, generateVoice, writeScript, withBackground } from "../formatsDirect";
import { BackgroundPicker } from "./BackgroundPicker";
import { prepareVoice, prepareMusic, type Stage } from "../audio/prepare";
import { understand } from "../audio/understand";
import { StageList, VoiceReport, MusicReport } from "./AudioLab";
import { LoopPreview } from "./SoundTemplates";
import { Icon } from "./Icon";

const BRIEF_KEY = "hookky.formatBrief";
const ASPECTS: Aspect[] = ["9:16", "1:1", "4:5", "16:9"];
const VOICES: { id: string; note: string }[] = [
  { id: "nova", note: "bright, friendly" },
  { id: "coral", note: "warm, upbeat" },
  { id: "shimmer", note: "light, clear" },
  { id: "sage", note: "calm, assured" },
  { id: "ash", note: "confident, direct" },
  { id: "onyx", note: "deep, cinematic" },
  { id: "echo", note: "even, modern" },
  { id: "fable", note: "storyteller" },
  { id: "verse", note: "expressive" },
];
const TONES = ["energetic", "warm", "calm", "dramatic", "bold"];
const SECTION_ICON: Record<Section, string> = { text: "command", mixed: "image", footage: "clip" };

function loadBrief(p: Project): Partial<Brief> {
  try {
    const saved = JSON.parse(localStorage.getItem(BRIEF_KEY) || "{}");
    return { ...saved, product: p.brand.name || saved.product || "" };
  } catch {
    return { product: p.brand.name };
  }
}

/** A project that previews a format: around the voice-over if there is one, in the brand or the format's look. */
function preview(f: Format, base: Project, brief: Partial<Brief>, imgs: string[], aspect: Aspect, keepBrand: boolean, voice?: AudioTrack, bg: Scene["background"] | "auto" = "auto"): Project {
  const pics = f.section === "text" ? [] : imgs;
  const built = voice ? buildWithVoice(f, brief, voice, pics).scenes : buildFormat(f, brief, pics);
  const scenes = bg === "auto" ? built : withBackground(built, bg);
  return {
    ...base,
    aspect,
    style: keepBrand ? base.style : f.style,
    brand: keepBrand ? base.brand : { ...brandWithStyle(base.brand, f.style), name: brief.product || base.brand.name },
    scenes: scenes.map((s) => sanitizeScene(s)),
    captions: false,
    grain: false,
    audio: voice,
    music: undefined,
  };
}

type VoiceMode = "keep" | "upload" | "generate" | "none";

/** Creative formats in three sections; every one can be cut to a voice-over (uploaded or generated). */
export function FormatsSheet() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const health = useStudio((s) => s.health);
  const [section, setSection] = useState<Section>("text");
  const [cat, setCat] = useState<Category | "All">("All");
  const [pick, setPick] = useState<Format>(() => FORMATS.find((f) => f.section === "text")!);
  const [hover, setHover] = useState<string | null>(null);
  const [brief, setBrief] = useState<Partial<Brief>>(() => loadBrief(getState().project));
  const [aspect, setAspect] = useState<Aspect>(pick.aspect);
  const [aspectTouched, setAspectTouched] = useState(false);
  const [keepBrand, setKeepBrand] = useState(() => !!getState().kits.find((k) => k.isDefault));
  const [useStock, setUseStock] = useState(true);
  const [bg, setBg] = useState<Scene["background"] | "auto">("auto");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // sound
  const [voiceMode, setVoiceMode] = useState<VoiceMode>(() => (getState().project.audio ? "keep" : "none"));
  const [voiceFile, setVoiceFile] = useState<File>();
  const [voiceTrack, setVoiceTrack] = useState<AudioTrack>();
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState("nova");
  const [tone, setTone] = useState("energetic");
  const [musicFile, setMusicFile] = useState<File>();
  const [musicInfo, setMusicInfo] = useState<MusicTrack>();
  const [dropMusic, setDropMusic] = useState(false);
  // listening
  const [voiceStages, setVoiceStages] = useState<Stage[] | null>(null);
  const [musicStages, setMusicStages] = useState<Stage[] | null>(null);
  const [meaning, setMeaning] = useState<Stage[] | null>(null);
  const [keptVoice, setKeptVoice] = useState<AudioTrack | undefined>(() => getState().project.audio);
  const [recs, setRecs] = useState<{ id: string; why: string }[]>([]);
  const [listening, setListening] = useState(0);
  const voiceIn = useRef<HTMLInputElement>(null);
  const musicIn = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  const imgs = useMemo(() => pickImages(assets).filter((id) => assets.find((a) => a.id === id)?.kind !== "logo"), [assets]);
  const claudeOk = health?.agent === "claude" && !["invalid-key", "no-credit", "missing"].includes(health?.claude?.state ?? "");
  const canSpeak = !!health?.voice;
  const close = () => !busy && setState({ sheet: undefined });
  const currentVoice = voiceMode === "keep" ? keptVoice : voiceMode === "none" ? undefined : voiceTrack;
  const music = dropMusic ? undefined : musicInfo ?? project.music;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), close());
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy]);
  useEffect(() => {
    try {
      localStorage.setItem(BRIEF_KEY, JSON.stringify(brief));
    } catch {
      /* private mode */
    }
  }, [brief]);
  useEffect(() => () => player.current?.pause(), []);

  const inSection = FORMATS.filter((f) => f.section === section);
  const cats = CATEGORIES.filter((c) => inSection.some((f) => f.category === c));
  const shown = inSection.filter((f) => cat === "All" || f.category === cat);
  const big = useMemo(() => preview(pick, project, brief, imgs, aspect, keepBrand, currentVoice, bg), [pick, project.brand, project.style, brief, imgs, aspect, keepBrand, currentVoice, bg]);
  const cards = useMemo(() => shown.map((f) => ({ f, p: preview(f, project, brief, imgs, f.aspect, keepBrand, undefined, bg) })), [section, cat, project.brand, project.style, brief.product, brief.what, imgs, keepBrand, bg]);

  const choose = (f: Format) => {
    setPick(f);
    if (!aspectTouched) setAspect(f.aspect);
  };
  const goSection = (s: Section) => {
    setSection(s);
    setCat("All");
    choose(FORMATS.find((f) => f.section === s)!);
  };
  const set = (k: keyof Brief, v: string) => setBrief((b) => ({ ...b, [k]: k === "benefits" ? v.split("\n") : v }));

  /** Fill brief fields the user left empty with what the audio says; recommend formats. */
  async function makeSense(v: AudioTrack | undefined, m: MusicTrack | undefined) {
    setMeaning([{ id: "meaning", label: claudeOk ? "Claude is listening to the message" : "Reading the message", state: "running" }]);
    const u = await understand(v, m, claudeOk);
    setBrief((b) => ({
      ...b,
      product: b.product || u.brief.product || "",
      what: b.what || u.brief.what || "",
      audience: b.audience || u.brief.audience || "",
      benefits: (b.benefits ?? []).filter(Boolean).length ? b.benefits : u.brief.benefits ?? [],
      offer: b.offer || u.brief.offer || "",
      cta: b.cta || u.brief.cta || "",
      url: b.url || u.brief.url || "",
    }));
    setRecs(u.recommended);
    const filled = Object.entries(u.brief).filter(([, v]) => (Array.isArray(v) ? v.length : v)).length;
    setMeaning([{ id: "meaning", label: u.by === "claude" ? "Claude listened to the message" : "Read the message", state: "done", note: `${filled ? `${filled} brief field${filled > 1 ? "s" : ""} filled` : "nothing to fill"}${u.recommended.length ? `, ${u.recommended.length} formats suggested` : ""}${u.note ? ` (Claude: ${u.note.replace(/\.$/, "")})` : ""}` }]);
  }

  /** Listen to a voice-over properly before anything is built. */
  async function listenVoice(f: File, mode: VoiceMode) {
    setError(null);
    setListening((n) => n + 1);
    try {
      const t = await prepareVoice(f, setVoiceStages, health?.transcription !== "none");
      setVoiceFile(f);
      if (mode === "keep") setKeptVoice(t);
      else setVoiceTrack(t);
      setVoiceMode(mode);
      await makeSense(t, music);
      return t;
    } catch (e: any) {
      setError(`${f.name} couldn't be analysed: ${e.message}. Try MP3, M4A or WAV.`);
    } finally {
      setListening((n) => n - 1);
    }
  }
  async function takeVoice(f?: File) {
    if (f) await listenVoice(f, "upload");
  }
  async function takeMusic(f?: File | MusicTrack) {
    if (!f) return;
    setError(null);
    setListening((n) => n + 1);
    try {
      const m = await prepareMusic(f, setMusicStages);
      setMusicInfo(m);
      if (f instanceof File) setMusicFile(f);
      setDropMusic(false);
      await makeSense(currentVoice, m);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setListening((n) => n - 1);
    }
  }
  // Audio already in the project gets the same careful listen when the sheet opens.
  useEffect(() => {
    const a = getState().project.audio, m = getState().project.music;
    (async () => {
      if (a && !a.insight) {
        const blob = await fetch(a.url).then((r) => r.blob()).catch(() => null);
        if (blob) await listenVoice(new File([blob], a.name, { type: blob.type || "audio/mpeg" }), "keep");
      } else if (a?.insight) await makeSense(a, m);
      if (m && !m.insight) await takeMusic(m);
    })();
  }, []);

  async function claudeScript() {
    setBusy("Claude is writing the script");
    const r = await writeScript(pick, brief, aspect === "16:9" ? 25 : 18);
    setBusy(null);
    if (r.script) setScript(r.script);
    else setError(`Claude couldn't write it (${r.error}). The studio's script is in the box; edit it freely.`);
  }
  async function speakIt() {
    setError(null);
    const text = script.trim() || scriptFor(pick, brief);
    if (!script.trim()) setScript(text);
    setBusy(`Recording “${voice}”`);
    try {
      const f = await generateVoice(text, voice, tone);
      setBusy(null);
      const t = await listenVoice(f, "generate");
      if (t) {
        player.current?.pause();
        player.current = new Audio(t.url);
        player.current.play().catch(() => {});
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function create(withClaude: boolean) {
    setError(null);
    player.current?.pause();
    try {
      const summary = await createFormat({
        format: pick,
        brief,
        aspect,
        keepBrand,
        voiceTrack: voiceMode === "upload" || voiceMode === "generate" ? voiceTrack : voiceMode === "keep" ? keptVoice : undefined,
        voiceFile: (voiceMode === "upload" || voiceMode === "generate") && !voiceTrack ? voiceFile : undefined,
        dropVoice: voiceMode === "none",
        musicTrack: dropMusic ? undefined : musicInfo,
        musicFile: musicInfo ? undefined : musicFile,
        dropMusic,
        useStock: useStock && pick.section !== "text",
        withClaude: withClaude && claudeOk,
        background: bg,
        onStep: setBusy,
      });
      setBusy(null);
      setState({ sheet: undefined, notice: `${summary} Press play.` });
    } catch (e: any) {
      setBusy(null);
      setError(e?.message ?? "Couldn't make the ad.");
    }
  }

  const field = (k: keyof Brief, label: string, ph: string) => (
    <label className="field">
      <span className="label">{label}</span>
      <input type="text" value={(brief[k] as string) ?? ""} placeholder={ph} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  const total = big.scenes.reduce((a, s) => a + s.duration, 0);

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet sound-sheet formats-sheet" role="dialog" aria-modal="true" aria-labelledby="formats-title">
        <div className="sheet-head">
          <div>
            <h3 id="formats-title">Creative formats</h3>
            <p className="sound-sub">{FORMATS.length} attention structures in three kinds. Add a voice-over to any of them and the cut follows it, word for word.</p>
          </div>
          <button className="btn icon ghost" onClick={close} aria-label="Close" disabled={!!busy}>
            <Icon name="minus" />
          </button>
        </div>

        <div className="format-sections" role="tablist" aria-label="Kinds of format">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} className={`format-section ${section === s.id ? "on" : ""}`} onClick={() => goSection(s.id)}>
              <Icon name={SECTION_ICON[s.id]} />
              <span>
                <b>{s.label}</b>
                <small>{s.note} · {FORMATS.filter((f) => f.section === s.id).length}</small>
              </span>
            </button>
          ))}
        </div>
        {cats.length > 1 && (
          <div className="seg format-cats" role="group" aria-label="Use case">
            {(["All", ...cats] as const).map((c) => (
              <button key={c} className={cat === c ? "on" : ""} onClick={() => setCat(c)}>{c}</button>
            ))}
          </div>
        )}

        <div className="sound-body">
          <div className="sound-grid" role="listbox" aria-label="Formats">
            {cards.map(({ f, p }) => (
              <button
                key={f.id}
                role="option"
                aria-selected={pick.id === f.id}
                className={`sound-card ${pick.id === f.id ? "on" : ""}`}
                onClick={() => choose(f)}
                onPointerEnter={() => setHover(f.id)}
                onPointerLeave={() => setHover((h) => (h === f.id ? null : h))}
                onFocus={() => setHover(f.id)}
                onBlur={() => setHover(null)}
              >
                {recs.some((r) => r.id === f.id) && <span className="fits">Fits your audio</span>}
                <span className="sound-frame" style={{ background: `linear-gradient(135deg, ${f.swatch[0]}, ${f.swatch[0]} 60%, ${f.swatch[1]})` }}>
                  <LoopPreview project={p} height={132} live={hover === f.id} />
                </span>
                <span className="sound-meta">
                  <b>{f.name}</b>
                  <span className="sound-need">
                    <Icon name="sparkle" size={12} /> {f.hook} · {f.aspect}
                  </span>
                  <small>{f.blurb}</small>
                </span>
              </button>
            ))}
          </div>

          <aside className="sound-side">
            <div className="sound-stage" style={{ background: big.brand.bg }}>
              <LoopPreview project={big} height={300} live />
              <span className="sound-badge">{currentVoice ? `Cut to your voice-over · ${total.toFixed(1)}s` : `${pick.category} · ${total.toFixed(1)}s`}</span>
            </div>
            <p className="format-beats"><b>{pick.name}:</b> {pick.blurb}</p>

            <div className="format-card">
              <span className="label">Voice-over</span>
              <div className="seg" role="group" aria-label="Voice-over">
                {project.audio && <button className={voiceMode === "keep" ? "on" : ""} onClick={() => setVoiceMode("keep")}>Current</button>}
                <button className={voiceMode === "upload" ? "on" : ""} onClick={() => (voiceMode !== "upload" && voiceFile && setVoiceMode("upload"), voiceIn.current?.click())}>Upload</button>
                <button className={voiceMode === "generate" ? "on" : ""} onClick={() => (setVoiceMode("generate"), !script && setScript(scriptFor(pick, brief)))}>Generate</button>
                <button className={voiceMode === "none" ? "on" : ""} onClick={() => setVoiceMode("none")}>None</button>
              </div>
              {voiceMode === "keep" && keptVoice && <small className="tiny">{keptVoice.name} · {keptVoice.duration.toFixed(1)}s{keptVoice.words?.length ? ` · ${keptVoice.words.length} words` : ""}</small>}
              {voiceMode === "upload" && (voiceTrack ? <small className="tiny">{voiceFile?.name} · {voiceTrack.duration.toFixed(1)}s{voiceTrack.words?.length ? ` · ${voiceTrack.words.length} words transcribed` : " · no transcript"}</small> : <small className="tiny">MP3, WAV or M4A. The cut follows its pauses and words.</small>)}
              {voiceMode === "generate" && (
                <>
                  <textarea rows={4} value={script} onChange={(e) => setScript(e.target.value)} placeholder="What the voice says." aria-label="Script" />
                  <div className="row">
                    <select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="Voice">
                      {VOICES.map((v) => <option key={v.id} value={v.id}>{v.id[0].toUpperCase() + v.id.slice(1)} · {v.note}</option>)}
                    </select>
                    <select value={tone} onChange={(e) => setTone(e.target.value)} aria-label="Tone">
                      {TONES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </div>
                  <div className="row">
                    {claudeOk && <button className="btn ghost" disabled={!!busy} onClick={claudeScript}><Icon name="wand" size={13} /> Write with Claude</button>}
                    <button className="btn" disabled={!!busy || !canSpeak} onClick={speakIt}><Icon name="mic" size={13} /> {voiceTrack && voiceFile?.name.startsWith("voice-") ? "Record again" : "Record voice"}</button>
                  </div>
                  <small className="tiny">{!canSpeak ? "Voice generation needs OPENAI_API_KEY on the server." : voiceTrack && voiceFile?.name.startsWith("voice-") ? `Recorded · ${voiceTrack.duration.toFixed(1)}s · plays once; the preview is cut to it.` : "An AI voice reads the script; the cut then follows every word."}</small>
                </>
              )}
              <span className="label" style={{ marginTop: 6 }}>Music</span>
              <div className="row">
                <small className="tiny" style={{ flex: 1 }}>{music ? `${music.name}${music.bpm ? ` · ${Math.round(music.bpm)} BPM` : ""}${currentVoice ? " · dips under the voice" : " · cuts land on the beat"}` : "Optional. Without a voice-over, cuts land on its beat."}</small>
                <button className="btn ghost" style={{ flex: "none" }} disabled={!!busy} onClick={() => musicIn.current?.click()}>{music ? "Replace" : "Add"}</button>
                {music && <button className="btn icon ghost" style={{ flex: "none" }} aria-label="Remove music" onClick={() => (setMusicFile(undefined), setMusicInfo(undefined), setDropMusic(true))}><Icon name="trash" size={13} /></button>}
              </div>
            </div>

            {voiceStages && voiceStages.some((x) => x.state !== "done" && x.state !== "skipped") && <StageList title="Listening to the voice-over" stages={voiceStages} />}
            {currentVoice?.insight && !(voiceStages && voiceStages.some((x) => x.state === "running" || x.state === "waiting")) && <VoiceReport track={currentVoice} />}
            {musicStages && musicStages.some((x) => x.state !== "done" && x.state !== "skipped") && <StageList title="Listening to the music" stages={musicStages} />}
            {music?.insight && !(musicStages && musicStages.some((x) => x.state === "running" || x.state === "waiting")) && <MusicReport track={music} />}
            {meaning && <StageList title="Understanding" stages={meaning} />}
            {recs.length > 0 && (
              <div className="lab-recs">
                <span className="label">Suits your audio</span>
                <div className="lab-chips">
                  {recs.map((r) => {
                    const f = FORMATS.find((x) => x.id === r.id);
                    return f ? (
                      <button key={r.id} onClick={() => (setSection(f.section), setCat("All"), choose(f))} title={r.why}>
                        {f.name}<small>{r.why}</small>
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            )}

            {pick.section !== "text" && (
              <label className="toggle">
                <input type="checkbox" checked={useStock} onChange={(e) => setUseStock(e.target.checked)} />
                {imgs.length ? `Use my ${imgs.length} image${imgs.length > 1 ? "s" : ""}, fill the rest with stock footage` : "Cast stock footage for every shot"}
              </label>
            )}

            {field("product", "Product or brand", "Orbit")}
            {field("what", "What it is", "a smartwatch that coaches your sleep")}
            {field("audience", "Who it's for", "runners who sleep badly")}
            <label className="field">
              <span className="label">Benefits, one per line</span>
              <textarea rows={3} value={(brief.benefits ?? []).join("\n")} placeholder={"Ten-day battery\nSleep coaching that works\nTitanium light"} onChange={(e) => set("benefits", e.target.value)} />
            </label>
            <div className="row">
              {field("offer", "Offer (optional)", "30% off launch week")}
              {field("cta", "Button", "Pre-order")}
            </div>
            {field("url", "Link", "orbit.watch")}
            <div className="field">
              <span className="label">Background{bg !== "auto" ? `: ${bg}` : ""}</span>
              <BackgroundPicker value={bg} onChange={setBg} brand={big.brand} auto />
            </div>
            <div className="opt-row">
              <span className="opt-label">Format</span>
              <div className="seg" role="group" aria-label="Format">
                {ASPECTS.map((a) => (
                  <button key={a} className={aspect === a ? "on" : ""} onClick={() => (setAspect(a), setAspectTouched(true))}>{a}</button>
                ))}
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={keepBrand} onChange={(e) => setKeepBrand(e.target.checked)} />
              Keep my brand colours and fonts
            </label>
            {error && <p className="sound-error" role="alert">{error}</p>}
            <button className="btn primary sound-build" disabled={!!busy || listening > 0} onClick={() => create(true)}>
              {busy ? <span className="wave" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} style={{ animationDelay: `${i * 0.11}s` }} />)}</span> : <Icon name="sparkle" />} {busy ?? (listening > 0 ? "Listening… (the edit waits for the analysis)" : claudeOk && pick.section !== "footage" ? "Create with Claude" : "Create")}
            </button>
            {claudeOk && pick.section !== "footage" && !busy && (
              <button className="btn ghost" onClick={() => create(false)}>Use the instant draft</button>
            )}
            {project.scenes.length > 0 && <span className="tiny">Replaces this project's scenes. Undo brings them back.</span>}
          </aside>
        </div>
        <input ref={voiceIn} type="file" hidden accept="audio/*" onChange={(e) => (takeVoice(e.target.files?.[0]), (e.target.value = ""))} />
        <input ref={musicIn} type="file" hidden accept="audio/*" onChange={(e) => (takeMusic(e.target.files?.[0]), (e.target.value = ""))} />
      </div>
    </div>
  );
}
