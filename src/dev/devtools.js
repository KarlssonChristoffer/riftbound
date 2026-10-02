// DEV TOOLS: things for building the game, not playing it. The colliders overlay (Shift+G), the debug HUD (top left,
// dev mode), the tree lineup (?lineup=trees). Loaded by the boot, which hands it to the engine as E.dev; nothing in the
// game imports this.
import {PLAY} from '../world/world.js';
import {DEG} from '../render/gfx.js';
import {SNAP_NAME} from '../render/camera.js';
import {DEBUG} from '../render/options.js';
const $ = s => document.querySelector(s);

export function drawZones({G, host, world}) {   // Shift+G: colliders (red), the playable rectangle (cyan)
  const q = G.layer('front'); q.lineWidth = 1;
  const poly = (pts, col) => { q.strokeStyle = col; q.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = host.toView(x, y, 0); i ? q.lineTo(sx, sy) : q.moveTo(sx, sy); }); q.closePath(); q.stroke(); };
  poly([[PLAY.x0, PLAY.y0], [PLAY.x1, PLAY.y0], [PLAY.x1, PLAY.y1], [PLAY.x0, PLAY.y1]], '#3ad0ff');
  for (const p of world.props) {
    if (p.rect) poly([[p.rect[0], p.rect[1]], [p.rect[2], p.rect[1]], [p.rect[2], p.rect[3]], [p.rect[0], p.rect[3]]], '#ff5050');
    else if (p.r) poly(Array.from({length: 10}, (_, i) => [p.x + Math.cos(i / 10 * 6.283) * p.r, p.y + Math.sin(i / 10 * 6.283) * p.r]), '#ff5050');
  }
}

// the debug HUD (dev mode): biome, clock, loadout; features' own lines; the camera; the features; frame stats
export function drawHud({host, opt, stage, env, hero, cv, features, G, fps, proj, PL}) {
  $('#hud').classList.toggle('hidden', !host.dev); $('#help').classList.toggle('hidden', !host.dev || !opt.help);
  if (!host.dev) return;
  const b = stage.biome, deg = ((cv.yaw / DEG) % 360 + 360) % 360, s = G.stats;
  const fh = features.map(f => f.hud?.()).filter(Boolean).join(' · ');
  $('#hud').innerHTML = [
    `<div class="row"><b>Proving Grounds 3D</b> · ${b.name} · ${env.label()}${opt.lantern ? ' · lantern' : ''} · ${hero.loadName}</div>`,
    fh ? `<div class="row">${fh}</div>` : '',
    `<div class="row">camera <b>${deg.toFixed(1)}°</b> (${SNAP_NAME[cv.snapMode]}) · zoom ${(cv.scale * cv.zoom / cv.dsBase).toFixed(2)}x (${cv.scale}:1)${opt.debug ? ` · view <b>${DEBUG[opt.debug]}</b>` : ''}</div>`,
    `<div class="row dim">features: ${features.map(f => `${f.name}${f.on === false ? ' (off)' : ''}`).join(', ') || 'none yet'}</div>`,
    `<div class="row dim">${fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms CPU · ${s.calls} draws · ${s.sprites} sprites · ${s.points} pts · hits ${proj.hits}/${PL.shots}</div>`,
  ].join('');
}

// ?lineup=trees: the procedural trees side by side for review, 3 rows of 5 (x 12 .. 26.4), each framed by standing 3.4 m
// north of its middle (&at=19.2,6.6 / 13.1 / 19.6): oaks seeds 0-4 | oaks 5-7 + the painted oaks | dead 0-2 + the
// painted dead tree, then the willows 0-2 and the painted willow (x 26.4 .. 37.2, framed at &at=31,21) (p.painted keeps a
// tree's card). They join the world's entities, so they survive N / Shift+R
export function treeLineup({world, ents}) {
  const row = (y, list) => list.forEach(([variant, seed, painted], i) => {
    const p = {kind: 'tree', x: 12 + i * 3.6, y, z: 0, variant, seed, painted, lineup: true, r: .3};
    ents.add(p); world.addItem(p);
  });
  row(10, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
  row(16.5, [[0, 5], [0, 6], [0, 7], [0, 0, true], [1, 0, true]]);
  row(23, [[2, 0], [2, 1], [2, 2], [2, 0, true], [3, 0], [3, 1], [3, 2], [3, 0, true]]);
}
