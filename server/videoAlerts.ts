// Emails to the admins about AI video spending: the monthly budget at 50%, 80% and 100%, and one
// person spending an unusual amount in a day. Sent with the same mailer as the account emails.
import { accountsEnabled, db } from "./db";
import { sendMail } from "./mailer";
import { dueAlerts, personAlertUsd, type Alert } from "./videoLedger";

const money = (n: number) => `$${n.toFixed(2)}`;
async function admins(): Promise<string[]> {
  const fromEnv = (process.env.ADMIN_EMAILS ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!accountsEnabled()) return [...new Set(fromEnv)];
  const { rows } = await db().query("select email from users where role = 'admin' and status = 'active'");
  return [...new Set([...rows.map((r) => String(r.email)), ...fromEnv])];
}
async function nameOf(who: string): Promise<string> {
  const id = /^u:(\d+)$/.exec(who)?.[1];
  if (!id || !accountsEnabled()) return who === "everyone" ? "Someone" : who;
  const { rows } = await db().query("select email, name from users where id = $1", [id]);
  return rows[0] ? (rows[0].name ? `${rows[0].name} (${rows[0].email})` : rows[0].email) : who;
}

/** The email for one alert (pure, for tests). */
export function alertMail(a: Alert, person = ""): { subject: string; lines: string[] } {
  if (a.kind === "budget") {
    const left = Math.max(0, a.budget - a.spent);
    return a.step >= 100
      ? { subject: "Rookker: this month's AI video budget is used up", lines: [`AI video has reached its monthly budget: about ${money(a.spent)} of ${money(a.budget)} (estimated).`, "Nobody can generate more clips until next month, or until you raise the budget."] }
      : { subject: `Rookker: AI video is at ${a.step}% of this month's budget`, lines: [`AI video has used about ${money(a.spent)} of this month's ${money(a.budget)} budget (estimated). ${money(left)} is left.`, "When the budget is reached, generation stops for everyone until next month or until you raise it."] };
  }
  return { subject: "Rookker: one person's AI video spending is high today", lines: [`${person || a.who} has used about ${money(a.spent)} of AI video today (estimated), past the ${money(personAlertUsd())} mark.`, "If that's unexpected, lower their daily video credits in People, or switch a maker off in AI video settings."] };
}

/** After a clip is charged: send whatever warnings are due. Never throws. */
export async function sendAlerts(who: string, appUrl: string) {
  try {
    const due = await dueAlerts(who);
    if (!due.length) return;
    const to = await admins();
    for (const a of due) {
      const mail = alertMail(a, a.kind === "person" ? await nameOf(a.who) : "");
      if (!to.length) console.warn(`AI video alert (no admin email to send it to): ${mail.subject}`);
      await Promise.all(to.map((email) => sendMail({ to: email, ...mail, lines: [...mail.lines, "The makers' own bills are the real figure; these are estimates from list prices."], action: { label: "Open spending and limits", url: `${appUrl}/?view=video` } })));
    }
  } catch (e) {
    console.error("Couldn't send an AI video alert:", (e as Error)?.message ?? e);
  }
}
