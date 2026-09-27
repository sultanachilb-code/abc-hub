# Feature record — Emergency Alert

Added: September 2026 · Status: live · Owner: Sultan Al Achi · Cost: none (no outside service)

## What it does
- **Emergency Alert** tile in the Operations Tools cascade. Managers, the Senior Mall Supervisor and Administrators
  choose the type (Fire, Evacuation, Medical, Security threat…), write the location and optional instructions, and send.
- **Who receives it — only people on shift at that minute**, from the Operations Schedule of that flagship:
  - a shift cell (e.g. `09:00-17:00`) today that covers the current time → alerted;
  - OFF, vacation, sick, training… or a shift that has not started / has ended → **not** alerted;
  - night shifts that run past midnight are read from yesterday's cell;
  - someone whose shift starts while the alert is still open is added automatically; someone whose shift ends stops being re-alerted;
  - option (on by default): the flagship's **Managers who are not on the schedule that day** ("on call"). A Manager marked OFF / away is not alerted.
  - The sender sees the exact list before sending, with a warning for anyone who has no device with notifications on ("call them").
- **How it reaches them**
  - Urgent push to every device of each recipient: stays on screen, vibrates SOS (Android), buttons **I'm on it** / Open.
  - Re-sent about every 45 s to anyone who has not acknowledged (board open) and every 2 minutes from the server (cron), for up to 45 minutes.
  - Anyone with the hub open gets a **full-screen red alert with a siren** (generated in the browser) until they tap I'm on it.
  - A bell entry for each recipient.
- **Live board** for the sender: acknowledged / waiting / no device, re-alert button, and **All clear** (with a note), which notifies everyone who was alerted.
- History of every alert per flagship.

### Limits (web app, no cost)
- The lock-screen sound is the phone's normal notification tone (not a siren) and follows silent / Do Not Disturb.
  The siren plays only where the hub is open. iPhone needs the hub added to the Home Screen for alerts.

## Everything it adds (to remove the feature, undo exactly these)
| Where | What |
|---|---|
| `modules/emergency.js` | **New file.** Tables, on-shift targeting, sending, repeats, routes. |
| `tools/emergency.html` | **New file.** Send form, live board, history. |
| `docs/FEATURE-emergency.md` | **New file.** This record. |
| `worker.js` | 5 lines marked `Emergency Alert feature`: the `import`, `await emergencySchema(env)`, `emergencyRun(...)` in `scheduled()`, the `emergency:` permission in `rights()`, the `emergency/` route in `opsRoute`; plus in `pushRun` the `e.app !== "emergency"` filter and `emergency: "Emergency"` in the names list. `sendPush` now honours `msg.ttl` (harmless to keep). |
| `index.html` | The block marked `Emergency Alert feature` just before `</body>` (overlay, siren, red banner) and the `siren` icon. |
| `sw.js` | The `d.emergency` / `allClear` handling in `push` and the `ack` action in `notificationclick`. |
| `apps.js` | The `emergency` tile (marked with a comment). |

### Database tables (D1 `hub-db`)
- `emergencies` — each alert: flagship, type, location, instructions, sender, open / all clear.
- `emergency_recips` — who was alerted, why (their shift), devices, times alerted, acknowledged at.
```sql
DROP TABLE emergency_recips; DROP TABLE emergencies;
DELETE FROM hub_events WHERE app = 'emergency';
```
