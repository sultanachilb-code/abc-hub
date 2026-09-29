# Automation

Module `modules/automation.js`, run by the existing 2-minute cron.

* **End of Day email, 23:30 Beirut** — one email per flagship to every active Admin / Property Advisor / Mall Director / CDSO / flagship management account that can see that flagship and has "Receive the 08:00 morning brief and the 23:30 End of Day report" ticked. Test it from Hub administration → People & roles → "End of Day report test".
* **Daily snapshot** — at the same time the day's figures are stored in `daily_stats` (restroom checks, incidents, AM/PM checklists, hand-offs, feedback, openings/closures). The leadership dashboards read their month-to-date and 14-day trends from it.
* **Weekly backup, Sunday from 03:00** — every table (password hashes, mall-plan images and logs left out) as `abc-hub-backup-YYYY-MM-DD.json.gz`, emailed to the administrators. Hub administration → Backup shows the last one and has "Download a backup now".

## Mail relay: attachments
The hub now sends `attachment: { fileName, mimeType, base64 }` to the Apps Script relay. If the relay does not attach files yet, add this where it sends the email:

```js
var opts = { htmlBody: d.html, name: d.fromName || "ABC Operations Hub" };
if (d.cc && d.cc.length) opts.cc = d.cc.join(",");
if (d.attachment && d.attachment.base64) {
  opts.attachments = [Utilities.newBlob(Utilities.base64Decode(d.attachment.base64),
    d.attachment.mimeType || "application/octet-stream", d.attachment.fileName || "attachment")];
}
MailApp.sendEmail(d.to.join(","), d.subject, "", opts);
```

## Works offline (tools/common.js + sw.js)
Pages opened before are kept on the device. Checklists (AM, PM, direct banking, tenant opening/closing) and the handover save to the phone when there is no signal and are sent automatically when the connection is back (badge bottom-left).

## Export to Excel (tools/common.js)
Every tool page with a table shows **⤓ Excel** in its top bar: all tables on the page go into one workbook, one sheet each.
