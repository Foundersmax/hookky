import type { AgentEvent, ChatAttachment } from "../types";
import { getState, setState, pushChat, updateChat, applyStoryboard, applyPatch, setBrand, addAssets, updateProject } from "../store";
import { uid } from "../engine/util";
import { totalDuration } from "../engine/render";
import { sentences } from "../audio/analyze";
import { localDirector } from "./localDirector";
import { toAgentImage } from "../engine/images";

/** Compact snapshot of the studio the agent sees each turn. */
function studioState() {
  const { project: p, assets } = getState();
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
    assets: assets.slice(-60).map((a) => ({ id: a.id, title: a.title.slice(0, 60), source: a.source, kind: a.kind, w: a.w, h: a.h, palette: a.palette })),
    voiceover: vo || null,
  };
}

export async function sendToAgent(text: string, attachments: ChatAttachment[] = []) {
  const s = getState();
  if (s.busy) return;
  pushChat({ id: uid("m"), role: "user", text, attachments });
  const replyId = uid("m");
  pushChat({ id: replyId, role: "assistant", text: "", pending: true, activity: [] });
  setState({ busy: true });

  const runLocal = (note?: string) => {
    const r = localDirector(text, getState().project, getState().assets);
    if (r.style || r.name) setBrand({ ...(r.style && { style: r.style }), ...(r.name && { name: r.name }) });
    if (r.settings && Object.keys(r.settings).length) updateProject((p) => ({ ...p, ...r.settings }));
    if (r.storyboard) applyStoryboard(r.storyboard);
    updateChat(replyId, (m) => ({ ...m, text: (note ? note + "\n\n" : "") + r.reply, pending: false }));
  };

  try {
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
          const img = await toAgentImage(asset!.src);
          return { assetId: a.assetId!, ...img };
        }),
    );
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: s.conversationId, text, state: studioState(), images }),
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
        handle(ev, replyId);
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
      setBrand(ev.brand);
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
