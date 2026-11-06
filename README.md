<p align="left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="Hookky" height="48">
  </picture>
</p>

# Hookky

AI motion-graphics studio for product ads and launches. Chat with a creative agent on the right; watch the animation build live in the centre, with scene, library, brand, voice and export panels on the left.

- **Chat agent console**: describe a product, upload references or a voice-over, paste any link. The agent (Claude) storyboards, art-directs, and edits scenes using tools.
- **Live workspace**: a custom canvas motion engine with 13 minimal, modern templates, 8 transitions, brand presets, a scrubbable timeline, and a scene inspector.
- **Voice-over to animation**: upload a 30–60s VO. The studio finds natural pauses, transcribes it (or aligns your pasted script), and the agent builds scenes that cut on the pauses, with kinetic type synced word by word. Optional burn-in captions and a music bed that ducks under the voice.
- **Visual sources**: Pinterest, Freepik, Envato, Unsplash, Pexels, Openverse, plus **any URL** (Pinterest pins, Behance, Dribbble, product pages). Magnific upscaling for low-res references.
- **Export**: frame-accurate H.264 MP4 (WebCodecs) at 1080p in 16:9, 9:16, 1:1 and 4:5, all in one pass. Also PNG frames and project JSON.

## Quick start

```bash
npm install
```

```bash
cp .env.example .env   # add keys (all optional)
```

```bash
npm run dev            # http://localhost:5173  (API on :8787)
```

It runs with **no keys at all**. Without `ANTHROPIC_API_KEY` a built-in *local director* (rule-based) writes storyboards, so you can try the full flow. Add a key and the pill in the chat header switches to **Claude**.

For production: `npm run build && npm start` serves the built app and API on `PORT`.

### Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Foundersmax/hookky)

`render.yaml` defines one Node web service that builds the app and serves it with the API. Click the button (or in Render: **New → Blueprint** and pick this repo). Render asks for each secret when it creates the service:

- `HOOKKY_PASSWORD`: set this. Everyone who opens the URL uses your API keys, so the app asks for this password via the browser's sign-in prompt (any username). `/api/health` stays open for Render's health check.
- `ANTHROPIC_API_KEY` for the Claude agent, plus any connector or transcription keys from the table below. Leave the rest blank and add them later under **Environment**.

The Blueprint uses the `starter` plan so the service stays awake. Change `plan` to `free` to try it at no cost; free services sleep when idle and take a while to wake. The repo is private, so connect your GitHub account to Render first. Pushes to `main` redeploy automatically.

### Hosted on claude.ai

`npm run build:artifact` packs the app into one page (`dist-artifact/hookky.html`) that runs as a claude.ai Artifact with no server:

- The creative director runs on the viewer's own Claude account through the page's `sample` capability, and edits the storyboard through tools that run in the page. Viewers are asked to allow it on first use.
- Exports and saves go through the viewer's save prompt (`downloads` capability).
- Image search, link import and transcription need the Express server, so the hosted page asks for uploads instead and aligns a pasted script to the voice-over.

The app picks its mode at startup: Hookky server if `/api/health` answers, otherwise Claude through the host if available, otherwise the local director.

## Keys (`.env`)

| Variable | Unlocks |
|---|---|
| `HOOKKY_PASSWORD` | Password-protects a deploy (browser sign-in prompt, any username). Recommended on any public URL. |
| `ANTHROPIC_API_KEY` | The Claude creative agent (default model `claude-opus-5-5`, override with `CLAUDE_MODEL`). It uses vision on your uploads and web search for research (`CLAUDE_WEB_SEARCH=off` to disable). |
| `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY` | Free stock photo search |
| `FREEPIK_API_KEY` | Freepik stock search **and** the Magnific upscaler (Magnific's API is served through Freepik) |
| `ENVATO_TOKEN` | Envato **Market** search (GraphicRiver). Envato Elements has no public API, so use URL import for Elements pages. |
| `PINTEREST_ACCESS_TOKEN` | Searches **your own** pins and boards (Pinterest API v5 has no public global search). Any public pin URL also imports with no key. |
| `DEEPGRAM_API_KEY` or `OPENAI_API_KEY` | Automatic VO transcription with exact word timings. Without either, paste the script and Hookky aligns it to the detected speech. |

Openverse (800M+ openly licensed images) and URL import need no key.

## Built to hold up

- **Director's notes.** Every storyboard is reviewed automatically: copy length, reading time, pacing, a hook in the first 3 seconds, template repetition, missing images, contrast, and voice-over sync (total length and cuts that land mid-speech). Notes show in the Scene panel and on the timeline, Claude receives them after each edit and fixes the warnings itself, and **Fix with the agent** hands the rest over.
- **Nothing the agent sends can break the preview.** Scenes from Claude, files and old saves pass through a strict cleaner (`src/sanitize.ts`), and a per-scene render guard turns any drawing error into a quiet placeholder instead of a frozen canvas.
- **Crash recovery.** The chat, preview, timeline and each side panel have their own error boundary: a bug in one shows a "Reload this panel" card while the rest keeps working.
- **Durable autosave.** The project, asset library, chat and the voice-over and music files are saved to IndexedDB (hundreds of MB, not the ~5 MB of localStorage) and restored on reload. Photos are stored as JPEG unless they have transparency. If the browser refuses to save, the studio says so.

## Tests

```bash
npm test             # unit tests: cleaning, storyboard ops, timing, director's notes, server agent tools, URL safety
```

```bash
npm run test:engine  # renders every template × format × background × motion × transition, plus 300 fuzzed scenes, in Chromium
```

GitHub Actions (`.github/workflows/ci.yml`) runs type-check, unit tests, both builds and the engine test on every push and pull request.

## How it works

```
src/
  engine/render.ts     canvas renderer: templates, transitions, backgrounds, captions, grain, render guard
  sanitize.ts          strict cleaning of scenes, brands and projects from any source
  storyboard.ts        pure storyboard ops (build, patch, fit/snap to voice-over), shared with the server
  agent/lint.ts        Director's notes: the storyboard reviewer
  persist.ts           IndexedDB autosave, including voice-over and music files
  engine/text.ts       rich-text layout (*emphasis*), auto-fit, masked line reveals
  audio/analyze.ts     waveform, pause detection, script→word alignment
  agent/client.ts      streams the agent (SSE) and applies its tool calls to the project
  agent/localDirector  offline storyboard generator
  export.ts            WebCodecs + mp4-muxer export (MediaRecorder fallback)
  components/          chat, stage, timeline, scene/library/brand/voice/export panels
server/
  agent.ts             Claude tool loop: create_storyboard, update_scenes, set_brand,
                       search_visuals, import_url, plus web search
  connectors.ts        Pinterest, Freepik/Magnific, Envato, Unsplash, Pexels, Openverse, URL import
  transcribe.ts        Deepgram / Whisper word-level transcription
```

A project is a list of **scenes** (template, duration, copy, image refs, background, transition, motion). The agent writes that JSON through tools, so every edit is visible, undoable (⌘Z), and editable by hand in the Scene tab. Layouts are computed from the frame size, so one storyboard renders correctly in every aspect ratio.

Conversation history is kept server-side and only ever appended to, so prompt caching keeps working and Claude's reasoning carries across turns.

## Shortcuts

`Space` play/pause · `F` focus on the canvas (hide both sidebars) · `Esc` leave fullscreen preview · `=` / `-` zoom the timeline, `0` fit it (or ⌘/Ctrl + scroll; double-click a scene to zoom to it) · drag scenes on the timeline to reorder, or `Alt + ←/→` to move the selected scene · with a voice-over loaded, pause markers show on the timeline and resized cuts snap to them (hold `Alt` to resize freely; **Snap cuts** moves every cut onto its nearest pause) · `←/→` previous/next scene · `⌘Z / ⇧⌘Z` undo/redo · `Home` restart

## Notes

- Remote images go through `/api/img` (same-origin proxy) so they can be drawn and exported. Only public http(s) hosts are allowed.
- Check the licence of each reference before you publish. Each library card shows its source and links back to it.
- Everything autosaves in this browser (IndexedDB). Use **Export → Save project** to move a project to another browser or machine; the voice-over and music aren't included in that file.
