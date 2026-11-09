import { useEffect, useMemo, useRef, useState } from "react";
import { useStudio, getState, setState, updateProject, setBrand, undo, redo, openProject, createProject, saveVersion, normalizeScene, fitToVoiceover, snapCutsToPauses, applyKit } from "../store";
import { STYLE_PRESETS } from "../presets";
import { STARTERS } from "../starters";
import { TEMPLATES, type Aspect, type Scene } from "../types";
import { clock } from "../clock";
import { sendToAgent, reviewFrames, askForDirections, autoReviewOn, setAutoReview } from "../agent/client";
import { score } from "../fuzzy";
import { LOOKS } from "../engine/fx";

export interface PaletteHost {
  close: () => void;
  openTab: (t: "Scene" | "Library" | "Brand" | "Voice" | "Export") => void;
  toggleFocus: () => void;
  toggleTheme: () => void;
  showKeys: () => void;
  toast: (s: string) => void;
}

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keys?: string;
  run: () => void;
}

/** Sensible starting content for a scene added from the palette. */
export const STARTER_CONTENT: Partial<Record<Scene["template"], Partial<Scene>>> = {
  "title-reveal": { kicker: "Introducing", headline: "New *headline*" },
  "kinetic-words": { headline: "Say it in *motion*." },
  "product-hero": { headline: "Meet the *product*" },
  "split-feature": { kicker: "Feature", headline: "Why it *matters*" },
  "feature-list": { headline: "Built for you", items: ["First benefit", "Second benefit", "Third benefit"] },
  "stat-counter": { stat: { value: 100, suffix: "%", label: "a number that proves it" } },
  "image-mosaic": { headline: "In the *wild*" },
  fullbleed: { headline: "Big *moment*" },
  quote: { headline: "The best thing we've tried this year.", author: "A happy customer" },
  marquee: { headline: "Now available" },
  "shape-burst": {},
  "logo-sting": {},
  "cta-end": { headline: "Get it *today*", cta: "Shop now" },
  "device-mockup": { kicker: "The app", headline: "Everything in *one place*", subline: "Drop a screenshot to fill the screen." },
  countdown: { kicker: "Launching in", stat: { value: 3 }, headline: "Now *live*" },
  "price-card": { kicker: "Pro", stat: { value: 29, prefix: "$", suffix: "/mo", label: "Billed monthly" }, items: ["Unlimited projects", "4K export", "Priority support"], cta: "Choose Pro" },
  testimonials: { headline: "Loved by *teams*", items: ["It changed how we launch. — Ana, Lumen", "Our fastest ads yet. — Kofi, Orbit"] },
  "before-after": { headline: "See the *difference*", items: ["Before", "After"] },
  "logo-reveal": { subline: "Made to move" },
  audiogram: { kicker: "Episode 12", headline: "The *quiet* launch", subline: "Upload a voice-over to see it move." },
  "text-mask": { headline: "BOLD", subline: "Drop a clip: it plays inside the letters." },
  chat: { kicker: "Orbit", items: ["does it actually work?", "> try it free for 7 days", "ok I'm sold 😍"], headline: "Try it *free*" },
  notification: { kicker: "9:41", items: ["Orbit: Your order has shipped 📦", "Messages: where did you get that?"], headline: "Everyone's *asking*" },
  "pov-caption": { kicker: "POV:", headline: "you finally found the *one*" },
  versus: { headline: "Why switch?", items: ["Setup in minutes", "No hidden fees", "Human support"], kicker: "Others", cta: "Orbit" },
  rating: { stat: { value: 4.9, label: "from 2,000+ reviews" }, headline: "Best purchase this year", author: "Maya R." },
  spotlight: { headline: "Meet *Orbit*", subline: "Drop a product shot." },
  "word-stack": { headline: "Stop *scrolling* start moving" },
  "word-slam": { headline: "This changes *everything*" },
  scramble: { headline: "Decode the *future*" },
  "zoom-through": { headline: "Faster than *ever*" },
  "letter-wave": { headline: "Feel the *rhythm*" },
  "outline-fill": { headline: "Every word *lands*" },
  "flip-words": { headline: "Bold *moves* only" },
  typewriter: { headline: "Write it. Ship it. *Win*." },
  "echo-stack": { headline: "*Louder*" },
  "icon-hero": { icons: ["lucide:sparkles"], headline: "Made *simple*" },
  "icon-list": { headline: "Why it *works*", items: ["Fast", "Secure", "Simple"], icons: ["lucide:zap", "lucide:shield-check", "lucide:check-circle"] },
  "metric-ring": { stat: { value: 87, suffix: "%", label: "of users feel the difference" }, icons: ["lucide:heart-pulse"] },
  "process-flow": { headline: "How it *works*", items: ["Sign up", "Connect", "Launch"], icons: ["lucide:user", "lucide:link", "lucide:rocket"] },
  "bar-compare": { headline: "Battery *life*", items: ["Others | 2 days", "Orbit | 10 days"] },
  "icon-orbit": { headline: "Everything, *connected*", icons: ["lucide:watch", "lucide:smartphone", "lucide:heart-pulse", "lucide:moon", "lucide:activity", "lucide:music"] },
  "line-chart": { headline: "Revenue, *up and to the right*", items: ["Jan | $12k", "Feb | $18k", "Mar | $16k", "Apr | $27k", "May | $34k", "Jun | $48k"] },
  "column-chart": { headline: "Customers by *year*", items: ["2022 | 1.2k", "2023 | 2.9k", "2024 | 5.4k", "2025 | 9.8k"] },
  "donut-chart": { headline: "Where they *shop*", items: ["Mobile | 64%", "Desktop | 28%", "Tablet | 8%"] },
  "kpi-grid": { headline: "By the *numbers*", items: ["Users | 120k", "Countries | 40", "Rating | 4.9", "Uptime | 99.9%"], icons: ["lucide:users", "lucide:globe", "lucide:star", "lucide:zap"] },
  "world-map": { headline: "Now in *five cities*", items: ["London", "Lagos", "New York", "Dubai", "Singapore"] },
  dashboard: { headline: "Everything in *one view*", kicker: "Overview", items: ["Revenue | $48.2k | +12%", "Active users | 8,940 | +8%", "Conversion | 3.8% | +0.6%"], stat: { value: 48200, prefix: "$", label: "Revenue this month" } },
  "dashboard-focus": { headline: "A *tour* of the product", items: ["Live revenue", "Trends at a glance", "Where it comes from", "Every order, tracked"] },
  "live-metrics": { headline: "Happening *right now*", items: ["New order | $49 · Lagos", "New sign-up | from Instagram", "Payment received | $129"], stat: { value: 1284, label: "orders today" }, icons: ["lucide:shopping-bag", "lucide:user", "lucide:credit-card"] },
  "route-map": { headline: "At your door, *fast*", items: ["Kitchen", "Your door"], stat: { value: 18, suffix: "min", label: "Arriving in" }, icons: ["lucide:bike"] },
};
/** Starting lengths that give each template's starter copy time to read. */
export const START_DURATION: Partial<Record<Scene["template"], number>> = {
  "feature-list": 5, quote: 4.5, "price-card": 7, testimonials: 6.5, "device-mockup": 4.5, countdown: 4.5, "before-after": 5, "logo-reveal": 3, "shape-burst": 2, "stat-counter": 3.5,
};
const TEMPLATE_NAMES: Record<string, string> = {
  "title-reveal": "Title reveal", "kinetic-words": "Kinetic words", "product-hero": "Product hero", "split-feature": "Split feature", "feature-list": "Feature list",
  "stat-counter": "Stat counter", "image-mosaic": "Image mosaic", fullbleed: "Full-bleed image", quote: "Quote", marquee: "Marquee", "shape-burst": "Shape burst", "logo-sting": "Logo sting", "cta-end": "End card",
  "device-mockup": "Device mockup", countdown: "Countdown", "price-card": "Price card", testimonials: "Testimonials", "before-after": "Before / after", "logo-reveal": "Logo reveal", audiogram: "Audiogram",
  "text-mask": "Text mask", chat: "Chat thread", notification: "Notifications", "pov-caption": "POV caption", versus: "Versus", rating: "Star rating", spotlight: "Spotlight", "word-stack": "Word stack",
  "word-slam": "Word slam", scramble: "Scramble", "zoom-through": "Zoom through", "letter-wave": "Letter wave", "outline-fill": "Outline fill", "flip-words": "Flip words", typewriter: "Typewriter", "echo-stack": "Echo stack",
  "icon-hero": "Icon hero", "icon-list": "Icon list", "metric-ring": "Metric ring", "process-flow": "Process flow", "bar-compare": "Bar compare", "icon-orbit": "Icon orbit", "line-chart": "Line chart", "column-chart": "Column chart", "donut-chart": "Donut chart", "kpi-grid": "KPI grid", "world-map": "World map", "route-map": "Route map", dashboard: "Dashboard", "dashboard-focus": "Dashboard tour", "live-metrics": "Live metrics",
};

export function CommandPalette({ host }: { host: PaletteHost }) {
  const view = useStudio((s) => s.view);
  const projects = useStudio((s) => s.projects);
  const project = useStudio((s) => s.project);
  const health = useStudio((s) => s.health);
  const kits = useStudio((s) => s.kits);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => prev?.focus?.();
  }, []);

  const commands = useMemo<Command[]>(() => {
    const c: Command[] = [];
    const studio = view === "studio";
    const add = (group: string, id: string, label: string, run: () => void, extra: Partial<Command> = {}) => c.push({ group, id, label, run, ...extra });

    if (studio) {
      add("Playback", "play", clock.playing ? "Pause" : "Play", () => clock.toggle(), { keys: "Space" });
      add("Playback", "fullscreen", "Fullscreen preview", () => window.dispatchEvent(new Event("hookky:fullscreen")));
      add("Playback", "start", "Back to the start", () => clock.seek(0), { keys: "Home" });
      add("Agent", "directions", "Pitch 3 creative directions", () => askForDirections(), { hint: "cards to pick from" });
      if (health?.agent && health.agent !== "local") {
        add("Agent", "review", "Review the rendered frames", () => reviewFrames(), { hint: "Claude looks and fixes" });
        const on = autoReviewOn();
        add("Agent", "auto-review", on ? "Turn auto visual review off" : "Turn auto visual review on", () => (setAutoReview(!on), host.toast(on ? "Claude won't review new storyboards automatically" : "Claude will review each new storyboard's frames")));
      }
      add("Studio", "formats", "Creative formats…", () => setState({ sheet: "formats" }), { hint: "21 attention structures, written by Claude" });
      add("Studio", "footage", "Footage from the voice-over…", () => setState({ sheet: "footage" }), { hint: "stock footage for every line" });
      add("Studio", "sound", "Sound templates…", () => setState({ sheet: "sound" }), { hint: "cut an ad to a voice-over or a track" });
      add("Studio", "export", "Export video…", () => host.openTab("Export"));
      add("Studio", "export-gif", "Export a GIF…", () => host.openTab("Export"), { hint: "a scene or the whole cut" });
      add("Studio", "export-captions", "Download captions (.srt / .vtt)…", () => host.openTab("Export"));
      add("Studio", "export-poster", "Save posters / thumbnails…", () => host.openTab("Export"), { hint: "up to 4K PNG" });
      add("Studio", "version", "Save a version", () => saveVersion().then((v) => host.toast(`Saved version “${v.name}”`)));
      add("Studio", "undo", "Undo", undo, { keys: "⌘Z" });
      add("Studio", "redo", "Redo", redo, { keys: "⇧⌘Z" });
      add("Studio", "focus", "Focus on the canvas", host.toggleFocus, { keys: "F" });
      add("Studio", "captions", project.captions ? "Turn captions off" : "Turn captions on", () => updateProject((p) => ({ ...p, captions: !p.captions })));
      add("Studio", "grain", project.grain ? "Turn film grain off" : "Turn film grain on", () => updateProject((p) => ({ ...p, grain: !p.grain })));
      if (project.audio) {
        const audio = project.audio;
        add("Voice-over", "fit", "Fit scenes to the voice-over", () => updateProject((p) => ({ ...p, scenes: fitToVoiceover(p.scenes, audio) })));
        add("Voice-over", "snap", "Snap cuts to pauses", () => {
          const r = snapCutsToPauses(getState().project.scenes, audio);
          if (r.moved) updateProject((p) => ({ ...p, scenes: r.scenes }));
          host.toast(r.moved ? `Moved ${r.moved} cut${r.moved === 1 ? "" : "s"} onto pauses` : "Cuts already sit on pauses");
        });
      }
      for (const a of ["16:9", "9:16", "1:1", "4:5"] as Aspect[])
        if (a !== project.aspect) add("Format", `aspect-${a}`, `Format: ${{ "16:9": "landscape", "9:16": "vertical", "1:1": "square", "4:5": "portrait" }[a]} (${a})`, () => updateProject((p) => ({ ...p, aspect: a })), { hint: { "16:9": "YouTube, web", "9:16": "Reels, TikTok, Shorts", "1:1": "feed posts", "4:5": "Instagram feed" }[a] });
      for (const l of LOOKS) {
        const fx = { grade: l.grade, effects: [...l.effects], fxAmount: l.amount };
        add("Effects", `look-${l.id}`, `Look: ${l.label} on this scene`, () => {
          const i = getState().selected;
          updateProject((p) => ({ ...p, scenes: p.scenes.map((s, j) => (j === i ? { ...s, ...fx } : s)) }));
        }, { hint: l.note });
        add("Effects", `look-all-${l.id}`, `Look: ${l.label} on every scene`, () => updateProject((p) => ({ ...p, scenes: p.scenes.map((s) => ({ ...s, ...fx })) })));
      }
      add("Effects", "fx-off", "Remove all effects", () => updateProject((p) => ({ ...p, scenes: p.scenes.map(({ grade: _g, effects: _e, fxAmount: _a, ...s }) => s) })));
      for (const k of kits) add("Brand kits", `kit-${k.id}`, `Apply kit: ${k.name}`, () => (applyKit(k.id), host.toast(`Applied “${k.name}”`)), { hint: k.isDefault ? "default for new projects" : undefined });
      for (const s of STYLE_PRESETS) if (s.id !== project.style) add("Style", `style-${s.id}`, `Style: ${s.label}`, () => setBrand({ style: s.id }), { hint: s.mood });
      for (const t of TEMPLATES)
        add("Add scene", `scene-${t}`, `Add ${TEMPLATE_NAMES[t] ?? t}`, () => {
          const at = Math.min(getState().selected + 1, getState().project.scenes.length);
          updateProject((p) => ({ ...p, scenes: [...p.scenes.slice(0, at), normalizeScene({ template: t, duration: START_DURATION[t] ?? 3.5, ...STARTER_CONTENT[t] }), ...p.scenes.slice(at)] }));
          setState({ selected: at });
          host.openTab("Scene");
        }, { hint: "after the selected scene" });
      for (const t of ["Scene", "Library", "Brand", "Voice", "Export"] as const) add("Panels", `tab-${t}`, `Open ${t} panel`, () => host.openTab(t));
    }

    add("Projects", "home", "Go to projects", () => setState({ view: "home" }));
    for (const s of STARTERS) add("Projects", `new-${s.id}`, `New project: ${s.name}`, () => createProject(s.id), { hint: s.blurb });
    for (const m of projects) if (!(studio && m.id === project.id)) add("Projects", `open-${m.id}`, `Open “${m.title}”`, () => openProject(m.id), { hint: `${m.aspect} · ${m.scenes} scenes` });
    add("App", "theme", "Toggle light / dark theme", host.toggleTheme);
    add("App", "keys", "Keyboard shortcuts", host.showKeys, { keys: "?" });
    return c;
  }, [view, projects, project.id, project.aspect, project.style, project.captions, project.grain, project.audio, health?.agent, kits]);

  const query = q.trim().toLowerCase();
  const results = useMemo(() => {
    const scored = commands
      .map((c) => {
        let s = Math.max(score(query, c.label), score(query, `${c.group} ${c.label}`) - 5, c.hint ? score(query, c.hint) - 25 : -1);
        // In the studio, editing this project outranks starting or opening another one.
        if (s > 0 && view === "studio" && c.group === "Projects") s -= 20;
        return { c, s };
      })
      .filter((r) => r.s >= 0);
    if (query) scored.sort((a, b) => b.s - a.s);
    const out = scored.map((r) => r.c);
    // Anything that isn't a command can go straight to the creative agent.
    if (query && view === "studio" && q.trim().split(/\s+/).length >= 2 && !(out[0] && score(query, out[0].label) >= 55)) {
      out.unshift({ id: "ask", group: "Ask the agent", label: `Ask: “${q.trim()}”`, hint: health?.agent === "local" ? "local director" : "Claude", run: () => sendToAgent(q.trim()) });
    }
    return out.slice(0, 60);
  }, [commands, query, q, view, health?.agent]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = (c?: Command) => {
    if (!c) return;
    host.close();
    c.run();
  };

  let lastGroup = "";
  return (
    <div className="sheet-backdrop palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && host.close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command bar">
        <input
          ref={input}
          className="palette-input"
          placeholder={view === "studio" ? "Type a command, or ask the agent…" : "Search projects and commands…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Command"
          aria-controls="palette-list"
          aria-activedescendant={results[active] ? `cmd-${results[active].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(results.length - 1, a + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
            else if (e.key === "Enter") (e.preventDefault(), run(results[active]));
            else if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), host.close());
          }}
        />
        <ul className="palette-list" id="palette-list" role="listbox" ref={list}>
          {results.map((c, i) => {
            const header = c.group !== lastGroup && !query ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <button
                  id={`cmd-${c.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-i={i}
                  className={`palette-item ${i === active ? "on" : ""} ${c.id === "ask" ? "ask" : ""}`}
                  onPointerMove={() => setActive(i)}
                  onClick={() => run(c)}
                >
                  <span className="palette-label">{c.label}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                  {c.keys && <kbd>{c.keys}</kbd>}
                </button>
              </li>
            );
          })}
          {!results.length && <li className="palette-empty">No matching commands.</li>}
        </ul>
        <div className="palette-foot">
          <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span>
          <span><kbd>Enter</kbd> to run</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
