# Seasonal themes

Light decorations on the hub's header and a greeting chip, switched automatically by date:

| Theme | When |
|---|---|
| Ramadan Kareem · رمضان كريم | Hijri month of Ramadan (Umm al-Qura calendar of the browser) |
| Eid Mubarak · عيد مبارك | 1–3 Shawwal |
| Eid al-Adha Mubarak | 9–13 Dhu al-Hijjah |
| Happy Easter · فصح مجيد | Western and Orthodox Easter (Friday → Monday) |
| Happy Holidays · ميلاد مجيد | 1 December → 6 January |
| Happy New Year | 31 December → 2 January |
| Happy Independence Day | 21–23 November |
| Valentine's / Mother's Day | 13–14 February / 21 March |
| Summer at ABC | July and August |

Shown to the **admin only** (switch them off in the profile menu, **Seasonal decorations**). To show them to everyone, remove the admin check in `paintSeason()`. Animations stop for people who ask for reduced motion.
Technical: `seasonNow()` / `paintSeason()` in `index.html`.
