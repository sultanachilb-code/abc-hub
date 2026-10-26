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

## Version 2 (Oct 2026) — full-screen camera, "Take after", alignment
- **Camera tab = the before photos list.** "＋ Add before photos from Photos" (several at once). Each before photo waiting for its after has **📷 Take after**; finished pairs move to **Done** (Side by side · + Deck).
- **Full-screen camera** (like the iPhone camera; truly full screen when the hub is opened from its home-screen icon): the frame has the before photo's exact shape,
  the before photo is a ghost (slider), Edges, Grid, 👁 hold to peek at the before, zoom 1× / 2× / 3× and pinch, flip, big shutter.
- **Match %** (live, every ~0.5 s): green when the camera sits on the same spot, with a hint (step back / closer, turn left / right, tilt up / down) and a green frame.
- **After photo**: the largest picture the browser gets (asks for 4032 × 3024, then 4K, then 1920 × 1440), JPEG 95 %, no filters.
- **iPhone Camera** button: the phone's own camera app (full quality, Apple's processing) — no ghost.
- **Automatic fine alignment**: the after is shifted / zoomed onto the before (edge-map matching, coarse then fine) for the side-by-side and the deck,
  so both look taken from the same place. The after file itself is saved as taken (full resolution).
- **Result**: drag across the photo to compare; **Save to Photos** shares 2 files (after full resolution + side-by-side) → "Save Image" on iPhone.
- Nothing is sent to the hub; before photos are kept on the device at up to 2400 px for the ghost and the deck.

## Version 3 (26 Oct 2026) — iPhone quality and true colours
- **Best quality** (on by default, Camera tab tick box): line up with the ghost, press the shutter → on iPhone the **iPhone camera app opens at the same spot** (Smart HDR, Deep Fusion, Apple colours, full 12/24/48 MP). Safari's live camera is only a video picture, which is why the old after photos were softer and had different colours. Small movements are fixed by the automatic alignment. On Android the shutter takes a full-resolution still photo (ImageCapture) instead of a video frame.
- **The after photo is saved exactly as the camera took it** — no re-compression, no stamp. The date / time / place stamp now goes on the side-by-side only.
- **Before photos are kept as the original file** (no shrinking / re-compression) so the colours stay exactly as in Photos.
- **Wide colour (Display P3)**: every picture is processed on a P3 canvas, so iPhone colours are not clipped to sRGB.
- **Match the colours to the before** (result screen, on by default): the after's white balance (warmer / bluer light) is matched to the before for the side-by-side and the deck — brightness is kept, so a cleaner result still shows. The saved after photo is never changed.
- Side-by-side up to 2400 px high (about 6000 px wide), JPEG 94 %, P3 colour profile; the deck copy is 3200 px; the PowerPoint uses 2000 px per picture to stay light.
- Everything stays on the phone (Photos + the device's own storage) — nothing is uploaded to the hub. A web page cannot write to Photos by itself: **Save to Photos** opens the share sheet → **Save 2 Images**.

## Zoom with the iPhone camera (26 Oct 2026)
- A web page cannot set the zoom of the iPhone camera app (it always opens at 1×). The zoom used in the ghost camera is remembered when the shutter is pressed and applied afterwards:
  the alignment tries 1×, the ghost zoom and steps between (so it also works when the zoom was set in the iPhone camera itself) and keeps the best match.
- **Save the after photo**: *Framed like the before* (default — cut from the full-resolution photo at the same zoom and angle) or *Full photo as taken*; remembered on the device.
- (26 Oct, later) A zoom other than 1× is used only when it matches clearly better (repeated shapes such as pipes or tiles can fool the edge matching).
  **✥ Adjust the framing by hand** on the result: the after under a see-through before (slider), pinch / drag / ＋ − / Auto → "Use this framing" re-cuts the side-by-side, the deck copy and the framed after file. Highlighted when the match is below 60 %.
  The comparison is sized to the screen so the buttons are never covered.
