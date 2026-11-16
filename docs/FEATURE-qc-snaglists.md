# QC Snaglists (Nov 2026)

ABC Audit (Quality Control) → hub. When the audit team shares a department Snaglist in ABC Audit, it is sent to the hub.

- **Connector**: ABC Audit `POST /api/qc/ingest` with header `x-audit-key`. Secrets: `AUDIT_KEY` (hub) = `HUB_QC_KEY` (ABC Audit). Sharing again updates the pack (no second notification).
- **Routing**: Operations pack → Mall Manager, Operations Manager, operations team of the flagship · Technical pack → Technical Manager covering the flagship + Head of Technical · Retail pack → department stores only (store team + CDSO). Leadership of the flagship sees all.
- **Photos**: not copied — loaded from ABC Audit storage through the share link (`/api/sfile`).
- **Page**: `tools/qcsnag.html` (light only): departments → posted audits → findings with filters, print, link to ABC Audit.
- **Positions**: new role TECHNICAL — Technical Manager (`TM`, mall + its DS like security) and Head of Technical (`HOT`, every flagship). Hub access keys `TECM` / `HOT`; only QC Snaglists at the start.
- **Next**: the action plan per finding (owner, due date, status, proof) — to be defined.
