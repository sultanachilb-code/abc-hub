/* =====================================================================
   REPORTING HUB — Grok Module (isolated)
   Vertical menu dashboard. Backend route lives in modules/performance.js
   ===================================================================== */

// This file is the isolated working copy.
// The live route remains in modules/performance.js and must be wired
// in worker.js only after user verification.

export const REPORTING_HUB_INFO = {
  name: "Reporting Hub",
  group: "Grok Space",
  url: "/Grok%20Module/reporting-hub.html",
  description: "Unified vertical dashboard for Overview, Soft Services, Accuracy, Snaglist, EOD and more"
};
