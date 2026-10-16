// HELD WEAPON: a melee weapon in the live hero's right fist and a shield on his left forearm (content/melee.js WEAPONS /
// SHIELDS look; sim/player/melee.js). Small runtime meshes on his segments, drawn with his body through every pass
// (render/rigmesh.js attach), the way view/heldtool.js holds the axe: no model re-export, any live body can hold them.
//   the weapon   in the hand's frame from the fist's grip (RopeHand0's head), its axes as western.py _hand_frame has them:
//                F along the hand (the punch's way), U the thumb side. Two holds:
//                  swing  the blade out of the fist along U cos(cant) + F sin(cant) (cant 0: straight up from a punching
//                         fist, 90: along the punch), the edge toward F cos - U sin. The cant comes per frame from the move
//                         (MOVES cant: its start -> its end over the swing); placed again when it changed a degree
//                  carry  hanging point down from the fist (tilted forward), placed again when the hand turned (heldtool's way)
//   the shield   on the forearm's outer side (the A-pose's back of the hand: his left, square to the bone), its face
//                outward, its long way along the forearm; placed once a shield (the forearm carries it)
// The shapes are made once per look in their own frame (a along the blade / the forearm, b toward the edge / across, t
// through), placing is a basis change written straight into the attached buffers (no allocation).
//   const W = createHeldWeapon(rig, model, J, ramp6)
//   W.show(wid | '', hold, cant (deg), w (the drawn pose), o (RightHand's offset in it)); W.shield(sid | '')
//   W.tip / W.base: the blade's point and its guard in the hand's frame (W.ok: a weapon shown): view/livehero.js puts
//   them into the world (host.playerBlade: the flame's embers, the glow's light)
// OWNS: the two attached meshes. READS: J (bones, segments), content/melee.js. BUDGET: nothing while still; a swing's ~200
//   corners re-placed (~5 KB up) on the frames its cant moves.
import {WEAPONS, SHIELDS} from '../content/melee.js';

const DEG = Math.PI / 180;
const TURN = .9995;   // (carry: placed again once the hang's way in the hand moved more than ~1.8 deg)

export function createHeldWeapon(rig, model, J, ramp6) {
  const segOf = n => J.segs.findIndex(s => s.bone === n);
  const B = J.bones || {}, hand = B.RightHand, grip = B.RopeHand0 || B.GunHold0, seg = segOf('RightHand');
  const arm = B.LeftForeArm, segL = segOf('LeftForeArm') >= 0 ? segOf('LeftForeArm') : segOf('LeftHand');
  const NONE = {ok: false, tip: [0, 0, 0], base: [0, 0, 0], show() {}, shield() {}};
  if (seg < 0 || !hand || !grip) return NONE;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const frameOf = bone => { const r = bone.rest, col = i => [r[i], r[4 + i], r[8 + i]], X = col(0), Y = col(1), Z = col(2); return v => [dot(v, X), dot(v, Y), dot(v, Z)]; };
  const localR = frameOf(hand), H = hand.head;
  const g = localR(sub(grip.head, H)), F = localR([hand.rest[1], hand.rest[5], hand.rest[9]]), up = localR([0, -1, 0]);
  const U = unit(sub(up, F.map(x => x * dot(up, F))));

  // the families: each weapon's steel and hilt, each shield's face and trim
  const fams = [], FI = {};
  const fam = (key, cols) => { FI[key] = fams.length; fams.push({name: 'mw_' + key, ramp: ramp6(cols)}); };
  for (const [id, w] of Object.entries(WEAPONS)) { fam(id + ':s', w.look.steel); fam(id + ':h', w.look.hilt); }
  for (const [id, s] of Object.entries(SHIELDS)) if (s) { fam(id + ':f', s.look.face); fam(id + ':t', s.look.trim); }
  const MAX = 10 * 36, part = 249, partL = 248;   // (parts of their own: under the held tool's 250, clear of the cloths' 255 down)
  const D = rig.attach(model, MAX, fams);
  const DL = segL >= 0 && arm ? rig.attach(model, MAX, fams) : null;

  // ---------------------------------------------------------------- the shapes (their own frame: a, b, t)
  function builder() {
    const P = [], N = [], FAM = [], BIAS = [], FL = [];
    const hexa = (c, fm, bias = 0, fl = 0) => {   // 8 corners (0-3 one end, 4-7 the other, the same turning order): 12 flat triangles
      const F6 = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], mid = [0, 0, 0];
      for (const p of c) for (let k = 0; k < 3; k++) mid[k] += p[k] / 8;
      for (const f of F6) for (const [a, b, d] of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]) {
        const pa = c[a], pb = c[b], pd = c[d];
        let nn = unit(cross(sub(pb, pa), sub(pd, pa)));
        if (dot(nn, sub(pa, mid)) < 0) nn = nn.map(x => -x);   // (outward, whichever way the corners turn)
        if (!(nn[0] === nn[0])) nn = [0, 0, 1];
        for (const p of [pa, pb, pd]) { P.push(...p); N.push(...nn); FAM.push(fm); BIAS.push(bias); FL.push(fl); }
      }
    };
    // a box from a0 to a1 (b0..b1 wide, t0 thick either side at a0; B0..B1, t1 at a1), turned rot rad in the a-b plane
    const box = (a0, a1, b0, b1, t0, B0 = b0, B1 = b1, t1 = t0, rot = 0) => {
      const c = Math.cos(rot), s = Math.sin(rot), at = (a, b, t) => [a * c - b * s, a * s + b * c, t];
      return [at(a0, b0, -t0), at(a0, b1, -t0), at(a0, b1, t0), at(a0, b0, t0), at(a1, B0, -t1), at(a1, B1, -t1), at(a1, B1, t1), at(a1, B0, t1)];
    };
    const done = () => ({P: Float32Array.from(P), N: Float32Array.from(N), FAM, BIAS, FL, n: Math.min(MAX, P.length / 3)});
    return {hexa, box, done};
  }
  const SHAPES = {};
  // a weapon along +a from the fist (the grip's middle at a = 0)
  function weaponShape(id) {
    if (SHAPES[id]) return SHAPES[id];
    const w = WEAPONS[id], L = w.look, {hexa, box, done} = builder(), S = FI[id + ':s'], Hh = FI[id + ':h'];
    const glow = L.kind === 'saber' || L.flame ? 1 : 0;   // (a glowing blade: its brightest tone, flat)
    let tipA = w.len || .9, baseA = .06;
    if (L.kind === 'blade' || L.kind === 'saber') {
      const gr = L.grip || .14, g0 = -gr * .45, g1 = gr * .55, t = L.kind === 'saber' ? .018 : .011, bw = (L.w || .05) / 2;
      hexa(box(g0, g1, -.018, .018, .018), Hh, .05);                                            // the grip
      if (L.pommel) hexa(box(g0 - L.pommel * 1.6, g0, -L.pommel, L.pommel, L.pommel * .9), Hh, .1);   // the pommel
      if (L.kind === 'saber') {
        hexa(box(g1, g1 + .03, -.026, .026, .026), Hh, .1);                                       // the emitter
        const b0 = g1 + .03, b1 = b0 + (L.blade || .95);
        hexa(box(b0, b1, -bw, bw, bw, -bw * .8, bw * .8, bw * .8), S, .2, 9);                     // the blade (light: flat, no outline)
        baseA = b0; tipA = b1;
      } else {
        const gd = (L.guard || .18) / 2;
        hexa(box(g1, g1 + .024, -gd, gd, .02), Hh, .1);                                           // the guard
        if (L.cup) hexa(box(g1 - .02, g1 + .03, -L.cup, L.cup, L.cup * .8), Hh, .05);          // (the rapier's cup)
        const b0 = g1 + .024, bl = L.blade || .78, tp = Math.min(bl * .6, L.tip || .12), b1 = b0 + bl - tp;
        if (L.chop) {   // the cleaver: wider toward its end, the back straight
          hexa(box(b0, b1 + tp, -bw * .3, bw, t, -bw * .3, bw * 1.35, t * .8), S, .05, glow);
        } else if (L.wavy) {   // the flame sword: a blade of three kinks
          const n = 3, d = (b1 - b0) / n;
          for (let i = 0; i < n; i++) { const o = (i % 2 ? 1 : -1) * bw * .35; hexa(box(b0 + d * i, b0 + d * (i + 1), -bw + o, bw + o, t, -bw * .92 - o, bw * .92 - o, t), S, .05, glow); }
          hexa(box(b1, b1 + tp, -bw * .9, bw * .9, t, -.004, .004, t * .3), S, .12, glow);
        } else {
          hexa(box(b0, b1, -bw, bw, t, L.clip ? -bw * .8 : -bw * .92, bw * .92, t), S, .05, glow);   // the blade
          hexa(box(b1, b1 + tp, -bw * .92, bw * .92, t, L.clip ? bw * .5 : -.004, L.clip ? bw * .6 : .004, t * .3), S, .12, glow);   // its point
        }
        baseA = b0; tipA = b1 + tp;
      }
    } else if (L.kind === 'hammer') {   // the maul: a long haft, a block head
      const hf = L.haft || 1, a0 = -.3, a1 = a0 + hf, hd = (L.head || .26) / 2, hw = (L.headW || .16) / 2;
      hexa(box(a0, a1, -.02, .02, .02), Hh, .05);
      hexa(box(a1 - hw * 2, a1 + .02, -hd, hd, hw), S, .08);
      hexa(box(a1 - hw * 2.2, a1 + .04, -hd * .3, hd * .3, hw * 1.1), S, .15);   // (its banded middle)
      baseA = a1 - hw * 2; tipA = a1;
    } else if (L.kind === 'fish') {   // the frozen pike: held by the tail, a fat body, a pointed head
      const bl = L.blade || .7, bw = (L.w || .12) / 2, t = bw * .55;
      hexa(box(-.06, .02, -bw * 1.1, bw * 1.1, .006, -.012, .012, .012), Hh, .1);                 // the tail fin (in the fist)
      hexa(box(.02, .02 + bl * .35, -.015, .015, .012, -bw, bw, t), S, .05);                    // the body widening
      hexa(box(.02 + bl * .35, .02 + bl * .8, -bw, bw, t, -bw * .7, bw * .7, t * .8), S, .05);
      hexa(box(.02 + bl * .8, .02 + bl, -bw * .7, bw * .7, t * .8, -.01, .01, .01), S, .12);   // the head
      hexa(box(.02 + bl * .3, .02 + bl * .5, bw * .9, bw * 1.6, .004), Hh, .1);                  // the dorsal fin
      baseA = .02; tipA = .02 + bl;
    } else {   // the wobbler: a pink rubber sword, its blade bent this way and that
      const bl = L.blade || .5, bw = (L.w || .07) / 2, t = bw * .6;
      hexa(box(-.07, .07, -.02, .02, .02), Hh, .05);
      hexa(box(.07, .1, -bw * 1.4, bw * 1.4, .025), Hh, .1);
      const n = 4, d = bl / n;
      for (let i = 0; i < n; i++) hexa(box(.1 + d * i, .1 + d * (i + 1), -bw, bw, t, -bw * (1 - (i + 1) * .08), bw * (1 - (i + 1) * .08), t, Math.sin(i * 1.7) * .12), S, .1);
      hexa(box(.1 + bl, .1 + bl + .05, -bw * .5, bw * .5, t * .8, -bw * .2, bw * .2, t * .5), S, .15);
      baseA = .1; tipA = .1 + bl + .05;
    }
    return SHAPES[id] = Object.assign(done(), {tipA, baseA});
  }
  // a shield: its middle at 0, a along the forearm (toward the hand), b across, t out of its face
  function shieldShape(id) {
    const key = 's:' + id; if (SHAPES[key]) return SHAPES[key];
    const s = SHIELDS[id], L = s.look, {hexa, box, done} = builder(), Fc = FI[id + ':f'], Tr = FI[id + ':t'];
    if (L.kind === 'round') {
      const r = L.r || .3, th = .018, k = Math.tan(Math.PI / 8);
      for (let i = 0; i < 4; i++) hexa(box(-r, r, -r * k, r * k, th, -r * k, r * k, th, i * Math.PI / 4), Fc, 0);   // (four crossed bars: a 16-sided disc)
      if (L.planks) for (const b of [-r * .4, r * .4]) hexa(box(-r * .92, r * .92, b - .004, b + .004, th * 1.15), Tr, .05, 0);
      hexa(box(-L.boss, L.boss, -L.boss, L.boss, L.boss * .8), Tr, .2);   // the boss
    } else {   // tower / door: a slab and its trim (the door's a Z of planks)
      const h = (L.h || 1) / 2, w = (L.w || .5) / 2, th = L.kind === 'door' ? .026 : .02;
      hexa(box(-h, h, -w, w, th), Fc, 0);
      if (L.kind === 'door') {
        for (const a of [-h * .75, h * .75]) hexa(box(a - .05, a + .05, -w * .96, w * .96, th * 1.6), Tr, .05);
        const ang = Math.atan2(w * 1.5, h * 1.5), len = Math.hypot(h * 1.5, w * 1.5) / 2;
        hexa(box(-len, len, -.045, .045, th * 1.6, -.045, .045, th * 1.6, ang), Tr, .05);
        hexa(box(-.03, .03, w * .6, w * .75, th * 2.6), Tr, .2);   // (the handle)
      } else {
        hexa(box(-h, h, -.03, .03, th * 1.4), Tr, .05);
        hexa(box(-.06, .06, -w * .96, w * .96, th * 1.4), Tr, .05);
        hexa(box(-.07, .07, -.07, .07, th * 2.6), Tr, .2);
      }
    }
    return SHAPES[key] = done();
  }

  // ---------------------------------------------------------------- placing: (a, b, t) -> o + A a + Bt b + (A x Bt) t
  function place(DD, S, o, A, Bt, sg, pt, cur) {
    const Sx = A[1] * Bt[2] - A[2] * Bt[1], Sy = A[2] * Bt[0] - A[0] * Bt[2], Sz = A[0] * Bt[1] - A[1] * Bt[0];
    const P = S.P, N = S.N, pos = DD.pos, nrm = DD.nrm;
    for (let i = 0; i < S.n; i++) {
      const a = P[i * 3], b = P[i * 3 + 1], t = P[i * 3 + 2], na = N[i * 3], nb = N[i * 3 + 1], nt = N[i * 3 + 2];
      pos[i * 3] = o[0] + A[0] * a + Bt[0] * b + Sx * t; pos[i * 3 + 1] = o[1] + A[1] * a + Bt[1] * b + Sy * t; pos[i * 3 + 2] = o[2] + A[2] * a + Bt[2] * b + Sz * t;
      nrm[i * 4] = Math.round((A[0] * na + Bt[0] * nb + Sx * nt) * 127); nrm[i * 4 + 1] = Math.round((A[1] * na + Bt[1] * nb + Sy * nt) * 127);
      nrm[i * 4 + 2] = Math.round((A[2] * na + Bt[2] * nb + Sz * nt) * 127);
    }
    if (cur.s !== S) {   // (a new shape: its families, biases, flags and segment once)
      cur.s = S;
      for (let i = 0; i < S.n; i++) { nrm[i * 4 + 3] = Math.round(S.BIAS[i] * 100); DD.info[i * 4] = sg; DD.info[i * 4 + 1] = pt; DD.info[i * 4 + 2] = DD.fam[S.FAM[i]]; DD.info[i * 4 + 3] = S.FL[i]; }
      DD.infoChanged?.();
    }
    DD.update(S.n);
  }
  const CUR = {s: null}, CURL = {s: null};
  const A = [0, 0, 0], Bv = [0, 0, 0], LA = [9, 9, 9], V = [0, 0, 0];
  const cl = Math.cos(16 * DEG), sl = Math.sin(16 * DEG);
  function unrot(w, o, x, y, z, out) {   // conj(q) v q: the vector (x, y, z) of his frame in the bone's frame
    const qx = -w[o], qy = -w[o + 1], qz = -w[o + 2], qw = w[o + 3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    out[0] = x + qw * tx + (qy * tz - qz * ty); out[1] = y + qw * ty + (qz * tx - qx * tz); out[2] = z + qw * tz + (qx * ty - qy * tx);
  }
  // the shield's frame on the forearm (fixed in the bone)
  let SL = null;
  if (DL) {
    const lf = frameOf(arm), Fa = lf([arm.rest[1], arm.rest[5], arm.rest[9]]), out0 = lf([1, 0, 0]);
    const Na = unit(sub(out0, Fa.map(x => x * dot(out0, Fa)))), Ba = unit(cross(Na, Fa));
    const len = Math.hypot(arm.tail[0] - arm.head[0], arm.tail[1] - arm.head[1], arm.tail[2] - arm.head[2]) || .25;
    const segIsHand = J.segs[segL].bone !== 'LeftForeArm';
    const o = segIsHand ? Na.map(x => x * .07) : [Fa[0] * len * .55 + Na[0] * .07, Fa[1] * len * .55 + Na[1] * .07, Fa[2] * len * .55 + Na[2] * .07];
    SL = {A: Fa, B: Ba, o};
  }

  let shown = '', held = '', cant0 = NaN, shownL = '';
  const W = {
    ok: false, tip: [0, 0, 0], base: [0, 0, 0],
    show(id, hold = 'carry', cant = 30, w = null, o = 0) {
      if (!WEAPONS[id]) { if (shown) { shown = ''; held = ''; W.ok = false; D.update(0); } return; }
      const S = weaponShape(id);
      if (hold === 'carry' && w) {
        unrot(w, o, 0, -sl, -cl, V);   // (down, leaning forward)
        if (id === shown && held === hold && V[0] * LA[0] + V[1] * LA[1] + V[2] * LA[2] > TURN) return;
        LA[0] = V[0]; LA[1] = V[1]; LA[2] = V[2];
        A[0] = V[0]; A[1] = V[1]; A[2] = V[2];
        unrot(w, o, 0, -1, 0, Bv);   // (his front: the edge), square to the blade
        const d = dot(Bv, A); Bv[0] -= A[0] * d; Bv[1] -= A[1] * d; Bv[2] -= A[2] * d;
        const l = Math.hypot(Bv[0], Bv[1], Bv[2]) || 1; Bv[0] /= l; Bv[1] /= l; Bv[2] /= l;
      } else {
        if (id === shown && held === hold && Math.abs(cant - cant0) < 1) return;
        cant0 = cant; LA[0] = 9;
        const c = Math.cos(cant * DEG), s = Math.sin(cant * DEG);
        A[0] = U[0] * c + F[0] * s; A[1] = U[1] * c + F[1] * s; A[2] = U[2] * c + F[2] * s;
        Bv[0] = F[0] * c - U[0] * s; Bv[1] = F[1] * c - U[1] * s; Bv[2] = F[2] * c - U[2] * s;
      }
      shown = id; held = hold; W.ok = true;
      for (let k = 0; k < 3; k++) { W.tip[k] = g[k] + A[k] * S.tipA; W.base[k] = g[k] + A[k] * S.baseA; }
      place(D, S, g, A, Bv, seg, part, CUR);
    },
    shield(id) {
      if (!DL || !SL) return;
      if (!SHIELDS[id]) { if (shownL) { shownL = ''; DL.update(0); } return; }
      if (id === shownL) return;
      shownL = id; place(DL, shieldShape(id), SL.o, SL.A, SL.B, segL, partL, CURL);
    },
  };
  return W;
}
