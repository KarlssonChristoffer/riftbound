// Procedural dungeon: rooms + corridors on a grid, pathfinding, collision and fog of war.
import {THREE, G, V, rand, randi, TAU} from './core.js';

export const CS = 2; // world units per grid cell

export class GameMap {
  constructor(W = 58, H = 58) {
    this.W = W; this.H = H; this.cells = new Uint8Array(W * H); this.explored = new Float32Array(W * H);
    this.rooms = []; this.generate();
  }
  idx(i, j) { return j * this.W + i; }
  inb(i, j) { return i >= 0 && j >= 0 && i < this.W && j < this.H; }
  floor(i, j) { return this.inb(i, j) && this.cells[this.idx(i, j)] === 1; }
  cellOf(x, z) { return [Math.floor(x / CS), Math.floor(z / CS)]; }
  center(i, j) { return V((i + .5) * CS, 0, (j + .5) * CS); }
  walkable(x, z) { const [i, j] = this.cellOf(x, z); return this.floor(i, j); }
  walkableCircle(x, z, r) { return this.walkable(x - r, z - r) && this.walkable(x + r, z - r) && this.walkable(x - r, z + r) && this.walkable(x + r, z + r); }
  roomAt(x, z) { const [i, j] = this.cellOf(x, z); return this.rooms.find(r => i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h); }

  generate() {
    const {W, H} = this; this.cells.fill(0); this.rooms = [];
    for (let t = 0; t < 600 && this.rooms.length < 13; t++) {
      const w = randi(6, 11), h = randi(6, 11), x = randi(2, W - w - 3), y = randi(2, H - h - 3);
      if (this.rooms.some(r => x < r.x + r.w + 3 && x + w + 3 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y)) continue;
      this.rooms.push({x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1)});
    }
    for (const r of this.rooms) for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) this.cells[this.idx(i, j)] = 1;
    // connect with a minimum spanning tree plus a couple of loops
    const R = this.rooms, inTree = [0], edges = [];
    while (inTree.length < R.length) {
      let best = null;
      for (const a of inTree) for (let b = 0; b < R.length; b++) if (!inTree.includes(b)) {
        const d = Math.hypot(R[a].cx - R[b].cx, R[a].cy - R[b].cy); if (!best || d < best[2]) best = [a, b, d];
      }
      inTree.push(best[1]); edges.push(best);
    }
    for (let k = 0; k < 2; k++) { const a = randi(0, R.length - 1), b = randi(0, R.length - 1); if (a !== b) edges.push([a, b]); }
    for (const [a, b] of edges) this.corridor(R[a], R[b]);
    // pick spawn, boss and miniboss rooms by walking distance
    const spawn = R[0]; const dist = this.bfs(spawn.cx, spawn.cy);
    const byDist = R.map((r, k) => ({r, k, d: dist[this.idx(r.cx, r.cy)]})).sort((a, b) => a.d - b.d);
    this.spawn = spawn; this.boss = byDist[byDist.length - 1].r; this.mini = byDist[Math.floor(byDist.length * .6)].r;
    spawn.kind = 'spawn'; this.boss.kind = 'boss'; if (this.mini !== this.boss) this.mini.kind = 'mini';
    const rest = R.filter(r => !r.kind);
    rest.sort(() => Math.random() - .5);
    const roles = ['elite', 'elite', 'chest', 'shrine', 'ambush', 'cursed'];
    rest.forEach((r, k) => { r.kind = roles[k] || 'pack'; });
  }
  corridor(a, b) {
    const w = randi(2, 3); let x = a.cx, y = a.cy; const hFirst = Math.random() < .5;
    const carve = (i, j) => { for (let dj = 0; dj < w; dj++) for (let di = 0; di < w; di++) if (this.inb(i + di, j + dj) && i + di < this.W - 1 && j + dj < this.H - 1) this.cells[this.idx(i + di, j + dj)] = 1; };
    const stepX = () => { while (x !== b.cx) { carve(x, y); x += Math.sign(b.cx - x); } };
    const stepY = () => { while (y !== b.cy) { carve(x, y); y += Math.sign(b.cy - y); } };
    if (hFirst) { stepX(); stepY(); } else { stepY(); stepX(); } carve(x, y);
  }
  bfs(si, sj, maxD = 1e9) {
    const {W, H} = this, D = new Int16Array(W * H).fill(-1), q = new Int32Array(W * H); let h = 0, t = 0;
    if (!this.floor(si, sj)) return D; D[this.idx(si, sj)] = 0; q[t++] = this.idx(si, sj);
    while (h < t) {
      const c = q[h++], i = c % W, j = (c / W) | 0, d = D[c]; if (d >= maxD) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj; if (!this.floor(ni, nj)) continue; const n = this.idx(ni, nj);
        if (D[n] < 0) { D[n] = d + 1; q[t++] = n; }
      }
    }
    return D;
  }
  // straight-line walkability test used to shortcut paths and for line of sight
  los(a, b, r = .3) {
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.ceil(d / .5);
    for (let k = 1; k <= n; k++) { const t = k / n; if (!this.walkableCircle(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, r)) return false; }
    return true;
  }
  path(from, to) {
    let [ti, tj] = this.cellOf(to.x, to.z); const [fi, fj] = this.cellOf(from.x, from.z);
    if (!this.floor(ti, tj)) { const c = this.nearestFloor(ti, tj); if (!c) return []; [ti, tj] = c; to = this.center(ti, tj); }
    if (this.los(from, to)) return [to.clone()];
    const D = this.bfs(ti, tj); if (D[this.idx(fi, fj)] < 0) return [];
    const cells = []; let i = fi, j = fj;
    for (let guard = 0; guard < 4000 && !(i === ti && j === tj); guard++) {
      let best = null;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const ni = i + di, nj = j + dj; if (!this.floor(ni, nj)) continue;
        if (di && dj && (!this.floor(i + di, j) || !this.floor(i, j + dj))) continue;
        const d = D[this.idx(ni, nj)]; if (d >= 0 && (!best || d < best[2])) best = [ni, nj, d];
      }
      if (!best) break; i = best[0]; j = best[1]; cells.push(this.center(i, j));
    }
    cells[cells.length - 1] = to.clone();
    // string-pull: drop waypoints we can see past
    const out = []; let anchor = from;
    for (let k = 0; k < cells.length; k++) {
      const next = cells[k + 1]; if (next && this.los(anchor, next)) continue;
      out.push(cells[k]); anchor = cells[k];
    }
    return out;
  }
  nearestFloor(i, j) {
    for (let r = 1; r < 6; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (this.floor(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }
  randomIn(room, pad = 1) { return V((room.x + pad + Math.random() * (room.w - pad * 2)) * CS, 0, (room.y + pad + Math.random() * (room.h - pad * 2)) * CS); }
  roomCenter(room) { return V((room.x + room.w / 2) * CS, 0, (room.y + room.h / 2) * CS); }

  // ---------- fog of war ----------
  buildFog(scene) {
    const {W, H} = this; this.fogData = new Uint8Array(W * H * 4);
    for (let k = 0; k < W * H; k++) this.fogData[k * 4 + 3] = 255;
    this.fogTex = new THREE.DataTexture(this.fogData, W, H, THREE.RGBAFormat); this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter; this.fogTex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({map: this.fogTex, transparent: true, depthWrite: false, fog: false});
    const pad = 40, size = W * CS;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m); plane.rotation.x = -Math.PI / 2; plane.position.set(size / 2, 4.6, size / 2); plane.renderOrder = 5; scene.add(plane);
    // solid black skirt around the map so the edges never show
    const skirtM = new THREE.MeshBasicMaterial({color: 0x000000, fog: false});
    for (const [x, z, w, h] of [[size / 2, -pad / 2, size + pad * 2, pad], [size / 2, size + pad / 2, size + pad * 2, pad], [-pad / 2, size / 2, pad, size], [size + pad / 2, size / 2, pad, size]]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), skirtM); s.rotation.x = -Math.PI / 2; s.position.set(x, 4.61, z); scene.add(s);
    }
  }
  reveal(x, z, R = 11) {
    const [ci, cj] = this.cellOf(x, z), rc = Math.ceil(R / CS) + 1; let changed = false;
    for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
      const i = ci + di, j = cj + dj; if (!this.inb(i, j)) continue;
      const d = Math.hypot((i + .5) * CS - x, (j + .5) * CS - z); const v = Math.min(1, Math.max(0, (R - d) / 3));
      const k = this.idx(i, j); if (v > this.explored[k]) { this.explored[k] = v; this.fogData[((this.H - 1 - j) * this.W + i) * 4 + 3] = 255 * (1 - v); changed = true; }
    }
    if (changed) this.fogTex.needsUpdate = true;
  }
  seen(x, z) { const [i, j] = this.cellOf(x, z); return this.inb(i, j) && this.explored[this.idx(i, j)] > .5; }
}
