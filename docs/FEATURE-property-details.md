# Feature record — Property Details

Added: September 2026 · Status: live · Owner: Sultan Al Achi

## What it does
- **Property Details** tile under *Property Overview & Info*.
- Each flagship sees **its own** details only (Verdun Mall, Achrafieh Mall, Dbayeh, Achrafieh DS, Verdun DS).
  Administrators can switch flagship and use **Compare flagships** (all five side by side).
- Started from “ABC Verdun - Achrafieh - Dbayeh Comparison Snapshot”: 140 items in 6 categories.
  Verdun, Achrafieh and Dbayeh are filled from the snapshot; Achrafieh DS and Verdun DS start empty.
- The flagship Manager / Senior Mall Supervisor update values (✎); every change is logged (History).
- Administrators can also rename items, add items (to one or all flagships), and see/edit the
  snapshot's **comparison notes** — these notes are shown to administrators only.

## Everything it adds (to remove the feature, undo exactly these)
| Where | What |
|---|---|
| `modules/property.js` | **New file.** Server logic (tables, routes, seeding). |
| `data/property-details.js` | **New file.** The snapshot converted to data (starting values). |
| `tools/property.html` | **New file.** The Property Details page. |
| `docs/FEATURE-property-details.md` | **New file.** This record. |
| `worker.js` | 4 lines marked `Property Details feature`: the `import`, `await propertySchema(env)`, the `property:` permission in `rights()`, and the `property/` route in `opsRoute`. |
| `apps.js` | The `property` tile (marked with a comment). |

### Database tables (D1 `hub-db`)
- `property_rows` — one row per flagship + item: category, sub-group, item, value, note, last updated by/at.
- `property_log` — every change (before → after, who, when).
```sql
DROP TABLE property_log; DROP TABLE property_rows;
DELETE FROM meta WHERE k LIKE 'propseed:%';
```
