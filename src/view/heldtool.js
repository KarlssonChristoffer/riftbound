// HELD TOOL: a tool in the live hero's right fist (docs/GATHERING.md): a small runtime mesh on his RightHand segment, drawn
// with his body through every pass (render/rigmesh.js attach, as the duster's runtime cloth is), so no model re-export and
// any live body can hold it. Placed in the hand's frame from the fist's grip (the bone RopeHand0's head: where the fingers
// close), its axes as western.py _hand_frame has them: F along the hand (the fist's way), U the thumb side. Two holds
// (HOLDS):
//   swing   gripped at the knob: the haft out of the fist along U cos(cant) + F sin(cant) (the wrist cocked: a striking grip),
//           the head at the far end, the bit toward F cos - U sin. western.py's tool keys (TL_CANT) turn the hands for it,
//           and the left fist closes on the haft there: placed once.
//   carry   gripped at the throat, the head by the fist: the haft HANGS (down in his frame, tilted `lean` deg forward), the
//           bit forward, whatever the wrist does in the walk and the idles: placed again when the hand has turned more than
//           a few degrees (the hand's rotation in his frame, from the drawn pose: show(id, 'carry', w, o))
// The shape is made once per tool and hold in its own frame (a along the haft, b toward the bit, t through); placing it is a
// basis change into the hand's frame, written straight into the attached buffers (no allocation).
//   const T = createHeldTool(rig, model, J, ramp6); T.show(id | '', hold, w?, o?) each frame (w: the drawn pose, o: the
//   RightHand's offset in it)
// OWNS: the attached mesh. READS: J (the model's bones and segments). BUDGET: nothing while still; a carried tool's few hundred
//   corners re-placed and uploaded (~3 KB) on the frames its hand turns.
const ASH = ['#e2bc84', '#bd9358', '#8a6638', '#3c2a16'], STEEL = ['#f4f6f8', '#ccd4dc', '#949ca6', '#3a3e44'];   // (a pale ash haft: it reads against dark trousers and the duster)
// the tools a fist can hold: metres along the haft, across it toward the bit (b), through it (the side)
const TOOLS = {
  axe: {haft: {len: .71, w: .032}, head: {len: .095, eye: .034, bit: .17, flare: .14, thick: .036, poll: .04}},
};
// a hold: where the haft runs (from: metres along it from the grip; it is TOOLS' len long, away from the head) and where the
// head's middle is; swing: the haft's way in the hand (cant deg from U toward F); carry: the hang's forward lean (deg)
const HOLDS = {
  swing: {cant: 42, from: -.07, head: .56},
  carry: {lean: 16, from: -.09, head: -.05},
};
const TURN = .9995;   // (carry: placed again once the hang's way in the hand moved more than ~1.8 deg)

export function createHeldTool(rig, model, J, ramp6) {
  const seg = J.segs.findIndex(s => s.bone === 'RightHand'), B = J.bones || {}, hand = B.RightHand, grip = B.RopeHand0 || B.GunHold0;
  if (seg < 0 || !hand || !grip) return {show() {}};
  // the hand's rest frame (rows of the 4 x 4: its columns are the bone's axes in the model)
  const r = hand.rest, col = i => [r[i], r[4 + i], r[8 + i]], X = col(0), Y = col(1), Z = col(2), H = hand.head;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const local = v => [dot(v, X), dot(v, Y), dot(v, Z)];   // a model-space direction into the hand's frame
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const g = local(sub(grip.head, H)), F = local(Y), up = local([0, -1, 0]);   // (F: the bone's own axis; U: the thumb, -Y in Blender = his front at rest)
  const U = unit(sub(up, F.map(x => x * dot(up, F))));
  const famOf = name => J.families.find(f => f.name === name);
  const fams = [{name: 'toolwood', ramp: ramp6(ASH)}, famOf('iron') || {name: 'tooliron', ramp: ramp6(['#9a9aa2', '#6e6e78', '#51515a', '#2a2a30'])}, {name: 'toolsteel', ramp: ramp6(STEEL)}];
  const MAX = 6 * 36, part = 250;   // (a part of its own: below the cloths' 255 down, above the ones view/dress.js adds after the model's)
  const D = rig.attach(model, MAX, fams);

  // ---------------------------------------------------------------- the shape, in its own frame (made once per tool + hold)
  const SHAPES = {};
  function shapeOf(id, hold) {
    const key = id + ':' + hold; if (SHAPES[key]) return SHAPES[key];
    const T = TOOLS[id], Hd = HOLDS[hold], P = [], N = [], FAM = [], BIAS = [];
    const hexa = (c, fam, bias = 0) => {   // 8 corners (0-3 one end, 4-7 the other, in the same turning order): 12 flat triangles
      const F6 = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], mid = [0, 0, 0];
      for (const p of c) for (let k = 0; k < 3; k++) mid[k] += p[k] / 8;
      for (const f of F6) for (const [a, b, d] of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]) {
        const pa = c[a], pb = c[b], pd = c[d], e1 = sub(pb, pa), e2 = sub(pd, pa);
        let nn = unit([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
        if (dot(nn, sub(pa, mid)) < 0) nn = nn.map(x => -x);   // (outward, whichever way the corners turn)
        for (const p of [pa, pb, pd]) { P.push(...p); N.push(...nn); FAM.push(fam); BIAS.push(bias); }
      }
    };
    const at = (a, b, t) => [a, b, t];
    const box = (a0, a1, b0, b1, t0, B0 = b0, B1 = b1, t1 = t0) => [at(a0, b0, -t0), at(a0, b1, -t0), at(a0, b1, t0), at(a0, b0, t0),
      at(a1, B0, -t1), at(a1, B1, -t1), at(a1, B1, t1), at(a1, B0, t1)];
    const h = T.haft, w = h.w / 2, E = T.head, tip = Hd.head > Hd.from ? Hd.from + h.len : Hd.from - h.len;   // (the knob's end: away from the head)
    hexa(box(Math.min(Hd.from, tip), Math.max(Hd.from, tip), -w, w, w * .9, -w * .85, w * .85, w * .8), 0, .05);   // the haft
    const a0 = Hd.head - E.len / 2, a1 = Hd.head + E.len / 2, t = E.thick / 2, fl = E.flare / 2, cb = E.bit - .02, m = Hd.head;
    hexa(box(a0, a1, -E.poll, E.eye, t), 1, .05);                                  // the eye round the haft and the poll behind it
    hexa([at(a0, E.eye, -t), at(a1, E.eye, -t), at(a1, E.eye, t), at(a0, E.eye, t),   // the cheek: flaring along the haft, thinning
      at(m - fl * .9, cb, -t * .35), at(m + fl, cb, -t * .35), at(m + fl, cb, t * .35), at(m - fl * .9, cb, t * .35)], 1, 0);
    hexa([at(m - fl * .9, cb, -t * .35), at(m + fl, cb, -t * .35), at(m + fl, cb, t * .35), at(m - fl * .9, cb, t * .35),   // the ground edge
      at(m - fl, E.bit, -t * .12), at(m + fl * 1.08, E.bit, -t * .12), at(m + fl * 1.08, E.bit, t * .12), at(m - fl, E.bit, t * .12)], 2, .12);
    return SHAPES[key] = {P: Float32Array.from(P), N: Float32Array.from(N), FAM, BIAS, n: Math.min(MAX, P.length / 3)};
  }
  // written into the attached buffers: a point (a, b, t) -> g + A a + Bt b + S t; its normal likewise (no translation)
  let cur = null;
  function place(S, A, Bt) {
    const Sx = A[1] * Bt[2] - A[2] * Bt[1], Sy = A[2] * Bt[0] - A[0] * Bt[2], Sz = A[0] * Bt[1] - A[1] * Bt[0];
    const P = S.P, N = S.N, pos = D.pos, nrm = D.nrm;
    for (let i = 0; i < S.n; i++) {
      const a = P[i * 3], b = P[i * 3 + 1], t = P[i * 3 + 2], na = N[i * 3], nb = N[i * 3 + 1], nt = N[i * 3 + 2];
      pos[i * 3] = g[0] + A[0] * a + Bt[0] * b + Sx * t; pos[i * 3 + 1] = g[1] + A[1] * a + Bt[1] * b + Sy * t; pos[i * 3 + 2] = g[2] + A[2] * a + Bt[2] * b + Sz * t;
      nrm[i * 4] = Math.round((A[0] * na + Bt[0] * nb + Sx * nt) * 127); nrm[i * 4 + 1] = Math.round((A[1] * na + Bt[1] * nb + Sy * nt) * 127);
      nrm[i * 4 + 2] = Math.round((A[2] * na + Bt[2] * nb + Sz * nt) * 127);
    }
    if (cur !== S) {   // (a new shape: its families, biases and segment once)
      cur = S;
      for (let i = 0; i < S.n; i++) { nrm[i * 4 + 3] = Math.round(S.BIAS[i] * 100); D.info[i * 4] = seg; D.info[i * 4 + 1] = part; D.info[i * 4 + 2] = D.fam[S.FAM[i]]; D.info[i * 4 + 3] = 0; }
    }
    D.update(S.n);
  }
  // the swing hold's axes (fixed in the hand)
  const sc = Math.cos(HOLDS.swing.cant * Math.PI / 180), ss = Math.sin(HOLDS.swing.cant * Math.PI / 180);
  const SW_A = unit([U[0] * sc + F[0] * ss, U[1] * sc + F[1] * ss, U[2] * sc + F[2] * ss]), SW_B = unit([F[0] * sc - U[0] * ss, F[1] * sc - U[1] * ss, F[2] * sc - U[2] * ss]);
  // the carry's: his down and front (Blender: -Z, -Y) into the hand's frame by the inverse of its drawn rotation q (x y z w)
  const CA = [0, 0, 0], CB = [0, 0, 0], LA = [9, 9, 9], V = [0, 0, 0];
  const cl = Math.cos(HOLDS.carry.lean * Math.PI / 180), sl = Math.sin(HOLDS.carry.lean * Math.PI / 180);
  function unrot(w, o, x, y, z, out) {   // conj(q) v q: the vector (x, y, z) of his frame in the bone's frame
    const qx = -w[o], qy = -w[o + 1], qz = -w[o + 2], qw = w[o + 3];
    const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
    out[0] = x + qw * tx + (qy * tz - qz * ty); out[1] = y + qw * ty + (qz * tx - qx * tz); out[2] = z + qw * tz + (qx * ty - qy * tx);
  }
  let shown = '', held = '';
  return {
    show(id, hold = 'carry', w = null, o = 0) {
      if (!TOOLS[id]) { if (shown) { shown = ''; held = ''; D.update(0); } return; }
      const S = shapeOf(id, hold);
      if (hold === 'carry' && w) {
        unrot(w, o, 0, -sl, -cl, V);   // (down, leaning forward)
        if (id === shown && held === hold && V[0] * LA[0] + V[1] * LA[1] + V[2] * LA[2] > TURN) return;
        LA[0] = V[0]; LA[1] = V[1]; LA[2] = V[2];
        CA[0] = V[0]; CA[1] = V[1]; CA[2] = V[2];
        unrot(w, o, 0, -1, 0, CB);   // (his front: the bit), square to the haft
        const d = CB[0] * CA[0] + CB[1] * CA[1] + CB[2] * CA[2]; CB[0] -= CA[0] * d; CB[1] -= CA[1] * d; CB[2] -= CA[2] * d;
        const l = Math.hypot(CB[0], CB[1], CB[2]) || 1; CB[0] /= l; CB[1] /= l; CB[2] /= l;
        shown = id; held = hold; place(S, CA, CB); return;
      }
      if (id === shown && hold === held) return;
      shown = id; held = hold; LA[0] = 9; place(S, SW_A, SW_B);
    },
  };
}
