# Hotspot map (Mall Layouts)

**🔥 Hotspots** on Mall Layouts shows where things keep going wrong, as a heat map on the level plans.

- Sources: **Snaglist findings**, **Malfunction Records**, **Security Patrol issues** and **Incident reports** — switch each on or off.
- Period: last 7 days, this month, last 30 days, last month, last 90 days.
- Each finding is placed by its location text: a **place pin's name** ("Garbage room"), a **unit code** ("L4-005", "G-12", "l405") or the **brand** in that unit ("Zara").
- Tap a hot circle for the list. The side panel ranks the hottest spots of the level and of the whole flagship.
- **Not placed**: locations that match no pin, with their counts. Add a place pin with that name (Adjust pins → tap the plan) and they appear next time.

Technical: `modules/hotspots.js` (`GET /api/ops/layouts/hot?site=&from=&to=`). Snags come from the Snaglist (`?hubloc=1`, needs the latest Snaglist). Incidents are read day by day from the Incident system; past days are kept in `meta` (`hot:inc:<site>:<day>`).
