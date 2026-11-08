// Transactional email through Brevo (api.brevo.com/v3/smtp/email). Without BREVO_API_KEY the
// message is printed to the server log instead, so local development works with no setup.
const env = (k: string) => process.env[k]?.trim() || "";

export const mailConfigured = () => !!env("BREVO_API_KEY");

export interface Mail {
  to: string;
  toName?: string;
  subject: string;
  /** Short paragraphs of plain text; rendered into the HTML template. */
  lines: string[];
  action?: { label: string; url: string };
  footer?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, client-safe HTML (tables, inline styles) matching Hookky's look. */
export function renderMail(m: Mail): { html: string; text: string } {
  const paras = m.lines.map((l) => `<p style="margin:0 0 14px;font:15px/1.55 -apple-system,Segoe UI,Inter,Arial,sans-serif;color:#1d1d1f">${esc(l)}</p>`).join("");
  const button = m.action
    ? `<p style="margin:22px 0"><a href="${esc(m.action.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font:600 14px -apple-system,Segoe UI,Inter,Arial,sans-serif;padding:11px 18px;border-radius:10px">${esc(m.action.label)}</a></p>
       <p style="margin:0 0 14px;font:12px/1.5 -apple-system,Segoe UI,Inter,Arial,sans-serif;color:#6e6e73">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(m.action.url)}</span></p>`
    : "";
  const footer = m.footer ? `<p style="margin:18px 0 0;font:12px/1.5 -apple-system,Segoe UI,Inter,Arial,sans-serif;color:#86868b">${esc(m.footer)}</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f2;padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:28px">
<tr><td>
<p style="margin:0 0 22px;font:700 18px -apple-system,Segoe UI,Inter,Arial,sans-serif;letter-spacing:-.02em;color:#111">hookky</p>
${paras}${button}${footer}
</td></tr></table></td></tr></table></body></html>`;
  const text = [...m.lines, ...(m.action ? ["", `${m.action.label}: ${m.action.url}`] : []), ...(m.footer ? ["", m.footer] : [])].join("\n");
  return { html, text };
}

/** Tests set MAIL_SINK=memory and read sent mail from here. */
export const outbox: (Mail & { text: string })[] = [];

export async function sendMail(m: Mail): Promise<boolean> {
  const { html, text } = renderMail(m);
  if (env("MAIL_SINK") === "memory") {
    outbox.push({ ...m, text });
    return true;
  }
  if (!mailConfigured()) {
    console.log(`[mail → ${m.to}] ${m.subject}\n${text}\n`);
    return true;
  }
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env("BREVO_API_KEY"), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: { name: env("MAIL_FROM_NAME") || "Hookky", email: env("MAIL_FROM") || "no-reply@rookker.com" },
        to: [{ email: m.to, ...(m.toName && { name: m.toName }) }],
        subject: m.subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error(`Brevo refused the email to ${m.to}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res.ok;
  } catch (e: any) {
    console.error(`Couldn't reach Brevo for the email to ${m.to}: ${e?.message ?? e}`);
    return false;
  }
}
