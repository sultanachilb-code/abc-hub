ABC Operations Hub — Handover fixes (29 Sep 2026)
Copy into the abc-hub folder (replace), then deploy as usual.
  worker.js
  tools/handover.html

What changes
1. Coming up -> Tomorrow: when the new day's handover opens, items dated tomorrow move to "Tomorrow";
   items dated today (or earlier) move to "Today" as before.
2. The manual "Checklist name / AM / PM / Clarifications" table is removed (screen, print and email).
   The live AM/PM checklist and restroom (OPS / S.S) rows stay.
3. Email subject: ABC <Flagship> | <AM/PM> Handover <September 29th, 2026>
   AM before 3:00 PM Beirut, PM after, with an AM/PM switch in the email window.
4. "1 to receive" badge: counts only the newest handover. Older ones never received (the old AM/PM files)
   are marked "Closed". Opening Shift Handover goes straight to the one waiting for you.
No database changes needed.

Update 29 Sep 15:45 — tools/handover.html
5. Import tenant requests: only Approved ✔️ requests are added to the handover.
   Submitted To Review, Rejected and Closed requests are left out (the import window shows how many).
