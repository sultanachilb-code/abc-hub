# Monthly backup to Google Drive (Oct 2026)
The Gmail Apps Script `hub-inbox.gs` (same project and INBOX_KEY as the email inbox) has `backupToDrive()`:
it calls `POST /api/inbox/backup` (header `x-inbox-key`), writes one tab per table into a temporary Google Sheet, exports it as
`ABC Hub backup YYYY-MM.xlsx` into the Drive folder **Hub Backups**, and deletes the temporary sheet. The last 24 months are kept.
- Set up once: paste the new `hub-inbox.gs`, run `installBackupTrigger()` (1st of each month, 03:00 Beirut), approve the Drive / Sheets permissions.
- Not included: pictures (layout images, profile photos, covers, works PDFs, malfunction photos), push subscriptions and sign-in secrets
  (password hashes are never in the backup).
- Cells longer than 49,000 characters are cut (a Sheets cell holds 50,000).
