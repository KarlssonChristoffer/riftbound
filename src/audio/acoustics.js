// ACOUSTICS: the space a sound is heard in, from the world's real shape (docs/AUDIO.md, phase 5). src/audio/audio.js asks it:
//   the ROOM    what surrounds the listener (the player): walls and cliffs close by, trees, a roof, high ground or the open.
//               One of SPACE_REVERBS (open, woods, court, cliffs, room, high; in the desert 'canyon' at the canyon's rim: the
//               biome's own) and the reverb's return level. The shots play dry meanwhile (src/audio/audio.js DRY_SHOT): the room
//               gives them their tail. A new room has to lead for SWITCH s before the
//               reverb changes (the engine cross-fades it)
//   ECHOES      taps(x, y, k, panOf): a loud sound (a shot, a blast, a bell) at (x, y) comes back off the big hard faces round
//               the listener. Per face: the extra path (source -> face -> listener, less the direct path) / 343 m/s later,
//               quieter with the path and by the face (rock, stone, wood or a soil hillside; its height and width), darker
//               with distance, panned from the face's side of the screen. Only taps ECHO.min s late or more: closer faces
//               fuse into the room's reverb (no comb filter, nothing hollow), and taps closer together than ECHO.gap
//               keep the louder one
//   OCCLUSION   occlude(x, y, out): a sound whose straight line to the listener's ear runs through something solid (a wall,
//               the mesa, a hill) is quieter and darker; foliage in the way takes a little
//   THE AIR     rain and snow cover deaden it (snow most: fewer, darker echoes and less reverb), wind scatters the echoes, a
//               fog or a still night carries them further
//   EXPOSURE    how open and high he stands, and the COVER over him (the cleft's chamber): features/audio.js scales the wind's
//               gust layer and the rain by them
// THE MAP (build()): a grid of CELL m over the world: the ground's height (layout elev; the desert's canyon a drop), the highest
// solid top in each cell (the registry's props, once: stone walls, towers, posts, standing stones, the watchtower, crate walls,
// big rocks) and its material, the trees' foliage, the cover. Built when the world is (F.biomeChanged) and again when the
// registry changed (a pulled wall), at most every REBUILD s.
// THE PROBE (update): RAYS level rays from his ear out to RANGE m, PROBE_HZ times a second (or when he has moved PROBE_MOVE m);
// what they meet is the room and its faces (rays that meet a face at about the same distance are one face).
// OWNS: the map, the probe, the room. READS: world/layout.js (WORLD, elev, steep, inCleft), world/world.js topOfProp, the props
//   (build only), the biome (its canyon), host.env (sky, snowCover), host.wind (strength), host.time.
// EMITS: nothing. View only: nothing in the sim reads it.
// BUDGET: view; a probe ~RAYS x RANGE / CELL map reads (~.05 ms) PROBE_HZ times a second, occlusion one line of map reads per
//   positional sound, taps a few multiplies per face; no allocation after build. build(): one pass over the map (ground reads)
//   and one over the props (~2-6 ms, at world builds).
//   const A = createAcoustics({props, biome, env, wind, time}) (getters); A.build(); A.update(dt, {x, y, z});
//   A.room {name, reverb, wetDb, near, open, woods, cover, high, canyon, exposure}; A.taps(...) -> n (A.T[0..n)); A.occlude(...)
import {WORLD, elev, steep, inCleft} from '../world/layout.js';
import {topOfProp} from '../world/world.js';
import {clamp} from '../core/mathx.js';

// the rooms' reverbs (audio/runtime/engine.js buildIR's params: rt RT60 s, pre s, lp0 -> lp1 the tail darkening, hp, er early
// reflections over erSpan s at erGain, width, wet: the return's dB). Dark and diffuse everywhere (audio/forge/RECIPE_GUIDE.md:
// the user's ear: nothing hollow or ringing): the courtyard's early reflections are spread over 70 ms, never a tight comb
export const SPACE_REVERBS = {
  open:   {rt: 1.5, pre: .035, lp0: 2600, lp1: 450, hp: 110, er: 2, erSpan: .12, erGain: .18, width: 1, wet: -9},   // a shot's far roll over open land
  high:   {rt: 1.9, pre: .06, lp0: 2200, lp1: 380, hp: 110, er: 1, erSpan: .2, erGain: .12, width: 1, wet: -11},    // on a height: the faintest, longest roll
  woods:  {rt: .8, pre: .008, lp0: 4200, lp1: 1000, hp: 160, er: 12, erSpan: .07, erGain: .32, width: 1, wet: -3},   // trees all round: dense, short, dark
  court:  {rt: 1.1, pre: .007, lp0: 8000, lp1: 2100, hp: 150, er: 9, erSpan: .07, erGain: .55, width: .9, wet: -1},  // inside walls (the arena)
  cliffs: {rt: 1.3, pre: .022, lp0: 6000, lp1: 1400, hp: 140, er: 6, erSpan: .18, erGain: .45, width: 1, wet: -2},   // under rock faces
  room:   {rt: .5, pre: .003, lp0: 7500, lp1: 2400, hp: 180, er: 10, erSpan: .045, erGain: .42, width: .8, wet: 0},  // a rock chamber
};
// the reverb each room uses per biome (a biome not listed keeps its own reverb: the director's, by biome)
const ROOM_REVERB = {
  ruins: {open: 'open', high: 'high', woods: 'woods', court: 'court', cliffs: 'cliffs', room: 'room', canyon: 'cliffs'},
  desert: {open: 'open', high: 'high', woods: 'woods', court: 'court', cliffs: 'cliffs', room: 'room', canyon: 'canyon'},
};

const CELL = .5, RAYS = 24, RANGE = 90, EAR = 1.5, FACE = .4, PROBE_HZ = 6, PROBE_MOVE = .75, REBUILD = 2, SWITCH = .5, C = 343;
// echoes: at most n taps (n big for k > 1.1: a blast), no earlier than min s, at least gap s apart, none under floor dB; faces
// nearer than dMin m never echo (their taps would be under min for any source)
const ECHO = {n: 3, nBig: 4, min: .055, gap: .04, floor: -30, dMin: 8, max: -4, send: .3};
// materials: what a face keeps of the sound (pressure) and how much darker it sends it back
// (far: the desert canyon's far wall, across the drop: it echoes but doesn't enclose him)
const MAT = {none: 0, rock: 1, stone: 2, wood: 3, soil: 4, far: 5};
const KEEP = [0, .85, .8, .6, .3, .8], DARK = [1, 1, .95, .8, .6, .9];   // (soil: a grassy slope sends most of it up and away)
const STONE = new Set(['wall_n', 'wall_s', 'wall_w', 'wall_e', 'tower', 'gatepost', 'menhir', 'menhir_part', 'pillar', 'pillar_broken', 'ruin',
  'rock_big', 'towerwall', 'fieldwall', 'parapet', 'watchtower']);
const WOOD = new Set(['crate', 'stall', 'chest', 'barrel', 'barrel_x', 'woodpile', 'goods']);
// tops (m over the prop's z) for solid kinds the world gives no top (world.js PROP_TOP / topOfProp)
const TOP_ELSE = {pillar: 3, pillar_broken: 1.6, rock_big: 1.4, crate: .75, chest: .6, barrel: .9, barrel_x: .9};
const RAISED = .9;
// a round solid under SMALL.r m (a boulder, a pillar, a post) scatters more than it sends back: its face x SMALL.k
const SMALL = {r: 1, k: .4};   // a prop under this over the ground isn't a face (crates in ones and twos, low rubble)
// the rooms: a candidate leads by these (the probe's numbers, 0..1)
// (court: faces on 3 of the 4 sides; near: faces nearer than NEAR0 m don't count: the parapet he leans on, the wall at his elbow)
const ROOM = {court: .24, sides: .75, cliffs: .15, woods: .3, high: .45, NEAR0: 1};

export function createAcoustics({props, biome, env, wind, time}) {
  const get = f => (typeof f === 'function' ? f() : f);
  const X0 = WORLD.x0, Y0 = WORLD.y0, NX = Math.ceil(WORLD.WM / CELL), NY = Math.ceil(WORLD.HM / CELL), N = NX * NY;
  const G = new Float32Array(N), T = new Float32Array(N), M = new Uint8Array(N), F = new Uint8Array(N), K = new Uint8Array(N), Z = new Uint8Array(N);   // (Z: a small solid's cell)
  const cellOf = (x, y) => { const i = Math.floor((x - X0) / CELL), j = Math.floor((y - Y0) / CELL); return i < 0 || j < 0 || i >= NX || j >= NY ? -1 : j * NX + i; };
  let built = false, biomeId = '', canyonFar = NaN;   // canyonFar: the desert's canyon's far wall (world y; NaN: none)

  // ---------------------------------------------------------------- the map
  function build() {
    const B = get(biome), hole = B?.hole, P = get(props) || [];
    biomeId = B?.id || '';
    canyonFar = biomeId === 'desert' ? WORLD.y1 + 26 : NaN;   // (the canyon runs along the south edge; its far wall past the view)
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, x = X0 + (i + .5) * CELL, y = Y0 + (j + .5) * CELL;
      let g = elev(x, y); if (hole && y > WORLD.y1 - 4 && hole(x, y)) g -= 20;   // (the desert's canyon: a drop; its creek slot too)
      G[k] = T[k] = g; M[k] = steep(x, y) ? MAT.rock : MAT.soil; F[k] = 0; Z[k] = 0; K[k] = inCleft(x, y) ? 1 : 0;
    }
    for (const p of P) {
      if (p.gone || p.broken) continue;
      if (p.kind === 'tree') { foliage(p.x, p.y, 2.2 + (p.r || .4) * 1.5); continue; }
      const t = topOfProp(p) ?? TOP_ELSE[p.kind]; if (t == null) continue;
      const top = (p.z || 0) + t, mat = WOOD.has(p.kind) ? MAT.wood : STONE.has(p.kind) ? MAT.stone : MAT.stone;
      if (p.rect) raise(p.rect[0], p.rect[1], p.rect[2], p.rect[3], top, mat, 0, 0, 0);
      else if (p.r > 0) raise(p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r, top, mat, p.x, p.y, p.r);
    }
    built = true; probeT = 0; settled = false; L.x = NaN;
  }
  function raise(x0, y0, x1, y1, top, mat, cx, cy, r) {   // a solid's footprint (a rect; a circle when r): its top where it's raised
    const i0 = Math.max(0, Math.floor((x0 - X0) / CELL)), i1 = Math.min(NX - 1, Math.floor((x1 - X0) / CELL));
    const j0 = Math.max(0, Math.floor((y0 - Y0) / CELL)), j1 = Math.min(NY - 1, Math.floor((y1 - Y0) / CELL));
    const r2 = (r + CELL * .5) ** 2;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (r > 0) { const x = X0 + (i + .5) * CELL - cx, y = Y0 + (j + .5) * CELL - cy; if (x * x + y * y > r2) continue; }
      const k = j * NX + i; if (top - G[k] < RAISED || top <= T[k]) continue;
      T[k] = top; M[k] = mat; Z[k] = r > 0 && r < SMALL.r ? 1 : 0;
    }
  }
  function foliage(cx, cy, r) {   // a crown: its leaves over the cells under it (more near its middle)
    const i0 = Math.max(0, Math.floor((cx - r - X0) / CELL)), i1 = Math.min(NX - 1, Math.floor((cx + r - X0) / CELL));
    const j0 = Math.max(0, Math.floor((cy - r - Y0) / CELL)), j1 = Math.min(NY - 1, Math.floor((cy + r - Y0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = X0 + (i + .5) * CELL - cx, y = Y0 + (j + .5) * CELL - cy, d = Math.sqrt(x * x + y * y) / r; if (d >= 1) continue;
      const k = j * NX + i; F[k] = Math.min(255, F[k] + Math.round(255 * (1 - d * d)));
    }
  }

  // ---------------------------------------------------------------- the probe
  const DX = new Float64Array(RAYS), DY = new Float64Array(RAYS);
  for (let r = 0; r < RAYS; r++) { const a = r / RAYS * Math.PI * 2; DX[r] = Math.cos(a); DY[r] = Math.sin(a); }
  const HD = new Float64Array(RAYS), HH = new Float64Array(RAYS), HX = new Float64Array(RAYS), HY = new Float64Array(RAYS), HM = new Uint8Array(RAYS), HZ = new Uint8Array(RAYS);
  // the faces: rays meeting one at about the same distance, joined (P: the nearest point; w: rays; h: its height; s: strength)
  const FACES = Array.from({length: RAYS}, () => ({x: 0, y: 0, d: 0, h: 0, w: 0, mat: 0, small: 0, s: 0}));
  let nFaces = 0;
  // the disk round him (7 m) the woods are read over, and the ring (10 m) for how high he stands
  const DISK = []; for (let y = -7; y <= 7; y += 1.75) for (let x = -7; x <= 7; x += 1.75) if (x * x + y * y <= 49) DISK.push(x, y);
  const room = {name: 'open', reverb: 'open', wetDb: 0, near: 0, sides: 0, open: 1, woods: 0, cover: 0, high: 0, canyon: 0, exposure: 1, rim: Infinity};
  const SIDE = new Uint8Array(4);
  const air = {db: 0, lpfK: 1, wetDb: 0};
  const L = {x: NaN, y: NaN, z: 0};
  let probeT = 0, lead = '', leadT = 0, settled = false;
  function probe(lx, ly, lz) {
    const ear = lz + EAR; let near = 0, openN = 0, rim = Infinity, ring = 0, ringN = 0, lowN = 0; SIDE.fill(0);
    for (let r = 0; r < RAYS; r++) {
      const dx = DX[r], dy = DY[r]; HD[r] = 0;
      for (let s = CELL; s <= RANGE; s += CELL) {
        const x = lx + dx * s, y = ly + dy * s, k = cellOf(x, y);
        if (k < 0) {   // off the map: open, but for the desert's canyon wall across from its rim
          if (canyonFar === canyonFar && dy > .2 && y > WORLD.y1) { const d = s + (canyonFar - y) / dy; if (d <= RANGE) { HD[r] = d; HH[r] = 30; HM[r] = MAT.far; HZ[r] = 0; HX[r] = lx + dx * d; HY[r] = ly + dy * d; } }
          break;
        }
        if (s === 10) { ring += G[k]; ringN++; if (G[k] < lz - 1.5) lowN++; }
        if (G[k] < lz - 8 && s < rim) rim = s;   // (a drop: the canyon's rim)
        if (T[k] > ear + FACE) {   // a face: its top a little further on, its material where it starts
          let top = T[k]; for (let q = 1; q <= 3; q++) { const k2 = cellOf(x + dx * q * CELL, y + dy * q * CELL); if (k2 >= 0 && T[k2] > top) top = T[k2]; }
          HD[r] = s; HH[r] = top - lz; HM[r] = M[k]; HZ[r] = Z[k]; HX[r] = x; HY[r] = y; break;
        }
      }
      if (!HD[r] || HD[r] > 40) openN++;
      else if (HD[r] <= 30 && HD[r] >= ROOM.NEAR0 && HM[r] !== MAT.far) {
        const w = clamp((HH[r] - 1.2) / 1.5, 0, 1); near += w * Math.sqrt(1 - HD[r] / 30) * KEEP[HM[r]] / .8;
        if (w > .3 && HD[r] <= 25) SIDE[(r * 4 / RAYS) | 0]++;
      }
    }
    let fol = 0; for (let q = 0; q < DISK.length; q += 2) { const k = cellOf(lx + DISK[q], ly + DISK[q + 1]); if (k >= 0) fol += F[k]; }
    const kc = cellOf(lx, ly);
    room.near = clamp(near / RAYS, 0, 1); room.open = openN / RAYS; room.sides = ((SIDE[0] > 1) + (SIDE[1] > 1) + (SIDE[2] > 1) + (SIDE[3] > 1)) / 4; room.woods = clamp(fol / (DISK.length / 2) / 255 * 1.6, 0, 1);
    room.cover = kc >= 0 && K[kc] ? 1 : 0; room.rim = rim;
    room.high = ringN ? clamp(((lz - ring / ringN) - .8) / 2, 0, 1) * (lowN / ringN) : 0;
    room.canyon = canyonFar === canyonFar ? clamp(1 - (rim - 2) / 6, 0, 1) : 0;   // (> .5 within 5 m of the rim)
    room.exposure = clamp(.55 + .5 * room.open + .6 * room.high - .6 * room.woods - .8 * room.cover - .5 * room.near, .25, 1.5);
    faces();
  }
  function faces() {   // join neighbouring rays that met a face at about the same distance
    nFaces = 0; let start = 0;
    for (let r = 0; r < RAYS; r++) if (!HD[r] || !HD[(r + RAYS - 1) % RAYS] || !same(r, (r + RAYS - 1) % RAYS)) { start = r; break; }
    let cur = null;
    for (let q = 0; q < RAYS; q++) {
      const r = (start + q) % RAYS, d = HD[r];
      if (!d || d < ECHO.dMin) { cur = null; continue; }
      if (!cur || !same(r, (r + RAYS - 1) % RAYS)) { if (nFaces >= RAYS) break; cur = FACES[nFaces++]; cur.d = Infinity; cur.w = 0; cur.h = 0; }
      cur.w++; if (HH[r] > cur.h) cur.h = HH[r];
      if (d < cur.d) { cur.d = d; cur.x = HX[r]; cur.y = HY[r]; cur.mat = HM[r]; cur.small = HZ[r]; }
    }
    // (its strength: what the material keeps, x its height (full from 2.5 m over his ground) and width (full from 30 deg), both softly)
    for (let f = 0; f < nFaces; f++) { const o = FACES[f]; o.s = KEEP[o.mat] * Math.sqrt(Math.min(1, o.h / 2.5) * Math.min(1, o.w * (360 / RAYS) / 30)) * (o.small && o.w < 3 ? SMALL.k : 1); }
  }
  const same = (a, b) => HD[a] > 0 && HD[b] > 0 && Math.abs(HD[a] - HD[b]) <= Math.max(2.5, .2 * Math.min(HD[a], HD[b]));

  function classify() {   // the room the numbers say, then the reverb for this biome
    const R = room;
    return R.cover ? 'room' : R.canyon > .5 ? 'canyon' : R.near >= ROOM.court && R.sides >= ROOM.sides ? 'court'
      : R.woods >= ROOM.woods && R.woods > R.near * 1.5 ? 'woods' : R.high >= ROOM.high ? 'high' : R.near >= ROOM.cliffs ? 'cliffs' : 'open';
  }
  function airNow() {   // rain and snow cover deaden, wind scatters, a fog or a still night carries
    const E = get(env), sky = E?.sky, W = get(wind), rain = sky?.rain || 0, snow = E?.snowCover || 0, fog = sky?.fog || 0;
    const w = clamp(((W?.strength ?? 1) - .6) / 2, 0, 1), still = get(time) === 'night' && w < .2 ? 1 : 0, carry = Math.max(fog, still);
    air.db = -2.5 * rain - 4 * snow - 2 * w + 1.5 * carry;
    air.lpfK = (1 - .35 * snow) * (1 - .15 * w) * (1 + .12 * carry);
    air.wetDb = -1.5 * rain - 3 * snow;
  }

  // ---------------------------------------------------------------- the API
  const T_ = Array.from({length: ECHO.nBig}, () => ({delay: 0, gainDb: 0, lpf: 0, pan: 0, send: ECHO.send}));
  const A = {
    room, air, CELL, get faces() { return nFaces; }, FACES, T: T_, get built() { return built; },
    build,
    update(dt, l) {
      if (!built) return;
      probeT -= dt;
      const moved = Math.hypot(l.x - L.x, l.y - L.y) > PROBE_MOVE || Math.abs((l.z || 0) - L.z) > .5;
      if (probeT <= 0 || moved || L.x !== L.x) { probeT = 1 / PROBE_HZ; L.x = l.x; L.y = l.y; L.z = l.z || 0; probe(L.x, L.y, L.z); airNow(); }
      const want = classify();
      if (!settled || want === room.name) { room.name = want; settled = true; lead = ''; leadT = 0; }   // (a new world: at once)
      else if (want !== lead) { lead = want; leadT = 0; }
      else if ((leadT += dt) >= SWITCH) { room.name = want; lead = ''; }
      const RV = ROOM_REVERB[biomeId];
      room.reverb = RV ? RV[room.name] : '';
      room.wetDb = air.wetDb;
    },
    // the taps of a loud sound at (sx, sy) (k: how loud, 1 a shot; a blast more): written into A.T, their count returned
    taps(sx, sy, k, panOf) {
      if (!built || L.x !== L.x || !nFaces) return 0;
      const direct = Math.hypot(sx - L.x, sy - L.y), D0 = Math.max(direct, 1.5), n = k > 1.1 ? ECHO.nBig : ECHO.n, kDb = (k - 1) * 6;
      let m = 0;
      for (let f = 0; f < nFaces; f++) {
        const o = FACES[f], path = Math.hypot(sx - o.x, sy - o.y) + o.d, delay = (path - direct) / C;
        if (delay < ECHO.min || o.s <= 0) continue;
        const rel = Math.max(-3 - 12 * Math.log10(Math.max(path, 12) / 12), 20 * Math.log10(D0 / path));   // (a 22 m wall -6 dB, a cliff 60 m off -11)
        const db = Math.min(ECHO.max, rel + 20 * Math.log10(o.s) + air.db + kDb); if (db < ECHO.floor) continue;
        // keep the n loudest, none within ECHO.gap of a louder one (a quieter one that close is replaced)
        let q = -1; for (let z = 0; z < m; z++) if (Math.abs(T_[z].delay - delay) < ECHO.gap) { q = z; break; }
        if (q >= 0) { if (T_[q].gainDb >= db) continue; }
        else if (m < n) q = m++;
        else { let w = 0; for (let z = 1; z < m; z++) if (T_[z].gainDb < T_[w].gainDb) w = z; if (T_[w].gainDb >= db) continue; q = w; }
        const t = T_[q]; t.delay = delay; t.gainDb = db; t.pan = panOf ? panOf(o.x, o.y) : 0; t.send = ECHO.send;
        t.lpf = clamp(9000 * Math.pow(12 / Math.max(path, 12), .75), 800, 7500) * DARK[o.mat] * air.lpfK;
      }
      return m;
    },
    // a sound at (sx, sy) heard through what's between it and the listener -> out {db (<= 0), lpf (Hz | 0: none)}
    occlude(sx, sy, out) {
      out.db = 0; out.lpf = 0;
      if (!built || L.x !== L.x) return out;
      const dx = sx - L.x, dy = sy - L.y, d = Math.hypot(dx, dy); if (d < 2.5 || d > 70) return out;
      const ks = cellOf(sx, sy), h0 = L.z + EAR, h1 = (ks >= 0 ? Math.max(G[ks], 0) : 0) + 1.2;
      let ex = -1, rock = false, fol = 0;
      for (let s = .8; s < d - .8; s += CELL) {
        const k = cellOf(L.x + dx * s / d, L.y + dy * s / d); if (k < 0) continue;
        const e = T[k] - (h0 + (h1 - h0) * s / d); if (e > ex) { ex = e; rock = M[k] === MAT.rock || M[k] === MAT.soil; }
        if (F[k] && s > 1.5) fol += F[k];
      }
      if (ex > .2) { out.db = -(4 + Math.min(6, 5 * (ex - .2))) - (rock ? 2 : 0); out.lpf = 2400 - Math.min(1500, 1000 * ex) - (rock ? 300 : 0); }
      else if (fol > 0) { const f = Math.min(1, fol / 255 * CELL / 6); out.db = -4 * f; out.lpf = 7000 - 3500 * f; }
      return out;
    },
    hud() {
      if (!built) return '';
      let s = `space ${room.name}${lead ? '>' + lead : ''} near ${room.near.toFixed(2)} sides ${room.sides.toFixed(2)} open ${room.open.toFixed(2)} woods ${room.woods.toFixed(2)}`;
      if (room.high > .05) s += ` high ${room.high.toFixed(2)}`;
      if (room.canyon > .05) s += ` canyon ${room.canyon.toFixed(2)}`;
      s += ` faces ${nFaces}`; for (let f = 0; f < Math.min(nFaces, 4); f++) s += ` ${FACES[f].d.toFixed(0)}m`;
      return s;
    },
  };
  return A;
}
