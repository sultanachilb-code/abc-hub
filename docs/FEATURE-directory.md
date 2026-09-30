# Tenants Directory

One contact directory per flagship: Tenant Name · Employee Name · Position · Mobile N. · Email · Category · Location · Status · Landline.

- **Tenant name, category, location, status** come from the GLA (Hub → GLA & Occupancy). A tenant that is not in the GLA (for example a department-store concession) can be typed in; its category, location and status are then filled in by hand.
- **Employee, position, mobile, email, landline** are typed in (or imported from Excel).
- **Who can do what**
  - Reception: a private link per flagship (`/reception/<code>`), no hub account needed. View, add, edit, delete, import, export.
  - Flagship management (Mall Manager, Operations Manager / Deputy, Director, CDSO, Advisor, Admin): the same in the hub, plus create / replace / turn off the reception link.
  - Operations team: view, search, filter by status, category and location, export to Excel.
- **Home search**: typing 2+ letters in the hub search also finds tenants and employees (with call / email buttons). Tapping a result opens the directory filtered on it.
- **Import from Excel**: the first sheet, headers `Tenant Name, Employee Name, Position, Mobile N., Email, Category, Location, Status, LandLine`. A tenant name written once for several rows (merged cells) is carried down. Same tenant + employee → updated; otherwise added.

Tables `dir_contacts`, `dir_links` (created automatically). Routes `/api/ops/dir/*`, `/api/rx/<code>/*`. Files: `modules/directory.js`, `tools/directory.html`, hooks in `worker.js` (marked "Tenants Directory feature"), tile in `apps.js`, search in `index.html`.
