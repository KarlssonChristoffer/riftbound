# Trolls

Status: first build, 2026-10-17 (night shift). Christoffer's ask: "add some enemies to the world, melee trolls, some small and
big trolls, more life to the world". The defaults below are the builder's; everything is a number in `src/content/trolls.js`.

## What's in the forest

**Bergtroll (big).** A 2.6 m mossy troll with a long nose and a pine club. By day it is a **stone** standing in the woods where
the sun caught it, one arm over its eyes. At dusk (or under a thick fog or a storm) the stone cracks and it **wakes**, then walks
the woods round its stone until dawn. When it sees you (a cone ahead of it) or hears you (closer when you creep, further when
you run) it **roars** and fights:

| blow | when | tell | what happens |
|---|---|---|---|
| slam | you're in front, within reach | club over its head; a ring on the ground ahead | 20 dmg in the ring, big knock; the club sticks in the dirt (1.35 s to punish) |
| sweep | you're to its side | club drawn back; an arc ring | 13 dmg in a 160 deg arc, knocks you sideways |
| stomp | you're under its feet | a foot raised; a ring round it | 9 dmg, shoves you out |
| boulder | 6.5-15 m off | rips up a rock; a ring where you stand | 16 dmg where it lands; you have the flight to step out |

The wind-up follows you for its first 60 %, then the blow is **locked**: step out of the ring or roll. Damage wears its
**poise** down; past it (kicks and fists count more, crits too) it reels for 1.5 s. A parry (when the melee feature has one)
staggers it longer. **At dawn** it heads home; caught in daylight anywhere it **freezes to stone right there**, mid-fight too.

**Pysslingar (small).** Knee-high trolls in packs of 3-5 round a burrow under thick trees. By day they're shy: they peek at
you from a few trunks off and bolt home when you come near (hit one and it fights back for a while). At night they're bold:
they circle you a few metres off and take turns darting in to **bite** (a crouch, a dash, a nip, then they run off giggling),
or throw **pinecones**. When you get hurt they stop and **laugh**. A lit campfire near you or your lantern (L) at night keeps
them off. When a big troll walks past their burrow, one may climb onto its **shoulder** and throw cones from up there; a hit
(or the big one reeling) knocks it off.

**Knocking.** E on a troll stone by day knocks on it. It grumbles. The third knock wakes it, grumpy, for 30 s whatever the
sun; then the sun takes it again.

## Where (seed 1337)

`world/trolls.js` places 3-4 stones in the home woods (by an outcrop or the boulders, else a glade) and one in the high
country, and 3 burrows in thick wood, away from the settlement's clearing, water, cliffs and the cave mouth. For seed 1337:
stones at (7, -21), (-29, -23), (48, -44) and (35, -125); burrows at (-13, -15), (54, -30), (-39, -14).

## Dev

- `?trolls=0` off; `?trolls=near` a big one and a pack near you 3 s in, awake whatever the hour. `&hour=21` for night.
- Dev menu (F10 > Combat > Trolls): spawn trolls near you, go to the nearest stone or burrow.
- `window.__r3d` / the feature: `host.feature('trolls').dbg()` lists every troll and its state.

## How it's built

- `world/trolls.js` the plan (pure, from the forest seed). `features/trolls/sim.js` the truth: records, AI, the sun, blows,
  thrown things; fixed steps, its own seeded generator. `features/trolls/look.js` + `view/troll3d.js` the view: 3D bodies in
  code through `render/rigmesh.js`, the stone look, telegraph rings, ragdolls. `features/trolls.js` the feature.
- A troll near you is an **entity** (`kind: 'troll'`, target + hunter + hp + coins): arrows, bullets, fists, the boot and any
  melee weapon that goes through combat's `damage()` hurt it; combat breaks it (coins, enemy.kill). The sim reads
  `combat.hit` for stagger and knockback (`dtype`/`dmgType`: `fire` makes the small ones run, `blunt` breaks poise faster).
- Other systems: `host.feature('trolls').shove(p, vx, vy, stun)`, `.stagger(p, s)`, `.isTroll(p)`. A guard: the sim asks
  `host.feature('melee').guard(x, y, heavy, who)` -> `'parry' | 'block' | 'dodge' | null` if it exists, else the fists' guard.
- Your hurts count while a troll is fighting you (`game/game.js` fightOn, one line). You fall: you wake at spawn, they go home.
- **Multiplayer:** local to each client (co-op for enemies was declined). A server would own exactly the sim's state; the plan
  is already a pure function of the seed.
