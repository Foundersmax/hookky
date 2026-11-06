# Hookky

AI motion-graphics studio for product ads and launches. Chat with a creative agent on the left; watch the animation build live on the right.

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

## Keys (`.env`)

| Variable | Unlocks |
|---|---|
| `ANTHROPIC_API_KEY` | The Claude creative agent (default model `claude-opus-5-5`, override with `CLAUDE_MODEL`). It uses vision on your uploads and web search for research (`CLAUDE_WEB_SEARCH=off` to disable). |
| `UNSPLASH_ACCESS_KEY`, `PEXELS_API_KEY` | Free stock photo search |
| `FREEPIK_API_KEY` | Freepik stock search **and** the Magnific upscaler (Magnific's API is served through Freepik) |
| `ENVATO_TOKEN` | Envato **Market** search (GraphicRiver). Envato Elements has no public API, so use URL import for Elements pages. |
| `PINTEREST_ACCESS_TOKEN` | Searches **your own** pins and boards (Pinterest API v5 has no public global search). Any public pin URL also imports with no key. |
| `DEEPGRAM_API_KEY` or `OPENAI_API_KEY` | Automatic VO transcription with exact word timings. Without either, paste the script and Hookky aligns it to the detected speech. |

Openverse (800M+ openly licensed images) and URL import need no key.

## How it works

```
src/
  engine/render.ts     canvas renderer: templates, transitions, backgrounds, captions, grain
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

`Space` play/pause · `←/→` previous/next scene · `⌘Z / ⇧⌘Z` undo/redo · `Home` restart

## Notes

- Remote images go through `/api/img` (same-origin proxy) so they can be drawn and exported. Only public http(s) hosts are allowed.
- Check the licence of each reference before you publish. Each library card shows its source and links back to it.
- Uploaded images persist in browser storage. Audio files do not persist; re-upload the VO after a reload.
