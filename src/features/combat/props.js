// PROP PHYSICS (render3d): the PHYSICS half of the arena's props3d.js, ported as is, plus how the 3D world shows it.
//   barrels   tip (sprint > tipSpeed into one, a dodge-roll, an arrow hit), then ROLL: a true 3D roll here (the item's
//             matrix is composed every frame: fall about the motion direction, spin about the long axis), kicked when
//             lying, bounce off walls / props / the player, float down the stream and come back home after a while
//   crates    pushed along one world axis at a time; a crate pushed into the stream slides in, sinks and adds a stone to
//             layout.stream.stones (dry footing: host.blocked / inStream read it live)
//   blasts    explosions shove props (crates hop); powder kegs explode on a hard impact; hard hits damage through combat
//   chests    the lid follows p.opened (world.js picks chest_0..4 from p.lid)
//   debris    the arena's tumbling 3D chunks (chunk_plank / stave / shard / stone / iron) as LIVE meshes from a pool,
//             tumbling about a random axis in flight, lying flat once they settle, blinking out
// Changes from the arena (documented): distances are round (the arena squashed y x 1.6 for its 2D collision); the input
// for pushes / kicks is the player's view-frame WASD turned into the world; a sunk crate sinks until its lid is level
// with the bank (sinkCrate), since here the player stands at h = 0 on a real box (the arena sank it .5 m and clipped
// the sprite at a painted waterline).
//
// createPropPhysics(host, core) -> PH: PH.update(dt, evs) after combat's update (sim); PH.view(dt) the tumbling debris;
// PH.frame() every rendered frame
// (matrices, chunk meshes); PH.biomeChanged() (the world's meshes were disposed); PH.shove(q, vx, vy); PH.T; PH.dbg.
import * as THREE from 'three';
import {walkable, TERRAIN_ON, FAMS} from '../../world/world.js';
import {gemChunk} from '../../world/props3d.js';   // (the true-3D crystal's shards: a procedural chunk, glowing; ?props2d=1 none, as before)
import {flags} from '../../core/flags.js';

const MOVABLE = new Set(['crate', 'barrel', 'barrel_x']);
const P2D = flags.get('props2d') === '1';
const DEBRIS = {crate: ['plank', 5], barrel: ['stave', 6], barrel_x: ['stave', 5], pot: ['shard', 5], crystal: P2D ? ['stone', 0] : ['gem', 6], chest: ['plank', 0]};
const CHUNK_KINDS = ['plank', 'stave', 'shard', 'stone', 'iron'];
const R_BODY = .25;
// the barrel models (glb bounds): height, radius
const BARREL = {barrel: [.7052, .297], barrel_x: [.80084, .3102]};
const CRATE_H = .725;

export function extraProps(ents) {
  // two loose crates on the near bank of the stream's wide stretch: push one in to get a stepping stone
  const out = [], add = (x, y) => { const p = {kind: 'crate', x, y, variant: 0, z: 0, breakable: 'crate', hp: 20, maxHp: 20, stage: 0, r: .34}; ents.add(p); out.push(p); };
  add(42.6, 20.2); add(43.2, 21.4);
  return out;
}

export async function createPropPhysics(host, core) {
  const P = host.player;
  const T = {
    rollFric: 1.1, slopeG: 4.6, slideFric: 7, pushV: 1.7, pushDelay: .16, kick: 1.1, kickMin: 2.2, kickMax: 6, tipSpeed: 4.2, tipMax: 5.5, arrowTip: 2.6, tiltT: .09,
    blast: 7.5, impact: 2.2, boomImpact: 2.1, flow: .9, sinkT: .45, idleReset: 22, resetAway: 6,
    sinkCrate: CRATE_H - .02, sinkFloat: .22,   // 3D: how deep a sunk crate / a floating barrel sits (the arena: .5 / .22)
  };
  const ents = host.entities, stream = () => host.layout.stream, nearQ = [];   // nearQ: the grid's candidates
  // (live queries on the entity registry: a movable prop that joins later gets its physics state as it joins)
  const mov = host.entities.query('props.movable', p => MOVABLE.has(p.kind), p => { p.home3 = [p.x, p.y, p.z || 0]; p.vx = 0; p.vy = 0; p.push = p.kind === 'crate' && !p.wall; p.idle = 0; });
  const chests = host.entities.query('props.chest', p => p.kind === 'chest');
  let simT = 0, lastPV = [0, 0], lastPS = 0;
  const inBounds = walkable;   // where a pushed prop may go: where the player may (layout.walkable)
  const moveInput = () => {   // the player's WASD (camera-relative) in the world
    const [vx, vy] = host.PL.moveInput(), a = host.yaw, c = Math.cos(a), s = Math.sin(a);
    return [vx * c + vy * s, -vx * s + vy * c];
  };
  // what stops q at (x, y): null | 'edge' | 'player' | a prop
  function hitAt(q, x, y) {
    if (!inBounds(x, y)) return 'edge';
    if (host.elev(x, y) > (q.z || 0) + .3) return 'edge';   // a cliff face from below
    const r = q.tip ? .3 : q.r || .32;
    if (Math.abs(P.z - (q.z || 0)) < .8 && Math.hypot(P.x - x, P.y - y) < r + R_BODY) return 'player';
    for (const p of ents.near(x, y, r, nearQ)) {
      if (p === q || p.broken || p.gone || Math.abs((p.z || 0) - (q.z || 0)) > .9) continue;
      if (p.rect) { if (x > p.rect[0] - r && x < p.rect[2] + r && y > p.rect[1] - r && y < p.rect[3] + r) return p; }
      else if (p.r > 0 && Math.hypot(p.x - x, p.y - y) < p.r + r * .9) return p;
    }
    return null;
  }
  const speedOf = q => Math.hypot(q.vx, q.vy);
  const hittable = p => p && typeof p === 'object' && !p.broken && (p.hp > 0 || p.target);
  function strike(target, dmg, vx, vy) {   // damage through combat (numbers, stages, breaks, explosions, hitstop)
    if (!hittable(target)) return;
    core.onArrowHit({dmg: Math.round(dmg), vx, vy, x: target.x, y: target.y, h: (target.z || 0) + .4, kind: 'impact'}, target);
  }
  function tip(q, dx, dy, speed) {   // an upright barrel falls over toward (dx, dy) and rolls on
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    q.tip = {axis: Math.atan2(dx, dy) * 180 / Math.PI, phi: 0}; q.tilt = T.tiltT;
    q.x += dx * .28; q.y += dy * .28 * .8; q.vx = dx * speed; q.vy = dy * speed; q.h = (q.h || 0) + .08; q.vh = 1.2; q.wob = .6;
    host.events.push({type: 'prop.tip', prop: true, x: q.x, y: q.y, kind: q.kind});
  }
  function shove(q, vx, vy) {
    if (q.broken || q.gone || q.sink) return;
    if ((q.kind === 'barrel' || q.kind === 'barrel_x') && !q.tip) tip(q, vx, vy, Math.hypot(vx, vy));
    else { q.vx = vx; q.vy = vy; }
    q.idle = 0;
  }
  function setAxis(q) { if (q.tip && speedOf(q) > .05) q.tip.axis = Math.atan2(q.vx, q.vy) * 180 / Math.PI; }
  function enterWater(q) {
    host.events.push({type: 'prop.splash', prop: true, x: q.x, y: q.y});
    if (q.kind === 'crate' && q.x > 0) {   // slides on into the water, sinks to its lid and stays: dry footing across the stream (not the West Downs' brook's pool: it floats)
      const S = stream(), l = speedOf(q) || 1, ux = q.vx / l, uy = q.vy / l;
      let tx = q.x + ux * .6, ty = q.y + uy * .6;
      for (let k = 0; k < 3; k++) if (S.stones.some(o => Math.hypot(o.x - tx, o.y - ty) < .6)) { tx += ux * .72; ty += uy * .72; }   // past a crate already sunk
      const lo = S.cx(ty) - S.w(ty) / 2 + .3, hi = S.cx(ty) + S.w(ty) / 2 - .3;
      tx = lo < hi ? Math.max(lo, Math.min(hi, tx)) : S.cx(ty);
      q.vx = q.vy = 0; q.sinkT = 0; q.float = false; q.r = 0; q.push = false; q.slide = [q.x, q.y, tx, ty];
      q.stone = {x: tx, y: ty, r: .52}; S.addStone(q.stone);
    } else { q.float = true; q.r = 0; q.sink = T.sinkFloat; }
  }
  function dropStone(q) { if (q.stone) { stream().removeStone(q.stone); q.stone = null; } }
  function resetHome(q, quiet) {
    dropStone(q);
    [q.x, q.y, q.z] = q.home3;
    Object.assign(q, {vx: 0, vy: 0, h: 0, vh: 0, tip: null, sink: 0, sinkT: undefined, float: false, idle: 0, r: q.kind === 'crate' ? (q.wall ? .38 : .34) : .3});
    ents.hide(q, false); ents.moved(q);   // a jump home: the grid follows now, not next step
    if (q.kind === 'crate') q.push = !q.wall;
    if (q.gone === false && q.broken && q.goneBroken) { q.broken = false; q.goneBroken = false; }
    if (!quiet) host.events.push({type: 'prop.respawn', prop: true, x: q.x, y: q.y});
  }
  // a new stage: every movable prop back home, upright, dry, unbroken (combat restores hp / stage)
  function resetAll() { for (const q of mov) { q.broken = false; q.goneBroken = false; q.wasBroken = false; resetHome(q, true); } }

  function step(q, dt) {
    if (q.tilt > 0) q.tilt -= dt;
    if (q.broken) { dropStone(q); q.wasBroken = true; return; }
    if (q.wasBroken) { q.wasBroken = false; if (q.x !== q.home3[0] || q.y !== q.home3[1] || q.tip) resetHome(q); return; }   // combat restocked it
    if (q.gone) { q.idle += dt; if (q.idle > T.idleReset * .5 && Math.hypot(P.x - q.home3[0], P.y - q.home3[1]) > T.resetAway) { q.broken = false; resetHome(q); } return; }
    if (q.sinkT !== undefined && q.sinkT < T.sinkT) {
      q.sinkT += dt; const k = Math.min(1, q.sinkT / T.sinkT); q.sink = T.sinkCrate * k ** .6;
      if (q.slide) { const e = 1 - (1 - k) ** 2; q.x = q.slide[0] + (q.slide[2] - q.slide[0]) * e; q.y = q.slide[1] + (q.slide[3] - q.slide[1]) * e; }
    }
    if (q.float) {   // drift down the stream, bobbing, until it leaves the map
      const S = stream(); q.y += T.flow * dt; q.x += (S.cx(q.y) - q.x) * Math.min(1, dt * 1.5);
      q.sink = T.sinkFloat + Math.sin(simT * 3.1 + q.home3[0]) * .03; if (q.tip) q.tip.phi += dt * .6;
      if (q.y > 29.5) { ents.hide(q); q.broken = true; q.goneBroken = true; q.idle = 0; }
      return;
    }
    // air (fell off the plateau): gravity on the height above the surface under it
    if (q.h > 0 || q.vh) {
      q.vh = (q.vh || 0) - 18 * dt; q.h = Math.max(0, (q.h || 0) + q.vh * dt);
      if (q.h === 0) {
        const hard = q.vh < -5; q.vh = hard && q.tip ? 2.2 : 0; if (q.vh) q.h = .001;
        if (hard) { host.events.push({type: 'prop.land', prop: true, x: q.x, y: q.y, kind: q.kind}); if (q.kind === 'barrel_x') strike(q, 99, 0, 1); else strike(q, 8, 0, 1); }
      }
    }
    // walkable terrain: a barrel lying on a slope rolls down it (gravity along the fall line, slopeG m/s^2 at 45 deg, beats its rolling
    // friction on anything steeper than ~1 in 6); upright ones and crates stay where they stand
    if (TERRAIN_ON && q.tip && !q.h) {
      const gx = (host.elev(q.x + .15, q.y) - host.elev(q.x - .15, q.y)) / .3, gy = (host.elev(q.x, q.y + .15) - host.elev(q.x, q.y - .15)) / .3, sl = Math.hypot(gx, gy);
      if (sl * T.slopeG > T.rollFric * 1.4 && sl < 3) { const a = T.slopeG * Math.SQRT2 / Math.sqrt(1 + sl * sl) * dt; q.vx -= gx * a; q.vy -= gy * a; setAxis(q); }
    }
    const s = speedOf(q);
    if (s < .04) { q.vx = q.vy = 0; if (!q.stone && (q.tip || Math.hypot(q.x - q.home3[0], q.y - q.home3[1]) > .3)) q.idle += dt; return; }
    q.idle = 0;
    const nx = q.x + q.vx * dt, ny = q.y + q.vy * dt, hit = hitAt(q, nx, ny);
    if (!hit) {
      q.x = nx; q.y = ny;
      // rolling without slipping: spin about the axis = ((up x v) . axis) / r
      if (q.tip) { const a = q.tip.axis * Math.PI / 180; q.tip.phi += (q.vy * Math.cos(a) + q.vx * Math.sin(a)) * dt / .3; }
      const e = host.elev(q.x, q.y);
      if (e < (q.z || 0) - .3) { q.h = (q.z || 0) - e; q.z = e; q.vh = 0; }   // rolled off the edge
      else if (TERRAIN_ON && !q.h && e !== (q.z || 0)) q.z = e;            // (walkable terrain: it rolls up and down the slopes)
      if (e === 0 && !q.h && host.inStream(q.x, q.y)) { enterWater(q); return; }
    } else {
      // bounce: reflect about the contact normal, lose most of the speed; hard hits damage both
      let nxn = 0, nyn = 0;
      if (hit === 'player') { nxn = q.x - P.x; nyn = q.y - P.y; }
      else if (hit === 'edge') { const bx = hitAt(q, q.x + q.vx * dt, q.y) ? 1 : 0, by = hitAt(q, q.x, q.y + q.vy * dt) ? 1 : 0; nxn = bx ? -q.vx : 0; nyn = by ? -q.vy : 0; if (!bx && !by) { nxn = -q.vx; nyn = -q.vy; } }
      else if (hit.rect) { const cx = Math.max(hit.rect[0], Math.min(hit.rect[2], q.x)), cy = Math.max(hit.rect[1], Math.min(hit.rect[3], q.y)); nxn = q.x - cx; nyn = q.y - cy; if (!nxn && !nyn) { nxn = -q.vx; nyn = -q.vy; } }
      else { nxn = q.x - hit.x; nyn = q.y - hit.y; }
      const nl = Math.hypot(nxn, nyn) || 1; nxn /= nl; nyn /= nl;
      const vn = q.vx * nxn + q.vy * nyn;
      if (vn < 0) { q.vx -= 1.6 * vn * nxn; q.vy -= 1.6 * vn * nyn; }
      const k = q.tip ? .45 : .15; q.vx *= k; q.vy *= k;
      if (s > T.impact) {
        host.events.push({type: 'prop.impact', prop: true, x: q.x, y: q.y, kind: q.kind, speed: s});
        if (hit === 'player') host.knock(-nxn * s * .7, -nyn * s * .7);
        else if (hittable(hit)) strike(hit, s * 5, -nxn * s, -nyn * s);
        if (q.kind === 'barrel_x' && s > T.boomImpact) strike(q, 99, q.vx, q.vy);
        else strike(q, s * 2.5, q.vx, q.vy);
      }
      q.wob = Math.min(1, (q.wob || 0) + s * .15);
      setAxis(q);
    }
    const fr = (q.tip ? T.rollFric : T.slideFric) * dt, s2 = speedOf(q);
    if (s2 <= fr) { q.vx = q.vy = 0; } else { q.vx *= (s2 - fr) / s2; q.vy *= (s2 - fr) / s2; }
  }

  // the player against movable props: sprint / roll into an upright barrel tips it, walking into a lying one kicks it,
  // leaning on a crate pushes it along the dominant axis
  function contact(dt) {
    const [ix, iy] = moveInput(), rolling = P.state === 'roll', ps = lastPS;
    for (const q of mov) {
      if (q.broken || q.gone || q.sink || q.h > .05 || Math.abs((q.z || 0) - P.z) > .5) { q.pushT = 0; continue; }
      const dx = q.x - P.x, dy = q.y - P.y, d = Math.hypot(dx, dy), reach = (q.tip ? .3 : q.r) + R_BODY + .1;
      if (d > reach) { q.pushT = 0; continue; }
      const ux = dx / (d || 1), uy = dy / (d || 1);
      const toward = ix * ux + iy * uy, vin = lastPV[0] * ux + lastPV[1] * uy;
      if ((q.kind === 'barrel' || q.kind === 'barrel_x')) {
        if (!q.tip && (rolling || vin > T.tipSpeed)) { tip(q, ux, uy, Math.min(T.tipMax, Math.max(3, Math.abs(vin) * .75 + (rolling ? 1.2 : 0)))); continue; }
        if (q.tip && speedOf(q) < 1 && (vin > .8 || (rolling && vin > 0) || (toward > .7 && ps > .3))) {
          const v = Math.min(T.kickMax, Math.max(T.kickMin, Math.max(vin, ps) * T.kick + (rolling ? 1.5 : 0))); q.vx = ux * v; q.vy = uy * v; setAxis(q);
          q.tip.axis = Math.atan2(q.vx, q.vy) * 180 / Math.PI; host.events.push({type: 'prop.kick', prop: true, x: q.x, y: q.y, kind: q.kind}); q.wob = .5;
        }
        continue;
      }
      if (q.push && toward > .7) {
        q.pushT = (q.pushT || 0) + dt;
        if (q.pushT > T.pushDelay) {
          const ax = Math.abs(ix) >= Math.abs(iy) ? Math.sign(ix) : 0, ay = ax ? 0 : Math.sign(iy);   // grid-like: one axis at a time
          if (ax * ux + ay * uy > .35) { q.vx = ax * T.pushV; q.vy = ay * T.pushV; if (!q.pushSnd || simT - q.pushSnd > .35) { q.pushSnd = simT; host.events.push({type: 'prop.scrape', prop: true, x: q.x, y: q.y}); } }
        }
      } else q.pushT = 0;
    }
  }

  // ---------------- debris: tumbling chunks, bounce, settle, blink out ----------------
  const flying = [];
  let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function burst(x, y, z, kind, n, dir = [0, 0], sp = 2.6) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, s = sp * (.4 + rnd() * .8);
      // 3D: a random tumble axis and a resting yaw (the arena stepped through 8 pre-rendered orientations)
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, w = Math.sqrt(1 - u * u);
      flying.push({kind, x: x + (rnd() - .5) * .3, y: y + (rnd() - .5) * .2, z, h: .2 + rnd() * .5, vx: Math.sin(a) * s + dir[0], vy: Math.cos(a) * s * .8 + dir[1],
        vh: 2.5 + rnd() * 3, rot: rnd() * 8, spin: (rnd() < .5 ? -1 : 1) * (8 + rnd() * 10), t: 0, life: 3 + rnd() * 2, rest: false,
        ax: new THREE.Vector3(w * Math.cos(th), u, w * Math.sin(th)), yaw: rnd() * Math.PI * 2, m: null});
    }
    if (flying.length > 80) for (const c of flying.splice(0, flying.length - 80)) release(c);
  }

  // chunk meshes: one geometry per kind (the _0 pose; the rest are its 45 deg turns), a pool of live meshes
  const CH = {};
  async function loadChunks() {
    await Promise.all(CHUNK_KINDS.map(async k => {
      const g = await host.world.glb(`chunk_${k}_0`); if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox; CH[k] = {geo: g, c: new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(.5)};
    }));
    if (!P2D) CH.gem = {geo: gemChunk(), c: new THREE.Vector3(0, .05, 0)};   // (world/props3d.js: a crystal shard, its gem family glowing)
  }
  await loadChunks().catch(e => console.warn('combat: chunk meshes', e));
  let pool = [];
  function acquire(c) {
    const ch = CH[c.kind]; if (!ch) return null;
    let m = pool.pop();
    if (m) { m.setGeometry(ch.geo); m.setVisible(true); } else m = host.world.mesh(ch.geo);
    m.flash = 0; m.setGlow?.(0, c.kind === 'gem' ? FAMS.indexOf('gem') : -1, .6); return m;
  }
  function release(c) { if (c.m) { c.m.setVisible(false); pool.push(c.m); c.m = null; } }

  // ---------------- per step ----------------
  const seen = new WeakSet();
  function update(dt, evs = []) {
    simT += dt;
    for (const e of evs) {
      if (seen.has(e)) continue; seen.add(e);
      if (e.type === 'prop.break' && DEBRIS[e.kind]) { const [k, n] = DEBRIS[e.kind]; if (n) burst(e.x, e.y, host.elev(e.x, e.y), k, n); }
      if (e.type === 'combat.explode') {
        const reach = (e.r || 2.2) * 1.8;
        for (const q of mov) {
          if (q.broken || q.gone || q.sink) continue;
          const dx = q.x - e.x, dy = q.y - e.y, d = Math.hypot(dx, dy); if (d > reach || d < .05) continue;
          const v = T.blast * (1 - d / reach) + 1; shove(q, dx / d * v, dy / d * v);
          if (q.kind === 'crate') { q.h = .001; q.vh = 3 * (1 - d / reach); }
        }
        burst(e.x, e.y, host.elev(e.x, e.y), 'iron', 2, [0, 0], 4);
      }
      if (e.type === 'arrow.hit' && e.prop && (e.prop.kind === 'barrel') && !e.prop.tip && !e.prop.broken) {   // arrows knock wooden barrels over
        const l = Math.hypot(e.vx, e.vy) || 1; tip(e.prop, e.vx / l, e.vy / l, T.arrowTip);
      } else if (e.type === 'arrow.hit' && e.prop?.tip && speedOf(e.prop) < 1.5) {   // and give lying ones a nudge
        const l = Math.hypot(e.vx, e.vy) || 1; e.prop.vx += e.vx / l * T.arrowTip; e.prop.vy += e.vy / l * T.arrowTip; setAxis(e.prop);
      }
    }
    contact(dt);
    for (const q of mov) step(q, dt);
    for (const q of mov) if (!q.broken && !q.gone && q.idle > T.idleReset && Math.hypot(P.x - q.x, P.y - q.y) > T.resetAway && Math.hypot(P.x - q.home3[0], P.y - q.home3[1]) > T.resetAway) resetHome(q);
    for (const c of chests) { const want = c.opened ? 1 : 0; c.lid = c.lid ?? 0; c.lid += Math.sign(want - c.lid) * Math.min(Math.abs(want - c.lid), dt * (want ? 3.2 : 2)); }
    const pv = [P.vx, P.vy]; lastPS = Math.hypot(...pv); lastPV = pv;
  }
  // VIEW: the tumbling debris chunks (spawned by the sim's breaks / blasts with their own rnd, never read by the sim)
  function view(dt) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const c = flying[i]; c.t += dt;
      if (c.t > c.life) { release(c); flying.splice(i, 1); continue; }
      if (c.rest) continue;
      c.vh -= 16 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.h += c.vh * dt; c.rot += c.spin * dt;
      const gh = TERRAIN_ON ? host.elev(c.x, c.y) - (c.z || 0) : 0;   // (walkable terrain: the ground under it, relative to where it broke)
      if (c.h <= gh) {
        c.h = gh;
        if (host.inStream(c.x, c.y) && !c.z) { release(c); flying.splice(i, 1); continue; }
        if (Math.abs(c.vh) < 1.6) { c.rest = true; c.vh = 0; c.rot = Math.round(c.rot); continue; }
        c.vh *= -.35; c.vx *= .55; c.vy *= .55; c.spin *= .5;
      }
    }
  }

  // ---------------- per rendered frame: how the world shows it ----------------
  const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), Qa = new THREE.Quaternion(), Qb = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0), D = new THREE.Vector3();
  const pose = new WeakMap();   // barrel -> {psi (long-axis yaw), beta (spin about it), phi (last tip.phi seen)}
  function barrelMatrix(q, out, wx, wz) {
    const [H, r] = BARREL[q.kind], l = H / 2;
    let st = pose.get(q);
    const a = q.tip.axis * Math.PI / 180;
    if (!st || st.tip !== q.tip) { st = {tip: q.tip, psi: a, beta: -a, phi: q.tip.phi}; pose.set(q, st); }   // upright -> no visible turn at the start
    // the long axis lies across the motion: L = up x d = (cos a, 0, -sin a). Keep it continuous (a bounce reverses d, not
    // the barrel): if the new L points against the old one, use -L and spin the other way
    let sgn = 1;
    if (Math.cos(a - st.psi) < 0) { st.psi = a + Math.PI; sgn = -1; } else st.psi = a;
    let dphi = q.tip.phi - st.phi; st.phi = q.tip.phi;
    if (Math.abs(dphi) > 3) dphi = 0;   // (a reset)
    st.beta += sgn * dphi;
    // fall: tipped about d (the horizontal axis across L) by theta, 0 -> 90 deg over tiltT; the rim stays on the ground
    const th = q.tilt > 0 ? (1 - q.tilt / T.tiltT) * Math.PI / 2 : Math.PI / 2;
    D.set(Math.sin(st.psi), 0, Math.cos(st.psi));
    Qa.setFromAxisAngle(D, -th); Qb.setFromAxisAngle(UP, st.psi + st.beta); Qa.multiply(Qb);
    const hc = (q.z || 0) + (q.h || 0) - (q.sink || 0) + l * Math.cos(th) + r * Math.sin(th);
    V.set(q.x + wx, hc, q.y + wz);
    out.compose(V, Qa, S1).multiply(M2.makeTranslation(0, -l, 0));
    return out;
  }
  function frame() {
    const zoom = host.zoom, a = host.yaw, PPM = host.PPM, rx = Math.cos(a) / PPM, rz = -Math.sin(a) / PPM;   // 1 view px to the right, in the world
    for (const q of mov) {
      const it = host.itemOf(q); if (!it?.live) continue;
      const wob = q.wob ? Math.round(Math.sin(q.wob * 18) * q.wob * 2) : 0;
      const manage = !q.broken && !q.gone && q.stage !== 2 && (!!q.tip || !!q.sink);
      it.manageMatrix = manage;
      if (!manage) continue;
      if (q.tip && BARREL[q.kind]) it.live.setMatrix(barrelMatrix(q, M, wob * rx, wob * rz));
      else it.live.setMatrix(M.makeTranslation(q.x + wob * rx, (q.z || 0) + (q.h || 0) - (q.sink || 0), q.y + wob * rz));
    }
    // chunks
    let gq = null;
    for (const c of flying) {
      if (!c.m) { c.m = acquire(c); if (!c.m) continue; }
      const blink = c.rest && c.t > c.life - .8 && Math.floor(c.t * 10) % 2;
      c.m.setVisible(!blink);
      if (blink) continue;
      const ch = CH[c.kind];
      if (c.rest) { Qa.setFromAxisAngle(UP, c.yaw); V.set(c.x, c.z, c.y); M.compose(V, Qa, S1); }
      else {
        Qa.setFromAxisAngle(c.ax, c.rot * Math.PI / 4); V.set(c.x, c.z + c.h + ch.c.y, c.y);
        M.compose(V, Qa, S1).multiply(M2.makeTranslation(-ch.c.x, -ch.c.y, -ch.c.z));
      }
      c.m.setMatrix(M);
      if (c.h > .05) {   // the arena's little ground shadow under a chunk in the air
        gq ??= host.glayer('ground'); gq.fillStyle = 'rgba(12,14,10,.3)';
        const [sx, sy] = host.toView(c.x, c.y, c.z); gq.fillRect(Math.floor(sx) - zoom, Math.floor(sy), 3 * zoom, zoom);
      }
    }
  }
  function biomeChanged() { pool = []; for (const c of flying) c.m = null; }   // the old world disposed every mesh it lent us

  return {T, update, view, frame, biomeChanged, shove, mov, resetAll, dbg: {flying, mov, hitAt, pool: () => pool}};
}
