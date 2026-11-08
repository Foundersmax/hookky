import { useEffect, useState } from "react";
import { useStudio, setState, getState, undo, redo, updateProject, setBrand, createProject, flushSave } from "./store";
import { ChatPanel } from "./components/ChatPanel";
import { Stage } from "./components/Stage";
import { Timeline, moveScene } from "./components/Timeline";
import { SceneInspector } from "./components/SceneInspector";
import { LibraryPanel } from "./components/LibraryPanel";
import { BrandPanel } from "./components/BrandPanel";
import { VoicePanel } from "./components/VoicePanel";
import { ExportPanel } from "./components/ExportPanel";
import { Icon } from "./components/Icon";
import { Logo } from "./components/Logo";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ShortcutsSheet } from "./components/ShortcutsSheet";
import { Home } from "./components/Home";
import { Versions } from "./components/Versions";
import { CommandPalette } from "./components/CommandPalette";
import { clock } from "./clock";
import { images } from "./runtime";
import { STYLE_PRESETS, FONT_CHOICES } from "./presets";
import type { Aspect } from "./types";
import { timeline } from "./engine/render";
import { registerFonts } from "./fonts";
import { reportStockUse } from "./stockUsage";
import { fillVideoPosters } from "./videoPosters";
import { checkSession, watchSession } from "./auth";
import { AuthScreen } from "./components/AuthScreen";
import { AdminPanel } from "./components/AdminPanel";
import { UserMenu } from "./components/UserMenu";
import { sampleCap } from "./host";

const TABS = ["Scene", "Library", "Brand", "Voice", "Export"] as const;

export function App() {
  const project = useStudio((s) => s.project);
  const assets = useStudio((s) => s.assets);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Scene");
  const [toastMsg, setToast] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  // Desktop panel visibility: hide either sidebar to give the canvas more room.
  const [panels, setPanels] = useState<{ left: boolean; right: boolean }>(() => {
    try {
      return { left: true, right: true, ...JSON.parse(localStorage.getItem("hookky.panels") || "{}") };
    } catch {
      return { left: true, right: true };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("hookky.panels", JSON.stringify(panels));
    } catch {}
  }, [panels]);
  const focused = !panels.left && !panels.right;
  const toggleTheme = () => setTheme((t) => ((t ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark" ? "light" : "dark"));
  const toggleFocus = () => setPanels(focused ? { left: true, right: true } : { left: false, right: false });
  const [theme, setTheme] = useState<"dark" | "light" | null>(() => {
    try {
      return (localStorage.getItem("hookky.theme") as "dark" | "light") || null;
    } catch {
      return null;
    }
  });

  const view = useStudio((s) => s.view);
  const goHome = () => {
    clock.pause();
    flushSave();
    setState({ view: "home" });
  };
  const notice = useStudio((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    toast(notice);
    setState({ notice: undefined });
  }, [notice]);
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
      .then(async (health) => {
        setState({ health });
        if (!health.accounts) return setState({ auth: { status: "off" } });
        watchSession();
        await checkSession();
        // An admin arriving from a "new sign-up" email goes straight to the approvals list.
        const st = getState();
        if (st.auth.user?.role === "admin" && new URL(location.href).searchParams.get("admin") === "pending") setState({ view: "admin" });
      })
      .catch(async () => {
        // No Hookky server: on claude.ai the page can still call Claude itself.
        const sample = await sampleCap;
        setState({ health: { agent: sample ? "hosted" : "local", transcription: "none", connectors: [] }, auth: { status: "off" } });
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
    // brand fonts: register any new ones, then redraw with them
    registerFonts(assets).then((loaded) => loaded && clock.seek(clock.time));
    fillVideoPosters(assets);
  }, [assets]);

  // Stock sources that require it are told when one of their clips is used (server mode only).
  const scenesForReports = useStudio((s) => s.project.scenes);
  const serverMode = useStudio((s) => !!s.health?.connectors.length);
  useEffect(() => {
    if (serverMode) reportStockUse(getState().project, getState().assets);
  }, [scenesForReports, assets, serverMode]);

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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      const tag = (e.target as HTMLElement).tagName;
      const type = (e.target as HTMLInputElement).type;
      const typing = tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !["range", "checkbox", "radio", "button", "color"].includes(type)) || (e.target as HTMLElement).isContentEditable;
      if (typing) return;
      if (e.key === "?") {
        e.preventDefault();
        setShowKeys(true);
        return;
      }
      if (getState().view === "home") return; // studio shortcuts only apply in the studio
      if (e.code === "Space") {
        e.preventDefault();
        if (tag === "BUTTON" || tag === "INPUT") (e.target as HTMLElement).blur(); // stop the focused control also reacting on keyup
        clock.toggle();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.altKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        const i = getState().selected;
        moveScene(i, i + (e.key === "ArrowRight" ? 1 : -1));
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const tl = timeline(getState().project.scenes);
        const i = Math.max(0, Math.min(tl.length - 1, getState().selected + (e.key === "ArrowRight" ? 1 : -1)));
        setState({ selected: i });
        clock.seek(tl[i].start + 0.001);
      } else if (e.key === "Home") clock.seek(0);
      else if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey && !e.altKey) setPanels((p) => (!p.left && !p.right ? { left: true, right: true } : { left: false, right: false }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const auth = useStudio((s) => s.auth);
  if (auth.status === "checking") return <div className="app booting" aria-busy="true" />;
  if (auth.status === "signed_out")
    return (
      <>
        <AuthScreen />
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </>
    );

  return (
    <div className="app">
      <header className="topbar">
        <button className="brandmark" onClick={goHome} aria-label="All projects">
          <Logo height={22} />
        </button>
        <nav className="crumbs" aria-label="Breadcrumb">
          <button className={`crumb ${view === "home" ? "on" : ""}`} onClick={goHome} aria-current={view === "home" ? "page" : undefined}>
            Projects
          </button>
          {view === "studio" && (
            <>
              <span className="crumb-sep" aria-hidden>/</span>
              <input className="title-input" value={project.title} aria-label="Project name" onChange={(e) => setState((s) => ({ project: { ...s.project, title: e.target.value } }))} />
            </>
          )}
          {view === "admin" && (
            <>
              <span className="crumb-sep" aria-hidden>/</span>
              <span className="crumb on" aria-current="page">People</span>
            </>
          )}
        </nav>
        <span className="spacer" />
        {view === "studio" && (<>
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
        <div className="panel-toggles">
          <button className={`btn icon ghost ${panels.left ? "on" : ""}`} title={panels.left ? "Hide panels" : "Show panels"} aria-pressed={panels.left} onClick={() => setPanels((p) => ({ ...p, left: !p.left }))}>
            <Icon name="panelLeft" />
          </button>
          <button className={`btn icon ghost ${focused ? "on" : ""}`} title={focused ? "Exit focus (F)" : "Focus on the canvas (F)"} aria-pressed={focused} onClick={toggleFocus}>
            <Icon name="focus" />
          </button>
          <button className={`btn icon ghost ${panels.right ? "on" : ""}`} title={panels.right ? "Hide chat" : "Show chat"} aria-pressed={panels.right} onClick={() => setPanels((p) => ({ ...p, right: !p.right }))}>
            <Icon name="panelRight" />
          </button>
        </div>
        <button className="btn icon ghost hide-sm" title="Undo (⌘Z)" aria-label="Undo" onClick={undo}>
          <Icon name="undo" />
        </button>
        <button className="btn icon ghost hide-sm" title="Redo (⇧⌘Z)" aria-label="Redo" onClick={redo}>
          <Icon name="redo" />
        </button>
        <div className="hide-xs" style={{ display: "contents" }}>
          <Versions toast={toast} />
        </div>
        </>)}
        <button className="btn ghost cmdk hide-xs" title="Command bar (⌘K)" aria-label="Command bar" onClick={() => setShowPalette(true)}>
          <Icon name="search" /> <span>Search or ask…</span> <kbd>⌘K</kbd>
        </button>
        <button className="btn icon ghost hide-xs" title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
          <Icon name="sun" />
        </button>
        {view === "studio" ? (
          <button className="btn primary" onClick={() => setTab("Export")}>
            <Icon name="download" /> Export
          </button>
        ) : (
          <button className="btn primary" onClick={() => createProject("blank")}>
            <Icon name="plus" /> New project
          </button>
        )}
        <UserMenu />
      </header>
      {view === "admin" ? (
        <ErrorBoundary area="people page">
          <AdminPanel />
        </ErrorBoundary>
      ) : view === "home" ? (
        <ErrorBoundary area="projects page">
          <Home />
        </ErrorBoundary>
      ) : (
      <div className={`main ${panels.left ? "" : "hide-left"} ${panels.right ? "" : "hide-right"}`}>
        <ErrorBoundary area="chat" className="chat">
          <ChatPanel />
        </ErrorBoundary>
        <section className="workspace">
          <div className="center">
            <ErrorBoundary area="preview">
              <Stage />
            </ErrorBoundary>
            <ErrorBoundary area="timeline">
              <Timeline />
            </ErrorBoundary>
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
              <ErrorBoundary area={`${tab} panel`} key={tab}>
                {tab === "Scene" && <SceneInspector />}
                {tab === "Library" && <LibraryPanel toast={toast} />}
                {tab === "Brand" && <BrandPanel />}
                {tab === "Voice" && <VoicePanel toast={toast} />}
                {tab === "Export" && <ExportPanel toast={toast} />}
              </ErrorBoundary>
            </div>
          </aside>
        </section>
      </div>
      )}
      {toastMsg && <div className="toast">{toastMsg}</div>}
      {showKeys && <ShortcutsSheet onClose={() => setShowKeys(false)} />}
      {showPalette && (
        <CommandPalette
          host={{
            close: () => setShowPalette(false),
            openTab: (t) => (setState({ view: "studio" }), setTab(t)),
            toggleFocus,
            toggleTheme,
            showKeys: () => setShowKeys(true),
            toast,
          }}
        />
      )}
    </div>
  );
}
