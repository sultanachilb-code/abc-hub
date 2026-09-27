# Feature record — Budget (CAPEX / OPEX)

Added: September 2026 · Status: live · Owner: Sultan Al Achi

## What it does
- **Budget · CAPEX & OPEX** tile under *Property Overview & Info* (Managers, Supervisors, Admins; not Security).
- Each flagship uploads **two Excel sheets per year**: CAPEX and OPEX. The file can come straight from JDE or be edited —
  only these columns are kept (found by their header, in any position, extra columns ignored), so all five flagships share one format:
  - **CAPEX:** Project Description · Obj Acct · Cost Object 3 · Annual BGT · FCT · Landing · Notes (the total row is skipped)
  - **OPEX:** Business Unit · Obj Acct · Cost Object 1 · Sub · Cost Object 3 · Cost Object 3 Desc · Detailed Account Description · Annual BGT
  Each upload replaces that flagship's sheet for that year. Upload: Managers, Senior Mall Supervisor, Admins.
- Search, "only lines with a budget", totals (budget, FCT or requested, remaining).
- **Use**: pick a line → the JDE request table is filled:
  Topic/Title (CAPEX = project description; OPEX = typed clear title) · Description (typed: QTY, specs) ·
  Cost allocation (CAPEX, or "OPEX – <account> - <cost object 3 description>") · Object Account · Subsidiary Account ·
  Budget · Remaining Budget · CO1 · CO3. **Copy table** (pastes as a table in Outlook/Word, as text elsewhere) or copy one value.
- **Remaining**: CAPEX = the sheet's Landing (Budget − FCT). OPEX = Annual budget − requests prepared in the hub this year with an amount.
- **Requests prepared** keeps each "Save & copy" (topic, description, amount, who, when); the requester or a manager can remove one.

## Everything it adds (to remove the feature, undo exactly these)
| Where | What |
|---|---|
| `modules/budget.js` | **New file.** Tables and routes. |
| `tools/budget.html` | **New file.** The Budget page (upload, list, JDE table). |
| `docs/FEATURE-budget.md` | **New file.** This record. |
| `worker.js` | 5 lines marked `Budget`: the `import`, `await budgetSchema(env)`, the `budget:` and `budgetLead:` permissions in `rights()`, and the `budget/` route in `opsRoute`. |
| `apps.js` | The `budget` tile (marked with a comment). |
| `index.html` | The `wallet` icon (harmless to keep). |

### Database tables (D1 `hub-db`)
- `budget_lines` — the uploaded lines per flagship, CAPEX/OPEX and year.
- `budget_uses` — requests prepared from a line.
```sql
DROP TABLE budget_uses; DROP TABLE budget_lines;
DELETE FROM ops_settings WHERE k LIKE 'budget_upload_%';
```
