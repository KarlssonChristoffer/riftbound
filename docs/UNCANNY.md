# The uncanny forest

Status: 2026-10-12, first slice, built from the feature brief `/mnt/project-files/briefs/uncanny-forest.md` ("Feature briefs for
big features" thread). The forest has a second life: by day a few things are slightly off, at night the forest changes, the
creatures get stranger and the secrets wake up. Unease and wonder; no jump scares, no markers, no popup text.

Code: `src/world/uncanny.js` (the plan: where everything is, which trees walk on which night, the elk's day walk; pure, the
server runs it too), `src/sim/uncanny.js` (the rules: the secrets' states and the night elk's brain; pure, both sides run it),
`src/features/uncanny.js` (the game: the night shift, the secrets and the elk offline or from the server, knocks, drops),
`src/features/uncanny/look.js` (the view). Assets: recipes `heron`, `heron_head`, `elk_body`, `elk_leg`, `elk_neck`,
`glowring`, `ringstones` (content/recipes.js) with their paints (content/paints.js); keepsakes in content/items.js.

## What is in it

**The night shift.** At dusk a handful of trees and boulders walk 1.6 to 3.4 m (about 25 trees and boulders over the whole
forest, so a few near you), each starting at an hour of its own between 18:12 and 19:48 and taking half an in-game hour (about
25 s at 20 minutes a day), so you can catch one sliding. They go toward the most open way they have and never into water, up a
bank, onto the secrets' places or the settlement. Each night picks a different handful from the seed and the night's number,
so every player (and the server) has the same ones without anything being sent. At dawn (05:30 to 07:06) they slide home. A
slow drag sounds when one starts near you. Their colliders move with them (the registry), so the way home really changes.

**The heron.** By day a grey heron stands perfectly still on the lake shore, facing the water. Its head follows you, the
short way each time, so if you walk round it the head turns all the way round, again and again. At dusk it sinks into the
shore and a ring of pale mushrooms rises where it stood, their caps glowing softly, with a faint pale light. At night whoever
stands in the ring has a heron's shadow lying beside them.

**The elk.** By day it walks its own way through its patch of the woods, grazing at stops, and on every third leg it walks
backwards with its legs still swinging as if it walked forwards. As dusk comes it grows wrong: its legs and neck stretch, its
body thins. At night it stalks whoever is in its patch: it keeps behind them, slipping from trunk to trunk, and each time they
stop it comes closer. Close enough while they stand still, it lunges and knocks them down (thrown, the live body falls), and
they drop something (a keepsake first, else something from the pouch). It lies where they fell; walk over it to pick it up.
Then the elk backs off and leaves them alone for a while. Leaving its patch (6 m past its edge) or reaching the settlement's
light lets you go: it stands at its edge and stares after you. At dawn it walks back to its way. It never kills.

**The secrets.** Each is *sleeping* by day, *awake* at night, *triggered* the moment it opens (a low hum, a flash of glow, a
keepsake in the pouch of whoever opened it), then *spent* for 3 nights before it sleeps again.

| secret | where | how it opens | keepsake |
|---|---|---|---|
| the heron's ring | where the heron stands by day | **two players** standing in the ring together at night for 2.5 s | Heron Feather |
| the quiet stones | a ring of low lichen stones in a glade (inside it your steps make no sound, day or night) | at night, one player in the middle, lantern out, standing still for 5 s | Warm Stone |
| the pale marks | 4 to 6 pale marks (a hand, a spiral, an eye) on trunks, seen only by lantern light at night, each in sight of the next | follow them by lantern light to the hollow under an old windthrow's roots (or by a boulder); a bark doll lies there | Bark Doll |

Keepsakes do nothing yet; they sit in the pouch (Tab).

## With friends (docs/MULTIPLAYER.md)

The server owns the world's clock (`--hour`, `--daymin`; clients follow it and don't save it as their own), the secrets'
states, who opened each and on which night, and the elk (it runs `sim/uncanny.js` at 20 Hz; the elk is in every snapshot, its
knocks go to everyone as `ev`). The walkers come from the clock and the seed, so everyone sees the same trees moved. Late
joiners get the clock and every secret's state in their welcome. The two-player ring is checked on the server from the
players' places. The stones and the marks are asked for by the client whose condition holds (`act secret`); the server checks
the secret is awake and the player is there.

Private to each player: the heron's gaze (it watches you, like the Watcher), the marks' glow, and what the elk made you drop
(only you see it and only you can pick it up).

## Switches and knobs

| what | URL | in the game |
|---|---|---|
| off / dev markers (a line from you to each place and creature, the walkers' paths, the HUD) | `?uncanny=0` / `?uncanny=dev` | Dev > World > Uncanny forest (on / off) |
| night shift strength (how many walk, how far) | `?nshift=1` (0 none, 2 twice as many, a little further; co-op: the server's `--nshift`) | Dev > World > Night shift strength |
| how often the elk hunts | `?nelk=1` (0 never, 2 twice as often) | Dev > World > Night elk hunts |
| how far odd things show (the ring's light, the marks by lantern) | `?nnotice=1` | Dev > World > Odd things notice distance |
| night length (all of the day, really) | `?daymin=20` (real minutes a day; co-op: the server's `--daymin`) | |
| jump to night | `?time=night` (co-op: asks the server) | Sandbox > Places: Uncanny: dusk / night / dawn |

Sandbox > Places also has: go to the heron, the stones, the first mark, the elk's patch; a pretend friend in the heron's ring
(to open it alone); wake every secret (offline).

## Defaults I picked (the brief left these open or empty)

- No bogs or stone circle exist on main yet, so the heron stands on the lake shore and the quiet stones are a new ring of
  stones placed in an open glade.
- The night shift moves about 4.5% of trees and 7% of boulders each night (the "handful" is per area you can see), 1.6 to
  3.4 m. Trees with marks never walk.
- "Your lantern light turns your friend's shadow into the heron's shape": each player in the ring at night gets a flat heron
  shadow beside them, lantern or not (no real shadow re-shaping).
- The threat (the elk): knocks you down and makes you drop one thing; gets you only after you stop near it several times;
  40 s rest after a knock. The lantern does not scare it; the settlement's light and leaving its patch do.
- Secrets recharge after 3 nights. Keepsakes do nothing yet.
- Day length: the clock's 20 real minutes a day; the server starts at 09:00 on day one (`--hour`).
- The "hum" when a secret opens is two low bell tolls (the bells' sounds, softened); the walkers' drag is the crate scrape.
- Built as its own feature rather than on the wildlife feature: wildlife is per-client view, and the elk has to be the
  server's in co-op.

## Left out of this slice

- A darkness knob (how dark the night gets is the clock's mood keyframes; not touched).
- Birds going quiet at dusk (the brief's step 2); the Watcher already comes more often at dusk and night.
- A third creature; the elk's own sounds (it is silent); a journal; keepsakes that do something.
- Felled trees in co-op are still in the plan the elk hides behind (it may stand behind a stump).

## Checks

Headless (node): the plan places all four things on seeds 1 to 60 (`tmp/unc_test.mjs` style scripts); the room test (two
fake clients: the ring opens for both, a late joiner sees it, `act time`, the elk stalks and knocks); the feature with a fake
host (walkers out at dusk and home at dawn, each secret opens, the knock drops a keepsake and walking over it picks it up;
update ~.004 ms, view + frame ~.008 ms on this machine).
