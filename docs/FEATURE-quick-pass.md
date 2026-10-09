# Quick Access Pass

A one-entry QR for a contractor or visitor, valid for **30 minutes**, sent by WhatsApp.

## Who does what
| | |
|---|---|
| **Anyone at the flagship** (technical team, Security, Warehouse…) | Asks for a pass: name, company, mobile, tenant / unit, reason. The operations team gets a hub alert to approve. |
| **Operations team** (Mall Supervisors, Officers, Senior Mall Supervisor, management) | Approves or rejects requests. A pass they create themselves is live at once. |
| **Visitor** | Opens the WhatsApp link `/qp/<token>`: the QR with a live countdown (English / Arabic). The page turns live by itself after the approval. |
| **Loading gate** | Scans the QR (or types `QP-ABCDEF`). One entry only: a second scan shows *Quick Pass already used*. Letting in a used, expired or not-approved pass needs a reason and alerts the flagship. |

The 30 minutes start at the approval. An unanswered request lapses after 12 hours. A pass can be cancelled until it is used.

## Where it shows
- **Contractors**: the entry is logged as a visit (source *quickpass*) with its check-in.
- **Loading gate log** and the **Shift Handover** (contractor access not in this handover → *+ Add to handover*).
- **Day to Day**: a green *QP* pin at the approval time.
- **Loading Gate phones without signal**: live, unused passes are part of the offline list (refreshed every 10 minutes).

## Technical
- Table `quick_passes`, module `modules/quickpass.js`, pages `tools/quickpass.html` (hub) and `tools/qpass.html` (visitor, `/qp/<token>`).
- Routes: `ops/qp/list · new · decide · cancel`, public `qp-pass/<token>`.
- Gate: `modules/gate.js` (lookup / decide recognise `…/qp/<token>` and `QP-XXXXXX`).
- Push: "Quick Pass to approve" goes to the operations team only (`APP_ACCESS.quickpass` in worker.js). The answer goes to the person who asked.
