// THE THUNDERSTORM (an omen: features/omens.js runs it). The weather is the world clock's storm (sim/env.js; in the frost
// lands a blizzard: thundersnow), wind and rain with it; its lightning becomes a rule:
//   SIM   every few s (TUNE.storm.every, quicker by stage) a bolt is called down on where you stand. A ring MARKS it for
//         TUNE.storm.tele s (the inner ring is exactly what it hurts), then it strikes: damage to every enemy and prop in the
//         ring (more at its heart), a stun (combat's root), wood set alight (lights.js ignite: a powder keg cooks off), and
//         you, unless you roll through it or are already out: a burn and a knock outward. IRON draws the bolt: the mark jumps
//         to the nearest rod within reach of it: an arrow stuck in the ground (TUNE.storm.rod), an enemy you just hit (lead,
//         for TUNE.storm.lead s), a tall or iron prop (ROD, a shorter reach). So you can lure it: plant arrows by them, stay
//         near (not on) the rod. From stage 3 a bolt may bring a second one down on an enemy (TUNE.storm.wild).
//   VIEW  the ring: a dashed ring closing in on the inner one, whitening, the ground crackling, a cold light growing, the
//         rod sparking and a leader reaching up from it; the bolt: an emissive zig-zag with forks and return strokes, an HD
//         glow, the scene's flash (weather.js F.flash), thunder on top of you (features/rainaudio.js), sparks, a shock ring,
//         a scorched star on the ground that fades.
// OWNS: the marks (pending bolts), the lead list, its sim clock, the struck list the view reads; its view pools (bolts,
//   sparks, scorches: preallocated, capped). READS: host.player / arrows / entities (near) / elev / yaw, combat's core
//   (damage, root, immune, enemies), lights (ignite), weather (flash), audio (thunder). EMITS: omen.strike, player.hit,
//   player.hurt (by 'lightning'). BUDGET: sim ~.01 ms a step; view + frame ~.05 ms with a bolt in the air.
import {TUNE as ALL} from '../../content/omens.js';
import {viewRandom} from '../../core/rng.js';
import {clamp, smooth, hypot2} from '../../core/mathx.js';
import {TAU, C} from './kit.js';

const T = ALL.storm;
// what draws a bolt: m above the prop's foot where it ends (tall things, iron); a shorter reach than your iron (ROD_REACH)
const ROD = {tree: 4.2, tower: 3.9, pillar: 2.6, pillar_broken: 1.6, gatepost: 2.85, brazier: 1.2, torch: 1.7, beacon: 1.6, barrel_x: .9,
  windmill: 5, water_tower: 4.4, signpost: 2, ore_cart: .9, stock_tank: .8};
const ROD_REACH = 3;
const BURN = {crate: 1, barrel: 1, barrel_x: 1, dummy: 1};   // what a bolt sets alight (lights.js BURNS)
const COL = {ring: [C('#6a96f8'), C('#b8d8ff'), C('#ffffff')], inner: C('#6a8cf0'), fill: [C('#4a6ad8'), C('#8ab0ff')], hot: C('#e8f4ff'), crack: C('#bfe2ff'),
  bolt: C('#f4f8ff'), fork: C('#b8c8ff'), glow: C('#7a9cff'), core: C('#dfeaff'), spark: [C('#ffffff'), C('#cfe6ff'), C('#7aa8f0'), C('#4a6ab8')],
  scorch: [C('#17110e'), C('#241b15'), C('#33281f')], ember: C('#ff9a40')};
const NM = 6, NB = 4, NS = 280, NSC = 6, SCN = 56, BOLT_LIFE = .34;

export function createStorm(host, K) {
  const V = viewRandom('omens.storm'), vr = (a, b) => a + V() * (b - a);
  const near = [];
  // ---------------------------------------------------------------- sim
  const marks = Array.from({length: NM}, () => ({on: false, x: 0, y: 0, h: 0, r: 0, t: 0, tele: 1, rod: '', id: 0}));
  const lead = [];   // {p, until}: enemies you just hit (an arrow head or a slug in them: iron)
  const struck = Array.from({length: 8}, () => ({id: 0, x: 0, y: 0, h: 0, r: 0, rod: '', lit: false, hitYou: false}));
  let simT = 0, next = 0, nId = 0, sk = 0, nStrikes = 0;
  const rr = (a, b) => a + K.R() * (b - a);

  function markLead(p) {
    for (const L of lead) if (L.p === p) { L.until = simT + T.lead; return; }
    if (lead.length > 24) lead.shift();
    lead.push({p, until: simT + T.lead});
  }
  // a mark at (x, y): iron near it takes the bolt (the nearest rod, yours first: arrows and lead reach farther than props)
  function place(x, y) {
    const m = marks.find(q => !q.on); if (!m) return null;
    let bx = x, by = y, bh = host.elev(x, y), bd = T.rod, rod = '';
    for (const a of host.arrows) {
      if (!a.stuck || a.kind === 'bullet' || a.life < .6) continue;
      const d = hypot2(a.x - x, a.y - y); if (d < bd) { bd = d; bx = a.x; by = a.y; bh = a.h; rod = 'arrow'; }
    }
    for (const L of lead) {
      const p = L.p; if (simT > L.until || p.broken || p.dead) continue;
      const d = hypot2(p.x - x, p.y - y); if (d < bd) { bd = d; bx = p.x; by = p.y; bh = (p.z || 0) + 1.5; rod = 'lead'; }
    }
    if (!rod) {
      let pd = ROD_REACH;
      for (const p of host.entities.near(x, y, ROD_REACH, near)) {
        const top = ROD[p.kind]; if (!top || p.broken || p.gone) continue;
        const d = hypot2(p.x - x, p.y - y); if (d < pd) { pd = d; bx = p.x; by = p.y; bh = (p.z || 0) + top; rod = p.kind; }
      }
    }
    Object.assign(m, {on: true, x: bx, y: by, h: bh, r: T.r, t: 0, tele: T.tele, rod, id: ++nId});
    return m;
  }
  function call() {
    const P = host.player;
    place(P.x, P.y);
    const core = K.core();
    if (sk >= 2 && core && K.R() < T.wild) {   // a wild bolt on one of them
      const es = core.enemies; let n = 0;
      for (const b of es) if (hypot2(b.x - P.x, b.y - P.y) < 12) n++;
      if (n) { let i = Math.floor(K.R() * n); for (const b of es) if (hypot2(b.x - P.x, b.y - P.y) < 12 && i-- === 0) { place(b.x, b.y); break; } }
    }
  }
  function strike(m) {
    m.on = false; nStrikes++;
    const core = K.core(), lights = host.feature('lights'), P = host.player, g = host.elev(m.x, m.y);
    const dmg = T.dmg * (1 + T.dmgK * sk);
    let lit = false, hit = false;
    for (const p of host.entities.near(m.x, m.y, m.r + .6, near)) {
      if (p.broken || p.gone || Math.abs((p.z || 0) - g) > 1.5) continue;
      const d = hypot2(p.x - m.x, p.y - m.y); if (d > m.r + (p.hitR ?? .3)) continue;
      if (BURN[p.kind] && lights?.ignite) { lights.ignite(p); lit = true; }
      if (!core || !(p.hp > 0 || p.target)) continue;
      const l = d || 1;
      core.damage(p, dmg * (d < m.r * .5 ? 1 : .65), {quiet: true, dir: [(p.x - m.x) / l * 3, (p.y - m.y) / l * 3]});
      if (p.sparring && !p.broken) core.root(p, T.root);
      hit = true;
    }
    const dP = hypot2(P.x - m.x, P.y - m.y);
    const safe = P.untouchable || core?.immune?.() || P.state === 'climb' || Math.abs(P.z - g) > 1.2;
    let hitYou = false;
    if (dP < m.r + .2 && !safe) {
      const ux = dP > .05 ? (P.x - m.x) / dP : 0, uy = dP > .05 ? (P.y - m.y) / dP : 1;
      host.knock(ux * T.knock, uy * T.knock);
      host.events.push({type: 'player.hit', x: P.x, y: P.y, vx: ux * 5, vy: uy * 5, player: true});
      host.events.push({type: 'player.hurt', dmg: Math.round((T.hurt + T.hurtK * sk) * (dP < m.r * .5 ? 1 : .7)), by: 'lightning', x: P.x, y: P.y});
      hitYou = true;
    }
    host.shake(dP < 6 ? 5 : dP < 12 ? 3 : 1, dP < 6 ? .35 : .2);
    if (hit || hitYou) host.hitstop(.05);
    host.events.push({type: 'omen.strike', x: m.x, y: m.y, r: m.r, h: m.h, rod: m.rod});
    const s = struck[nId % struck.length]; nId++;
    Object.assign(s, {id: nId, x: m.x, y: m.y, h: m.h, r: m.r, rod: m.rod, lit, hitYou});
  }

  const S = {
    get marks() { return marks; }, get strikes() { return nStrikes; },
    begin(stage) { sk = stage; next = T.first; simT = 0; lead.length = 0; for (const m of marks) m.on = false; },
    end() { for (const m of marks) m.on = false; lead.length = 0; },
    update(dt, evs, fight) {
      simT += dt;
      for (const e of evs) if (e.type === 'arrow.hit' && e.prop && (e.prop.hunter || e.prop.sparring)) markLead(e.prop);
      for (let i = lead.length - 1; i >= 0; i--) if (simT > lead[i].until + 1) lead.splice(i, 1);
      if (fight && (next -= dt) <= 0) { next = rr(T.every[0], T.every[1]) * Math.max(.5, 1 - T.everyK * sk); call(); }
      for (const m of marks) if (m.on && (m.t += dt) >= m.tele) strike(m);
    },
    // ---------------------------------------------------------------- view
    view, frame, lights,
  };

  // the bolts in the air (a zig-zag from the sky + two forks), sparks, shock rings, scorches
  const bolts = Array.from({length: NB}, () => ({t: -1, x: 0, y: 0, h: 0, n: 0, pts: new Float32Array(3 * 16), fn: 0, fk: new Float32Array(3 * 12), lit: false}));
  const sX = new Float32Array(NS), sY = new Float32Array(NS), sH = new Float32Array(NS), sVX = new Float32Array(NS), sVY = new Float32Array(NS),
    sVH = new Float32Array(NS), sT = new Float32Array(NS), sL = new Float32Array(NS);
  let sn = 0;
  const scorch = Array.from({length: NSC}, () => ({t: -1, x: 0, y: 0, d: new Float32Array(SCN * 3)}));
  let seen = 0, T0 = 0, light = {x: 0, y: 0, h: 0, k: 0, burn: 0};
  function spark(x, y, h, sp, up) {
    if (sn >= NS) return;
    const a = V() * TAU, v = vr(.3, 1) * sp, i = sn++;
    sX[i] = x; sY[i] = y; sH[i] = h; sVX[i] = Math.cos(a) * v; sVY[i] = Math.sin(a) * v * .8; sVH[i] = vr(.5, 1) * up; sT[i] = 0; sL[i] = vr(.25, .6);
  }
  function boltAt(s) {
    const b = bolts.find(q => q.t < 0) || bolts[0], g = host.elev(s.x, s.y);
    b.t = 0; b.x = s.x; b.y = s.y; b.h = s.h; b.lit = s.lit;
    const n = 13, top = g + 17; let x = s.x + vr(-2, 2), y = s.y + vr(-1.2, 1.2);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1); if (i === n - 1) { x = s.x; y = s.y; }
      b.pts[i * 3] = x; b.pts[i * 3 + 1] = y; b.pts[i * 3 + 2] = s.h + (top - s.h) * (1 - f) ** 1.15;
      x += vr(-.55, .55) + (s.x - x) * .18; y += vr(-.35, .35) + (s.y - y) * .18;
    }
    b.n = n; b.fn = 0;
    for (let f = 0; f < 2; f++) {   // two forks off the upper half, down and outward
      const j = 2 + (V() * 5 | 0), dx = vr(-1, 1), dy = vr(-.6, .6);
      let fx = b.pts[j * 3], fy = b.pts[j * 3 + 1], fh = b.pts[j * 3 + 2];
      for (let i = 0; i < 5 && b.fn < 12; i++) { b.fk[b.fn * 3] = fx; b.fk[b.fn * 3 + 1] = fy; b.fk[b.fn * 3 + 2] = fh; b.fn++; fx += dx * vr(.4, .9); fy += dy * vr(.4, .9); fh -= vr(.6, 1.4); }
      if (b.fn < 12) { b.fk[b.fn * 3] = NaN; b.fn++; }   // (a break between the forks)
    }
    for (let i = 0; i < 46; i++) spark(s.x, s.y, s.h + .1, vr(2, 7), vr(1.5, 5));
    const sc = scorch.find(q => q.t < 0) || scorch.reduce((a, q) => q.t > a.t ? q : a);
    sc.t = 0; sc.x = s.x; sc.y = s.y;
    for (let i = 0; i < SCN; i++) {   // a scorched star: rays of soot out from the strike, denser at the heart
      const ray = i % 7, a = ray / 7 * TAU + vr(-.25, .25), d = Math.sqrt(V()) * s.r * (i < 14 ? .45 : 1.05);
      sc.d[i * 3] = Math.sin(a) * d; sc.d[i * 3 + 1] = Math.cos(a) * d * .9; sc.d[i * 3 + 2] = V() * 3 | 0;
    }
    light.x = s.x; light.y = s.y; light.h = g + 1.6; light.k = 1; light.burn = s.lit ? 1 : 0;
    const P = host.player, d = hypot2(s.x - P.x, s.y - P.y), ax = K.axes();
    host.feature('weather')?.flash?.(clamp(1.05 - d / 40, .55, 1));
    host.feature('audio')?.rainAudio?.thunder?.(d * 18, clamp(((s.x - P.x) * ax.x + (s.y - P.y) * ax.y) / 8, -.9, .9));
  }
  function view(dt) {
    T0 += dt;
    for (const s of struck) if (s.id > seen) { boltAt(s); }
    for (const s of struck) if (s.id > seen) seen = s.id;
    for (const b of bolts) if (b.t >= 0 && (b.t += dt) > BOLT_LIFE) b.t = -1;
    for (const q of scorch) if (q.t >= 0 && (q.t += dt) > 11) q.t = -1;
    light.k = Math.max(0, light.k - dt / .4); light.burn = Math.max(0, light.burn - dt / 2.5);
    for (let i = sn - 1; i >= 0; i--) {
      sT[i] += dt;
      if (sT[i] > sL[i]) { sn--; sX[i] = sX[sn]; sY[i] = sY[sn]; sH[i] = sH[sn]; sVX[i] = sVX[sn]; sVY[i] = sVY[sn]; sVH[i] = sVH[sn]; sT[i] = sT[sn]; sL[i] = sL[sn]; continue; }
      const k = Math.max(0, 1 - dt * 3); sVX[i] *= k; sVY[i] *= k;
      sX[i] += sVX[i] * dt; sY[i] += sVY[i] * dt; sVH[i] -= 9 * dt; sH[i] += sVH[i] * dt;
      const g = host.elev(sX[i], sY[i]); if (sH[i] < g) { sH[i] = g; sVH[i] *= -.35; }
    }
  }
  const GL = [0, 0, 0];
  function frame(t) {
    const G = host.G, ax = K.axes();
    // the marks: the inner ring is what it hurts; the dashed one closes on it as the bolt comes; the ground crackles
    for (const m of marks) {
      if (!m.on) continue;
      const k = m.t / m.tele, e = smooth(k), g = host.elev(m.x, m.y) + .03, hot = k > .8 && ((t * 14) | 0) % 2 === 0;
      K.ring(m.x, m.y, g, m.r, hot ? COL.hot : COL.inner, 0, 1, 1);
      for (let i = 0, n = 10 + (k * 50 | 0); i < n; i++) {   // the charged ground: a shimmer of points over all it will hurt
        const a = V() * TAU, d = Math.sqrt(V()) * m.r * .97;
        host.point(m.x + Math.sin(a) * d, m.y + Math.cos(a) * d, g, COL.fill[V() < k ? 1 : 0], K.E1);
      }
      K.ring(m.x, m.y, g, m.r * (2.05 - 1.05 * e), COL.ring[k < .45 ? 0 : k < .8 ? 1 : 2], t * 3 + m.id, 6, 4);
      for (let i = 0; i < 2 + (k * 4 | 0); i++) {   // the ground crackles inside it
        const a = V() * TAU, d = Math.sqrt(V()) * m.r * .95, x = m.x + Math.sin(a) * d, y = m.y + Math.cos(a) * d, gh = host.elev(x, y);
        host.line(x, y, gh + .02, x + vr(-.08, .08), y + vr(-.05, .05), gh + vr(.1, .25 + .35 * k), COL.crack, true);
      }
      if (m.rod) {   // the rod draws it: sparks at its top, then a leader reaching up
        for (let i = 0; i < 2; i++) host.point(m.x + vr(-.12, .12), m.y + vr(-.08, .08), m.h + vr(-.05, .2), COL.hot, K.E1);
        if (k > .7) { const up = (k - .7) / .3 * 3.5; host.line(m.x, m.y, m.h, m.x + vr(-.15, .15), m.y + vr(-.1, .1), m.h + up, COL.crack, true); }
      }
      if (G.fx) G.fx(m.x, g + .2, m.y, m.r * (.6 + .5 * e), COL.glow, .05 + .2 * e * e, 'add');
    }
    // the bolts: on for the first stroke, a gap, a return stroke, a gap, the last; forks with the first two
    for (const b of bolts) {
      if (b.t < 0) continue;
      const on = b.t < .09 || (b.t > .13 && b.t < .2) || (b.t > .25 && b.t < .3); if (!on) continue;
      const thick = b.t < .2 ? (b.t < .09 ? 2 : 1) : 0, dx = ax.x / K.PPM, dy = ax.y / K.PPM, P = b.pts;
      for (let i = 0; i + 1 < b.n; i++) {   // 1-3 px wide (the first stroke the widest), a pale core
        const a = i * 3, c = a + 3;
        host.line(P[a], P[a + 1], P[a + 2], P[c], P[c + 1], P[c + 2], COL.bolt, true);
        if (thick) host.line(P[a] + dx, P[a + 1] + dy, P[a + 2], P[c] + dx, P[c + 1] + dy, P[c + 2], COL.fork, true);
        if (thick > 1) host.line(P[a] - dx, P[a + 1] - dy, P[a + 2], P[c] - dx, P[c + 1] - dy, P[c + 2], COL.fork, true);
      }
      if (b.t < .2) for (let i = 0; i + 1 < b.fn; i++) {
        const a = i * 3, c = a + 3; if (b.fk[a] !== b.fk[a] || b.fk[c] !== b.fk[c]) continue;   // (NaN: between forks)
        host.line(b.fk[a], b.fk[a + 1], b.fk[a + 2], b.fk[c], b.fk[c + 1], b.fk[c + 2], COL.fork, true);
      }
      if (G.fx) {
        const k = 1 - b.t / BOLT_LIFE;
        for (let i = 0; i < b.n; i += 3) G.fx(P[i * 3], P[i * 3 + 2], P[i * 3 + 1], .9, COL.glow, .22 * k, 'add');
        GL[0] = COL.core[0]; GL[1] = COL.core[1]; GL[2] = COL.core[2];
        G.fx(b.x, b.h + .3, b.y, 2.6, GL, .7 * k, 'add');
      }
      if (b.t < .25) K.ring(b.x, b.y, host.elev(b.x, b.y) + .04, .3 + b.t / .25 * 2.1, COL.hot, 0, 3, 2);   // the shock ring
    }
    // sparks, scorches
    for (let i = 0; i < sn; i++) { const k = sT[i] / sL[i]; host.point(sX[i], sY[i], sH[i], COL.spark[Math.min(3, k * 4 | 0)], K.E1); }
    for (const q of scorch) {
      if (q.t < 0) continue;
      const n = Math.round(SCN * clamp(1.15 - q.t / 11, 0, 1)), g = host.elev(q.x, q.y) + .015;
      for (let i = 0; i < n; i++) host.point(q.x + q.d[i * 3], q.y + q.d[i * 3 + 1], g, COL.scorch[q.d[i * 3 + 2]], K.P1);
      if (q.t < 3) for (let i = 0; i < 4; i++) if (V() < .5) { const j = (V() * 14) | 0; host.point(q.x + q.d[j * 3], q.y + q.d[j * 3 + 1], g + .01, COL.ember, K.E1); }
    }
  }
  // the marks' cold light, the bolt's, the fire it leaves
  const LR = Array.from({length: NM + 2}, (_, i) => ({x: 0, y: 0, h: 0, color: '#9ac0ff', radius: 0, intensity: 0, flicker: 0, id: 9750 + i}));
  function lights(out) {
    let n = 0;
    for (const m of marks) {
      if (!m.on) continue;
      const k = m.t / m.tele, L = LR[n++];
      L.x = m.x; L.y = m.y; L.h = (m.rod ? m.h : host.elev(m.x, m.y)) + .4; L.color = '#9ac0ff'; L.radius = 1.6 + 2.2 * k; L.intensity = .4 + 1.3 * k * k; L.flicker = .4;
      out.push(L);
    }
    if (light.k > 0) { const L = LR[n++]; L.x = light.x; L.y = light.y; L.h = light.h; L.color = '#dce6ff'; L.radius = 11; L.intensity = 3.6 * light.k ** 1.5; L.flicker = 0; out.push(L); }
    if (light.burn > 0) { const L = LR[n++]; L.x = light.x; L.y = light.y; L.h = light.h - 1.2; L.color = '#ff9a48'; L.radius = 3.2; L.intensity = 1.1 * light.burn; L.flicker = .6; out.push(L); }
  }
  return S;
}
