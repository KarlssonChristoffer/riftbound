// COMBAT CORE (render3d): the arena's combat simulation (concepts/sprites/arena/combat.js), ported line for line minus
// its 2D drawing (draw.js paints the same things into the 3D frame). Damage, breakables with stages, hitstop chains,
// explosions + barrel chains, loot, the 5 abilities, the sparring brutes, traps, chests, the yard restocking itself.
//
// What changed from the arena, and why:
//   * P is the host's WORLD-frame player view (host.player). Facing writes go to the raw view-frame player (host.P)
//     through host.PL.dirOf of the view-rotated direction (pose()).
//   * Distances that the arena squashed (y x 1.6, to match its 2D collision) are round here (SQ = 1): the 3D host's
//     collision is round, so a brute separation measured squashed could still overlap the player.
//   * Brutes keep a WORLD facing vector (b.faceW); draw.js turns it into the biome's 16-step SCREEN facing (p.face) every
//     frame, so the painted brute faces the player at any camera yaw. (The arena wrote a dir8 index into p.face, which
//     biomes.js reads as a 16-step index: its brutes only ever faced right.)
//   * Events go to host.events; the caller (combat.js) also hands this frame's new ones to the prop physics.
// Everything else (tuning T, ability table AB, palettes, timings, RNG and its seed) is the arena's.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const SQ = 1;   // the arena's y squash for 2D distances (1.6); round in 3D

export function createCore(host) {
  const P = host.player, events = host.events, props = host.props;
  let seed = 90210;
  const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647, RR = (a, b) => a + R() * (b - a);

  // ---------------- tuning (the arena's C.T) ----------------
  const T = {
    crit: .15, critMul: 2,
    hsHit: .045, hsCrit: .06, hsBreak: .08, hsBoom: .1, hsCap: .12, hsWindow: .15,   // hitstop (s); chain cap
    msN: 5, msSpread: 40 * Math.PI / 180, msDmg: 12, msV: 24,                         // RMB multishot (60% of ~20)
    boomDmg: 10, boomR: 2, boomBlast: 30, boomV: 22,                                   // 1 explosive arrow
    rainR: 2.2, rainDelay: .6, rainN: 14, rainDur: .5, rainDmg: 12, rainSplash: 8, rainRange: 13,   // 2 arrow rain
    pierceDmg: 35, pierceN: 5, pierceV: 36,                                            // 3 piercing shot
    trapArm: .5, trapLife: 6, trapR: 1.8, trapDmg: 40, trapRoot: 2, trapTrig: 1.1, vault: 16,        // 4 vault trap
    ignite: 5,                                                                          // barrel -> barrel fire reach (m)
    bruteAggro: 5, bruteLose: 12, bruteLeash: 9, bruteHopT: .5, bruteHopH: .75, bruteHopD: 1.7,
    brutePause: .38, bruteKnock: 11, bruteReach: .95, bruteRespawn: 4,
    magnet: 4.5, coinDelay: .45,
    propRespawn: 25, chestReset: 30, resetAway: 6,   // the yard restocks itself (s; only while you are > resetAway m off)
  };
  const AB = {
    rmb: {key: 'RMB', name: 'Multishot', cd: 1.2, desc: '5-arrow fan, 60% damage each', col: '#f2d27a'},
    1: {key: '1', name: 'Explosive Arrow', cd: 4, desc: 'detonates on impact (2 m)', col: '#ff8a3a'},
    2: {key: '2', name: 'Arrow Rain', cd: 8, desc: '14 arrows fall on the marked circle', col: '#9ad0ff'},
    3: {key: '3', name: 'Piercing Shot', cd: 5, desc: 'heavy arrow through 5 targets', col: '#c8f0ff'},
    4: {key: '4', name: 'Vault Trap', cd: 10, desc: 'drop a trap, vault back; bursts + roots', col: '#b8e070'},
  };
  const SLOTS = ['rmb', 1, 2, 3, 4];
  for (const k of SLOTS) Object.assign(AB[k], {t: 0, ready: 0, deny: 0, cast: 0});

  // ---------------- palettes (biome-neutral, 4 steps light -> dark) ----------------
  const PAL = {
    crate: ['#b08a5a', '#8a6a44', '#6e4a2e', '#4a3020'], barrel: ['#8a6a44', '#6e4a2e', '#4a3020', '#3a3a40'],
    barrel_x: ['#c84a34', '#a8342b', '#6e2a22', '#2a2228'], pot: ['#d09060', '#b0703e', '#8a5230', '#5c3522'],
    crystal: ['#e8dcff', '#b8a0f0', '#8a70d8', '#5a48a0'], brute: ['#c8b48a', '#9a8660', '#84502e', '#5c3522'],
    dummy: ['#e0d0a8', '#c8b48a', '#9a8660', '#6e5a3a'], stone: ['#a8a4a0', '#84807c', '#5e5a58', '#3a3836'],
    metal: ['#c8ccd4', '#8a8e98', '#5a5e68', '#34363c'], char: ['#4a3e38', '#342c28', '#221c1a', '#141012'],
  };
  const FIRE = ['#fff8d8', '#ffe07a', '#ffb040', '#ff7a2a', '#d0401e', '#7a2a1e'], EMBER = FIRE.slice(1);
  const SMOKE = ['#6e6870', '#5a555c', '#47424a', '#38343c'], DUST = ['#c8b898', '#a89878', '#86785e', '#6a5e4a'];
  const SPARK = ['#ffffff', '#d8f0ff', '#8ac0f0', '#5a88c0'], GOLD = ['#fff4c0', '#ffe07a', '#f2c24a', '#c8922a'];
  const HGT = {crate: .8, barrel: .9, barrel_x: .9, pot: .5, crystal: 1.2, brute: 1.5, dummy: 1.4, chest: .6};
  const COINS = {pot: [1, 3], crate: [2, 4], barrel: [2, 5], barrel_x: [0, 2], crystal: [6, 9], brute: [3, 5]};

  // ---------------- state ----------------
  const hittables = props.filter(p => p.hp > 0 || p.target || p.breakable);
  const colliders = props.filter(p => p.r > 0 && !p.outside);
  for (const p of hittables) p.r0 ??= p.r;
  const chests = props.filter(p => p.interact === 'open');
  const brutes = props.filter(p => p.kind === 'brute' || p.sparring), BS = new Map();
  for (const b of brutes) {
    b.r0 = b.r; b.h = 0; b.faceW = [0, 1]; b.squash = 0; b.air = false; b.stage = 0; b.home ??= [b.x, b.y];
    BS.set(b, {mode: 'idle', wait: .5, hop: null, root: 0, dead: 0, land: 0});
  }
  const debris = [], coins = [], fx = [], rings = [], nums = [], lts = [], pending = [], brands = [], zones = [], traps = [];
  const flashing = new Set();
  let simT = 0, lightN = 0, lastDir = [0, 1];
  const S = {gold: 0, goldPop: 0, hud: ''};
  const hs = {end: -9, used: 0};

  // ---------------- helpers ----------------
  const pz = p => p.z || 0;
  function hitstop(sec) {
    if (simT > hs.end + T.hsWindow) hs.used = 0;          // a new chain of hits
    const add = Math.min(sec, T.hsCap - hs.used); if (add < .01) return;
    hs.used += add; hs.end = simT; host.hitstop(add);
  }
  const shake = (a, s) => host.shake(a, s);
  function light(x, y, h, color, radius, i0, life, flicker = .3) { if (lts.length > 5) lts.shift(); lts.push({x, y, h, color, radius, i0, life, flicker, t: 0, id: 7100 + (lightN++ % 64)}); }
  function part(x, y, a, vx, vy, va, life, pal, o = {}) {
    if (fx.length > 900) return;
    fx.push({x, y, a, vx, vy, va, t: o.delay ? -o.delay : 0, life, pal, emit: !!o.emit, grav: o.grav ?? 0, drag: o.drag ?? 0, sz: o.sz ?? 1});
  }
  function ring(x, y, z, r, life, pal, emit) { rings.push({x, y, z, r, t: 0, life, pal, emit}); }
  function number(p, dmg, crit, a) {
    nums.push({x: p.x + RR(-.2, .2), y: p.y, h: pz(p) + (p.h || 0) + (a ?? (HGT[p.kind] ?? 1.2)) + .15, v: dmg, crit, t: 0});
    if (nums.length > 40) nums.shift();
  }
  // debris chunks: 1-3 px clusters, fly, bounce, settle, then blink out
  const SHAPES = [[[0, 0, 0]], [[0, 0, 0], [1, 0, 1]], [[0, 0, 0], [0, 1, 1]], [[0, 0, 0], [1, 0, 0], [0, 1, 1]], [[0, 0, 0], [1, 0, 1], [1, 1, 1]]];
  function chunks(x, y, a, n, pal, o = {}) {
    const [hx, hy] = o.dir || [0, 0], sp = o.speed ?? 2.4, big = o.big ?? 1;
    for (let i = 0; i < n; i++) {
      if (debris.length > 480) debris.shift();
      const ang = R() * TAU, s = sp * RR(.35, 1);
      debris.push({x: x + RR(-.15, .15), y: y + RR(-.1, .1), a: a + RR(0, o.spreadH ?? .4),
        vx: Math.sin(ang) * s + hx * RR(.5, 1.6), vy: Math.cos(ang) * s * .8 + hy * RR(.5, 1.6), va: RR(1.5, 4.5) * (o.up ?? 1),
        pal, ci: R() * 3 | 0, sh: SHAPES[Math.min(SHAPES.length - 1, R() * (2 + big * 1.5) | 0)], rest: false, t: 0, life: RR(8, 12)});
    }
  }
  function coinBurst(x, y, a, n, sp = 1) {
    for (let i = 0; i < n; i++) {
      const ang = R() * TAU, s = RR(.8, 2.4) * sp;
      coins.push({x, y, a: a + .3, vx: Math.sin(ang) * s, vy: Math.cos(ang) * s * .8, va: RR(3.5, 6), t: -i * .03, ph: R() * 4, rest: false, mag: false, spd: 0});
    }
    if (n) events.push({type: 'loot', x, y, n});
  }
  function puff(x, y, z, n = 10, r = .5) {   // dust ring (landing, respawn)
    for (let i = 0; i < n; i++) { const ang = i / n * TAU + R() * .4; part(x + Math.sin(ang) * r * .4, y + Math.cos(ang) * r * .3, z + .05, Math.sin(ang) * RR(1.2, 2.4), Math.cos(ang) * RR(.9, 1.8), RR(.2, .8), RR(.3, .55), DUST, {drag: 5}); }
  }

  // ---------------- damage ----------------
  function damage(p, dmg, o = {}) {
    if (p.broken) return false;
    let crit = false;
    if (o.canCrit && R() < T.crit) { crit = true; dmg *= T.critMul; }
    dmg = Math.round(dmg);
    p.wob = 1; p.flash = 1; flashing.add(p);
    number(p, dmg, crit);
    const pal = PAL[p.kind] || PAL[p.breakable] || PAL.stone, hgt = HGT[p.kind] ?? 1, base = pz(p) + (p.h || 0);
    let broke = false;
    if (p.hp > 0) {
      p.hp = Math.max(0, p.hp - dmg);
      if (p.hp <= 0) broke = breakProp(p, o);
      else {
        const st = p.hp <= p.maxHp / 2 ? 1 : 0;
        chunks(p.x, p.y, base + hgt * .5, st !== p.stage ? 7 : 3, pal, {dir: o.dir, speed: 1.6, big: 0});
        p.stage = st;
      }
    } else chunks(p.x, p.y, base + hgt * .6, 2, pal, {dir: o.dir, speed: 1.2, big: 0});   // dummies: a few straw bits
    if (p.sparring && !broke) { const s = BS.get(p); if (s && s.mode !== 'aggro') { s.mode = 'aggro'; s.wait = Math.min(s.wait, .3); } }
    if (!o.quiet) {
      hitstop(broke ? T.hsBreak : crit ? T.hsCrit : T.hsHit);
      shake(broke ? 2 : crit ? 2 : 1, broke ? .14 : crit ? .1 : .07);
    }
    return broke;
  }
  function breakProp(p, o = {}) {
    const pal = PAL[p.kind] || PAL.stone, hgt = HGT[p.kind] ?? 1, base = pz(p) + (p.h || 0);
    p.broken = true; p.stage = 2; p.hp = 0; p.r = 0;
    events.push({type: 'break', x: p.x, y: p.y, kind: p.kind});
    chunks(p.x, p.y, base + hgt * .3, p.kind === 'pot' ? 12 : p.kind === 'crystal' ? 18 : 16, pal, {dir: o.dir, speed: 2.8, big: p.kind === 'pot' ? 1 : 2, spreadH: hgt * .7});
    if (p.kind === 'crystal') for (let i = 0; i < 10; i++) part(p.x, p.y, base + RR(.3, 1.1), RR(-2, 2), RR(-1.5, 1.5), RR(1, 3), RR(.3, .6), SPARK, {emit: true, drag: 3});
    const c = COINS[p.kind]; if (c) coinBurst(p.x, p.y, base, Math.round(RR(c[0], c[1] + .99) - .49));
    if (p.explode) {
      chunks(p.x, p.y, base + .3, 6, PAL.char, {speed: 3, big: 1});
      if (o.delay) pending.push({t: o.delay, fn: () => explode(p.x, p.y, pz(p), p.explode.r, p.explode.dmg, true)});
      else explode(p.x, p.y, pz(p), p.explode.r, p.explode.dmg, true);
    }
    if (!p.sparring && T.propRespawn) p.respawnAt = simT + T.propRespawn;
    if (p.sparring) { const s = BS.get(p); s.dead = T.bruteRespawn; s.hop = null; p.h = 0; p.air = false; p.rooted = false; }
    return true;
  }
  // an explosion: area damage with falloff, chain to barrels, knock the player, shake, hitstop, light, fire
  function explode(x, y, z, r, dmg, barrel) {
    events.push({type: 'explode', x, y, r});
    hitstop(T.hsBoom);
    const dP = Math.hypot(P.x - x, P.y - y);
    shake(Math.round(clamp(6 - dP * .35, 2, 5)), .35);
    light(x, y, z + .8, '#ffb45a', r * 2.6, 2.6, .6, .35);
    ring(x, y, z, r, .2, FIRE, true); ring(x, y, z, r * 1.25, .35, DUST, false);
    for (let i = 0; i < 9; i++) part(x + RR(-.25, .25), y + RR(-.15, .15), z + RR(.2, .9), RR(-.8, .8), RR(-.5, .5), RR(.5, 2), RR(.14, .26), FIRE, {emit: true, sz: 4, drag: 4});   // fireball core
    for (let i = 0; i < 34; i++) { const ang = R() * TAU, s = RR(.5, 3.5) * r / 2.2; part(x, y, z + RR(.1, .8), Math.sin(ang) * s, Math.cos(ang) * s * .8, RR(1, 4), RR(.25, .6), FIRE, {emit: true, drag: 3.5, sz: 2}); }
    for (let i = 0; i < 14; i++) { const ang = R() * TAU, s = RR(3, 7); part(x, y, z + .5, Math.sin(ang) * s, Math.cos(ang) * s * .8, RR(3, 7), RR(.6, 1.1), EMBER, {emit: true, grav: 11}); }
    for (let i = 0; i < 16; i++) { const ang = R() * TAU, s = RR(.3, 1.6); part(x + Math.sin(ang) * .3, y, z + RR(.3, 1), Math.sin(ang) * s, Math.cos(ang) * s * .6, RR(.8, 1.8), RR(.8, 1.6), SMOKE, {drag: 2, sz: 2, delay: .08 + R() * .15}); }
    chunks(x, y, z + .05, 8, PAL.char, {speed: 3.5, big: 1});
    for (const p of hittables) {
      if (p.broken || Math.abs(pz(p) - z) > 1.5) continue;
      const d = Math.hypot(p.x - x, p.y - y); if (d > r + (p.hitR ?? .3)) continue;
      const k = d < r * .5 ? 1 : 1 - (d - r * .5) / (r * .5 + .3) * .5;
      const len = d || 1;
      damage(p, dmg * k, {quiet: true, dir: [(p.x - x) / len * 3, (p.y - y) / len * 3], delay: .12});
    }
    // fire spreads: other explosive barrels in reach get a burning brand thrown at them (a visible chain)
    if (barrel) for (const b of hittables) {
      if (b.broken || !b.explode || b.lit || Math.abs(pz(b) - z) > 1.5) continue;
      const d = Math.hypot(b.x - x, b.y - y); if (d > T.ignite || d < .05) continue;
      b.lit = true; brands.push({x0: x, y0: y, z0: z + .9, b, t: 0, dur: .22 + d * .07});
    }
    if (Math.abs(P.z - z) < 1.2 && dP < r + .8 && !['climb', 'leap', 'fall'].includes(P.state)) {
      const k = 1 - dP / (r + .8), ux = dP > .05 ? (P.x - x) / dP : 0, uy = dP > .05 ? (P.y - y) / dP : 1, sp = 6 + 9 * k;
      host.knock(ux * sp, uy * sp);
    }
  }

  // ---------------- brutes ----------------
  const TR = host.layout?.trail || {x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9};
  function freeSpot(b, x, y) {
    if (x < TR.x0 + .5 || x > TR.x1 - .5 || y < TR.y0 + .5 || y > TR.y1 - .4) return false;
    if (host.inStream(x, y) || host.elev(x, y) !== pz(b)) return false;
    if (Math.hypot(P.x - x, (P.y - y) * SQ) < .78 && Math.abs(P.z - pz(b)) < 1) return false;
    for (const p of colliders) if (p !== b && !p.broken && p.r > 0 && Math.abs(pz(p) - pz(b)) < 1 && Math.hypot(p.x - x, (p.y - y) * SQ) < p.r + b.r0 * .9) return false;
    return true;
  }
  function pathOk(b, x, y) {   // no leaping the stream, no climbing
    for (let k = .25; k < 1; k += .25) { const sx = b.x + (x - b.x) * k, sy = b.y + (y - b.y) * k; if (host.inStream(sx, sy) || host.elev(sx, sy) !== pz(b)) return false; }
    return true;
  }
  function planHop(b, s, tx, ty, stop) {
    const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
    if (d < .12) return null;
    const base = Math.atan2(dx, dy), step = Math.min(T.bruteHopD, Math.max(0, d - stop));
    if (step < .15) return {x: b.x, y: b.y};   // already there: a stomp in place
    for (const off of [0, .45, -.45, .9, -.9, 1.4, -1.4]) {
      const x = b.x + Math.sin(base + off) * step, y = b.y + Math.cos(base + off) * step;
      if (freeSpot(b, x, y) && pathOk(b, x, y)) return {x, y};
    }
    return null;
  }
  function updBrute(b, s, dt) {
    if (b.broken) {
      s.dead -= dt;
      if (s.dead <= 0 && Math.hypot(P.x - b.home[0], P.y - b.home[1]) > 1.1) {   // respawn with a poof
        Object.assign(b, {broken: false, stage: 0, hp: b.maxHp, r: b.r0, x: b.home[0], y: b.home[1], h: 0, flash: 1, wob: 1, lit: false});
        flashing.add(b); Object.assign(s, {mode: 'idle', wait: .8, hop: null, root: 0, fail: 0, calm: 0});
        puff(b.x, b.y, pz(b), 16, .8);
        for (let i = 0; i < 8; i++) part(b.x + RR(-.3, .3), b.y, pz(b) + RR(.2, 1.3), RR(-.8, .8), 0, RR(.3, 1), RR(.3, .6), SMOKE, {sz: 2, drag: 2});
        events.push({type: 'respawn', x: b.x, y: b.y});
      }
      return;
    }
    s.root = Math.max(0, s.root - dt); b.rooted = s.root > 0;
    s.land = Math.max(0, s.land - dt);
    if (s.hop) {
      const H = s.hop; H.t += dt; const k = Math.min(1, H.t / H.dur);
      b.x = H.x0 + (H.x1 - H.x0) * k; b.y = H.y0 + (H.y1 - H.y0) * k; b.h = 4 * H.H * k * (1 - k); b.air = true; b.squash = 0;
      if (k >= 1) landBrute(b, s);
      return;
    }
    b.air = false; b.squash = s.land > 0 ? s.land / .12 : 0;
    const dx = P.x - b.x, dy = P.y - b.y, d = Math.hypot(dx, dy), same = Math.abs(P.z - pz(b)) < .6 && P.state !== 'climb';
    const [hx, hy] = b.home, dHome = Math.hypot(b.x - hx, b.y - hy);
    s.calm = Math.max(0, (s.calm || 0) - dt);
    if (s.mode === 'idle' && same && d < T.bruteAggro && !s.calm) { s.mode = 'aggro'; s.wait = Math.min(s.wait, .25); }
    if (s.mode === 'aggro' && (dHome > T.bruteLeash || d > T.bruteLose || (!same && d > 3))) s.mode = 'home';
    if (s.mode === 'home' && same && !s.calm && d < T.bruteAggro * .6 && dHome < T.bruteLeash * .7) s.mode = 'aggro';
    if (s.mode === 'home' && dHome < .2) { s.mode = 'idle'; s.wait = 1; }
    if (s.mode !== 'home' && d < 8 && d > 1e-3) b.faceW = [dx, dy];
    s.wait -= dt;
    if (s.mode !== 'idle' && s.wait < .14 && !b.rooted) b.squash = Math.max(b.squash, 1 - s.wait / .14);   // crouch
    if (s.wait > 0 || b.rooted || s.mode === 'idle') { if (s.mode === 'idle' && s.wait <= 0) s.wait = .5; return; }
    const to = s.mode === 'aggro' ? planHop(b, s, P.x, P.y, .85) : planHop(b, s, hx, hy, 0);
    // can't get closer (stream, cliff, crates in the way)? after a few tries it gives up and walks home
    const gain = to ? d - Math.hypot(P.x - to.x, P.y - to.y) : 0;
    if (s.mode === 'aggro' && d > 1.2) s.fail = gain > .2 ? 0 : (s.fail || 0) + 1;
    if (s.mode === 'aggro' && s.fail >= 4) { s.mode = 'home'; s.calm = 4; s.fail = 0; }
    if (!to) { s.wait = .45; return; }
    if (to.x !== b.x || to.y !== b.y) b.faceW = [to.x - b.x, to.y - b.y];
    s.hop = {x0: b.x, y0: b.y, x1: to.x, y1: to.y, t: 0, dur: T.bruteHopT, H: to.x === b.x && to.y === b.y ? T.bruteHopH * .8 : T.bruteHopH};
  }
  function landBrute(b, s) {
    s.hop = null; b.h = 0; b.air = false; s.land = .12; b.squash = 1;
    s.wait = T.brutePause + R() * .15;
    // never end up overlapping the player (the host can't move him out of a collider)
    let sd = Math.hypot(P.x - b.x, (P.y - b.y) * SQ);
    if (sd < .72 && Math.abs(P.z - pz(b)) < 1) {
      const d = Math.hypot(P.x - b.x, P.y - b.y) || 1, ux = (b.x - P.x) / d, uy = (b.y - P.y) / d;
      for (let k = 0; k < 12 && sd < .75; k++) { const nx = b.x + ux * .08, ny = b.y + uy * .08; if (host.inStream(nx, ny) || host.elev(nx, ny) !== pz(b)) break; b.x = nx; b.y = ny; sd = Math.hypot(P.x - b.x, (P.y - b.y) * SQ); }
    }
    puff(b.x, b.y, pz(b), 8, .5);
    const d = Math.hypot(P.x - b.x, P.y - b.y);
    if (s.mode === 'aggro' && d < T.bruteReach && Math.abs(P.z - pz(b)) < .5 && !['climb', 'leap', 'fall', 'splash'].includes(P.state)) {
      const ux = d > .05 ? (P.x - b.x) / d : 0, uy = d > .05 ? (P.y - b.y) / d : 1;
      host.knock(ux * T.bruteKnock, uy * T.bruteKnock);
      shake(3, .18); hitstop(.06); s.wait += .35;
      events.push({type: 'hit', x: P.x, y: P.y, vx: ux * 5, vy: uy * 5, player: true});
      for (let i = 0; i < 6; i++) part(P.x, P.y, P.z + RR(.6, 1.2), ux * RR(1, 3) + RR(-1, 1), uy * RR(1, 3), RR(0, 2), RR(.15, .3), GOLD, {emit: true, drag: 4});
    } else if (d < 4) shake(1, .06);
    // stomping onto a trap sets it off
    for (const q of traps) if (q.t >= T.trapArm && !q.done && Math.hypot(q.x - b.x, q.y - b.y) < T.trapTrig) burstTrap(q);
  }

  // ---------------- traps ----------------
  function burstTrap(q) {
    q.done = true;
    events.push({type: 'trap', x: q.x, y: q.y});
    hitstop(.08); shake(3, .2);
    ring(q.x, q.y, q.z, T.trapR, .22, SPARK, true); ring(q.x, q.y, q.z, T.trapR * .6, .3, DUST, false);
    for (let i = 0; i < 12; i++) { const ang = i / 12 * TAU; q.spikes = q.spikes || []; q.spikes.push({x: q.x + Math.sin(ang) * RR(.3, T.trapR * .8), y: q.y + Math.cos(ang) * RR(.2, T.trapR * .6), t: -R() * .08}); }
    chunks(q.x, q.y, q.z + .1, 8, PAL.metal, {speed: 3, big: 0});
    for (let i = 0; i < 10; i++) part(q.x, q.y, q.z + .2, RR(-3, 3), RR(-2, 2), RR(2, 5), RR(.2, .4), SPARK, {emit: true, drag: 3});
    light(q.x, q.y, q.z + .5, '#d8f0ff', 3.2, 1.6, .3, 0);
    for (const p of hittables) {
      if (p.broken || Math.abs(pz(p) - q.z) > 1.2) continue;
      const d = Math.hypot(p.x - q.x, p.y - q.y); if (d > T.trapR + (p.hitR ?? .3)) continue;
      damage(p, T.trapDmg * (d < T.trapR * .6 ? 1 : .7), {quiet: true, delay: .12, dir: [(p.x - q.x) * 2, (p.y - q.y) * 2]});
      const s = BS.get(p); if (s && !p.broken) { s.root = T.trapRoot; s.hop = null; p.h = 0; p.air = false; p.rooted = true; s.mode = 'aggro'; }
    }
  }

  // test arena: broken things come back (and chests close) after a while, out of the player's way
  function restock() {
    const away = p => Math.hypot(P.x - p.x, P.y - p.y) > T.resetAway;
    for (const p of hittables) if (p.broken && !p.sparring && p.respawnAt && simT > p.respawnAt && away(p)) {
      Object.assign(p, {broken: false, stage: 0, hp: p.maxHp, r: p.r0, lit: false, respawnAt: 0, flash: 1}); flashing.add(p);
      puff(p.x, p.y, pz(p), 10, .5);
    }
    for (const p of chests) if (p.opened && p.resetAt && simT > p.resetAt && away(p)) { p.opened = false; p.resetAt = 0; puff(p.x, p.y, pz(p), 8, .5); }
  }

  // ---------------- abilities ----------------
  function aimDir() {
    const c = host.aim(); let dx = c.x - P.x, dy = c.y - P.y, d = Math.hypot(dx, dy);
    if (d < .2) { dx = lastDir[0]; dy = lastDir[1]; d = 1; } else { dx /= d; dy /= d; }
    lastDir = [dx, dy];
    return {c, dx, dy, d: Math.max(d, .5)};
  }
  function fire(A, off, v, o) {
    const ang = Math.atan2(A.dx, A.dy) + off, fx = Math.sin(ang), fy = Math.cos(ang), h0 = P.z + 1.25, t = A.d / v;
    const vh = A.c.target || Math.abs(A.c.h - h0) > .5 ? clamp((A.c.h - h0) / t + .45 * t, -12, 8) : 0;   // same ballistics as shoot()
    host.spawnArrow({x: P.x + fx * .35, y: P.y + fy * .35, h: h0, vx: fx * v, vy: fy * v, vh, life: 1.6, ...o});
  }
  const BUSYISH = new Set(['roll', 'leap', 'fall', 'land', 'climb', 'splash', 'knock', 'hold']);
  function pose(frame, sec, A) {
    if (BUSYISH.has(P.state)) return;
    // face the shot: the player's facing lives in the camera's frame (host.P), so turn the world direction into it
    const a = host.yaw, c = Math.cos(a), s = Math.sin(a), RP = host.P;
    if (host.PL?.dirOf) RP.face = RP.want = host.PL.dirOf(A.dx * c - A.dy * s, A.dx * s + A.dy * c);
    RP.twang = 0; host.play(frame, sec);
  }
  const CAST = {
    rmb(A) {
      for (let i = 0; i < T.msN; i++) fire(A, (i / (T.msN - 1) - .5) * T.msSpread, T.msV, {dmg: T.msDmg, ab: 'multi'});
      pose('release.0', .2, A);
    },
    1(A) { fire(A, 0, T.boomV, {dmg: T.boomDmg, explode: {r: T.boomR, dmg: T.boomBlast}, ab: 'boom'}); pose('release.0', .24, A); },
    2(A) {
      let {x, y} = A.c; const d = Math.hypot(x - P.x, y - P.y);
      if (d > T.rainRange) { x = P.x + (x - P.x) / d * T.rainRange; y = P.y + (y - P.y) / d * T.rainRange; }
      zones.push({x, y, z: host.elev(x, y), t: 0, n: 0, sx: A.dx * 2.2, sy: A.dy * 2.2});
      pose('bow_draw', .3, A);
    },
    3(A) { fire(A, 0, T.pierceV, {dmg: T.pierceDmg, pierce: true, ab: 'pierce', life: 1.1, n: 0}); pose('release.0', .26, A); },
    4(A) {
      traps.push({x: P.x, y: P.y, z: P.z, t: 0, done: false});
      for (let i = 0; i < 6; i++) part(P.x, P.y, P.z + .1, RR(-1.5, 1.5), RR(-1, 1), RR(.3, 1), RR(.2, .4), DUST, {drag: 5});
      if (!BUSYISH.has(P.state) || P.state === 'hold') host.knock(-A.dx * T.vault, -A.dy * T.vault);   // vault back
    },
  };

  // ---------------- the core ----------------
  const C = {
    T, AB, SLOTS, S, PAL, FIRE, SPARK, GOLD, DUST,
    hittables, brutes, BS, chests,
    get simT() { return simT; },
    get gold() { return S.gold; },
    get cd() { return Object.fromEntries(SLOTS.map(k => [k, +AB[k].t.toFixed(2)])); },
    dbg: {debris, coins, fx, rings, nums, lts, pending, brands, zones, traps, BS, brutes, hs},
    seed(n) { seed = n; },
    damage, breakProp, explode, part, puff,

    onArrowHit(a, p) {
      const dir = [a.vx * .12, a.vy * .12];
      if (a.explode) {
        damage(p, a.dmg ?? T.boomDmg, {canCrit: true, dir});
        if (!a.done) { a.done = true; explode(a.x, a.y, host.elev(a.x, a.y), a.explode.r, a.explode.dmg, false); }
        return 'stop';
      }
      damage(p, a.dmg ?? 10, {canCrit: true, dir});
      if (a.pierce) {
        a.n = (a.n || 0) + 1;
        if (a.n < T.pierceN) {
          // carry on through: step the arrow out of this prop's collider, or the host's wall test would stick it here
          const l = Math.hypot(a.vx, a.vy) || 1, ux = a.vx / l, uy = a.vy / l;
          for (let k = 0; k < 24 && !p.broken && p.r > 0 && Math.hypot(p.x - a.x, (p.y - a.y) * SQ) < p.r + .02; k++) { a.x += ux * .05; a.y += uy * .05; }
          for (let i = 0; i < 5; i++) part(a.x, a.y, a.h, ux * RR(2, 5) + RR(-1, 1), uy * RR(2, 5), RR(-1, 1), RR(.12, .25), SPARK, {emit: true, drag: 4});
          return 'pierce';
        }
      }
      return 'stop';
    },
    onArrowStuck(a) {
      if (a.explode && !a.done) { a.done = true; explode(a.x, a.y, host.elev(a.x, a.y), a.explode.r, a.explode.dmg, false); return; }
      if (a.ab === 'rain') {   // near misses still sting
        const z = host.elev(a.x, a.y);
        for (const p of hittables) if (!p.broken && Math.abs(pz(p) - z) < 1 && Math.hypot(p.x - a.x, p.y - a.y) < .6) damage(p, T.rainSplash, {quiet: true});
        for (let i = 0; i < 3; i++) part(a.x, a.y, z + .02, RR(-1, 1), RR(-.6, .6), RR(.3, 1), RR(.15, .3), DUST, {drag: 5});
      }
    },
    ability(slot) {
      const ab = AB[slot]; if (!ab) return false;
      if (ab.t > 0) { ab.deny = .25; return false; }
      const A = aimDir();
      CAST[slot](A);
      ab.t = ab.cd; ab.cast = .9;
      return true;
    },
    interact(p) {
      if (p.interact !== 'open' || p.opened) return false;
      p.opened = true; p.wob = 1; p.flash = .8; flashing.add(p); if (T.chestReset) p.resetAt = simT + T.chestReset;
      const big = p.y > 20;   // the cache behind the crate wall pays more
      coinBurst(p.x, p.y, pz(p) + .4, big ? 24 : 16, 1.2);
      for (let i = 0; i < 14; i++) part(p.x, p.y, pz(p) + .5, RR(-1.5, 1.5), RR(-1, 1), RR(1, 3), RR(.3, .7), GOLD, {emit: true, drag: 3});
      light(p.x, p.y, pz(p) + .6, '#ffd27a', 2.8, 1.5, .7, .1);
      shake(2, .15); hitstop(.05);
      events.push({type: 'open', x: p.x, y: p.y});
      return true;
    },

    update(dt) {
      simT += dt;
      for (const k of SLOTS) {
        const ab = AB[k]; ab.deny = Math.max(0, ab.deny - dt); ab.cast = Math.max(0, ab.cast - dt); ab.ready = Math.max(0, ab.ready - dt);
        if (ab.t > 0) { ab.t -= dt; if (ab.t <= 0) { ab.t = 0; ab.ready = .3; } }
      }
      // the arena decays hit flashes at 8/s; the 3D host already decays every prop's flash at 6/s: add the rest
      for (const p of flashing) { p.flash = Math.max(0, (p.flash || 0) - dt * 2); if (!p.flash) flashing.delete(p); }
      for (let i = nums.length - 1; i >= 0; i--) if ((nums[i].t += dt) > .8) nums.splice(i, 1);
      for (let i = lts.length - 1; i >= 0; i--) if ((lts[i].t += dt) > lts[i].life) lts.splice(i, 1);
      for (let i = pending.length - 1; i >= 0; i--) if ((pending[i].t -= dt) <= 0) { const f = pending[i].fn; pending.splice(i, 1); f(); }
      // burning brands arc from one barrel to the next, then it goes up
      for (let i = brands.length - 1; i >= 0; i--) {
        const B = brands[i]; B.t += dt; const k = Math.min(1, B.t / B.dur);
        const x = B.x0 + (B.b.x - B.x0) * k, y = B.y0 + (B.b.y - B.y0) * k, a = B.z0 + (pz(B.b) + .6 - B.z0) * k + 4 * 1.2 * k * (1 - k);
        part(x, y, a, RR(-.3, .3), RR(-.3, .3), RR(.2, .8), RR(.15, .3), FIRE, {emit: true, drag: 2});
        if (k >= 1) { brands.splice(i, 1); if (!B.b.broken) breakProp(B.b, {}); }
      }
      // arrow rain
      for (let i = zones.length - 1; i >= 0; i--) {
        const Z = zones[i]; Z.t += dt;
        const due = Z.t < T.rainDelay ? 0 : Math.min(T.rainN, Math.floor((Z.t - T.rainDelay) / T.rainDur * T.rainN) + 1);
        while (Z.n < due) {
          Z.n++;
          // every other arrow seeks something breakable inside the circle (so the rain reads as hitting stuff)
          if (!Z.tg) Z.tg = hittables.filter(p => !p.broken && Math.abs(pz(p) - Z.z) < 1 && Math.hypot(p.x - Z.x, p.y - Z.y) < T.rainR);
          const live = Z.tg.filter(p => !p.broken), seek = Z.n % 2 === 0 && live.length ? live[(Z.n >> 1) % live.length] : null;
          const ang = R() * TAU, rr = seek ? R() * .2 : Math.sqrt(R()) * T.rainR * .95, cx0 = seek ? seek.x : Z.x, cy0 = seek ? seek.y : Z.y;
          const tx = cx0 + Math.sin(ang) * rr, ty = cy0 + Math.cos(ang) * rr, tf = .3, vh = -20;
          host.spawnArrow({x: tx - Z.sx * tf, y: ty - Z.sy * tf, h: Z.z - vh * tf, vx: Z.sx, vy: Z.sy, vh, dmg: T.rainDmg, life: 2, ab: 'rain'});
        }
        if (Z.t > T.rainDelay + T.rainDur + .6) zones.splice(i, 1);
      }
      // traps
      for (let i = traps.length - 1; i >= 0; i--) {
        const q = traps[i]; q.t += dt;
        if (!q.done && q.t >= T.trapArm) {
          if (q.t >= T.trapLife) burstTrap(q);
          else for (const b of brutes) if (!b.broken && b.h < .45 && Math.abs(pz(b) - q.z) < .5 && Math.hypot(b.x - q.x, b.y - q.y) < T.trapTrig) { burstTrap(q); break; }
        }
        if (q.spikes) for (const s of q.spikes) s.t += dt;
        if (q.done && q.spikes && q.spikes[0].t > .6) traps.splice(i, 1);
      }
      for (const b of brutes) updBrute(b, BS.get(b), dt);
      if ((simT % .5) < dt) restock();
      // special arrows leave sparks
      for (const a of host.arrows) {
        if (a.stuck) continue;
        if (a.explode) part(a.x, a.y, a.h, RR(-.5, .5), RR(-.5, .5), RR(0, .8), RR(.12, .25), FIRE, {emit: true, drag: 3});
        else if (a.pierce) part(a.x, a.y, a.h, 0, 0, 0, .12, SPARK, {emit: true});
      }
      // debris
      for (let i = debris.length - 1; i >= 0; i--) {
        const c = debris[i]; c.t += dt;
        if (c.rest) { if (c.t > c.life) { debris[i] = debris[debris.length - 1]; debris.pop(); } continue; }
        const nx = c.x + c.vx * dt, ny = c.y + c.vy * dt, ng = host.elev(nx, ny);
        if (ng > c.a + .1) { c.vx = -c.vx * .3; c.vy = -c.vy * .3; } else { c.x = nx; c.y = ny; }
        c.va -= 20 * dt; c.a += c.va * dt;
        const gz = host.elev(c.x, c.y);
        if (c.a <= gz) {
          c.a = gz;
          if (c.va < -1.6) { c.va = -c.va * .35; c.vx *= .55; c.vy *= .55; }
          else {
            c.rest = true; c.va = c.vx = c.vy = 0; c.t = 0;
            if (gz === 0 && host.inStream(c.x, c.y)) { debris[i] = debris[debris.length - 1]; debris.pop(); }   // sank
          }
        }
      }
      // coins: pop, bounce, then magnetise to the player
      for (let i = coins.length - 1; i >= 0; i--) {
        const c = coins[i]; c.t += dt; if (c.t < 0) continue;
        const dx = P.x - c.x, dy = P.y - c.y, dh = P.z + .6 - c.a, dist = Math.hypot(dx, dy);
        if (!c.mag && c.t > T.coinDelay && dist < T.magnet && Math.abs(P.z - host.elev(c.x, c.y)) < 1.5) c.mag = true;
        if (c.mag) {
          c.spd = Math.min(16, c.spd + 34 * dt); const l = Math.hypot(dx, dy, dh) || 1, st = Math.min(l, c.spd * dt);
          c.x += dx / l * st; c.y += dy / l * st; c.a += dh / l * st;
          if (l < .35) {
            S.gold++; S.goldPop = .25; coins[i] = coins[coins.length - 1]; coins.pop();
            part(P.x, P.y, P.z + .9, RR(-.6, .6), RR(-.3, .3), RR(1, 2), .25, GOLD, {emit: true});
            if (S.gold % 5 === 0) events.push({type: 'coin', x: P.x, y: P.y});
          }
          continue;
        }
        if (c.rest) continue;
        const nx = c.x + c.vx * dt, ny = c.y + c.vy * dt;
        if (host.elev(nx, ny) > c.a + .1) { c.vx = -c.vx * .4; c.vy = -c.vy * .4; } else { c.x = nx; c.y = ny; }
        c.va -= 22 * dt; c.a += c.va * dt;
        const gz = host.elev(c.x, c.y);
        if (c.a <= gz) { c.a = gz; if (c.va < -1.8) { c.va = -c.va * .45; c.vx *= .6; c.vy *= .6; } else { c.va = c.vx = c.vy = 0; c.rest = true; } }
      }
      // particles
      for (let i = fx.length - 1; i >= 0; i--) {
        const q = fx[i]; q.t += dt; if (q.t < 0) continue;
        if (q.t > q.life) { fx[i] = fx[fx.length - 1]; fx.pop(); continue; }
        if (q.drag) { const k = Math.max(0, 1 - q.drag * dt); q.vx *= k; q.vy *= k; q.va *= k; }
        q.x += q.vx * dt; q.y += q.vy * dt; q.va -= q.grav * dt; q.a += q.va * dt;
        if (q.grav) { const gz = host.elev(q.x, q.y); if (q.a < gz) { q.a = gz; q.va = -q.va * .3; q.vx *= .5; q.vy *= .5; } }
      }
      for (let i = rings.length - 1; i >= 0; i--) if ((rings[i].t += dt) > rings[i].life) rings.splice(i, 1);
      S.goldPop = Math.max(0, S.goldPop - dt);
      const cds = SLOTS.filter(k => AB[k].t > 0).map(k => `${AB[k].key} ${AB[k].t.toFixed(1)}s`);
      S.hud = `gold ${S.gold}` + (cds.length ? ' · cd ' + cds.join(' ') : '');
    },
    lights() {
      const out = [];
      for (const L of lts) { const k = L.t / L.life; out.push({x: L.x, y: L.y, h: L.h, color: L.color, radius: L.radius * (1 - k * .3), intensity: L.i0 * (1 - k) ** 1.5, flicker: L.flicker, id: L.id}); }
      let n = 0;
      for (const a of host.arrows) if (a.explode && !a.stuck && n < 2) out.push({x: a.x, y: a.y, h: a.h, color: '#ff9a40', radius: 1.6, intensity: .9, flicker: .5, id: 7190 + n++});
      return out;
    },
  };
  return C;
}
