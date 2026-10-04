// CANIDS AT NIGHT (a part of wildlife's fight reactions, features/wildlife/fightlife.js; SHOW ONLY, a view): a coyote pack
// in the desert, a fox in the ruins, wolves in the frost. They come in from off the screen after dark and SKULK at the edge
// of the view (a ring at `edge` of the view's half size round its middle, so they hang about the edge of what you see
// whatever the zoom and the yaw): trot to a spot on it, stand and watch you (their eyes catch the firelight: the look
// frame's eyeshine, brighter near a fire or close to you), sit, sniff, trot on; the pack drifts round you slowly. Now and
// then one sits and howls and the others answer with yips (wildlife.howl: the audio feature's). You coming at them, they
// trot off to keep their distance (`keep` m), and bolt if you're close (`bolt` m); a shot within `shot` m scatters them
// at a gallop off the screen; they come back after `away` s if it's quiet. A kill at night (scavengers.js's sites) draws
// them once it's calm and you're `clear` m off: one or two tug at the body, the others watch. At dawn they leave.
// OWNS: the pack and its members (preallocated). READS: the fight (the last bang), the kill sites, wildlife's K (the view,
// the ground, the threat), the fires (a live registry query: eyeshine).
import {hypot2} from '../../core/mathx.js';

const TAU = Math.PI * 2;
export const TUNE = {
  edge: [.78, .95],     // the ring: this share of the view's half width / height from its middle
  near: 7,              // m: never closer to you than this on the ring
  apart: 1.8,           // m: members keep this far apart on the ring
  keep: 6.5,            // m: you closer, it trots away
  bolt: 4,              // m: you closer, it runs
  shot: 30,             // m: a bang closer scatters the pack
  away: [10, 22],       // s gone after a scatter
  arrive: [4, 14],      // s after dark until the first comes in (then the others, one by one)
  trot: 1.5, run: 6,    // m/s
  rest: [1.5, 5],       // s standing / watching / sitting between moves
  chorus: [22, 55],     // s between howls (the pack's)
  clear: 10,            // m: you farther from a carcass, they go to it
  calm: 8,              // s without a bang before they go to a carcass
  glow: {fire: 12, you: 14},   // m: eyeshine bright within this of a fire / of you (the renderer adds an emitter back where the
                               // light is low: the eyes shine in the dark at the edge of the light, hardly in it)
  shy: 2.6,             // m: they keep this far from a burning fire (at the edge of its light, not in it)
};
const PACK = {desert: {sp: 'coyote', n: [3, 4]}, ruins: {sp: 'fox', n: [1, 1]}, frost: {sp: 'wolf', n: [2, 3]}};
const FIRE = {brazier: 1, torch: 1, campfire: 1, beacon: 1};

export function createCanids(C) {
  const {K, host, R, rr, fight} = C;
  const Cn = {};
  let def = null, sp = null, mode = 'none', modeT = 0, packA = 0, packN = 0, chorusT = 0, backT = 0, siteRef = null;
  const NM = 4, M = [];
  for (let i = 0; i < NM; i++) M.push({on: false, x: 0, y: 0, z: 0, fx: 1, fy: 0, sf: 1, st: 'off', at: 0, tx: 0, ty: 0, spd: 0, ph: 0, ang: 0, eye: 0, call: 0, wait: 0, tug: false, id: i});
  const fires = host.entities.query('wildlife.fight.fires', p => !!FIRE[p.kind]);   // (a live query: the light props)

  Cn.reset = () => {
    def = PACK[K.biome] || null; sp = def ? def.sp : null; mode = 'none'; siteRef = null;
    for (const m of M) { m.on = false; m.st = 'off'; }
    if (C.on) Cn.applyTime();
  };
  // night begins (or the biome is new at night): the pack is due; day: they go
  Cn.applyTime = () => {
    if (!def || !C.SPR2[sp]) return;
    if (K.time === 'night') {
      if (mode === 'none' || mode === 'leave') { mode = 'arrive'; modeT = rr(TUNE.arrive[0], TUNE.arrive[1]); packA = R() * TAU; chorusT = rr(8, 20); packN = def.n[0] + (R() * (def.n[1] - def.n[0] + 1) | 0); }
    } else if (mode !== 'none') { mode = 'leave'; for (const m of M) if (m.on) runOff(m, K.P ? K.P.x : m.x, K.P ? K.P.y : m.y); }
  };

  // ---------------------------------------------------------------- the ring at the edge of the view
  const PT = [0, 0];
  // a free spot at the view's edge near the angle t (view frame: 0 = screen right, PI/2 = screen bottom)
  function ringSpot(t, out, fx, fy) {
    const VB = K.VB, P = K.P;
    for (let i = 0; i < 10; i++) {
      const a = t + (i ? rr(-.6, .6) : 0), k = rr(TUNE.edge[0], TUNE.edge[1]);
      const vx = VB.cx + Math.cos(a) * VB.hw * k, vy = VB.cy + Math.sin(a) * VB.hh * k;
      const x = vx * K.RX + vy * K.FX, y = vx * K.RY + vy * K.FY, z = K.elev(x, y);
      if (P && hypot2(x - P.x, y - P.y) < TUNE.near) continue;
      if (P && Math.abs(z - (P.z || 0)) > .5) continue;   // (not up on the plateau / walls)
      if (!free(x, y, z)) continue;
      if (crowded(x, y) || byFire(x, y)) continue;
      if (fx !== undefined && !clearLine(fx, fy, x, y)) continue;
      out[0] = x; out[1] = y; return true;
    }
    return false;
  }
  // just off the screen near the angle t (where one comes in from / runs off to)
  function offSpot(t, out) {
    const VB = K.VB;
    for (let i = 0; i < 8; i++) {
      const a = t + (i ? rr(-.8, .8) : 0), k = 1.08 + R() * .3;
      const vx = VB.cx + Math.cos(a) * (VB.hw + 3) * k, vy = VB.cy + Math.sin(a) * (VB.hh + 3) * k;
      const x = vx * K.RX + vy * K.FX, y = vx * K.RY + vy * K.FY, wb = C.ctx.bounds;
      if (x < wb.x0 + 1 || y < wb.y0 + 1 || x > wb.x1 - 1 || y > wb.y1 - 1) continue;
      if (!free(x, y, K.elev(x, y))) continue;
      out[0] = x; out[1] = y; return true;
    }
    return false;
  }
  const free = (x, y, z) => !K.solid(x, y, z) && !K.inStream(x, y);
  const byFire = (x, y) => { for (let j = 0; j < fires.length; j++) { const f = fires[j]; if (!f.gone && !f.broken && !f.unlit && Math.abs(f.x - x) < TUNE.shy && hypot2(f.x - x, f.y - y) < TUNE.shy) return true; } return false; };
  const count = () => { let n = 0; for (let i = 0; i < NM; i++) if (M[i].on) n++; return n; };
  const idle = () => { for (let i = 0; i < NM; i++) if (!M[i].on) return M[i]; return null; };
  // another member stands or is headed within `apart` m (a pack spreads out along the ring)
  function crowded(x, y) { for (let i = 0; i < NM; i++) { const o = M[i]; if (o.on && (hypot2(o.x - x, o.y - y) < TUNE.apart || (o.st === 'go' && hypot2(o.tx - x, o.ty - y) < TUNE.apart))) return true; } return false; }
  // a straight way on the ground at one level (samples every .5 m): a trot doesn't go through walls, props or the water
  function clearLine(x0, y0, x1, y1) {
    const d = hypot2(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / .5)), z0 = K.elev(x0, y0);
    for (let i = 1; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n, z = K.elev(x, y); if (Math.abs(z - z0) > .4 || !free(x, y, z)) return false; }
    return true;
  }
  // the view-frame angle of a world point from the view's middle
  const viewAng = (x, y) => { const VB = K.VB, vx = x * K.RX + y * K.RY - VB.cx, vy = x * K.FX + y * K.FY - VB.cy; return Math.atan2(vy / VB.hh, vx / VB.hw); };
  const face = (m, dx, dy) => { const l = hypot2(dx, dy); if (l > 1e-6) { m.fx = dx / l; m.fy = dy / l; } };

  function goTo(m, x, y, spd, st) { m.tx = x; m.ty = y; m.spd = spd; m.st = st; face(m, x - m.x, y - m.y); }
  function runOff(m, sx, sy) {   // gallop off the screen, away from (sx, sy)
    const a = Math.atan2(m.y - sy, m.x - sx), VB = K.VB, vx = Math.cos(a) * K.RX + Math.sin(a) * K.RY, vy = Math.cos(a) * K.FX + Math.sin(a) * K.FY;
    const t = Math.atan2(vy * VB.hw / VB.hh, vx);
    let ok = false; for (let i = 0; i < 5 && !ok; i++) ok = offSpot(t + (i ? rr(-1, 1) : 0), PT) && clearLine(m.x, m.y, PT[0], PT[1]);
    if (!ok && !offSpot(t, PT)) { PT[0] = m.x + Math.cos(a) * 20; PT[1] = m.y + Math.sin(a) * 20; }
    goTo(m, PT[0], PT[1], TUNE.run, 'run'); m.wait = 0;
  }
  const PT2 = [0, 0];
  function enter(m) {   // in from off the screen to a spot on the ring, on a clear way
    for (let i = 0; i < 14; i++) {
      const t = packA + rr(-.6, .6) * (1 + i * .25);
      if (!ringSpot(t, PT2) || !offSpot(t, PT) || !clearLine(PT[0], PT[1], PT2[0], PT2[1])) continue;
      m.on = true; m.x = PT[0]; m.y = PT[1]; m.z = K.elev(m.x, m.y); m.ph = R() * 3; m.sf = 0; m.eye = 0; m.tug = false;
      goTo(m, PT2[0], PT2[1], TUNE.trot * 1.3, 'go'); return true;
    }
    return false;
  }
  // a member's next act on the ring: watch you, sit, sniff, or trot to another spot
  function nextAct(m) {
    const r = R(), P = K.P;
    if (r < .3) { m.st = 'watch'; m.at = rr(TUNE.rest[0], TUNE.rest[1]); if (P) face(m, P.x - m.x, P.y - m.y); return; }
    if (r < .42) { m.st = 'sit'; m.at = rr(3, 7); return; }
    if (r < .52) { m.st = 'sniff'; m.at = rr(1, 2.5); return; }
    if (ringSpot(packA + rr(-.7, .7) + (m.id - 1.5) * .45, PT, m.x, m.y)) goTo(m, PT[0], PT[1], TUNE.trot * rr(.85, 1.15), 'go');
    else { m.st = 'watch'; m.at = rr(1, 2); }
  }
  function howl() {   // one sits and howls, the others answer
    let lead = null; for (const m of M) if (m.on && (m.st === 'sit' || m.st === 'watch') && K.near(m.x, m.y)) { lead = m; break; }
    if (!lead) for (const m of M) if (m.on && m.st !== 'run') { lead = m; break; }
    if (!lead) return;
    lead.st = 'howl'; lead.at = 2.6; call(lead, sp === 'fox' ? 'bark' : 'howl');
    for (const m of M) if (m.on && m !== lead && m.st !== 'run') { m.call = rr(.6, 1.6); }
  }
  // wildlife.howl (core/events.js): {x, y, kind, call: howl | yips | bark}; a ring of payloads, none made a call
  const EV = []; for (let i = 0; i < 6; i++) EV.push({type: 'wildlife.howl', x: 0, y: 0, kind: '', call: ''});
  let evi = 0, lastCall = -9;
  function call(m, c) {
    if (!host.events || K.T - lastCall < .35) return;
    const P = K.P; if (P && hypot2(m.x - P.x, m.y - P.y) > 40) return;
    lastCall = K.T;
    const e = EV[evi]; evi = (evi + 1) % EV.length; e.x = m.x; e.y = m.y; e.kind = sp; e.call = c; host.events.push(e);
  }

  // ---------------------------------------------------------------- the step
  function bang(m) { return fight.shotT === 0 && hypot2(fight.shotX - m.x, fight.shotY - m.y) < TUNE.shot; }
  function carcass() {   // a kill site they may go to: calm, you away
    if (fight.shotT < TUNE.calm || fight.level >= C.TUNE.fight.low) return null;
    const P = K.P;
    const S = C.scav().sites; for (let i = 0; i < S.length; i++) { const s = S[i]; if (s.on && (!P || hypot2(P.x - s.x, P.y - s.y) > TUNE.clear)) return s; }
    return null;
  }
  function stepMember(m, dt, P) {
    m.z = K.elev(m.x, m.y);
    if (m.call > 0 && (m.call -= dt) <= 0) { if (m.st !== 'run' && m.st !== 'go') { m.st = 'howl'; m.at = 1.6; } call(m, sp === 'wolf' ? 'howl' : sp === 'fox' ? 'bark' : 'yips'); }
    const dP = P ? hypot2(P.x - m.x, P.y - m.y) : 99;
    if (m.st !== 'run') {
      if (bang(m)) { scatter(fight.shotX, fight.shotY); return; }
      if (P && dP < TUNE.bolt) { runOff(m, P.x, P.y); return; }
      if (P && dP < TUNE.keep && m.st !== 'go') {   // edge away from you along the ring
        if (ringSpot(viewAng(m.x, m.y) + (R() < .5 ? .5 : -.5), PT, m.x, m.y) && hypot2(PT[0] - P.x, PT[1] - P.y) > dP) goTo(m, PT[0], PT[1], TUNE.trot * 1.4, 'go');
        else runOff(m, P.x, P.y);
      }
    }
    if (m.st === 'go' || m.st === 'run') {
      const dx = m.tx - m.x, dy = m.ty - m.y, d = hypot2(dx, dy), st = m.spd * dt;
      m.ph += dt * m.spd * (m.st === 'run' ? 1.6 : 2.4);
      if (d <= st) {
        m.x = m.tx; m.y = m.ty;
        if (m.st === 'run') { m.on = mode !== 'leave' && mode !== 'away' && K.near(m.x, m.y); if (m.on) { m.st = 'watch'; m.at = 1; } return; }
        if (m.tug) { m.st = 'tug'; m.at = rr(2, 5); const s = siteRef; if (s) face(m, s.x - m.x, s.y - m.y); return; }
        nextAct(m); return;
      }
      const x1 = m.x + dx / d * st, y1 = m.y + dy / d * st, z1 = K.elev(x1, y1);
      if (m.st !== 'run' && (!free(x1, y1, z1) || Math.abs(z1 - m.z) > .4)) { m.tug = false; m.st = 'watch'; m.at = rr(.3, .8); return; }   // blocked: stop, pick again
      m.x = x1; m.y = y1; face(m, dx, dy);
      if (m.st === 'run' && !K.near(m.x, m.y) && hypot2(m.x - (P ? P.x : m.x), m.y - (P ? P.y : m.y)) > 16) { m.on = false; }
      return;
    }
    if ((m.at -= dt) > 0) { if (m.st === 'watch' && P && R() < dt * .5) face(m, P.x - m.x, P.y - m.y); return; }
    if (m.st === 'tug') { m.st = 'sniff'; m.at = rr(.6, 1.6); m.tug = R() < .6; if (m.tug) { m.st = 'tug'; m.at = rr(1.5, 4); } return; }
    if (mode === 'scav' && siteRef) { stayAt(m); return; }
    nextAct(m);
  }
  function scatter(sx, sy) {
    mode = 'away'; modeT = rr(TUNE.away[0], TUNE.away[1]); siteRef = null;
    for (const m of M) if (m.on) { m.tug = false; runOff(m, sx, sy); }
    packA = Math.atan2(-(sy - (K.P ? K.P.y : sy)), -(sx - (K.P ? K.P.x : sx)));   // (they'll come back from the other side)
  }
  // at a carcass: one or two tug at it, the others stand off watching
  function stayAt(m) {
    const s = siteRef, a = R() * TAU, near = m.id < 2, d = near ? rr(.7, 1) : rr(1.8, 3);
    const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d * .8;
    if (free(x, y, K.elev(x, y)) && clearLine(m.x, m.y, x, y)) { m.tug = near; goTo(m, x, y, TUNE.trot, 'go'); }
    else { m.st = 'watch'; m.at = rr(1, 2); }
  }
  Cn.step = dt => {
    if (!def || !C.SPR2[sp] || mode === 'none') return;
    const P = K.P;
    modeT -= dt;
    if (mode === 'arrive' || mode === 'away') {
      if (modeT <= 0 && K.time === 'night' && fight.shotT > 5) {   // in, one by one
        const n = count();
        if (n < packN) { const m = idle(); if (m) enter(m); modeT = rr(1.5, 4); }
        else { mode = 'skulk'; modeT = 0; }
      }
    }
    if (mode === 'skulk' || mode === 'scav') {
      packA += dt * .02 * Math.sin(K.T * .05);
      if ((chorusT -= dt) <= 0) { chorusT = rr(TUNE.chorus[0], TUNE.chorus[1]); howl(); }
      const s = carcass();
      if (s && mode === 'skulk') { mode = 'scav'; siteRef = s; for (const m of M) if (m.on && m.st !== 'run') stayAt(m); }
      else if (mode === 'scav' && (!s || s !== siteRef)) { mode = 'skulk'; siteRef = null; for (const m of M) if (m.on) { m.tug = false; if (m.st === 'tug') nextAct(m); } }
    }
    let any = false;
    for (let i = 0; i < NM; i++) { const m = M[i]; if (!m.on) continue; stepMember(m, dt, P); any ||= m.on; }
    if (mode === 'leave' && !any) mode = 'none';
    // a member who ran off comes back in while the pack is about (not after a scatter: `away` brings them all back)
    if (mode === 'skulk' && fight.shotT > 6 && count() < packN && (backT += dt) > 8) { const m = idle(); if (m) enter(m); backT = 0; }
    // the eyeshine: a fire near, or you
    for (let i = 0; i < NM; i++) {
      const m = M[i];
      if (!m.on) continue;
      let g = 1;
      if (P && hypot2(P.x - m.x, P.y - m.y) < TUNE.glow.you) g = 2;
      else for (let j = 0; j < fires.length; j++) { const f = fires[j]; if (!f.gone && !f.broken && !f.unlit && Math.abs(f.x - m.x) < TUNE.glow.fire && hypot2(f.x - m.x, f.y - m.y) < TUNE.glow.fire) { g = 2; break; } }
      m.eye = K.time === 'night' ? g : 0;
    }
  };

  // ---------------------------------------------------------------- drawing
  const TROT = ['trot0', 'trot1', 'trot2', 'trot1'], RUN = ['run0', 'run1'], LOOK = ['look', 'look_g1', 'look_g2'];
  const sface = m => { const v = m.fx * K.RX + m.fy * K.RY; if (Math.abs(v) > .2 || !m.sf) m.sf = v < 0 ? -1 : 1; return m.sf; };
  Cn.sprites = () => {
    if (!def || mode === 'none') return;
    const A = C.SPR2[sp]; if (!A) return;
    const T0 = K.T;
    for (let i = 0; i < NM; i++) {
      const m = M[i];
      if (!m.on || !K.onScreen(m.x, m.y, m.z, 1.2)) continue;
      let f;
      switch (m.st) {
        case 'go': f = TROT[(m.ph | 0) & 3]; break;
        case 'run': f = RUN[(m.ph | 0) & 1]; break;
        case 'watch': f = LOOK[m.eye]; break;
        case 'sit': f = 'sit'; break;
        case 'howl': f = 'howl'; break;
        case 'sniff': f = 'sniff'; break;
        case 'tug': f = ((T0 * 2.2 + m.id) | 0) & 1 ? 'tug' : 'sniff'; break;
        default: f = 'stand';
      }
      C.put2(A[f], m.x, m.y, m.z, sface(m));
    }
  };
  // a soft shadow under each (a band the length of the body; wildlife's ground tints)
  Cn.ground = () => {
    if (!def || mode === 'none') return;
    const z = K.ZM, SH = K.SHC;
    for (let i = 0; i < NM; i++) {
      const m = M[i];
      if (!m.on) continue;
      const v = K.gxy(m.x, m.y, m.z); if (!K.inV(v[0], v[1], 20)) continue;
      const sit = m.st === 'sit' || m.st === 'howl';
      K.bput(SH[1], v[0] - (sit ? 6 : 10) * z, v[1], (sit ? 12 : 20) * z, z);
      K.bput(SH[0], v[0] - (sit ? 4 : 8) * z, v[1], (sit ? 8 : 15) * z, z);
    }
  };
  Cn.dbg = () => ({sp, mode, modeT: +modeT.toFixed(1), members: M.filter(m => m.on).map(m => `${m.st}${m.tug ? '*' : ''} ${m.x.toFixed(1)},${m.y.toFixed(1)} e${m.eye}`)});
  Cn.members = M;
  return Cn;
}
