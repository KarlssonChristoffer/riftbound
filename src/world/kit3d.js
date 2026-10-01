// KIT3D: helpers for features that build their own pieces in the world's style. OWNER: the lights session.
//   geoOf(parts)      [{g: geometry, m: Matrix4, fam, bias?, fixed?}] -> one mesh geometry with the prop pipeline's
//                     attributes (aPart / aFam / aBias / aFixed): toned by the biome ramps, outlined, seams between parts
//                     of the same family, moss / snow on what faces up. Show it with host.world.mesh(geo, matrix, o)
//   M4(pos, rot?, scl?)  a compose() matrix (rot = Euler xyz radians)
//   box(fam, size, pos, rot?, o?)   a part: a box of size [x, y, z] at pos
//   along(a, b, r0, r1, seg?)       a part's {g, m}: a cylinder from point a to point b (radius r0 at a, r1 at b)
//   pack(items)       [{name, img, em?, pivot}] -> {img, em, fr: {name: {sx, sy, sw, sh, px, py}}}: one sprite sheet
//                     (albedo + emit in the same layout) for host.sprite
//   art(rows, key)    ASCII pixel art -> {P, E} pixel buffers (biomes.js ART.Pix). key: char -> [ramp, tone] | '#hex'
//                     (emissive when the key entry has emit: true)
import * as THREE from 'three';
import {FAMS} from './world.js';
import {ART} from './biomes.js';

export const M4 = (pos, rot = [0, 0, 0], scl = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scl));
export const box = (fam, size, pos, rot = [0, 0, 0], o = {}) => ({g: new THREE.BoxGeometry(...size), m: M4(pos, rot), fam, ...o});
export function along(a, b, r0, r1, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return {g: new THREE.CylinderGeometry(r1, r0, len, seg), m: new THREE.Matrix4().compose(A.add(B).multiplyScalar(.5), q, new THREE.Vector3(1, 1, 1))};
}
export function geoOf(list) {
  const pos = [], nrm = [], aPart = [], aFam = [], aBias = [], aFixed = [];
  list.forEach((q, pi) => {
    const g = (q.g.index ? q.g.toNonIndexed() : q.g.clone()).applyMatrix4(q.m), P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      aPart.push(pi % 64); aFam.push(Math.max(0, FAMS.indexOf(q.fam))); aBias.push(q.bias || 0); aFixed.push(q.fixed ?? -1);
    }
  });
  const geo = new THREE.BufferGeometry(), A = (n, a, k) => geo.setAttribute(n, new THREE.Float32BufferAttribute(a, k));
  A('position', pos, 3); A('normal', nrm, 3); A('aPart', aPart, 1); A('aFam', aFam, 1); A('aBias', aBias, 1); A('aFixed', aFixed, 1);
  geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo;
}
export function pack(items, AW = 512) {
  let x = 0, y = 0, rowH = 0;
  for (const it of items) { const w = it.img.width, h = it.img.height; if (x + w + 1 > AW) { x = 0; y += rowH + 1; rowH = 0; } it.r = [x, y, w, h]; x += w + 1; rowH = Math.max(rowH, h); }
  const img = document.createElement('canvas'), em = document.createElement('canvas');
  img.width = em.width = AW; img.height = em.height = Math.max(1, y + rowH);
  const qi = img.getContext('2d'), qe = em.getContext('2d'), fr = {};
  for (const it of items) {
    qi.drawImage(it.img, it.r[0], it.r[1]); if (it.em) qe.drawImage(it.em, it.r[0], it.r[1]);
    fr[it.name] = {sx: it.r[0], sy: it.r[1], sw: it.r[2], sh: it.r[3], px: it.pivot[0], py: it.pivot[1]};
  }
  return {img, em, fr};
}
export function art(rows, key) {
  const H = rows.length, W = Math.max(...rows.map(r => r.length)), P = new ART.Pix(W, H), E = new ART.Pix(W, H);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const k = key[ch]; if (!k) return;
    if (typeof k === 'string') P.c(x, y, ART.hex(k));
    else if (k.emit) { E.c(x, y, ART.hex(k.c)); if (k.base) P.c(x, y, ART.hex(k.base)); }
    else P.p(x, y, k[0], k[1]);
  }));
  return {P, E, W, H};
}
