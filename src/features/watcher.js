// THE WATCHER (view): early-game unease. Now and then a pale one-eyed toadstool (content/recipes.js `watcher`) rises out of
// the ground behind a tree trunk, in a dark, dense patch at the edge of the view, and WATCHES the player: it turns to face
// them, its eye follows them (darting glances, blinks), it bobs, hops and peeks out round the trunk. It never does anything
// else. Walk at it (or rush it) and it is gone: it yanks itself back under the ground in a spray of dirt. Left alone it sinks
// away after a while; out of sight it leaves.
//   when      a long cooldown (TUNE.every s, shorter at dusk and at night), only in play (not on the title), only where there
//             are trees: with none to hide behind it doesn't come (the open arena, the desert)
//   where     4..10 m away, at a trunk's side and a little behind it (from the camera's side: it leans out round it), on screen but
//             near its edges, scored by how many trees crowd the spot (dark, hidden) and the night; never in water or on a
//             blocked cell
//   motion    springs: the rise overshoots and settles (a bounce), squash and stretch on every move, a hop now and then,
//             a lean out round the trunk; the eye is its own mesh, rolled to look at the player's head
//   leaving   the player within TUNE.flee m, or closing in faster than TUNE.rush m/s: a fast retract (squash, dirt);
//             after TUNE.life s, or the player far off or it off screen for TUNE.lost s: a slow sink
// MULTIPLAYER: private to each player, by design. It is presentation only (no entity, no collider, nothing the sim reads)
// and nothing is synced: each player has their own watcher, which only they see. "It's watching YOU."
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, biomeChanged, toggle, menu; F.summon() (the menu, tests), F.state.
// OWNS: its three meshes (body, eye, pupil), its dirt specks. READS: host.player, host.entities.near (trees), host.elev,
// host.inStream, host.blocked, host.toView, host.time, G.onScreen, the game's mode.
// BUDGET: nothing while it is away (a countdown); while out, a few matrices and ~20 points a frame. No allocation per frame.
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {recipeGeo, recipeOf} from '../world/recipe3d.js';

const R = Math.random, rr = (a, b) => a + R() * (b - a), TAU = Math.PI * 2;
// ---------------------------------------------------------------- tunables
const TUNE = {
  every: [70, 200],          // s between two visits (by day)
  first: 90,                 // s before the first
  night: .5, dusk: .75,      // x that at night / at dusk
  often: [5, 9],             // ?watcher=often: s between visits (testing)
  retry: 6,                  // s to look again when no spot was good
  dist: [4, 10],             // m from the player (the view is ~16 x 9 m at the default zoom)
  trees: 2,                  // trees within crowd m of the spot needed by day (dark, hidden); at night 1 is enough
  crowd: 3.5,
  edge: 14,                  // px inside the screen's edge it may stand at most
  size: [1.05, 1.35],        // x the recipe
  rise: {k: 70, c: 7},       // the rise's spring (1/s^2, 1/s): underdamped, it overshoots and settles
  sink: {k: 6, c: 5},        // the slow sink
  yank: {k: 150, c: 13},     // the retract when nearly caught (gone in ~0.3 s)
  flee: 2.8, rush: 2.2, rushR: 6,   // m; m/s closing in, within rushR m
  life: [15, 40],            // s it stays at most
  far: 14, lost: 4,          // m: the player gone this far; s off screen: it sinks
  turn: 3.5,                 // 1/s: how fast it turns to face the player
  hop: [1.8, 4.5],           // s between hops; a hop's speed up (m/s)
  hopV: 1.1, g: 9,
  peek: [2.5, 6],            // s between leans out round the trunk
  blink: [1.6, 5],           // s between blinks
  dart: [.25, 1.4],          // s between the eye's darting glances
};

export const order = {after: ['wildlife']};
export async function create(host) {
  const F = {name: 'watcher', label: 'The watcher', ambient: false, on: flags.get('watcher') !== '0', ms: 0};
  const THREE = host.THREE, G = host.G, often = flags.get('watcher') === 'often';
  const game = () => host.feature('game');
  // ---------------------------------------------------------------- state (view only)
  const W = {phase: 'away', wait: often ? TUNE.often[0] : TUNE.first,   // (no random draw before its first visit: the other views' draws stay as they were) x: 0, y: 0, gz: 0, s: 1, h: .7,
    up: 0, vu: 0, hopY: 0, hopV: 0, hopIn: 0, sq: 0, yaw: 0, lean: 0, leanTo: 0, peekIn: 0, life: 0, off: 0,
    side: 1, d0: 0, blink: 0, blinkIn: 2, dx: 0, dy: 0, dz: 0, dartIn: .5, rx: 1, ry: 0, fx: 0, fy: -1, params: null, A: null};
  F.state = W;
  // ---------------------------------------------------------------- meshes (made lazily; the world's rebuild disposes them)
  let body = null, eye = null, pupil = null;
  function meshes() {
    if (body) return true;
    const biome = host.biome?.id || 'ruins', pe = {eye: W.params.eye};
    const gb = recipeGeo('watcher', 0, {...W.params, eye: 0}, biome), ge = recipeGeo('watcher_eye', 0, pe, biome), gp = recipeGeo('watcher_pupil', 0, pe, biome);
    if (!gb || !ge || !gp) return false;
    body = host.world.mesh(gb.geo); eye = host.world.mesh(ge.geo); pupil = host.world.mesh(gp.geo);
    for (const m of [body, eye, pupil]) m.setVisible(false);
    return true;
  }
  function drop() { for (const m of [body, eye, pupil]) m?.dispose?.(); body = eye = pupil = null; }
  function hide() { for (const m of [body, eye, pupil]) if (m && m.gm.visible) m.setVisible(false); }
  // ---------------------------------------------------------------- where to come up
  const NEAR = [], NEAR2 = [];
  const isTree = p => p.kind === 'tree' && !p.gone;
  function camAxes() {   // the screen's right and up (away from the camera) on the ground, whatever the camera's yaw
    const P = host.player, o = host.toView(P.x, P.y), ex = host.toView(P.x + 1, P.y), ey = host.toView(P.x, P.y + 1);
    const a = ex[0] - o[0], c = ex[1] - o[1], b = ey[0] - o[0], d = ey[1] - o[1], det = a * d - b * c || 1;
    const rx = d / det, ry = -c / det, fx = b / det, fy = -a / det, rl = Math.hypot(rx, ry) || 1, fl = Math.hypot(fx, fy) || 1;
    W.rx = rx / rl; W.ry = ry / rl; W.fx = fx / fl; W.fy = fy / fl;
  }
  function findSpot(force) {
    const P = host.player, dark = host.time === 'night' ? 1.4 : host.time === 'dusk' ? .6 : 0;
    camAxes();
    let best = -1e9, bx = 0, by = 0, bs = 1;
    for (const t of host.entities.near(P.x, P.y, TUNE.dist[1], NEAR)) {
      if (!isTree(t)) continue;
      // (at the trunk's side and a little behind it: straight behind, the crown hides it whole)
      const tr = t.r || .3, side = R() < .5 ? -1 : 1, k = side * (tr + rr(.28, .4)), back = rr(.15, .35);
      const x = t.x + W.rx * k + W.fx * back, y = t.y + W.ry * k + W.fy * back;
      const d = Math.hypot(x - P.x, y - P.y); if (d < TUNE.dist[0] || d > TUNE.dist[1]) continue;
      if (host.inStream(x, y) || host.blocked(x, y, 0)) continue;
      const gz = host.elev(x, y);
      if (!G.onScreen(x, gz + .5, y, -TUNE.edge)) continue;   // (well inside the view ...)
      let crowd = 0; for (const q of host.entities.near(x, y, TUNE.crowd, NEAR2)) if (q !== t && isTree(q)) crowd++;
      if (!force && crowd + dark < TUNE.trees) continue;
      const edge = G.onScreen(x, gz + .5, y, -host.VW * .3) ? 0 : 1.5;   // (... but not in the middle of it)
      const score = crowd * .8 + edge + dark + R() * 1.2 - Math.abs(d - 7) * .1;
      if (score > best) { best = score; bx = x; by = y; bs = side; }
    }
    if (best === -1e9) return false;
    W.x = bx; W.y = by; W.gz = host.elev(bx, by); W.side = bs;
    return true;
  }
  function come(force = false) {
    if (!findSpot(force)) return false;
    W.params = {h: rr(.55, .9), eye: rr(.9, 1.25), bend: rr(.02, .2)};
    drop(); if (!meshes()) return false;
    W.A = recipeOf('watcher').anchors({...W.params});
    W.s = rr(...TUNE.size); W.h = (W.params.h + .2) * W.s;
    W.phase = 'rise'; W.up = -W.h - .25; W.vu = 0; W.hopY = W.hopV = 0; W.hopIn = rr(...TUNE.hop); W.sq = 0;
    W.yaw = Math.atan2(host.player.x - W.x, host.player.y - W.y) + rr(-.8, .8); W.lean = W.leanTo = 0; W.peekIn = rr(...TUNE.peek);
    W.life = rr(...TUNE.life); W.off = 0; W.blink = 0; W.blinkIn = rr(...TUNE.blink); W.dx = W.dy = W.dz = 0; W.dartIn = .4;
    W.d0 = Math.hypot(host.player.x - W.x, host.player.y - W.y);
    for (let i = 0; i < 8; i++) speck(.6);   // (the ground breaks as it pushes up)
    return true;
  }
  function away() {
    W.phase = 'away'; hide();
    const k = host.time === 'night' ? TUNE.night : host.time === 'dusk' ? TUNE.dusk : 1;
    W.wait = often ? rr(...TUNE.often) : rr(...TUNE.every) * k;
  }
  F.summon = () => come(true);
  // ---------------------------------------------------------------- dirt: a few specks thrown up (view)
  const DIRT = [], DN = 24, DCOL = [[.36, .27, .19], [.24, .18, .13], [.46, .38, .27]], DOPT = [{size: 1}, {size: 2}];
  for (let i = 0; i < DN; i++) DIRT.push({t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, c: 0, o: 0});
  let dirtI = 0;
  function speck(k) {
    const q = DIRT[dirtI++ % DN], a = R() * TAU, s = rr(.3, 1.4) * k;
    q.t = rr(.4, .8); q.x = W.x + Math.cos(a) * .1; q.y = W.y + Math.sin(a) * .1; q.z = W.gz + .03;
    q.vx = Math.cos(a) * s; q.vy = Math.sin(a) * s; q.vz = rr(1, 2.6) * k; q.c = R() * 3 | 0; q.o = R() < .4 ? 1 : 0;
  }
  // ---------------------------------------------------------------- the view step
  F.view = (dt) => {
    for (const q of DIRT) if (q.t > 0) {
      q.t -= dt; q.vz -= TUNE.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const g = host.elev(q.x, q.y); if (q.z < g) { q.z = g; q.vz = 0; q.vx *= .5; q.vy *= .5; }
    }
    const P = host.player;
    if (W.phase === 'away') {
      const g = game(); if (g && g.mode === 'title') return;
      if (host.lock) return;
      if ((W.wait -= dt) > 0) return;
      if (!come()) W.wait = TUNE.retry;
      return;
    }
    const dx = P.x - W.x, dy = P.y - W.y, d = Math.hypot(dx, dy), close = (W.d0 - d) / dt; W.d0 = d;
    // leaving?
    if (W.phase === 'rise' || W.phase === 'watch') {
      W.life -= dt;
      W.off = G.onScreen(W.x, W.gz + .4, W.y, 0) ? 0 : W.off + dt;
      if (d < TUNE.flee || (close > TUNE.rush && d < TUNE.rushR)) {
        W.phase = 'yank'; W.sq = -.45; for (let i = 0; i < 14; i++) speck(1);
      } else if (W.life < 0 || d > TUNE.far || W.off > TUNE.lost) W.phase = 'sink';
    }
    // the body: a spring on how far out of the ground it stands
    const sp = W.phase === 'yank' ? TUNE.yank : W.phase === 'sink' ? TUNE.sink : TUNE.rise, goal = W.phase === 'yank' || W.phase === 'sink' ? -W.h - .3 : 0;
    W.vu += (sp.k * (goal - W.up) - sp.c * W.vu) * dt; W.up += W.vu * dt;
    if (W.phase === 'rise' && Math.abs(W.up) < .01 && Math.abs(W.vu) < .05) W.phase = 'watch';
    if ((W.phase === 'yank' || W.phase === 'sink') && W.up < -W.h - .2) { away(); return; }
    // hops (only while it stands), squash and stretch from its speed
    if (W.phase === 'watch' && (W.hopIn -= dt) < 0 && W.hopY === 0) { W.hopV = TUNE.hopV * rr(.6, 1); W.hopIn = rr(...TUNE.hop); W.sq = -.2; }
    if (W.hopV !== 0 || W.hopY > 0) { W.hopV -= TUNE.g * dt; W.hopY += W.hopV * dt; if (W.hopY <= 0) { W.hopY = 0; W.hopV = 0; W.sq = -.25; } }
    const v = W.vu + W.hopV;
    W.sq += (clamp(v * .12, -.35, .35) - W.sq) * Math.min(1, dt * 10);
    // it turns to face the player, leans out round the trunk now and then
    let a = Math.atan2(dx, dy) - W.yaw; a -= Math.round(a / TAU) * TAU; W.yaw += a * Math.min(1, dt * TUNE.turn);
    if ((W.peekIn -= dt) < 0) { W.leanTo = W.leanTo ? 0 : W.side * (R() < .7 ? rr(.22, .4) : -rr(.1, .2)); W.peekIn = W.leanTo ? rr(.8, 2.2) : rr(...TUNE.peek); }   // (out round the trunk, or tucked behind it)
    W.lean += (W.leanTo - W.lean) * Math.min(1, dt * 4);
    // the eye: darting glances round the player's head, blinks
    if ((W.dartIn -= dt) < 0) { const k = R() < .2 ? .5 : .12; W.dx = rr(-k, k); W.dy = rr(-k, k) * .6; W.dz = rr(-k, k); W.dartIn = rr(...TUNE.dart); }
    if ((W.blinkIn -= dt) < 0) { W.blink = .14; W.blinkIn = rr(...TUNE.blink) * (R() < .25 ? .1 : 1); }   // (sometimes twice)
    if (W.blink > 0) W.blink -= dt;
  };
  // ---------------------------------------------------------------- draw
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), QT = new THREE.Quaternion(), QE = new THREE.Quaternion(), AX = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const V = new THREE.Vector3(), S = new THREE.Vector3(), EP = new THREE.Vector3(), LOOK = new THREE.Vector3(), FWD = new THREE.Vector3(0, 0, 1);
  F.frame = () => {
    for (const q of DIRT) if (q.t > 0) host.point(q.x, q.y, q.z, DCOL[q.c], DOPT[q.o]);
    if (W.phase === 'away' || !body) return;
    if (!body.gm.visible) for (const m of [body, eye, pupil]) m.setVisible(true);
    const s = W.s, sy = 1 + W.sq + Math.sin(performance.now() * .0023) * .03, sx = 1 / Math.sqrt(Math.max(.3, sy));
    Q.setFromAxisAngle(UP, W.yaw); QT.setFromAxisAngle(AX.set(W.fx, 0, W.fy), W.lean); Q.premultiply(QT);   // (the lean tips it toward the screen's right / left)
    M.compose(V.set(W.x + W.rx * W.lean * .5, W.gz + W.up + W.hopY, W.y + W.ry * W.lean * .5), Q, S.set(s * sx, s * sy, s * sx));
    body.setMatrix(M);
    // the eye's centre in the world, then turned to look at the player's head (plus its glance)
    const A = W.A.eye; EP.set(A[0], A[1], A[2]).applyMatrix4(M);
    const P = host.player;
    LOOK.set(P.x + W.dx - EP.x, host.elev(P.x, P.y) + (P.z || 0) + 1.3 + W.dy - EP.y, P.y + W.dz - EP.z).normalize();
    QE.setFromUnitVectors(FWD, LOOK);
    const b = W.blink > 0 ? .12 : 1;
    M.compose(EP, QE, S.set(s, s * b, s)); eye.setMatrix(M); pupil.setMatrix(M);
  };
  F.biomeChanged = () => { body = eye = pupil = null; if (W.phase !== 'away') away(); };   // (the world's rebuild disposed the meshes)
  F.toggle = () => { F.on = !F.on; if (!F.on && W.phase !== 'away') away(); return F.on; };
  F.menu = () => game()?.mode === 'sandbox' ? [{label: 'Summon the watcher', run: () => come(true)}] : [];
  return F;
}
