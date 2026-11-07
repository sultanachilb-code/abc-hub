# Hub Training & Rollout (Nov 2026)

Tile **Hub Training & Rollout** in *Hub Applications* (`/tools/rollout`, `modules/rollout.js`, routes `/api/ro/*`).
Admin edits; everyone in the hub sees the plan (read only, no tabs: a landing page of the 4 phases, each phase on its own page `#p=<id>`).

- **Phases** (`ro_phases`): name, title, icon, colour, From–To, status (Planned · Next up · In progress · Done), notes & amendments.
  Loaded once (meta `ro:seeded`) from the plan sent on 7 Nov 2026: Phase 1 Transition (9–12 Nov), Phase 2 Internal ABC systems (week of 16 Nov),
  Phase 3 Advanced modules (week of 23 Nov), Final phase Handover (week of 30 Nov).
- **Sessions** (`ro_sessions`): name, day, time, format (Online · On site · Meeting), audience, link / place. Add / delete per phase.
- **Attendees** are hub accounts:
  - *Hub Champions* — the people ticked in ⭐ Choose champions (meta `ro:champions`), invited to every Champions session;
  - *Operations Team* — every active MM / OM / SMS / MS / MO account (Admin accounts excluded); new accounts join by themselves;
  - *Chosen people* — only the people added by hand.
  `ro_att` keeps per session: added / removed by hand, and the **Attended** tick.
  **Account set up** = the account signed in and changed its first password (`users.last_login_at`, `must_change = 0`).
- **Modules covered** (`ro_mods`): tap to mark trained (who / when kept); add or remove modules. The landing page shows % trained.
- **Reminders** (cron, `roRun`): email (Bcc, from the Admin's Outlook) to the session's attendees the day before at the session time and
  1 hour before. Claimed per session + kind + date/time (`ro:rem:<id>:<d1|h1>:<day>T<time>`), so changing the date or time re-arms them.
  Switch on the landing page (meta `ro:cfg.remind`, on by default).
