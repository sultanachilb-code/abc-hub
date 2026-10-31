# ⚡ Checklist triggers (AM / PM checklists) — Oct 2026

An action that runs automatically when a chosen AM or PM checklist item is ticked ✗.

## Who sets them
- **Administrators**: any flagship, and can apply the same trigger to all five flagships at once.
- **Flagship managers (MANAGER)**: their own flagship.
- Open the AM or PM checklist and tap **⚡+** next to an item (⚡ when it already has one). Remove from the same dialog.

## What a trigger can do (one or more)
| Action | Detail |
|---|---|
| 🛠 Malfunction Record | category + priority; location, remark and photo come from the checklist |
| 🔔 Notify | hub alert + push to groups (flagship managers, operations team, security, leadership) and/or named people |
| 💬 Team chat | posts in the flagship's "Team" group in Hub Chat (with the photo) |
| ✉ Email | to any address (e.g. a contractor), sent through Outlook, photo attached |
| 🚩 Follow-up | an open follow-up flag for the people notified |
| ⏫ Escalation | when the item is ✗ N checklists in a row (2–7), alert chosen groups/people |

The person filling can be required to write a **remark** and/or add a **photo** (resized to 1280 px, stored in R2 `forms/<SITE>/<day>/…`).

## Filling the checklist
- Items with a trigger show ⚡. Ticking ✗ opens a dialog listing what will happen, with remark and photo.
- **Send now** fires straight away; **Later · on submit** fires when the checklist is submitted.
- Submitting is refused while a triggered ✗ item is missing a required remark/photo.
- A trigger fires **once per item per day** (table `form_trig_log`, unique site/form/day/item).
- The sheet shows "⚡ sent HH:MM · MF #n", and on later days whether the last malfunction is still open or fixed.

## Code
- `modules/formtriggers.js` — tables `form_triggers`, `form_trig_log`; routes `forms/trig/list|save|photo|img|fire`; `fireTrigger`.
- `modules/forms.js` — `run.trig` on new/get, submit validation and firing.
- `modules/chat.js` — `chatPostTeam`.
- `tools/forms.html` — ⚡ badges, ✗ dialog, trigger editor.
