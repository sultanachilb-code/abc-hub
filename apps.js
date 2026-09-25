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
    }

    /* Next system goes here — add a comma after the } above, then paste:
    ,{
      id: "incidents",
      name: "Incident Report System",
      desc: "Incident log, SLAs, blacklist and escalation",
      group: "Incidents & Security",
      icon: "alert",
      color: "#A33B3B",
      url: "https://..."
    }
    */
  ]
};
