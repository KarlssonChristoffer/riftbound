// FIGHT ART: the pixel sprites of wildlife's fight reactions (features/wildlife/fightlife.js): the scavenging vultures
// (on the ground and circling low) and the night's canids (the desert's coyote, the ruins' fox, the frost's wolf), in
// wildlife.js's own art language (its ART RULES): '0'-'3' = the species ramp [hi, base, shade, outline], letters =
// accents, '.' = empty; every sprite faces RIGHT (left is mirrored); x, y = the anchor pixel (ground frames: between the
// feet; flight frames: the body). 1 texel = 1 screen px, no AA / dither / gradients, outlined in the darkest tone, light
// from the top-left; motion in 2-3 frames that read at 1x (a trot is 3 frames played 0 1 2 1).
// HOW THEY ARE DRAWN: as SILHOUETTES of regions (run lists per row: "9-18# 19u 20-23a" = x 9..18 body, x 19 rust,
// x 20..23 pale), toned by one rule (tone()): the back and the bottom edges take the outline, the top edge the highlight,
// the body's interior goes from base to shade with its depth below the top edge (the light from above), the far side's
// parts ('@') one step darker; a part 1 px wide keeps its tone (a thin leg isn't all outline). Body rows are shared
// between a pose's frames; the legs differ (LEGS blocks).
// Scale: the critters (wildlife.js) are ~0.6 of life size against the player (~52 px for 1.8 m); these are ~0.75 (a
// coyote ~28 px nose to tail, ~18 px to its ears: the player's thigh): bigger than the critters, smaller than life.
// OWNS: the art tables, the palettes per biome. frames(biome) -> [[key, frame, rows, ax, ay]] (pure: no DOM; the atlas is
// fightlife.js's).
// EMIT: a canid's eyes in a '*_g1' / '*_g2' frame catch the light (the eyeshine: the emit layer's pixel at 'e'; the albedo
// keeps the dark eye).

// ---------------------------------------------------------------- silhouettes -> toned rows
// a row's runs: "x0-x1C" or "xC" separated by spaces (C: '#' body, '@' far side, 'a' pale, 'u' rust, 'k' black, 'w' white,
// 'h' bare head (red), 'b' bill, 's' silver, 'e' eye, 'n' nose)
function parse(rows, W) {
  const g = rows.map(() => new Array(W).fill('.'));
  rows.forEach((s, y) => { for (const t of s.split(' ')) { if (!t) continue; const m = /^(\d+)(?:-(\d+))?(.)$/.exec(t); if (!m) throw new Error('fightart: ' + t);
    const a = +m[1], b = m[2] === undefined ? a : +m[2]; for (let x = a; x <= b; x++) g[y][x] = m[3]; } });
  return g;
}
const LIT = {'#': ['0', '1', '1', '2'], '@': ['2', '2', '2', '2'], d: ['2', '2', '2', '2']};   // by depth below the top edge: 0, 1, 2, 3+
const KEEP = {e: 'e', n: '3'};
function tone(g, flat) {
  const H = g.length, W = g[0].length, E = (x, y) => y < 0 || y >= H || x < 0 || x >= W || g[y][x] === '.';
  const out = g.map(r => r.slice());
  for (let x = 0; x < W; x++) {
    let d = 0;
    for (let y = 0; y < H; y++) {
      const c = g[y][x]; if (c === '.') { d = 0; continue; }
      if (KEEP[c]) { out[y][x] = KEEP[c]; d++; continue; }
      const thin = E(x - 1, y) && E(x + 1, y);
      let t = LIT[c] ? LIT[c][Math.min(3, d)] : c;
      if (flat) { if (LIT[c]) t = d ? '2' : '1'; if (E(x, y + 1) && LIT[c]) t = '3'; }
      else if (E(x, y + 1) || (E(x - 1, y) && !thin)) t = '3';
      out[y][x] = t; d++;
    }
  }
  return out.map(r => r.join(''));
}
const trim = rows => { let w = 0; for (const r of rows) { const m = r.replace(/\.+$/, '').length; if (m > w) w = m; } return rows.map(r => r.slice(0, w)); };
// a frame from body rows + leg rows (from row `at`): the body drawn over the legs; sc: the region grid scaled (nearest)
// before it is toned (a bigger cousin: the outlines stay 1 px)
function frame(body, legs, W, at, sc = 1) {
  const H = Math.max(body.length, at + legs.length), g = parse(body.concat(new Array(H - body.length).fill('')), W), L = parse(legs, W);
  for (let y = 0; y < L.length; y++) for (let x = 0; x < W; x++) if (L[y][x] !== '.' && g[y + at][x] === '.') g[y + at][x] = L[y][x];
  return trim(tone(scaled(g, sc)));
}
function scaled(g, sc) {
  if (sc === 1) return g;
  const H = Math.round(g.length * sc), W = Math.round(g[0].length * sc), out = [];
  for (let y = 0; y < H; y++) { const r = [], sy = Math.min(g.length - 1, Math.floor(y / sc)); for (let x = 0; x < W; x++) r.push(g[sy][Math.min(g[0].length - 1, Math.floor(x / sc))]); out.push(r); }
  return out;
}
const drop = (rows, idx) => rows.filter((r, i) => !idx.includes(i));

// ---------------------------------------------------------------- the vulture (a turkey vulture: dark brown-black, a bare
// red head ('h'), an ivory bill ('b'), silver flight feathers under the wings ('s'))
const V_ROWS = {
  // standing hunched: the shoulders high, the small bare red head forward and low, the long tail down behind, pale legs
  stand: [['4-7#', '2-9#', '1-10# 11h', '1-9# 10-12h', '0-9# 11-12h 13b', '0-9#', '0-9#', '0-8#', '0-7#', '1-6#', '4b 6b', '3-4b 6-7b'], 5, 11],
  // tugging at the carcass: the head down and forward, the tail up, the feet braced (two frames: the pull)
  tug: [['', '1-2#', '0-5#', '0-8#', '1-10#', '2-11# 12h', '3-10# 11-12h 13b', '4-9# 11h 12b', '5@ 7#', '4-5@ 7-8#'], 6, 9],
  tug2: [['', '', '0-1#', '0-5#', '0-8#', '1-10#', '2-10# 11-12h', '3-9# 12h 13b', '4@ 6#', '3-4@ 6-7#'], 5, 9],
  // a hop: the wings half open, the feet tucked
  hop: [['6-7h', '5-7h 8b', '1s 4-7# 13s', '0-1s 2-3s 4-9# 11-12s 13s', '1-3s 4-10# 11-12s', '2-3s 4-10# 11s', '4-9#', '5-8#', '5@ 7#'], 6, 8],
  // mantling: the wings spread over the carcass, the head forward and low (a threat to the others)
  mantle: [['', '0s 25s', '0-1s 11-12h 24-25s', '0-3s 10-12h 13b 22-25s', '1-6s 7-14# 15-19s 20-24s', '2-8s 8-15# 16-22s', '5-9s 8-16# 17-20s',
    '9-16#', '9-15#', '10-14#', '11@ 14#', '10-11@ 14-15#'], 12, 11],
  // circling low over a kill (~33 x 8), the wings spread (as wildlife's high vultures and its birds in flight are drawn):
  // broad dark wings in a shallow V, fingered tips, the silver flight feathers along their back edge, the small red head,
  // a short tail. Toned without the back-edge outline (FLAT: a wing 2 px deep isn't all outline). glide, beat up, beat down
  glide: [['0@ 2@ 30@ 32@', '1-2# 3@ 29@ 30-31#', '2-5# 27-30#', '3-9# 23-29#', '4-13# 14-15# 16-17h 18b 19-28#', '5-11s 12-20# 21-27s', '7-10s 14-18# 22-25s', '15-17#'], 16, 4],
  up: [['5@ 27@', '5-6# 26-27#', '6-8# 24-26#', '6-10# 22-26#', '7-12# 13-15# 16-17h 18b 19-25#', '8-11s 12-20# 21-24s', '14-18#', '15-17#'], 16, 4],
  down: [['', '', '', '6-13# 14-15# 16-17h 18b 19-26#', '3-12# 13-19# 20-29#', '1-6s 7-11# 12-20# 21-25# 26-31s', '0@ 2@ 4@ 14-18# 28@ 30@ 32@', '15-17#'], 16, 3],
};

// ---------------------------------------------------------------- the remains: what the carrion birds work at once the body
// has faded (a gunman lies ~10 s, a run's brute is gone at once): a low dark heap, ribs, a little red ('m' meat, 'b' bone)
const REMAINS = {heap: [['3b 6b 8b', '2b 3-4m 5b 6-7m 8b 9-10#', '1-2# 3-8# 4m 7m 9-11#', '0-12#'], 6, 3]};

// ---------------------------------------------------------------- the canids
// body rows (0 ..) and leg blocks (the rows below), per pose / gait. Coyote: the ground row 17, the anchor x 13
const COY = {
  fwd: ['20@ 24#', '19@ 20k 21@ 23# 24u 25#', '19@ 20-23# 24u 25#', '18-22# 23e 24-25#', '18-26# 27n', '9-18# 19u 20-23a 24-25#',
    '5-20# 21-22a', '4-19# 20-21a', '3-5# 7-19# 20a', '3-5# 7-19# 20a', '3-5# 7-10# 11-19# 20a', '3-4k 7-10# 16-20#', '3-4k'],
  look: ['18# 24#', '18# 19u 23u 24#', '18-24#', '18# 19e 20-22# 23e 24#', '18-19# 20-22a 23-24#', '9-19# 20a 21n 22a 23#',
    '5-20# 21-22a', '4-19# 20-21a', '3-5# 7-19# 20a', '3-5# 7-19# 20a', '3-5# 7-10# 11-19# 20a', '3-4k 7-10# 16-20#', '3-4k'],
  down: ['', '', '', '', '', '9-17#', '5-19#', '4-20# 21-22@', '3-5# 7-22# 23#', '3-5# 7-21# 22u 23-24#', '3-5# 7-10# 11-18# 19-20a 21-25#',
    '3-4k 7-10# 16-19# 20a 21-22# 23e 24-25#', '3-4k 20-21a 22-25#', '21-25#', '22-25# 26n'],
  run: ['', '', '25@ 28#', '24@ 25k 26@ 27# 28u 29#', '23-27# 28e 29#', '9-21# 22-30# 31n', '5-23# 24u 25-28a 29#',
    '0-1# 2-22# 23-25a', '0k 1-2# 3-6# 7-21# 22-23a', '7-10# 11-22#', '7-10# 18-21#'],
};
// the leg blocks start at the body's row 12 (run: 11); they go under the body (the body is drawn over them)
const COY_LEGS = {
  stand: ['7-8@ 9-10# 17-18@ 19-20#', '6-7@ 8-9# 17-18@ 19-20u', '6@ 8# 18@ 20u', '7@ 9# 18@ 20u', '7@ 9# 18@ 20u', '7-8@ 9-10# 18-19@ 20-21u'],
  // the near front + far hind forward, the far front + near hind back (the far front lifted)
  trot0: ['7-8@ 9-10# 17-18@ 19-20#', '7-8@ 8-9# 16-17@ 20-21u', '8@ 7# 15-16@ 21u', '9@ 6# 15@ 22u', '9@ 5# 14-15@ 22u', '9-10@ 4-5# 22-23u'],
  // passing: the near front and the far hind folded up
  trot1: ['7-8@ 9-10# 17-18@ 19-20#', '6-7@ 8-9# 17-18@ 19-20u', '7@ 8# 18@ 19-20u', '8@ 9# 18@ 19u', '9# 18@', '9-10# 18-19@'],
  trot2: ['7-8@ 9-10# 17-18@ 19-20#', '6-7@ 9-10# 18-19@ 18-19u', '5@ 10# 19@ 17u', '4@ 11# 20@ 16u', '3-4@ 11# 20@ 15-16u', '11-12# 20-21@'],
};
const COY_RUN = {
  // gathered: all four under the body (the hind legs reaching forward past the front)
  run0: ['8-9@ 10-11# 16-17@ 18-19u', '11@ 12-13# 15@ 17u', '13-14@ 15-16# 16-17u', '', '', ''],
  // stretched: the front legs reaching forward, the hind legs pushing out behind
  run1: ['5-6@ 7-8# 21-22@ 23-24u', '3-4@ 5-6# 23-24@ 25-26u', '1-2@ 3-4# 25@ 27u', '0@ 2#', '', ''],
};
// sitting (the haunches down, the front legs straight, the tail on the ground) and howling (the muzzle up). 'd' = a
// shade line inside the body (the thigh's front edge)
const COY_SIT = {
  sit: [['15@ 19#', '14@ 15k 16@ 18# 19u 20#', '14@ 15-18# 19u 20#', '13-17# 18e 19-20#', '13-21# 22n', '12-14# 15u 16-18a 19-20#', '11-16# 17-18a',
    '9-16# 17a', '8-16# 17a', '7-15# 16-17a', '6-15# 16a', '5-9# 10d 11-15# 16a', '5-8# 9d 10-13# 14@ 15u 16#', '4-8# 9d 10-13# 14@ 15u', '4-8# 9d 10-13# 14@ 15u',
    '3-9# 10d 11-13# 14@ 15u', '0-2k 3-12# 14@ 15-16u', '0-12# 13-14@ 15-16u'], 9, 17],
  howl: [['19#', '18-19# 20n', '17-19# 20a', '16@ 17-18# 19a', '14@ 15k 16@ 17# 18a', '14@ 15-16# 17e 18#', '13-18#', '12-17# 18a', '11-16# 17-18a',
    '9-16# 17a', '8-16# 17a', '7-15# 16-17a', '6-15# 16a', '5-9# 10d 11-15# 16a', '5-8# 9d 10-13# 14@ 15u 16#', '4-8# 9d 10-13# 14@ 15u', '4-8# 9d 10-13# 14@ 15u',
    '3-9# 10d 11-13# 14@ 15u', '0-2k 3-12# 14@ 15-16u', '0-12# 13-14@ 15-16u'], 9, 19],
};

// a canid's frames. V: a cousin made from the coyote's drawing: sc (scale: the wolf), legs (the leg rows dropped: the
// fox's shorter legs; sit: the sitting frames' rows dropped)
function canid(B, L, R, S, ax, ground, V = {}) {
  const W = 34, F = {}, sc = V.sc || 1, dl = V.legs || [], g0 = ground - dl.length;
  const at = g0 - (5 - dl.length), Lg = k => drop(L[k], dl), A = v => Math.round(v * sc), Gr = g => Math.round((g + 1) * sc) - 1;
  F.stand = [frame(B.fwd, Lg('stand'), W, at, sc), A(ax), Gr(g0)];
  for (const k of ['trot0', 'trot1', 'trot2']) F[k] = [frame(B.fwd, Lg(k), W, at, sc), A(ax), Gr(g0)];
  F.look = [frame(B.look, Lg('stand'), W, at, sc), A(ax), Gr(g0)];
  F.sniff = [frame(B.down, Lg('stand'), W, at, sc), A(ax), Gr(g0)];
  F.tug = [frame(B.down, Lg('trot2'), W, at, sc), A(ax), Gr(g0)];
  for (const k in R) F[k] = [frame(B.run, R[k], W, ground - 6, sc), A(ax), Gr(ground - 2)];   // (a gallop's legs as the coyote's: stretched out, the fox's short legs don't show)
  for (const k in S) { const ds = (V.sit || []).map(i => i + (k === 'howl' ? 2 : 0)); F[k] = [trim(tone(scaled(parse(drop(S[k][0], ds), W), sc))), A(S[k][1]), Gr(S[k][2] - ds.length)]; }
  return F;
}
const REM = () => { const F = {}; for (const k in REMAINS) { const [rows, x, y] = REMAINS[k]; F[k] = [trim(tone(parse(rows, 16))), x, y]; } return F; };
const FLAT = {glide: 1, up: 1, down: 1};
const VULT = () => { const F = {}; for (const k in V_ROWS) { const [rows, x, y] = V_ROWS[k]; F[k] = [trim(tone(parse(rows, 34), !!FLAT[k])), x, y]; } return F; };

let ART = null;
export function art() {
  return ART ||= {
    vulture: VULT(),
    remains: REM(),
    coyote: canid(COY, COY_LEGS, COY_RUN, COY_SIT, 13, 17),
    // the ruins' red fox: the coyote's drawing on shorter legs (its own colours: black stockings and ear backs, a white tail tip)
    fox: canid(COY, COY_LEGS, COY_RUN, COY_SIT, 13, 17, {legs: [2, 4], sit: [13, 15]}),
    // the frost's grey wolf: the coyote's drawing a quarter bigger (the outlines kept 1 px)
    wolf: canid(COY, COY_LEGS, COY_RUN, COY_SIT, 13, 17, {sc: 1.25}),
  };
}

// ---------------------------------------------------------------- palettes per biome (+ which species each biome has)
export const FPAL = {
  desert: {
    vulture: {r: ['#4e403a', '#3a2e2a', '#2a2120', '#171112'], h: '#b8473a', b: '#e6dcc0', s: '#8e8a86'},
    coyote: {r: ['#cdb48e', '#a88c68', '#7c644a', '#3a2c22'], u: '#b0784c', a: '#e2d6ba', k: '#231b16', e: '#1a120c', w: '#efe8d8'},
    remains: {r: ['#8a6a50', '#6e5040', '#523a30', '#2a1c18'], m: '#7a2a22', b: '#e8dcc0'},
  },
  ember: {
    vulture: {r: ['#4a3c3c', '#382c2e', '#282022', '#151012'], h: '#a83c30', b: '#d8ccb4', s: '#7e7a7c'},
    remains: {r: ['#6a5048', '#503a34', '#3a2a26', '#1c1412'], m: '#7a2a22', b: '#d8ccb8'},
  },
  ruins: {
    remains: {r: ['#7a6656', '#5e4c40', '#46382e', '#241c18'], m: '#7c2a22', b: '#e2d8c4'},
    fox: {r: ['#e0884a', '#c0642e', '#8e4422', '#3e1c10'], u: '#2a1a14', a: '#f2ece0', k: '#f4f0e8', e: '#140c08', w: '#f4f0e8'},
  },
  frost: {
    remains: {r: ['#7a7e8a', '#5c606e', '#444856', '#22242e'], m: '#7c2a28', b: '#eef0f2'},
    wolf: {r: ['#c6ccd6', '#9aa2b0', '#6e7686', '#2c3038'], u: '#8a8478', a: '#eef0f4', k: '#262a32', e: '#141418', w: '#f4f6f8'},
  },
};
// the eyeshine (emit) by level: g1 dim, g2 bright (a coyote's yellow-green, a fox's amber, a wolf's pale gold)
export const EYESHINE = {coyote: ['#5a6a2a', '#d8e870'], fox: ['#6a4418', '#ffc860'], wolf: ['#6a5c32', '#fff0a8']};
// every frame for a biome: [species, frame, rows, ax, ay]
export function frames(biome) {
  const P = FPAL[biome], A = art(), out = [];
  if (!P) return out;
  for (const sp in P) for (const f in A[sp] || {}) { const [rows, ax, ay] = A[sp][f]; out.push([sp, f, rows, ax, ay]); }
  return out;
}
