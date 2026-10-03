// LASSO LOOK: the view of the equipment experiment's lasso (features/equip/lasso.js is the truth; sim/player/lasso.js the
// cowboy). Presentation only: it reads the sim's L and the player's lasso state, writes only its own (the rope's chain,
// the clocks), draws through host.line / host.point (world lines and points: depth-tested, right from any yaw and zoom).
//   the spin   a loop of hemp overhead (a ring tilted down toward where he faces, a little wobble), turning with his hand
//              (the spin clip's clock), grown over TUNE.spin.grow; a short spoke from his rope hand to the honda
//   the aim    what the throw goes for: an enemy (a dashed ring at its feet, a chevron over it), a prop (a ring), an anchor
//              (a ring round the point and a dotted drop to the ground), else where it lands (the loop's size on the
//              ground); out of reach dimmed
//   in flight  the loop opening as it flies, the rope paying out from the hand behind it: a light verlet chain (it sags
//              and swings; the sim decides nothing from it)
//   held       a tight ring round the body (or the prop) that follows it; the rope from the hand to its near side, straight
//              when taut, sagging when slack; a creak now and then while it strains
//   swinging   the rope from his upper grip to the anchor, the loop cinched round the limb
//   lying / coming back: the loop flat on the ground, dragged home
//   stunned    stars circling over whoever lies stunned after a yank
// EMITS (a view's, like foes/look.js's: nothing in the sim listens): lasso.swish (a turn of the loop overhead: audio),
//   lasso.creak (the rope strains: audio).
// OWNS: the chain (typed arrays), its clocks. READS: the sim (L), PL.lasso (S, hand), host.player, host.yaw, host.elev.
// BUDGET: view + frame ~.02-.05 ms (a 16-point chain, <= ~120 lines and a few points a frame).
import {TUNE, ROPE} from '../../content/lasso.js';
import {hex01} from '../../core/color.js';
import {clamp, hypot2, hypot3, TAU} from '../../core/mathx.js';

const CN = 16;   // the rope's chain points
const TWIST = [1, 0, 1, 2];   // the hemp's lay along the rope: mid, lit, mid, shade (it reads on bright sand and water)
const C3 = ROPE.map(hex01), GOLD = hex01('#ffe08a'), DIM = hex01('#a08a70'), STAR = hex01('#fff2a0'), RED = hex01('#e07050');

export function createLassoLook(host, lsim) {
  const L = lsim.L, P = host.player;
  const lz = () => host.PL.lasso;
  let T = 0, swishN = -1, creakT = 0, chainOn = false;
  const X = new Float32Array(CN), Y = new Float32Array(CN), H = new Float32Array(CN), PX = new Float32Array(CN), PY = new Float32Array(CN), PH = new Float32Array(CN);
  const HA = [0, 0, 0], HB = [0, 0, 0], E = [0, 0, 0];
  const SW = {type: 'lasso.swish', x: 0, y: 0}, CR = {type: 'lasso.creak', x: 0, y: 0, k: 0};

  // ---------------------------------------------------------------- the chain (verlet: view only)
  function chainReset(ax, ay, ah, bx, by, bh) {
    for (let i = 0; i < CN; i++) { const k = i / (CN - 1); X[i] = PX[i] = ax + (bx - ax) * k; Y[i] = PY[i] = ay + (by - ay) * k; H[i] = PH[i] = ah + (bh - ah) * k; }
    chainOn = true;
  }
  // a step: gravity, damping, the two ends pinned, segment lengths (rest = the ends' distance x (1 + slack)), the ground
  function chainStep(dt, ax, ay, ah, bx, by, bh, slack) {
    if (!chainOn) chainReset(ax, ay, ah, bx, by, bh);
    const d = hypot3(bx - ax, by - ay, bh - ah), seg = d * (1 + slack) / (CN - 1), g = 9.8 * dt * dt, damp = .9;
    for (let i = 1; i < CN - 1; i++) {
      const vx = (X[i] - PX[i]) * damp, vy = (Y[i] - PY[i]) * damp, vh = (H[i] - PH[i]) * damp;
      PX[i] = X[i]; PY[i] = Y[i]; PH[i] = H[i]; X[i] += vx; Y[i] += vy; H[i] += vh - g;
    }
    X[0] = ax; Y[0] = ay; H[0] = ah; X[CN - 1] = bx; Y[CN - 1] = by; H[CN - 1] = bh;
    for (let it = 0; it < 6; it++) {
      for (let i = 0; i < CN - 1; i++) {
        const dx = X[i + 1] - X[i], dy = Y[i + 1] - Y[i], dh = H[i + 1] - H[i], l = Math.sqrt(dx * dx + dy * dy + dh * dh) || 1e-6, e = (l - seg) / l * .5;
        const w0 = i === 0 ? 0 : 1, w1 = i + 1 === CN - 1 ? 0 : 1, s = w0 + w1; if (!s) continue;
        const k0 = e * 2 * w0 / s, k1 = e * 2 * w1 / s;
        X[i] += dx * k0; Y[i] += dy * k0; H[i] += dh * k0; X[i + 1] -= dx * k1; Y[i + 1] -= dy * k1; H[i + 1] -= dh * k1;
      }
      for (let i = 1; i < CN - 1; i++) { const g0 = host.elev(X[i], Y[i]) + .02; if (H[i] < g0) H[i] = g0; }
    }
  }
  // draw a polyline of hemp: alternate the tones every ~.12 m along it (the twist), the shade where it runs away from you
  function hemp(x0, y0, h0, x1, y1, h1, phase) {
    const l = hypot3(x1 - x0, y1 - y0, h1 - h0), n = Math.max(1, Math.round(l / .12));
    for (let k = 0; k < n; k++) {
      const a = k / n, b = (k + 1) / n;
      host.line(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, h0 + (h1 - h0) * a, x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, h0 + (h1 - h0) * b, C3[TWIST[(k + phase) & 3]], false);
    }
    return n;
  }
  function drawChain(ax, ay, ah, bx, by, bh) {   // the chain with its ends where they are drawn (the hand moves between steps)
    X[0] = ax; Y[0] = ay; H[0] = ah; X[CN - 1] = bx; Y[CN - 1] = by; H[CN - 1] = bh;
    let ph = 0;
    for (let i = 0; i < CN - 1; i++) ph += hemp(X[i], Y[i], H[i], X[i + 1], Y[i + 1], H[i + 1], ph);
  }

  // ---------------------------------------------------------------- rings in 3D
  // a ring of radius r round (x, y, h) in the plane spanned by u = (ux, uy, uh) and v = (vx, vy, vh) (unit, orthogonal);
  // n segments, the twist's phase turning with `rot`; the half toward the camera lit, the far half shaded
  function ring(x, y, h, r, ux, uy, uh, vx, vy, vh, n, rot, wob) {
    const tx = Math.sin(host.yaw), ty = Math.cos(host.yaw);
    let px = 0, py = 0, ph = 0;
    for (let i = 0; i <= n; i++) {
      const a = i / n * TAU, rr = r * (1 + wob * Math.sin(a * 3 + T * 7)), c = Math.cos(a + rot), s = Math.sin(a + rot);
      const qx = x + (ux * c + vx * s) * rr, qy = y + (uy * c + vy * s) * rr, qh = h + (uh * c + vh * s) * rr;
      if (i) {
        const near = ((qx + px) / 2 - x) * tx + ((qy + py) / 2 - y) * ty > 0;
        host.line(px, py, ph, qx, qy, qh, near ? C3[i & 1] : C3[1 + (i & 1)], false);
      }
      px = qx; py = qy; ph = qh;
    }
  }
  const flatRing = (x, y, h, r, n, rot, wob) => ring(x, y, h, r, 1, 0, 0, 0, 1, 0, n, rot, wob);
  // dashed marks on the ground / in the air (points: glowing, the aim's)
  function dashRing(x, y, h, r, col, n, crawl, a = 1) {
    const PO = POP; PO.size = host.zoom; PO.emit = true; PO.alpha = a;
    for (let j = 0; j < n; j++) { if ((j + crawl) % 3 === 0) continue; const ang = j / n * TAU; host.point(x + Math.cos(ang) * r, y + Math.sin(ang) * r, h, col, PO); }
  }
  const POP = {size: 1, emit: true, alpha: 1};

  // ---------------------------------------------------------------- per view step
  // a TUMBLEWEED (features/tumbleweed.js: a view, so the sim's loop never knows): a loop that lands by one snags it, and it
  // comes bouncing home with the loop as it's reeled in; let go at your feet
  let weed = null, weedF = null, lastPh = '';
  function weeds(ph) {
    weedF ??= host.feature('tumbleweed') || false;
    if (!weedF || !weedF.snag) return;
    if (lastPh === 'fly' && ph === 'lie' && !weed) weed = weedF.snag(L.loop.x, L.loop.y, TUNE.weed);
    if (weed) {
      if ((ph === 'lie' || ph === 'back') && weedF.tow(weed, L.loop.x, L.loop.y)) return;
      weedF.unsnag(weed, 1.4); weed = null;
    }
  }
  function view(dt) {
    T += dt;
    const Z = lz(); if (!Z) return;
    const ph = L.phase, S = Z.S;
    weeds(ph); lastPh = ph;
    // the swish: a turn of the loop overhead (by the spin clip's clock: in time with his hand)
    if (ph === 'spin' && Z.mode === 'spin') {
      const n = Math.floor(S.t * TUNE.spin.rps);
      if (n !== swishN && S.t > .05) { swishN = n; Z.hand(false, HA); SW.x = HA[0]; SW.y = HA[1]; host.events.push(SW); }
    } else swishN = -1;
    // the rope's chain: from the hand to the loop in flight / on the ground / at what it holds
    if (ph === 'fly' || ph === 'lie' || ph === 'back' || ph === 'hold' || ph === 'pull' || ph === 'hammer' || ph === 'yanked') {
      Z.hand(false, HA);
      const O = L.loop, slack = ph === 'fly' ? .06 : ph === 'hammer' ? .002 : ph === 'hold' ? (L.boss && !L.heave ? .16 : L.taut ? .004 : .14) : ph === 'yanked' ? .25 : .12;
      if (ph === 'fly' && O.t <= dt * 1.5 && !chainOn) chainReset(HA[0], HA[1], HA[2], O.x, O.y, O.h);
      ringNear(E);
      chainStep(dt, HA[0], HA[1], HA[2], E[0], E[1], E[2], slack);
      if (ph === 'hold' && L.taut) { creakT -= dt; if (creakT <= 0) { creakT = .55 + (T * 7.3 % 1) * .5; CR.x = O.x; CR.y = O.y; CR.k = L.boss ? 1 : .6; host.events.push(CR); } }
    } else chainOn = false;
  }
  // where the rope meets the loop: the loop's point nearest the hand (in flight: its trailing edge; held: the ring's near side)
  function ringNear(out) {
    const O = L.loop, dx = HA[0] - O.x, dy = HA[1] - O.y, d = hypot2(dx, dy) || 1, r = ringR();
    out[0] = O.x + dx / d * r; out[1] = O.y + dy / d * r; out[2] = O.h;
    return out;
  }
  function ringR() {
    const O = L.loop, p = L.who;
    if ((L.phase === 'hold' || L.phase === 'pull' || L.phase === 'hammer' || L.phase === 'yanked') && p) return L.kind === 'prop' ? (p.r || .3) * 1.05 + .03 : (p.hitR ?? .35) * .78;
    if (L.phase === 'fly') return O.r * (.6 + .4 * Math.min(1, O.t / (O.T * .5)));
    return O.r;
  }

  // ---------------------------------------------------------------- per rendered frame
  function frame() {
    const Z = lz(); if (!Z) return;
    const ph = L.phase, S = Z.S, z = host.zoom;
    // the stunned: stars circling over the head
    for (const s of L.stun) {
      const p = s.p; if (p.gone) continue; const top = (p.z || 0) + (p.h || 0) + (p.kind === 'gunman' ? .55 : (p.hitH ?? 1.6) + .1);
      for (let k = 0; k < 3; k++) { const a = T * 5 + k * TAU / 3; POP.size = z * (k === 0 ? 2 : 1); POP.emit = true; POP.alpha = 1; host.point(p.x + Math.cos(a) * .32, p.y + Math.sin(a) * .32, top + Math.sin(a * 2) * .05, STAR, POP); }
    }
    if (!ph) return;
    // the loop overhead (spinning, and through the throw until it leaves the hand): on the art's own hand circle when the
    // pose has its rope hand (spinCircle), else a ring turning over his head
    if ((ph === 'spin' || ph === 'wind') && artSpin(Z, ph)) { if (ph === 'spin') aimMark(); return; }
    if (ph === 'spin' || ph === 'wind') {
      const k = clamp(L.spinT / TUNE.spin.grow, .15, 1), r = TUNE.spin.r * k, f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f), tl = TUNE.spin.tilt;
      Z.hand(false, HA);
      const cx = P.x + fx * .06, cy = P.y + fy * .06, ch = Math.max(HA[2] + .06, P.z + 2.1 * k + 1.8 * (1 - k));
      // the plane: forward tilted down by `tilt`, and across
      const ux = fx * Math.cos(tl), uy = fy * Math.cos(tl), uh = -Math.sin(tl), vx = fy, vy = -fx;
      const rot = -S.t * TUNE.spin.rps * TAU + (ph === 'wind' ? S.t * 4 : 0);
      ring(cx, cy, ch, r, ux, uy, uh, vx, vy, 0, 22, rot, .05);
      // the spoke: the hand to the honda (the loop's point at its turn)
      const hx = cx + (ux * Math.cos(rot) + vx * Math.sin(rot)) * r, hy = cy + (uy * Math.cos(rot) + vy * Math.sin(rot)) * r, hh = ch + uh * Math.cos(rot) * r;
      hemp(HA[0], HA[1], HA[2], hx, hy, hh, 0);
      if (ph === 'spin') aimMark();
      return;
    }
    Z.hand(ph === 'swing', HA);
    const O = L.loop;
    if (ph === 'swing') {   // the rope to the anchor, the loop cinched round it
      const A = L.anchor; hemp(HA[0], HA[1], HA[2], A.x, A.y, A.h, 0);
      flatRing(A.x, A.y, A.h + .02, .13, 10, T * .3, 0); host.line(A.x, A.y, A.h, A.x + .05, A.y + .03, A.h - .22, C3[1], false);
      return;
    }
    // the loop: open in flight (facing its way), flat on the ground, a tight ring on what it holds
    if (ph === 'fly') {
      const vx = O.x - O.lx, vy = O.y - O.ly, l = hypot2(vx, vy) || 1, ux = vx / l, uy = vy / l;
      ring(O.x, O.y, O.h, ringR(), ux * .85, uy * .85, .5, -uy, ux, 0, 18, T * 6, .06);
    } else if (ph === 'lie' || ph === 'back') flatRing(O.x, O.y, Math.max(O.h, host.elev(O.x, O.y) + .03), O.r * (ph === 'back' ? .8 : 1), 18, 0, .08);
    else if ((ph === 'hold' || ph === 'pull' || ph === 'hammer' || ph === 'yanked') && L.who) {
      const p = L.who; flatRing(p.x, p.y, O.h, ringR(), 14, T * (L.taut ? 0 : .5), .03);
      // a champion's tug of war: its slack (the moment a yank lands) shows: the rope sags and a gold ring pulses at its feet
      if (ph === 'hold' && L.boss && !L.heave) dashRing(p.x, p.y, (p.z || 0) + .03, (p.hitR ?? .5) + .25 + .08 * Math.sin(T * 30), GOLD, 26, (T * 20) | 0, 1);
    }
    // the rope (the chain, its ends where they are drawn)
    if (chainOn) { ringNear(E); drawChain(HA[0], HA[1], HA[2], E[0], E[1], E[2]); }
  }
  // THE ART'S SPIN: in the spin clip and the walk / run spins the rope hand (RopeHand0) draws a circle round his head on
  // screen; per clip and facing its centre (the mean of its frames' markers) and its turning way are worked out once. A
  // frame's hand is then a point on that circle in the view frame (screen x: across; screen y at the circle's height:
  // toward / away from you), the loop a ring round the circle's centre a little above the hand, its honda trailing the hand
  // by `lag`: so the loop turns with his hand, from any yaw
  const CIRC = new Map();   // the atlas's SP -> {key: [per facing {cx, cy, dir} | null]}
  const SPINS = [['lasso_spin.', 6], ['lws_', 8], ['lrs_', 8]];
  function circleOf(Z, base, n, face, PPMr) {
    const A = Z.atlas; let byA = CIRC.get(A.SP); if (!byA) CIRC.set(A.SP, byA = {});
    const arr = byA[base] ??= new Array(A.ND).fill(undefined);
    if (arr[face] !== undefined) return arr[face];
    let sx = 0, sy = 0; const xs = [], ys = [];
    for (let i = 0; i < n; i++) { const m = Z.marker(base + i, face, false); if (!m) return (arr[face] = null); xs.push(m.x); ys.push(m.y); sx += m.x; sy += m.y; }
    const cx = sx / n, cy = sy / n; let turn = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = xs[i] - cx, ay = (ys[i] - cy) * PPMr, bx = xs[j] - cx, by = (ys[j] - cy) * PPMr; turn += ax * by - ay * bx; }
    return (arr[face] = {cx, cy, dir: turn >= 0 ? 1 : -1});
  }
  const SPN = {cx: 0, cy: 0, ch: 0, hx: 0, hy: 0, hh: 0};
  function artSpin(Z, ph) {
    const Pv = host.P, fr = Pv.frame, A = Z.atlas;
    let base = null, n = 0; for (const [b, k] of SPINS) if (fr.startsWith(b)) { base = b; n = k; break; }
    const th = ph === 'wind' ? fr.startsWith('lasso_throw.') : !!base; if (!th) return false;
    const PPM = host.PPM, PPMY = host.PPMY, PPMH = host.PPMH, m = Z.marker(fr, Pv.face, false); if (!m) return false;
    const a = host.yaw, ca = Math.cos(a), sa = Math.sin(a), W = (vx, vy, out, o) => { out[o] = vx * ca + vy * sa; out[o + 1] = -vx * sa + vy * ca; };
    const k = clamp(L.spinT / TUNE.spin.grow, .15, 1), r = TUNE.spin.r * k;
    if (ph === 'spin') {
      const c = circleOf(Z, base, n, Pv.face, PPM / PPMY); if (!c) return false;
      const hv = (m.y - c.cy) / PPMY, hz = Pv.z + (A.PIV[1] - c.cy) / PPMH;   // the hand: toward you by its screen y off the circle's centre
      W(Pv.x + (c.cx - A.PIV[0]) / PPM, Pv.y, E, 0); const cxw = E[0], cyw = E[1];
      W(Pv.x + (m.x - A.PIV[0]) / PPM, Pv.y + hv, E, 0); const hxw = E[0], hyw = E[1];
      // the honda: on the ring, the way the hand is from the centre, trailing it by `lag`
      const ang = Math.atan2(hyw - cyw, hxw - cxw) - c.dir * TUNE.spin.lag;
      // the ring tilted down toward where he faces (`tilt`); the honda on it the way the hand is
      const f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f), tl = TUNE.spin.tilt, ct = Math.cos(tl), st = Math.sin(tl);
      const dx = Math.cos(ang), dy = Math.sin(ang), phi = Math.atan2(dx * fy - dy * fx, dx * fx + dy * fy), cp = Math.cos(phi), sp = Math.sin(phi);
      const ch = hz + TUNE.spin.h * k, hx = cxw + (fx * ct * cp + fy * sp) * r, hy = cyw + (fy * ct * cp - fx * sp) * r, hh = ch - st * cp * r;
      ring(cxw, cyw, ch, r, fx * ct, fy * ct, -st, fy, -fx, 0, 22, phi, .05);
      hemp(hxw, hyw, hz, hx, hy, hh, 0);
      return true;
    }
    // the throw's wind-up: the loop swings off the hand, out in front of it, standing up as it goes
    const f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f);
    W(Pv.x + (m.x - A.PIV[0]) / PPM, Pv.y, E, 0); const hxw = E[0], hyw = E[1], hz = Pv.z + (A.PIV[1] - m.y) / PPMH;
    const q = clamp(Z.S.t / Math.max(.05, Z.tls().throw.rel), 0, 1), tl = .2 + q * .65, cx = hxw + fx * r * .8, cy = hyw + fy * r * .8, chh = hz + .08 + (1 - q) * .12;
    ring(cx, cy, chh, r, fx * Math.cos(tl), fy * Math.cos(tl), -Math.sin(tl), fy, -fx, 0, 20, T * 9, .06);
    hemp(hxw, hyw, hz, cx - fx * r * Math.cos(tl), cy - fy * r * Math.cos(tl), chh + Math.sin(tl) * r, 0);
    return true;
  }
  // what the throw goes for (the sim's aim)
  function aimMark() {
    const A = L.aim, z = host.zoom, crawl = (T * 12) | 0, col = A.ok ? GOLD : RED, a = A.ok ? 1 : .6;
    if (A.kind === 'enemy' && A.who) {
      const p = A.who, g = (p.z || 0) + .03, top = (p.z || 0) + (p.h || 0) + (p.hitH ?? 1.6) + .35;
      dashRing(p.x, p.y, g, (p.hitR ?? .4) + .18, col, 22, crawl, a);
      POP.size = z * 2; POP.alpha = a; for (let k = 0; k < 3; k++) { host.point(p.x, p.y, top + .1 - k * .07, col, POP); }   // a little drop marker over it
      POP.size = z; host.point(p.x - .1, p.y, top + .08, col, POP); host.point(p.x + .1, p.y, top + .08, col, POP);
    } else if (A.kind === 'prop' && A.who) dashRing(A.who.x, A.who.y, (A.who.z || 0) + .03, (A.who.r || .3) + .2, col, 18, crawl, a);
    else if (A.kind === 'anchor') {
      const k = .16 + .04 * Math.sin(T * 9);
      ring(A.x, A.y, A.h, k, Math.cos(host.yaw), -Math.sin(host.yaw), 0, 0, 0, 1, 12, T * 3, 0);   // a ring facing you round the point
      POP.size = z * 2; POP.alpha = 1; host.point(A.x, A.y, A.h, GOLD, POP);
      const g = host.elev(A.x, A.y); POP.size = z; for (let hh = A.h - .3; hh > g; hh -= .25) host.point(A.x, A.y, hh, DIM, POP);   // a dotted drop: how high it is
    } else dashRing(A.x, A.y, A.h + .03, TUNE.spin.r, DIM, 16, crawl, .8);
  }

  return {view, frame, get chain() { return chainOn; }};
}
