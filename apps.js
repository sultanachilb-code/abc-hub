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
             | gauge | scale | handshake | scroll
     color   tile colour
     url     the system link (single-site systems)
     sites   { "Flagship name": "url", ... }  (per-flagship systems)
     embed   false = open in its own window instead of inside the hub
     roles   who sees the tile: ["MANAGER","SUPERVISOR","SECURITY"]
             (leave out = everyone; Admin, Property Advisor, Mall Directors and
             the Chief Department Store Operations Officer always see everything)
     sso     true = sign in automatically with the hub account
   Empty groups are hidden automatically.
   ===================================================================== */

window.HUB = {
  title: "ABC Operations Hub",
  org: "ABC Operations",

  GROUPS: ["Leadership", "Operations Tools", "Tenant Management", "Property Overview & Info", "Inspections", "Incidents & Security", "Operations", "Enterprise Systems", "Data & Reporting", "Policies & Procedures", "Operations Forms"],

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
    /* Tenant Management feature: announcements first, then feedback, compliance and fit-out */
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
    { id: "leadership", name: "Performance Dashboard", desc: "Every flagship's status, soft services and the monthly pack", group: "Leadership", icon: "gauge", color: "#2A0F45", url: "/tools/leadership", roles: ["ADVISOR", "DIRECTOR", "CDSO"] },
    /* Tenant Management feature — see docs/FEATURE-tenant-management.md */
    { id: "compliance", name: "Tenant Compliance", desc: "Monthly score and repeat offenders", group: "Tenant Management", icon: "shield", color: "#A0442F", url: "/tools/compliance" },
    { id: "fitout", name: "Fit-out Tracker", desc: "Milestones from Reserved to Open", group: "Tenant Management", icon: "box", color: "#8A5A1F", url: "/tools/fitout" },
    /* Tenants Directory feature — see docs/FEATURE-directory.md */
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
      group: "Property Overview & Info",
      icon: "chart",
      color: "#0F5C7A",
      url: "/tools/exec",
      roles: ["MANAGER"]          /* flagship management and leadership only — not the operations team */
    },
    /* Budget (CAPEX / OPEX) feature — see docs/FEATURE-budget.md */
    {
      id: "budget",
      name: "Budget · CAPEX & OPEX",
      desc: "Budget lines by flagship — prepare the JDE request",
      group: "Property Overview & Info",
      icon: "wallet",
      color: "#8A6D1F",
      url: "/tools/budget",
      roles: ["MANAGER", "SUPERVISOR"]
    },
    /* Data Accuracy Score feature — see docs/FEATURE-accuracy.md */
    {
      id: "accuracy",
      name: "Data Accuracy Score",
      desc: "When the GLA, property details, executive report and budget were last updated",
      group: "Property Overview & Info",
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
      roles: ["MANAGER", "SUPERVISOR"]   /* operations team uses it for the budget requests */
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
    },
    /* Policies & Procedures — the three systems are placeholders until their content is built */
    { id: "pp-owner", name: "Owner", desc: "Owner policies and procedures", group: "Policies & Procedures", icon: "scale", color: "#4A1F73", url: "/tools/policies?s=owner" },
    { id: "pp-assist", name: "Assist", desc: "Assist policies and procedures", group: "Policies & Procedures", icon: "handshake", color: "#2F6F73", url: "/tools/policies?s=assist" },
    { id: "pp-general", name: "ABC General Policies", desc: "Company-wide policies", group: "Policies & Procedures", icon: "scroll", color: "#8A5A1F", url: "/tools/policies?s=general" }

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
