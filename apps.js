/* =====================================================================
   ABC Operations Hub — system registry
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
   Empty groups are hidden automatically.
   ===================================================================== */

window.HUB = {
  title: "ABC Operations Hub",
  org: "ABC Operations",

  GROUPS: ["Day to Day Operations", "Leadership", "Operations Tools", "Tenant Management", "Property Overview & Info", "Executive Report", "Operations Projects and Budget", "Inspections", "Incidents & Security", "Operations", "Enterprise Systems", "Data & Reporting", "Policies & Procedures", "Operations Forms", "Contractor Access"],

  /* Who sees each tile, by position (from the Access sheet, Oct 2026). Admin always sees everything.
       MM   Mall Manager / Senior Mall Manager     OM  Operations Manager / Deputy Operations Manager
       SMS  Senior Mall Supervisor   MS  Mall Supervisor   MO  Mall Officer   WH  Warehouse
       SEC  Security                 LEAD  Property Advisor / Mall Director / CDSO
     A system missing from this list is seen by everyone. Keep APP_ACCESS in worker.js in line (push notifications). */
  ACCESS: {
    "schedule":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "LEAD"],
    "mom":             ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "LEAD"],
    "handover":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "WH",  "LEAD"],
    "contractors":     ["OM",  "SMS",  "MS",  "MO",  "SEC", "LEAD"],
    "gate":            ["OM",  "SMS",  "MS",  "MO",  "SEC", "LEAD"],
    "contractor-access": ["OM",  "SMS",  "MS",  "MO",  "SEC", "LEAD"],
    "leadership":      ["LEAD"],
    "eod":             ["MM",  "OM"],
    "forms":           ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "emergency":       ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "reminders":       ["MM",  "OM"],
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
    "malfunctions":    ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "tenant360":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "portal":          ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
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
    "incidents":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "cleaner-qr":      ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "abc-connect":     ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "tenant-connect":  ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "jde":             ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "archibus":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "pm-portal":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "successfactors":  ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "sign-in-help":    [],
    "pack":            ["MM",  "OM",  "LEAD"],
    "downloads":       ["MM",  "OM",  "SMS",  "MS",  "MO"],
    "footfall":        [],
    "policies":        ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-am":         ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-pm":         ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-dbank":      ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-open":       ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
    "form-close":      ["MM",  "OM",  "SMS",  "MS",  "MO",  "LEAD"],
  },

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
    /* Contractor Access folder: opens a ring with Contractors (who is in the mall now) and the Loading Gate */
    { id: "contractor-access", name: "Contractor Access", desc: "Contractors on site and the loading gate", group: "Day to Day Operations", icon: "hardhat", color: "#C07A12", kind: "orbit", orbitGroup: "Contractor Access", url: "#contractor-access" },
    {
      id: "eod",
      name: "End of Day Report",
      desc: "Everything that happened at the flagship today — live",
      group: "Operations Tools",
      icon: "chart",
      color: "#1F5F8B",
      url: "/tools/eod"
    },
    /* Opens an orbit ring of checklists. Add each checklist below with group "Operations Forms". */
    {
      id: "forms",
      name: "Operations Forms",
      desc: "Operational checklists",
      group: "Operations Tools",
      icon: "clipboard",
      color: "#8A2F6B",
      kind: "orbit",
      orbitGroup: "Operations Forms",
      url: "#forms"
    },
    /* Operations Forms feature — the checklists shown in the orbit ring (see docs/FEATURE-forms.md) */
    { id: "form-am", name: "AM Checklist", desc: "Pre-opening and morning shift checks", group: "Operations Forms", icon: "sun", color: "#C8892A", url: "/tools/forms?f=am" },
    { id: "form-pm", name: "PM Checklist", desc: "Evening shift and closing checks", group: "Operations Forms", icon: "moon", color: "#3C4F8A", url: "/tools/forms?f=pm" },
    { id: "form-dbank", name: "Direct Banking", desc: "Weekly Areeba machine inspection", group: "Operations Forms", icon: "card", color: "#2E6B4F", url: "/tools/forms?f=dbank" },
    { id: "form-open", name: "Tenant Opening", desc: "New tenant opening checklist", group: "Operations Forms", icon: "storeIn", color: "#2F6F73", url: "/tools/forms?f=open" },
    { id: "form-close", name: "Tenant Closing", desc: "Tenant closure checklist", group: "Operations Forms", icon: "storeOut", color: "#A33B3B", url: "/tools/forms?f=close" },
    /* Emergency Alert feature — see docs/FEATURE-emergency.md */
    {
      id: "emergency",
      name: "Emergency Alert",
      desc: "Alert everyone on shift — type and location",
      group: "Operations Tools",
      hidden: true,          /* opened from the floating red button, not listed in the menus */
      icon: "siren",
      color: "#C62828",
      url: "/tools/emergency"
    },
    /* Reminders feature — see docs/FEATURE-reminders.md */
    {
      id: "reminders",
      name: "Reminders",
      desc: "Pending tasks pushed to everyone at the flagship",
      group: "Operations Tools",
      icon: "alarm",
      color: "#B0562A",
      url: "/tools/reminders"
    },
    /* Operations Calendar feature — see docs/FEATURE-calendar.md */
    /* Monthly operations pack feature — see docs/FEATURE-ops-pack.md */
    { id: "pack", name: "Monthly Operations Pack", desc: "One page per flagship — this month against last month", group: "Data & Reporting", icon: "pack", color: "#2A0F45", url: "/tools/pack" },
    /* Downloads feature — see docs/FEATURE-downloads.md */
    { id: "downloads", name: "Downloads", desc: "Files you exported or downloaded from the hub on this device", group: "Data & Reporting", icon: "download", color: "#3C4F8A", url: "/tools/downloads" },
    /* Contractors feature — see docs/FEATURE-contractors.md */
    { id: "contractors", name: "Contractors", desc: "Who is on site today — check in and out, register and insurance", group: "Contractor Access", icon: "hardhat", color: "#C07A12", url: "/tools/contractors" },
    /* Loading Gate feature — see docs/FEATURE-gate.md */
    { id: "gate", name: "Loading Gate", desc: "Scan the contractor QR — Approved in or Rejected out", group: "Contractor Access", icon: "qr", color: "#2E8B57", url: "/tools/gate" },
    /* Projects feature — see docs/FEATURE-projects.md */
    { id: "projects", name: "Operations Projects", desc: "Future projects and the project tracker — from idea to done", group: "Operations Projects and Budget", icon: "target", color: "#4A1F73", url: "/tools/projects" },
    /* Tenant Evacuation Plan feature — see docs/FEATURE-evacuation.md */
    { id: "evacuation", name: "Tenant Evacuation Plan", desc: "Service corridor and assembly point for every active tenant", group: "Incidents & Security", icon: "exit", color: "#2E7D32", url: "/tools/evacuation" },
    /* Tenant Management feature: announcements first, then feedback, compliance and fit-out */
    /* Tenant 360 — one page per unit with everything the hub knows about the tenant (see docs/FEATURE-tenant-360.md) */
    { id: "tenant360", name: "Tenant 360", desc: "One page per unit — contract, portal items, violations, fit-out, works, contacts, contractors", group: "Tenant Management", icon: "users", color: "#4A1F73", url: "/tools/tenant360" },
    { id: "tenants", name: "Tenant Announcements", desc: "Opening, closure and relocation emails with photos", group: "Tenant Management", icon: "storeIn", color: "#2F6F73", url: "/tools/tenants" },
    {
      id: "feedback",
      name: "Tenant Feedback",
      desc: "Violations, customer feedback and actions by tenant",
      group: "Tenant Management",
      icon: "megaphone",
      color: "#A0442F",
      url: "/tools/feedback"
    },
    /* Leadership dashboards feature — see docs/FEATURE-leadership.md */
    { id: "leadership", name: "Performance Dashboard", desc: "Every flagship's status, soft services and the monthly pack", group: "Leadership", icon: "gauge", color: "#2A0F45", url: "/tools/leadership" },
    /* Tenant Management feature — see docs/FEATURE-tenant-management.md */
    { id: "compliance", name: "Tenant Compliance", desc: "Monthly score and repeat offenders", group: "Tenant Management", icon: "shield", color: "#A0442F", url: "/tools/compliance" },
    { id: "fitout", name: "Fit-out Tracker", desc: "Milestones from Reserved to Open", group: "Tenant Management", icon: "box", color: "#8A5A1F", url: "/tools/fitout" },
    /* Tenants Directory feature — see docs/FEATURE-directory.md */
    { id: "contracts", name: "Contracts Near Ending", desc: "Daily Salesforce report by email — departures, ends and renewals", group: "Tenant Management", icon: "scroll", color: "#8A3B5A", url: "/tools/contracts" },
    /* Tenant portal follow-up — see docs/FEATURE-portal-followup.md */
    { id: "portal", name: "Portal Dashboard", desc: "Breaches & penalties, violations and ABC requests waiting on tenants", group: "Operations Tools", icon: "megaphone", color: "#6B2E8C", url: "/tools/portal" },
    /* Malfunction Records — soft services and operations follow the service providers (see docs/FEATURE-malfunctions.md) */
    { id: "malfunctions", name: "Malfunction Records", desc: "Malfunctions handled by service providers — reported, attended, fixed", group: "Operations Tools", icon: "bolt", color: "#B5452B", url: "/tools/malfunctions" },
    { id: "works", name: "Tenant Works Forms", desc: "RDM forms forwarded by email — sign and complete", group: "Tenant Management", icon: "scroll", color: "#2F6F7E", url: "/tools/works" },
    { id: "directory", name: "Tenants Directory", desc: "Tenant contacts for reception — names, mobiles, emails", group: "Tenant Management", icon: "users", color: "#3C4F8A", url: "/tools/directory" },
    /* Property Overview & Info — more property references will join this section */
    {
      id: "gla",
      name: "GLA & Occupancy",
      desc: "Units, brands, areas and occupancy by level",
      group: "Property Overview & Info",
      icon: "chart",
      color: "#3E5C8A",
      url: "/tools/gla"
    },
    /* Property Details feature — see docs/FEATURE-property-details.md */
    {
      id: "property",
      name: "Property Details",
      desc: "Areas, occupancy, teams, parking, technical assets and more",
      group: "Property Overview & Info",
      icon: "book",
      color: "#6B3F8F",
      url: "/tools/property"
    },
    /* Executive Report feature — see docs/FEATURE-exec-report.md */
    {
      id: "exec",
      name: "Executive Report",
      desc: "Monthly executive summary — occupancy, leasing, CAPEX, QC",
      group: "Executive Report",
      icon: "chart",
      color: "#0F5C7A",
      url: "/tools/exec"
    },
    /* Budget (CAPEX / OPEX) feature — see docs/FEATURE-budget.md */
    {
      id: "budget",
      name: "Budget · CAPEX & OPEX",
      desc: "Budget lines by flagship — prepare the JDE request",
      group: "Operations Projects and Budget",
      icon: "wallet",
      color: "#8A6D1F",
      url: "/tools/budget"
    },
    /* Data Accuracy Score feature — see docs/FEATURE-accuracy.md */
    /* Tenant Sales & Score Card — sales file read on the page only, never saved (see docs/FEATURE-tenant-sales.md) */
    { id: "sales", name: "Tenant Sales & Score Card", desc: "YTD vs last year, sales / m², categories and a score card per tenant — file not saved", group: "Executive Report", icon: "chart", color: "#7B4BB0", url: "/tools/sales" },
    {
      id: "accuracy",
      name: "Data Accuracy Score",
      desc: "When the GLA, property details, executive report and budget were last updated",
      group: "Executive Report",
      icon: "gauge",
      color: "#2E6B4F",
      url: "/tools/accuracy"
    },
    /* Mall Layouts feature — see docs/FEATURE-layouts.md */
    {
      id: "layouts",
      name: "Mall Layouts",
      desc: "Level plans with live unit status — find any brand",
      group: "Property Overview & Info",
      icon: "box",
      color: "#2F6F5E",
      url: "/tools/layouts"
    },
    {
      id: "snaglist",
      logo: "/logos/snaglist.png",   /* replace the file in /logos to change the picture */
      name: "Snaglist Manager",
      desc: "Log, assign and close site snags",
      group: "Inspections",
      icon: "clipboard",
      color: "#4A1F73",
      url: "https://abc-snaglist.sultanalachi-work.workers.dev",
      sso: true
    },
    /* Snaglist consolidated report — all flagships, from the Snaglist Manager (see docs/FEATURE-snaglist-report.md) */
    { id: "snagreport", name: "Snaglist Report", desc: "All flagships — findings open, added and solved, site visits, oldest open", group: "Inspections", icon: "chart", color: "#4A1F73", url: "/tools/snagreport" },
    /* Cleaning headcount control — punching record PDF vs planned headcount (see docs/FEATURE-cleaning-control.md) */
    { id: "cleaning", name: "Cleaning Headcount", desc: "Provider punching record vs planned headcount — shortages, lates, missing punches", group: "Inspections", icon: "users", color: "#2F6F73", url: "/tools/cleaning" },
    {
      id: "restroom",
      logo: "/logos/restroom.png",   /* replace the file in /logos to change the picture */
      name: "Restroom Inspection Dashboard",
      desc: "Restroom QR inspection findings and reports",
      group: "Inspections",
      icon: "qr",
      color: "#2F6F73",
      url: "https://abc-restroom-report.sultanachi-lb-61f.workers.dev/",
      sso: true   /* signs in with the hub account once connectors/hub-sso-connector.js is in that system; until then its own sign-in page opens */
    },
    {
      id: "incidents",
      logo: "/logos/incidents.png",   /* replace the file in /logos to change the picture */
      name: "Incident Report System",
      desc: "Incident log, SLAs, blacklist and escalation",
      group: "Incidents & Security",
      icon: "alert",
      color: "#A33B3B",
      url: "https://abc-incident-system.sultanachi-lb-61f.workers.dev/",
      sso: true
    },
    {
      id: "cleaner-qr",
      logo: "/logos/cleaner-qr.png",   /* replace the file in /logos to change the picture */
      name: "Cleaner QR Access",
      desc: "Issue and manage loading area cleaner passes",
      group: "Incidents & Security",
      icon: "shield",
      color: "#3C4F8A",
      url: "https://abcv-admin-access.sultanachi-lb-61f.workers.dev/",
      sso: true   /* signs in with the hub account once connectors/hub-sso-connector.js is in that system; until then its own sign-in page opens */
    },
    {
      id: "abc-connect",
      logo: "/logos/abc-connect.png",   /* replace the file in /logos to change the picture */
      name: "ABC Connect",
      desc: "Employee portal (Salesforce)",
      group: "Enterprise Systems",
      icon: "users",
      color: "#1B5E9E",
      url: "https://abclebanon.my.site.com/abcemployee/s/",
      embed: false
    },
    {
      id: "tenant-connect",
      logo: "/logos/tenant-connect.png",   /* replace the file in /logos to change the picture */
      name: "Tenant Connect",
      desc: "Tenant portal (Salesforce) — requests and approvals",
      group: "Enterprise Systems",
      icon: "handshake",
      color: "#2F6F7E",
      url: "https://abclebanon.my.site.com/abctenant/s/",
      embed: false
    },
    {
      id: "jde",
      logo: "/logos/jde.png",   /* replace the file in /logos to change the picture */
      name: "JD Edwards",
      desc: "Procurement — office network only",
      group: "Enterprise Systems",
      icon: "box",
      color: "#B4471F",
      url: "https://jdesrvweb.abc.com.lb:8882/jde/E1Menu.maf",
      embed: false
    },
    {
      id: "archibus",
      logo: "/logos/archibus.png",   /* replace the file in /logos to change the picture */
      name: "Archibus",
      desc: "Technical / maintenance — office network only",
      group: "Enterprise Systems",
      icon: "bolt",
      color: "#2E6B4F",
      url: "http://192.168.5.68:8080/archibus/login.axvw",
      embed: false
    },
    {
      id: "pm-portal",
      logo: "/logos/pm-portal.png",   /* replace the file in /logos to change the picture */
      name: "PM Portal",
      desc: "Company PM system — office network only",
      group: "Enterprise Systems",
      icon: "clipboard",
      color: "#5A3E8A",
      url: "http://pm/pm/Home.aspx?dir=ltr&HeaderId=20",   /* no employee ID in the link: each person signs in as themselves */
      embed: false
    },
    {
      id: "successfactors",
      logo: "/logos/successfactors.png",   /* replace the file in /logos to change the picture */
      name: "SAP SuccessFactors",
      desc: "HR — performance and people",
      group: "Enterprise Systems",
      icon: "users",
      color: "#0A6ED1",
      url: "https://performancemanager8.successfactors.com/sf/home?bplte_company=abcsal",   /* company sign-in (SSO) */
      embed: false
    },
    { id: "sign-in-help", name: "Sign-in help", desc: "Save company passwords safely in your browser — one-tap sign-in", group: "Enterprise Systems", icon: "shield", color: "#5A3E8A", url: "/tools/sign-in-help" },
    {
      id: "footfall",
      logo: "/logos/footfall.png",   /* replace the file in /logos to change the picture */
      name: "Footfall Hub",
      desc: "Daily visitors and vehicles, year on year",
      group: "Data & Reporting",
      icon: "footfall",
      color: "#8A5A1F",
      url: "https://footfall-hub.sultanachi-lb-61f.workers.dev/",
      sso: true   /* signs in with the hub account once connectors/hub-sso-connector.js is in that system; until then its own sign-in page opens */
    },
    /* Policies & Procedures — the three systems are placeholders until their content is built */
    /* Training & induction tracker (see docs/FEATURE-training.md) */
    { id: "training", name: "Training Tracker", desc: "Who completed which training, what expires, what is still needed", group: "Policies & Procedures", icon: "book", color: "#2E6B4F", url: "/tools/training" },
    { id: "policies", name: "Policies & Procedures", desc: "Owner, Assist and ABC General policies in one place", group: "Policies & Procedures", icon: "scale", color: "#4A1F73", url: "/tools/policies" }

    /* Next system goes here — add a comma after the } above, then paste:
    ,{
      id: "unique-id",
      name: "System name",
      desc: "One-line description",
      group: "Operations",
      icon: "calendar",
      color: "#2E6B4F",
      url: "https://..."
    }
    */
  ]
};
