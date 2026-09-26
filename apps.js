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
     roles   who sees the tile: ["MANAGER","SUPERVISOR","SECURITY"]
             (leave out = everyone; Admins always see everything)
     sso     true = sign in automatically with the hub account
   Empty groups are hidden automatically.
   ===================================================================== */

window.HUB = {
  title: "ABC Operations Hub",
  org: "ABC Operations",

  GROUPS: ["Operations Tools", "Property Overview & Info", "Inspections", "Incidents & Security", "Operations", "Enterprise Systems", "Data & Reporting"],

  APPS: [
    /* Built into the hub — same sign-in, nothing to host separately */
    {
      id: "schedule",
      name: "Operations Schedule",
      desc: "Weekly shifts by flagship, ranked by position",
      group: "Operations Tools",
      icon: "calendar",
      color: "#4A1F73",
      url: "/tools/schedule"
    },
    {
      id: "mom",
      name: "Minutes of Meeting",
      desc: "Attendance, agenda, actions and deadlines",
      group: "Operations Tools",
      icon: "book",
      color: "#8A5A1F",
      url: "/tools/mom"
    },
    {
      id: "handover",
      name: "Shift Handover",
      desc: "Follow-ups, today, tomorrow, events and checklists",
      group: "Operations Tools",
      icon: "clipboard",
      color: "#2F6F73",
      url: "/tools/handover"
    },
    {
      id: "feedback",
      name: "Tenant Feedback",
      desc: "Violations, customer feedback and actions by tenant",
      group: "Operations Tools",
      icon: "megaphone",
      color: "#A0442F",
      url: "/tools/feedback"
    },
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
      name: "Snaglist Manager",
      desc: "Log, assign and close site snags",
      group: "Inspections",
      icon: "clipboard",
      color: "#4A1F73",
      url: "https://abc-snaglist.sultanalachi-work.workers.dev",
      sso: true
    },
    {
      id: "restroom",
      name: "Restroom Inspection Dashboard",
      desc: "Restroom QR inspection findings and reports",
      group: "Inspections",
      icon: "qr",
      color: "#2F6F73",
      url: "https://abc-restroom-report.sultanachi-lb-61f.workers.dev/",
      roles: ["MANAGER", "SUPERVISOR"]
    },
    {
      id: "incidents",
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
      name: "Cleaner QR Access",
      desc: "Issue and manage loading area cleaner passes",
      group: "Incidents & Security",
      icon: "shield",
      color: "#3C4F8A",
      url: "https://abcv-admin-access.sultanachi-lb-61f.workers.dev/",
      roles: ["MANAGER", "SECURITY"]
    },
    {
      id: "abc-connect",
      name: "ABC Connect",
      desc: "Employee portal (Salesforce)",
      group: "Operations",
      icon: "users",
      color: "#1B5E9E",
      url: "https://abclebanon.my.site.com/abcemployee/s/",
      embed: false
    },
    {
      id: "jde",
      name: "JD Edwards",
      desc: "Procurement — office network only",
      group: "Enterprise Systems",
      icon: "box",
      color: "#B4471F",
      url: "https://jdesrvweb.abc.com.lb:8882/jde/E1Menu.maf",
      embed: false,
      roles: ["MANAGER"]
    },
    {
      id: "archibus",
      name: "Archibus",
      desc: "Technical / maintenance — office network only",
      group: "Enterprise Systems",
      icon: "bolt",
      color: "#2E6B4F",
      url: "http://192.168.5.68:8080/archibus/login.axvw",
      embed: false,
      roles: ["MANAGER", "SUPERVISOR"]
    },
    {
      id: "successfactors",
      name: "SAP SuccessFactors",
      desc: "HR — performance and people",
      group: "Enterprise Systems",
      icon: "users",
      color: "#0A6ED1",
      url: "https://performancemanager8.successfactors.com/login#/companyEntry",
      embed: false
    },
    {
      id: "footfall",
      name: "Footfall Hub",
      desc: "Daily visitors and vehicles, year on year",
      group: "Data & Reporting",
      icon: "footfall",
      color: "#8A5A1F",
      url: "https://footfall-hub.sultanachi-lb-61f.workers.dev/",
      roles: ["MANAGER"]
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
