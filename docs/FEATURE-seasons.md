# Seasonal decorations (admin only)

Decorations hang on gold ropes from the bottom of the header into the empty white spaces on the left and right of the home page, with the greeting next to your name. They sway gently (and stop for people who ask for reduced motion). On narrow screens only the greeting shows.

## Admin page — Operations Tools › Seasonal Decorations (also in the profile menu)
For each season: **design**, **From / To** dates, greeting in **English** and **Arabic**, on/off, and **Preview** (shows it on your hub now for 10 minutes; *✕ preview* ends it). **+ Add a season** for more. *Show decorations* switches all of them off.

Designs: Santa, baubles & snow · Lanterns & crescent · Crescent, stars & lantern · Cedar, flag & bunting · Eggs & spring flowers · Hearts · Flowers · Sun & waves · Fireworks & stars.

Starting list (edit the dates each year): Independence Day 21–23 Nov · Christmas & New Year 1 Dec–6 Jan · Ramadan 8 Feb–9 Mar 2027 · Eid al-Fitr 10–12 Mar · Easter 26–29 Mar · Eid al-Adha 16–19 May · Summer (off).

Only the admin sees the decorations. Technical: `modules/seasons.js` (meta `seasons`), routes `GET /api/seasons`, `GET/POST /api/admin/seasons`; artwork in `tools/season-art.js` (original drawings); `paintSeason()` in `index.html`.
