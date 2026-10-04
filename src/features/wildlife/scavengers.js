// SCAVENGERS (a part of wildlife's fight reactions, features/wildlife/fightlife.js; SHOW ONLY, a view): after a kill the
// carrion birds come. A kill makes a SITE where the body lies (a desert gunman's corpse is followed while it lies: its
// ragdoll is thrown; the body fades in ~10 s, the spot draws them `life` s). Birds come into view one after another from
// off the screen, circle the site (high while it's loud: a shot or the fight level keep them up), lower as it stays calm,
// and once it has been calm `calm` s and you are farther than `clear` m they land round the body, hop in and tug at it
// (a vulture mantles at one that comes too close). You coming within `flee` m, a shot within `shot` m or a noise
// (wildlife's threat) and they burst off, climb, circle high again and come back down when it's calm again. When the site
// expires they lift off and leave. By day and at dusk (at night the carrion birds roost: the canids take the carcass).
//   desert, ember   turkey vultures (fightart.js: 14 px standing, a 31 px span circling low; the ember's ashier)
//   ruins / frost   crows / ravens (wildlife.js's own sprites: a murder of them, quicker, lower, noisier)
//   rift            motes (wildlife.js's): a swarm drifts to the body and swirls over it, scattering from you
// Counts are capped (TUNE.scav: max birds, sites). OWNS: the sites and the birds (pools, preallocated).
// READS: the fight (fightlife.js), wildlife's K (threat, noise, view, sprites, shadows), the foes' corpses (look.corpses).
import {clamp, hypot2} from '../../core/mathx.js';

const TAU = Math.PI * 2;
export const TUNE = {
  life: 75,             // s a kill draws them
  sites: 3,             // at most this many kill sites (the oldest goes)
  merge: 4,             // m: a kill this close to a site adds to it
  arrive: [2, 5],       // s after a kill until the first comes into view; then one every `every` s
  every: [1.5, 4],
  remains: {in: .8, out: 2.5},   // s: the remains fade in (as the body fades) / out (as the site ends)
  from: [24, 30],       // m off the site where one appears (off the screen), coming in
  // per species: speed m/s; h [high, low] m; R [high, low] m (the circle); descend m/s; circle s (at least, before
  // landing); calm s (no bang near, the fight level under low); clear m (you farther from the body); flee m (you closer to
  // the bird); shot m (a bang closer); ring [near, far] m round the body on the ground; max birds; per site [lo, hi];
  // sens (wildlife's threat: the noise model)
  vulture: {speed: 5.2, h: [9, 4], R: [7.5, 3.6], descend: .8, circle: 5, calm: 6, clear: 9, flee: 5.5, shot: 26, ring: [.75, 1.4], max: 4, per: [2, 4], sens: .7},
  crow: {speed: 4.4, h: [6, 2.4], R: [4.5, 2.4], descend: .9, circle: 2.5, calm: 4, clear: 7, flee: 4, shot: 22, ring: [.55, 1.2], max: 5, per: [3, 5], sens: .9},
  raven: {speed: 4, h: [6.5, 2.8], R: [5, 2.8], descend: .8, circle: 3, calm: 5, clear: 8, flee: 4.5, shot: 24, ring: [.6, 1.3], max: 4, per: [2, 4], sens: .8},
  mote: {n: [6, 9], max: 12, speed: .9, orbit: [.3, 1.1], hs: [.25, 1.3], flee: 3, shot: 18},
};
const KIND = {desert: 'vulture', ember: 'vulture', ruins: 'crow', frost: 'raven', rift: 'mote'};
const SENS = {vulture: {id: 'vulture', sens: .7, shy: 4.5}, crow: {id: 'crow', sens: .9, shy: 3}, raven: {id: 'raven', sens: .8, shy: 3.2}};

export function createScavengers(C) {
  const {K, host, R, rr, fight} = C;
  const S = {};
  let kind = null, T = null;
  // the sites (a pool)
  const sites = [];
  // c: the gunman's corpse while it lies (foes/look.js), track: s left to find it; flesh: remains show once the body is gone (rem: their alpha)
  for (let i = 0; i < TUNE.sites; i++) sites.push({on: false, x: 0, y: 0, z: 0, kx: 0, ky: 0, t: 0, want: 0, has: 0, next: 0, c: null, track: 0, id: 0, flesh: false, rem: 0, seen: false});
  let siteId = 0;
  // the birds (a pool, the most any species has)
  const NB = 12, birds = [];
  for (let i = 0; i < NB; i++) birds.push({on: false, site: null, sid: 0, st: '', x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, a: 0, R: 0, dir: 1, fx: 1, fy: 0, sf: 1,
    act: '', at: 0, flap: 0, circ: 0, wait: 0, gx: 0, gy: 0, gz: 0, x0: 0, y0: 0, h0: 0, k: 0, dur: 0, ang: 0, hop: 0, hx0: 0, hy0: 0, hx1: 0, hy1: 0, ph: 0, rad: 0, hh: 0});
  let corpses = null;

  S.reset = () => {
    kind = KIND[K.biome] || null; T = kind ? TUNE[kind] : null;
    for (const s of sites) { s.on = false; s.c = null; }
    for (const b of birds) { b.on = false; b.site = null; }
    corpses = null;
  };
  const corpseList = () => corpses ??= host.feature?.('foes')?.look?.corpses || [];
  // a kill (fightlife.js: enemy.kill, a sparring brute broken): a new site, or more for one nearby
  S.kill = (x, y, who) => {
    if (!kind || !(x === x)) return;
    let s = null;
    for (const q of sites) if (q.on && hypot2(q.x - x, q.y - y) < TUNE.merge) { s = q; break; }
    if (s) { s.t = Math.min(s.t, 2); s.want = Math.min(s.want + 1, T.max ?? T.n[1]); return; }
    for (const q of sites) if (!q.on) { s = q; break; }
    if (!s) { s = sites[0]; for (const q of sites) if (q.t > s.t) s = q; leave(s); }
    s.on = true; s.x = s.kx = x; s.y = s.ky = y; s.z = K.elev(x, y); s.t = 0; s.has = 0; s.id = ++siteId; s.c = null; s.track = who?.kind === 'gunman' ? 2 : 0;
    s.flesh = kind !== 'mote' && !!who && (who.kind === 'gunman' || !!who.hunter); s.rem = 0; s.seen = false;   // (a yard brute's broken body stays: no remains)
    s.want = kind === 'mote' ? Math.round(rr(T.n[0], T.n[1] + .99) - .49) : Math.round(rr(T.per[0], T.per[1] + .99) - .49);
    s.next = kind === 'mote' ? .3 : rr(TUNE.arrive[0], TUNE.arrive[1]);
  };
  // the freshest site (the high vultures drift over it)
  S.freshest = () => { let b = null; for (let i = 0; i < sites.length; i++) { const s = sites[i]; if (s.on && (!b || s.t < b.t)) b = s; } return b && K.time !== 'night' ? b : null; };
  S.sites = sites;
  function leave(s) { s.on = false; for (const b of birds) if (b.on && b.site === s) goOut(b); }

  // ---------------------------------------------------------------- the birds
  const night = () => K.time === 'night';
  const free = (x, y, z) => !K.solid(x, y, z) && !K.inStream(x, y);
  function spawn(s) {
    let b = null; for (const q of birds) if (!q.on) { b = q; break; }
    let n = 0; for (const q of birds) if (q.on) n++;
    if (!b || n >= (kind === 'mote' ? TUNE.mote.max : T.max)) return false;
    const a = R() * TAU, d = kind === 'mote' ? rr(7, 12) : rr(TUNE.from[0], TUNE.from[1]);
    b.on = true; b.site = s; b.sid = s.id; b.x = s.x + Math.cos(a) * d; b.y = s.y + Math.sin(a) * d * .8;
    b.ph = R() * TAU; b.flap = R(); b.sf = 0; b.wait = rr(0, 3); b.circ = 0; b.act = ''; b.at = 0;
    if (kind === 'mote') { b.st = 'in'; b.h = rr(1, 2.5); b.rad = rr(TUNE.mote.orbit[0], TUNE.mote.orbit[1]); b.hh = rr(TUNE.mote.hs[0], TUNE.mote.hs[1]); b.ang = R() * TAU; b.dir = R() < .5 ? -1 : 1; b.vx = b.vy = 0; return true; }
    b.st = 'in'; b.h = T.h[0] + rr(1, 3); b.R = T.R[0] + rr(-.5, 1); b.a = Math.atan2(b.y - s.y, b.x - s.x); b.dir = R() < .5 ? -1 : 1; b.vh = 0;
    return true;
  }
  function goOut(b) {
    if (kind === 'mote') { b.st = 'out'; return; }
    if (b.st === 'ground' && K.near(b.x, b.y)) K.emit('wings', b.x, b.y);
    b.st = 'out'; b.at = 0;
    const s = b.site, ax = b.x - (s ? s.x : b.x - 1), ay = b.y - (s ? s.y : b.y), d = hypot2(ax, ay) || 1;
    b.vx = ax / d * T.speed; b.vy = ay / d * T.speed * .8; b.vh = 1.8;
  }
  function flee(b, sx, sy) {   // burst off: away from (sx, sy), climbing hard
    const ax = b.x - sx, ay = b.y - sy, d = hypot2(ax, ay) || 1;
    if (kind === 'mote') { b.st = 'flee'; b.at = rr(1.2, 2); b.vx = ax / d * 3.5; b.vy = ay / d * 3; return; }
    const wasGround = b.st === 'ground';
    b.st = 'flee'; b.at = rr(1.5, 2.3); b.vx = ax / d * T.speed * 1.1 + rr(-.6, .6); b.vy = ay / d * T.speed * .9 + rr(-.6, .6); b.vh = rr(3, 4);
    face(b, b.vx, b.vy);
    if (wasGround) K.emit(kind === 'vulture' ? 'wings' : 'birds_scatter', b.x, b.y, kind === 'vulture' ? undefined : FLK);
  }
  const FLK = {n: 3};
  const face = (b, dx, dy) => { const l = hypot2(dx, dy); if (l > 1e-6) { b.fx = dx / l; b.fy = dy / l; } };
  // is it calm at the site: no bang near for `calm` s, the fight over, you away
  function calmAt(s) {
    const P = K.P;
    if (fight.level >= C.TUNE.fight.low) return false;
    if (fight.shotT < T.calm && hypot2(fight.shotX - s.x, fight.shotY - s.y) < 34) return false;
    return !P || hypot2(P.x - s.x, P.y - s.y) > T.clear;
  }
  // what startles a bird near the body: you close, a bang this step, wildlife's noise model
  function scared(b) {
    const P = K.P;
    if (P && hypot2(P.x - b.x, P.y - b.y) < T.flee) { TH.x = P.x; TH.y = P.y; return true; }
    if (fight.shotT === 0 && hypot2(fight.shotX - b.x, fight.shotY - b.y) < T.shot) { TH.x = fight.shotX; TH.y = fight.shotY; return true; }
    if (K.near(b.x, b.y)) { const th = K.threat(b.x, b.y, b.h, SENS[kind]); if (th.t >= 1) { TH.x = th.x; TH.y = th.y; return true; } }
    return false;
  }
  const TH = {x: 0, y: 0};
  // a ground spot round the body, free, its own angle
  function groundSpot(b, s) {
    for (let i = 0; i < 10; i++) {
      const a = R() * TAU, d = rr(T.ring[0], T.ring[1]), x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d * .8, z = K.elev(x, y);
      if (Math.abs(z - s.z) < .3 && free(x, y, z)) { b.gx = x; b.gy = y; b.gz = z; return true; }
    }
    return false;
  }
  function stepBird(b, dt) {
    const s = b.site;
    if (kind === 'mote') return stepMote(b, s, dt);
    b.flap = (b.flap + dt * (kind === 'vulture' ? 1.6 : 6)) % 1;
    if (b.st === 'in' || b.st === 'circle') {
      const calm = calmAt(s), Rt = calm ? T.R[1] : T.R[0], ht = calm ? T.h[1] : T.h[0];
      if (b.st === 'in') {   // come in to the circle's edge
        const tx = s.x + Math.cos(b.a) * b.R, ty = s.y + Math.sin(b.a) * b.R * .8, dx = tx - b.x, dy = ty - b.y, d = hypot2(dx, dy);
        const v = T.speed; b.vx = dx / (d || 1) * v; b.vy = dy / (d || 1) * v;
        b.x += b.vx * dt; b.y += b.vy * dt; b.h += clamp(ht - b.h, -T.descend * dt, T.descend * dt); face(b, b.vx, b.vy);
        if (d < .8) b.st = 'circle';
        return;
      }
      b.circ += dt;
      b.R += (Rt - b.R) * Math.min(1, dt * .25); b.h += clamp(ht - b.h, -T.descend * dt, T.descend * 2.5 * dt);
      b.a += b.dir * T.speed * .7 / b.R * dt;
      const x1 = s.x + Math.cos(b.a) * b.R, y1 = s.y + Math.sin(b.a) * b.R * .8;
      face(b, x1 - b.x, y1 - b.y); b.x = x1; b.y = y1;
      if (calm && b.circ > T.circle + b.wait && b.h < T.h[1] + .7 && s.t > 2 && groundSpot(b, s)) {   // down to the body
        b.st = 'down'; b.x0 = b.x; b.y0 = b.y; b.h0 = b.h; b.k = 0; b.dur = kind === 'vulture' ? rr(1.8, 2.4) : rr(.9, 1.3);
      }
      return;
    }
    if (b.st === 'down') {
      if (scared(b)) { flee(b, TH.x, TH.y); return; }
      b.k = Math.min(1, b.k + dt / b.dur);
      const k = b.k, e = 1 - (1 - k) * (1 - k);
      const x1 = b.x0 + (b.gx - b.x0) * e, y1 = b.y0 + (b.gy - b.y0) * e; face(b, x1 - b.x, y1 - b.y); b.x = x1; b.y = y1;
      b.h = b.gz + (b.h0 - b.gz) * (1 - k) * (1 - k);
      if (k >= 1) {
        b.st = 'ground'; b.h = b.gz; b.act = 'stand'; b.at = rr(.4, 1.2); face(b, s.x - b.x, s.y - b.y);
        if (K.near(b.x, b.y)) K.emit('wings', b.x, b.y);
      }
      return;
    }
    if (b.st === 'ground') {
      if (scared(b)) { flee(b, TH.x, TH.y); return; }
      if (b.hop > 0) {   // a hop under way
        b.hop = Math.max(0, b.hop - dt); const k = 1 - b.hop / b.dur;
        b.x = b.hx0 + (b.hx1 - b.hx0) * k; b.y = b.hy0 + (b.hy1 - b.hy0) * k; b.h = b.gz + Math.sin(k * Math.PI) * (kind === 'vulture' ? .22 : .08);
        return;
      }
      b.h = b.gz;
      if ((b.at -= dt) > 0) return;
      const dx = s.x - b.x, dy = s.y - b.y, d = hypot2(dx, dy), close = d < (kind === 'vulture' ? 1.05 : .8), r = R();
      if (!close && r < .65) {   // hop in toward the body
        const st = Math.min(d - .7, kind === 'vulture' ? .45 : .22), x1 = b.x + dx / (d || 1) * st, y1 = b.y + dy / (d || 1) * st;
        if (st > .05 && free(x1, y1, b.gz)) { b.hop = b.dur = kind === 'vulture' ? .38 : .2; b.hx0 = b.x; b.hy0 = b.y; b.hx1 = x1; b.hy1 = y1; b.act = 'hop'; face(b, dx, dy); b.at = b.dur + rr(.2, .6); return; }
      }
      if (close && r < .6) { b.act = 'tug'; b.at = rr(1.4, 3.5); face(b, dx, dy); return; }
      if (kind === 'vulture' && r < .75) {   // a mantle at a neighbour too close
        for (let i = 0; i < NB; i++) { const o = birds[i]; if (o !== b && o.on && o.st === 'ground' && hypot2(o.x - b.x, o.y - b.y) < .9) { b.act = 'mantle'; b.at = rr(.6, 1); face(b, o.x - b.x, o.y - b.y); return; } }
      }
      if (r < .85 && d > .5) {   // a step back from the body (a tug done)
        const x1 = b.x - dx / (d || 1) * .25, y1 = b.y - dy / (d || 1) * .25;
        if (free(x1, y1, b.gz)) { b.hop = b.dur = kind === 'vulture' ? .3 : .16; b.hx0 = b.x; b.hy0 = b.y; b.hx1 = x1; b.hy1 = y1; b.act = 'hop'; b.at = b.dur + rr(.3, .9); return; }
      }
      b.act = R() < .3 ? 'look' : 'stand'; if (b.act === 'look' || R() < .3) face(b, -b.fx, -b.fy * .3 + rr(-.3, .3)); else face(b, dx, dy);
      b.at = rr(.6, 2);
      if (kind !== 'vulture' && R() < .25) K.emit('caw', b.x, b.y);
      return;
    }
    if (b.st === 'flee') {
      b.at -= dt; b.vh = Math.max(.4, b.vh - dt * 2); b.vx *= Math.exp(-dt * .4); b.vy *= Math.exp(-dt * .4);
      b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt; face(b, b.vx, b.vy);
      if (b.at <= 0) {
        if (!s.on || b.sid !== s.id || night()) { goOut(b); return; }
        b.st = 'circle'; b.circ = 0; b.wait = rr(1, 4); b.R = Math.max(1.5, hypot2(b.x - s.x, (b.y - s.y) / .8)); b.a = Math.atan2((b.y - s.y) / .8, b.x - s.x); b.dir = R() < .5 ? -1 : 1;
      }
      return;
    }
    if (b.st === 'out') {
      b.at += dt; b.vh = Math.max(.5, b.vh - dt); b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt; face(b, b.vx, b.vy);
      if (b.at > 4 && !K.near(b.x, b.y)) b.on = false;
      if (b.at > 20) b.on = false;
    }
  }
  // the rift's motes: in to the body, swirling over it, scattering from you
  function stepMote(b, s, dt) {
    const M = TUNE.mote, P = K.P;
    if (b.st === 'out') { b.h += dt * .5; b.at += dt; if (b.at > 3) b.on = false; return; }
    if (b.st !== 'flee' && P && hypot2(P.x - b.x, P.y - b.y) < M.flee) flee(b, P.x, P.y);
    else if (b.st !== 'flee' && fight.shotT === 0 && hypot2(fight.shotX - b.x, fight.shotY - b.y) < M.shot) flee(b, fight.shotX, fight.shotY);
    if (b.st === 'flee') {
      b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= Math.exp(-dt * 1.2); b.vy *= Math.exp(-dt * 1.2); b.h = clamp(b.h + dt * .6, .3, 3);
      if ((b.at -= dt) <= 0) b.st = 'in';
      return;
    }
    b.ang += b.dir * dt * rr(.8, 1.4);
    const tx = s.x + Math.cos(b.ang) * b.rad, ty = s.y + Math.sin(b.ang) * b.rad * .8, th = s.z + b.hh + Math.sin(K.T * 1.7 + b.ph) * .15;
    const k = Math.min(1, dt * (b.st === 'in' ? .5 : 2.5));
    b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; b.h += (th - b.h) * k;
    if (b.st === 'in' && hypot2(tx - b.x, ty - b.y) < .4) b.st = 'circle';
  }

  S.step = dt => {
    if (!kind) return;
    // the sites: age, the body followed while it lies, new birds trickling in, expiry
    let any = false; for (let i = 0; i < sites.length; i++) any ||= sites[i].on;
    const cl = any ? corpseList() : null;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      if (!s.on) continue;
      s.t += dt;
      if (s.track > 0 && cl) {
        if (!s.c) for (let j = 0; j < cl.length; j++) { const c = cl[j]; if (c.on && c.fx === s.kx && c.fy === s.ky) { s.c = c; s.track = 0; break; } }
      }
      if (s.c) { if (s.c.on && s.c.fx === s.kx && s.c.fy === s.ky) { s.x = s.c.x; s.y = s.c.y; s.z = s.c.z; s.seen = true; } else s.c = null; }
      // the remains: in as the body fades (a corpse found and gone, or none to find), out at the end
      const RM = TUNE.remains, show = s.flesh && (s.c ? s.c.t >= s.c.fadeAt : s.track <= 0) && s.t < TUNE.life - RM.out;
      s.rem = clamp(s.rem + (show ? dt / RM.in : -dt / RM.out), 0, 1);
      if (s.track > 0 && !s.c) s.track -= dt;
      if (s.t > TUNE.life) { leave(s); continue; }
      if (night() && kind !== 'mote') continue;   // (the carrion birds roost; the canids take it)
      if (s.has < s.want && (s.next -= dt) <= 0) { if (spawn(s)) s.has++; s.next = kind === 'mote' ? rr(.2, .6) : rr(TUNE.every[0], TUNE.every[1]); }
    }
    for (let i = 0; i < NB; i++) {
      const b = birds[i];
      if (!b.on) continue;
      if (b.st !== 'out' && (!b.site || !b.site.on || b.site.id !== b.sid || (night() && kind !== 'mote'))) goOut(b);
      stepBird(b, dt);
    }
  };

  // ---------------------------------------------------------------- drawing
  const VFR = {stand: 'stand', look: 'stand', hop: 'hop', mantle: 'mantle'};
  const sface = b => { const v = b.fx * K.RX + b.fy * K.RY; if (Math.abs(v) > .25 || !b.sf) b.sf = v < 0 ? -1 : 1; return b.sf; };
  S.sprites = () => {
    if (!kind) return;
    const SP = K.SPR, T0 = K.T, RS = C.SPR2.remains;
    if (RS) for (let i = 0; i < sites.length; i++) { const s = sites[i]; if (s.on && s.rem > 0 && K.onScreen(s.x, s.y, s.z, .5)) C.put2(RS.heap, s.x, s.y, s.z, 1, s.rem); }
    for (let i = 0; i < NB; i++) {
      const b = birds[i];
      if (!b.on || !K.onScreen(b.x, b.y, b.h, 1.2)) continue;
      if (kind === 'mote') {
        const M = SP.mote; if (!M) continue;
        const k = Math.sin(T0 * 2.6 + b.ph * 5);
        const SP0 = K.SP0; SP0.x = b.x; SP0.y = b.y; SP0.h = b.h; K.put(M[k > .85 ? 'mb' : k > .3 ? 'm0' : k > -.4 ? 'm1' : 'm2'], 1);
        continue;
      }
      const fl = b.st !== 'ground';
      if (kind === 'vulture') {
        const V = C.SPR2.vulture; if (!V) continue;
        let f;
        if (fl) f = b.st === 'down' ? (b.k > .7 ? 'mantle' : 'glide') : b.st === 'flee' || (b.st === 'out' && b.at < 1.5) ? (((b.flap * 3) | 0) & 1 ? 'up' : 'down') : (Math.sin(T0 * .9 + b.ph) > .82 ? (((T0 * 3) | 0) & 1 ? 'up' : 'down') : 'glide');
        else f = b.act === 'tug' ? (((T0 * 2.6 + b.ph) | 0) & 1 ? 'tug2' : 'tug') : VFR[b.act] || 'stand';
        C.put2(V[f], b.x, b.y, b.h, sface(b));
      } else {
        const W = SP[kind]; if (!W) continue;
        let f;
        if (fl) { const i = (b.flap * 4) | 0; f = b.st === 'circle' && Math.sin(T0 * .8 + b.ph) > .2 ? 'mid' : i === 0 ? 'up' : i === 2 ? 'down' : 'mid'; }
        else f = b.act === 'tug' ? (((T0 * 3.4 + b.ph) | 0) & 1 ? 'peck' : 'stand') : b.act === 'hop' ? 'bob' : b.act === 'look' ? 'alert' : 'stand';
        const SP0 = K.SP0; SP0.x = b.x; SP0.y = b.y; SP0.h = b.h; K.put(W[f], sface(b));
      }
    }
  };
  // their shadows on the ground: a soaring one under a vulture in the air (wildlife's), a dot under a crow, a band under one standing
  S.ground = g => {
    if (!kind || kind === 'mote') return;
    const z = K.ZM, SH = K.SHC;
    for (let i = 0; i < NB; i++) {
      const b = birds[i];
      if (!b.on) continue;
      const gz = K.elev(b.x, b.y);
      if (b.st === 'ground') { const v = K.gxy(b.x, b.y, gz); if (K.inV(v[0], v[1], 6)) K.bput(SH[1], v[0] - (kind === 'vulture' ? 3 : 1) * z, v[1], (kind === 'vulture' ? 7 : 4) * z, z); continue; }
      if (kind !== 'vulture') { K.shadowAt(b.x, b.y, b.h - gz); continue; }
      if (b.h - gz > 12) continue;
      const sh = K.vultureShadow(K.vHeading(b)), v = K.gxy(b.x, b.y, K.gH(b.x, b.y)), w = sh.W * z, h = sh.H * z;
      if (v[0] > -w && v[1] > -h && v[0] < ctx().VW + w && v[1] < ctx().VH + h) g.drawImage(sh.c, v[0] - (w >> 1), v[1] - (h >> 1), w, h);
    }
  };
  const ctx = () => C.ctx;
  S.dbg = () => ({kind, sites: sites.filter(s => s.on).map(s => `${s.x.toFixed(1)},${s.y.toFixed(1)} t${s.t.toFixed(0)} ${s.has}/${s.want}${s.c ? ' body' : ''} rem${s.rem.toFixed(1)}`),
    birds: birds.filter(b => b.on).map(b => `${b.st}${b.act ? ':' + b.act : ''} h${b.h.toFixed(1)}`)});
  S.birds = birds;
  return S;
}
