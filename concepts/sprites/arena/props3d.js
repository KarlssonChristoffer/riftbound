// PROPS3D: environment props modelled in 3D (tools/blender/props3d.py) and pixelized per biome in the character's
// language (props_pixelize.py), then LIT PER PIXEL from their normal maps by lighting.drawSprite (world.prop), exactly
// like the Ranger. Plus the physical side that makes them read as objects: barrels tip over and roll (and float down
// the stream), crates can be pushed (a crate pushed into the stream sinks and becomes a stepping stone), chest lids
// swing open, explosions shove things, and broken props throw tumbling 3D debris. OWNER: graphics session.
//
// CONTRACT (the host, arena.html):
//   export function extraProps(props)            // BEFORE combat is created: a few more props for the mechanics
//   export async function createProps3D(ctx, host) -> R
//   host = {props, P, elev, inStream, stream (layout STREAM: .stones is live), moveInput() -> [dx, dy], combat,
//           knock(vx, vy), events (push {type, x, y, ...})}
//   R.on                                         // R key: 3D props on / off (the biome's painted art), A/B
//   R.sprite(p, biomeId) -> {img, nrm, pivot, lit: true} | null   // null = not a 3D prop: the host uses biome.sprite
//   R.update(dt, evs)                            // every simulation step, with that step's events (hit/break/explode)
//   R.drawWorld(g, cam, lighting)                // after the sprites, before lighting.apply: flying debris (lit)
//   R.ready                                      // true once the atlases are loaded
//   Fields it drives on props: x, y (moved), z / h (falls off the plateau), tip {axis, phi} (lying barrel), lid (0..1),
//   sink (m, in water), float (true: drifting), gone (floated away), r (0 when sunk / gone)
//   Events it pushes carry prop: true (tip, kick, scrape, impact, land, splash, respawn; land / splash are also player types)
// Debug: window.__props3d = R (R.T tuning, R.dbg).

const ROOT = 'out/props3d/';
// start downloading at import (before the character's ~1000 sprite requests fill the server's queue)
const loadImg = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
const PRE = typeof document === 'undefined' ? null : fetch(ROOT + 'props.json', {cache: 'no-cache'}).then(r => r.json())
  .then(J => Promise.all([loadImg(ROOT + 'props_nrm.png'), ...J.biomes.map(b => loadImg(`${ROOT}props_${b}.png`)),
    ...Object.keys(J.emit || {}).map(b => loadImg(`${ROOT}props_${b}_emit.png`))]).then(im => [J, im]));
PRE?.catch(() => {});
const KINDS = new Set(['crate', 'barrel', 'barrel_x', 'pot', 'chest', 'pillar', 'pillar_broken', 'rubble', 'rock', 'rock_big',
  'wall_n', 'wall_s', 'wall_w', 'wall_e', 'tower', 'gatepost']);
const MOVABLE = new Set(['crate', 'barrel', 'barrel_x']);
const DEBRIS = {crate: ['plank', 5], barrel: ['stave', 6], barrel_x: ['stave', 5], pot: ['shard', 5], crystal: ['stone', 0], chest: ['plank', 0]};
const R_BODY = .25;

export function extraProps(props) {
  // two loose crates on the near bank of the stream's wide stretch: push one in to get a stepping stone
  const add = (x, y) => props.push({kind: 'crate', x, y, variant: 0, z: 0, breakable: 'crate', hp: 20, maxHp: 20, stage: 0, r: .34});
  add(42.6, 20.2); add(43.2, 21.4);
}

export async function createProps3D(ctx, host) {
  const {props, P} = host;
  const T = {
    rollFric: 1.1, slideFric: 7, pushV: 1.7, pushDelay: .16, kick: 1.1, kickMin: 2.2, kickMax: 6, tipSpeed: 4.2, tipMax: 5.5, arrowTip: 2.6, tiltT: .09,
    blast: 7.5, impact: 2.2, boomImpact: 2.1, flow: .9, sinkT: .45, idleReset: 22, resetAway: 6,
  };
  const R = {on: new URLSearchParams(location.search).get('props3d') !== '0', ready: false, T};
  let J, NRM, AT = {}, EM = {}, EMF = {};
  try {
    let im; [J, im] = await PRE; [NRM, ...AT] = im;
    const eb = Object.keys(J.emit || {});
    EM = Object.fromEntries(eb.map((b, i) => [b, AT[J.biomes.length + i]]));
    EMF = Object.fromEntries(eb.map(b => [b, new Set(J.emit[b])]));
    AT = Object.fromEntries(J.biomes.map((b, i) => [b, AT[i]]));
    R.ready = true;
  } catch (e) { console.warn('props3d: atlas missing, painted props stay', e); return Object.assign(R, {sprite: () => null, update() {}, drawWorld() {}}); }

  // ---------------- sprites: frames sliced lazily into CPU canvases (lighting reads them back once, then caches) ----------------
  const cpu = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d', {willReadFrequently: true}); q.imageSmoothingEnabled = false; return [c, q]; };
  const slices = new Map(), EMPTY = {img: cpu(1, 1)[0], nrm: null, pivot: [0, 0]};
  function slice(src, name, key) {
    let c = slices.get(key); if (c) return c;
    const f = J.frames[name]; const [cv, q] = cpu(f[2], f[3]);
    q.drawImage(src, f[0], f[1], f[2], f[3], 0, 0, f[2], f[3]);
    slices.set(key, cv); return cv;
  }
  const sunkCache = new Map();
  function sunk(cv, sinkPx, key, foam) {   // shifted down sinkPx, clipped at its own bottom row (the waterline), a foam line
    const k = key + ':' + sinkPx; let c = sunkCache.get(k); if (c) return c;
    const [o, q] = cpu(cv.width, cv.height);
    q.drawImage(cv, 0, sinkPx);
    const d = q.getImageData(0, 0, cv.width, cv.height), a = d.data; let low = 0;
    const src = cv.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < src.length; i += 4) if (src[i]) low = Math.max(low, (i >> 2) / cv.width | 0);
    const cut = low - Math.round(sinkPx * .35);
    for (let y = cut + 1; y < cv.height; y++) for (let x = 0; x < cv.width; x++) a[(y * cv.width + x) * 4 + 3] = 0;
    if (foam) for (let x = 0; x < cv.width; x++) { const i = (cut * cv.width + x) * 4; if (a[i + 3]) { a[i] = 214; a[i + 1] = 232; a[i + 2] = 236; } }
    q.putImageData(d, 0, 0); sunkCache.set(k, o); return o;
  }
  const wallV = p => ((Math.round(p.x * 3) * 7 + Math.round(p.y * 5) * 13) >>> 0) % 4;
  const potV = p => ((Math.round(p.x * 7) + Math.round(p.y * 13)) & 1) ? 'pot_b' : 'pot';
  function frameName(p) {
    switch (p.kind) {
      case 'crate': return p.stage === 2 ? 'crate_broken' : p.stage === 1 ? 'crate_dmg' : 'crate';
      case 'barrel': case 'barrel_x':
        if (p.stage === 2) return p.kind + '_broken';
        if (p.tilt > 0) return `${p.kind}_tilt_${((Math.round(p.tip.axis / 45) % 8) + 8) % 8}`;   // caught mid-fall
        if (p.tip) {
          let a = ((p.tip.axis % 180) + 180) % 180, ph = p.tip.phi;
          const ai = Math.round(a / 22.5) % 8, pi = ((Math.round(ph / (Math.PI / 4)) % 8) + 8) % 8;
          return `${p.kind}_roll_${ai}_${pi}`;
        }
        return p.stage === 1 ? p.kind + '_dmg' : p.kind;
      case 'pot': { const v = potV(p); return p.stage === 2 ? 'pot_broken' : p.stage === 1 ? v + '_dmg' : v; }
      case 'chest': return 'chest_' + Math.max(0, Math.min(4, Math.round((p.lid || 0) * 4)));
      case 'pillar': return 'pillar';
      case 'pillar_broken': return 'pillar_broken';
      case 'rubble': return 'rubble';
      case 'rock': return 'rock_' + ((p.variant | 0) % 3);
      case 'rock_big': return 'rock_big_' + ((p.variant | 0) % 3);
      case 'wall_n': return 'wall_ew_' + wallV(p);
      case 'wall_s': return 'wall_low_' + wallV(p);
      case 'wall_w': case 'wall_e': return 'wall_ns_' + wallV(p);
      case 'tower': return 'tower';
      case 'gatepost': return 'gatepost';
    }
    return null;
  }
  // painted: a thunk for the biome's own sprite, whose LIGHTS carry over (the rift tower's crystal, braziers)
  R.sprite = (p, biomeId, painted) => {
    if (!R.on || !KINDS.has(p.kind)) return null;
    if (p.gone) return EMPTY;
    const name = frameName(p), f = name && J.frames[name]; if (!f) return null;
    const at = AT[biomeId] || AT.ruins;
    let a = slice(at, name, biomeId + ':' + name), n = slice(NRM, name, 'n:' + name);
    const sp = Math.round((p.sink || 0) * ctx.PPMH);
    if (sp > 0) { a = sunk(a, sp, biomeId + ':' + name, true); n = sunk(n, sp, 'n:' + name, false); }
    const emit = EMF[biomeId]?.has(name) && !sp ? slice(EM[biomeId], name, 'e:' + biomeId + ':' + name) : null;
    const lights = (p.kind === 'tower' || p.kind === 'gatepost') ? painted?.()?.lights : null;
    return {img: a, nrm: n, pivot: [f[4], f[5]], lit: true, emit, lights};
  };

  // ---------------- physics ----------------
  const mov = props.filter(p => MOVABLE.has(p.kind));
  for (const p of mov) { p.home3 = [p.x, p.y, p.z || 0]; p.vx = 0; p.vy = 0; p.push = p.kind === 'crate' && !p.wall; p.idle = 0; }
  const chests = props.filter(p => p.kind === 'chest');
  let simT = 0, lastPV = [0, 0], lastPS = 0;
  const PLAY = ctx.PLAY, TR = ctx.layout.trail;
  const inBounds = (x, y) => (x > PLAY.x0 - 3 && x < PLAY.x1 + 3 && y > PLAY.y0 - 3 && y < PLAY.y1 + 3) || (x > TR.x0 && x < TR.x1 && y > TR.y0 && y < TR.y1);
  // what stops q at (x, y): null | 'edge' | 'player' | a prop
  function hitAt(q, x, y) {
    if (!inBounds(x, y)) return 'edge';
    if (host.elev(x, y) > (q.z || 0) + .3) return 'edge';   // a cliff face from below
    const r = q.tip ? .3 : q.r || .32;
    if (Math.abs(P.z - (q.z || 0)) < .8 && Math.hypot(P.x - x, (P.y - y) * 1.6) < r + R_BODY) return 'player';
    for (const p of props) {
      if (p === q || p.broken || p.gone || Math.abs((p.z || 0) - (q.z || 0)) > .9) continue;
      if (p.rect) { if (x > p.rect[0] - r && x < p.rect[2] + r && y > p.rect[1] - r * .6 && y < p.rect[3] + r * .6) return p; }
      else if (p.r > 0 && Math.hypot(p.x - x, (p.y - y) * 1.6) < p.r + r * .9) return p;
    }
    return null;
  }
  const speedOf = q => Math.hypot(q.vx, q.vy);
  const hittable = p => p && typeof p === 'object' && !p.broken && (p.hp > 0 || p.target);
  function strike(target, dmg, vx, vy) {   // damage through combat (numbers, stages, breaks, explosions, hitstop)
    if (!hittable(target) || !host.combat) return;
    host.combat.onArrowHit({dmg: Math.round(dmg), vx, vy, x: target.x, y: target.y, h: (target.z || 0) + .4, kind: 'impact'}, target);
  }
  function tip(q, dx, dy, speed) {   // an upright barrel falls over toward (dx, dy) and rolls on
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    q.tip = {axis: Math.atan2(dx, dy) * 180 / Math.PI, phi: 0}; q.tilt = T.tiltT;
    q.x += dx * .28; q.y += dy * .28 * .8; q.vx = dx * speed; q.vy = dy * speed; q.h = (q.h || 0) + .08; q.vh = 1.2; q.wob = .6;
    host.events.push({type: 'tip', prop: true, x: q.x, y: q.y, kind: q.kind});
  }
  function shove(q, vx, vy) {
    if (q.broken || q.gone || q.sink) return;
    if ((q.kind === 'barrel' || q.kind === 'barrel_x') && !q.tip) tip(q, vx, vy, Math.hypot(vx, vy));
    else { q.vx = vx; q.vy = vy; }
    q.idle = 0;
  }
  function setAxis(q) { if (q.tip && speedOf(q) > .05) q.tip.axis = Math.atan2(q.vx, q.vy) * 180 / Math.PI; }
  function enterWater(q) {
    host.events.push({type: 'splash', prop: true, x: q.x, y: q.y});
    if (q.kind === 'crate') {   // slides on into the water, sinks to its shoulders and stays: dry footing across the stream
      const S = host.stream, l = speedOf(q) || 1, ux = q.vx / l, uy = q.vy / l;
      let tx = q.x + ux * .6, ty = q.y + uy * .6;
      for (let k = 0; k < 3; k++) if (S.stones.some(o => Math.hypot(o.x - tx, o.y - ty) < .6)) { tx += ux * .72; ty += uy * .72; }   // past a crate already sunk
      const lo = S.cx(ty) - S.w(ty) / 2 + .3, hi = S.cx(ty) + S.w(ty) / 2 - .3;
      tx = lo < hi ? Math.max(lo, Math.min(hi, tx)) : S.cx(ty);
      q.vx = q.vy = 0; q.sinkT = 0; q.float = false; q.r = 0; q.push = false; q.slide = [q.x, q.y, tx, ty];
      q.stone = {x: tx, y: ty, r: .52}; S.stones.push(q.stone);
    } else { q.float = true; q.r = 0; q.sink = .22; }
  }
  function resetHome(q) {
    if (q.stone) { const i = host.stream.stones.indexOf(q.stone); if (i >= 0) host.stream.stones.splice(i, 1); q.stone = null; }
    [q.x, q.y, q.z] = q.home3;
    Object.assign(q, {vx: 0, vy: 0, h: 0, vh: 0, tip: null, sink: 0, sinkT: undefined, float: false, gone: false, idle: 0, r: q.kind === 'crate' ? (q.wall ? .38 : .34) : .3});
    if (q.kind === 'crate') q.push = !q.wall;
    if (q.gone === false && q.broken && q.goneBroken) { q.broken = false; q.goneBroken = false; }
    host.events.push({type: 'respawn', prop: true, x: q.x, y: q.y});
  }

  function step(q, dt) {
    if (q.tilt > 0) q.tilt -= dt;
    if (q.broken) { if (q.stone) { const i = host.stream.stones.indexOf(q.stone); if (i >= 0) host.stream.stones.splice(i, 1); q.stone = null; } q.wasBroken = true; return; }
    if (q.wasBroken) { q.wasBroken = false; if (q.x !== q.home3[0] || q.y !== q.home3[1] || q.tip) resetHome(q); return; }   // combat restocked it
    if (q.gone) { q.idle += dt; if (q.idle > T.idleReset * .5 && Math.hypot(P.x - q.home3[0], P.y - q.home3[1]) > T.resetAway) { q.broken = false; resetHome(q); } return; }
    if (q.sinkT !== undefined && q.sinkT < T.sinkT) {
      q.sinkT += dt; const k = Math.min(1, q.sinkT / T.sinkT); q.sink = .5 * k ** .6;
      if (q.slide) { const e = 1 - (1 - k) ** 2; q.x = q.slide[0] + (q.slide[2] - q.slide[0]) * e; q.y = q.slide[1] + (q.slide[3] - q.slide[1]) * e; }
    }
    if (q.float) {   // drift down the stream, bobbing, until it leaves the map
      const S = host.stream; q.y += T.flow * dt; q.x += (S.cx(q.y) - q.x) * Math.min(1, dt * 1.5);
      q.sink = .22 + Math.sin(simT * 3.1 + q.home3[0]) * .03; if (q.tip) q.tip.phi += dt * .6;
      if (q.y > 29.5) { q.gone = true; q.broken = true; q.goneBroken = true; q.idle = 0; }
      return;
    }
    // air (fell off the plateau): gravity on the height above the surface under it
    if (q.h > 0 || q.vh) {
      q.vh = (q.vh || 0) - 18 * dt; q.h = Math.max(0, (q.h || 0) + q.vh * dt);
      if (q.h === 0) {
        const hard = q.vh < -5; q.vh = hard && q.tip ? 2.2 : 0; if (q.vh) q.h = .001;
        if (hard) { host.events.push({type: 'land', prop: true, x: q.x, y: q.y, kind: q.kind}); if (q.kind === 'barrel_x') strike(q, 99, 0, 1); else strike(q, 8, 0, 1); }
      }
    }
    const s = speedOf(q);
    if (s < .04) { q.vx = q.vy = 0; if (!q.stone && (q.tip || Math.hypot(q.x - q.home3[0], q.y - q.home3[1]) > .3)) q.idle += dt; return; }
    q.idle = 0;
    const nx = q.x + q.vx * dt, ny = q.y + q.vy * dt, hit = hitAt(q, nx, ny);
    if (!hit) {
      q.x = nx; q.y = ny;
      // rolling without slipping: spin about the axis = ((up x v) . axis) / r, with v and the axis in Blender's frame (y north)
      if (q.tip) { const a = q.tip.axis * Math.PI / 180; q.tip.phi += (q.vy * Math.cos(a) + q.vx * Math.sin(a)) * dt / .3; }
      const e = host.elev(q.x, q.y);
      if (e < (q.z || 0) - .3) { q.h = (q.z || 0) - e; q.z = e; q.vh = 0; }   // rolled off the edge
      if (e === 0 && !q.h && host.inStream(q.x, q.y)) { enterWater(q); return; }
    } else {
      // bounce: reflect about the contact normal, lose most of the speed; hard hits damage both
      let nxn = 0, nyn = 0;
      if (hit === 'player') { nxn = q.x - P.x; nyn = (q.y - P.y) * 1.6; }
      else if (hit === 'edge') { const bx = hitAt(q, q.x + q.vx * dt, q.y) ? 1 : 0, by = hitAt(q, q.x, q.y + q.vy * dt) ? 1 : 0; nxn = bx ? -q.vx : 0; nyn = by ? -q.vy : 0; if (!bx && !by) { nxn = -q.vx; nyn = -q.vy; } }
      else if (hit.rect) { const cx = Math.max(hit.rect[0], Math.min(hit.rect[2], q.x)), cy = Math.max(hit.rect[1], Math.min(hit.rect[3], q.y)); nxn = q.x - cx; nyn = q.y - cy; if (!nxn && !nyn) { nxn = -q.vx; nyn = -q.vy; } }
      else { nxn = q.x - hit.x; nyn = (q.y - hit.y) * 1.6; }
      const nl = Math.hypot(nxn, nyn) || 1; nxn /= nl; nyn /= nl;
      const vn = q.vx * nxn + q.vy * nyn;
      if (vn < 0) { q.vx -= 1.6 * vn * nxn; q.vy -= 1.6 * vn * nyn; }
      const k = q.tip ? .45 : .15; q.vx *= k; q.vy *= k;
      if (s > T.impact) {
        host.events.push({type: 'impact', prop: true, x: q.x, y: q.y, kind: q.kind, speed: s});
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
    const [ix, iy] = host.moveInput(), rolling = P.state === 'roll', ps = lastPS;
    for (const q of mov) {
      if (q.broken || q.gone || q.sink || q.h > .05 || Math.abs((q.z || 0) - P.z) > .5) { q.pushT = 0; continue; }
      const dx = q.x - P.x, dy = q.y - P.y, d = Math.hypot(dx, dy * 1.6), reach = (q.tip ? .3 : q.r) + R_BODY + .1;
      if (d > reach) { q.pushT = 0; continue; }
      const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
      const toward = ix * ux + iy * uy, vin = lastPV[0] * ux + lastPV[1] * uy;
      if ((q.kind === 'barrel' || q.kind === 'barrel_x')) {
        if (!q.tip && (rolling || vin > T.tipSpeed)) { tip(q, ux, uy, Math.min(T.tipMax, Math.max(3, Math.abs(vin) * .75 + (rolling ? 1.2 : 0)))); continue; }
        if (q.tip && speedOf(q) < 1 && (vin > .8 || (rolling && vin > 0) || (toward > .7 && ps > .3))) {
          const v = Math.min(T.kickMax, Math.max(T.kickMin, Math.max(vin, ps) * T.kick + (rolling ? 1.5 : 0))); q.vx = ux * v; q.vy = uy * v; setAxis(q);
          q.tip.axis = Math.atan2(q.vx, q.vy) * 180 / Math.PI; host.events.push({type: 'kick', prop: true, x: q.x, y: q.y, kind: q.kind}); q.wob = .5;
        }
        continue;
      }
      if (q.push && toward > .7) {
        q.pushT = (q.pushT || 0) + dt;
        if (q.pushT > T.pushDelay) {
          const ax = Math.abs(ix) >= Math.abs(iy) ? Math.sign(ix) : 0, ay = ax ? 0 : Math.sign(iy);   // grid-like: one axis at a time
          if (ax * ux + ay * uy > .35) { q.vx = ax * T.pushV; q.vy = ay * T.pushV; q.pushing = true; if (!q.pushSnd || simT - q.pushSnd > .35) { q.pushSnd = simT; host.events.push({type: 'scrape', prop: true, x: q.x, y: q.y}); } }
        }
      } else q.pushT = 0;
    }
  }

  // ---------------- debris: rendered chunks that tumble through 8 orientations, bounce, settle, blink out ----------------
  const flying = [];
  let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function burst(x, y, z, kind, n, dir = [0, 0], sp = 2.6) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, s = sp * (.4 + rnd() * .8);
      flying.push({kind, x: x + (rnd() - .5) * .3, y: y + (rnd() - .5) * .2, z, h: .2 + rnd() * .5, vx: Math.sin(a) * s + dir[0], vy: Math.cos(a) * s * .8 + dir[1],
        vh: 2.5 + rnd() * 3, rot: rnd() * 8, spin: (rnd() < .5 ? -1 : 1) * (8 + rnd() * 10), t: 0, life: 3 + rnd() * 2, rest: false});
    }
    if (flying.length > 80) flying.splice(0, flying.length - 80);
  }

  R.update = (dt, evs = []) => {
    simT += dt;
    for (const e of evs) {
      if (e.type === 'break' && DEBRIS[e.kind]) { const [k, n] = DEBRIS[e.kind]; if (n) burst(e.x, e.y, host.elev(e.x, e.y), k, n); }
      if (e.type === 'explode') {
        const reach = (e.r || 2.2) * 1.8;
        for (const q of mov) {
          if (q.broken || q.gone || q.sink) continue;
          const dx = q.x - e.x, dy = q.y - e.y, d = Math.hypot(dx, dy); if (d > reach || d < .05) continue;
          const v = T.blast * (1 - d / reach) + 1; shove(q, dx / d * v, dy / d * v);
          if (q.kind === 'crate') { q.h = .001; q.vh = 3 * (1 - d / reach); }
        }
        burst(e.x, e.y, host.elev(e.x, e.y), 'iron', 2, [0, 0], 4);
      }
      if (e.type === 'hit' && e.prop && (e.prop.kind === 'barrel') && !e.prop.tip && !e.prop.broken) {   // arrows knock wooden barrels over
        const l = Math.hypot(e.vx, e.vy) || 1; tip(e.prop, e.vx / l, e.vy / l, T.arrowTip);
      } else if (e.type === 'hit' && e.prop?.tip && speedOf(e.prop) < 1.5) {   // and give lying ones a nudge
        const l = Math.hypot(e.vx, e.vy) || 1; e.prop.vx += e.vx / l * T.arrowTip; e.prop.vy += e.vy / l * T.arrowTip; setAxis(e.prop);
      }
    }
    contact(dt);
    for (const q of mov) step(q, dt);
    for (const q of mov) if (!q.broken && !q.gone && q.idle > T.idleReset && Math.hypot(P.x - q.x, P.y - q.y) > T.resetAway && Math.hypot(P.x - q.home3[0], P.y - q.home3[1]) > T.resetAway) resetHome(q);
    for (const c of chests) { const want = c.opened ? 1 : 0; c.lid = c.lid ?? 0; c.lid += Math.sign(want - c.lid) * Math.min(Math.abs(want - c.lid), dt * (want ? 3.2 : 2)); }
    for (let i = flying.length - 1; i >= 0; i--) {
      const c = flying[i]; c.t += dt;
      if (c.t > c.life) { flying.splice(i, 1); continue; }
      if (c.rest) continue;
      c.vh -= 16 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.h += c.vh * dt; c.rot += c.spin * dt;
      if (c.h <= 0) {
        c.h = 0;
        if (host.inStream(c.x, c.y) && !c.z) { flying.splice(i, 1); continue; }
        if (Math.abs(c.vh) < 1.6) { c.rest = true; c.vh = 0; c.rot = Math.round(c.rot); continue; }
        c.vh *= -.35; c.vx *= .55; c.vy *= .55; c.spin *= .5;
      }
    }
    const pv = [P.vx, P.vy]; lastPS = Math.hypot(...pv); lastPV = pv;
  };

  R.drawWorld = (g, cam, lighting, biomeId) => {
    if (!R.on) return;
    const at = AT[biomeId] || AT.ruins;
    for (const c of flying) {
      if (c.rest && c.t > c.life - .8 && Math.floor(c.t * 10) % 2) continue;   // blink out
      const k = ((Math.floor(c.rot) % 8) + 8) % 8, name = `chunk_${c.kind}_${k}`, f = J.frames[name]; if (!f) continue;
      const [gx, gy] = ctx.toS(c.x, c.y, c.z + c.h), [, fy] = ctx.toS(c.x, c.y, c.z);
      const sx = Math.round(gx - cam.x), sy = Math.round(gy - cam.y);
      if (c.h > .05) { g.fillStyle = 'rgba(12,14,10,.3)'; g.fillRect(sx - 1, Math.round(fy - cam.y), 3, 1); }
      const a = slice(at, name, biomeId + ':' + name), n = slice(NRM, name, 'n:' + name);
      lighting.drawSprite(g, a, n, 0, 0, a.width, a.height, sx - f[4], sy - f[5], {x: c.x, y: c.y, z: c.z + c.h, prop: true});
    }
  };
  R.shove = shove;   // (q, vx, vy): tests / sheets
  R.dbg = {flying, mov, frameName, hitAt};
  if (typeof window !== 'undefined') window.__props3d = R;
  return R;
}
