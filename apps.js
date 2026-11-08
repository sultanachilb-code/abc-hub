/* =====================================================================
   ABC Property Hub — system registry
   This is the ONLY file you need to edit to add / remove / update systems.
   ---------------------------------------------------------------------
   Fields per system:
     id      unique short id (no spaces)
     name    tile title
     desc    one-line description
     group   section on the home screen (must match one of GROUPS)
     icon    clipboard | alert | qr | box | calendar | chart | bolt | truck
             | camera | shield | users | footfall | bug | book | megaphone | alarm | sun | moon | card | storeIn | storeOut | siren | wallet
             | gauge | scale | handshake | scroll | exit | hardhat | target | download | pack
     color   tile colour
     url     the system link (single-site systems)
     sites   { "Flagship name": "url", ... }  (per-flagship systems)
     embed   false = open in its own window instead of inside the hub
     who sees a tile is set in ACCESS below, by position.
     sso     true = sign in automatically with the hub account
     logo    picture shown on the tile instead of the icon (e.g. "/logos/jde.png", square, 256×256)
     hidden  true = not on the home screen for anyone (admin pages used from the Admin Control Center)
     also    more folders the same tile appears in, e.g. also: ["Leadership"] (same page, same access)
   Empty groups are hidden automatically.
   ===================================================================== */

window.HUB = {
  title: "ABC Property Hub",
  org: "ABC Operations",

  GROUPS: ["Day to Day Operations", "Property Overview & Info", "ABC Platforms", "Tenant Management", "Micro Tools", "Access and Security", "Soft Services Management",
    "Hub Applications", "Reports", "Dashboards",
    /* Hub Phone and Hub Chat (Oct 2026) */
    "Phone",
    /* new tools wait here while they are tested; they move to their real folder afterwards (Oct 2026) */
    "Upcoming - Testing",
    /* the header "Operations tools" button (not a home section) */
    "Operations Tools",
    /* tools put away: only the administrator sees this folder (Oct 2026) */
    "OFF",
    /* opened from a tile (orbit ring), not shown as sections */
    "Operations Forms"],
  ADMIN_GROUPS: ["OFF"],

  /* Who sees each tile, by position (from the Access sheet, Oct 2026). Admin always sees everything.
       MM   Mall Manager / Senior Mall Manager     OM  Operations Manager / Deputy Operations Manager
       SMS  Senior Mall Supervisor   MS  Mall Supervisor   MO  Mall Officer   WH  Warehouse
       SEC  Security                 LEAD  Property Advisor / Mall Director / CDSO
     A system missing from this list is seen by everyone. Keep APP_ACCESS in worker.js in line (push notifications). */
  /* Upcoming - Testing: every tile in the testing folder is seen by everyone while it is tested, whatever ACCESS says (Oct 2026).
     Only the admin settings pages listed here stay admin-only. Keep TESTING_OPEN in worker.js in line. */
  TESTING_ADMIN_ONLY: ["moments", "seasons"],
  ACCESS: {
    "schedule":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "LEAD"],
    "mom":             ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "LEAD"],
    "handover":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "LEAD"],
    "contractors":     ["OM",  "SMS",  "MS",  "MO",  "SEC","SECM", "HOS", "LEAD"],
    "gate":            ["OM",  "SMS",  "MS",  "MO",  "SEC","SECM", "HOS", "LEAD"],
    "contractor-access": ["OM",  "SMS",  "MS",  "MO",  "SEC","SECM", "HOS", "LEAD"],
    "schedule-calendar": ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "LEAD"],   /* Schedule + Calendar in one tile */
    "projects-budget": ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],   /* Operations Projects + Budget in one tile */
    "patrol":          ["MM",  "OM",  "SMS",  "MS",  "MO",  "SEC","SECM", "HOS", "LEAD"],
    "moments":         [],   /* Admin only */
    "seasons":         [],   /* Admin only */
    "leadership":      ["LEAD"],
    "perf":            ["MM",  "OM",  "SMS",  "LEAD"],   // Performance Dashboard (Nov 2026): Performance + Monthly Pack + Executive Report + Snaglist Report
    "eod":             ["MM",  "OM"],
    "forms":           ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "emergency":       ["MM",  "OM",  "SMS",  "MS",  "MO", "SECM", "HOS"],
    "reminders":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "SEC","SECM", "HOS", "LEAD"],   // each title has its own reminder list
    "calendar":        ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "tenants":         ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "feedback":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "compliance":      ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "fitout":          ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "contracts":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "training":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "sales":           ["MM",  "OM",  "LEAD"],
    "snagreport":      ["MM",  "OM",  "SMS",  "LEAD"],
    "cleaning":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "cleanctl":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],   // Cleaning Control
    "beforeafter":     ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],   // Before / After: ghost camera + PowerPoint deck (on the device)
    "crm":             ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],   // CRM handhelds sheet
    "induction":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],   // Operations Induction deck per flagship
    "malfunctions":    ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "tenant360":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "portal":          ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "tpdb":            ["MM",  "OM",  "LEAD"],   // Tenant Portal Database (Nov 2026) — managers and leadership, like Portal Users
    "works":           ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "directory":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "gla":             ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "property":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "layouts":         ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "exec":            ["MM",  "OM",  "LEAD"],
    "accuracy":        ["MM",  "OM"],
    "performance":     ["MM",  "OM",  "SMS",  "LEAD"],   // Operations Performance Hub (Nov 2026)
    "projects":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],   /* Future + Tracker in one tile */
    "budget":          ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "snaglist":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "restroom":        ["MM",  "OM",  "LEAD"],
    "evacuation":      ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "incidents":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD", "SECM", "HOS"],
    "cleaner-qr":      ["MM",  "OM",  "SMS",  "MS",  "MO",  "SEC","SECM", "HOS",  "LEAD"],
    "footfall":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "abc-connect":     ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "tenant-connect":  ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "jde":             ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "archibus":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "pm-portal":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "successfactors":  ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "sign-in-help":    [],
    "pack":            ["MM",  "OM",  "LEAD"],
    "downloads":       ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "policies":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "SEC","SECM", "HOS", "LEAD"],
    "form-am":         ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-pm":         ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-dbank":      ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-open":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-close":      ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
  },

  /* who sees the extra copy of a tile placed in a folder with also: [...] (the tile's own folder follows ACCESS above) */
  ALSO_ACCESS: { "Leadership": ["MM", "OM", "LEAD"] },

  APPS: [
    /* Built into the hub — same sign-in, nothing to host separately */
    {
      id: "schedule",
      name: "Operations Schedule",
      desc: "Weekly shifts by flagship, ranked by position",
      group: "Day to Day Operations",
      icon: "calendar",
      color: "#4A1F73",
      url: "/tools/schedule"
    },
    {
      id: "mom",
      name: "Minutes of Meeting",
      desc: "Attendance, agenda, actions and deadlines",
      group: "Day to Day Operations",
      icon: "book",
      color: "#8A5A1F",
      url: "/tools/mom"
    },
    {
      id: "handover",
      name: "Shift Handover",
      desc: "Follow-ups, today, tomorrow, events and checklists",
      group: "Day to Day Operations",
      icon: "clipboard",
      color: "#2F6F73",
      url: "/tools/handover"
    },
    { id: "calendar", name: "Operations Calendar", desc: "Marketing events, ops activities, MOM, objectives and expiry dates", group: "Day to Day Operations", icon: "calendar", color: "#C2185B", url: "/tools/calendar" },
    /* Schedule & Calendar folder: opens a ring with the Operations Schedule and the Operations Calendar */
    { id: "schedule-calendar", name: "Schedule & Calendar", desc: "Operations Schedule and Operations Calendar", group: "Day to Day Operations", hidden: true, icon: "calendar", color: "#4A1F73", kind: "orbit", orbitGroup: "Schedule & Calendar", url: "#schedule-calendar" },
    /* Contractor Access folder: opens a ring with Contractors (who is in the mall now) and the Loading Gate */
    { id: "contractor-access", name: "Contractor Access", desc: "Contractors on site and the loading gate", group: "Day to Day Operations", hidden: true, icon: "hardhat", color: "#C07A12", kind: "orbit", orbitGroup: "Contractor Access", url: "#contractor-access" },
    { id: "crm", name: "CRM & Handhelds", desc: "CRM handhelds per tenant — S/N, model, connection, app user, delivery and retrieved devices", group: "Day to Day Operations", icon: "card", color: "#2B5797", url: "/tools/crm" },
    {
      id: "eod",
      name: "End of Day Report",
      desc: "Everything that happened at the flagship today — live",
      group: "Reports",
      icon: "chart",
      color: "#1F5F8B",
      url: "/tools/eod"
    },
    /* Opens an orbit ring of checklists. Add each checklist below with group "Operations Forms". */
    {
      id: "forms",
      name: "Operations Forms",
      desc: "Operational checklists",
      group: "Day to Day Operations",   // a card on the Day to Day timeline (Oct 2026)
      icon: "clipboard",
      color: "#8A2F6B",
      kind: "orbit",
      orbitGroup: "Operations Forms",
      url: "#forms"
    },
    /* Operations Forms feature — the checklists shown in the orbit ring (see docs/FEATURE-forms.md) */
    { id: "form-am", name: "AM Checklist", desc: "Pre-opening and morning shift checks", group: "Operations Forms", icon: "sun", color: "#C8892A", url: "/tools/forms?f=am" },
    { id: "form-pm", name: "PM Checklist", desc: "Evening shift and closing checks", group: "Operations Forms", icon: "moon", color: "#3C4F8A", url: "/tools/forms?f=pm" },
    { id: "form-dbank", name: "Direct Banking", desc: "Weekly Areeba machine inspection", group: "Operations Forms", also: ["Day to Day Operations"], icon: "card", color: "#2E6B4F", url: "/tools/forms?f=dbank" },
    { id: "form-open", name: "Tenant Opening", desc: "New tenant opening checklist", group: "Operations Forms", icon: "storeIn", color: "#2F6F73", url: "/tools/forms?f=open" },
    { id: "form-close", name: "Tenant Closing", desc: "Tenant closure checklist", group: "Operations Forms", icon: "storeOut", color: "#A33B3B", url: "/tools/forms?f=close" },
    /* Emergency Alert feature — see docs/FEATURE-emergency.md */
    {
      id: "emergency",
      name: "Emergency Alert",
      desc: "Alert everyone on shift — type and location",
      group: "Access and Security",
      /* a tile in Access and Security + the floating red button (Oct 2026) */
      icon: "siren",
      color: "#C62828",
      url: "/tools/emergency"
    },
    /* Reminders feature — see docs/FEATURE-reminders.md */
    {
      id: "reminders",
      name: "Reminders",
      desc: "Your team's own reminders — each title has its own list",
      group: "Operations Tools",
      icon: "alarm",
      color: "#B0562A",
      url: "/tools/reminders"
    },
    /* Operations Calendar feature — see docs/FEATURE-calendar.md */
    /* Downloads feature — see docs/FEATURE-downloads.md */
    /* Hub Phone — voice and video calls between hub users, extensions per flagship (see docs/FEATURE-hub-phone.md). Everyone can use it. */
    { id: "phone", name: "Hub Phone", desc: "Call any hub user — keypad, extensions, contacts, voice and video", group: "Phone", icon: "phone", color: "#2EB872", url: "/tools/phone?tab=calls" },
    /* Hub Chat — groups and one-to-one chats; the same page as Hub Phone, opened on Chats (see docs/FEATURE-hub-chat.md) */
    { id: "chat", name: "Hub Chat", desc: "Group and one-to-one chats — photos, files, voice notes", group: "Phone", icon: "chat", color: "#1E9E5E", url: "/tools/phone?tab=chats" },
    { id: "downloads", name: "Downloads", desc: "Files you exported or downloaded from the hub on this device", group: "Hub Applications", icon: "download", color: "#3C4F8A", url: "/tools/downloads" },
    /* Quick Access Pass — one-entry QR for a contractor or visitor, live 30 minutes, sent by WhatsApp (see docs/FEATURE-quick-pass.md). Everyone can open it. */
    { id: "quickpass", name: "Quick Access Pass", desc: "One-entry QR for a contractor or visitor — 30 minutes, sent by WhatsApp", group: "Access and Security", icon: "qr", color: "#1E8A4C", url: "/tools/quickpass" },
    /* Message of the moment — the admin writes the friendly lines shown above Day to Day (see docs/FEATURE-moments.md) */
    { id: "moments", name: "Message of the Moment", desc: "Friendly lines above Day to Day (admin only) — with their time", group: "Upcoming - Testing", hidden: true, icon: "megaphone", color: "#B08A2E", url: "/tools/moments" },
    /* Seasonal decorations — designs and dates of the hanging decorations (admin only, see docs/FEATURE-seasons.md) */
    { id: "seasons", name: "Seasonal Decorations", desc: "Designs and dates — Ramadan, Eid, Christmas, Independence Day…", group: "Upcoming - Testing", hidden: true, icon: "sun", color: "#C8892A", url: "/tools/seasons" },
    /* Contractors feature — see docs/FEATURE-contractors.md */
    { id: "contractors", name: "Contractors", desc: "Who is on site today — check in and out, register and insurance", group: "Access and Security", icon: "hardhat", color: "#C07A12", url: "/tools/contractors" },
    /* Loading Gate feature — see docs/FEATURE-gate.md */
    { id: "gate", name: "Loading Gate", desc: "Scan the contractor QR — Approved in or Rejected out", group: "Micro Tools", icon: "qr", color: "#2E8B57", url: "/tools/gate" },
    /* Projects feature — see docs/FEATURE-projects.md */
    { id: "projects", name: "Operations Projects", desc: "Future projects and the project tracker — from idea to done", group: "Day to Day Operations", icon: "target", color: "#4A1F73", url: "/tools/projects" },
    /* Security Patrol — QR checkpoints, rounds, offline guards' link, round reports (see docs/FEATURE-security-patrol.md) */
    { id: "patrol", name: "Security Patrol", desc: "QR checkpoints in the back areas — rounds, issues with photos, round reports", group: "Soft Services Management", icon: "shield", color: "#2A0F45", url: "/tools/patrol" },
    /* Tenant Evacuation Plan feature — see docs/FEATURE-evacuation.md */
    { id: "evacuation", name: "Tenant Evacuation Plan", desc: "Service corridor and assembly point for every active tenant", group: "Access and Security", icon: "exit", color: "#2E7D32", url: "/tools/evacuation" },
    /* Tenant Management feature: announcements first, then feedback, compliance and fit-out */
    /* Tenant 360 — one page per unit with everything the hub knows about the tenant (see docs/FEATURE-tenant-360.md) */
    { id: "tenant360", name: "Tenant 360", desc: "Pick a tenant: compliance, sales & score card, ABC Connect and employees on one board", group: "Tenant Management", icon: "users", color: "#4A1F73", url: "/tools/tenant360" },
    { id: "tenants", name: "Tenant Announcements", desc: "Opening, closure and relocation emails with photos", group: "Day to Day Operations", icon: "storeIn", color: "#2F6F73", url: "/tools/tenants" },
    {
      id: "feedback",
      name: "Tenant Feedback",
      desc: "Violations, customer feedback and actions by tenant",
      group: "Day to Day Operations",
      icon: "megaphone",
      color: "#A0442F",
      url: "/tools/feedback"
    },
    /* Leadership dashboards feature — see docs/FEATURE-leadership.md */
    { id: "performance", name: "Operations Performance Hub", desc: "Unified vertical dashboard — Overview, Soft Services, Accuracy, Snaglist, EOD", group: "Dashboards", icon: "gauge", color: "#4A1F73", url: "/tools/performance" },
    { id: "leadership", name: "Flagship Status & Soft Services", desc: "Every flagship's status, soft services and the monthly pack", group: "Dashboards", hidden: true, icon: "gauge", color: "#2A0F45", url: "/tools/leadership" }
  ]
};
