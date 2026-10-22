# Key Box — vacant units' keys (Oct 2026, Upcoming - Testing)

Page `tools/keybox.html` · module `modules/keybox.js` · routes `/api/ops/kb/{board,out,in,keys,history,photo}`.

- **Hooks come from GLA & Occupancy**: every Leasing unit that is Vacant or Terminated has a hook; a unit leased while its key is out keeps its hook until the key is back.
- **Cabinet look** (metal box, hooks, tags): green = in the box · amber = out (first name + back-by time) · red, pulsing = late. Level filters from the GLA levels.
- **Hand out / receive**: the operations team (management, Leasing-side leadership, Mall Supervisors, Mall Officers) and Security.
  Anyone else (e.g. Leasing staff with a hub account) can **take it myself** and return their own key.
- **Hand-over form**: who (Tenant / Contractor / Leasing / Hub staff / Other), name, company/brand, mobile, why (Viewing, Fit-out, Maintenance,
  Inspection, Other), back by (1 h, 2 h, today 18:00, tomorrow 12:00 or a date/time), how many keys, optional ID photo, **signature**
  (required for tenants, contractors and others), notes. The number of keys per unit is set by the operations team.
- **Return**: one tap. Full history per key (who, why, on time / late). Signature and ID photo visible to the operations team only.
- **Late keys**: alert to the flagship's operations team (hub bell + push, app `keybox-late`: MM, OM, SMS, MS, MO), again every day from 09:00 until the key is back.
- Every hand-over and return is written to Change history (tool `keybox`).
