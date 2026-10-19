# Refresh on return + hub version (Oct 2026)

## Refresh on return
When the hub comes back on screen after **30 seconds or more** away (another app, phone locked, another tab), it reloads its data quietly, without reloading the page:
- **Home:** brief (and the role brief), Day to Day, tile badges, system status, notifications, announcements, approvals.
- **Tool pages** that set `window.hubRefresh` (common.js): Portal Dashboard, Contracts, Malfunctions, Calendar, Tenant 360, Data Accuracy, Compliance, Leadership, Works, End of Day, Cleaning control (Today). Not while a dialog is open or someone is typing.
- Shift Handover already refreshes itself (every 15–30 s and on return).
- Also on: a page restored by the browser's back/forward memory, and when the connection comes back.
- Coming back after less than 30 s only checks notifications and approvals (as before).
- The 5-minute brief timer now also refreshes the role brief.

The home footer shows **Updated HH:MM**.

## Hub version
Shown under the profile picture (top right) and at the end of the home page ("Hub v35").
It is read from the service-worker cache name in `sw.js` (`abc-hub-v35` → v35), which is bumped with every release — so there is one place to change.
