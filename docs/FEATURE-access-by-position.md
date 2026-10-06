# Access by position (Oct 2026)

Who sees each tile is set in `apps.js` → `ACCESS`, one line per system, by position:

| Key | Position |
|---|---|
| MM | Mall Manager / Senior Mall Manager |
| OM | Operations Manager / Deputy Operations Manager |
| SMS / MS / MO | Senior Mall Supervisor / Mall Supervisor / Mall Officer |
| WH | Warehouse |
| SEC | Security |
| LEAD | Property Advisor / Mall Director / CDSO |

- Admin always sees everything. A system missing from `ACCESS` is seen by everyone.
- The list came from the "Visibility by position" sheet Sultan returned (Access.xlsx, 6 Oct 2026).
- `worker.js` → `APP_ACCESS` holds the same list so push notifications only go to people who see the system. Keep both in line.
- The Emergency button shows only when the Emergency Alert tile is open to that position (sending rights are still checked by the server).
- Hiding a tile hides it in the hub; each tool's own permission checks are unchanged.

## Header Tools button
Day to Day tiles marked `tools: false` (Operations Schedule, Minutes of Meeting, Shift Handover) are no longer repeated
in the header Tools button — they stay on the home Day to Day panel. Contractors and Loading Gate stay in both.

## Day to Day / Tools reorganisation (6 Oct 2026, evening)
- Day to Day Operations: Operations Schedule, Minutes of Meeting, Shift Handover, Operations Calendar, and the **Contractor Access** folder
  (a ring with Contractors and Loading Gate). The "Live contractor access" card is gone; the contractor dots on the timeline stay.
- Header Tools button lists Operations Tools only: End of Day Report, Operations Forms, Reminders, **Portal Dashboard**
  (the Tenant Portal Follow-up, moved from Tenant Management and renamed).
