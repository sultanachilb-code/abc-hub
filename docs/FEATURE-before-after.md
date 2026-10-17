# Before / After (ghost camera + PowerPoint deck)

`/tools/beforeafter` (`tools/beforeafter.html`) · folder **Upcoming - Testing** · operations team and management.
**Nothing is sent to the hub.** Photos go to the phone's gallery; drafts and the photos used by decks stay on the device (IndexedDB `abc-beforeafter`, latest 60 photos + everything used in a deck).

## Camera (after photos only — Oct 2026)
1. Choose the flagship and the area, then **＋ From gallery**: the before photo always comes from the phone's gallery.
2. Open the camera: the before photo shows over it as a faint **ghost** (8–65 %, default 28 %). **Edges** shows only its outlines; **Grid** helps to line up.
3. **Zoom** to get the exact angle: pinch with two fingers, use the slider, or tap 1× · 2× · 3×. The phone's own camera zoom is used when it offers one (most Android phones); otherwise a digital zoom up to 4× (the photo is cropped exactly as on screen).
4. Take the after photo.
5. **Save to gallery**: on a phone the share sheet opens (iPhone → **Save Image**; a web page cannot write to Photos directly); on a computer the files download. File names: `VRM_L2-corridor_2026-10-17_1802_before.jpg`, `…_after.jpg`, `…_before-after.jpg` (a side-by-side picture, made automatically).
6. Date, time, flagship and area are printed on the photo (switch off with the tick box).
7. **+ Add to a deck** sends the pair to a deck.

## Deck
- Several decks per device; each has a title, flagship, date, "prepared by", layout (**side by side** or **one big photo per slide**) and an optional **closing slide**.
- Pairs come from the camera or from two photos picked in the gallery; each slide has a title, place, before / after dates and notes; ↑ ↓ to reorder.
- **Download PowerPoint** builds a 16:9 .pptx in ABC purple (cover with the ABC logo · one slide per pair · closing slide), opening in PowerPoint, Keynote and Google Slides. Built in the browser with PptxGenJS 3.12.0, hosted in the hub (`tools/pptx/pptxgen.bundle.js`).
