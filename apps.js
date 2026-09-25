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
             | camera | shield | users | footfall | bug | book
     color   tile colour
     url     the system link (single-site systems)
     sites   { "Flagship name": "url", ... }  (per-flagship systems —
             the user picks the flagship before it opens)
     embed   false = open in its own app window instead of inside the hub
             (use for systems that refuse to be embedded, e.g. Salesforce)
   Any url containing "REPLACE" shows as "Not configured" and stays locked.
   ===================================================================== */

window.HUB = {
  title: "ABC Operations Hub",
  org: "ABC Operations",

  GROUPS: ["Inspections", "Incidents & Security", "Operations", "Data & Reporting"],

  APPS: [
    { id: "snaglist", name: "Snaglist Manager", desc: "Log, assign and close site snags",
      group: "Inspections", icon: "clipboard", color: "#4A1F73",
      url: "https://REPLACE-abc-snaglist.workers.dev" },

    { id: "restroom-qr", name: "Restroom QR Inspection", desc: "GPS-validated restroom checks",
      group: "Inspections", icon: "qr", color: "#2F6F73",
      sites: {
        "Verdun Mall": "https://REPLACE-restroom-verdun.pages.dev",
        "Achrafieh Mall": "https://REPLACE-restroom-achrafieh.pages.dev",
        "Dbayeh Department Store": "https://REPLACE-restroom-dbayeh.pages.dev",
        "Achrafieh Department Store": "https://REPLACE-restroom-achrafieh-ds.pages.dev",
        "Verdun Department Store": "https://REPLACE-restroom-verdun-ds.pages.dev"
      } },

    { id: "audit", name: "Audit Manager", desc: "Multi-auditor site audits with photo capture",
      group: "Inspections", icon: "book", color: "#6B3FA0",
      url: "https://REPLACE-sultanachilb-code.github.io/audit" },

    { id: "incidents", name: "Incident Report System", desc: "Incident log, SLAs, blacklist and escalation",
      group: "Incidents & Security", icon: "alert", color: "#A33B3B",
      url: "https://REPLACE-abc-incidents.workers.dev" },

    { id: "cleaner-qr-admin", name: "Loading Area Pass — Admin", desc: "Issue and manage cleaner QR passes",
      group: "Incidents & Security", icon: "shield", color: "#3C4F8A",
      url: "https://REPLACE-loading-admin.pages.dev" },

    { id: "cleaner-qr-review", name: "Loading Area Pass — Review", desc: "Scan and verify cleaner passes",
      group: "Incidents & Security", icon: "camera", color: "#3C4F8A",
      url: "https://REPLACE-loading-review.pages.dev" },

    { id: "loading-control", name: "Loading Area Control", desc: "Vehicle entry with plate recognition",
      group: "Incidents & Security", icon: "truck", color: "#55606E",
      url: "https://REPLACE-loading-control.pages.dev" },

    { id: "scheduler", name: "Operations Scheduler", desc: "Shifts, tasks and reminders",
      group: "Operations", icon: "calendar", color: "#2E6B4F",
      url: "https://REPLACE-ops-scheduler.workers.dev" },

    { id: "inventory", name: "Inventory — Verdun", desc: "Warehouse stock, usage and goods control",
      group: "Operations", icon: "box", color: "#8A5A1F",
      url: "https://script.google.com/macros/s/REPLACE/exec" },

    { id: "connect-issues", name: "ABC Connect Issue Tracker", desc: "Portal issues and follow-up",
      group: "Operations", icon: "bug", color: "#4A1F73",
      url: "https://REPLACE-connect-issues.pages.dev" },

    { id: "footfall", name: "Footfall Hub", desc: "Daily visitors and vehicles, year on year",
      group: "Data & Reporting", icon: "footfall", color: "#2F6F73",
      url: "https://REPLACE-footfall.pages.dev" },

    { id: "utilities", name: "Utilities Intelligence", desc: "GEN / EDL / cooling / water per tenant",
      group: "Data & Reporting", icon: "bolt", color: "#8A5A1F",
      url: "https://REPLACE-utilities.pages.dev" },

    { id: "cleaning-report", name: "Daily Cleaning Report", desc: "Contractor daily cleaning reports",
      group: "Data & Reporting", icon: "chart", color: "#55606E",
      url: "https://REPLACE-cleaning-report.pages.dev" }
  ]
};
