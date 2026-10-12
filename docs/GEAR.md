# Gear: what a character wears

Status: 2026-10-12. Eight slots (head, body, back, hands, legs, feet, main hand, off hand), 56 pieces to try on: the first
slice's 15 and a second batch of 41 (hats, armour, clothes and robes, gloves, weapons, shields and things held), the
character drawn in what he wears, weight and armor as game effects, a gear panel on Tab, the wardrobe screen on Shift+Tab
(dev), and the set synced in co-op (the server checks it, everyone sees it). No inventory yet: every piece is there to try
on, as in a wardrobe. The design talk behind it is the "Items and Equipment (WIP)" notes doc.

**Kinds and rarity (provisional, 2026-10-12).** Each piece has a `kind` (clothing, armour, robe, weapon, tool, charm:
`KINDS`) and a `rarity` (common, fine, rare, masterwork, mythic, a colour each: `RARITY`): a first pass to react to, shown
in the panels (names and card frames in the rarity's colour) and read by nothing else yet. The categories and rarities are
to be decided from how the shooting feels (docs/BACKLOG.md: playtest the aim modes first).

**Weapons are carried, not swung.** There are no sword swings, thrusts, blocks or spells yet (that needs animations and the
combat to decide first): swords, axes, the spear and staffs ride on the back, the mace on the left hip, shields on the left
forearm (facing forward and out as the arm hangs), the lantern, torch and spellbook in the left hand. What they do now: a
weapon makes the V blow hit harder (`weapon.melee x`), shields add armour, the lantern, torch and the wizard's staff light
your lantern (the staff's reaches further). Each piece's "soon" says what it will do once the game can.

## Try it

Tab opens the pack (features/pack.js: bag, pouch, skills) and the gear panel beside it; with `?pack=0` Tab opens the gear panel alone. Click a piece to wear it, "own" to take that slot off (the character's own
clothes). Point at a piece to read what it is, what it does now and what it will do later ("not in the game yet": the
systems it needs, like cold or fire, aren't there yet). The bottom line is the set's weight, armor and speed.
The set is remembered on this machine. `?gear=wool_cap,mail_shirt` wears a set from the URL (tests); `?gear=none` none.
In the menu's Sandbox tab, "Gear: ..." opens the panel too.

The look changes on the live gunslinger (the default loadout drawn as a 3D model). A sprite loadout (the Ranger) looks the
same whatever he wears; the effects still apply.

## How it works

```
 content/gear.js        the pieces, slots, materials, zones and rules (pure data: the browser and the server read it)
 features/gear.js       the set: chosen (want) and in effect (worn); its modifier notes; asks the server in co-op
 ui/gearpanel.js        the panel (DOM, Tab)
 view/dress.js          a model + the pieces worn -> the model to draw (paint, hide, add shapes, the cloth panel's colour)
 view/livehero.js       body.wear(pieces, key): the dressed corners into the rig (render/rigmesh.js restyle)
 features/coop/look.js  the other players dressed in the sets the server says they wear
 server/room.mjs        checks a set (content/gear.js cleanSet) and tells everyone
```

- **A piece.** `{id, name, slot, weight (kg), armor (share of damage taken off), desc, look, mods?, soon?}`. `mods` are more
  modifier notes (the miner's lamp cap: `light.lantern + 1`, his lantern always lit; birch-bark shoes: `player.speed x 1.04`).
  `soon` is what it will do once the game has the system (cold, fire, lightning, thorns, bogs): shown in the panel, does nothing.
- **Effects are modifiers** (`host.mods`, source `'gear'`): the set's weight past `RULES.FREE_KG` (4 kg) slows you by
  `SLOW_PER_KG` (1.2 %) a kg, never below `SLOW_MIN` (70 %): `player.speed x`; its armor (capped at `ARMOR_MAX`, 50 %) is
  `game.hurt x (1 - armor)`; plus each piece's own `mods`. Nothing writes another system's number.
- **The look.** A live model (tools/blender/ragdoll_export.py's json + bin) is rigid per-bone segments of triangles, each
  corner with a part and a colour family. `view/dress.js` makes a copy in which:
  - `paint {zone: material}`: the zone's parts take the material's family (4 tones made into the pixelizer's 6 by
    `view/rigkit.js ramp6`, so a piece is shaded, lined and outlined like the body);
  - `hide [zone]`: the zone's triangles collapse to a point (not drawn, no shadow);
  - `add [shape]`: boxes, balls, tubes, discs and cones built in body space at rest (metres: x his left, y his back, z up,
    feet at the origin) and moved into a bone's frame, appended to that bone's segment with a part of their own (so the
    pixelizer draws lines between them and the body). A shape on `HatHold0` tips with the hat and falls off with it.
  - `cloth material | 'off'`: the duster's runtime cloth panel recoloured or not drawn.
  Zones (`ZONES` in content/gear.js) name a model's parts by what they are (hat, coat, collar, sleeves, vest, shirt, neck,
  trousers, legs, boots, spurs), per model (`gunslinger.py`, `outlaw.py`), so one piece fits every model that names them.
  `render/rigmesh.js restyle(model, json, bin)` swaps the model's triangles; its bodies, poses and slots stay. A dress costs
  2 to 25 ms (headless, software GL) and happens on a change of set only, never per frame. Nothing changes per frame: the
  dressed model is drawn exactly as the plain one (a few hundred more triangles at most).
- **Multiplayer.** The set is the server's to say. Offline the panel's choice is worn at the next sim step. In co-op the
  feature asks the server (`gear {g}`); the room keeps only known pieces, one a slot (`cleanSet`), stores it as the player's,
  and sends `gear {id, g}` to everyone, the wearer too; the wearer's set changes when that answer comes (the same moment the
  others see it), and a late joiner gets everyone's in its welcome. Every ask gets an answer (a flood, faster than one ask a
  100 ms, is answered with the set as it was). The server checks pieces exist; it does not own an inventory yet.
  The others are drawn dressed: `coop/look.js` keeps a model per look (rig + set), shared by players who look alike; a look
  nobody wears any more is restyled into the next one needed.
- **Sim vs view.** The set and its notes change in `update` (the event `gear.wear`); the look follows in `view`.

## The wardrobe screen (Shift+Tab, dev)

A screen of its own for trying combinations and testing clothes (`dev/wardrobe.js`, dev mode only): Shift+Tab, or the
menu's Game tab: Wardrobe. The game HOLDS (`core/loop.js hold(screen)`: not stepped, not drawn; the screen takes the frame
and the keys) and the STUDIO takes the screen (`dev/studio.js`): a renderer of its own (`render/gfx.js createGfx` on a
canvas of its own: an empty scene, no world), a fixed camera looking north, studio light (the ruins' day / dusk / night
moods with the sun as a key light from the front left, a lamp in front when it's dark), the SET (`dev/stage.js`: a stage
under him: stone plinth, wooden drum, rug, meadow tuft, none; a backdrop behind: velvet curtain, paper sweep, stone wall,
night sky, open sky, plain dark / grey; built in code with view/rigkit.js, drawn as pixel-art 3D like the characters), and
a COPY of the character: his live model (the export the live hero draws) on a body and rig of its own (view/livebody.js,
render/rigmesh.js), dressed as the wardrobe shows him (view/dress.js), his idle or one of his clips playing, the
gunslinger's duster tail run as the live hero runs it (a ClothRig on the sprite path's cloth, fed from the drawn pose).
HE turns on the stage; the camera and the set never move. Drag him to turn him, right-drag to move the view, the wheel
zooms (whole display scales), R frames him again, Space spins him, arrows / A / D turn him a step, H hides the UI, Tab the
next tab, P saves a PNG of the scene, Esc (or Shift+Tab) back to the game, which goes on from the frame it held.

The UI is pixel art like the game: its own pixel font (`dev/pixelfont.js`: 5 x 7 glyphs built into a TrueType font in code,
'RiftPixel'), 9-slice pixel frames painted in code (wood and brass), pixel slot icons, every edge a whole UI pixel (U css
px: 2 at 1080, 3 at 1440, 4 at 2160). It stands round the scene: the TOP bar (the title, the loadout, the tabs, the keys, back to the game), EQUIPMENT on the
left (a card a slot with what he wears there, its colours as a swatch, x takes it off; Random, Undress; the set's weight,
armor and speed as bars), the tab on the right, and the SCENE bar at the bottom (backdrop and stage swatches, the light:
now, dawn, day, dusk, night as the clock's preview; his pose: the live hero's emotes; turn 45 degrees, spin, frame, photo).
The camera frames him in the middle of what the panes leave, at the zoom where he is about half its height. The tabs:

- **Outfit.** The chosen slot's pieces as cards (their colours, weight, armor; a click wears it: through
  `features/gear.js choose`, shown at once, worn when you go back to the game; in co-op the server is asked then), the piece
  under the pointer in detail (what it does now, what it will do later).
- **Paint.** The model's zones and the duster tail; a palette (every material, a picked colour, off) painted on the chosen one.
- **Tuner.** Pick a piece with shapes, pick a shape, and move, turn and size it on sliders (drawn as you drag, a dress at
  most every 50 ms). "Copy code" puts the piece's `add` list on the clipboard as content/gear.js lines (and in the console):
  paste it over the piece's own to keep it. Double-click a slider: back as authored.
- **Stats.** Sliders as modifier notes under the source `'wardrobe'`: move speed, damage taken, gun damage, reload, shot gap,
  melee, crit chance / damage, the brutes' damage, the lantern.
- **Items.** The run's items (a copy more or less) and augments (on / off), through game/stats.js. A run starts empty.
- **Saved.** All of it (loadout, gear, paint, tuned pieces, stats, items, augments) saved under a name and worn again in
  one click; "Copy link" gives the gear as `?gear=` and `?set=`.

The clothes chosen show on the studio's copy at once and are worn in the game from the step after you go back (the
game holds meanwhile). The paint and tuned pieces are the look only: on the studio's copy, and on him in the game through
`features/gear.js preview({swap, extra, key})` (the set worn with pieces swapped for edited copies and a look-only piece
after them); no weight, no armor, nothing sent in co-op (the others see what the server says you wear). A material can be 4 tones of its own (`view/dress.js`), which is how a picked
colour paints. Everything holds in dev mode only and is remembered on this machine (`rb.wardrobe`).

## Adding a piece

Add an entry to `GEAR` in content/gear.js: an id, a slot, weight, armor, a line of description, and its look. For a new
colour add a material (4 hex tones, light to dark). Shapes are placed in body space at rest; the gunslinger's measurements
are in the comment at the top of content/gear.js (head z 1.28 to 1.8, hair out to .2 m from the centre, hat band at 1.65).
Check it with `?gear=<id>` and the panel, and place its shapes with the wardrobe's piece tuner (Shift+Tab, "Copy code").
A piece that needs a zone the model doesn't name yet: add the zone to `ZONES`.

## Not yet

- An inventory: where pieces come from (crafting, finds, chests), owning them, dropping them. Today every piece is free.
- The effects in "soon" (warmth, fire, lightning, water, thorns, bogs): they need weather, temperature and fire systems.
- Durability, wear, repairs, growth (the notes doc's "Wear, loss and growth").
- Weapons as gear (the gun and bow are the loadouts' own), trinkets and charms, a hands slot.
- Sprite loadouts don't change look (only live models can be dressed).
- Pieces shaped in Blender (today they are simple shapes built in code; a piece could also come from a model file).
