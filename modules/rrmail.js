/* =====================================================================
   RESTROOM EMAILS THROUGH OUTLOOK (Oct 2026)
   The Restroom Inspection system no longer sends through Google Apps Script: it writes each email
   (window reminder, daily report, issue alert) into its own table email_outbox (abc-restroom-db),
   and the hub's cron (every 2 minutes) sends them through the Outlook connection of the hub
   (Admin Control Center → Outlook). No Google fallback.

   email_outbox: id, kind, to_list, cc_list, bcc_list, subject, html, created_at, status pending|sent|failed, tries, sent_at, via, last_error
   The hub writes back only the sending status (status, tries, sent_at, via, last_error).
   ===================================================================== */

const MAX_TRIES = 15;          // ~30 minutes of retries, then "failed"
const PREFERRED_FROM = "salaachi@abc.com.lb";
const list = s => String(s || "").split(/[,;]/).map(x => x.trim()).filter(Boolean);

export async function rrMailRun(env, d) {
  if (!env.RR_DB) return;
  let rows;
  try {
    rows = (await env.RR_DB.prepare("SELECT * FROM email_outbox WHERE status = 'pending' ORDER BY id LIMIT 20").all()).results || [];
  } catch { return; }   // the table appears with the Restroom system's first email
  let notConnected = 0;
  for (const m of rows) {
    const r = await d.outlookSend(env, { from: PREFERRED_FROM, to: list(m.to_list), cc: list(m.cc_list), bcc: list(m.bcc_list), subject: m.subject, html: m.html })
      .catch(e => ({ ok: false, error: e.message }));
    const now = new Date().toISOString();
    if (r && r.ok) {
      await env.RR_DB.prepare("UPDATE email_outbox SET status = 'sent', sent_at = ?, via = ?, last_error = '' WHERE id = ?").bind(now, r.queued ? "outlook (queued)" : "outlook", m.id).run();
      continue;
    }
    if (!r) notConnected++;
    const tries = (Number(m.tries) || 0) + 1, err = r ? String(r.error || "not sent").slice(0, 300) : "Outlook is not connected in the hub";
    await env.RR_DB.prepare("UPDATE email_outbox SET tries = ?, last_error = ?, status = ? WHERE id = ?")
      .bind(tries, err, tries >= MAX_TRIES ? "failed" : "pending", m.id).run();
  }
  /* tell the administrators once a day when Outlook is not there to send them */
  if (notConnected) {
    const k = "rrmail:warn:" + new Date().toISOString().slice(0, 10);
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES (?, '1')").bind(k).run().catch(() => null);
    if (claim && claim.meta && claim.meta.changes === 1)
      await d.notifyAdmins(env, "Restroom emails are waiting for Outlook",
        "The Restroom Inspection reminders and reports are now sent through the hub's Outlook connection, but no Outlook account is connected. Connect it in Admin Control Center → Outlook; the waiting emails go out on the next run (they are kept 30 minutes).", "alert").catch(() => {});
  }
}
