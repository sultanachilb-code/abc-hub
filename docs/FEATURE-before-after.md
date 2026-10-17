# Before / After (ghost camera + PowerPoint deck)

`/tools/beforeafter` (`tools/beforeafter.html`) · folder **Upcoming - Testing** · operations team and management.
**Nothing is sent to the hub.** Photos go to the phone's gallery; drafts and the photos used by decks stay on the device (IndexedDB `abc-beforeafter`, latest 60 photos + everything used in a deck).

## Camera
1. **Before**: choose the flagship, write the area (e.g. "L2 corridor"), open the camera, take the photo. The grid helps to remember the angle.
2. **After** (minutes or days later): pick the before photo from the list (taken on this phone) or **From gallery**. It shows over the camera as a faint **ghost** (8–65 %, default 28 %) — line it up with the real scene and take the after photo. **Edges** shows only the outlines of the before photo.
3. **Save to gallery**: on a phone the share sheet opens (iPhone → **Save Image**; a web page cannot write to Photos directly); on a computer the files download. File names: `VRM_L2-corridor_2026-10-17_1802_before.jpg`, `…_after.jpg`, `…_before-after.jpg` (a side-by-side picture, made automatically).
4. Date, time, flagship and area are printed on the photo (switch off with the tick box).
5. **+ Add to a deck** sends the pair to a deck.

## Deck
- Several decks per device; each has a title, flagship, date, "prepared by", layout (**side by side** or **one big photo per slide**) and an optional **closing slide**.
- Pairs come from the camera or from two photos picked in the gallery; each slide has a title, place, before / after dates and notes; ↑ ↓ to reorder.
- **Download PowerPoint** builds a 16:9 .pptx in ABC purple (cover with the ABC logo · one slide per pair · closing slide), opening in PowerPoint, Keynote and Google Slides. Built in the browser with PptxGenJS 3.12.0, hosted in the hub (`tools/pptx/pptxgen.bundle.js`).
