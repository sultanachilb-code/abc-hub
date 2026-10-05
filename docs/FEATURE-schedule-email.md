# Weekly schedule email (Sunday) + WhatsApp

**Operations Schedule** page, above the table:
* **Submit & send** — shows the email (subject, To, Cc, the table) and sends it from *ABC Operations Hub*; replies go to the sender, signed with the sender's name and position.
  * Subject: `ABC Verdun: Operations Weekly Schedule October 5th till October 11th, 2026` (flagship and dates automatic).
  * To: the flagship's Mall Manager / Senior Mall Manager (People & roles). Cc: the flagship's list.
  * After sending: “✓ Emailed · time · by”. If the week changes afterwards the bar turns orange and the button becomes **Send update** (subject starts with `UPDATED:`).
* **⇅ Arrange names** (Managers / Senior Mall Supervisor) — drag or ↑ ↓ to change the order of the names, and choose the section each person shows under (schedule and email only; People & roles is not changed). "Default order" goes back to the order by position.
* **WhatsApp** — makes a picture of the week (same colours) and opens the share sheet: choose WhatsApp → the group → Send. On a laptop without the share sheet the picture is copied: open WhatsApp, choose the group, Ctrl+V.

Reminders to the flagship (notification): **Wednesday 10:00** “Finalize next week's schedule”, **Sunday 10:00** “Send the weekly schedule today”, **Sunday 18:00** again if still not sent. Sunday's email covers the coming Monday → Sunday.

Who can send: the flagship's operations team (Managers and Supervisors).
Cc lists: **Hub administration → People & roles → (flagship) → Weekly schedule email**. Verdun is pre-filled; the call center is added to every flagship by default.

Files: `modules/schedmail.js` · `tools/schedule.html` · meta keys `schedcc`, `schedsent:<site>:<monday>`, `schedrem:…`.

**✉️ Recipients** (schedule page, per flagship): the operations team edits **To** (empty = the Mall Manager from People & roles) and **Cc**. The same Cc list is also in Hub administration → People & roles → (flagship).

## Warehouse position
People & roles → Role *Operations team* → Position **Warehouse**. The person is linked to a flagship and sees its data (every tool the operations team opens), but changes nothing and is **not on the Operations Schedule** (nor in the schedule email / WhatsApp picture).
