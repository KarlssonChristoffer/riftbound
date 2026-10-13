# Aim help (a prototype)

Status: 2026-10-12, a prototype to feel the options before items and builds lean on them. `features/aim.js`.

How much the game helps you aim, chosen in the menu (Controls > Aim help) or `?aim=manual | soft | lock | auto`:

- **manual** (the default, as before): the shot goes where the cursor is; a target under the cursor still takes it (the
  adapter's ARPG hover).
- **soft**: the cursor is sticky: the foe nearest the cursor within `TUNE.softPx` art px (26) takes the shot, at his chest.
  No marker: it should feel like your own aim.
- **lock**: a target is held: the foe nearest the cursor anywhere on screen is locked, and stays locked until he falls,
  leaves the screen, or another comes clearly nearer the cursor (`switchK`: .6 of the locked one's distance). Every shot
  goes to him. A gold ring at his feet.
- **auto**: he shoots by himself: the foe nearest him (within `autoRange`, 14 m, on screen) is the target and the gun fires
  whenever it can (its own pace and reloads: `sim/player/gun.js` reads `H.autoFire()`, the adapter asks the features). You
  move, dodge, lasso and brawl. An orange ring at his feet. (The revolver only; the bow isn't fired for you.)

Foes: the run's brutes and the desert's gunmen (`hunter`), the yard's sparring brutes, the training dummies.

Sim vs view: `aimTarget()` and `autoFire()` are read by the player's step (deterministic: the sim's foes, the cursor, the
last frame's view for "on screen", as the adapter's hover reads it); the ring is drawn in `frame`.

Next (to decide after playing it): the default for new players, whether a mode or its strength becomes an item / build
property (stickier, no help but more damage, an auto-firing gun), bullets that bend a little in soft mode, the bow.
