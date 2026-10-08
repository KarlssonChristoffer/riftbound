// PLAYER ADAPTER: the arena's player.js runs unchanged in the CAMERA'S frame ("view frame": x = screen right, y = toward
// the camera), where the projection is exactly the arena's, so its aiming, cursor reading, facing and WASD work as they
// are (WASD is camera-relative for free). This module is the bridge to the world: its collision / elevation / stream in
// world coordinates, the world-frame view of him every system reads (`player`), turning his view-frame state when the
// camera turns, the cursor's target (ARPG aim), the nearest interactable, and climbing at any camera angle (the camera
// eases to north for the climb and back after: `assist`).
// OWNS: PL (player.js) and P (its state), the aim memo, the climb assist, the held frame (photo mode).  READS: the world, the entities (near: what
//   blocks him, what he can interact with), the camera, the hero's atlas, features' aimTarget / interact.
// EMITS (via player.js): player.step / land / jump / splash (turned into world coordinates here; core/events.js).
//   const pa = createPlayerHost({...}); const {PL, P, player} = pa
import {createPlayer, BUSY} from './player.js';
import {createGun} from './gun.js';   // a gun loadout's revolver (player.js H.gun)
import {createLasso} from './lasso.js';   // the equipment experiment's lasso in his hands (player.js H.lasso)
import {walkable, elev, inStream, PLATEAUS, CLIMBS, steep, TERRAIN_ON, vaultTop} from '../../world/world.js';

const R_BODY = .25;
// THE STONE WALLS' BREACHES (world/walls3d.js, world.js vaultTop): rubble no higher than STEP_OVER over his feet is stepped over (it
// doesn't block him); a breach up to VAULT_OVER is vaulted (Space: player.js tryVault, H.wallOver below); a whole stretch of the arena's
// walls stays a wall. The West Downs' old field walls ('fieldwall': round colliders) are low: vaulted anywhere, stepped over where
// broken down. Only the player: the brutes' nav and colliders still treat every segment as a wall
const STEP_OVER = .3, VAULT_OVER = 1.25, WALLK = new Set(['wall_n', 'wall_s', 'wall_w', 'wall_e', 'fieldwall']);

export function createPlayerHost({G, ctxO, PPM, PPMY, cv, hero, keys, mouse, cam, events, features, world: worldOf, ents, biome, opt: optOf, proj, flags, mods, canLaunch = null}) {
  const toView = cv.toView, toWorld = cv.toWorld;
  const nearB = [], nearI = [];   // the grid's candidates (world/entities.js near)
  const aimable = ents().query('player.aim', p => p.hp > 0 || p.target || p.breakable);   // what the cursor can aim at (a live list)
  // a run rule's wind on the player (features/omens.js, a gale): host.mods 'player.windX' / 'player.windY' (world axes, the
  // share of speed gained moving along it: .25 = 25% faster with it, slower against it), turned into the view frame for
  // player.js's moveBy (H.wind: null without one)
  let PWX = 0, PWY = 0; const PWV = [0, 0];
  if (mods) { const f = () => { PWX = mods.value('player.windX', 0); PWY = mods.value('player.windY', 0); }; mods.watch(f); f(); }
  const windV = () => { if (!PWX && !PWY) return null; const c = Math.cos(cv.yaw), s = Math.sin(cv.yaw); PWV[0] = PWX * c - PWY * s; PWV[1] = PWX * s + PWY * c; return PWV; };
  // collision in the world (round, so it doesn't change with the camera; the arena squashes it to match its 2D look)
  function blocked(x, y, z, air) {
    if (!walkable(x, y)) return true;
    if (!air && inStream(x, y)) return true;
    if (elev(x, y) > z + .3) return true;
    if (!air && steep(x, y) && elev(x, y) > z + .01) return true;   // walkable terrain: no walking up a cliff or a ramp's side (not even in small steps)
    for (const p of ents().near(x, y, R_BODY, nearB)) if (!p.broken && !p.gone && Math.abs((p.z || 0) - z) < 1 && (p.rect ? x > p.rect[0] - R_BODY && x < p.rect[2] + R_BODY && y > p.rect[1] - R_BODY && y < p.rect[3] + R_BODY
      : p.r && Math.hypot(p.x - x, p.y - y) < p.r + R_BODY) && !rubble(p, z)) return true;
    return false;
  }
  // a wall segment broken down to rubble he steps over
  function rubble(p, z) { if (!WALLK.has(p.kind)) return false; const b = vaultTop(p); return b !== null && (p.z || 0) + b <= z + STEP_OVER; }
  // a breach to vault, ahead of him along (ux, uz) (world frame) -> {d (m to where he lands), top (the stones' top), z1 (the ground
  // there)} or null: a stone wall's segment within reach whose top (with those either side of where he crosses: the highest) is more
  // than a step and at most VAULT_OVER over his feet, every one of them a breach (a whole stretch is no way over), and a clear spot on
  // walkable ground about level with his on its far side
  const nearW = [];
  function wallAt(x, z) { for (const p of ents().near(x, z, .8, nearW)) if (WALLK.has(p.kind) && !p.gone && (p.rect ? x > p.rect[0] && x < p.rect[2] && z > p.rect[1] && z < p.rect[3] : Math.hypot(p.x - x, p.y - z) < p.r + .08)) return p; return null; }   // (+ .08: a field wall's round segments stand ~.6 m apart, a line between two of them misses both)
  function wallOver(X, Z, ux, uz, z) {
    for (let d = .1; d <= .85; d += .05) {
      const qx = X + ux * d, qz = Z + uz * d; if (!wallAt(qx, qz)) continue;
      let top = -1;
      for (const s of [-R_BODY, 0, R_BODY]) {   // (across his line: the body's width)
        const p = wallAt(qx - uz * s, qz + ux * s); if (!p) continue;
        const b = vaultTop(p); if (b === null) return null;
        top = Math.max(top, (p.z || 0) + b);
      }
      if (top - z <= STEP_OVER || top - z > VAULT_OVER) return null;
      for (let d2 = d + .3; d2 <= d + 1.6; d2 += .05) {
        const lx = X + ux * d2, lz = Z + uz * d2, e = elev(lx, lz);
        if (wallAt(lx, lz) || blocked(lx, lz, e, false)) continue;   // (still in the wall, or against it)
        if (Math.abs(e - z) > .6) return null;
        return {d: d2 + .08, top, z1: elev(X + ux * (d2 + .08), Z + uz * (d2 + .08)), near: d, thick: d2 - d};   // (near: m to its face; thick: through it)
      }
      return null;
    }
    return null;
  }
  // the wall's face where he meets it (Space, once: player.js tryVault): its first stone along two lines .3 m to his left and
  // right of his way, from near - .5 to near + .6 m -> {slant (rad: 0 square on), side (+1: nearer on his left, -1 his right,
  // 0 square)} or null (a line meets no stone). His left is (uz, -ux) in the world as in his view frame (the same hand)
  function wallSlant(X, Z, ux, uz, near) {
    const lx = uz, lz = -ux, hit = s => { for (let e = Math.max(.05, near - .5); e <= near + .6; e += .05) if (wallAt(X + ux * e + lx * s, Z + uz * e + lz * s)) return e; return -1; };
    const dl = hit(.3), dr = hit(-.3); if (dl < 0 || dr < 0) return null;
    return {slant: Math.atan2(Math.abs(dr - dl), .6), side: dl < dr - .02 ? 1 : dl > dr + .02 ? -1 : 0};
  }
  // the ground's slope at view-frame (x, y): out = [gx, gy] its rise per metre along the view's x and y, out[2] = rise / run the steepest
  // way (no allocation: the world <-> view turn inline, viewxf's)
  const E2 = .125;
  function gradV(x, y, out) {
    const c = Math.cos(cv.yaw), s = Math.sin(cv.yaw), X = x * c + y * s, Z = -x * s + y * c;
    const gx = (elev(X + E2, Z) - elev(X - E2, Z)) / (2 * E2), gz = (elev(X, Z + E2) - elev(X, Z - E2)) / (2 * E2);
    out[0] = gx * c - gz * s; out[1] = gx * s + gz * c; out[2] = Math.hypot(gx, gz); return out;
  }
  // the plateau as the player sees it. Exact when the camera faces north; turned, the climb spot is handled here
  const plateausV = PLATEAUS.map(q => ({...q}));
  // the climbs as the player sees them: a face is climbed in the camera's frame at the yaw that looks straight at it (the face then lies
  // to the north there, as player.js climbs); at any other yaw it is out of his reach and climbSpotW / climbAssist handle it here
  const climbsV = CLIMBS.map(c => ({x: 1e9, y: 0, w: c.w, h0: c.h0, h1: c.h1, reach: c.reach, cos: Math.cos(c.yaw), sin: Math.sin(c.yaw)}));
  const yawOff = a => { let d = a - cv.yaw; if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; return d; };
  function syncPlateaus() {
    PLATEAUS.forEach((q, i) => Object.assign(plateausV[i], Math.abs(cv.yaw) < 1e-6 ? {...q} : {h: q.h, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, climbs: []}));
    for (let i = 0; i < CLIMBS.length; i++) {   // (viewxf toView at the climb's own yaw)
      const c = CLIMBS[i], v = climbsV[i];
      if (Math.abs(yawOff(c.yaw)) < 1e-6) { v.x = c.x * v.cos - c.y * v.sin; v.y = c.x * v.sin + c.y * v.cos; } else v.x = 1e9;
    }
  }
  const PL = createPlayer({
    ctx: ctxO, atlas: hero.atlas, keys, mouse, cam, events, mods, plateaus: plateausV, climbs: climbsV, wind: windV, terrain: TERRAIN_ON,
    weapon: () => hero.weapon, gun: createGun,   // the loadout's weapon (content/weapons.js) and, for a gun, its revolver
    lasso: createLasso, yaw: () => cv.yaw,      // the lasso's hands (idle unless features/equip/lasso.js uses them); the camera's yaw (its swing is in the world)
    blocked: (x, y, z = PL.P.z, air = false) => { const [X, Z] = toWorld(x, y); return blocked(X, Z, z, air); },
    wallOver: (x, y, dx, dy, z) => { const [X, Z] = toWorld(x, y), [ux, uz] = toWorld(dx, dy); return wallOver(X, Z, ux, uz, z); },   // (a rotation: d is the same in his frame)
    wallSlant: (x, y, dx, dy, near) => { const [X, Z] = toWorld(x, y), [ux, uz] = toWorld(dx, dy); return wallSlant(X, Z, ux, uz, near); },
    elev: (x, y) => { const [X, Z] = toWorld(x, y); return elev(X, Z); },
    grad: TERRAIN_ON ? gradV : null,   // walkable terrain's slope (player.js SLIDE)
    inStream: (x, y) => { const [X, Z] = toWorld(x, y); return inStream(X, Z); },
    pixelBow: () => !optOf().hdBow,   // J: the bowstring + nocked / flying arrows at art pixels (default) or the HD overlay
    onShoot: a => { const [x, y] = toWorld(a.x, a.y), [vx, vy] = toWorld(a.vx, a.vy); proj.spawn({...a, x, y, vx, vy}); },
    aimTarget: () => { const t = hoverTarget(); if (!t) return null; const v = toView(t.x, t.y); return {x: v[0], y: v[1], h: t.h, target: t.target}; },
    nearInteract: () => nearProp(),
    onInteract: p => features.some(f => f.interact?.(p)),
    dust: (fx, fy, side, big) => {   // a foot contact at view-frame world px -> world metres
      if (biome().dust === false) return;
      const [sx, sy] = ctxO.toS(PL.P.x, PL.P.y, PL.P.z), dvx = (fx - sx) / PPM, dvy = (fy - sy) / PPMY, [x, y] = toWorld(PL.P.x + dvx, PL.P.y + dvy);
      for (let i = 0; i < 3 + big * 2; i++) { const [vx, vy] = toWorld((Math.random() - .5) * .45, 0); proj.dust.push({x, y, h: PL.P.z + .02, vx, vy, vh: Math.random() * .2, t: 0, life: .3 + Math.random() * .2}); }
    },
    shake: (a, sec) => cv.shake(a, sec),
    canLaunch,   // a blast may throw him (sim/player/launch.js): main.js, his loadout drawn live
  });
  const P = PL.P;
  { const at = (flags.get('at') || '').split(',').map(Number), sp = worldOf().layout.spawn, [vx, vy] = toView(at.length === 2 ? at[0] : sp.x, at.length === 2 ? at[1] : sp.y); P.x = vx; P.y = vy; P.z = elev(...toWorld(vx, vy)); }
  // the player as features see it: world frame, live
  // (x / y are read dozens of times a frame: computed once per move or turn, not per read)
  let pwX = 0, pwY = 0, pwA = NaN, pwB = NaN, pwYaw = NaN;
  function pwSync() { if (P.x !== pwA || P.y !== pwB || cv.yaw !== pwYaw) { pwA = P.x; pwB = P.y; pwYaw = cv.yaw; const c = Math.cos(cv.yaw), s = Math.sin(cv.yaw); pwX = P.x * c + P.y * s; pwY = -P.x * s + P.y * c; } }
  const player = {
    get x() { pwSync(); return pwX; }, get y() { pwSync(); return pwY; }, get z() { return P.z; },
    get vx() { return toWorld(P.vx, P.vy)[0]; }, get vy() { return toWorld(P.vx, P.vy)[1]; },
    get faceAngle() { return P.face * 2 * Math.PI / hero.ND + cv.yaw; },                          // world: 0 = south, +pi/2 = east
    get face() { const ND = hero.ND; return (((Math.round(P.face + cv.yaw / (2 * Math.PI / ND))) % ND) + ND) % ND; },   // world facing index (arena's dirOf)
    get viewFace() { return P.face; }, get state() { return P.state; }, get t() { return P.t; }, get frame() { return P.frame; },
    get gait() { return P.gait; }, get sink() { return P.sink || 0; }, get aiming() { return P.state === 'draw'; }, get blink() { return P.blink || 0; },
    get untouchable() { return PL.untouchable(); },   // dodging: a roll, or a backstep's first moment
    get raw() { return P; },
  };

  // the camera turned by d: everything the player keeps in view-frame coordinates turns with it
  let faceAcc = 0;
  function turnFrame(d) {
    const ND = hero.ND, c = Math.cos(d), s = Math.sin(d), rot = (x, y) => [x * c - y * s, x * s + y * c];
    [P.x, P.y] = rot(P.x, P.y); [P.vx, P.vy] = rot(P.vx, P.vy);
    if (P.rollDir) P.rollDir = rot(...P.rollDir);
    if (P.back) P.back = rot(...P.back);
    if (P.leap) { [P.leap.x0, P.leap.y0] = rot(P.leap.x0, P.leap.y0); [P.leap.dx, P.leap.dy] = rot(P.leap.dx, P.leap.dy); }
    if (P.vault) { [P.vault.x0, P.vault.y0] = rot(P.vault.x0, P.vault.y0); [P.vault.dx, P.vault.dy] = rot(P.vault.dx, P.vault.dy); }
    // (the lasso's swing keeps its state in the world and writes P from it every step: nothing of it to turn)
    faceAcc -= d / (2 * Math.PI / ND);
    const n = Math.round(faceAcc);
    if (n) { P.face = (((P.face + n) % ND) + ND) % ND; P.want = (((P.want + n) % ND) + ND) % ND; faceAcc -= n; }
  }
  // HOLD (ui/photo.js: photo mode turns the camera while the sim stands still): hold() notes what turnFrame turns; release()
  // puts it back exactly, once the camera is back at the yaw it was noted at (turned there and back in floating point it
  // wouldn't be bit for bit, and the sim must leave photo mode as it came in)
  let held = null;
  function hold() {
    const L = P.leap, V = P.vault;
    held = {x: P.x, y: P.y, vx: P.vx, vy: P.vy, rollDir: P.rollDir, back: P.back, leap: L ? [L.x0, L.y0, L.dx, L.dy] : null, vault: V ? [V.x0, V.y0, V.dx, V.dy] : null, face: P.face, want: P.want, faceAcc};
  }
  function release() {
    const h = held; if (!h) return; held = null;
    P.x = h.x; P.y = h.y; P.vx = h.vx; P.vy = h.vy; P.rollDir = h.rollDir; P.back = h.back; P.face = h.face; P.want = h.want; faceAcc = h.faceAcc;
    if (h.leap && P.leap) [P.leap.x0, P.leap.y0, P.leap.dx, P.leap.dy] = h.leap;
    if (h.vault && P.vault) [P.vault.x0, P.vault.y0, P.vault.dx, P.vault.dy] = h.vault;
  }
  // the player's events are in the view frame: into the world's
  function toWorldEvent(e) {
    if (e.x !== undefined && e.y !== undefined) [e.x, e.y] = toWorld(e.x, e.y);
    if (e.vx !== undefined && e.vy !== undefined) [e.vx, e.vy] = toWorld(e.vx, e.vy);
  }

  // ARPG targeting: the cursor over something hittable aims at it (front-most), at the height the cursor points at on it
  // (head, chest or legs; kept inside its hit height). -> {x, y, h (aim height), target} world
  let hoverKey = 0, hoverAt = -1, hoverMemo = null;   // hoverKey: bumped at the start of every step and draw (tick)
  function hoverTarget() {
    if (hoverAt === hoverKey) return hoverMemo;
    hoverAt = hoverKey; return (hoverMemo = hoverFind());
  }
  const HS0 = [0, 0, 0], HS1 = [0, 0, 0];   // (screen points: through the GAME's view, G.gameToScreen, whatever a cinema camera draws)
  function hoverFind() {
    for (const f of features) { const t = f.aimTarget?.(); if (t) return t; }
    let best = null, bn = -1e9, bh = 0;
    const mx = cv.VW / 2 + (mouse.x - cv.VW / 2) * cv.zoom, my = cv.VH / 2 + (mouse.y - cv.VH / 2) * cv.zoom;
    for (const p of aimable) {
      if (p.broken || p.gone || !(p.target || p.hp > 0)) continue;
      const z0 = (p.z || 0) + (p.h || 0), hh = p.hitH ?? (p.kind === 'pot' ? .55 : p.kind === 'crate' ? .75 : 1.6), rr = Math.max(.3, p.hitR ?? p.r ?? .4);
      const s0 = G.gameToScreen(p.x, z0 + hh, p.y, HS0), x0 = s0[0], y0 = s0[1], y1 = G.gameToScreen(p.x, z0, p.y, HS1)[1], w = rr * PPM * cv.zoom;
      if (mx > x0 - w - 2 && mx < x0 + w + 2 && my > y0 - 3 && my < y1 + 3) {
        const n = toView(p.x, p.y)[1];
        if (n > bn) { bn = n; best = p; bh = z0 + hh * Math.max(.08, Math.min(.95, (y1 - my) / (y1 - y0 || 1))); }
      }
    }
    return best && {x: best.x, y: best.y, h: bh, target: best};
  }
  function nearProp() {
    let best = null, bd = 1.3; const px = player.x, py = player.y;
    for (const p of ents().near(px, py, bd, nearI)) if (p.interact && !p.opened && Math.abs((p.z || 0) - P.z) < .5) { const d = Math.hypot(p.x - px, p.y - py); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  // climbing at any camera angle: the climb spot is checked in the world; the climb itself runs at the yaw that faces its wall (the
  // camera eases there while you climb, and back to where it was after)
  const CS = {c: null, dir: 0};
  function climbSpotW() {   // player.js climbSpot, in the world: -> {c (layout.js CLIMBS), dir: 1 up / -1 down} (one object, reused) or null
    const x = player.x, y = player.y;
    for (const c of CLIMBS) {
      const dx = x - c.x, dy = y - c.y, o = dx * c.nx + dy * c.ny, a = dy * c.nx - dx * c.ny;   // (o: out from the face, a: along it)
      if (Math.abs(a) > c.w / 2 + .45) continue;
      if (P.z < c.h0 + .05 && o >= -.05 && o < 1.3) { CS.c = c; CS.dir = 1; return CS; }
      if (Math.abs(P.z - c.h1) < .05 && o <= 0 && o > -1.3) { CS.c = c; CS.dir = -1; return CS; }
    }
    return null;
  }
  // E at a climb spot while the camera looks another way: the camera eases round to face the wall, then he climbs (true: started)
  function climbAssist() {
    if (nearProp() || BUSY.has(P.state)) return false;
    const cs = climbSpotW(); if (!cs || Math.abs(yawOff(cs.c.yaw)) <= 1e-6) return false;
    A.assist = {back: cv.yaw, phase: 'in', to: cs.c.yaw}; return true;
  }
  const A = {assist: null};   // {back: yaw to return to, phase: 'in' | 'climb' | 'back', to: the yaw to climb at (0)}
  function stepAssist(dt, ny) {
    const assist = A.assist, climbing = P.state === 'climb' || P.state === 'mantle';
    if (assist.phase === 'in') {
      const to = assist.to || 0, d = yawOff(to);
      ny = Math.abs(d) < .004 ? to : to - d * Math.exp(-dt * 12);
      if (ny === to) { cv.setYaw(to); syncPlateaus(); PL.onInteractKey(); PL.onInteractUp(); assist.phase = P.state === 'climb' ? 'climb' : 'back'; }
    } else if (assist.phase === 'climb') { ny = assist.to || 0; if (!climbing) assist.phase = 'back'; }
    else {
      const d = Math.atan2(Math.sin(assist.back - cv.yaw), Math.cos(assist.back - cv.yaw));
      ny = Math.abs(d) < .002 ? assist.back : cv.yaw + d * (1 - Math.exp(-dt * 8)); if (Math.abs(d) < .002) A.assist = null;
    }
    return ny;
  }
  // put the player at world (x, y), standing, and snap the camera there
  function teleport(x, y) {
    const [vx, vy] = toView(x, y);
    Object.assign(P, {x: vx, y: vy, z: elev(x, y), vx: 0, vy: 0, state: 'idle', t: 0, sink: 0, leap: null, hold: null});
    cv.snap(); snap();
  }
  // DRAWING BETWEEN SIM STEPS (core/loop.js, the fixed step): snap() at each step's start notes where he was, in the
  // WORLD (a camera turn between steps doesn't move him there); lerpBegin(alpha) puts P alpha of the way to where he is
  // now, in the current view frame, for the draw; lerpEnd() puts the true P back
  let l0 = NaN, l1 = NaN, l2 = NaN, c0 = 0, c1 = 0, c2 = 0, lerping = false;
  function snap() { l0 = player.x; l1 = player.y; l2 = P.z; }
  function lerpBegin(k) {
    if (k >= 1 || l0 !== l0) return;
    const x = player.x, y = player.y, z = P.z; if (x === l0 && y === l1 && z === l2) return;
    c0 = P.x; c1 = P.y; c2 = P.z; lerping = true;
    const [vx, vy] = toView(l0 + (x - l0) * k, l1 + (y - l1) * k); P.x = vx; P.y = vy; P.z = l2 + (z - l2) * k;
  }
  function lerpEnd() { if (!lerping) return; P.x = c0; P.y = c1; P.z = c2; lerping = false; }
  return {PL, P, player, blocked, syncPlateaus, turnFrame, hold, release, toWorldEvent, hoverTarget, nearProp, climbSpotW, climbAssist, stepAssist, teleport, snap, lerpBegin, lerpEnd,
    tick() { hoverKey++; }, get assist() { return A.assist; }, set assist(v) { A.assist = v; },
    // (views) the part of a facing step the camera has turned since P.face last moved with it (turnFrame's remainder):
    // his facing in the world without the camera's 16-step rounding is (P.face + faceRest) x 360 / ND + yaw (view/livehero.js)
    get faceRest() { return faceAcc; }};
}
