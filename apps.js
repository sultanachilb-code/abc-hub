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

  GROUPS: ["Day to Day Operations", "Property Overview & Info", "ABC Platforms", "Grok Space", "Tenant Management", "Micro Tools", "Access and Security", "Soft Services Management",
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
    "reporting-hub":   ["MM",  "OM",  "SMS",  "LEAD"],   // Reporting Hub (Grok Space)
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
    /* ... existing apps continue unchanged ... */
    /* Reporting Hub — Grok Space (vertical unified dashboard) */
    {
      id: "reporting-hub",
      name: "Reporting Hub",
      desc: "Unified vertical dashboard — Overview, Soft Services, Accuracy, Snaglist, EOD",
      group: "Grok Space",
      icon: "gauge",
      color: "#4A1F73",
      url: "/Grok Module/reporting-hub.html"
    },
  ]
};
