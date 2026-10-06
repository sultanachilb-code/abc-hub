# Malfunction Records (Oct 2026)
Tile in Operations Tools → `/tools/malfunctions`. Soft services and operations log every malfunction followed with a service provider.
- Providers (Chip and Soffa seeded) are shared by all flagships; management and Senior Mall Supervisors add or edit them.
- Each record: category, priority (Low → Critical), location, asset, description, provider + ticket ref, status
  Open → Reported to provider → In progress → Fixed → Closed with the time of each step (filled when the status moves, editable), notes and up to 4 photos per save (shrunk on the phone).
- Page: open / high-critical / average time to fix / fixed in 90 days, a scorecard per provider, search and filters.
- High / Critical malfunctions raise a hub alert; still-open ones appear in the shift-end check before a hand-over is submitted.
- Tables: `mf_providers`, `mf_records`, `mf_photos`. Routes `/api/ops/mf/*` (`modules/malfunctions.js`).
