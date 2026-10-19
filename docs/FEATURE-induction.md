# Operations Induction (Oct 2026)

Tile **Operations Induction** (folder *Upcoming - Testing*). One newcomer induction PowerPoint per flagship, made on the device with PptxGenJS (`tools/pptx/pptxgen.bundle.js`) — nothing is stored except the settings.

## The deck (13 slides, ABC purple and gold, fade transitions, automatic entrance animations)
Welcome · What we will cover · About ABC · Meet the team · Organization chart · Operations scope of work · Working with other departments ·
Coordination between departments · Daily operations tasks · Policies and procedures · Key tenant rules · Problem solving · Welcome aboard.
Combined from the 2026 Verdun inductions; the Negative/Positive approach slides, empty or placeholder slides and the fit-out responsibility matrix were left out.

## The team
- From **Admin → Hub users**: everyone whose account reaches the flagship (managers, operations team, security, warehouse), with their position and **profile picture** (initials on a purple circle when there is none). Advisor / Director / CDSO only when "Include Advisor / Director / CDSO" is ticked.
- Untick a person to leave them out (saved for the flagship). More than 8 people → 5 per row, 10 per slide.
- **Organization chart** is drawn from the titles: the first manager on top (Senior Mall Manager / Mall Manager first), the other managers, then Operations Team, Security and Warehouse boxes with their people.

## Settings per flagship (management and the Senior Mall Supervisor)
Name on the slides, short name, tenant manual, year, trading hours, tenant staff-in time, extra daily tasks, extra "other duties", extra technical items, head office departments, soft-service partners, cover photo.
Verdun Mall starts with the Verdun values (I-Play, patio heaters, Liban Park, CAT · Liban Park · MES Security · SIAD · Exotica). Other flagships start generic.

## Cover photo
Induction photo (uploaded here) → else the flagship cover from Profile → else (Verdun) the Verdun photo → else a purple ABC cover.

## Animations
Shapes named `A<group><z|u|f>_…` appear group after group when the slide opens (zoom · float up · fade); the timing XML is added with JSZip after PptxGenJS writes the file.

Routes: `GET /api/ops/ind/data?site=` · `POST /api/ops/ind/save` · `POST /api/ops/ind/cover` · `GET /api/ops/ind/cover?site=`. Table `ind_settings`.
