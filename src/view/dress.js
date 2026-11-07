// DRESS: a live model as it looks with gear on (docs/GEAR.md). Takes a model in ragdoll_export.py's shape (json + bin: the corners
// in their segments' bone frames, each with its part and family) and the pieces worn (content/gear.js), and returns the model
// to draw: the same segments and bones, so every pose, clip and the live hero's machinery stay the model's own; only its
// corners and families differ:
//   paint   the zone's parts take the material's family (a new family 'gear:<material>', its ramp by palette_harm.py's rule)
//   hide    the zone's parts' triangles collapsed to a point (nothing drawn, nothing cast; the corner count stays)
//   add     new shapes, built here in body space at rest and moved into their bone's frame (its rest matrix), appended as
//           corners of that bone's segment (or its nearest ancestor's that has one), with a part of their own so the
//           pixelizer draws lines between them and the body
//   cloth   what the runtime cloth panel (the gunslinger's duster tail, view/livehero.js) should do: null (as it is), 'off',
//           or a family to draw it in
// Before the pieces' own looks, each slot that holds a piece takes off his own garment there (content/gear.js BASE: the hat,
// the duster, the cape and tail, trousers, boots): its zones hidden or filled (a fill '@zone' is the colour the model's own
// zone has: shirt sleeves, bare feet). A piece's paint wins over its slot's rule; a piece's hide wins over any paint.
// The result goes to render/rigmesh.js restyle (the body keeps its slot and history). Made only when the set changes.
// OWNS: nothing (a pure builder). READS: content/gear.js, three.js geometries (at build only).
// BUDGET: ~2-6 ms a call (a copy of the model's ~10k corners + a few hundred new ones); never per frame.
import * as THREE from 'three';
import {ramp6} from './rigkit.js';
import {MATERIALS, ZONES, BASE, SLOTS} from '../content/gear.js';

const DEG = Math.PI / 180, STRIDE = 20;
const V = new THREE.Vector3(), N = new THREE.Vector3(), M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), T = new THREE.Vector3();

// a piece's geometry (non-indexed, with normals), at the origin, unscaled: the shape's own size
function geometry(a) {
  const sides = a.o?.sides ?? 8;
  let g;
  switch (a.shape) {
    case 'box': g = new THREE.BoxGeometry(a.size[0], a.size[1], a.size[2]); break;
    case 'ball': { const r = Array.isArray(a.r) ? a.r : [a.r, a.r, a.r]; g = new THREE.SphereGeometry(1, sides, Math.max(4, sides >> 1 | 0)).scale(r[0], r[1], r[2]); break; }
    case 'tube': g = new THREE.CylinderGeometry(a.r1, a.r0, a.len, sides).rotateX(Math.PI / 2); break;
    case 'disc': g = new THREE.CylinderGeometry(a.r, a.r, a.len, sides).rotateX(Math.PI / 2); break;
    case 'cone': g = new THREE.ConeGeometry(a.r, a.len, sides).rotateX(Math.PI / 2); break;
    default: throw new Error('dress: no shape ' + a.shape);
  }
  const out = g.index ? g.toNonIndexed() : g; if (out !== g) g.dispose();
  out.computeVertexNormals();
  return out;
}

// the segment a piece riding `bone` joins: that bone's, or the nearest ancestor's that has one
function segOf(J, bone) {
  for (let b = bone; b; b = J.bones[b]?.parent) { const i = J.segs.findIndex(s => s.bone === b); if (i >= 0) return i; }
  return -1;
}

// J, bin: the model as exported; pieces: content/gear.js entries (worn, in SLOTS order: a later piece's paint wins)
// -> {J, bin, cloth}
export function dress(J, bin, pieces) {
  const Z = ZONES[J.meta.loadout] || {};
  const fams = J.families.slice(), famIx = new Map(fams.map((f, i) => [f.name, i]));
  const famOf = m => {   // m: a MATERIALS name, or 4 tones of its own (the dev wardrobe's picked colours: dev/wardrobe.js)
    const key = 'gear:' + (Array.isArray(m) ? m.join('') : m); let i = famIx.get(key);
    if (i === undefined) { const t = Array.isArray(m) ? m : MATERIALS[m]; if (!t) throw new Error('dress: no material ' + m); i = fams.length; fams.push({name: key, ramp: ramp6(t)}); famIx.set(key, i); }
    return i;
  };
  const parts = J.parts.slice();
  const partOf = name => { let i = parts.indexOf(name); if (i < 0) { parts.push(name); i = parts.length - 1; } return i + 1; };   // (1-based: 0 is none)
  const zoneParts = z => (Z[z] || []).map(p => J.parts.indexOf(p) + 1).filter(i => i > 0);
  const paint = new Map(), hide = new Set(), adds = [], u8in = new Uint8Array(bin);
  let cloth = null;
  const famOfZone = z => {   // the family the model's own zone is drawn in (its first triangle's), or -1
    const ps = new Set(zoneParts(z));
    for (let c = 0; c < J.meta.corners; c += 3) if (ps.has(u8in[c * STRIDE + 17])) return u8in[c * STRIDE + 18];
    return -1;
  };
  // his own clothes off where a piece is worn in the slot (BASE)
  const B = BASE[J.meta.loadout] || {}, baseHide = new Set();
  for (const g of pieces) {
    const R = SLOTS.includes(g.slot) && B[g.slot]; if (!R) continue;
    for (const z of R.hide || []) for (const i of zoneParts(z)) baseHide.add(i);
    for (const [z, m] of Object.entries(R.fill || {})) {
      const f = m[0] === '@' ? famOfZone(m.slice(1)) : famOf(m); if (f < 0) continue;
      for (const i of zoneParts(z)) paint.set(i, f);
    }
    if (R.cloth) cloth = R.cloth;
  }
  for (const g of pieces) {
    const L = g.look || {};
    for (const [z, m] of Object.entries(L.paint || {})) for (const i of zoneParts(z)) { paint.set(i, famOf(m)); baseHide.delete(i); }
    for (const z of L.hide || []) for (const i of zoneParts(z)) hide.add(i);
    if (L.cloth) cloth = L.cloth === 'off' ? 'off' : fams[famOf(L.cloth)];
    for (const a of L.add || []) adds.push(a);
  }
  for (const i of baseHide) hide.add(i);
  // the new pieces' corners, in their bones' frames
  const extra = [];
  for (const a of adds) {
    const si = segOf(J, a.on); if (si < 0) continue;
    const R = J.bones[J.segs[si].bone].rest;   // rows of the rest matrix: body = R3 x local + t
    const g = geometry(a), pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
    const rot = a.rot || [0, 0, 0];
    M4.compose(T.set(a.at[0], a.at[1], a.at[2]), Q.setFromEuler(E.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)), S.set(1, 1, 1));
    const part = partOf(a.part), fam = famOf(a.mat), o = a.o || {};
    const fl = (o.fixed !== undefined ? o.fixed + 1 : 0) | (o.outline === false ? 8 : 0) | (o.lines === false ? 16 : 0);
    const bias = Math.max(-127, Math.min(127, Math.round((o.bias || 0) * 100)));
    for (let i = 0; i < pos.count; i++) {
      V.fromBufferAttribute(pos, i).applyMatrix4(M4);
      N.fromBufferAttribute(nrm, i).applyQuaternion(Q);
      const dx = V.x - R[3], dy = V.y - R[7], dz = V.z - R[11];   // body -> the bone's frame: R^T (v - t)
      extra.push(R[0] * dx + R[4] * dy + R[8] * dz, R[1] * dx + R[5] * dy + R[9] * dz, R[2] * dx + R[6] * dy + R[10] * dz,
        R[0] * N.x + R[4] * N.y + R[8] * N.z, R[1] * N.x + R[5] * N.y + R[9] * N.z, R[2] * N.x + R[6] * N.y + R[10] * N.z, bias, si, part, fam, fl);
    }
    g.dispose();
  }
  const n0 = J.meta.corners, n1 = n0 + extra.length / 11;
  if (parts.length > 255 || fams.length > 255) throw new Error('dress: too many parts or families');
  const out = new ArrayBuffer(n1 * STRIDE), u8 = new Uint8Array(out), dv = new DataView(out);
  u8.set(new Uint8Array(bin, 0, n0 * STRIDE));
  // paint and hide, a triangle at a time (its three corners share a part)
  for (let t = 0; t < n0; t += 3) {
    const p = u8[t * STRIDE + 17];
    if (hide.has(p)) {
      const o = t * STRIDE, x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
      for (let k = 1; k < 3; k++) { dv.setFloat32(o + k * STRIDE, x, true); dv.setFloat32(o + k * STRIDE + 4, y, true); dv.setFloat32(o + k * STRIDE + 8, z, true); }
    } else if (paint.has(p)) { const f = paint.get(p); for (let k = 0; k < 3; k++) u8[(t + k) * STRIDE + 18] = f; }
  }
  for (let i = 0, c = n0; i < extra.length; i += 11, c++) {
    const o = c * STRIDE;
    dv.setFloat32(o, extra[i], true); dv.setFloat32(o + 4, extra[i + 1], true); dv.setFloat32(o + 8, extra[i + 2], true);
    for (let k = 0; k < 3; k++) dv.setInt8(o + 12 + k, Math.max(-127, Math.min(127, Math.round(extra[i + 3 + k] * 127))));
    dv.setInt8(o + 15, extra[i + 6]); u8[o + 16] = extra[i + 7]; u8[o + 17] = extra[i + 8]; u8[o + 18] = extra[i + 9]; u8[o + 19] = extra[i + 10];
  }
  return {J: {...J, meta: {...J.meta, corners: n1}, parts, families: fams}, bin: out, cloth};
}
