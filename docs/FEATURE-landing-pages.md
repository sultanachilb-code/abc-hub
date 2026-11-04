# Landing pages by position (Nov 2026)

Admin Control → **Landing pages** (`/admin#lp`): the home-page brief of each position, built by drag and drop.

* Positions: Mall Manager, Operations Manager, Senior Mall Supervisor, Mall Supervisor, Mall Officer, Security staff, **Security Manager**, **Head of Security**, Property Advisor, Mall Director, CDSO.
* One page per position, the same in every flagship — each person sees his own flagship's figures (Head of Security, Advisor, Director, CDSO: a flagship picker and the KPI table of all their flagships).
* Objects (library on the left): Security (incidents · PIR, patrol rounds, contractors, Loading Gate, cleaners entered, late keys, quick passes, emergency alerts), Operations (checklists, handover, malfunctions, snaglist, restroom, cleaning, marketing), Tenants (feedback, contracts ending, portal, fit-outs, GLA occupancy), Reports (footfall this month, KPI table, follow-ups), Other (shortcut to any tool).
* Drag into a section (or ＋), drag to reorder (or ◀ ▶), ⇔ small / half / full, ✕ remove; sections can be added, renamed, moved, removed. Copy from another position, ↺ Default, Preview (opens the hub as that position — shows the saved page).
* An object appears only if the position can open its tool (**Who sees what**); in the builder it is greyed out "can't open the tool".
* Positions without a saved page keep what they had: Manager action brief, Advisor / Director / CDSO KPI brief, nothing for the operations team. **Security Manager and Head of Security** start with a ready page.
* Home page: Admin's "Preview as" is now a list of all positions, with a link to the builder.

Storage: `meta landing:pos`. Code: `modules/landing.js` (objects, ready pages, figures), `modules/rolebrief.js` (`/api/brief/role` serves the page), `tools/admin.html` (`lp()`), `index.html` (`landingHtml`).

## Security positions (Nov 2026)
Role Security has three positions: **Security staff**, **Security Manager** (one flagship) and **Head of Security** (every flagship).
Access keys SEC · SECM · HOS — "Who sees what" has a column for Security Manager and for Head of Security.
At the switch, both new positions received everything Security had (defaults and the tools changed in Tools control), plus Incidents and the Emergency Alert.
