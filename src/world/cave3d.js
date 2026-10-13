// CAVE3D: the woods' cave as the renderer draws it (world/caves.js has the plan, docs/CAVES.md). Built once per world by world.js.
//   floor   one ground patch over the open (and a little past it, under the walls' feet), on the field's own floor heights, painted
//           by the biome (biome.paintCave(q, ctx): ctx = {PPM, WPX, HPX, X0, Y0, cave}); a biome without a painter: plain rock
//   walls   world/cliffs3d.js rock along the open's outline (caves.js C.walls), split by the way each stretch faces into the open
//           (BINS directions). The stretches that face away from the camera stand between it and the floor: they aren't drawn
//           (update(yaw) picks them when the camera turns; their shadow casters stay, so the lantern still stops at them).
//           Nothing is drawn over the rock: above the walls is the dark
// OWNS: its meshes, its floor's texture.  READS: the cave's plan, the field (elev).
//   const cave = buildCave({G, THREE, C, biome, PPM, fam, texOf, elev, field, disposers}); cave.update(yaw) (each frame: a turn)
import {cliffGeometry} from './cliffs3d.js';

const BINS = 8;
const SHOW = .3;       // a stretch shows while its way into the open . the way to the camera > SHOW (the ones facing it; side-on ones stand
                       // edge-on between him and the camera in a passage that runs toward it, and hide the floor)
const SLOT_IN = 2;     // m past the warp he still counts as in the slot (its side walls all show)
const PORTAL_IN = 1.5; // m before the brow its floor starts (under the woods' slot floor's end, PORTAL_SINK below it: no seam, no fight)
const PORTAL_SINK = .03;
const FLOOR_C = .5;    // m: the floor's grid
const FLOOR_PAST = .9; // m: the floor runs this far past the open (under the walls' feet)

export function buildCave({G, THREE, C, biome, PPM, fam, texOf, elev, field, disposers}) {
  const g = C.grid, D = g.D, H = g.H, k = Math.round(FLOOR_C / g.cell), nxs = Math.floor((g.nx - 1) / k), nys = Math.floor((g.ny - 1) / k);
  // ---- the FLOOR: the grid's cells near the open, its floor heights (the field's own values there)
  const at = (A, i, j) => A[Math.min(g.ny - 1, j * k) * g.nx + Math.min(g.nx - 1, i * k)];
  const near = (i, j) => { for (let b = 0; b <= 1; b++) for (let a = 0; a <= 1; a++) if (at(D, i + a, j + b) < FLOOR_PAST) return true; return false; };
  const vid = new Int32Array((nxs + 1) * (nys + 1)).fill(-1), pos = [], uv = [], idx = [];
  const W = nxs * FLOOR_C, Hh = nys * FLOOR_C;
  const v = (i, j) => { const q = j * (nxs + 1) + i; if (vid[q] < 0) { vid[q] = pos.length / 3; const x = g.x0 + i * FLOOR_C, z = g.y0 + j * FLOOR_C; pos.push(x, at(H, i, j), z); uv.push((x - g.x0) / W, (z - g.y0) / Hh); } return vid[q]; };
  // the PORTAL: the cave just in past the mouth's brow drawn a second time, under the woods' overhang (moved back by OFF), so you see
  // into the cave from outside: the woods' ground hides it everywhere but through the mouth (its face under the brow isn't drawn:
  // biomes.js forestRuins)
  const cm = C.copy, off = C.off, SQ = [0, 0, 0], inPortal = C.inPortal;
  const idxP = [];
  for (let j = 0; j < nys; j++) for (let i = 0; i < nxs; i++) if (near(i, j)) {
    const a = v(i, j), b = v(i + 1, j), c = v(i, j + 1), d = v(i + 1, j + 1); idx.push(a, c, b, b, c, d);
    if (inPortal(g.x0 + (i + .5) * FLOOR_C, g.y0 + (j + .5) * FLOOR_C, cm.brow - PORTAL_IN)) idxP.push(a, c, b, b, c, d);
  }
  const floor = new THREE.BufferGeometry(); floor.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); floor.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  floor.setIndex(idx); floor.computeVertexNormals();
  // its painted ground (a margin of a metre round the grid's box, so the painter's neighbour reads see the same ground at the edges)
  const X0 = g.x0 - 1, Y0 = g.y0 - 1, WPX = Math.ceil((W + 2) * PPM), HPX = Math.ceil((Hh + 2) * PPM);
  const cv = document.createElement('canvas'); cv.width = WPX; cv.height = HPX;
  const q = cv.getContext('2d', {willReadFrequently: true});
  if (biome.paintCave) biome.paintCave(q, {PPM, WPX, HPX, X0, Y0, cave: C, ground: elev});
  else { q.fillStyle = biome.style.rock?.h?.[2] ?? '#3a3631'; q.fillRect(0, 0, WPX, HPX); }
  const tex = texOf(cv, true); tex.needsUpdate = true;
  const fm = G.surface(floor, {tex, planar: true, world: new THREE.Vector2(WPX / PPM, HPX / PPM), origin: new THREE.Vector2(X0, Y0), type: 1, obj: 0, decals: true}, true);
  disposers.push(() => { fm.dispose(); floor.dispose(); tex.dispose(); });
  if (idxP.length) {
    const pp = new Float32Array(pos.length); for (let i = 0; i < pos.length; i += 3) { pp[i] = pos[i] - off[0]; pp[i + 1] = pos[i + 1] - PORTAL_SINK; pp[i + 2] = pos[i + 2] - off[1]; }
    const fp = new THREE.BufferGeometry(); fp.setAttribute('position', new THREE.BufferAttribute(pp, 3)); fp.setAttribute('uv', floor.getAttribute('uv'));
    fp.setIndex(idxP); fp.computeVertexNormals();
    const pm = G.surface(fp, {tex, planar: true, world: new THREE.Vector2(WPX / PPM, HPX / PPM), origin: new THREE.Vector2(X0 - off[0], Y0 - off[1]), type: 1, obj: 0, decals: false}, true);
    disposers.push(() => { pm.dispose(); fp.dispose(); });
  }

  // ---- the WALLS: each loop cut into stretches by the way they face (a normal averaged over ~2 m, so a rough wall doesn't flicker
  // between bins), the stretches of one bin in one mesh
  const runs = Array.from({length: 2 * BINS}, () => []);   // (runs[BINS + b]: the slot copy's, facing b)
  const top = (x, z) => Math.max(field.H(x + .55, z), field.H(x - .55, z), field.H(x, z + .55), field.H(x, z - .55));
  const foot = (x, z) => Math.min(elev(x + .35, z), elev(x - .35, z), elev(x, z + .35), elev(x, z - .35));
  let seed = 211;
  for (const L of C.walls) {
    const n = L.length - 1; if (n < 3) continue;
    const closed = Math.hypot(L[0][0] - L[n][0], L[0][1] - L[n][1]) < .01;
    const seg = i => { const a = L[i], b = L[i + 1]; return [b[0] - a[0], b[1] - a[1]]; };
    const binOf = i => {
      let nx = 0, ny = 0;
      for (let d = -2; d <= 2; d++) { let s = i + d; if (closed) s = (s + n) % n; else if (s < 0 || s >= n) continue; const [tx, ty] = seg(s), l = Math.hypot(tx, ty) || 1; nx += -ty / l; ny += tx / l; }
      const a = Math.atan2(ny, nx); return ((Math.round(a / (2 * Math.PI / BINS)) % BINS) + BINS) % BINS;
    };
    const bins = []; for (let i = 0; i < n; i++) bins.push(binOf(i));
    // (the slot copy's side walls: a set of their own, shown whole while he is in the slot, as the woods' slot's are, so nothing
    // round him changes at the step in; out in the cave they follow the camera like the rest)
    for (let i = 0; i < n; i++) { const a = L[i], b = L[i + 1]; C.slotAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, SQ); if (SQ[2] === 2 && SQ[0] > -.3 && SQ[0] < C.copy.len + .3 && Math.abs(SQ[1]) > C.copy.w / 2 - .4) bins[i] += BINS; }
    // (lone segments of another bin go with their neighbours: no stretch shorter than two segments)
    for (let i = 0; i < n; i++) { const p = bins[(i - 1 + n) % n], nx = bins[(i + 1) % n]; if (bins[i] !== p && p === nx) bins[i] = p; }
    // start a closed loop where its bin changes (a stretch doesn't wrap round the seam)
    let s0 = 0; if (closed) for (let i = 0; i < n; i++) if (bins[i] !== bins[(i - 1 + n) % n]) { s0 = i; break; }
    let cur = null, b = -1;
    for (let t = 0; t < n; t++) {
      const i = (s0 + t) % n;
      if (bins[i] !== b) { if (cur) runs[b].push(cur); b = bins[i]; cur = [L[i]]; }
      cur.push(L[i + 1]);
    }
    if (cur) runs[b].push(cur);
  }
  const o = {fam, rockB: null, cover: null, ladders: []};
  const meshes = [], portal = [];
  const topP = (x, z) => top(x + off[0], z + off[1]), footP = (x, z) => foot(x + off[0], z + off[1]);
  const build = rs => { const geo = rs.length ? cliffGeometry(rs, o) : null; if (!geo) return null; const m = G.mesh(geo, 1, new THREE.Matrix4(), {static: true}); disposers.push(() => { m.dispose(); geo.dispose(); }); return m; };
  for (let b = 0; b < 2 * BINS; b++) {
    const rs = [], rp = [];
    for (const pts of runs[b]) {
      let lo = 1e9; for (const [x, z] of pts) lo = Math.min(lo, foot(x, z));
      const sd = seed++;
      rs.push({pts, top, bot: foot, minBot: lo - .05, base: 0, relief: .5, talus: true, lip: false, dark: () => -.12, seed: sd});
      // (its stretches in the portal, moved back into the woods: the same rock, the same seed)
      let cur = [];
      const flush = () => { if (cur.length > 1) rp.push({pts: cur, top: topP, bot: footP, minBot: lo - .05, base: 0, relief: .5, talus: true, lip: false, dark: () => -.12, seed: sd}); cur = []; };
      for (const [x, z] of pts) { if (inPortal(x, z)) cur.push([x - off[0], z - off[1]]); else flush(); }
      flush();
    }
    meshes.push(build(rs)); portal.push(build(rp));
  }
  const dir = Array.from({length: BINS}, (_, b) => [Math.cos(b * 2 * Math.PI / BINS), Math.sin(b * 2 * Math.PI / BINS)]);
  let yaw0 = NaN, slot0 = null;
  return {
    plan: C,
    // the camera turned: the stretches facing away from it go (toward the camera, world axes: (sin yaw, cos yaw)); p (world x, y):
    // the player, in the slot copy (up to SLOT_IN m past the warp) its side walls all show
    update(yaw, p) {
      const slot = !!p && C.slotAt(p.x, p.y, SQ)[2] === 2 && SQ[0] < C.copy.warp + SLOT_IN;
      if (yaw === yaw0 && slot === slot0) return; yaw0 = yaw; slot0 = slot;
      const cx = Math.sin(yaw), cz = Math.cos(yaw);
      for (let b = 0; b < 2 * BINS; b++) {
        const f = b % BINS, faces = dir[f][0] * cx + dir[f][1] * cz > SHOW;
        if (meshes[b]) meshes[b].gm.visible = (b >= BINS && slot) || faces;
        if (portal[b]) portal[b].gm.visible = b >= BINS || faces;   // (the portal's slot walls stand under the overhang: always)
      }
    },
  };
}
