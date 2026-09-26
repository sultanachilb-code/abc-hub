# Feature record — Mall Layouts (Find a brand · plans linked to the GLA)

Added: September 2026 · Status: live · Owner: Sultan Al Achi

## What it does
- **Mall Layouts** tile under *Property Overview & Info*.
- One plan per level per flagship, uploaded from the layout PDF (each flagship has its own).
- Unit positions are read automatically from the PDF (the "VM L4-005" codes) and shown as pins
  coloured by the **live GLA** status: Open · Fit-out · Vacant/Terminated · Closed.
- **Find a brand / unit / place**: jumps to the level, zooms in and pulses the pin.
- **Adjust pins** (Manager, Senior Mall Supervisor, Admin): move pins, add places (ATMs, offices,
  rooms…), link a pin to a GLA unit when the plan's code differs, place GLA units missing from the plan.
- Tapping a unit → **Update in GLA** opens that unit's GLA editor and comes back to the plan.

## Everything it adds (to remove the feature, undo exactly these)

| Where | What |
|---|---|
| `modules/layouts.js` | **New file.** All server logic (tables, routes, image serving). |
| `tools/layouts.html` | **New file.** The Mall Layouts page. |
| `tools/pdfjs/pdf.min.js`, `tools/pdfjs/pdf.worker.min.js` | **New files.** PDF reader used only by the upload (Mozilla pdf.js 3.11). |
| `docs/FEATURE-layouts.md` | **New file.** This record. |
| `worker.js` | 5 lines, each marked `Mall Layouts feature`: the `import` at the top, `await layoutsSchema(env)`, the `ops/layouts/image` route, the `layouts:` permission in `rights()`, and the `layouts/` route in `opsRoute`. |
| `apps.js` | The `layouts` tile (marked with a comment). |
| `tools/gla.html` | The `?unit=…&back=…` hook that opens a unit's editor from a plan pin (marked `Mall Layouts feature`). Harmless if left. |
| `.assetsignore` | `modules` and `docs` lines (keep `modules` hidden if any module remains). |

### Database tables (D1 `hub-db`)
- `layout_levels` — one row per flagship + level: name, size, figures read from the plan, who uploaded.
- `layout_images` — the plan image for each level, stored in 700 KB parts.
- `layout_pins` — pin positions (0–1 of the image), unit code or place name, `auto` (from PDF) or `manual`.

To drop the data as well:
```sql
DROP TABLE layout_pins; DROP TABLE layout_images; DROP TABLE layout_levels;
```
The GLA tables (`gla_units`, `gla_events`) are **not** touched by this feature.

## Behaviour notes
- Re-uploading a level replaces its image and its automatic pins; pins placed or moved by hand are kept.
- The GLA remains the single source of truth: the plan only reads it (status colours, brand search).
- Plan images and pins are only served to signed-in hub users (`/api/ops/layouts/*`).
