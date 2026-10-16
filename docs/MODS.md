# Weapon mods: attachments and runes

Status: 2026-10-17, first build (Christoffer's bedtime list: "weapon attachments... on a gun, on a staff... control what type of
damage... runes or fire bullets"). Code: `src/features/mods.js` (the feature), `src/features/mods/sim.js` (the truth),
`src/features/mods/look.js` (the view), `src/content/mods.js` (every number), `src/ui/modpanel.js` (the bench).

## Try it

`?mode=sandbox&forest=1&seed=1337`. Play the Gunslinger or the Outlaw (Esc > Character) for the revolvers, the Ranger for the bow.
F10 (the dev menu) > Combat: **Weapon mods: every part in the kit**, then **a pack of brutes to try them on**. **N** opens the
weapon bench (a tab of the game's window when that's in the game, else its own box). `?mods=all` starts with every part; `?mods=0` turns it all off.

## Slots

Every weapon has three slots. Their names follow the weapon: a gun's Chamber / Barrel / Grip, a bow's Arrowhead / Fletching /
Grip, a staff's Crystal / Head / Wrap, a blade's Rune / Edge / Pommel.

- **Rune**: what kind of damage it deals.
- **Tip**: how the shot flies.
- **Grip**: a trigger that bends a rule each time you shoot.

A part fitted on one weapon is out of the kit; find a second to fit it on another weapon too.

## Damage types (runes)

| Rune | Type | What a hit does | The world |
|---|---|---|---|
| Ember Rune | Ember | burns: 6 dps for 3 s; a burning thing that falls sets those near it alight; wood it hits catches | rain: x.4 and it burns out twice as fast |
| Rime Rune | Rime | a chill per hit; 3 chills FREEZE it (held 2.2 s); the next hit SHATTERS it (x2.2, shards hurt those near) | snow or winter: 2 chills freeze |
| Storm Rune | Storm | jumps to the 2 nearest others within 3.5 m for 60% | wet (rain, the stream, the bog): 3 others within 5.5 m, x1.4; a thunderstorm calls a bolt down every 5th hit |
| Rot Rune | Rot | 3 dps per stack (up to 3) for 5 s; a rotting thing that falls bursts in spores: rot on all within 2.6 m | in the bog: x2 and lasts twice as long |
| Hollow Rune | Hollow | it falls upward (thrown up, stunned); a kill pulls those near it in; a kill farther than 3 m swaps you into its place | night: thrown higher; fog: x1.3 damage |

## When types meet (reactions)

| Name | How | What |
|---|---|---|
| Steam burst | Ember on a frozen thing | x2.5, it thaws in a cloud |
| Flashover | Storm on a burning thing (an arc counts) | it explodes (1.6 m) |
| Swamp gas | Ember on a rotting thing | it explodes (2.4 m) |
| Blight frost | Rime on a rotting thing | it freezes at once |
| Shatterbolt | Storm on a frozen thing | every frozen thing within 6 m shatters |
| Unravel | Hollow on anything with a status | its statuses jump to all within 3 m |

To mix types: a Prism (every shot the next rune you own), a Weather Vane (the sky picks), the pistol whip or a melee weapon with
another rune, or a friend later.

## Tips and grips

| Part | Slot | Fits | What it does |
|---|---|---|---|
| Fork Choke | tip | bow, gun, staff | every shot splits in three, each 55% |
| Sighted Barrel | tip | bow, gun, staff | gun: spread x.45, damage x1.2, x1.25 between shots; bow: arrows x1.35 speed, x1.2 damage |
| Moth Lens | tip | bow, gun, staff | shots flutter and turn toward the nearest thing alive within 7 m |
| Bent Bough | tip | bow, gun, staff | shots turn round halfway and come back past you |
| Heavy Slug | tip | gun | through 2 more bodies, shoves twice as hard |
| Glancing Lip | tip | gun | bullets glance off stone and iron (the ricochet rule, `proj.ricochet`) |
| Prism | tip | all | each shot or blow takes the next rune you own |
| Caster Crystal | tip | staff | each swing looses a bolt of the staff's rune |
| Hair Trigger | grip | bow, gun, staff | gun: x.6 between shots, x.75 reload, x1.5 spread; bow: arrows x1.25 speed, x.85 damage |
| Kick Grip | grip | bow, gun, staff | every shot throws you back 7 m/s: shoot behind you to dash, shoot the ground in a leap |
| Echo Charm | grip | all | every shot is fired again .45 s later from where you fired it |
| Weather Vane | grip | all | the rune follows the sky: in the bog Rot, rain Storm, snow or winter Rime, night Hollow, a clear day Ember |
| Last Word | grip | gun | the cylinder's last round hits x3 and bursts its rune on all within 2.2 m |

## Where parts turn up

You set out with four Ember Runes (fitted on the revolvers and the bow, one spare for a blade or a staff), the Fork Choke, the Sighted Barrel and the Hair Trigger. The rest are
found, and the bench shows each one you haven't found as a riddle:

| Part | Where |
|---|---|
| Storm Rune | the first lightning strike within 18 m of you leaves it in the ground (then 35%) |
| Weather Vane | lightning hits you: it's in your hand |
| Rime Rune | cut a hole in lake ice (the first always, then 50%); deep in a broken vein (5%) |
| Rot Rune | dig the mire's night find; sink into the bog (the first time 100%, then 15%) |
| Hollow Rune | the night elk knocks you down: it drops it into your hand |
| Moth Lens | in a caught fish's belly (8%) |
| Bent Bough | off a felled tree (8%) |
| Heavy Slug, Glancing Lip | in a broken vein (10% each) |
| Kick Grip | get thrown into a wall |
| Echo Charm | three kills within 1.2 s: it falls from the last |
| Last Word | a kill with the cylinder's last round |
| Prism | own all five runes |
| Caster Crystal | carry a rune in the cave for 90 s |
| any tip or grip you lack | a kill (12%), an opened chest (50%) |

A dropped part stands glowing over the ground where it turned up: walk over it. It sinks away after 4 minutes.

## How it works

- A shot (`F.arrow`, every shot as it spawns) gets its type from the weapon's slots (`sim.shot`). The type is kept in the sim
  (`TAGS`), not on the shot; the only things written on a shot are what the hook contract allows: its damage, speed, `fire`
  (lights.js lights wood), `pen`, `push`, extra shots (`a.extra`), and `a.steer`, a function `sim/projectiles.js` calls each step
  before the shot moves (the moth's flutter, the bough's return).
- A hit (`F.onArrowHit`, ahead of combat; it returns nothing) runs the reaction and the status, and leaves the damage's factor for
  combat's own damage through its hit mod (`core.hitMod`). A melee blow (`by: 'melee'`, the pistol whip now; the melee weapons
  later) gets the weapon in hand's type in the same hit mod.
- With the melee weapons' shared hit model in the game (`host.feature('hits')`, briefs/combat-shared.md) a blow goes through
  its rider instead (`H.rider('mods', ...)`): the reaction and the status run here, 30% of the blow becomes the rune's type
  (`hit.extra`: fire, frost, shock for Storm, venom for Rot, void), hits ticks the burns and the rot, and ours stop. The weapon in
  hand is the melee feature's (`weapon()`); a `staff` class is a staff, the rest are blades. A Caster Crystal staff looses its
  bolt on `melee.swing`, toward the aim.
- Statuses tick their damage through combat's damage (`by: 'mods'`), freeze with `core.root`, throw with `core.launch`, pull with
  `core.shift`, explode with `core.explode`.
- The gun in hand's tip and grip notes go to the modifier source `mods` (`weapon.spread`, `weapon.dmg`, `weapon.gap`,
  `weapon.reload`, `weapon.fanSpread`, `weapon.last`, `proj.ricochet`): set when the weapon or the kit changes.
- The kit is saved in the pack's save (`pack.store('mods')`: `own`, `fit`, `seen`).

## Multiplayer

The kit is the player's, like the pouch: online the server would keep it and take a `fit` act. A target's statuses and the
damage they deal belong with the enemies' health, which would be the server's. Co-op combat is parked, so everything runs on
this side, in one place (the sim's `S`, `ST`, `drops`).

## Knobs

All in `src/content/mods.js`: `ELEM` (each type's numbers), `REACT`, `PARTS` (each part's numbers), `START` (the kit you set out
with), `FINDS` (where and how often), `STREAK`, `CAVE_GROW`, `PICK`.
