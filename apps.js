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
     sites   { "Flagship name": "url", ... }  (per-flagship systems)
     embed   false = open in its own window instead of inside the hub
   Empty groups are hidden automatically.
   ===================================================================== */

window.HUB = {
  title: "ABC Operations Hub",
  org: "ABC Operations",

  GROUPS: ["Inspections", "Incidents & Security", "Operations", "Data & Reporting"],

  APPS: [
    {
      id: "snaglist",
      name: "Snaglist Manager",
      desc: "Log, assign and close site snags",
      group: "Inspections",
      icon: "clipboard",
      color: "#4A1F73",
      url: "https://abc-snaglist.sultanalachi-work.workers.dev"
    },
    {
      id: "restroom",
      name: "Restroom Inspection Dashboard",
      desc: "Restroom QR inspection findings and reports",
      group: "Inspections",
      icon: "qr",
      color: "#2F6F73",
      url: "https://abc-restroom-report.sultanachi-lb-61f.workers.dev/"
    },
    {
      id: "incidents",
      name: "Incident Report System",
      desc: "Incident log, SLAs, blacklist and escalation",
      group: "Incidents & Security",
      icon: "alert",
      color: "#A33B3B",
      url: "https://abc-incident-system.sultanachi-lb-61f.workers.dev/"
    },
    {
      id: "cleaner-qr",
      name: "Cleaner QR Access",
      desc: "Issue and manage loading area cleaner passes",
      group: "Incidents & Security",
      icon: "shield",
      color: "#3C4F8A",
      url: "https://abcv-admin-access.sultanachi-lb-61f.workers.dev/"
    },
    {
      id: "footfall",
      name: "Footfall Hub",
      desc: "Daily visitors and vehicles, year on year",
      group: "Data & Reporting",
      icon: "footfall",
      color: "#8A5A1F",
      url: "https://footfall-hub.sultanachi-lb-61f.workers.dev/"
    }

      {
      id: "abc-connect",
      name: "ABC Connect",
      desc: "Tenant portal (Salesforce)",
      group: "Operations",
      icon: "users",
      color: "#1B5E9E",
      url: "https://abclebanon.my.site.com/abcemployee/login?ec=302&startURL=%2Fabcemployee%2Fs%2F",
      embed: false
    }
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
