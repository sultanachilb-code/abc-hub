# Positions & landing pages · Incident Report settings (Nov 2026)

One account for every system, following the ABC hierarchy. All of it is in **Admin Control** (admins only).

## 🧭 Positions & landing pages (`/admin#lp`)
This page replaces *Landing pages* and the "who sees it" part of *Tools & access*.

Pick a **position**:
- Leadership: Property Advisor, Mall Director, CDSO
- Flagship management: Mall Manager, Operations Manager
- Operations team: Senior Mall Supervisor, Mall Supervisor, Mall Officer
- Security: Head of Security, Security Manager, Site Visit Officer, Security staff
- Other: Warehouse, Administrator (home layout only)

Then pick **All flagships** (the default) or **one flagship**. A gold dot or a gold line means that flagship differs from All flagships. "↺ back to All flagships" clears every difference for that flagship.

Positions that cover several flagships have one setup only: Advisor, Director, CDSO, Head of Security and Site Visit Officer.

| Part | What it does | Stored in |
|---|---|---|
| 👁 Who sees what | The visible hub tools, by folder, each with a tick box. A tool switched off for everyone in *Tool switches & folders* stays off. | meta `pos:cfg` |
| 📨 Emails received automatically | End of Day, handover, weekly schedule, form alerts, patrol and cleaners. The position is added in Cc for **its flagship** whenever the hub sends that email (`withAuto` in `relay` / `outlookSendG`). By default only the Security Manager has these on. The Site Visit Officer gets nothing unless ticked. | meta `pos:cfg` |
| 🔌 Rights in the connected systems | Incident Report and Snaglist objects: ✎ edit · 👁 view · own · — none. A position with — everywhere gets no account in that system. | meta `pos:cfg` |
| 🏠 Home layout · 🧱 Landing page | As before, plus a version for one flagship. | `landing:site`, `home:site` (defaults in `landing:pos`, `home:pos`) |

Only differences are stored. A flagship value equal to the default is removed. Without any setting, the old rules apply: `tools:cfg` access, then `APP_ACCESS` / `apps.js`.

New hub position: **Site Visit Officer**. It is a Security role (position `SV`) that covers every flagship.

## 🚨 Incident Report settings (`/admin#is`)
These settings moved from the Incident system's Admin screen.
- **Emails per incident type:** tick hub positions and email-only contacts. Positions are resolved to the people **of the incident's flagship**; Advisor and Head of Security cover all of theirs.
- **Email-only contacts:** Legal, Internal Audit, Security Director and others. These need no hub account.
- **Per flagship:** the Customer Service inbox (and its Cc) and the CCTV team inbox.
- **Other:** the daily digest and weekly compliance recipients, and the Ops desk phone.

The first time the page opens, it copies the Incident system's old settings through `/api/hubcfg-export`.

The Incident system reads the resolved addresses from `GET /api/sso/inc-cfg` (x-hub-key), cached 60 s. It uses its own tables until this page has been saved.

## In the systems
- **Hub sign-in:** both Incident Report and Snaglist switch to "Hub sign-in only" once (`sso:hubonly-nov26`). Admin Control → Hub sign-in can switch them back.
- **Accounts follow the hub:** every hub sign-in sets the account's role, flagships, position and rights. Their user screens are removed.
- **Incident Report**
  - Security Manager is one flagship; Head of Security is all of them.
  - Routes check the rights (`opts.obj`).
  - "own" limits the log, PIR and status changes to incidents the person reported.
  - Blacklist edit and lift: Security Manager (and Head of Security).
  - PIR: the operations team, from Mall Manager to Mall Officer.
- **Snaglist**
  - The role comes from the rights: "Flagship snaglists" ✎/👁 = Manager, "Own" = Supervisor, "Post site visits" only = Site Visit, all site visits = Full Access.
  - Head of Security = Full Access with no own lists, which means view only of every flagship's site-visit activity.
  - Create, transfer, keep, delete, post, close and report are checked against the rights.

## Security Manager: mall + department store (Nov 2026)
The Security Manager of a mall is also responsible for security at the department store of the same site: **Verdun Mall → Verdun DS** and **Achrafieh Mall → Achrafieh DS** (`SEC_COVER` in worker.js). Dbayeh DS has its own Security Manager.
- `sitesOf` gives him both flagships: hub data, the flagship picker, the automatic emails of both, and the Incident Report scope (both flagships).
- In Incident Report settings, "Security Manager" ticked for a type reaches him for incidents at the department store too.
- Hierarchy page: the Verdun DS and Achrafieh DS Security Manager boxes are dotted links to the mall's Security Manager. The Head of Security's list shows "Verdun Mall + Verdun DS".
