// THE UNCANNY FOREST'S LOOK (view; features/uncanny.js has the sim): the heron and its head, the elk in parts, the night ring
// of pale mushrooms and its light, the quiet stones, the pale marks on trunks and the doll in the hollow (lantern light only),
// the heron shadows of whoever stands in the ring at night, what the elk made you drop, and (?uncanny=dev) the markers.
// Everything is drawn from the sim's state and the clock; nothing here is read back by the sim.
//   const look = createUncannyLook(host, F); look.view(dt); look.frame(f); look.lights(); look.drop(); look.hide()
// OWNS: its meshes, the marks' canvases, its light record. READS: F (the feature's state), host.env, host.player, coop's peers.
// BUDGET: ~12 matrices a frame (heron 2, elk 6, the ring, up to 4 shadows), a few sprites near the player. No allocation a frame.
import {nightK} from '../../world/uncanny.js';
import {recipeGeo, recipeOf} from '../../world/recipe3d.js';
import {FAMS} from '../../world/world.js';
import {ITEMS, PAL} from '../../content/items.js';
import {clamp, smooth} from '../../core/mathx.js';

const TAU = Math.PI * 2;
const LOOK = {
  heron: {s: 1.15, watch: 22, turn: 5, sink: 1.5},   // size; m it watches you from; 1/s its head turns at; m it sinks at dusk
  elk: {s: 1.2, stride: 1.7, swing: .3, legs: .55, neck: .4, thin: .12},   // m a stride; rad a leg swings (less on longer legs: the same step); x longer legs / neck, a thinner body at night
  ring: {glow: 1.1, light: '#d8e8c4', r: 5.5, k: .7, rise: .45},   // glow x; the light's colour, reach (m), strength; m the mushrooms rise
  marks: {see: 7, fade: 3, h: 1.25},   // m the lantern shows a mark from (x notice), m it fades over; a mark's height on the trunk
  shadow: {n: 4, len: 1.2, k: .9},     // heron shadows: at most; their length (x the heron); how dark
};
const FWD = [[0, 0], [Math.PI, 0], [Math.PI * .5, 1], [Math.PI * 1.5, 1]];   // the legs' phases in a walk (FL FR BL BR) and which pair

export function createUncannyLook(host, F) {
  const THREE = host.THREE, U = F.U, env = host.env;
  const M = new THREE.Matrix4(), M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion();
  const V = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0), ZA = new THREE.Vector3(0, 0, 1);
  const BX = new THREE.Vector3(), BY = new THREE.Vector3(), BZ = new THREE.Vector3();
  const fam = n => FAMS.indexOf(n);
  const biome = () => host.biome?.id || 'ruins';
  const elevAt = (x, y) => host.elev(x, y);

  // ---------------------------------------------------------------- meshes (made lazily; the world's rebuild disposes them: drop())
  let made = false, heron = null, head = null, ring = null, stones = null, elk = null, shadows = [];
  let ringA = null, heronA = null;
  const mk = (name, params, o) => { const g = recipeGeo(name, 0, params, biome()); return g ? host.world.mesh(g.geo, null, o) : null; };
  const lifts = (P, r, n) => { const g0 = elevAt(P.x, P.y), out = []; for (let i = 0; i < n; i++) { const a = i / n * TAU; out.push(+(elevAt(P.x + Math.cos(a) * r, P.y + Math.sin(a) * r) - g0).toFixed(3)); } return out; };
  function make() {
    if (made) return;
    made = true;
    const H = U.heron;
    if (H) {
      const hp = {s: LOOK.heron.s, shade: 0};
      heron = mk('heron', hp); head = mk('heron_head', hp); heronA = recipeOf('heron').anchors(hp);
      const rp = {r: H.ring, n: 13}; rp.lift = lifts(H, H.ring, rp.n);
      ring = mk('glowring', rp); ringA = {g: elevAt(H.x, H.y)};
      if (ring) ring.setGlow(0, fam('paleglow'), 0);
      for (let i = 0; i < LOOK.shadow.n; i++) { const m = mk('heron', {s: LOOK.heron.s, shade: 1}); if (m) { m.setVisible(false); shadows.push(m); } }
    }
    const St = U.stones;
    if (St) {
      const sp = {r: St.r, n: St.n}; sp.lift = lifts(St, St.r, St.n);
      stones = mk('ringstones', sp, {static: true});
      if (stones) { M.makeRotationY(0).setPosition(St.x, elevAt(St.x, St.y), St.y); stones.setMatrix(M); stones.setGlow(0, fam('lichen'), 0); }
    }
    if (U.elk) {
      const ep = {s: LOOK.elk.s, antler: 1};
      elk = {body: mk('elk_body', ep), neck: mk('elk_neck', ep), legs: [0, 1, 2, 3].map(() => mk('elk_leg', ep)), A: recipeOf('elk_body').anchors(ep), phase: 0, lx: NaN, ly: NaN, graze: 0, tilt: 0};
    }
  }
  const all = () => [heron, head, ring, stones, elk?.body, elk?.neck, ...(elk?.legs || []), ...shadows];
  function drop() { made = false; heron = head = ring = stones = elk = null; shadows = []; }   // (disposed by the world's rebuild)
  function hide() { for (const m of all()) if (m && m.gm.visible) m.setVisible(false); }

  // ---------------------------------------------------------------- the marks (pale, pixel; drawn once) and the dropped things' icons
  const canvas = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d'); draw(q); return c; };
  const px = (q, col, pts) => { q.fillStyle = col; for (const [x, y] of pts) q.fillRect(x, y, 1, 1); };
  const PALE = '#e8eedc', DIM = '#a8b49c';
  const MARK = {
    hand: canvas(9, 11, q => { px(q, PALE, [[1, 2], [1, 3], [1, 4], [3, 0], [3, 1], [3, 2], [3, 3], [5, 0], [5, 1], [5, 2], [5, 3], [7, 2], [7, 3], [7, 4], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [3, 7], [4, 7], [5, 7], [6, 7], [4, 8], [5, 8], [4, 9], [5, 9]]); px(q, DIM, [[1, 5], [8, 4], [3, 10], [6, 10]]); }),
    spiral: canvas(9, 9, q => { px(q, PALE, [[2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 2], [7, 3], [7, 4], [7, 5], [6, 6], [5, 7], [4, 7], [3, 7], [2, 6], [1, 5], [1, 4], [1, 3], [2, 3], [3, 3], [4, 3], [5, 4], [4, 5], [3, 5]]); px(q, DIM, [[1, 2], [8, 3], [6, 7], [2, 7]]); }),
    eye: canvas(11, 7, q => { px(q, PALE, [[2, 2], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 2], [9, 3], [8, 4], [7, 5], [6, 5], [5, 5], [4, 5], [3, 5], [2, 4], [1, 3], [5, 2], [4, 3], [6, 3], [5, 4]]); px(q, DIM, [[5, 3], [0, 3], [10, 3]]); }),
  };
  const icon = id => {
    const rows = ITEMS[id]?.icon; if (!rows) return null;
    return canvas(14, 14, q => {
      const at = (x, y) => y >= 0 && y < 12 && x >= 0 && x < 12 && rows[y][x] !== '.';
      for (let y = -1; y < 13; y++) for (let x = -1; x < 13; x++) {
        if (at(x, y)) { q.fillStyle = PAL[rows[y][x]] || '#f0f'; q.fillRect(x + 1, y + 1, 1, 1); }
        else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) { q.fillStyle = '#1a1612'; q.fillRect(x + 1, y + 1, 1, 1); }
      }
    });
  };
  const ICONS = {}; const iconOf = id => ICONS[id] ??= icon(id);
  const DOLL = icon('bark_doll');
  // the marks' places: on their trunk's side, facing the way their mark faces (F.props: the forest as it grew; the marked trees never walk)
  const MARKS = U.marks.map(m => { const p = U.F.props[m.i], r = .3; return {x: p[1] + Math.sin(m.a) * r, y: p[2] + Math.cos(m.a) * r, h: m.h ?? LOOK.marks.h, img: MARK[m.kind] || MARK.hand}; });
  for (const m of MARKS) m.g = elevAt(m.x, m.y);
  const SPR = {img: null, em: null, x: 0, y: 0, h: 0, alpha: 1, px: 0, py: 0};

  // ---------------------------------------------------------------- view state
  const HV = {yaw: U.heron?.phi || 0, sink: 0};
  const ME = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null}, IN = [];   // (who stands in the ring: [x, y] records reused)
  for (let i = 0; i < LOOK.shadow.n; i++) IN.push({x: 0, y: 0});
  let nIn = 0;
  const view = dt => {
    make();
    const P = host.player, k = nightK(env.t);
    // the heron: its head on you (the short way each time, so walking round it turns it all the way round); it sinks at dusk
    if (U.heron) {
      const H = U.heron, d = Math.hypot(P.x - H.x, P.y - H.y);
      const want = d < LOOK.heron.watch ? Math.atan2(P.x - H.x, P.y - H.y) : H.phi;
      let a = want - HV.yaw; a -= Math.round(a / TAU) * TAU; HV.yaw += a * Math.min(1, dt * LOOK.heron.turn);
      HV.sink = smooth(k * 1.8);
      // who stands in the ring at night: you and the others (their heron shadows)
      nIn = 0;
      if (k > .5) {
        const r = H.ring + .2;
        if (Math.hypot(P.x - H.x, P.y - H.y) < r) { IN[nIn].x = P.x; IN[nIn].y = P.y; nIn++; }
        const C = host.feature('coop')?.online ? host.feature('coop').net : null;
        if (C) for (const q of C.peers.values()) { if (nIn >= IN.length) break; if (C.sample(q, ME) && Math.hypot(ME.x - H.x, ME.y - H.y) < r) { IN[nIn].x = ME.x; IN[nIn].y = ME.y; nIn++; } }
        if (F.ringFriend && nIn < IN.length) { IN[nIn].x = H.x + .4; IN[nIn].y = H.y; nIn++; }
      }
    }
    // the elk's legs: their phase from how far it went (forwards or backwards: they swing the same way), grazing when it stands
    const E = F.elk, el = elk;
    if (el && E.ok) {
      const mv = isNaN(el.lx) ? 0 : Math.hypot(E.x - el.lx, E.y - el.ly); el.lx = E.x; el.ly = E.y;
      const legs = 1 + LOOK.elk.legs * k;
      el.phase += mv / (LOOK.elk.stride * legs) * TAU;
      el.speed = mv / Math.max(dt, 1e-3);
      const graze = E.mode === 'day' && el.speed < .05 ? 1 : 0, tilt = E.mode === 'stare' ? 1 : E.mode === 'stalk' ? .35 : 0;
      el.graze += (graze - el.graze) * Math.min(1, dt * 1.2); el.tilt += (tilt - el.tilt) * Math.min(1, dt * 2);
    }
  };

  // ---------------------------------------------------------------- draw
  const frame = () => {
    if (!made) return;
    const k = nightK(env.t), t = performance.now() / 1000;
    // the heron
    if (heron && head) {
      const H = U.heron, s = HV.sink, g = elevAt(H.x, H.y) - s * LOOK.heron.sink * LOOK.heron.s, vis = s < .995;
      heron.setVisible(vis); head.setVisible(vis);
      if (vis) {
        Q.setFromAxisAngle(UP, H.phi); M.compose(V.set(H.x, g, H.y), Q, S.set(1, 1, 1)); heron.setMatrix(M);
        const n = heronA.neck; V.set(n[0], n[1], n[2]).applyMatrix4(M);
        Q.setFromAxisAngle(UP, HV.yaw); M2.compose(V, Q, S.set(1, 1, 1)); head.setMatrix(M2);
      }
    }
    // the night ring: up out of the ground as the heron goes down, its caps glowing (dark while it is spent)
    if (ring) {
      const H = U.heron, up = smooth((k - .25) * 2), spent = F.st.heron.s === 'spent', fl = Math.max(0, F.flash.heron) / 6;
      ring.setVisible(up > .01);
      if (up > .01) {
        M.makeTranslation(H.x, ringA.g - (1 - up) * LOOK.ring.rise, H.y); ring.setMatrix(M);
        ring.setGlow(0, fam('paleglow'), (spent ? .15 : LOOK.ring.glow * (.85 + .15 * Math.sin(t * .7))) * up + fl * 2.5);
      }
      // the heron shadows: flat, dark, lying away from the ring's middle from each one standing in it
      for (let i = 0; i < shadows.length; i++) {
        const m = shadows[i], on = i < nIn && up > .5; if (m.gm.visible !== on) m.setVisible(on); if (!on) continue;
        const q = IN[i]; let dx = q.x - H.x, dy = q.y - H.y; const l = Math.hypot(dx, dy); if (l < .05) { dx = 0; dy = 1; } else { dx /= l; dy /= l; }
        const len = LOOK.shadow.len;
        BX.set(0, .015, 0); BY.set(dx, 0, dy).multiplyScalar(len); BZ.set(dy, 0, -dx).multiplyScalar(1.1);   // (its side lying flat: its height along the ground away from the middle)
        M.makeBasis(BX, BY, BZ).setPosition(q.x, elevAt(q.x, q.y) + .03, q.y); m.setMatrix(M);
      }
    }
    // the quiet stones: their lichen glows a moment when the secret opens
    if (stones) stones.setGlow(0, fam('lichen'), Math.max(0, F.flash.stones) / 6 * 1.6);
    // the elk
    const E = F.elk, el = elk;
    if (el?.body && E.ok) {
      const s = LOOK.elk.s, legL = s * (1 + LOOK.elk.legs * k), thin = 1 - LOOK.elk.thin * k, A = el.A;
      const g = elevAt(E.x, E.y), bh = legL + .22 * s;
      Q.setFromAxisAngle(UP, E.phi); M.compose(V.set(E.x, g + bh + Math.sin(el.phase * 2) * .02, E.y), Q, S.set(thin, 1, 1 + .12 * k));
      el.body.setMatrix(M);
      const sw = LOOK.elk.swing / (1 + LOOK.elk.legs * k) * clamp(el.speed / .8, 0, 1), lw = 1 / thin;   // (lw: the legs keep their thickness as the body thins)
      for (let i = 0; i < 4; i++) {
        const L = el.legs[i]; if (!L) continue;
        const a = A.legs[i], th = Math.sin(el.phase + FWD[i][0]) * sw;
        M2.makeRotationX(th); M3.makeScale(lw, legL, lw); M2.multiply(M3);
        M3.makeTranslation(a[0], a[1], a[2]); M3.premultiply(M); M3.multiply(M2); L.setMatrix(M3);
      }
      if (el.neck) {   // the neck: down to graze by day, stretched at night, its head cocked when it stares
        const nl = 1 + LOOK.elk.neck * k, a = A.neck;
        Q.setFromAxisAngle(XA, el.graze * 1.05 - k * .25); Q2.setFromAxisAngle(ZA, el.tilt * .45 * k); Q.multiply(Q2);
        M2.compose(V.set(a[0], a[1], a[2]), Q, S.set(thin, nl, 1 + (nl - 1) * .5)); M2.premultiply(M); el.neck.setMatrix(M2);
      }
    }
    // the marks: only by lantern light, at night, near; the doll in the hollow the same (until it is taken)
    const P = host.player;
    if (F.lit && k > .3) {
      const see = LOOK.marks.see * F.TUNE.notice, fade = LOOK.marks.fade, marksOn = F.st.marks.s !== 'spent' || F.flash.marks > 0;
      if (marksOn) for (const m of MARKS) {
        const d = Math.hypot(m.x - P.x, m.y - P.y); if (d > see) continue;
        const al = clamp((see - d) / fade, 0, 1) * smooth((k - .3) * 2) * (.75 + .25 * Math.sin(t * 1.3 + m.x));
        SPR.img = m.img; SPR.em = m.img; SPR.x = m.x; SPR.y = m.y; SPR.h = m.g + m.h; SPR.alpha = al; SPR.px = m.img.width / 2; SPR.py = m.img.height / 2; host.sprite(SPR);
      }
      const Ho = U.hollow;
      if (Ho && F.st.marks.s === 'awake' && DOLL) {
        const d = Math.hypot(Ho.x - P.x, Ho.y - P.y);
        if (d < see) { SPR.img = DOLL; SPR.em = null; SPR.x = Ho.x; SPR.y = Ho.y; SPR.h = elevAt(Ho.x, Ho.y) - .05; SPR.alpha = clamp((see - d) / fade, 0, 1); SPR.px = 7; SPR.py = 13; host.sprite(SPR); }
      }
    }
    // what the elk made you drop
    for (const d of F.dropped) {
      const img = iconOf(d.id); if (!img) continue;
      SPR.img = img; SPR.em = null; SPR.x = d.x; SPR.y = d.y; SPR.h = elevAt(d.x, d.y) + .05 + Math.sin(t * 2 + d.x) * .02; SPR.alpha = 1; SPR.px = 7; SPR.py = 13; host.sprite(SPR);
    }
    if (F.dev) devMarks(k);
  };

  // ---------------------------------------------------------------- the light: the ring's, at night (not while it is spent)
  const LREC = {x: 0, y: 0, h: 0, color: LOOK.ring.light, radius: 1, intensity: 0, flicker: 0, id: 9901}, LOUT = [];
  const lights = () => {
    LOUT.length = 0;
    if (!ring || !F.on || !U.heron) return LOUT;
    const k = nightK(env.t), up = smooth((k - .25) * 2), spent = F.st.heron.s === 'spent', fl = Math.max(0, F.flash.heron) / 6;
    if (up < .02 || (spent && fl <= 0)) return LOUT;
    LREC.x = U.heron.x; LREC.y = U.heron.y; LREC.h = ringA.g + .4; LREC.radius = LOOK.ring.r * F.TUNE.notice;
    LREC.intensity = (spent ? 0 : LOOK.ring.k * up) + fl * 1.6;
    LOUT.push(LREC); return LOUT;
  };

  // ---------------------------------------------------------------- dev markers (?uncanny=dev): pixel points, a line from you to each
  const COL = {heron: [.75, .85, 1], stones: [1, .85, .5], marks: [.85, 1, .7], elk: [1, .45, .35], walker: [.7, .55, 1]}, BIG = {size: 3}, SMALL = {size: 2};
  function devMarks() {
    const P = host.player, pz = elevAt(P.x, P.y) + 1;
    const mark = (x, y, c, line) => { const z = elevAt(x, y); for (let h = .4; h < 3; h += .5) host.point(x, y, z + h, c, BIG); if (line) host.line(P.x, P.y, pz, x, y, z + 1.5, c, true); };
    if (U.heron) mark(U.heron.x, U.heron.y, COL.heron, true);
    if (U.stones) mark(U.stones.x, U.stones.y, COL.stones, true);
    if (U.hollow) mark(U.hollow.x, U.hollow.y, COL.marks, true);
    for (const m of MARKS) host.point(m.x, m.y, m.g + m.h, COL.marks, SMALL);
    if (F.elk.ok) mark(F.elk.x, F.elk.y, COL.elk, true);
    for (const m of F.walkers || []) { const z0 = elevAt(m.x0, m.y0), z1 = elevAt(m.x1, m.y1); host.line(m.x0, m.y0, z0 + .2, m.x1, m.y1, z1 + .2, COL.walker, true); host.point(m.x1, m.y1, z1 + .3, COL.walker, SMALL); }
  }
  return {view, frame, lights, drop, hide};
}
