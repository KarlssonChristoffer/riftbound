// DEV KEYS: the sandbox's test keys and the renderer's A/B switches (core/input.js calls these, as E.dev, after the
// player's keys).
// Outside dev mode (host.dev off) the keys in DEV_KEYS and Shift + 1..6 go to the game only; L (the lantern) works in both.
// Each has its row in the menu's Dev tab (ui/pause.js).  WRITES: opt, cv.snapMode, stage.propMode / trees3d (their setters).
import {SAMPLING, DEBUG} from '../render/options.js';

// sandbox / test keys (9: light sources, f: the flames' look, b: wind strength; 5-8, k: features' own; c: a gang of gunmen
// now, in the desert sandbox: features/foes.js)
// (P: the props' live 3D / 16-angle A/B, and Shift+P the trees: R reloads a gun loadout's revolver, features/gun.js)
export const DEV_KEYS = new Set(['n', 't', 'g', 'o', 'p', 'v', 'j', 'i', 'h', 'k', '5', '6', '7', '8', '9', 'f', 'b', 'c']);

// renderer A/B (Shift + 1..6): rotation steps, ground sampling, outlines, props live / 16-angle, bands, shadows -> handled?
export function abKey(e, {cv, opt, stage}) {
  if (!(e.shiftKey && /^Digit[1-6]$/.test(e.code))) return false;
  const d = +e.code.slice(5);
  if (d === 1) cv.snapMode = (cv.snapMode + 1) % 3;
  if (d === 2) opt.sampling = SAMPLING[(SAMPLING.indexOf(opt.sampling) + 1) % SAMPLING.length];
  if (d === 3) opt.outline = !opt.outline;
  if (d === 4) stage.propMode = stage.propMode === 'live' ? 'yaw' : 'live';
  if (d === 5) opt.banded = !opt.banded;
  if (d === 6) opt.shadows = !opt.shadows;
  return true;
}

export function devKey(k, e, {env, stage, opt, hero, setBiome, feat}) {
  if (k === 't') env.nextPart();   // jump to dawn / day / dusk / night; the clock runs on from there
  if (k === 'n') setBiome(stage.biomeI + (e.shiftKey ? -1 : 1));
  if (k === 'l') opt.lantern = !opt.lantern;
  if (k === 'o') hero.switchLoadout(hero.loadI + 1);
  if (k === 'v') opt.banded = !opt.banded;
  if (k === 'j') opt.hdBow = !opt.hdBow;
  if (k === 'i') hero.toggleArmour();
  if (k === 'p' && e.shiftKey) stage.trees3d = !stage.trees3d;   // trees: procedural 3D <-> painted cards (a rebuild)
  else if (k === 'p') stage.propMode = stage.propMode === 'live' ? 'yaw' : 'live';
  if (k === 'g') { if (e.shiftKey) opt.zones = !opt.zones; else opt.debug = (opt.debug + 1) % DEBUG.length; }
  if (k === 'h') opt.help = !opt.help;
  if (k === 'c') feat('foes')?.spawnGang(e.shiftKey ? 1 : 0);   // a gang of gunmen now (Shift: one), in the desert sandbox
}
