import { useEffect, useState } from "react";
import { useStudio, setState, getState, undo, redo, updateProject, setBrand } from "./store";
import { ChatPanel } from "./components/ChatPanel";
import { Stage } from "./components/Stage";
import { Timeline } from "./components/Timeline";
import { SceneInspector } from "./components/SceneInspector";
import { LibraryPanel } from "./components/LibraryPanel";
import { BrandPanel } from "./components/BrandPanel";
import { VoicePanel } from "./components/VoicePanel";
import { ExportPanel } from "./components/ExportPanel";
import { Icon } from "./components/Icon";
import { Logo } from "./components/Logo";
import { clock } from "./clock";
import { images } from "./runtime";
import { STYLE_PRESETS, FONT_CHOICES } from "./presets";
import type { Aspect } from "./types";
import { timeline } from "./engine/render";
import { sampleCap } from "./host";

const TABS = ["Scene", "Library", "Brand", "Voice", "Export"] as const;

export function App() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Scene");
  const [toastMsg, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light" | null>(() => {
    try {
      return (localStorage.getItem("hookky.theme") as "dark" | "light") || null;
    } catch {
      return null;
    }
  });

  const toast = (s: string) => {
    setToast(s);
    window.clearTimeout((toast as any).t);
    (toast as any).t = window.setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    if (!theme) return; // follow the system / host theme
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("hookky.theme", theme);
    } catch {}
  }, [theme]);

  // server capabilities
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((health) => setState({ health }))
      .catch(async () => {
        // No Hookky server: on claude.ai the page can still call Claude itself.
        const sample = await sampleCap;
        setState({ health: { agent: sample ? "hosted" : "local", transcription: "none", connectors: [] } });
      });
  }, []);

  // load all canvas fonts, then redraw. Open a moment into the first scene so the stage starts on a composed frame.
  useEffect(() => {
    clock.duration = Math.max(clock.duration, 1.2);
    clock.seek(1.2);
    Promise.all(FONT_CHOICES.flatMap((f) => [document.fonts.load(`400 40px "${f}"`), document.fonts.load(`700 40px "${f}"`)])).then(() => clock.seek(clock.time));
  }, []);

  useEffect(() => {
    images.setAssets(assets);
    clock.seek(clock.time);
  }, [assets]);

  // voice-over + music elements drive the clock
  useEffect(() => {
    const url = project.audio?.url;
    if (!url) return clock.setAudio(null);
    const a = new Audio(url);
    a.preload = "auto";
    clock.setAudio(a);
    return () => {
      a.pause();
      clock.setAudio(null);
    };
  }, [project.audio?.url]);
  useEffect(() => {
    const m = project.music;
    if (!m) return void (clock.music = null);
    const el = new Audio(m.url);
    el.loop = true;
    clock.music = el;
    const unsub = clock.subscribe(() => {
      const vo = getState().project.audio;
      const inPause = !vo || vo.pauses.some((p) => clock.time >= p.s && clock.time <= p.e) || clock.time > vo.duration;
      el.volume = Math.min(1, (getState().project.music?.volume ?? 0.25) * (inPause ? 1 : 0.4));
    });
    return () => {
      unsub();
      el.pause();
      clock.music = null;
    };
  }, [project.music?.url]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        clock.toggle();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const tl = timeline(getState().project.scenes);
        const i = Math.max(0, Math.min(tl.length - 1, getState().selected + (e.key === "ArrowRight" ? 1 : -1)));
        setState({ selected: i });
        clock.seek(tl[i].start + 0.001);
      } else if (e.key === "Home") clock.seek(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brandmark" href="/" aria-label="Hookky home">
          <Logo height={22} />
        </a>
        <input className="title-input" value={project.title} onChange={(e) => setState((s) => ({ project: { ...s.project, title: e.target.value } }))} />
        <span className="spacer" />
        <div className="seg" role="tablist" aria-label="Aspect ratio">
          {(["16:9", "9:16", "1:1", "4:5"] as Aspect[]).map((a) => (
            <button key={a} className={project.aspect === a ? "on" : ""} onClick={() => updateProject((p) => ({ ...p, aspect: a }))}>
              {a}
            </button>
          ))}
        </div>
        <select className="sel" value={project.style} onChange={(e) => setBrand({ style: e.target.value })} title="Style preset">
          {STYLE_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="btn icon ghost" title="Undo (⌘Z)" onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="btn icon ghost" title="Redo (⇧⌘Z)" onClick={redo}>
          <Icon name="redo" />
        </button>
        <button className="btn icon ghost" title="Toggle theme" onClick={() => setTheme((t) => ((t ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark"))}>
          <Icon name="sun" />
        </button>
        <button className="btn primary" onClick={() => setTab("Export")}>
          <Icon name="download" /> Export
        </button>
      </header>
      <div className="main">
        <ChatPanel />
        <section className="workspace">
          <div className="center">
            <Stage />
            <Timeline />
          </div>
          <aside className="side">
            <nav className="tabs">
              {TABS.map((t) => (
                <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t}
                </button>
              ))}
            </nav>
            <div className="side-body">
              {tab === "Scene" && <SceneInspector />}
              {tab === "Library" && <LibraryPanel toast={toast} />}
              {tab === "Brand" && <BrandPanel />}
              {tab === "Voice" && <VoicePanel toast={toast} />}
              {tab === "Export" && <ExportPanel toast={toast} />}
            </div>
          </aside>
        </section>
      </div>
      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
