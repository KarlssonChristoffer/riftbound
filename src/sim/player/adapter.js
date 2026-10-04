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
import {createPlayer} from './player.js';
import {createGun} from './gun.js';   // a gun loadout's revolver (player.js H.gun)
import {createLasso} from './lasso.js';   // the equipment experiment's lasso in his hands (player.js H.lasso)
import {walkable, elev, inStream, PLATEAUS} from '../../world/world.js';

const R_BODY = .25;

export function createPlayerHost({G, ctxO, PPM, PPMY, cv, hero, keys, mouse, cam, events, features, world: worldOf, ents, biome, opt: optOf, proj, flags, mods}) {
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
    for (const p of ents().near(x, y, R_BODY, nearB)) if (!p.broken && !p.gone && Math.abs((p.z || 0) - z) < 1 && (p.rect ? x > p.rect[0] - R_BODY && x < p.rect[2] + R_BODY && y > p.rect[1] - R_BODY && y < p.rect[3] + R_BODY
      : p.r && Math.hypot(p.x - x, p.y - y) < p.r + R_BODY)) return true;
    return false;
  }
  // the plateau as the player sees it. Exact when the camera faces north; turned, the climb spot is handled here
  const plateausV = PLATEAUS.map(q => ({...q}));
  function syncPlateaus() { PLATEAUS.forEach((q, i) => Object.assign(plateausV[i], Math.abs(cv.yaw) < 1e-6 ? {...q} : {h: q.h, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, climbs: []})); }
  const PL = createPlayer({
    ctx: ctxO, atlas: hero.atlas, keys, mouse, cam, events, mods, plateaus: plateausV, wind: windV,
    weapon: () => hero.weapon, gun: createGun,   // the loadout's weapon (content/weapons.js) and, for a gun, its revolver
    lasso: createLasso, yaw: () => cv.yaw,      // the lasso's hands (idle unless features/equip/lasso.js uses them); the camera's yaw (its swing is in the world)
    blocked: (x, y, z = PL.P.z, air = false) => { const [X, Z] = toWorld(x, y); return blocked(X, Z, z, air); },
    elev: (x, y) => { const [X, Z] = toWorld(x, y); return elev(X, Z); },
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
    const L = P.leap;
    held = {x: P.x, y: P.y, vx: P.vx, vy: P.vy, rollDir: P.rollDir, back: P.back, leap: L ? [L.x0, L.y0, L.dx, L.dy] : null, face: P.face, want: P.want, faceAcc};
  }
  function release() {
    const h = held; if (!h) return; held = null;
    P.x = h.x; P.y = h.y; P.vx = h.vx; P.vy = h.vy; P.rollDir = h.rollDir; P.back = h.back; P.face = h.face; P.want = h.want; faceAcc = h.faceAcc;
    if (h.leap && P.leap) [P.leap.x0, P.leap.y0, P.leap.dx, P.leap.dy] = h.leap;
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
  function hoverFind() {
    for (const f of features) { const t = f.aimTarget?.(); if (t) return t; }
    let best = null, bn = -1e9, bh = 0;
    const mx = cv.VW / 2 + (mouse.x - cv.VW / 2) * cv.zoom, my = cv.VH / 2 + (mouse.y - cv.VH / 2) * cv.zoom;
    for (const p of aimable) {
      if (p.broken || p.gone || !(p.target || p.hp > 0)) continue;
      const z0 = (p.z || 0) + (p.h || 0), hh = p.hitH ?? (p.kind === 'pot' ? .55 : p.kind === 'crate' ? .75 : 1.6), rr = Math.max(.3, p.hitR ?? p.r ?? .4);
      const [x0, y0] = G.toScreen(p.x, z0 + hh, p.y), [, y1] = G.toScreen(p.x, z0, p.y), w = rr * PPM * cv.zoom;
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
  // climbing at any camera angle: the climb spot is checked in the world; the climb itself runs at yaw 0 (the camera
  // eases there while you climb, and back to where it was after)
  function climbSpotW() {   // player.js climbSpot, in the world
    const x = player.x, y = player.y;
    for (const q of PLATEAUS) for (const c of q.climbs || []) {
      if (Math.abs(x - c.x) > c.w / 2 + .45) continue;
      if (P.z < .05 && y >= q.y1 - .05 && y < q.y1 + 1.3) return true;
      if (Math.abs(P.z - q.h) < .05 && y <= q.y1 && y > q.y1 - 1.3) return true;
    }
    return false;
  }
  const A = {assist: null};   // {back: yaw to return to, phase: 'in' | 'climb' | 'back'}
  function stepAssist(dt, ny) {
    const assist = A.assist, climbing = P.state === 'climb' || P.state === 'mantle';
    if (assist.phase === 'in') {
      ny = Math.abs(cv.yaw) < .004 ? 0 : cv.yaw * Math.exp(-dt * 12);
      if (ny === 0) { cv.setYaw(0); syncPlateaus(); PL.onInteractKey(); PL.onInteractUp(); assist.phase = P.state === 'climb' ? 'climb' : 'back'; }
    } else if (assist.phase === 'climb') { ny = 0; if (!climbing) assist.phase = 'back'; }
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
  return {PL, P, player, blocked, syncPlateaus, turnFrame, hold, release, toWorldEvent, hoverTarget, nearProp, climbSpotW, stepAssist, teleport, snap, lerpBegin, lerpEnd,
    tick() { hoverKey++; }, get assist() { return A.assist; }, set assist(v) { A.assist = v; },
    // (views) the part of a facing step the camera has turned since P.face last moved with it (turnFrame's remainder):
    // his facing in the world without the camera's 16-step rounding is (P.face + faceRest) x 360 / ND + yaw (view/livehero.js)
    get faceRest() { return faceAcc; }};
}
