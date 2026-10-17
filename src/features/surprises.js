// SURPRISES (docs/SURPRISES.md; content/surprises.js): the night shift's small rule-benders in the persistent forest, each a part
// in features/surprises/:
//   dance.js    THE RAIN DANCE: three laps round the standing stones call a storm (or clear the rain away)
//   charged.js  STORM-CHARGED: struck by lightning you carry it (fast, a thunderclap when you land, a shock into the water that
//               floats the fish up); THE LIGHTNING ROD: a thunderwood splinter in the pouch draws the bolts to you
//   stars.js    FALLING STARS on clear nights, a shard where one comes down; THE STAR FRENZY: carry a shard into the lake
//   looking.js  THE LOOKING-LAKE: float still in the lake at night and the world turns into its mirror image
//   dizzy.js    DIZZY: spin the camera round and round and the world spins on without you
//   fishrain.js IT'S RAINING FISH: in a storm a fish now and then falls out of the clouds and flops about till you grab it
// This file is their host-facing feature: it runs each part's update / view / frame / lights / hd, draws their pixel chips (the
// HD layer, bottom left above the meal's chip: what's on and for how long), lists their rows on its dev menu page (F10 > Nature: for the
// tour and for trying them at once) and gives them one context (C, below). Only in the persistent world (the sandbox's ruins with
// the forest's plan). ?surprises=0: none of it; ?stars=now: the next clear night's first star falls a few s in.
// OWNS: the parts' state; the modifier sources 'charged', 'stormrod', 'starfrenzy', 'dizzy'; the frame's CSS transform
//   (view/screenwarp.js on #wrap). READS: host.env, host.player, pack (give, take, count), caves (down), weather (boltAt), thunder's
//   events, fishing (reads the frenzy's notes itself).
// EMITS: dance.lap, dance.done, charged.start / end / clap / discharge, star.streak / fall / land / take / fade / frenzy,
//   looking.flip, dizzy.start, fishrain.land (core/events.js).
// MULTIPLAYER: every part is personal (your own body, sky, eyes and finds: notes and pouch on this client); each part's header
//   says what a shared version would need the server to own.
// BUDGET: sim: a few compares a step per part. View: pooled points (<= ~300 a frame at the busiest), up to 6 lights, a CSS
//   transform written only on a change, the chips' few fillRects.
import {FOREST} from '../world/layout.js';
import {flags} from '../core/flags.js';
import {simRandom, viewRandom} from '../core/rng.js';
import {hdUnit, hdFont, hdFrame, hdText} from '../ui/hdpixel.js';
import {createScreenWarp} from '../view/screenwarp.js';
import {createDance} from './surprises/dance.js';
import {createCharged} from './surprises/charged.js';
import {createStars} from './surprises/stars.js';
import {createLooking} from './surprises/looking.js';
import {createDizzy} from './surprises/dizzy.js';
import {createFishRain} from './surprises/fishrain.js';

const ON = flags.get('surprises') !== '0' && !!FOREST;

// ORDER (core/features.js): after the pack (its pouch, the shard's give) and thunder (its strike events come a step late anyway)
export const order = {after: ['pack', 'thunder']};

export async function create(host) {
  const game = () => host.feature('game');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const queue = [];   // (the menu's rows: run in the next sim step)
  const C = {
    host, active,
    pack: () => host.feature('pack'),
    toast: (t, s, col) => game()?.ui?.toast(t, s, col),
    queue: fn => queue.push(fn),
    warp: createScreenWarp(typeof document !== 'undefined' ? document.querySelector('#wrap') : null),
    stormy: () => (host.env?.sky?.storm ?? 0) > .3,
    mmss: s => { s = Math.max(0, Math.ceil(s)); return `${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`; },
    PE: {size: 1, emit: true}, PE2: {size: 2, emit: true}, P1: {size: 1},
    R: simRandom('surprises'), V: viewRandom('surprises'),
  };
  const parts = ON ? [createDance(C), createCharged(C), createStars(C), createLooking(C), createDizzy(C), createFishRain(C)] : [];
  const [, charged, , looking] = parts;
  const LR = Array.from({length: 8}, () => ({x: 0, y: 0, h: 0, color: '#ffffff', radius: 1, intensity: 0, flicker: 0, id: ''}));
  LR.forEach((r, i) => { r.id = 'surprise' + i; });
  let li = 0;
  const nextLight = () => li < LR.length ? LR[li++] : null;
  const LOUT = [], CHIPS = [];

  const F = {
    name: 'surprises', label: 'Night surprises', on: ON,
    get charged() { return charged?.left > 0; }, get mirrored() { return !!looking?.on; },
    charge: s => charged?.charge(s),
    update(dt, evs) {
      while (queue.length) queue.shift()();
      for (const p of parts) p.update?.(dt, evs);
    },
    view(dt, evs) { for (const p of parts) p.view?.(dt, evs); },
    frame(f) { if (!active()) return; for (const p of parts) p.frame?.(f); },
    lights() {
      LOUT.length = 0; li = 0;
      if (active()) for (const p of parts) p.lights?.(LOUT, nextLight);
      return LOUT;
    },
    hd(q, sc) {
      if (!active() || host.hudOff || host.playerHidden) return;
      const u = hdUnit();
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      for (const p of parts) p.hd?.(q, sc, u);
      q.restore();
      chips(q, u);
    },
    menu: () => active() ? parts.flatMap(p => p.menu?.() || []) : [],
    hud: () => { CHIPS.length = 0; for (const p of parts) { const c = p.chip?.(); if (c) CHIPS.push(...[].concat(c)); } return CHIPS.map(c => c.text).join(' · '); },
    dispose() { for (const p of parts) p.dispose?.(); },
  };
  // the chips: one pixel frame a line, bottom left, over the meal's (features/meals.js chip); while the world is mirrored they are
  // drawn mirrored back, so they still read the right way round
  function chips(q, u) {
    CHIPS.length = 0;
    for (const p of parts) { const c = p.chip?.(); if (!c) continue; if (Array.isArray(c)) CHIPS.push(...c); else CHIPS.push(c); }
    if (!CHIPS.length || host.feature('pack')?.open) return;
    const H = 13 * u, gap = 3 * u, base = q.canvas.height - 6 * u - (H + gap), blink = ((performance.now() / 300) | 0) % 2;
    q.save();
    if (C.warp.mirrored) q.setTransform(-1, 0, 0, 1, q.canvas.width, 0); else q.setTransform(1, 0, 0, 1, 0, 0);
    q.imageSmoothingEnabled = false; q.font = hdFont(u);
    for (let i = 0; i < CHIPS.length; i++) {
      const c = CHIPS[i], W = Math.ceil(q.measureText(c.text).width / u) * u + 10 * u, x0 = 6 * u, y0 = base - (i + 1) * (H + gap);
      hdFrame(q, x0, y0, W, H, u);
      hdText(q, c.text, x0 + 5 * u, y0 + 10 * u, u, c.blink && blink ? '#6a6458' : c.col);
    }
    q.restore();
  }
  return F;
}
