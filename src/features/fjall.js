// FJÄLLET (docs/FJALL.md; the plan world/fjall.js, the meshes world/fjall3d.js, the painter world/fjallpaint.js): the Swedish mountains
// north and east of the woods, in one world with them. Walk out of the woods' north-east corner and up the jokk's valley.
// This feature STREAMS it: the plan's heavy bake runs in a worker (world/fjallworker.js: the height field, the trails, the scatter); the
// page adopts it (layout.js FJALL: walking, elev, the camera's bounds read it from then on). Then:
//   FAR    the whole region in blocks of BLOCK x BLOCK tiles, a FAR_CELL m grid under one low-res painted texture of the region
//          (FAR_PPM px / m, painted once)
//   NEAR   the tiles within NEAR_R m of the player: a 1 m grid (the plan's own lattice: the feet stand where it is drawn) under a
//          texture of their own at NEAR_PPM px / m, painted in the worker when the tile comes near (the far texture until then); their
//          blocks leave them out (blockSkip). Gone past NEAR_OUT m
//   PROPS  the tiles within PROP_R m: their mountain birch, shrubs, stones, cairns and crosses merged in one static mesh a tile
//          (gone past PROP_OUT m); the stuga and the footbridge always
// Each ground piece casts its sun shadow through a sunk copy (as the woods' tiles: world.js caster), so the mountains shade the valley.
// MULTIPLAYER: everything here is grown from the seed (the plan is the same on every client and nothing is sent); the server owns
// the clock, the weather and the season as everywhere. What players will change up here (a cairn built, the stuga's fire, its
// guest book) goes through features/builds.js later. The fjäll is one of the world's switches (net/protocol.js WORLD_FLAGS: fjall).
// OWNS: the fjäll's meshes and textures, the worker. READS: layout.js FJALL (adopts the worker's bake into it), host.G, host.world.
// BUDGET: view: a distance check every few frames; building a tile's pieces only when the player crosses into new ground (a few
// ms, spread over frames: STEP pieces a frame at most). Sim: nothing.
import * as THREE from 'three';
import {FJALL} from '../world/layout.js';
import {FAMS} from '../world/world.js';
import {flags} from '../core/flags.js';
import {tiles, groundGeo, blockGeo, blockSkip, shapes, mergeProps, stugaGeo, bridgeGeo} from '../world/fjall3d.js';

export const order = {};
const NEAR_R = 64, NEAR_OUT = 92, PROP_R = 130, PROP_OUT = 165, FAR_CELL = 4, FAR_PPM = 2, BLOCK = 4, CAST_SINK = .15, STEP = 2;
const PLACE_NAMES = {gate: 'Skogsgränsen', valley: 'Dalen', bridge: 'Bron över jokken', stuga: 'Stugan', lake: 'Sjön', treeline: 'Trädgränsen', glacier: 'Glaciären', summit: 'Storfjällets topp', tarns: 'Tjärnarna', blockhav: 'Blockhavet'};

export async function create(host) {
  const F = {name: 'fjall', label: 'Fjället', on: !!FJALL, ready: false};
  if (!FJALL) return F;
  const P = FJALL, {G} = host, R = P.region, NEAR_PPM = Math.min(16, host.PPM || 16);
  const fam = name => Math.max(0, FAMS.indexOf(name));
  const T = tiles(P), RW = R.x1 - R.x0, RH = R.y1 - R.y0;
  let regionTex = null, regionBmp = null, farBuilt = false, shown = true, lastWorld = null, landmarks = [];
  const blocks = new Map(), near = new Set(), propT = new Set(), queue = [];
  const stats = {plan: 0, region: 0, paints: 0, paintMs: 0};

  // ---- the worker
  let worker = null, inflight = 0;
  const paints = new Map();   // id -> tile (or 'R': the region)
  try {
    worker = new Worker(new URL('../world/fjallworker.js', import.meta.url), {type: 'module'});
    worker.onmessage = e => onMsg(e.data);
    worker.onerror = e => console.warn('fjall: worker', e.message);
    worker.postMessage({type: 'plan', seed: P.seed, home: P.home, edges: P.edges});
  } catch (e) { console.warn('fjall: no worker', e); }
  function onMsg(m) {
    if (m.type === 'error') { console.warn('fjall: worker error', m.msg); if (m.id !== undefined) { inflight--; paints.delete(m.id); } return; }
    if (m.type === 'plan') {
      P.adopt(m.o); F.ready = true; stats.plan = Math.round(m.ms);
      paints.set('R', 'R'); worker.postMessage({type: 'paint', id: 'R', x0: R.x0, y0: R.y0, wm: RW, hm: RH, ppm: FAR_PPM});
      return;
    }
    if (m.type === 'paint') {
      const t = paints.get(m.id); paints.delete(m.id);
      if (t === 'R') { regionBmp = m.bmp; regionTex = G.tex(m.bmp); stats.region = Math.round(m.ms); return; }
      inflight--; stats.paints++; stats.paintMs += m.ms;
      if (!t || !t.n) { m.bmp.close(); return; }   // (it went out of reach meanwhile)
      const tex = G.tex(m.bmp), u = t.n.s.gm.material.uniforms;
      u.uTex.value = tex; u.uTexSize.value.set(m.bmp.width, m.bmp.height); u.uWorld.value.set(t.x1 - t.x0, t.y1 - t.y0); u.uOrigin.value.set(t.x0, t.y0);
      t.n.tex = tex; t.n.bmp = m.bmp; t.n.painted = true;
    }
  }
  const regionOpts = () => ({tex: regionTex, planar: true, world: new THREE.Vector2(RW, RH), origin: new THREE.Vector2(R.x0, R.y0), type: 1, obj: 0});
  // a ground piece's shadow caster: the same triangles sunk CAST_SINK m (it shares the index: a block's skips apply to both)
  function caster(g) {
    const c = new THREE.BufferGeometry(), p = g.attributes.position.array.slice();
    for (let i = 1; i < p.length; i += 3) p[i] -= CAST_SINK;
    c.setAttribute('position', new THREE.BufferAttribute(p, 3)); c.setAttribute('normal', g.attributes.normal); c.setAttribute('uv', g.attributes.uv); c.setIndex(g.index);
    c.boundingSphere = g.boundingSphere; c.boundingBox = g.boundingBox;
    const s = G.surface(c, regionOpts(), true); s.gm.visible = false; return {s, g: c};
  }

  // ---- far: the blocks (once the region's texture is there)
  function buildFar() {
    const by = new Map();
    for (const t of T) { const k = ((t.j / BLOCK) | 0) * 1000 + ((t.i / BLOCK) | 0); let b = by.get(k); if (!b) by.set(k, b = []); b.push(t); }
    for (const [k, list] of by) {
      const g = blockGeo(P, list, FAR_CELL), s = G.surface(g, regionOpts(), false), c = caster(g), b = {k, list, g, s, c, dirty: false};
      for (const t of list) t.block = b;
      blocks.set(k, b);
    }
    // the stuga and the footbridge
    const S = P.STUGA, sg = stugaGeo(S, fam), m4 = new THREE.Matrix4().compose(new THREE.Vector3(S.x, S.h - .05, S.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -S.yaw), new THREE.Vector3(1, 1, 1));
    const BR = P.BRIDGE, TR = P.TRAIL, a = TR[BR.a], b = TR[BR.b], bg = bridgeGeo(a, b, BR.deck, P.H(a[0], a[1]), P.H(b[0], b[1]), fam);
    landmarks = [{geo: sg, m: m4}, {geo: bg, m: new THREE.Matrix4()}];
    farBuilt = true;
  }
  function placeLandmarks() {
    for (const L of landmarks) { L.mesh?.dispose?.(); L.mesh = host.world.mesh(L.geo, L.m, {static: true}); }
  }

  // ---- props: the scatter in its tiles (once)
  let bucketed = false;
  function bucket() {
    const S = shapes(fam), SC = P.scatter(), byK = new Map();
    for (const t of T) { t.recs = []; byK.set(t.j * 1000 + t.i, t); }
    const X = T.X, Y = T.Y, ix = v => { let lo = 0, hi = X.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (X[m] <= v) lo = m; else hi = m - 1; } return lo; }, iy = v => { let lo = 0, hi = Y.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (Y[m] <= v) lo = m; else hi = m - 1; } return lo; };
    const add = (x, y, r) => { const t = byK.get(iy(y) * 1000 + ix(x)); if (t) { r.x = x; r.y = y; t.recs.push(r); } };
    for (const q of SC.trees) add(q.x, q.y, {g: S.tree[q.v & 7], h: P.H(q.x, q.y) - .08, yaw: q.yaw, s: q.s});
    for (const q of SC.shrubs) add(q.x, q.y, {g: (q.k ? S.shrub : S.willow)[q.v & 3], h: P.H(q.x, q.y) - .05, yaw: q.yaw, s: q.s * 1.1});
    for (const q of SC.stones) add(q.x, q.y, {g: S.stone[q.v % 6], h: P.H(q.x, q.y) - q.r * .22, yaw: q.yaw, s: q.r, sy: q.field ? 1 : .85});
    for (const q of SC.cairns) add(q.x, q.y, {g: S.cairn[q.v & 3], h: P.H(q.x, q.y) - .05, yaw: q.x * 1.7, s: q.s});
    for (const q of SC.crosses) add(q.x, q.y, {g: S.cross[0], h: P.H(q.x, q.y), yaw: -q.yaw, s: 1});
    bucketed = true;
  }

  // ---- near tiles and props: in and out by the player's distance
  const dist = (t, x, y) => Math.hypot(Math.max(t.x0 - x, 0, x - t.x1), Math.max(t.y0 - y, 0, y - t.y1));
  function nearIn(t) {
    const g = groundGeo(P, t, 1), s = G.surface(g, regionOpts(), false), c = caster(g);
    t.n = {g, s, c, tex: null, bmp: null, painted: false, asked: false};
    near.add(t); if (t.block) t.block.dirty = true;
  }
  function nearOut(t) {
    const n = t.n; if (!n) return;
    n.s.dispose(); n.c.s.dispose(); n.g.dispose(); n.c.g.dispose(); if (n.tex) n.tex.dispose(); if (n.bmp) n.bmp.close();
    t.n = null; near.delete(t); if (t.block) t.block.dirty = true;
  }
  function propIn(t) { const g = mergeProps(t.recs); t.p = g ? {g, m: host.world.mesh(g, null, {static: true})} : {g: null, m: null}; propT.add(t); }
  function propOut(t) { const p = t.p; if (!p) return; p.m?.dispose(); p.g?.dispose(); t.p = null; propT.delete(t); }
  const skipNear = t => !!t.n;
  let lx = 1e9, ly = 1e9, tick = 0;
  function stream() {
    const pl = host.player, x = pl.x, y = pl.y;
    if (Math.hypot(x - lx, y - ly) > 4 || ++tick % 30 === 0) {
      lx = x; ly = y; queue.length = 0;
      for (const t of T) {
        const d = dist(t, x, y);
        if (!t.n && d < NEAR_R) queue.push([d, 0, t]); else if (t.n && d > NEAR_OUT) nearOut(t);
        if (!t.p && d < PROP_R) queue.push([d + 20, 1, t]); else if (t.p && d > PROP_OUT) propOut(t);
      }
      queue.sort((a, b) => b[0] - a[0]);   // (nearest last: popped first)
    }
    for (let k = 0; k < STEP && queue.length; k++) {
      const [, kind, t] = queue.pop();
      if (kind === 0 && !t.n) nearIn(t); else if (kind === 1 && !t.p) propIn(t); else k--;
    }
    for (const b of blocks.values()) if (b.dirty) { b.dirty = false; blockSkip(b.g, skipNear); b.c.g.setDrawRange(b.g.drawRange.start, b.g.drawRange.count); }
    // paint the near tiles, the nearest first, two at a time
    if (inflight < 2) {
      let best = null, bd = 1e9;
      for (const t of near) if (!t.n.asked) { const d = dist(t, x, y); if (d < bd) { bd = d; best = t; } }
      if (best) { best.n.asked = true; inflight++; const id = best.j * 1000 + best.i; paints.set(id, best); worker.postMessage({type: 'paint', id, x0: best.x0, y0: best.y0, wm: best.x1 - best.x0, hm: best.y1 - best.y0, ppm: NEAR_PPM}); }
    }
  }
  function show(v) {
    if (shown === v) return; shown = v;
    for (const b of blocks.values()) b.s.gm.visible = v;
    for (const t of near) t.n.s.gm.visible = v;
    for (const b of blocks.values()) b.c.s.sm && (b.c.s.sm.visible = v);
    for (const t of near) t.n.c.s.sm && (t.n.c.s.sm.visible = v);
  }

  // a walkable spot at a named place (or near it)
  function spot(name) {
    const p = P.place(name); if (!p) return null;
    for (let r = 0; r < 30; r += 1.5) for (let a = 0; a < 6.28; a += .5) { const x = p[0] + Math.cos(a) * r, y = p[1] + Math.sin(a) * r; if (P.walk(x, y) || (P.inGate(x, y) && x < 71)) return [x, y]; if (!r) break; }
    return p;
  }
  F.go = name => { const s = F.ready ? spot(name) : null; if (s) host.teleport(s[0], s[1]); return !!s; };
  let startAt = flags.get('fjallat');

  const active = () => host.biome?.id === 'ruins';
  F.view = () => {
    if (!F.ready || !regionTex) return;
    if (!active()) { show(false); return; }
    show(true);
    if (!farBuilt) buildFar();
    if (!bucketed) bucket();
    if (host.world !== lastWorld) {   // (a rebuilt world disposed its extra meshes: the props go back in)
      lastWorld = host.world; for (const t of [...propT]) { t.p = null; propT.delete(t); } placeLandmarks(); lx = 1e9;
    }
    if (startAt) { if (F.go(startAt)) startAt = null; }
    stream();
  };
  F.biomeChanged = () => { lx = 1e9; };
  // where he is up here: the place's name and the height (the debug HUD)
  F.hud = () => {
    const pl = host.player; if (!F.ready || !P.owns(pl.x, pl.y)) return '';
    let best = '', bd = 60; for (const [k, v] of Object.entries(PLACE_NAMES)) { const p = P.place(k); const d = Math.hypot(p[0] - pl.x, p[1] - pl.y); if (d < bd) { bd = d; best = v; } }
    return `fjäll: ${P.H(pl.x, pl.y).toFixed(0)} m${best ? ' · ' + best : ''} · tiles ${near.size} near, ${propT.size} with props`;
  };
  F.menu = () => F.ready ? Object.entries(PLACE_NAMES).map(([k, v]) => ({label: `Fjället: till ${v}`, run: () => F.go(k)})) : [];
  F.state = () => ({ready: F.ready, far: farBuilt, near: near.size, props: propT.size, ...stats});
  F.dispose = () => { worker?.terminate(); };
  return F;
}
