# Hub search across content (Oct 2026)
The home search (3+ characters) also shows "Found in the hub": units / tenants (opens Tenant 360 on the unit), REQ numbers
(contractor bookings and loading-gate scans), portal items BP / VR / NR (opens Portal Dashboard filtered), and contracts.
Only flagships the person can open, and only tools their position can see. Route: `GET /api/ops/find?q=` (`modules/find.js`).
The tool opens on the record through a one-time query string (`openDeep` in index.html).
