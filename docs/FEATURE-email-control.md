# Email Control (Nov 2026)

Admin Control → **📮 Email Control** (`/admin#em`): every email the hub sends, grouped (Daily & weekly reports · Reminders & alerts · Tenants · Team · Security), with who receives it, when, last sent and how many this month, and an **ON / OFF** switch for the whole hub.

- Registry: `MAILS` in `modules/mailctl.js` (key, name, group, who, when, type `auto` / `man` / `lock`).
- Every send carries `kind`. The central senders in worker.js check `mailGate()` first and count with `mailLog()` after:
  `relay()`, `sendMany` (PM_DEPS) and `outlookSendG` (the outlookSend handed to modules — footfall, cleaners, rollout, reports, restroom outbox).
- OFF → the email is not sent; the caller gets `{ ok:false, off:true, error }`. Button sends (memo, marketing — checked up front with a 409; schedule, handover, welcome — the send returns the error) tell the user "turned off by the admin in Email Control".
- **Pause all automatic emails** (meta `mail:ctl.pause`): every `auto` email stops; button emails and sign-in codes keep working unless switched OFF.
- Sign-in codes (`signin`) are locked ON. Emails without a kind (Outlook connection tests) are not switchable.
- Settings: meta `mail:ctl` = `{ off: { kind: 1 }, pause }` (cached 30 s per isolate). Log: table `mail_log (kind, day, n, last_at, last_to)` from Nov 2026.
- Changes go to the change history (tool `admin`, ref `email-control`).

Kinds: morning · eod · digest · snagweekly · reports · cleaners · backup · formalert · patrol · admin · footfall · cleanverify · memo · marketing · pm · rroutbox · training · schedule · handover · welcome · signin.
