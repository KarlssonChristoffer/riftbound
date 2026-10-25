// FIRST PERSON HANDS: what he holds, seen from his own eyes (features/chasecam.js first person: his body isn't drawn), as pixel
// art on the HD overlay at the game's own art pixel (sc: one art px = sc screen px), bottom of the screen like any first person
// game's. What's in his hands is read from the sim each frame (nothing of it is owned here):
//   gun      the revolver drawn (sim/player/gun.js S.out): the right hand at the bottom right, the barrel toward the crosshair;
//            a shot kicks it (player.shoot) with a flash at the muzzle, a reload drops it out of sight, holstered: gone
//   bow      the Ranger's bow in his left hand: lowered and tilted at rest, raised to the middle as he draws (P.state draw, P.t),
//            the string pulled back toward you with the arrow on it pointing at the crosshair; it snaps on the release
//   axe      the axe out (sim/player/tool.js S.on): carried at the bottom right; a swing (S.mode chop, S.t) cocks it back, cuts
//            down across the screen at the blow (TUNE.swing.hit) and comes back up
//   fists    the fists selected (sim/player/fists.js): both fists low, up in the guard; a punch (S.ph throw) drives that fist
//            in toward the middle
//   lasso    a lasso in hand (sim/player/lasso.js S.mode): the coil in his right hand; spinning, the loop goes round over him
//   lantern  his lantern lit (host.lantern) and the left hand free: it hangs in the left hand, the glass glowing
// They bob with his steps (P.ph), lag a little behind a turn of the look, go down out of the way for a roll, a climb, a fall, a
// swim; the light on them is the scene's (host.mood.amb; the lantern's warm light near it; dark down in the cave).
// The sprites are painted once in code (flat shapes, snapped to their own colours, a dark outline: no smoothing) and drawn
// with drawImage scaled to whole art pixels; a light's tint is made once per tint (a few kept), not per frame.
//   const H = createHands(host); H.view(dt, evs) after the steps; H.draw(q, sc, look) on the HD overlay
// OWNS: its sprites, its springs (bob, sway, kick). READS: host.P / PL / weapon / mood / lantern / yaw, features/fishing.js,
//   features/caves.js under.  BUDGET: a few drawImage calls a frame.
import {clamp} from '../core/mathx.js';

const SKIN = ['#f2c7a0', '#d49c74', '#a46c4a'], WOOD = ['#c08a52', '#8e5e34', '#5e3c20'], STEEL = ['#d6dde3', '#9aa3ac', '#5c646c', '#33383e'];
const DUSTER = ['#8e6a46', '#6c4c30', '#4a321e'], RANGER = ['#6a8452', '#4c643c', '#33462a'], LEATHER = ['#7a5232', '#53361e'];
const ROPE = ['#d8b678', '#a8844c'], BRASS = ['#e8c46a', '#a8823a'], GLOW = ['#fff3c0', '#ffc860'], LINE = '#1a1310';
const HIDE = new Set(['roll', 'climb', 'mantle', 'rope', 'swim', 'fall', 'knock', 'leap', 'vault', 'launched', 'floored', 'hold']);

// ------------------------------------------------------------------ painting (once)
function paint(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), used = [];
  const col = s => { if (!used.includes(s)) used.push(s); g.fillStyle = g.strokeStyle = s; };
  const P = {
    poly(pts, s) { col(s); g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); g.fill(); },
    oval(x, y, rx, ry, s) { col(s); g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); },
    line(x0, y0, x1, y1, w, s) { col(s); g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); },
    ring(x, y, rx, ry, w, s) { col(s); g.lineWidth = w; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.stroke(); },
    curve(x0, y0, cx, cy, x1, y1, w, s) { col(s); g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke(); },
    rect(x, y, w, h, s) { col(s); g.fillRect(x, y, w, h); },
  };
  fn(P);
  crisp(g, w, h, used.map(hex));
  return c;
}
const hex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
// every pixel to one of the colours painted (or clear), then a dark outline round what's there
function crisp(g, w, h, pal) {
  const im = g.getImageData(0, 0, w, h), d = im.data, solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4; if (d[j + 3] < 110) { d[j + 3] = 0; continue; }
    let best = pal[0], bd = 1e9;
    for (const c of pal) { const e = (c[0] - d[j]) ** 2 + (c[1] - d[j + 1]) ** 2 + (c[2] - d[j + 2]) ** 2; if (e < bd) { bd = e; best = c; } }
    d[j] = best[0]; d[j + 1] = best[1]; d[j + 2] = best[2]; d[j + 3] = 255; solid[i] = 1;
  }
  const L = hex(LINE);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (solid[i]) continue;
    if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) { const j = i * 4; d[j] = L[0]; d[j + 1] = L[1]; d[j + 2] = L[2]; d[j + 3] = 255; }
  }
  g.putImageData(im, 0, 0);
}
// a sprite turned by a (rad) about its pivot (px, py), nearest pixel (no smoothing): -> {c, px, py} (the pivot in the new one)
function turned(src, px, py, a) {
  const r = Math.ceil(Math.hypot(Math.max(px, src.width - px), Math.max(py, src.height - py))) + 1, c = document.createElement('canvas');
  c.width = c.height = r * 2; const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.translate(r, r); g.rotate(a); g.drawImage(src, -px, -py);
  return {c, px: r, py: r};
}
const mirrored = src => { const c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const g = c.getContext('2d'); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0); return c; };

// a fist from behind (knuckles up), its sleeve coming in from the bottom right
function fistArm(P, x, y, sl) {
  P.poly([x + 30, y + 46, x + 6, y + 46, x + 2, y + 24, x + 16, y + 18, x + 30, y + 22], sl[1]);
  P.poly([x + 30, y + 46, x + 18, y + 46, x + 22, y + 26, x + 30, y + 26], sl[2]);
  P.poly([x + 2, y + 24, x + 16, y + 18, x + 18, y + 24, x + 4, y + 30], sl[0]);
  P.oval(x + 9, y + 15, 9, 8, SKIN[1]); P.oval(x + 7, y + 12, 6, 4, SKIN[0]);
  P.line(x + 2, y + 15, x + 15, y + 13, 1, SKIN[2]); P.line(x + 3, y + 19, x + 15, y + 18, 1, SKIN[2]);
}
function sprites() {
  const S = {};
  for (const [k, sl] of [['d', DUSTER], ['r', RANGER]]) {
    // the revolver in the right hand (pivot: the hand; the muzzle at mx, my)
    S['gun' + k] = {c: paint(92, 84, P => {
      P.poly([92, 84, 58, 84, 50, 64, 62, 56, 92, 60], sl[1]); P.poly([92, 84, 72, 84, 70, 66, 92, 66], sl[2]); P.poly([50, 64, 62, 56, 66, 62, 54, 70], sl[0]);
      P.poly([45, 60, 53, 61, 58, 46, 50, 43], WOOD[1]); P.line(48, 58, 53, 46, 1, WOOD[0]);
      P.poly([40, 47, 60, 42, 62, 36, 42, 38], STEEL[2]); P.line(44, 46, 50, 50, 2, STEEL[3]);
      P.oval(48, 38, 8, 6, STEEL[1]); P.line(42, 38, 54, 36, 1, STEEL[2]); P.line(44, 41, 54, 39, 1, STEEL[2]); P.oval(46, 35, 4, 2, STEEL[0]);
      P.poly([43, 35, 39, 41, 14, 25, 17, 19], STEEL[1]); P.line(41, 35, 16, 20, 1, STEEL[0]); P.line(39, 40, 16, 25, 1, STEEL[3]);
      P.rect(15, 16, 3, 3, STEEL[3]); P.poly([57, 34, 61, 27, 64, 29, 60, 37], STEEL[3]);
      P.oval(52, 58, 10, 8, SKIN[1]); P.oval(49, 55, 6, 4, SKIN[0]); P.line(44, 58, 58, 60, 1, SKIN[2]); P.line(45, 62, 57, 64, 1, SKIN[2]);
      P.poly([42, 52, 46, 45, 50, 47, 47, 55], SKIN[0]);
    }), px: 52, py: 58, mx: 14, my: 21};
    // the axe upright in the right hand (pivot: the hand), turned for the swing below
    S['axe' + k] = {c: paint(64, 96, P => {
      P.line(32, 92, 33, 10, 4, WOOD[1]); P.line(31, 90, 32, 12, 1, WOOD[0]);
      P.poly([31, 6, 11, 1, 6, 13, 10, 25, 31, 19], STEEL[1]); P.poly([11, 1, 6, 13, 10, 25, 13, 13], STEEL[0]); P.rect(33, 8, 6, 9, STEEL[2]);
      P.poly([64, 96, 44, 96, 34, 82, 46, 74, 64, 78], sl[1]); P.poly([64, 96, 54, 96, 54, 80, 64, 80], sl[2]); P.poly([34, 82, 46, 74, 48, 80, 38, 86], sl[0]);
      P.oval(33, 74, 9, 8, SKIN[1]); P.oval(31, 71, 5, 4, SKIN[0]); P.line(26, 74, 40, 75, 1, SKIN[2]); P.line(27, 78, 39, 79, 1, SKIN[2]);
    }), px: 33, py: 74};
    S['fist' + k] = {c: paint(32, 48, P => fistArm(P, 0, 0, sl))};
    // the lasso's coil in the right hand
    S['coil' + k] = {c: paint(48, 60, P => {
      P.poly([48, 60, 24, 60, 18, 40, 30, 34, 48, 38], sl[1]); P.poly([48, 60, 36, 60, 38, 42, 48, 42], sl[2]);
      P.ring(16, 30, 11, 13, 3, ROPE[1]); P.ring(15, 29, 9, 11, 1, ROPE[0]);
      P.oval(22, 34, 9, 8, SKIN[1]); P.oval(20, 31, 5, 4, SKIN[0]); P.line(15, 34, 28, 35, 1, SKIN[2]);
    })};
  }
  // the bow in the left hand, upright (pivot: the grip); the string's ends at its tips (sx, y0 / y1)
  S.bow = {c: paint(64, 150, P => {
    P.curve(42, 3, 2, 75, 42, 147, 5, WOOD[1]); P.curve(41, 4, 4, 75, 41, 146, 1, WOOD[0]);
    P.poly([0, 150, 0, 104, 12, 84, 24, 92, 18, 150], RANGER[1]); P.poly([0, 150, 0, 120, 8, 112, 10, 150], RANGER[2]);
    P.rect(12, 64, 8, 22, LEATHER[1]); P.oval(17, 76, 8, 9, SKIN[1]); P.oval(15, 72, 4, 4, SKIN[0]); P.line(11, 74, 24, 74, 1, SKIN[2]); P.line(11, 79, 23, 79, 1, SKIN[2]);
  }), px: 17, py: 76, sx: 42, y0: 4, y1: 146};
  S.pull = {c: paint(26, 30, P => { P.poly([26, 30, 8, 30, 4, 16, 14, 12, 26, 14], RANGER[1]); P.oval(9, 10, 7, 6, SKIN[1]); P.oval(7, 8, 4, 3, SKIN[0]); P.line(3, 11, 14, 11, 1, SKIN[2]); })};
  // the lantern in the left hand (its glass lit apart: no tint)
  S.lantern = {c: paint(40, 64, P => {
    P.poly([0, 64, 0, 40, 10, 30, 20, 36, 14, 64], DUSTER[1]);
    P.oval(18, 24, 7, 6, SKIN[1]); P.oval(16, 22, 4, 3, SKIN[0]);
    P.curve(20, 26, 26, 30, 26, 36, 2, STEEL[3]); P.rect(18, 36, 18, 4, BRASS[1]); P.rect(19, 40, 16, 16, STEEL[3]); P.rect(21, 42, 12, 12, GLOW[1]);
    P.rect(18, 56, 18, 4, BRASS[1]); P.rect(20, 37, 14, 1, BRASS[0]);
  })};
  S.glass = {c: paint(12, 12, P => { P.rect(0, 0, 12, 12, GLOW[1]); P.rect(3, 2, 6, 8, GLOW[0]); })};
  S.flash = {c: paint(22, 22, P => {
    P.poly([11, 0, 14, 8, 22, 11, 14, 14, 11, 22, 8, 14, 0, 11, 8, 8], '#ffb040'); P.poly([11, 4, 13, 9, 18, 11, 13, 13, 11, 18, 9, 13, 4, 11, 9, 9], '#fff2b0');
  })};
  // the axe's swing: turned once every AXE_STEP deg from AXE_A0 to AXE_A1 (the hand the pivot)
  for (const k of ['d', 'r']) { const A = S['axe' + k]; A.turns = []; for (let a = AXE_A0; a <= AXE_A1; a += AXE_STEP) A.turns.push(turned(A.c, A.px, A.py, a * Math.PI / 180)); }
  // the bow lowered at rest, then raised: turned BOW_N steps from BOW_REST deg to upright
  S.bow.turns = []; for (let i = 0; i <= BOW_N; i++) S.bow.turns.push(turned(S.bow.c, S.bow.px, S.bow.py, BOW_REST * (1 - i / BOW_N) * Math.PI / 180));
  S.fistdL = {c: mirrored(S.fistd.c)}; S.fistrL = {c: mirrored(S.fistr.c)};
  return S;
}
const WHITE = [1, 1, 1], step15 = c => Math.round(clamp(c, .2, 1) * 15) * 17;
// the draw's target (set each frame: no closure made per frame)
const DQ = {q: null, sc: 1, tint: null, K: null};
function put(c, x, y, tinted = true) {
  const K = DQ.K, s = tinted ? DQ.tint(c, K.r, K.g, K.b) : c, sc = DQ.sc;
  DQ.q.drawImage(s, Math.round(x) * sc, Math.round(y) * sc, s.width * sc, s.height * sc);
}
const AXE_A0 = -50, AXE_A1 = 90, AXE_STEP = 10, BOW_N = 6, BOW_REST = -38;

// ------------------------------------------------------------------ the light on them: a sprite tinted (made on change)
function tinter() {
  const cache = new Map();
  return function tint(src, r, g, b) {
    const key = r * 1e6 + g * 1e3 + b; let m = cache.get(src); if (!m) cache.set(src, m = new Map());
    let c = m.get(key); if (c) return c;
    if (m.size > 12) m.clear();
    c = document.createElement('canvas'); c.width = src.width; c.height = src.height; const q = c.getContext('2d');
    q.drawImage(src, 0, 0); q.globalCompositeOperation = 'multiply'; q.fillStyle = `rgb(${r},${g},${b})`; q.fillRect(0, 0, c.width, c.height);
    q.globalCompositeOperation = 'destination-in'; q.drawImage(src, 0, 0);
    m.set(key, c); return c;
  };
}

export function createHands(host) {
  let S = null;   // the sprites (painted on the first draw)
  const tint = tinter();
  // springs: down (0 shown .. 1 out of sight), the bob, the look's lag, a kick, the flash, the bow's raise, the string's snap
  const K = {down: 1, swayX: 0, swayY: 0, kick: 0, flash: 0, raise: 0, snap: 0, yaw: NaN, look: NaN, punchL: 0, punchR: 0, spin: 0, held: '', r: 255, g: 255, b: 255};
  let caves = null, fishing = null, deagle = null;
  function held() {
    const PL = host.PL, P = host.P;
    if (PL.lasso && PL.lasso.mode && PL.lasso.mode !== 'preview') return 'lasso';
    if ((fishing ??= host.feature('fishing') || false) && fishing.fishing) return '';   // (the rod: drawn in the world, features/fishing.js)
    if (PL.tool?.S.on) return 'axe';
    if (PL.fists?.on) return 'fists';
    const w = host.weapon;
    if (w?.kind === 'gun') return PL.gun?.S.out || P.state === 'draw' ? 'gun' : '';
    if (w?.kind === 'bow') return 'bow';
    return '';
  }
  return {
    // after the steps: a shot kicks the gun, an arrow let go snaps the string
    view(dt, evs) {
      for (let i = 0; i < evs.length; i++) { const e = evs[i]; if (e.type === 'player.shoot') { K.kick = 1; K.flash = .07; } }
    },
    draw(q, sc, look, dt) {
      S ??= sprites();
      const P = host.P, PL = host.PL, W = q.canvas.width / sc, H = q.canvas.height / sc, now = held();
      dt = Math.min(dt || 0, .1);
      // out of the way (a roll, a climb, a swim...), and between two things held: down, then up with the new one
      const away = HIDE.has(P.state) || (P.sink || 0) > .55 || host.lock || now !== K.held;
      K.down = clamp(K.down + (away ? dt * 6 : -dt * 4), 0, 1);
      if (K.down >= 1) K.held = now;
      // the look's lag (turning right: the hands trail left) and the step's bob
      if (K.yaw === K.yaw) {
        const dy = ((host.yaw - K.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        K.swayX = clamp(K.swayX + dy * 140, -14, 14); K.swayY = clamp(K.swayY - (look - K.look) * 140, -10, 10);
      }
      K.yaw = host.yaw; K.look = look;
      const e = Math.exp(-dt * 9); K.swayX *= e; K.swayY *= e;
      const moving = P.state === 'move' ? clamp(Math.hypot(P.vx, P.vy) / 4, 0, 1.4) : 0, ph = (P.ph || 0) * Math.PI * 2;
      const bx = K.swayX + Math.sin(ph) * 2.5 * moving, by = K.swayY + Math.abs(Math.cos(ph)) * 3 * moving + K.down * 90;
      K.kick = Math.max(0, K.kick - dt * 7); K.flash = Math.max(0, K.flash - dt); K.snap = Math.max(0, K.snap - dt * 5);
      if (!K.held || K.down >= 1) return;
      // the light: the scene's ambient (dark in the cave), the lantern's warmth near it
      const m = host.mood, a = m?.amb || WHITE, u = (caves ??= host.feature('caves') || false) ? caves.under || 0 : 0;
      const lit = clamp(.35 + .9 * (.3 * a[0] + .55 * a[1] + .15 * a[2]), .3, 1) * (1 - .55 * u), lan = host.lantern ? .55 : 0;
      K.r = step15(lit * (a[0] * .4 + .6) + lan * .35); K.g = step15(lit * (a[1] * .4 + .6) + lan * .22); K.b = step15(lit * (a[2] * .4 + .6) + lan * .05);
      q.imageSmoothingEnabled = false; DQ.q = q; DQ.sc = sc; DQ.tint = tint; DQ.K = K;
      const k = host.weapon?.kind === 'gun' ? 'd' : 'r';
      if (K.held === 'gun') {
        const G = S['gun' + k], rl = PL.gun?.reloading ? 1 : 0;
        K.raise += ((rl ? 1 : 0) - K.raise) * (1 - Math.exp(-dt * 10));
        const x = W - G.c.width + 4 + bx + K.kick * 5, y = H - G.c.height + 6 + by + K.kick * 3 - K.kick * K.kick * 6 + K.raise * 60;
        if (!(deagle ??= host.feature('deagle') || false).fp) {   // (features/deagle.js draws its own 3D gun instead)
          put(G.c, x, y);
          if (K.flash > 0) put(S.flash.c, x + G.mx - 11, y + G.my - 11 - 2, false);
        }
      } else if (K.held === 'bow') {
        // drawn: P.t into the draw; let go: the string snaps
        const drawn = P.state === 'draw' ? clamp(P.t * 1.6, 0, 1) : 0;
        if (P.state === 'release' && K.raise > .5) K.snap = 1;
        K.raise += ((P.state === 'draw' ? 1 : P.state === 'release' ? .8 : 0) - K.raise) * (1 - Math.exp(-dt * 12));
        const B = S.bow, i = Math.round(K.raise * BOW_N), R = B.turns[i], gx = W * .5 - 46 + (1 - K.raise) * -60 + bx, gy = H * .5 + 30 + (1 - K.raise) * 70 + by;
        put(R.c, gx - R.px, gy - R.py);
        if (K.raise > .6) {   // the string from the tips to the pulled hand, the arrow on it (upright: the turn's last step)
          const sx = gx - B.px + B.sx, t0 = gy - B.py + B.y0, t1 = gy - B.py + B.y1, nx = sx + drawn * 26 + K.snap * 3, ny = gy + 4 + drawn * 14;
          pxLine(q, sc, sx, t0, nx, ny, '#d9d2bf'); pxLine(q, sc, nx, ny, sx, t1, '#d9d2bf');
          if (drawn > .05) {
            const ax = W * .5, ay = H * .5, hx = nx + (ax - nx) * .82, hy = ny + (ay - ny) * .82;
            pxLine(q, sc, nx, ny, hx, hy, '#c9a46c'); pxLine(q, sc, nx - 1, ny + 1, hx - 1, hy + 1, '#7a5a30');
            q.fillStyle = '#9aa3ac'; q.fillRect(Math.round(hx - 1) * sc, Math.round(hy - 1) * sc, 3 * sc, 3 * sc);
            q.fillStyle = '#c84a3a'; q.fillRect(Math.round(nx + 1) * sc, Math.round(ny - 2) * sc, 2 * sc, 2 * sc); q.fillRect(Math.round(nx + 2) * sc, Math.round(ny + 1) * sc, 2 * sc, 2 * sc);
            put(S.pull.c, nx - 6, ny - 8);
          }
        }
      } else if (K.held === 'axe') {
        // the swing: cocked back, the cut down across at the blow, back up
        const A = S['axe' + k], T0 = PL.tool.S, sw = T0.mode === 'chop' ? T0.t : -1, hit = .26, dur = .62;
        let deg = 8, dx = 0, dy = 0;
        if (sw >= 0) {
          if (sw < hit * .7) { const f = sw / (hit * .7); deg = 8 - 50 * f * f; dy = -8 * f; }
          else if (sw < hit + .08) { const f = (sw - hit * .7) / (hit * .3 + .08); deg = -42 + 132 * f; dx = -60 * f; dy = -8 + 40 * f; }
          else { const f = clamp((sw - hit - .08) / (dur - hit - .08), 0, 1), s = 1 - f; deg = 8 + 82 * s * s; dx = -60 * s * s; dy = 32 * s * s + 20 * Math.sin(Math.PI * f); }
        }
        const R = A.turns[clamp(Math.round((deg - AXE_A0) / AXE_STEP), 0, A.turns.length - 1)];
        put(R.c, W - 52 + dx + bx - R.px, H - 20 + dy + by - R.py);
      } else if (K.held === 'fists') {
        const F0 = PL.fists.S, up = F0.up ? 1 : .35, thr = F0.ph === 'throw' ? 1 : F0.ph === 'wind' || F0.ph === 'charge' ? -.3 : 0;
        const ease = 1 - Math.exp(-dt * 18), left = !!F0.mv && (F0.hand === 'L' || F0.hand === 'B'), right = !!F0.mv && F0.hand !== 'L';
        K.punchL += ((left ? thr : 0) - K.punchL) * ease; K.punchR += ((right ? thr : 0) - K.punchR) * ease;
        const fr = S['fist' + k], fl = S['fist' + k + 'L'], lift = 34 * up;
        put(fl.c, W * .5 - 96 + bx + K.punchL * 60, H - 44 - lift + by - K.punchL * 34);
        put(fr.c, W * .5 + 64 + bx - K.punchR * 60, H - 44 - lift + by - K.punchR * 34);
      } else if (K.held === 'lasso') {
        const C = S['coil' + k], sp = PL.lasso.mode === 'spin', hx = W - C.c.width - 6 + bx, hy = H - C.c.height + 4 + by - (sp ? 30 : 0);
        put(C.c, hx, hy);
        if (sp) {   // the loop round over his head, a rope up to it
          K.spin += dt * 9; const cx = W * .56, cy = H * .2, rx = 46, ry = 11;
          pxLine(q, sc, hx + 16, hy + 18, cx + Math.cos(K.spin) * rx, cy + Math.sin(K.spin) * ry, ROPE[1]);
          q.fillStyle = ROPE[0];
          for (let j = 0; j < 40; j++) { const t = j / 40 * Math.PI * 2; q.fillRect(Math.round(cx + Math.cos(t) * rx) * sc, Math.round(cy + Math.sin(t) * ry) * sc, sc, sc); }
        }
      }
      // the lantern in the left hand while it's free
      if (host.lantern && (K.held === 'gun' || K.held === 'axe' || K.held === 'lasso')) {
        const L = S.lantern, x = 6 + bx * .8, y = H - L.c.height + 8 + by;
        put(L.c, x, y); put(S.glass.c, x + 21, y + 42, false);
      }
    },
  };
}
// a line of art pixels (x, y in art px)
function pxLine(q, sc, x0, y0, x1, y1, col) {
  q.fillStyle = col; const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let i = 0; i <= n; i++) { const t = i / n; q.fillRect(Math.round(x0 + (x1 - x0) * t) * sc, Math.round(y0 + (y1 - y0) * t) * sc, sc, sc); }
}
