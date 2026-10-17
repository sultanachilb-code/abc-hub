# Home layouts — Smart cards · Orbit · Glass dock · Honeycomb · Bookshelf · Shutters · 3D Carousel

Each person chooses how the tools are laid out on the home page. The choice is stored on the device (`hub.layout`). Since Oct 2026 it is chosen **only in Profile settings → Home layout** (the account menu's *Home layout* opens that section); there is no switch on the home page any more.

| Layout | What it does |
|---|---|
| **Smart cards** (default) | One card per category with its first 4 tools and the category's red count. Tap a tool to open it, or tap the card and it opens as a folder with every tool. |
| **Orbit** | The ABC hub in the middle with the categories on a gold ring. Tap a category: the ring turns it to the top and its tools fly out in a circle. Tap the centre (or Esc) to go back. On phones the tools slide up in a panel. |
| **Glass dock** | A frosted dock fixed at the bottom of the screen, one folder per category with its count. Icons magnify under the mouse, and tapping a folder pops its tools up above the dock. |
| **Honeycomb** | One hive per category: the category in the glowing centre cell, its tools in the cells around it (they bloom in and grow on hover). More than 6 tools → a "+N more" cell; the centre or "+N" opens the folder. |
| **Bookshelf** | Categories are books on wooden shelves (spine colour = first tool's colour, gold count). Tap a book: it slides out and opens under its shelf, the right page flipping over with the tools. "Put the book back" closes it. |
| **Shutters** | A street of mall shops, one per category, with a lit sign. Tap the shutter and it rolls up to show the tools; tap the sign to close it. "Open all shutters" / "Close all". Which shops are open is remembered on the device (`hub.shutOpen`). |
| **3D Carousel** | Categories stand in a 3D ring. Turn it with the arrows, a swipe/drag, the keyboard arrows or by tapping a panel; the tools of the front category pop into the tray below. |

- The Day to Day timeline (operations team) or brief (management), the Recent rail and search work the same in all layouts. Searching shows the plain list of matching tools.
- Live counts, health dots, the flagship picker and locked (not set up) tools behave as before.
- Animations are short. They switch off when the device asks for reduced motion.

## iPhone: home page locked (Oct 2026)
The home page scrolls up and down only: it never slides sideways and cannot be pinch-zoomed (`#home` overflow-x hidden, touch-action pan-x pan-y, Safari gesture events).
The Day to Day timeline keeps its sideways scroll but stops at its ends without dragging the page, and a mostly-downward swipe that starts on it scrolls the page.
Tools, forms and dashboards (opened inside the hub) keep zoom and free movement.

## Upcoming - Testing folder (Oct 2026)
New tools are placed in the **Upcoming - Testing** folder while they are tested, then moved to their real folder.
Now there: Quick Access Pass, Message of the Moment, Seasonal Decorations.


## 3D Carousel on phones (Oct 2026)
Under 760 px wide the 3D ring becomes a strip of folder cards scrolled with the finger (native scrolling with snap); the card in the middle is the open folder and its tools show in the tray below (4 per row), with dots under the strip. Laptops keep the 3D ring. The tray is soft purple in the light theme. The home page is no longer redrawn when a phone's address bar hides or shows while scrolling.
