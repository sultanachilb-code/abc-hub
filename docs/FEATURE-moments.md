# Message of the moment

A short friendly line above **Day to Day Operations** — shown to the **admin only** (to show it to the operations team, add `"MANAGER", "SUPERVISOR"` to `OPS_ROLES` in `modules/moments.js`).

- The admin writes the messages with their time on the **Message of the Moment** tile (Operations Tools, admin only). English, Lebanese Arabic or both.
- The newest message whose time has passed is shown until the next message's time.
- On each person's screen it stays **5 minutes** from the first time they see it, once a day (a gold bar counts down; ✕ closes it).
- A first set of six messages (08:30 → 21:30) is ready to edit. *Show messages* switches all of them off.

Technical: `modules/moments.js` (kept in `meta` → `moments`), routes `GET /api/moment`, `GET/POST /api/admin/moments`, page `tools/moments.html`.
