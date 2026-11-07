# The dev console

**F10** in dev mode (also Esc > Game > Dev console). One window at the right edge, full height, with a tab row across
the top (like Rust's admin menu), so the dev panels never pile up on each other:

| tab | what | its own key |
|---|---|---|
| Menu | every test action, feature toggle, setting and renderer A/B: a page per feature (below) | F10 |
| Cheats | the cheat panel (`dev/cheats.js`) | F2 |
| Move | the move feel panel (`dev/movefeel.js`) | F7 |
| Gun | the gun feel panel (`dev/gunfeel.js`) | F8 |
| Weather | the weather panel (`dev/wxpanel.js`) | F9 |
| Keys | the key help (`dev/keyhelp.js`) | |
| Wardrobe | opens the wardrobe screen (`dev/wardrobe.js`) | Shift+Tab |

A panel's own key opens the console on its tab, the same key closes it. F10 reopens the tab you had. F1 is the debug
HUD alone (top left); the key help is the Keys tab. The player's Esc menu keeps only what a player sets: Game, Graphics,
Audio, Controls. The player's window (`ui/book.js`, Tab) hides the console while it is open.

Code: `src/dev/devmenu.js` (a dev feature the boot adds last). The panels are DOCKED: their elements move into the
console once and their position and font are overridden there; each panel's feature stays the truth (its F.on = its tab
shows), so a panel needs no change to live in the console. A new dev panel gets a tab by adding a line to `TABS`.

## The Menu tab

- **Search** has the keys as it opens: type a few letters (`fog`, `spawn`, `time`), Enter runs the highlighted row,
  arrows move, Left / Right change a value. Esc clears the search, a second Esc closes the menu.
- **Sections** along the top (Tab / Shift+Tab while searching): Panels, Character, World, Nature, Animals, Gathering,
  Combat, Effects, Renderer, Sound, Co-op, Other. A section only shows when something is in it.
- **Pages**: a feature with only an on / off is one line. A feature with more folds: click its name; its On / Off sits on
  the right of the name.
- **Pins**: the `*` at a row's left (shows on hover) pins it to the top of the menu, whatever section is open.
  Remembered on this machine (`localStorage 'rb.devmenu'`, with the open section and the folds).
- Actions run at once and the menu stays open. Click the world to play with it open; F10 closes it.

## Adding rows to your feature

Nothing to register: the feature list is the registry. A feature's page is built from what it already has:

| on the feature | shows as |
|---|---|
| `F.toggle()` + `F.key` | its On / Off (with the keycap) |
| `F.settings()` | its settings (choices, levels) |
| `F.menu()` | its test actions; a label's `Foraging: ` prefix is dropped when it names the feature |
| `F.dev = {group, rows}` | the section, and its own dev rows (below) |

```js
const F = {
  name: 'forage', label: 'Foraging', on: ON,
  dev: {
    group: 'Gathering',   // a section from SECTIONS in dev/devmenu.js
    rows: () => [         // read fresh 4 times a second while the menu shows
      {label: 'Marks on the patches', get: () => marks, set: v => { marks = v; }},              // a switch
      {label: 'Everything grows back (offline)', run: () => regrowAll()},                      // an action
      {label: 'Plant', options: Object.keys(PLANTS), get: () => cur, set: v => { cur = v; }},   // a choice
      {label: 'Grow-back time', min: 0, max: 600, step: 30, get: () => T.regrow, set: v => { T.regrow = v; }},   // a number
      {label: 'Patches picked', text: () => `${picked.size}`},                                  // a read-out
    ],
  },
};
```

Any row can carry `key: 'Shift+K'` for a keycap hint. `{label, value() -> text, run(d)}` (a value that cycles itself,
d = +1 / -1) works too.

**Player-facing rows don't go here.** A setting a player should see goes in `CLAIM` in `src/ui/pause.js` (it then shows
in Graphics / Audio / Controls as well as on the feature's page). A feature whose `F.menu()` rows are for the player
(the run's Start / Abandon, the camera) is listed in `GAME_ROWS` there.

**Multiplayer:** a row that changes the world does it the way the feature always does; in co-op that means through the
feature's own messages to the server, never by writing the world directly from the menu.

## Moving your rows (open PRs)

Before this, each PR added its feature to `SANDBOX_GROUP` in `src/ui/pause.js`, and its rows landed on the Sandbox tab.
That table is gone. When you merge main:

1. **The conflict in `src/ui/pause.js`**: take main's side (drop your `SANDBOX_GROUP` line). Nothing else is needed for
   your rows to show: `F.menu()`, `F.toggle()` and `F.settings()` all land on your feature's page.
2. **Your section**: the features of the open PRs are already in `SECTION_OF` in `dev/devmenu.js` (forage, mining, builds,
   cooking, meals, workshop, keepsakes, skills, cavelife, foxden, animalfinds, prints, mud, mire, ice, winter, thunder,
   trip, body, rope ...). A feature not there lands in Other; add `dev: {group: 'Gathering'}` to its F.
3. **Optional, nicer**: move your `F.menu()` rows to `F.dev.rows`. A toggle in a label (`marks (on)`) becomes a real
   switch (`get` / `set`), counts become read-outs, and the label no longer needs the `Feature: ` prefix.
