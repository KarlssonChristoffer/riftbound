// FORAGE (docs/FORAGING.md): picking the forest floor. The forest's own small things (world/forest.js F.decor) that are plants
// (content/forage.js PLANTS: blueberry and lingonberry patches, chanterelle rings, fly agarics) are PATCHES: a patch's id is its
// index in the decor (the same on every client and the co-op server: the plan is the seed's). E facing one in reach (or LMB on
// it) picks it: he crouches a moment (host.PL.hold), the pick lands TUNE.pluck s in, its yield floats up and goes in the pouch,
// Foraging XP. Held E goes on picking every patch he passes within TUNE.walk m. The BERRY COMB (gear, 'forage.comb') picks
// berries without stopping and gives one more. A picked patch looks picked (world/decor3d.js setPicked: a shrub without its
// berries, a mushroom gone) until it GROWS BACK after its days of the world clock (host.env.t; ?regrow= a factor on that);
// chanterelles also come back when rain starts. Offline the picked patches are saved (pack.store('forage'): {seed, p: {i: the
// hour it grows back}}).
// CO-OP (features/coop.js, server/room.mjs, docs/MULTIPLAYER.md): the server owns which patches are picked. A pick ASKS it
// (coop.act('pick', 'd' + i, {lvl})); it checks the patch is there and unpicked and he's in reach, rolls the yield (his gear
// and Foraging level) and tells everyone ({k: 'world', id, s: 'picked', by, n}); the picker's pouch gets n. It grows the patch
// back on its own clock ({s: 'grown'}); a late joiner gets the picked ones in the welcome. Nothing is saved while online.
// Only in the sandbox on the ruins biome (the persistent world) with the forest. ?forage=0 off; ?gathermarks=1 dev dots.
// OWNS: the picked set and its saved part, the pick under way, the grid of patches, the decor's picked look (through its API).
// READS: host.layout.forest (decor, seed), host.world.decor (setPicked), host.env (t, sky.rain), host.mods ('forage.*'), pack,
//   coop (online, act, mail, net.id), host.PL (hold, faceShot, cursorGround, useE, nearInteract, tool).
// GLIMMER (Foraging 5: pack.move('glimmer'), docs/SKILLS.md; view only): crouched (hold C) and still a moment, a wave goes out
// from him and each unpicked patch it passes shows a few dew specks winking, then fading (content/forage.js TUNE.glimmer).
// EMITS: forage.pick, forage.grow.
// BUDGET: sim: a grid lookup (9 cells of 4 m) a step while E is held; the regrowth check once a second over the picked set.
//   View: the decor's look only when the picked set changed; HD: one grid lookup and a prompt a frame near a patch.
import {PLANTS, TUNE, pickYield, regrowHours} from '../content/forage.js';
import {flags} from '../core/flags.js';
import {simRandom, viewRandom} from '../core/rng.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';

const ON = flags.get('forage') !== '0';
const REGROW = (v => v > 0 ? v : 1)(parseFloat(flags.get('regrow')));
const CELL = 4, RAIN = .3, WALK_ZONE = 3;   // m a grid cell; the rain (env sky) that counts as raining; m: E with patches this near walks picking
const key = (i, j) => (i + 4096) * 8192 + j + 4096;

// ORDER (core/features.js): before woodcutting (E at a patch is a pick, not a chop) and fishing (LMB on a patch picks it). That
// puts it before co-op too (woodcutting goes before the gun, the gun before combat, combat before co-op): co-op's mail is read
// a step after it came (coop.mail holds the last step's until co-op's next update)
export const order = {before: ['woodcut', 'fishing']};

export async function create(host) {
  const R = simRandom('forage');   // (its own stream of the session seed: core/rng.js)
  const game = () => host.feature('game'), pack = () => host.feature('pack'), coop = () => host.feature('coop');
  const online = () => !!coop()?.online;
  const active = () => ON && !!D && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const store = () => pack()?.store('forage') || null;

  // ---------------------------------------------------------------- the patches: the decor's plants, by grid cell
  let plan = null, D = null;
  const cells = new Map();   // key(cell) -> [decor index]
  function index() {
    const FP = host.layout?.forest || null; if (FP === plan) return;
    plan = FP; D = FP?.decor || null; cells.clear(); picked.clear(); restored = false; ver++;
    if (!D) return;
    for (let i = 0; i < D.length; i++) {
      if (!PLANTS[D[i][0]]) continue;
      const k = key(Math.floor(D[i][1] / CELL), Math.floor(D[i][2] / CELL)); let L = cells.get(k); if (!L) cells.set(k, L = []); L.push(i);
    }
  }
  const radius = i => PLANTS[D[i][0]].r * D[i][3].s;
  // the patch nearest (x, y) whose edge is within `reach` m and that he could pick (unpicked, not asked, on his level); fx, fy:
  // his facing (unit) when it must be ahead of him (0, 0: any way) -> its index | -1
  function patchNear(x, y, z, reach, fx, fy) {
    let best = -1, bd = 1e9;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), r = Math.ceil((reach + 1.2) / CELL);
    for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      const L = cells.get(key(i, j)); if (!L) continue;
      for (let k = 0; k < L.length; k++) {
        const n = L[k]; if (picked.has(n) || asked.has(n)) continue;
        const dx = D[n][1] - x, dy = D[n][2] - y, d0 = Math.hypot(dx, dy), d = d0 - radius(n);
        if (d > reach || d >= bd) continue;
        if ((fx || fy) && d > .25 && (dx * fx + dy * fy) / (d0 || 1) < .25) continue;
        if (Math.abs(host.elev(D[n][1], D[n][2]) - z) > 1.2) continue;   // (down in the cave, up on a rock: not his)
        bd = d; best = n;
      }
    }
    return best;
  }
  const NEAR = [];
  function treeAhead() {   // (a standing tree within 2 m in front of him: E there is woodcutting's)
    const P = host.player, f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f), L = host.entities.near(P.x, P.y, 2.2, NEAR);
    for (let k = 0; k < L.length; k++) { const p = L[k], dx = p.x - P.x, dy = p.y - P.y, d = Math.hypot(dx, dy); if (p.kind === 'tree' && !p.gone && (d < .8 || (dx * fx + dy * fy) / (d || 1) > .3)) return true; }
    return false;
  }
  const ahead = () => { const P = host.player, f = P.faceAngle; return patchNear(P.x, P.y, P.z, TUNE.reach, Math.sin(f), Math.cos(f)); };
  // the patch under the cursor (its ground point on the patch), if he's in reach of it
  function underCursor() {
    const gv = host.PL.cursorGround?.(); if (!gv) return -1;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw), gx = gv.x * c + gv.y * s, gy = -gv.x * s + gv.y * c, P = host.player;
    const n = patchNear(gx, gy, P.z, .25, 0, 0); if (n < 0) return -1;
    return Math.hypot(D[n][1] - P.x, D[n][2] - P.y) - radius(n) < TUNE.reach + .3 ? n : -1;
  }
  // E and LMB are a pick's only when nothing else has them (a chest, a sign or a fire in reach; a swing; a menu)
  const free = () => { const P = host.player; return !host.lock && !host.paused && !host.BUSY.has(P.state) && !host.PL.tool?.S.mode && !host.PL.nearInteract?.(); };

  // ---------------------------------------------------------------- the sim's state
  const picked = new Map();   // decor index -> the world hour it grows back (co-op: 1, the server keeps the clock)
  const asked = new Map();    // co-op: a patch whose pick was asked of the server -> when (clockT): asked again after 3 s
  const S = {i: -1, t: 0};    // the pick under way: its patch, s into it
  let ver = 0, clockT = 0, growT = 0, wasOn = false, wasOnline = false, restored = false, rainWas = false, byE = false, wantI = -1, lmbI = -1;
  let marks = flags.get('gathermarks') === '1';

  function restore() {   // the saved picks (offline): this forest's, else none
    restored = true; picked.clear(); ver++; rainWas = (host.env?.sky?.rain ?? 0) > RAIN;
    const s = store(); if (!s || !plan) return;
    if (s.seed !== plan.seed) { s.seed = plan.seed; s.p = {}; pack()?.dirty(); return; }
    for (const k in s.p || {}) { const i = +k; if (D[i] && PLANTS[D[i][0]]) picked.set(i, s.p[k]); }
  }
  function save(i, at) {
    if (online()) return;
    const s = store(); if (!s) return;
    s.seed = plan.seed; s.p ??= {};
    if (at === undefined) delete s.p[i]; else s.p[i] = +at.toFixed(3);
    pack()?.dirty();
  }
  const evAt = (type, i, n, mine) => host.events.push({type, x: D[i][1], y: D[i][2], i, kind: D[i][0], n, mine});
  // his pick landed (offline, or the server's word): the pouch, the XP, the sound
  function got(i, n) {
    const P = PLANTS[D[i][0]], at = {x: D[i][1], y: D[i][2], h: host.elev(D[i][1], D[i][2]) + .5};
    if (n > 0) pack()?.give(P.item, n, at);
    pack()?.gain('foraging', P.xp, at);
    evAt('forage.pick', i, n, true);
  }
  function setPicked(i, at) { picked.set(i, at); save(i, at); ver++; }
  function grow(i) { picked.delete(i); save(i); ver++; evAt('forage.grow', i, 0, false); }

  // a pick starts: he crouches facing it (the comb on a berry patch: no stop), it lands TUNE.pluck s in
  function start(i) {
    const P = host.player, e = D[i], comb = PLANTS[e[0]].berry && host.mods.value('forage.comb', 0) > 0;
    if (!comb) {
      host.PL.hold('crouch', TUNE.crouch); if (P.state !== 'hold') return false;
      const dx = e[1] - P.x, dy = e[2] - P.y, c = Math.cos(host.yaw), s = Math.sin(host.yaw);
      if (dx * dx + dy * dy > .01) host.PL.faceShot?.(dx * c - dy * s, dx * s + dy * c);   // (his view frame)
    }
    S.i = i; S.t = comb ? TUNE.pluck : 0;
    return true;
  }
  function land(i) {
    const kind = D[i][0], c = coop();
    if (c?.online) { if (c.act('pick', 'd' + i, {lvl: pack()?.level('foraging') || 1, kind})) asked.set(i, clockT); return; }
    const n = pickYield(R, kind, {extra: host.mods.value('forage.extra', 0), comb: host.mods.value('forage.comb', 0)});
    setPicked(i, (host.env?.t ?? 0) + regrowHours(kind, REGROW));
    got(i, n);
  }
  // co-op: the server's word on a patch ({k: 'world', id: 'd' + i, s: picked | grown, by, n, late})
  function mail(m) {
    if (m.k !== 'world' || typeof m.id !== 'string' || m.id[0] !== 'd') return;
    const i = +m.id.slice(1); if (!D?.[i] || !PLANTS[D[i][0]]) return;
    if (m.s === 'picked') {
      asked.delete(i); if (!picked.has(i)) { picked.set(i, 1); ver++; }
      if (m.late) return;
      if (m.by === coop().net?.id) got(i, m.n | 0); else evAt('forage.pick', i, 0, false);
    } else if (m.s === 'grown' && picked.has(i)) { picked.delete(i); ver++; evAt('forage.grow', i, 0, false); }
  }

  // ---------------------------------------------------------------- the picked look (world/decor3d.js), on change
  const shown = new Set(); let shownOn = null, shownVer = -1;
  function look() {
    const DC = host.world?.decor || null;
    if (DC !== shownOn) { shownOn = DC; shown.clear(); shownVer = -1; }   // (a rebuilt world: nothing picked on it yet)
    if (!DC || ver === shownVer) return;
    shownVer = ver;
    for (const i of shown) if (!picked.has(i)) { DC.setPicked(i, false); shown.delete(i); }
    for (const i of picked.keys()) if (!shown.has(i)) { DC.setPicked(i, true); shown.add(i); }
  }

  // ---------------------------------------------------------------- GLIMMER (the view: its own state, viewRandom)
  const GL = TUNE.glimmer, VR = viewRandom('forage'), GMAX = 48, SPK = 5;
  const G = {still: 0, cool: 0, r: -1, x: 0, y: 0, z: 0, t: 0};   // (r: the wave's radius; -1 none)
  const GI = new Int32Array(GMAX), GT = new Float32Array(GMAX), GN = new Uint8Array(GMAX);   // a glinting patch: its index, its age, its specks
  const GX = new Float32Array(GMAX * SPK), GY = new Float32Array(GMAX * SPK), GH = new Float32Array(GMAX * SPK), GP = new Float32Array(GMAX * SPK);
  let gn = 0;
  const GA = [{alpha: .25}, {alpha: .5}, {alpha: .75}, {}], GA_E = [{alpha: .25, emit: true}, {alpha: .5, emit: true}, {alpha: .75, emit: true}, {emit: true}];
  const DEW = ['#f4fbff', '#d6ecff', '#fffbe8'];
  function glint(n) {   // a patch the wave passed: its dew specks, on the plant
    for (let k = 0; k < gn; k++) if (GI[k] === n) return;
    if (gn >= GMAX) return;
    const k = gn++, c = PLANTS[D[n][0]], r = radius(n) * .8, g = host.elev(D[n][1], D[n][2]), top = c.berry ? .22 : .1;
    GI[k] = n; GT[k] = 0; GN[k] = GL.specks[0] + Math.floor(VR() * (GL.specks[1] - GL.specks[0] + 1));
    for (let s = 0; s < GN[k]; s++) {
      const a = VR() * Math.PI * 2, d = Math.sqrt(VR()) * r, j = k * SPK + s;
      GX[j] = D[n][1] + Math.cos(a) * d; GY[j] = D[n][2] + Math.sin(a) * d; GH[j] = g + .05 + VR() * top; GP[j] = VR() * 6.3;
    }
  }
  function glimmerView(dt) {
    if (!active()) { gn = 0; G.r = -1; G.still = 0; return; }
    for (let k = gn - 1; k >= 0; k--) if ((GT[k] += dt) > GL.t || picked.has(GI[k])) {   // (an old one, or picked: gone)
      gn--; GI[k] = GI[gn]; GT[k] = GT[gn]; GN[k] = GN[gn];
      for (let s = 0; s < SPK; s++) { const a = k * SPK + s, b = gn * SPK + s; GX[a] = GX[b]; GY[a] = GY[b]; GH[a] = GH[b]; GP[a] = GP[b]; }
    }
    G.cool -= dt;
    const P = host.player, still = P.state === 'pose' && P.frame === 'crouch' && !!pack()?.move('glimmer');
    G.still = still ? G.still + dt : 0;
    if (G.r < 0 && G.still >= GL.still && G.cool <= 0) { G.r = 0; G.x = P.x; G.y = P.y; G.z = P.z; G.t = 0; }
    if (G.r < 0) return;
    const r0 = G.r; G.r += GL.speed * dt; G.t += dt;
    const cx = Math.floor(G.x / CELL), cy = Math.floor(G.y / CELL), cr = Math.ceil(GL.reach / CELL) + 1;
    for (let j = cy - cr; j <= cy + cr; j++) for (let i = cx - cr; i <= cx + cr; i++) {
      const L = cells.get(key(i, j)); if (!L) continue;
      for (let k = 0; k < L.length; k++) {
        const n = L[k]; if (picked.has(n)) continue;
        const d = Math.hypot(D[n][1] - G.x, D[n][2] - G.y);
        if (d > r0 && d <= G.r && d <= GL.reach && Math.abs(host.elev(D[n][1], D[n][2]) - G.z) < 2.5) glint(n);
      }
    }
    if (G.r >= GL.reach) { G.r = -1; G.cool = GL.cool; }
  }
  function glimmerFrame() {
    if (!gn && G.r < 0) return;
    const dim = host.env?.part === 'night' ? GL.night : 1, t = clockV;
    for (let k = 0; k < gn; k++) {
      const age = GT[k], f = Math.min(1, age / .25) * Math.min(1, (GL.t - age) / 1.5) * dim;   // (in fast, out slowly)
      for (let s = 0; s < GN[k]; s++) {
        const j = k * SPK + s, w = .5 + .5 * Math.sin(t * 7 + GP[j]), a = f * (.35 + .65 * w * w);   // (each winks on its own)
        if (a < .12) continue;
        host.point(GX[j], GY[j], GH[j], DEW[s % DEW.length], (w > .85 && dim === 1 ? GA_E : GA)[Math.min(3, Math.floor(a * 3.99))]);
      }
    }
    if (G.r > 0) {   // (the wave itself: a faint, broken ring of light on the ground)
      const n = 28, a = (1 - G.r / GL.reach) * .5 * dim; if (a < .12) return;
      for (let i = 0; i < n; i++) {
        const ang = i / n * Math.PI * 2 + G.r * .15; if (Math.sin(ang * 5 + t * 3) < 0) continue;
        const x = G.x + Math.cos(ang) * G.r, y = G.y + Math.sin(ang) * G.r;
        host.point(x, y, host.elev(x, y) + .04, DEW[1], GA[Math.min(3, Math.floor(a * 3.99))]);
      }
    }
  }
  let clockV = 0;

  const F = {
    name: 'forage', label: 'Foraging', on: ON,
    get picked() { return picked; }, patchNear, ahead,   // (tests, dev)
    update(dt, evs) {
      clockT += dt;
      if (!ON) return;
      index();
      const on = active();
      if (on !== wasOn) { wasOn = on; if (!on) { byE = false; S.i = -1; wantI = lmbI = -1; } }
      if (!on) return;
      const ol = online();
      if (ol !== wasOnline || !restored) { wasOnline = ol; asked.clear(); if (ol) { restored = true; picked.clear(); ver++; } else restore(); }   // (online: the server's set comes in its welcome)
      for (let k = 0; k < evs.length; k++) if (evs[k].type === 'pack.reset' && !ol) { picked.clear(); ver++; }
      const c = coop(); if (ol && c.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
      for (const [i, t] of asked) if (clockT - t > 3) asked.delete(i);   // (no word back: the server said no)
      // the pick under way, then the next: E pressed (the patch ahead), LMB (the one clicked), E held (one he passes)
      if (S.i >= 0 && (S.t += dt) >= TUNE.pluck) { const i = S.i; S.i = -1; land(i); }
      if (byE && !host.keys.has('e')) byE = false;
      if (S.i < 0 && free()) {
        const P = host.player;
        let i = wantI >= 0 ? wantI : lmbI >= 0 ? lmbI : byE ? patchNear(P.x, P.y, P.z, TUNE.walk, 0, 0) : -1;
        if (i >= 0 && (picked.has(i) || asked.has(i))) i = -1;
        if (i >= 0) start(i);
      }
      wantI = lmbI = -1;
      // regrowth (offline: the world clock; the server grows them in co-op), once a second
      if ((growT += dt) >= 1) {
        growT = 0;
        const rain = (host.env?.sky?.rain ?? 0) > RAIN, rained = rain && !rainWas; rainWas = rain;
        if (!ol && picked.size) { const t = host.env?.t ?? 0; for (const [i, at] of picked) if (t >= at || (rained && PLANTS[D[i][0]].rain)) grow(i); }
      }
    },
    view(dt) { if (!ON) return; look(); clockV += dt; glimmerView(dt); },
    // E: the patch ahead; none ahead but patches round him (WALK_ZONE m) and no tree ahead (that E is the axe's): held E walks on
    // picking what he passes (it doesn't wave: host.PL.useE)
    onKey(k) {
      if (k !== 'e' || !active() || !free()) return false;
      const i = ahead(), P = host.player;
      if (i < 0 && (patchNear(P.x, P.y, P.z, WALK_ZONE, 0, 0) < 0 || treeAhead())) return false;
      wantI = i; byE = true; host.PL.useE?.(); return true;
    },
    lmb(down) {   // (not with the gun drawn or a foe under the cursor: that press is the gun's)
      if (!down || !active() || !free() || host.player.state === 'draw' || host.aim?.()?.target) return false;
      const i = underCursor(); if (i < 0) return false;
      lmbI = i; return true;
    },
    frame() {   // the glimmer; ?gathermarks=1: a dot over each patch within 14 m (red: picked)
      if (ON) glimmerFrame();
      if (!marks || !active()) return;
      const P = host.player, cx = Math.floor(P.x / CELL), cy = Math.floor(P.y / CELL);
      for (let j = cy - 4; j <= cy + 4; j++) for (let i = cx - 4; i <= cx + 4; i++) {
        const L = cells.get(key(i, j)); if (!L) continue;
        for (let k = 0; k < L.length; k++) { const n = L[k]; host.point(D[n][1], D[n][2], host.elev(D[n][1], D[n][2]) + .9, picked.has(n) ? '#e2644d' : '#7ad07a'); }
      }
    },
    hd(q, sc) {   // the prompt over the patch a press would pick (the pixel look: ui/hdpixel.js)
      if (!active() || S.i >= 0 || host.hudOff || host.playerHidden || pack()?.open || !free()) return;
      let i = underCursor(); if (i < 0) i = ahead(); if (i < 0) return;
      const s = host.G.toScreen(D[i][1], host.elev(D[i][1], D[i][2]) + .55 + radius(i) * .4, D[i][2]);
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, 'E pick', s[0] * sc, s[1] * sc, hdUnit(), '#f2d27a');
      q.restore();
    },
    menu() {
      if (!ON || game()?.mode !== 'sandbox') return [];
      return [
        {label: `Foraging: marks on the patches ${marks ? '(on)' : '(off)'}`, run: () => { marks = !marks; }},
        {label: 'Foraging: everything grows back (offline)', run: () => { if (!online()) for (const i of [...picked.keys()]) grow(i); }},
        {label: 'Foraging: a handful of each plant in the pouch', run: () => { for (const k in PLANTS) pack()?.give(PLANTS[k].item, 10); }},
      ];
    },
    hud: () => active() ? `forage ${cells.size} cells · picked ${picked.size}${S.i >= 0 ? ' · picking ' + D[S.i][0] : ''}${asked.size ? ' · asked ' + asked.size : ''}` : '',
  };
  return F;
}
