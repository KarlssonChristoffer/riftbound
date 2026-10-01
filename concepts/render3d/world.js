// WORLD: the Proving Grounds rebuilt as a 3D scene for the HD-2D test, from the arena's own data.
//   ground   the biome's painter, run TOP-DOWN (the same code with PPMY = PPM and PPMH = 0), on a height grid: the stream
//            bed sits lower, the south ravine drops away
//   plateau  a real block: its painted top, rock-strata faces
//   props    live 3D meshes (Blender prop kit -> glb, toned on the GPU with the pixelizer's ramps and rules) or, for the
//            A/B test, the same props pre-rendered at 16 yaws (cards); everything the kit doesn't model (trees, bushes,
//            tufts, braziers, torches, dummies, brutes, crystal) stays a painted billboard card
//   lights   from the biome's sprites (braziers, torches, crystals) and ground (lava, runes), in metres
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {WORLD, PLAY, TRAIL, buildLayout, elev, inStream, PLATEAUS, STREAM} from '../sprites/arena/layout.js';

export const WATER_H = -.18;   // the stream bed sits this much below the ground (features: world.waterH)
const GLB = '../sprites/out/render3d/glb/', YAW = '../sprites/out/render3d/props_yaw/';

// ---------------------------------------------------------------- the pixelizer's palettes (props_pixelize.py BIOMES)
const RED = ['d8573e', 'a8342b', '72222a', '3e1420'], HAZ = ['f2d060', 'd8a830', '9a7020', '4e3812'], GOLD = ['ffe89a', 'e0b040', 'a87a24', '5a3e14'];
const PAL = {
  ruins: {wood: ['8c6c4a', '70543a', '543e2b', '35271c'], metal: ['a08650', '7a6438', '56452a', '352a1c'], clay: ['c8845a', 'a8643e', '7e472c', '4e2a1c'],
    stone: ['a09c90', '868278', '6a675f', '46443e'], rock: ['7e786b', '666056', '504b44', '35322d'], rope: ['cdb577', 'ad935a', '877043', '594a2b'],
    cover: ['7d9470', '627a58', '4b6048', '334436'], coverK: .08, coverT: .86},
  ember: {wood: ['5a4a40', '43362f', '30261f', '1c1512'], metal: ['6c666a', '4d484d', '363237', '211e22'], clay: ['6a6078', '463e52', '2e2838', '18141e'],
    stone: ['6c5656', '524042', '3e2f32', '261c1f'], rock: ['5f4b4b', '483839', '362a2c', '221a1c'], rope: ['8c7a5a', '6e5e44', '4e4230', '2e261c'],
    cover: ['8c827b', '79716b', '655e59', '4a4441'], coverK: .16, coverT: .84},
  frost: {wood: ['8a7c6e', '6d6055', '534841', '362f2b'], metal: ['9ea8b8', '768093', '586275', '39404f'], clay: ['cfdcea', 'a0b6d0', '7690b0', '4a5e80'],
    stone: ['8494ad', '6a7a95', '55647e', '3a455c'], rock: ['717e90', '5a6679', '475264', '2f3747'], rope: ['c9bd94', 'a99c74', '857a58', '58503a'],
    cover: ['eef3f8', 'd6dfeb', 'b4c2d6', '8795b2'], coverK: .5, coverT: .78},
  rift: {wood: ['6a5680', '4e3e66', '392d4e', '221a31'], metal: ['6c5c8c', '4f4372', '3b3158', '251e39'], clay: ['7a64a8', '5a4886', '433466', '2a2044'],
    stone: ['5e4e88', '46396a', '352b54', '211a36'], rock: ['4f4270', '3c3158', '2d2545', '1c1730'], rope: ['8a78a8', '6a5a88', '4e4268', '2e2644'], cover: null},
};
const EMIT = {rune: {rift: ['ffe0fa', 'ff8ae8', 'c85ad8', '8a4ad8']}, crack: {ember: ['ffe08a', 'ffa040', 'e0541e', '6e1c12']}};
export const FAMS = ['wood', 'metal', 'clay', 'stone', 'rock', 'rope', 'red', 'haz', 'gold', 'void', 'rune', 'crack', 'cover'];
const hexrgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, k) => a.map((x, i) => Math.round(x + (b[i] - x) * k));
const ramp6 = r4 => { const r = r4.map(hexrgb); return [r[0], r[1], r[2], mix(r[3], r[2], .25), r[3], r[2]]; };   // + line, outline_shadow, outline_lit
function palette(biome) {
  const B = PAL[biome], P = {red: ramp6(RED), haz: ramp6(HAZ), gold: ramp6(GOLD)};
  for (const k of ['wood', 'metal', 'clay', 'stone', 'rock', 'rope']) P[k] = ramp6(B[k]);
  const w = P.wood; P.void = [...Array(3).fill(mix(w[4], [0, 0, 0], .3)), ...Array(3).fill(mix(w[4], [0, 0, 0], .45))];
  P.cover = B.cover ? ramp6(B.cover) : P.stone;
  const st = P.stone;
  P.rune = EMIT.rune[biome] ? ramp6(EMIT.rune[biome]) : st;
  P.crack = EMIT.crack[biome] ? ramp6(EMIT.crack[biome]) : [st[3], st[3], st[3], st[4], st[4], st[4]];
  return P;
}
export function rampTexture(biome) {
  const P = palette(biome), data = new Uint8Array(6 * FAMS.length * 4);
  FAMS.forEach((f, j) => P[f].forEach((c, i) => data.set([...c, 255], (j * 6 + i) * 4)));
  const t = new THREE.DataTexture(data, 6, FAMS.length, THREE.RGBAFormat); t.needsUpdate = true;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  const B = PAL[biome];
  return {tex: t, cover: B.cover ? [B.coverK, B.coverT, FAMS.indexOf('cover')] : [0, 1, 0],
    emitFam: [EMIT.rune[biome] ? FAMS.indexOf('rune') : -1, EMIT.crack[biome] ? FAMS.indexOf('crack') : -1], rock: P.rock, cov: B.cover ? P.cover : null};
}

// ---------------------------------------------------------------- helpers
let GT = null;   // the renderer: one texture cache for everything (gfx.js tex)
export const texOf = (img, linear = false) => GT.tex(img, {linear});
const loadImg = src => new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => err(new Error(src)); i.src = src; });
const hsh = (a, b = 0, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
const rgbOf = c => { if (Array.isArray(c)) return c; let s = String(c || '#fff').replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m); const n = parseInt(s, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// glb state -> merged non-indexed geometry with per-part attributes (part index, family, tone bias, fixed tone)
const glbCache = {};
async function loadGlbIndex() { try { return await fetch(GLB + 'index.json').then(r => r.ok ? r.json() : null); } catch { return null; } }
async function glbGeometry(loader, state) {
  if (state in glbCache) return glbCache[state];
  const p = (async () => {
    const gltf = await loader.loadAsync(GLB + state + '.glb'); gltf.scene.updateMatrixWorld(true);
    const parts = []; gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
    const pos = [], nrm = [], aPart = [], aFam = [], aBias = [], aFixed = [];
    const nm = new THREE.Matrix3();
    parts.forEach((m, pi) => {
      const [fam, , bias, flags = ''] = (m.material.name || 'stone|?|0|').split('|');
      const fixed = (flags.match(/fixed(\d)/) || [])[1];
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const P = g.attributes.position, N = g.attributes.normal; nm.getNormalMatrix(m.matrixWorld);
      const v = new THREE.Vector3(), n = new THREE.Vector3();
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); pos.push(v.x, v.y, v.z);
        n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nrm.push(n.x, n.y, n.z);   // per-polygon normals as exported
        aPart.push(pi % 64); aFam.push(Math.max(0, FAMS.indexOf(fam))); aBias.push(+bias || 0); aFixed.push(fixed === undefined ? -1 : +fixed);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('aPart', new THREE.Float32BufferAttribute(aPart, 1)); geo.setAttribute('aFam', new THREE.Float32BufferAttribute(aFam, 1));
    geo.setAttribute('aBias', new THREE.Float32BufferAttribute(aBias, 1)); geo.setAttribute('aFixed', new THREE.Float32BufferAttribute(aFixed, 1));
    geo.computeBoundingSphere();
    return geo;
  })().catch(e => { console.warn('glb', state, e.message); return null; });
  return (glbCache[state] = p);
}
// the arena's kind (+ breakable stage, chest lid) -> prop-kit state (arena/props3d.js frameName; barrels tip and roll
// as real rotations here, so they have no tilt / roll states)
const wallV = p => ((Math.round(p.x * 3) * 7 + Math.round(p.y * 5) * 13) >>> 0) % 4;
const potV = p => ((Math.round(p.x * 7) + Math.round(p.y * 13)) & 1) ? 'pot_b' : 'pot';
export function stateOf(p) {
  switch (p.kind) {
    case 'crate': return p.stage === 2 ? 'crate_broken' : p.stage === 1 ? 'crate_dmg' : 'crate';
    case 'barrel': case 'barrel_x': return p.stage === 2 ? p.kind + '_broken' : p.stage === 1 ? p.kind + '_dmg' : p.kind;
    case 'pot': { const v = potV(p); return p.stage === 2 ? 'pot_broken' : p.stage === 1 ? v + '_dmg' : v; }
    case 'chest': return 'chest_' + Math.max(0, Math.min(4, Math.round((p.lid || 0) * 4)));
    case 'pillar': case 'pillar_broken': case 'rubble': case 'tower': case 'gatepost': return p.kind;
    case 'rock': return 'rock_' + ((p.variant | 0) % 3);
    case 'rock_big': return 'rock_big_' + ((p.variant | 0) % 3);
    case 'wall_n': return 'wall_ew_' + wallV(p);
    case 'wall_s': return 'wall_low_' + wallV(p);
    case 'wall_w': case 'wall_e': return 'wall_ns_' + wallV(p);
  }
  return null;
}
// the 16-yaw pre-renders: state -> [frame base, yaw step offset]
function yawOf(p, st) {
  if (p.kind === 'wall_n') return ['wall_ew_0', 0];
  if (p.kind === 'wall_w' || p.kind === 'wall_e') return ['wall_ew_0', 4];   // a N-S wall is the E-W wall turned 90 deg
  if (['crate', 'barrel', 'pillar', 'tower'].includes(st)) return [st, 0];
  if (st === 'rock_big_0') return ['rock_big_0', 0];
  return null;
}
const WALL_ID = {wall_n: 2, wall_s: 3, wall_w: 4, wall_e: 5};

// ---------------------------------------------------------------- strata texture for the plateau's faces
function strataCanvas(len, hgt, PPM, PPMH, rock, cov, seed) {
  const w = Math.max(1, Math.round(len * PPM)), h = Math.max(1, Math.round(hgt * PPMH)), c = document.createElement('canvas');
  c.width = w; c.height = h; const q = c.getContext('2d'), id = q.createImageData(w, h), d = id.data;
  for (let x = 0; x < w; x++) {
    const hang = cov ? (hsh(Math.floor(x / 6), seed) > .45 ? 1 + (hsh(x, 7, seed) * 4 | 0) : 1) : 0;
    for (let r = 0; r < h; r++) {
      let col;
      if (r < hang) col = cov[r === hang - 1 ? 2 : r ? 1 : 0];
      else {
        const ly = r + Math.round((hsh(Math.floor(x / 14), 94, seed) - .5) * 5), layer = Math.floor(ly / 9), inL = ((ly % 9) + 9) % 9;
        const crackX = hsh(Math.floor(x / 11), layer, 96 + seed) < .35 && x % 11 === (hsh(layer, Math.floor(x / 11), 97 + seed) * 11 | 0);
        const t = r === h - 1 ? 3 : inL === 0 ? (hsh(layer, 5, seed) < .5 ? 0 : 1) : inL >= 7 ? 2 : crackX ? 2 : hsh(layer, 9, seed) < .3 ? 2 : 1;
        col = rock[t];
      }
      const i = (r * w + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  q.putImageData(id, 0, 0); return c;
}

// ---------------------------------------------------------------- build
export async function buildWorld(G, {biome, ctxO, PPM, PPMH, props: keep = null}) {
  GT = G;
  // keep: the live prop list of the previous world (a biome switch): the items must point at the props gameplay uses
  const {WM, HM} = WORLD, layout = buildLayout(7);
  if (keep) layout.props = keep;
  const props = layout.props;
  Object.assign(ctxO, {WM, HM, WPX: Math.ceil(WM * ctxO.PPM), HPX: Math.ceil(HM * ctxO.PPMY), PLAY, layout});
  const disposers = [];
  const R = rampTexture(biome.id);
  G.U.ramps.value = R.tex; G.U.cover.value.set(...R.cover); G.U.emitFam.value.set(...R.emitFam);

  // ---- ground: the biome's painter, top-down
  const WPX = Math.ceil(WM * PPM), HPX = Math.ceil(HM * PPM);
  const ctxT = {PPM, PPMY: PPM, PPMH: 0, toS: (x, y) => [x * PPM, y * PPM], WM, HM, WPX, HPX, PLAY, layout, VW: G.VW, VH: G.VH};
  const gc = document.createElement('canvas'); gc.width = WPX; gc.height = HPX;
  const gq = gc.getContext('2d', {willReadFrequently: true});
  biome.paintGround(gq, ctxT);
  const groundEmit = biome.groundEmit, groundLights = (biome.groundLights || []).slice();
  const gTex = texOf(gc, true), eTex = groundEmit ? texOf(groundEmit, true) : null;
  // the ground's pixels (the waterfall takes the stream's painted colour at the edge)
  const px = gq.getImageData(0, 0, WPX, HPX).data;
  // the grid runs SKIRT m past the world on every side (edge texels stretched outward): the camera keeps the flat
  // ground inside the world, but lowered ground (the south ravine) projects further down the screen than that
  const S = .25, SKIRT = 6, NX = Math.round((WM + 2 * SKIRT) / S), NZ = Math.round((HM + 2 * SKIRT) / S), DROP = -3.5;
  // the south edge, as the biome itself defines it: ruins and ember end in a RAVINE along their cliff line (the biome's
  // hole() is y > cliff(x) - .3 there, or near the stream); frost ends in a flat frozen lake and the rift in its flat void,
  // so they keep their ground. Inside the stream's band the line is interpolated from both banks (the waterfall)
  const RAVINE = new Set(['ruins', 'ember']).has(biome.id);
  const nearStream = (x, y) => Math.abs(x - STREAM.cx(y)) - STREAM.w(y) / 2 < .7;
  const rawCliff = x => { for (let y = HM - 7; y < HM + .5; y += .05) if (biome.hole?.(x, y) && !nearStream(x, y)) return y + .3; return Infinity; };
  const cliffCache = new Map();
  const cliffZ = x => {
    if (!RAVINE) return Infinity;
    const k = Math.round(x * 8); let c = cliffCache.get(k); if (c !== undefined) return c;
    const ys = HM - 2.4, hw = STREAM.w(ys) / 2 + .7, sc = STREAM.cx(ys);
    if (Math.abs(x - sc) < hw) {   // the banks a little outside the band (the stream meanders: right on its edge it's still "near")
      let a = rawCliff(sc - hw - .4), b = rawCliff(sc + hw + .4);
      if (!isFinite(a)) a = b; if (!isFinite(b)) b = a; if (!isFinite(a)) a = b = HM - 2.2;
      c = a + (b - a) * (x - (sc - hw)) / (2 * hw);
    } else c = rawCliff(x);
    cliffCache.set(k, c); return c;
  };
  const hAt = (x, z) => z >= cliffZ(x) ? DROP : inStream(x, z) ? WATER_H : 0;
  // the grid follows the edge exactly: the last bank vertex of each column moves onto the edge line and the next one
  // to just past it at the ravine's depth, so the wall is one smooth face (a plain 0.25 m grid made it a staircase)
  const pos = [], uv = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = i * S - SKIRT; let z = j * S - SKIRT, h;
    const cz = cliffZ(x);
    if (z <= cz && z + S > cz) { z = cz - .001; h = inStream(x, z) ? WATER_H : 0; }   // the lip
    else if (z > cz && z - S <= cz) { z = cz + .02; h = DROP; }                       // the foot
    else h = hAt(x, z);
    pos.push(x, h, z); uv.push(x / WM, z / HM);
  }
  const idx = [];
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const gGeo = new THREE.BufferGeometry(); gGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  gGeo.setIndex(idx); gGeo.computeVertexNormals();
  const world2 = new THREE.Vector2(WM, HM);
  // the south ravine's wall (any steep ground): rock strata with the biome's grass / ash / snow lip, and a WATERFALL where
  // the stream goes over the edge, in the stream's own painted colour (streaks, dark edges, foam at the foot). Indexed by
  // world x (+ SKIRT) and depth below the bank: the ground shader maps it onto the steep cells (gfx.js SURF_FS)
  const CL_H = 3.5, cliff = strataCanvas(WM + 2 * SKIRT, CL_H, PPM, PPMH, R.rock, R.cov, 11);
  {
    const q = cliff.getContext('2d', {willReadFrequently: true}), id = q.getImageData(0, 0, cliff.width, cliff.height), d = id.data, CH = cliff.height;
    // where the stream glows (ember lava: the ground's emit layer), its fall glows too: alpha 250 marks emissive texels
    const ge = groundEmit ? groundEmit.getContext('2d', {willReadFrequently: true}).getImageData(0, 0, groundEmit.width, groundEmit.height).data : null;
    const edgeZ = x => { for (let z = HM - 7; z < HM + SKIRT; z += .05) if (hAt(x, z) < -1) return z; return null; };
    for (let cx = 0; cx < cliff.width; cx++) {
      const x = cx / PPM - SKIRT, ze = edgeZ(x); if (ze === null) continue;
      const zs = ze - .35, off = Math.abs(x - STREAM.cx(zs)) - STREAM.w(zs) / 2;
      if (off > 0) continue;
      const at = z => (Math.min(HPX - 1, Math.max(0, Math.round(z * PPM))) * WPX + Math.min(WPX - 1, Math.max(0, Math.round(x * PPM)))) * 4;
      let gi = at(zs), glows = false;
      if (ge) for (let z = zs - .6; z <= zs; z += 1 / PPM) {   // a glowing stream (lava): its brightest molten pixel near the edge
        const k = at(z); if (ge[k + 3] > 0) glows = true;
        if (px[k] * .3 + px[k + 1] * .55 + px[k + 2] * .15 > px[gi] * .3 + px[gi + 1] * .55 + px[gi + 2] * .15) gi = k;
      }
      if (!glows) gi = at(zs);
      const base = [px[gi], px[gi + 1], px[gi + 2]], edge = off > -.08, streak = hsh(cx, 17) < .3;
      for (let r = 0; r < CH; r++) {
        const k = (r * cliff.width + cx) * 4, foam = r > CH - 6 && hsh(cx, r) < .6, lip = r < 2;
        const m = foam ? .7 : lip ? .45 : edge ? -.3 : streak ? .3 : 0;   // + toward white, - darker
        for (let c = 0; c < 3; c++) d[k + c] = m >= 0 ? base[c] + (255 - base[c]) * m : base[c] * (1 + m);
        d[k + 3] = glows && !edge ? 250 : 255;
      }
    }
    q.putImageData(id, 0, 0);
  }
  const cTex = texOf(cliff); cTex.wrapS = cTex.wrapT = THREE.RepeatWrapping; cTex.needsUpdate = true;
  const ground = G.surface(gGeo, {tex: gTex, em: eTex, planar: true, world: world2, type: 1, obj: 0, cliff: cTex, cliffOff: SKIRT}, false); disposers.push(() => ground.dispose());

  // ---- plateau: top (the painted top, planar) + 4 strata faces
  for (const q of PLATEAUS) {
    const top = new THREE.PlaneGeometry(q.x1 - q.x0, q.y1 - q.y0); top.rotateX(-Math.PI / 2); top.translate((q.x0 + q.x1) / 2, q.h, (q.y0 + q.y1) / 2);
    const t = G.surface(top, {tex: gTex, em: eTex, planar: true, world: world2, type: 1, obj: 1}); disposers.push(() => t.dispose());
    const faces = [   // [len, centre x, centre z, rotation y]
      [q.x1 - q.x0, (q.x0 + q.x1) / 2, q.y1, 0], [q.x1 - q.x0, (q.x0 + q.x1) / 2, q.y0, Math.PI],
      [q.y1 - q.y0, q.x1, (q.y0 + q.y1) / 2, Math.PI / 2], [q.y1 - q.y0, q.x0, (q.y0 + q.y1) / 2, -Math.PI / 2]];
    faces.forEach(([len, cx, cz, ry], k) => {
      const geo = new THREE.PlaneGeometry(len, q.h); geo.translate(0, q.h / 2, 0); geo.rotateY(ry); geo.translate(cx, 0, cz);
      const uvA = geo.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));   // canvas rows go down
      const tex = texOf(strataCanvas(len, q.h, PPM, PPMH, R.rock, R.cov, k + 2), true);
      const f = G.surface(geo, {tex, planar: false, type: 5, obj: 1}); disposers.push(() => f.dispose());
    });
  }

  // ---- props
  const loader = new GLTFLoader(), haveGlb = !!(await loadGlbIndex());
  let yawIdx = null, yawAlb = null, yawNrm = null;
  try {
    yawIdx = await fetch(YAW + 'props.json').then(r => r.ok ? r.json() : null);
    if (yawIdx) [yawAlb, yawNrm] = await Promise.all([loadImg(YAW + `props_${biome.id}.png`), loadImg(YAW + 'props_nrm.png')]);
  } catch { yawIdx = null; }
  const groundL = groundLights.map((l, i) => ({x: l.x, y: l.h || 0, z: l.y, c: rgbOf(l.color), r: l.radius || 3, k: l.intensity ?? 1, flicker: l.flicker || 0, id: 9000 + i}));
  const lights = [];   // rebuilt every frame by sync(): ground lights + whatever the props' current sprites carry
  // ITEMS: one per prop. {p, st (model state), obj (id), live (G.mesh) | card (G.card), sp (painted sprite shown), yaw?,
  //   manageMatrix (a feature poses the mesh itself), hover (0..1 pulse set by the host)}
  const items = [], byProp = new Map(), extra = new Set();
  let nextId = 10;
  const SHADOWLESS = new Set(['tuft']);
  if (haveGlb) await Promise.all([...new Set(props.map(stateOf).filter(Boolean))].map(s => glbGeometry(loader, s)));   // all at once
  const cardOf = (sp, o) => G.card({tex: texOf(sp.img), em: sp.emit ? texOf(sp.emit) : null, w: sp.img.width, h: sp.img.height, px: sp.pivot[0], py: sp.pivot[1], type: 3, bias: .00125, ...o});
  for (const p of props) {
    const z0 = p.z || 0;
    if (p.outside && biome.hole?.(p.x, p.y, ctxO)) continue;   // over the ravine / in the stream
    const sp = biome.sprite(p, ctxO);
    const st = stateOf(p), geo = st && haveGlb ? await glbGeometry(loader, st) : null;
    const obj = WALL_ID[p.kind] ?? nextId++;
    const it = {p, st, obj, sp: null, hover: 0};
    if (geo) {
      it.live = G.mesh(geo, obj, new THREE.Matrix4().makeTranslation(p.x, z0, p.y));
      const yw = yawIdx && yawOf(p, st);
      if (yw && yawIdx.frames[yw[0] + '_y0']) {
        it.yaw = {base: yw[0], off: yw[1], card: G.card({tex: texOf(yawAlb), nrm: texOf(yawNrm), w: 1, h: 1, px: 0, py: 0, type: 7, obj, bias: .00125})};
        it.yaw.card.anchor = new THREE.Vector3(p.x, z0, p.y); it.yaw.card.setVisible(false);
      }
    } else if (sp) {
      it.card = cardOf(sp, {obj, shadow: !SHADOWLESS.has(p.kind)}); it.sp = sp;
      it.card.anchor = new THREE.Vector3(p.x, z0, p.y);
    } else continue;
    items.push(it); byProp.set(p, it);
  }
  disposers.push(() => items.forEach(it => { it.live?.dispose(); it.card?.dispose(); it.yaw?.card.dispose(); }));
  // the later stages (damaged, broken, chest lids, debris chunks) load in the background
  if (haveGlb) loadGlbIndex().then(ix => ix && Object.keys(ix.states).forEach(s => glbGeometry(loader, s)));
  // an item for a prop created later (a feature adds props to world.props: extra crates, respawns)
  async function addItem(p) {
    if (byProp.has(p)) return byProp.get(p);
    const st = stateOf(p), geo = st && haveGlb ? await glbGeometry(loader, st) : null, sp = biome.sprite(p, ctxO), obj = nextId++;
    if (p.dead || byProp.has(p)) return byProp.get(p) || null;   // gone (or added) while the model loaded
    const it = {p, st, obj, sp: null, hover: 0};
    if (geo) it.live = G.mesh(geo, obj, new THREE.Matrix4().makeTranslation(p.x, p.z || 0, p.y));
    else if (sp) { it.card = cardOf(sp, {obj, shadow: !SHADOWLESS.has(p.kind)}); it.sp = sp; } else return null;
    items.push(it); byProp.set(p, it); return it;
  }
  // a prop that leaves the world for good (a killed enemy): its card / mesh go with it
  function removeItem(p) {
    const it = byProp.get(p); if (!it) return;
    it.live?.dispose(); it.card?.dispose(); it.yaw?.card.dispose();
    items.splice(items.indexOf(it), 1); byProp.delete(p);
  }
  function setState(it, st) {
    it.st = st;
    glbGeometry(loader, st).then(geo => { if (geo && it.st === st) it.live.setGeometry(geo); });
  }

  // prop display mode: live 3D meshes, or the 16-yaw pre-renders where they exist (A/B reference)
  let mode = 'live';
  const step = Math.PI / 8;
  function setMode(m) { mode = m; }
  // hooks for features: card(it, sp) -> {sway (px at the top), em (a live emit canvas, re-uploaded every frame)} | null
  const hooks = {card: null};
  const M = new THREE.Matrix4();
  // every frame: follow the props (stage, lid, hop, wobble, flash, gone), collect their lights, pick the yaw frames
  function update(yaw) {
    lights.length = 0; for (const l of groundL) lights.push(l);
    const k0 = -Math.round(yaw / step);
    for (const it of items) {
      const p = it.p, base = p.z || 0, z0 = base + (p.h || 0);
      const sp = biome.sprite(p, ctxO);
      if (sp?.lights) sp.lights.forEach((l, i) => lights.push({x: p.x + (l.dx || 0), y: base + (l.h || 0), z: p.y + (l.dy || 0), c: rgbOf(l.color), r: l.radius || 4,
        k: l.intensity ?? 1, flicker: l.flicker || 0, id: it.obj * 8 + i}));
      const wob = p.wob ? Math.round(Math.sin(p.wob * 18) * p.wob * 2) : 0, flash = Math.min(1, Math.max(p.flash || 0, it.hover || 0));
      const useYaw = mode === 'yaw' && it.yaw && !p.stage && !it.manageMatrix && !p.gone;
      if (it.live) {
        const st = stateOf(p); if (st && st !== it.st) setState(it, st);
        if (!it.manageMatrix) it.live.setMatrix(M.makeTranslation(p.x + wob / PPM, z0, p.y));
        it.live.setVisible(!p.gone && !useYaw); it.live.flash = flash;
      }
      if (it.yaw) {
        it.yaw.card.setVisible(!!useYaw);
        if (useYaw && yawIdx) {
          const k = (((k0 + it.yaw.off) % 16) + 16) % 16, f = yawIdx.frames[`${it.yaw.base}_y${k}`];
          if (f) {
            const AW = yawIdx.size[0], AH = yawIdx.size[1], u = it.yaw.card.u, r = [f[0] / AW, f[1] / AH, f[2] / AW, f[3] / AH];
            u.uRect.value.set(...r); it.yaw.card.g.uniforms.uNrmRect.value.set(...r); u.uSize.value.set(f[2], f[3]); u.uPivot.value.set(f[4], f[5]);
            u.uAnchor.value.set(p.x, z0, p.y); it.yaw.card.flash = flash;
          }
        }
      }
      if (it.card) {
        if (sp && sp !== it.sp) { it.sp = sp; it.card.setSprite({tex: texOf(sp.img), em: sp.emit ? texOf(sp.emit) : null, w: sp.img.width, h: sp.img.height, px: sp.pivot[0], py: sp.pivot[1]}); }
        const u = it.card.u; u.uAnchor.value.set(p.x, z0, p.y); u.uOff.value.set(wob, 0);
        const hk = hooks.card?.(it, sp);
        u.uSway.value = hk?.sway || 0;
        if (hk?.bend) { it.card.g.uniforms.uBend.value = hk.bend; u.uHasBend.value = 1; } else u.uHasBend.value = 0;   // per-row flex (8 weights, bottom -> top)
        if (hk?.em) { it.card.g.uniforms.uEm.value = G.tex(hk.em, {dynamic: true}); it.card.g.uniforms.uHasEm.value = 1; }
        else if (it.sp) { it.card.g.uniforms.uEm.value = it.sp.emit ? texOf(it.sp.emit) : null; it.card.g.uniforms.uHasEm.value = it.sp.emit ? 1 : 0; }
        it.card.flash = flash; it.card.setVisible(!p.gone && !!sp);
      }
    }
  }
  const yawCount = items.filter(it => it.yaw).length, liveCount = items.filter(it => it.live).length, cardCount = items.filter(it => it.card).length;
  return {layout, props, lights, items, setMode, update, hooks, addItem, removeItem, get mode() { return mode; }, yawCount, liveCount, cardCount, haveGlb, groundCanvas: gc,
    itemOf: p => byProp.get(p) || null,
    glb: state => glbGeometry(loader, state),                   // Promise<geometry | null> (debris chunks, ...)
    // an extra live mesh owned by a feature (debris chunks): dispose it when done; a rebuild (biome switch) disposes the rest.
    // It doesn't block point lights unless o.occlude (tumbling chunks next to a blast threw black spikes everywhere)
    mesh: (geo, matrix, o = {}) => {
      const m = G.mesh(geo, nextId++, matrix || new THREE.Matrix4()), d = m.dispose; extra.add(m); m.dispose = () => { extra.delete(m); d(); };
      if (!o.occlude) m.sm.layers.disable(1);
      return m;
    },
    waterH: WATER_H, biome, ctxO, dispose() { disposers.forEach(f => f()); [...extra].forEach(m => m.dispose()); }};
}
export {WORLD, PLAY, TRAIL, elev, inStream, PLATEAUS};
