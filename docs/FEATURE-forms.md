# Feature record — Operations Forms (checklists)

Added: September 2026 · Status: live · Owner: Sultan Al Achi

## What it does
- The **Operations Forms** circle in the Operations Tools cascade opens an orbit ring with five checklists:
  **AM Checklist · PM Checklist · Direct Banking · Tenant Opening · Tenant Closing**.
- Layout A: Area · Task · ✓ / ✗ / N/A · Remark, on an A4 portrait sheet. On a phone the rows become large tap targets.
  **Print** fits the sheet on one A4 page (the Direct Banking list, 90+ tenants, runs over several pages).
- Every ✗ needs a remark before submitting. Once submitted, a checklist is locked; the Manager / SMS can reopen it.
- **AM / PM**: one per flagship per day; anyone at the flagship (not Security) fills it and it saves automatically.
- **Tenant Opening / Closing** (procedure PR – LE – LE): one per tenant. The tenant is picked from the GLA
  (unit, level and category fill in). Four Yes/No questions — Restaurant/F&B, Back door, CRM, Direct banking —
  mark the matching rows N/A. Extras: back door sign, restaurant fans, ABC Tenant Connect training (Yes / No + training day),
  ABC Tenant Connect users deactivated on closing, and a link to set the unit's status in the GLA.
- **Direct Banking**: the Manager / SMS uploads the Areeba machines Excel (Tenant · Old Terminal ID · New Terminal ID · Floor);
  each upload replaces the list. The weekly inspection has one row per machine; a ✗ offers ready-made reasons
  (taken from the old Tenant Visit Form comments) or "Other…". Past visits were not imported (by request).
- **✎ Edit list** — Administrators only: add, remove, reorder and reword items, set "Only if" conditions and extra fields,
  and edit the Direct Banking reasons. One flagship or all five at once. Submitted records keep the list they were filled with.
- Submitting raises a bell entry at the flagship (warning when there are ✗).
- The Reminders feature can check "AM / PM checklist submitted today" and "Direct Banking submitted this week".

## Everything it adds (to remove the feature, undo exactly these)
| Where | What |
|---|---|
| `modules/forms.js` | **New file.** Starting lists, tables, routes. |
| `tools/forms.html` | **New file.** The checklist page (`/tools/forms?f=am|pm|dbank|open|close`). |
| `docs/FEATURE-forms.md` | **New file.** This record. |
| `worker.js` | 5 lines marked `Operations Forms feature`: the `import`, `await formsSchema(env)`, the `formsFill:` and `formsLead:` permissions in `rights()`, and the `forms/` route in `opsRoute`. Plus `forms: "Checklist"` in the push names list inside `pushRun`. |
| `apps.js` | `"Operations Forms"` in GROUPS and the five `form-*` entries (marked with a comment). |
| `index.html` | The `sun`, `moon`, `card`, `storeIn`, `storeOut` icons (harmless to keep). |
| `modules/reminders.js` | The optional `form` check type (safe to leave: it reports "Couldn't check" without the table). |

### Database tables (D1 `hub-db`)
- `form_templates` — each flagship's list per checklist (only when an Administrator edited it; otherwise the built-in list is used).
- `form_runs` — every filled checklist: flagship, checklist, date, tenant, header, answers, comments, snapshot of the list, who and when.
- `dbank_machines` — the uploaded Areeba machines per flagship (upload details in `ops_settings`, key `dbank_upload`).
```sql
DROP TABLE form_runs; DROP TABLE form_templates; DROP TABLE dbank_machines;
DELETE FROM ops_settings WHERE k = 'dbank_upload';
DELETE FROM hub_events WHERE app = 'forms';
```
