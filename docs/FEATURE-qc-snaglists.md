# QC Snaglists (Nov 2026)

ABC Audit (Quality Control) → hub. When the audit team shares a department Snaglist in ABC Audit, it is sent to the hub.

- **Connector**: ABC Audit `POST /api/qc/ingest` with header `x-audit-key`. Secrets: `AUDIT_KEY` (hub) = `HUB_QC_KEY` (ABC Audit). Sharing again updates the pack (no second notification).
- **Routing**: Operations pack → Mall Manager, Operations Manager, operations team of the flagship · Technical pack → Technical Manager covering the flagship + Head of Technical · Retail pack → department stores only (store team + CDSO). Leadership of the flagship sees all.
- **Photos**: not copied — loaded from ABC Audit storage through the share link (`/api/sfile`).
- **Page**: `tools/qcsnag.html` (light only): departments → posted audits → findings with filters, print, link to ABC Audit.
- **Positions**: new role TECHNICAL — Technical Manager (`TM`, mall + its DS like security) and Head of Technical (`HOT`, every flagship). Hub access keys `TECM` / `HOT`; only QC Snaglists at the start.
- **Audits table** per department: Audit #, flagship, posted, score, action plan progress, status (Pending / Closed / Closed · N left open), Open.
- **Audit landing**: Snaglist, Action plan and Comments cards; the items not yet verified below; **Close audit** (managers) — with open items only after typing *Agree*; reopen = administrators.
- **Action plan** (`qc_actions`): owner (department team at that flagship), due date (default: the auditor's fix-by), action, contractor / cost for Project findings; Not assigned → Assigned → In progress / Needs approval → Fixed (proof photo, stored in FILES `qc/…`) → Verified (managers). Assigning notifies the owner; daily reminders 2 days before and when overdue (`qcRun`).
- **Comments** (`qc_comments`): General · Disputed finding · Needs support / budget · Management note; per audit or per finding; kept in the hub only, never change the score.
- Managers: Operations / Retail = Mall Manager & Operations Manager (role MANAGER) of the flagship; Technical = Technical Manager / Head of Technical.
