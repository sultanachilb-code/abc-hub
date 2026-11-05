# Hub Guidebooks (Nov 2026)

Step-by-step flip-book guides of the hub — tile **Hub Guidebooks** in **Upcoming - Testing** (`/tools/guide`).

## Books
| Book | Who reads it |
|---|---|
| 1 · Supervisors (9 chapters) | Senior Mall Supervisor, Mall Supervisor, Mall Officer, Warehouse, DS Floor Managers |
| 2 · Directors & Managers (6) | Property Advisor, Mall Director, Mall Manager, Operations Manager / Deputy |
| 3 · CDSO (5) | Chief Department Store Operations Officer |
| 4 · Security (6, English / عربي) | Security, Security Manager, Head of Security |

- Each person opens straight on the book of their title, at the first chapter not done. **Admin and managers** see all four books on the shelf.
- A chapter = an open book: steps on the left page; pictures / videos, a "Try it" home-screen exercise and a check question on the right.
  The page turns like paper (swipe, arrows or Next). On a phone the two pages stack.
- A chapter is **complete** when its check question is answered correctly. The last page is the book's certificate.
- **First sign-in:** after the Welcome window, the hub opens the guide once by itself (`guideFirst()` in `index.html`, once per person per device, only if no chapter is done yet).

## Progress
- Saved per hub account (table `guide_progress`: email, name, role, position, flagship, books JSON).
- **Team progress** button: Admin, managers, Advisor, Directors, CDSO and Head of Security. Each sees the people of their flagships (Admin and Advisor: everyone).

## Pictures and videos
- The **administrator** taps a dashed slot in any chapter → *+ Add screenshot / video* (PNG, JPG, WebP, MP4, WebM, MOV — 25 MB at most). *Replace* / *Remove* the same way.
- Kept in R2 `guide/<book>.<chapter>.<n>-<id>.<ext>`, listed in table `guide_media`. Slots with nothing uploaded are hidden from everyone else.
- Videos: short vertical phone screen recordings, 30–60 s, play inside the page.

## Technical
- `modules/guide.js` — routes under `/api/ops/guide/`: `me`, `progress`, `team`, `media`, `media/remove`, `file?slot=`. Needs no flagship (`opsRoute` answers it first).
- `tools/guide.html` — the content (`BOOKS`) lives at the top of its script; chapter ids are the slot keys, so keep them when editing text.
- `apps.js` tile `guide` (Upcoming - Testing); `TESTING_OPEN` in `worker.js` includes `guide`. When it moves to its real folder, add an `ACCESS` line (everyone).
