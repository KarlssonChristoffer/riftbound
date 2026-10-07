// RIG KIT: characters built in CODE for render/rigmesh.js (the brutes: view/brute3d.js; the garden's merchant:
// view/merchant3d.js), in the shape tools/blender/ragdoll_export.py writes a Blender model in, so the same machinery draws
// them (view/livebody.js: the pixel-friendly knobs, the rig's passes; view/ragdoll.js: a death by physics):
//   a SKELETON of bones (head, tail; the rest frame in Blender's convention: y along the bone, z the body's forward (-y) made
//     square to it, x = y x z: his left on the spine), the feet at the origin facing -y (Blender axes: x his left, y back, z up);
//   PIECES (boxes, spheres, cylinders, cones) authored in that body space at rest, each bound 100% to one bone (its segment),
//     with a part (the pixelizer's interior lines run between parts), a family (a 4-tone ramp turned into the pixelizer's 6 by
//     palette_harm.py's rule: hi, base, shade, line, outline shadow, outline lit) and a bias / fixed tone / no-outline flag;
//   POSES as every bone's world transform (quaternion + head), from per-bone LOCAL turns (FK: world = parent x rest-local x
//     turn, the turn about the bone's head in its own rest frame), into the caller's buffer, no allocation.
//   const K = rigKit(); K.bone(name, parent, head, tail, {z}); K.fam(name, tones, {sat}); K.box / ball / tube / cone(bone,
//     part, fam, ...); const M = K.build(name) -> {J, bin, ...}; the poser: M.rest(W) / M.pose(W, turns, root) (W: Float64Array
//     bones x 7, livebody's body-space pose; turns: Float64Array bones x 4, quaternions; root: [x, y, z] + an optional turn)
// OWNS: nothing at run time (a builder). READS: three.js geometries (at build only). BUDGET: build once per look (~1-3 ms);
//   pose(): ~20 bones of quaternion maths, ~.003 ms.
import * as THREE from 'three';
import {qmul, qrot, axisAngle} from './livebody.js';
import {hexAny255} from '../core/color.js';

// palette_harm.py's ramp (the sprites' harmonized colours): [hi, base, shade, dark] -> [hi, base, shade, line, outline shadow, outline lit]
const HARM = {SAT: .8, HI_V: .94, SHADE_LIFT: .15, LINE_LIFT: .2, OUTLINE_LIFT: .42};
function hsv([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, mx ? d / mx : 0, mx];
}
const rgbOf = ([h, s, v]) => { const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; };
const adjust = (c, sat, val) => { const [h, s, v] = hsv(c); return rgbOf([h, s * sat, Math.min(255, v * val)]).map(Math.round); };
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
export function ramp6(tones, sat = HARM.SAT) {
  const o = tones.map(t => typeof t === 'string' ? hexAny255(t) : t);
  const hi = adjust(o[0], sat, HARM.HI_V), base = adjust(o[1], sat, 1), shade = adjust(mix(o[2], o[1], HARM.SHADE_LIFT), sat, 1), dark = adjust(o[3], sat, 1);
  return [hi, base, shade, mix(dark, shade, HARM.LINE_LIFT).map(Math.round), mix(dark, shade, HARM.OUTLINE_LIFT).map(Math.round), shade];
}
export function rampRaw(tones) {
  const o = tones.map(t => typeof t === 'string' ? hexAny255(t) : t);
  return [o[0], o[1], o[2], o[3], mix(o[3], o[2], .25).map(Math.round), o[2]];
}
// a 4-tone ramp mixed toward a colour (k 0..1): variants (an elite's darker hide)
export const tint = (tones, c, k) => tones.map(t => { const a = hexAny255(t), b = hexAny255(c); return '#' + mix(a, b, k).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); });

const V = new THREE.Vector3(), N3 = new THREE.Matrix3(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S3 = new THREE.Vector3();
export function rigKit() {
  const bones = [], byName = {}, fams = [], famIx = {}, parts = [], partIx = {}, pieces = [], marks = [];
  const K = {
    // a bone: head, tail (body space, m); o.z the forward hint (default his forward, -y; bones along it take up, +z)
    bone(name, parent, head, tail, o = {}) {
      const y = new THREE.Vector3(...tail).sub(new THREE.Vector3(...head)).normalize();
      let zh = new THREE.Vector3(...(o.z || [0, -1, 0])); if (Math.abs(zh.dot(y)) > .95) zh.set(0, 0, 1);
      const x = new THREE.Vector3().crossVectors(y, zh).normalize(), z = new THREE.Vector3().crossVectors(x, y).normalize();
      const B = {name, parent, head: head.slice(), tail: tail.slice(), x, y, z, i: bones.length};
      bones.push(B); byName[name] = B; return K;
    },
    // a family: its 4 tones through palette_harm.py's rule (the characters' look), or o.raw: as painted (the world's props and
    // the biome's creatures are painted in their ramps as they are: hi, base, shade; the darkest for lines and the outline)
    fam(name, tones, o = {}) { if (!(name in famIx)) { famIx[name] = fams.length; fams.push({name, ramp: o.raw ? rampRaw(tones) : ramp6(tones, o.sat)}); } return K; },
    // pieces: geometry in body space at rest; o: {rot: [x, y, z] (rad, XYZ), bias (-1..1), fixed (tone 0..3), outline (false: none), lines (false)}
    piece(bone, part, fam, geo, pos, scl, o = {}) {
      if (!(part in partIx)) { parts.push(part); partIx[part] = parts.length; }
      pieces.push({bone, part, fam, geo, pos, scl, o}); return K;
    },
    box(bone, part, fam, size, pos, o) { return K.piece(bone, part, fam, new THREE.BoxGeometry(1, 1, 1), pos, size, o); },
    ball(bone, part, fam, rad, pos, o = {}) { return K.piece(bone, part, fam, new THREE.IcosahedronGeometry(1, o.detail ?? 1), pos, rad, o); },
    // tubes and cones stand along the body's z (up: r0 / the base at the bottom), then o.rot turns them
    tube(bone, part, fam, r0, r1, len, pos, o = {}) { return K.piece(bone, part, fam, new THREE.CylinderGeometry(r1, r0, len, o.sides ?? 8).rotateX(Math.PI / 2), pos, 1, o); },
    cone(bone, part, fam, r, len, pos, o = {}) { return K.piece(bone, part, fam, new THREE.ConeGeometry(r, len, o.sides ?? 6).rotateX(Math.PI / 2), pos, 1, o); },
    // a tube along a bone, head to tail (radii r0 at the head, r1 at the tail; o.ext: longer by that share at both ends)
    limb(bone, part, fam, r0, r1, o = {}) {
      const B = byName[bone], h = new THREE.Vector3(...B.head), t = new THREE.Vector3(...B.tail), d = t.clone().sub(h), L = d.length(), e = o.ext ?? .1;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize()), r = new THREE.Euler().setFromQuaternion(q);
      return K.piece(bone, part, fam, new THREE.CylinderGeometry(r1, r0, L * (1 + 2 * e), o.sides ?? 8).rotateX(Math.PI / 2), h.clone().add(t).multiplyScalar(.5).toArray(), 1, {...o, rot: [r.x, r.y, r.z]});
    },
    // a point a share t along a bone, plus an offset (body space)
    at(bone, t, off = [0, 0, 0]) { const B = byName[bone]; return [0, 1, 2].map(k => B.head[k] + (B.tail[k] - B.head[k]) * t + off[k]); },
    has: n => !!byName[n],
    // a named point riding a bone (body space at rest): M.marks[name] = [bone index, x, y, z in its rest frame] (the eyes' glow)
    mark(name, bone, pos) { marks.push({name, bone, pos}); return K; },
    // -> {J, bin, NB, names, ...poser}: the model rigmesh / livebody take, and its poser
    build(name) {
      // the bones in depth-first order (parents first)
      const kids = {}; for (const B of bones) (kids[B.parent] ??= []).push(B);
      const order = []; (function dfs(p) { for (const B of kids[p] || []) { order.push(B); dfs(B.name); } })(null);
      const segOf = {}, segs = [], recs = [];
      for (const P of pieces) {
        const B = byName[P.bone]; if (!B) throw new Error(`rigkit: no bone ${P.bone}`);
        if (!(P.bone in segOf)) { segOf[P.bone] = segs.length; segs.push({bone: P.bone, kind: 'body'}); recs.push([]); }
        recs[segOf[P.bone]].push(P);
      }
      const corners = [];
      segs.forEach((s, si) => {
        const B = byName[s.bone], R = new THREE.Matrix4().makeBasis(B.x, B.y, B.z).setPosition(...B.head), Ri = R.clone().invert();
        let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; s.first = corners.length;
        for (const P of recs[si]) {
          const g = P.geo.index ? P.geo.toNonIndexed() : P.geo; g.computeVertexNormals?.();
          if (P.o.flat) { g.deleteAttribute('normal'); g.computeVertexNormals(); }
          const pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
          const sc = Array.isArray(P.scl) ? P.scl : [P.scl, P.scl, P.scl], rot = P.o.rot || [0, 0, 0];
          M4.compose(S3.set(...P.pos), Q.setFromEuler(E.set(rot[0], rot[1], rot[2])), new THREE.Vector3(...sc));
          const L = Ri.clone().multiply(M4); N3.getNormalMatrix(L);
          const fl = (P.o.fixed !== undefined ? P.o.fixed + 1 : 0) | (P.o.outline === false ? 8 : 0) | (P.o.lines === false ? 16 : 0);
          const bias = Math.max(-127, Math.min(127, Math.round((P.o.bias || 0) * 100)));
          for (let i = 0; i < pos.count; i++) {
            V.fromBufferAttribute(pos, i).applyMatrix4(L);
            for (let k = 0; k < 3; k++) { const c = V.getComponent(k); if (c < mn[k]) mn[k] = c; if (c > mx[k]) mx[k] = c; }
            const p = [V.x, V.y, V.z];
            V.fromBufferAttribute(nrm, i).applyMatrix3(N3).normalize();
            corners.push([p, [V.x, V.y, V.z], bias, si, partIx[P.part], famIx[P.fam], fl]);
          }
        }
        s.count = corners.length - s.first; s.min = mn.map(v => +v.toFixed(4)); s.max = mx.map(v => +v.toFixed(4));
      });
      const bin = new ArrayBuffer(corners.length * 20), dv = new DataView(bin);
      corners.forEach(([p, n, bias, si, pi, fi, fl], i) => {
        const o = i * 20; dv.setFloat32(o, p[0], true); dv.setFloat32(o + 4, p[1], true); dv.setFloat32(o + 8, p[2], true);
        for (let k = 0; k < 3; k++) dv.setInt8(o + 12 + k, Math.max(-127, Math.min(127, Math.round(n[k] * 127))));
        dv.setInt8(o + 15, bias); dv.setUint8(o + 16, si); dv.setUint8(o + 17, pi); dv.setUint8(o + 18, fi); dv.setUint8(o + 19, fl);
      });
      // the rest frames (J.bones: rest rows, Blender style) and the rest pose (J.poses['idle.0']: quaternion + head)
      const Jb = {}, rest = {}, q = new THREE.Quaternion(), RM = new THREE.Matrix4();
      for (const B of order) {
        RM.makeBasis(B.x, B.y, B.z); q.setFromRotationMatrix(RM);
        Jb[B.name] = {parent: B.parent, head: B.head, tail: B.tail, rest: [B.x.x, B.y.x, B.z.x, B.head[0], B.x.y, B.y.y, B.z.y, B.head[1], B.x.z, B.y.z, B.z.z, B.head[2], 0, 0, 0, 1]};
        rest[B.name] = [q.x, q.y, q.z, q.w, ...B.head];
      }
      const J = {meta: {loadout: 'rigkit:' + name, corners: corners.length, units_per_px: .0327883818891779}, segs, parts, families: fams, bones: Jb, poses: {'idle.0': rest}};
      for (const P of pieces) P.geo.dispose();
      // THE POSER: rest-local transforms (parent's rest^-1 x rest), then FK with per-bone turns
      const NB = order.length, IX = Object.fromEntries(order.map((B, i) => [B.name, i])), PI = Int16Array.from(order.map(B => IX[B.parent] ?? -1));
      const RW = new Float64Array(NB * 7), RL = new Float64Array(NB * 7), QI = new Float64Array(4), T = new Float64Array(3), R4 = new Float64Array(4), T4 = new Float64Array(4);
      order.forEach((B, i) => { for (let k = 0; k < 7; k++) RW[i * 7 + k] = rest[B.name][k]; });
      for (let i = 0; i < NB; i++) {
        const o = i * 7, p = PI[i] * 7;
        if (PI[i] < 0) { for (let k = 0; k < 7; k++) RL[o + k] = RW[o + k]; continue; }
        QI[0] = -RW[p]; QI[1] = -RW[p + 1]; QI[2] = -RW[p + 2]; QI[3] = RW[p + 3];
        qmul(QI, 0, RW, o, RL, o); qrot(QI, 0, RW[o + 4] - RW[p + 4], RW[o + 5] - RW[p + 5], RW[o + 6] - RW[p + 6], RL, o + 4);
      }
      const MK = {}; for (const m of marks) { const B = byName[m.bone], d = new THREE.Vector3(...m.pos).sub(new THREE.Vector3(...B.head)); MK[m.name] = [IX[m.bone], d.dot(B.x), d.dot(B.y), d.dot(B.z)]; }
      const M = {J, bin, NB, IX, names: order.map(B => B.name), PI, marks: MK,
        turns: () => { const t = new Float64Array(NB * 4); for (let i = 0; i < NB; i++) t[i * 4 + 3] = 1; return t; },
        // a turn of bone b (index) about its own rest frame's axis (x: pitch, y: twist along it, z: roll), composed onto turns
        turn(t, b, ax, a) { if (b < 0 || !a) return; axisAngle(ax === 0 ? 1 : 0, ax === 1 ? 1 : 0, ax === 2 ? 1 : 0, a, R4); qmul(t, b * 4, R4, 0, T4, 0); for (let k = 0; k < 4; k++) t[b * 4 + k] = T4[k]; },
        reset(t) { t.fill(0); for (let i = 0; i < NB; i++) t[i * 4 + 3] = 1; },
        // W (body space, bones x 7) = FK of the turns; root: [dx, dy, dz] added to the root's head, rq: a quaternion turning the
        // whole body about the feet (the origin) first (a lean, a tumble), or null
        pose(W, t, root = null, rq = null) {
          for (let i = 0; i < NB; i++) {
            const o = i * 7, p = PI[i] * 7;
            qmul(RL, o, t, i * 4, W, o);   // (the bone's rest-local rotation x its turn)
            if (PI[i] < 0) {
              W[o + 4] = RL[o + 4] + (root ? root[0] : 0); W[o + 5] = RL[o + 5] + (root ? root[1] : 0); W[o + 6] = RL[o + 6] + (root ? root[2] : 0);
              if (rq) { qmul(rq, 0, W, o, W, o); qrot(rq, 0, W[o + 4], W[o + 5], W[o + 6], T, 0); W[o + 4] = T[0]; W[o + 5] = T[1]; W[o + 6] = T[2]; }
              continue;
            }
            qmul(W, p, W, o, W, o);
            qrot(W, p, RL[o + 4], RL[o + 5], RL[o + 6], T, 0);
            W[o + 4] = W[p + 4] + T[0]; W[o + 5] = W[p + 5] + T[1]; W[o + 6] = W[p + 6] + T[2];
          }
          return W;
        },
      };
      return M;
    },
  };
  return K;
}
