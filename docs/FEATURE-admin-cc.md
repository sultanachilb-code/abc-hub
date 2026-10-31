# Admin Control Center (Oct 2026)

`/admin` (`tools/admin.html`, `modules/admincc.js`) — administrators only. The admin signs in on the normal login page with his own account,
then opens it from the account menu → **Admin Control Center** (Hub administration stays for announcements, people & roles, covers…).

| Section | What it does |
|---|---|
| Overview | Red / amber alerts + today's cards: users online, emails, D1, requests, R2, ABCON, systems, jobs, backup, security |
| Users & access | Everyone with position, flagships, two-step ways, last activity (online = active in the last 10 min), lock. **View as** (read-only, 30 min, logged), temporary password, reset two-step, sign out of every device, unlock, switch on/off |
| Security & sign-ins | 30-day sign-in log (OK, wrong password, unknown email, locked), locked accounts, admin actions, **Sign everyone out** |
| Allowances & usage | Outlook queue + automatic sender + secret expiry, Gmail relay left today, D1 reads / writes / size (7 days), Worker requests (all workers, today), R2 storage + operations, ABCON neurons (7 days) |
| Systems & jobs | Connected systems answering (Snaglist, Incidents, Restroom, Cleaning, Footfall, Gate, relay, Microsoft, Salesforce, AI), scheduled jobs with last run + Run now / Send me a test, settings & secrets (names only) |
| Tools control | Per tool: on / off, folder (or a new folder), who sees it (MM, OM, SMS, MS, MO, WH, SEC, LEAD), usage in 7 days, ↺ default. Saved in `meta tools:cfg`; applied in `/me` (tiles) and `roleAllows` (server); people see it at their next refresh (60 s cache) |
| Data & backup | Download a full backup, last automatic backup, rows per table, clean-up (notifications > 90 d, usage log > 1 y, sign-in log > 90 d, sent Outlook emails > 90 d) |
| Announcements & more | Links to the Hub administration tabs |

## Security added
- **Lock**: 5 wrong passwords in a row → locked 15 minutes (admins notified); the admin can unlock.
- **Sign out everywhere**: sessions now carry their issue time; `users.signout_at` cancels older ones.
- **View as**: signed cookie `hub_viewas` (admin + target, 30 min). While on, every POST and SSO is refused ("read-only"), a purple bar shows *Back to my admin* (`/api/viewas-stop`).
- Sign-in log `admin_signins` (kept 180 days).

## Alerts
Hourly (07:00–22:00) health check; each red problem is pushed to the administrators once a day. Heartbeat `cron:beat` shows whether the 2-minute scheduler runs.

## Admin password (26 Oct 2026)
- Tapping the **ABC logo** on the hub (administrators) or opening **/admin** asks for the admin's own password again; it stays open on that device for **2 hours** (cookie `hub_adm`, SameSite=Strict). **🔒 Lock the Control Center** closes it at once.
- Wrong passwords count towards the same 5-tries lock and appear in the sign-in log.

## Health check (26 Oct 2026)
- Systems are checked with the same small requests the hub already uses (hub stats / sign-in probe, 10 s), not their home pages.
- A system is red only after **2 failed checks in a row**; one slow answer is amber.
- Alerts go to the administrators' bell and phone (push) only — **no email**.

## Update (26 Oct 2026, afternoon)
- **Light by default**, **Dark** switch in the side menu (Display), remembered on the device (`adm.theme`); embedded pages follow it.
- **Users grouped by flagship** (hub order), then "Leadership, administrators & several flagships", with a gap and a count (people · online) per group.
- New sections moved from Hub administration: **Usage report** (7/30/90 days, tools, flagship matrix, people per flagship, CSV), **Change history** (filters, CSV),
  **Storage & database** (D1 reads/writes/size, 7 days, per database, top queries, R2 buckets), **Projects & GitHub** (control sheet: Live · GitHub · Cloudflare, add / edit / delete),
  **Flagship covers** (upload / replace / remove), **Seasons** and **Message of the moment** (their pages shown inside the Control Center).
- "Announcements & more" keeps links to Announcements, People & roles and Backup in Hub administration.

## Administrator access is now separate from the role (26 Oct 2026)
- `users.is_admin` = administrator access. A person keeps their **real role** (e.g. Sultan: Mall Supervisor · ABC Verdun Mall) and signs in to the hub with it.
- **ABC logo → password** (`/api/admin/unlock`, 2 hours) = **administrator mode**: the hub opens as administrator (all tools, admin rights), a purple bar offers **Admin Control Center** and **Exit · back to <real role>**.
- Every `/api/admin/*` route needs administrator mode. The old Hub administration screen is gone (`#/admin` opens `/admin`).
- Moved into the Control Center: **People & roles** (per flagship, slots, operations team, security, leadership, administrators, add / edit with a **Hub administrator** tick, two-step policy, ABC Operations Group email, weekly schedule Cc, morning / End of Day tests), **Announcements**, **Outlook settings** (Allowances → Outlook → Settings).
- Notifications "to the administrators" go to everyone with administrator access.
- One-time migration (`meta mig:admin-split`): every Admin account gets `is_admin = 1`; salaachi@abc.com.lb becomes Mall Supervisor · ABC Verdun Mall + administrator.

## Who sees what (Oct 2026)
Admin Control Center → **Who sees what**. Each tool shown in the hub has three switches, one setting for all five flagships:
- **Operations team:** SMS, MS, MO, plus Warehouse and Security.
- **Management:** MM / SMM and OM / DOM.
- **Leadership:** Advisor, Director and CDSO.

The switches start from today's access: the ACCESS list in apps.js, and every position for tools in Upcoming - Testing. A switch is saved as the tool's access list (`meta tools:cfg`, the same as Tools control). The server enforces it in `roleAllows`, and administrators always see everything.

Turning a switch off removes that group's positions. When the result equals the tool's default access, the custom setting is removed. An amber switch means only some positions of that group have the tool, set per position in Tools control; tapping it gives the tool to the whole group.

Hidden tools, the OFF folder and tools that are switched off are not listed.

## Landing page (Home) — Oct 2026
- Opening the Admin Control Center shows **Home**: the top 3 alerts, a search box (pages, settings; Enter with no match searches people), then every page as a tile in sections, with live status (Users, Security, Backup, Systems & jobs, Allowances, Storage, Overview, Usage, Report mailbox).
- **✎ Arrange**: drag tiles between sections and sections up/down (mouse: drag; phone: long-press), ＋ Section (name, icon, cards with status / small icons, open / collapsed), ＋ Shortcut (any hub tool or an https link), 👁 hide a page (kept in Search and in the "Hidden" tray), Reset to the standard sections.
- One arrangement shared by all administrators: `meta` key `admin:landing` (routes `admin/cc/landing` GET/POST, `{ reset: true }`), every save in Change history. The side menu follows the same sections and order. Pages added later appear in "Other" by themselves. Overview stays as its own page/tile.
