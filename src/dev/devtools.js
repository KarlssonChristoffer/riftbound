// DEV TOOLS: things for building the game, not playing it. The colliders overlay (Shift+G), the debug HUD (top left,
// dev mode), the tree lineup (?lineup=trees). Loaded by the boot, which hands it to the engine as E.dev; nothing in the
// game imports this.
import {PLAY} from '../world/world.js';
import {heightOf, walkR} from '../world/collide.js';
import {DEG} from '../render/gfx.js';
import {SNAP_NAME} from '../render/camera.js';
import {DEBUG} from '../render/options.js';
const $ = s => document.querySelector(s);

// Shift+G: colliders as a body walks against them (red at their base, dim at their top: world/collide.js heightOf, walkR), the playable rectangle
// (cyan), his body's circle at his feet (yellow; magenta while he's inside something: docs/COLLISION.md)
const R_BODY = .25;
export function drawZones({G, host, world}) {
  const q = G.layer('front'); q.lineWidth = 1;
  const poly = (pts, h, col) => { q.strokeStyle = col; q.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = host.toView(x, y, h); i ? q.lineTo(sx, sy) : q.moveTo(sx, sy); }); q.closePath(); q.stroke(); };
  const ring = (x, y, r, h, col) => poly(Array.from({length: 16}, (_, i) => [x + Math.cos(i / 16 * 6.283) * r, y + Math.sin(i / 16 * 6.283) * r]), h, col);
  poly([[PLAY.x0, PLAY.y0], [PLAY.x1, PLAY.y0], [PLAY.x1, PLAY.y1], [PLAY.x0, PLAY.y1]], 0, '#3ad0ff');
  for (const p of world.props) {
    if (p.gone || p.broken || !(p.rect || p.r)) continue;
    const z = p.z || 0, t = heightOf(p);
    for (const [h, col] of t ? [[z, '#ff5050'], [z + t, 'rgba(255,80,80,.45)']] : [[z, '#ff5050']]) {
      if (p.rect) poly([[p.rect[0], p.rect[1]], [p.rect[2], p.rect[1]], [p.rect[2], p.rect[3]], [p.rect[0], p.rect[3]]], h, col);
      else ring(p.x, p.y, walkR(p), h, col);
    }
  }
  const pl = host.player, z = pl.z;
  ring(pl.x, pl.y, R_BODY, z, host.blocked(pl.x, pl.y, z, false) ? '#ff40ff' : '#ffe040');
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
    `<div class="row">camera <b>${deg.toFixed(1)}°</b> (${SNAP_NAME[cv.snapMode]}) · zoom ${(cv.scale * cv.dz / cv.dsBase).toFixed(2)}x (${cv.scale}:1)${opt.debug ? ` · view <b>${DEBUG[opt.debug]}</b>` : ''}</div>`,
    `<div class="row dim">features: ${features.map(f => `${f.name}${f.on === false ? ' (off)' : ''}`).join(', ') || 'none yet'}</div>`,
    `<div class="row dim">${fps.toFixed(0)} fps · ${s.ms.toFixed(1)} ms CPU · ${s.calls} draws · ${s.sprites} sprites · ${s.points} pts · hits ${proj.hits}/${PL.shots}</div>`,
  ].join('');
}

// ?lineup=trees: the procedural trees side by side for review, 3 rows of 5 (x 12 .. 26.4), each framed by standing 3.4 m
// north of its middle (&at=19.2,6.6 / 13.1 / 19.6): oaks seeds 0-4 | oaks 5-7 + the painted oaks | dead 0-2 + the
// painted dead tree, then the willows 0-2 and the painted willow (x 26.4 .. 37.2, framed at &at=31,21), then a 4th row south of the arena's wall (y 27.4): the aspens
// 0-2 + the painted one (x 4 .. 10.6, &at=7,24.4), the rowans (x 14 .. 23.6, &at=19,24.4), the birches (x 27 .. 36, &at=31,24.4) (p.painted
// keeps a tree's card; variant 4 / 5 / 6 = rowan / birch / aspen, trees3d.js speciesOf). They join the world's entities, so they survive N / Shift+P
export function treeLineup({world, ents}) {
  const row = (y, list) => list.forEach(([variant, seed, painted, x], i) => {
    const p = {kind: 'tree', x: x ?? 12 + i * 3.6, y, z: 0, variant, seed, painted, lineup: true, r: .3};
    ents.add(p); world.addItem(p);
  });
  row(10, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
  row(16.5, [[0, 5], [0, 6], [0, 7], [0, 0, true], [1, 0, true]]);
  row(23, [[2, 0], [2, 1], [2, 2], [2, 0, true], [3, 0], [3, 1], [3, 2], [3, 0, true]]);
  row(27.4, [[6, 0, false, 4], [6, 1, false, 6.2], [6, 2, false, 8.4], [6, 0, true, 10.6],
    [4, 0, false, 14], [4, 1, false, 17.2], [4, 2, false, 20.4], [4, 0, true, 23.6],
    [5, 0, false, 27], [5, 1, false, 30], [5, 2, false, 33], [5, 0, true, 36]]);
}
