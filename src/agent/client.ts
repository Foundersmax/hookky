import type { AgentEvent, ChatAttachment, Direction } from "../types";
import { getState, setState, pushChat, updateChat, applyStoryboard, applyPatch, setBrand, addAssets, updateProject, buildCount, applyKit } from "../store";
import { uid } from "../engine/util";
import { totalDuration } from "../engine/render";
import { sentences } from "../audio/analyze";
import { localDirector, localDirections, wantsDirections } from "./localDirector";
import { contactSheets, sheetPreview, REVIEW_PROMPT, type Sheet } from "./frames";
import { toAgentImage } from "../engine/images";
import { hostedTurn } from "./hosted";
import { sanitizeBrand, sanitizeDirections } from "../sanitize";
import { lintStoryboard } from "./lint";

/** Director's notes for the current project. */
export function currentNotes() {
  const { project: p, assets } = getState();
  const audio = p.audio && { duration: p.audio.duration, pauses: p.audio.pauses, hasWords: !!p.audio.words?.length };
  return lintStoryboard({ scenes: p.scenes, brand: p.brand, assetIds: new Set(assets.map((a) => a.id)), audio });
}

/** Compact snapshot of the studio the agent sees each turn. */
function studioState() {
  const { project: p, assets, kits } = getState();
  const vo = p.audio && {
    file: p.audio.name,
    duration: +p.audio.duration.toFixed(2),
    pauses: p.audio.pauses.slice(0, 80).map((x) => [x.s, x.e]),
    transcript_source: p.audio.wordsSource ?? "none (ask the user to paste the script or enable transcription)",
    sentences: p.audio.words ? sentences(p.audio.words).map((s) => ({ s: s.s, e: s.e, text: s.text })) : undefined,
  };
  return {
    project: { title: p.title, aspect: p.aspect, style: p.style, brand: p.brand, captions: p.captions, total_seconds: +totalDuration(p).toFixed(2) },
    scenes: p.scenes.map(({ id, ...s }, i) => ({ index: i, ...s })),
    assets: assets.slice(-60).filter((a) => a.kind !== "font").map((a) => ({ id: a.id, title: a.title.slice(0, 60), source: a.source, kind: a.kind, w: a.w, h: a.h, ...(a.kind === "video" && { seconds: a.duration }), palette: a.palette })),
    voiceover: vo || null,
    brand_kits: kits.map((k) => ({ name: k.name, style: k.style, default: !!k.isDefault, brand: (({ bg, fg, accent, muted, fontDisplay, fontBody, logo }) => ({ bg, fg, accent, muted, fontDisplay, fontBody, logo }))(k.brand) })),
    director_notes: currentNotes().slice(0, 10).map((n) => `[${n.level}] ${n.message}`),
  };
}

export interface SendOptions {
  /** What the chat shows for the user's message; the agent receives `text`. */
  display?: string;
  /** Contact sheets for a visual review turn. */
  sheets?: Sheet[];
  review?: boolean;
  /** Building a direction pitched in an earlier reply. */
  direction?: { message: string; index: number };
}

const PACE_FACTOR = { punchy: 0.85, steady: 1, cinematic: 1.2 } as const;

/** What a direction-pick message asks the agent to do. */
export function directionBrief(d: Direction, n: number) {
  return `Build direction ${n} “${d.name}”: ${d.pitch} Style preset: ${d.style}. Motion: ${d.motion}. Pacing: ${d.pace}. Open with the line: ${d.hook}${d.accent ? `. Accent colour ${d.accent}` : ""}. Use the brief from earlier in our conversation.`;
}

/** Build the direction the user picked from a directions card. */
export function pickDirection(messageId: string, index: number) {
  const m = getState().chat.find((x) => x.id === messageId);
  const d = m?.directions?.[index];
  if (!d) return;
  return sendToAgent(directionBrief(d, index + 1), [], { display: `Go with “${d.name}”`, direction: { message: messageId, index } });
}

/** The local director builds a picked direction from the original brief. */
function buildDirectionLocally(messageId: string, index: number) {
  const m = getState().chat.find((x) => x.id === messageId);
  const d = m?.directions?.[index];
  if (!d) return "That direction is no longer in the chat.";
  const { project, assets } = getState();
  const r = localDirector(`${m!.brief ?? ""}\nbuild`, project, assets);
  if (!r.storyboard) return "Tell me about the product first, then pick a direction.";
  const factor = project.audio ? 1 : PACE_FACTOR[d.pace];
  let hooked = false;
  const scenes = r.storyboard.scenes.map((s) => {
    const out = { ...s, motion: d.motion, duration: +(s.duration * factor).toFixed(2) };
    if (!hooked && s.template === "title-reveal") (hooked = true), (out.headline = d.hook);
    return out;
  });
  if (r.name) setBrand({ name: r.name });
  if (r.settings && Object.keys(r.settings).length) updateProject((p) => ({ ...p, ...r.settings }));
  applyStoryboard({ ...r.storyboard, style: d.style, scenes });
  if (d.accent) setBrand({ accent: d.accent });
  return `Built “${d.name}”: ${d.pitch} (Drafted by the built-in local director. Connect Claude for the full creative agent.)`;
}

const REVIEW_KEY = "hookky:autoReview";
export const autoReviewOn = () => {
  try {
    return localStorage.getItem(REVIEW_KEY) !== "off";
  } catch {
    return true;
  }
};
export function setAutoReview(on: boolean) {
  try {
    localStorage.setItem(REVIEW_KEY, on ? "on" : "off");
  } catch {
    /* per-browser convenience only */
  }
}
/** Claude can look at frames; the local director can't. */
export const canReview = () => {
  const { health, project } = getState();
  return !!health && health.agent !== "local" && project.scenes.length > 0;
};

/** Render the cut as contact sheets and have Claude review it visually, fixing what it sees. */
export async function reviewFrames(auto = false) {
  const st = getState();
  if (st.busy || !canReview()) return false;
  const sheets = await contactSheets(st.project);
  if (!sheets.length) return false;
  const preview = await sheetPreview(sheets[0].url);
  await sendToAgent(REVIEW_PROMPT(sheets, st.project.scenes.length), [{ kind: "image", name: sheets.length > 1 ? `${sheets.length} contact sheets` : "Contact sheet", preview }], {
    display: auto ? "Visual review: checking the rendered frames" : "Review the rendered frames",
    sheets,
    review: true,
  });
  return true;
}

/** Ask for three creative directions for a brief. */
export function askForDirections(brief = "") {
  const t = brief.trim();
  return sendToAgent(t ? `Pitch me 3 creative directions for this, then wait for me to pick: ${t}` : "Pitch me 3 creative directions for this project, then wait for me to pick one.", [], { display: t ? undefined : "Pitch me 3 directions" });
}

export async function sendToAgent(text: string, attachments: ChatAttachment[] = [], opts: SendOptions = {}) {
  const s = getState();
  if (s.busy) return;
  pushChat({ id: uid("m"), role: "user", text: opts.display ?? text, attachments, ...(opts.review && { review: true }) });
  const replyId = uid("m");
  pushChat({ id: replyId, role: "assistant", text: "", pending: true, activity: [] });
  if (opts.direction) updateChat(opts.direction.message, (m) => ({ ...m, picked: opts.direction!.index }));
  setState({ busy: true });
  const builtBefore = buildCount();
  const showDirections = (directions: Direction[]) => updateChat(replyId, (m) => ({ ...m, directions, brief: m.brief ?? text }));

  const runLocal = (note?: string) => {
    const pre = note ? note + "\n\n" : "";
    if (opts.review) return updateChat(replyId, (m) => ({ ...m, text: pre + "Visual review needs Claude. Director's notes in the Scene panel still check copy, pacing and contrast.", pending: false }));
    if (opts.direction) {
      const reply = buildDirectionLocally(opts.direction.message, opts.direction.index);
      return updateChat(replyId, (m) => ({ ...m, text: pre + reply, pending: false }));
    }
    if (wantsDirections(text)) {
      const brief = text.replace(/^pitch me 3 creative directions for (this|this project)[^:]*:?\s*/i, "");
      const directions = localDirections(brief, getState().project);
      return updateChat(replyId, (m) => ({ ...m, text: pre + "Three ways we could take it. Pick one and I'll build it.", directions, brief, pending: false }));
    }
    // "use my Acme kit": the local director applies a saved kit named in the message.
    const kit = getState().kits.find((k) => text.toLowerCase().includes(k.name.toLowerCase()));
    if (kit) applyKit(kit.id);
    const r = localDirector(text, getState().project, getState().assets);
    if (kit) r.style = undefined; // keep the kit's look rather than a preset named in passing
    if (r.storyboard && kit) r.storyboard = { ...r.storyboard, style: undefined };
    if (kit) r.reply = `Using your “${kit.name}” kit. ${r.reply}`;
    if (r.style || r.name) setBrand({ ...(r.style && { style: r.style }), ...(r.name && { name: r.name }) });
    if (r.settings && Object.keys(r.settings).length) updateProject((p) => ({ ...p, ...r.settings }));
    if (r.storyboard) applyStoryboard(r.storyboard);
    updateChat(replyId, (m) => ({ ...m, text: (note ? note + "\n\n" : "") + r.reply, pending: false }));
  };

  try {
    if (s.health?.agent === "hosted") {
      const activity: string[] = [];
      try {
        const frames = await Promise.all((opts.sheets ?? []).map((sh) => fetch(sh.url).then((r) => r.blob())));
        const r = await hostedTurn(text, attachments, studioState(), {
          onText: (t) => updateChat(replyId, (m) => ({ ...m, text: t })),
          onActivity: (label) => (activity.push(label), updateChat(replyId, (m) => ({ ...m, activity: [...activity] }))),
          onDirections: (d) => showDirections(sanitizeDirections(d)),
        }, undefined, frames);
        updateChat(replyId, (m) => ({ ...m, text: r.text.trim() || "Done — have a look at the preview.", pending: false }));
      } catch (e: any) {
        const code = e?.code ?? "upstream_error";
        if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed", "tools_unavailable"].includes(code)) {
          setState((st) => ({ health: st.health && { ...st.health, agent: "local" } }));
          runLocal("Claude isn't enabled for this page, so the local director made this draft. Allow Claude when the page asks to get the full creative agent.");
        } else if (code === "cancelled") updateChat(replyId, (m) => ({ ...m, text: e.text || "Stopped.", pending: false }));
        else {
          const copy: Record<string, string> = {
            rate_limited: "You've hit a usage limit for now. Try again in a little while.",
            session_expired: "Your Claude session expired. Sign in again, then resend.",
            refused: "Claude declined that request. Try rephrasing the brief.",
            prompt_too_large: "That was too much to send at once. Try a shorter brief or fewer images.",
            image_rejected: "One of the images couldn't be used. Try a JPEG or PNG under 20 MB.",
          };
          updateChat(replyId, (m) => ({ ...m, text: (e.text ? e.text + "\n\n" : "") + (copy[code] ?? "Claude couldn't finish that. Send it again to retry."), error: !e.text, pending: false }));
        }
      }
      return;
    }
    if (s.health?.agent !== "claude") {
      await new Promise((r) => setTimeout(r, 450));
      runLocal();
      return;
    }
    const images = await Promise.all(
      attachments
        .filter((a) => a.kind === "image" && a.assetId)
        .map(async (a) => {
          const asset = getState().assets.find((x) => x.id === a.assetId);
          // Video clips are shown to Claude as their poster frame.
          const img = await toAgentImage(asset!.kind === "video" ? asset!.thumb ?? "" : asset!.src);
          return { assetId: a.assetId!, ...img };
        }),
    );
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: s.conversationId, text, state: studioState(), images, frames: (opts.sheets ?? []).map((sh) => ({ mediaType: "image/jpeg", data: sh.url.split(",")[1] })) }),
    });
    if (!res.ok || !res.body) throw new Error(`Agent unavailable (${res.status})`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let fatal = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (!chunk.startsWith("data: ")) continue;
        const ev = JSON.parse(chunk.slice(6)) as AgentEvent;
        if (ev.type === "directions") showDirections(sanitizeDirections(ev.directions));
        else handle(ev, replyId);
        if (ev.type === "error") fatal = ev.message;
      }
    }
    const msg = getState().chat.find((m) => m.id === replyId);
    if (fatal && !msg?.text) {
      if (/credentials/i.test(fatal)) {
        setState((st) => ({ health: st.health && { ...st.health, agent: "local" } }));
        runLocal(fatal);
      } else updateChat(replyId, (m) => ({ ...m, text: fatal, error: true, pending: false }));
    } else updateChat(replyId, (m) => ({ ...m, pending: false, text: m.text || "Done — have a look at the preview." }));
  } catch (e: any) {
    runLocal(`Couldn't reach Claude (${e.message}). Used the local director instead.`);
  } finally {
    setState({ busy: false });
    // A fresh storyboard from Claude gets one look at its own rendered frames (the hosted and
    // fallback paths return early, so this lives here).
    const reply = getState().chat.find((m) => m.id === replyId);
    if (!opts.review && buildCount() > builtBefore && !reply?.error && autoReviewOn() && canReview()) void reviewFrames(true).catch(() => {});
  }
}

function handle(ev: AgentEvent, id: string) {
  switch (ev.type) {
    case "text":
      updateChat(id, (m) => ({ ...m, text: m.text + ev.delta }));
      break;
    case "thinking":
      updateChat(id, (m) => ({ ...m, thinking: (m.thinking ?? "") + ev.delta }));
      break;
    case "activity":
      updateChat(id, (m) => ({ ...m, activity: [...(m.activity ?? []), ev.label] }));
      break;
    case "assets":
      addAssets(ev.assets);
      break;
    case "storyboard":
      applyStoryboard(ev.storyboard);
      break;
    case "patch":
      applyPatch(ev.ops);
      break;
    case "brand":
      setBrand(sanitizeBrand(ev.brand));
      break;
    case "kit":
      applyKit(ev.name);
      break;
    case "settings":
      updateProject((p) => ({ ...p, ...ev.settings }));
      break;
  }
}

export async function resetAgent() {
  const { conversationId } = getState();
  fetch("/api/agent/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId }) }).catch(() => {});
  setState({ chat: [], conversationId: uid("c") });
}
