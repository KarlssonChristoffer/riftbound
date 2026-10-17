// WINTER (docs/WINTER.md): the lying snow you wade in, and snowballs. Knobs: content/winter.js. (The tracks are
// features/prints.js's, the lake ice features/ice.js's.)
//   SIM    update: the snow's depth where he stands -> modifier notes (source 'winter': 'player.speed' slower, 'player.sink'
//          deeper; set when the depth crosses a step), the moose-hide boots' 'soft.slow' note scales them. A snowball: made
//          (E held on snow, empty hands), thrown (LMB at the cursor), flown in fixed steps; its hit is decided by the thrower
//          (him: his ball against the friends where he sees them), told to everyone through the server ('snow' message)
//   VIEW   the ball in the air, the white burst where it lands, the splat on a body for TUNE.ball.splat s (his and any
//          friend's), a hat on the ground till he walks over it
// Only in the persistent world (the sandbox's ruins biome: the forest); ?wx2=0: none.
// OWNS: its modifier source 'winter', the balls in the air, the splats, the hats lying. READS: host.player, host.env (snowCover),
//   host.keys (E held), host.aim, host.mods ('soft.slow'), host.inStream, host.entities (near: the trees a ball hits), caves (down),
//   coop (online, net: the peers' snapshots, snow(), mail), gear (S.worn, takeOff, wear: the hat knocked off). EMITS: snow.hit.
// API: F.depth (m, where he stands), F.holding (a snowball in hand), F.splatOn(id) -> s left (0: none; id 0: him)
// BUDGET: sim ~.005 ms a step (a near() of .6 m per ball in the air); view < .02 ms.
import {TUNE} from '../content/winter.js';
import {gearById} from '../content/gear.js';
import {HUT} from '../world/layout.js';
import {flags} from '../core/flags.js';
import {viewRandom, simRandom} from '../core/rng.js';

const ON = flags.get('wx2') !== '0';
const R = viewRandom('winter'), rr = (a, b) => a + R() * (b - a);
const SR = simRandom('winter');   // (the sim's draws: a hat knocked off)
const B = TUNE.ball, SN = TUNE.snow;

// ORDER (core/features.js): after co-op (its mail this step: a friend's snowball on someone), the caves (down: no snow) and
// the foraging (an E held among berries is the picking's)
export const order = {after: ['coop', 'caves', 'forage']};

export async function create(host) {
  const game = () => host.feature('game'), ui = () => game()?.ui || null;
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const F = {name: 'winter', label: 'Winter (snow, snowballs)', on: true, depth: 0, holding: false};
  let caves = null, coop = null, gear = null;
  let softK = 1;
  host.mods.watch(() => { softK = host.mods.value('soft.slow', 1); }); softK = host.mods.value('soft.slow', 1);

  // ---- DEPTH: the snow where he stands (none in the cave, the hut, on water)
  function depthAt(x, y) {
    const E = host.env; if (!E || !(E.snowCover > SN.need) || caves?.down) return 0;
    if (HUT && x > HUT.x0 && x < HUT.x1 && y > HUT.y0 && y < HUT.y1) return 0;
    if (host.inStream?.(x, y)) return 0;
    return E.snowCover * SN.depth;
  }
  let key = -1;
  function setNotes(d) {
    const k = Math.round(d / SN.depth / SN.q) * SN.q * softK;
    if (k === key) return; key = k;
    if (k <= 0) { host.mods.clear('winter'); return; }
    host.mods.set('winter', [{stat: 'player.speed', mul: 1 - SN.slow * k}, {stat: 'player.sink', add: SN.sink * k}]);
  }

  // ---- SNOWBALLS: in hand, in the air (a small pool), the splats, the hats lying
  let making = -1, cd = 0, wantThrow = false, eHeld = false;
  const balls = [];   // {x, y, h, vx, vy, vh, t, mine, land}
  const splats = new Map();   // player id (0: him) -> s left
  const hats = [];    // {id, x, y, z}
  const bursts = [];  // view: {x, y, h, vx, vy, vh, t}
  const SNOWC = [.92, .95, 1];
  const myId = () => (coop?.online ? coop.net.id : 0);
  const SMP = {x: 0, y: 0, z: 0, phi: 0};
  const nearT = [];

  function free() { const P = host.player; return !host.lock && !host.paused && !host.BUSY.has(P.state) && !host.PL.tool?.S.mode && !host.PL.nearInteract?.(); }
  function throwAt(tx, ty) {
    const P = host.player, dx = tx - P.x, dy = ty - P.y, d = Math.min(B.reach, Math.max(1, Math.hypot(dx, dy)));
    const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
    // a lob that comes down at the cursor's distance: the flight's time from the speed, the rise from the time
    const T = d / B.speed, vh = Math.min(B.up * 2, (B.g * T) / 2 - .4 / T);
    balls.push({x: P.x + ux * .4, y: P.y + uy * .4, h: P.z + 1.5, vx: ux * B.speed, vy: uy * B.speed, vh, t: 0, mine: true});
    host.events.push({type: 'snow.throw', x: P.x, y: P.y, z: P.z});
  }
  // a ball lands (on the ground, a tree) or hits (a friend: told through the server; him: a ball from the sandbox's menu)
  function hitPlayer(id, b) {
    const sp = Math.hypot(b.vx, b.vy) || 1, vx = b.vx / sp * B.push, vy = b.vy / sp * B.push, hat = SR() < B.hat;
    if (coop?.online && id !== myId()) { coop.snow?.({id, vx: +vx.toFixed(2), vy: +vy.toFixed(2), hat: hat ? 1 : 0}); }
    struck(id, vx, vy, hat);
  }
  function struck(id, vx, vy, hat) {   // a ball hit player id (its thrower's word): a splat on them; him: a stagger, the hat off
    splats.set(id, B.splat);
    const P = host.player;
    if (id === myId()) {
      host.knock(vx, vy);
      if (hat) {
        const head = gear?.S.worn.find(g => gearById(g)?.slot === 'head');
        if (head) { gear.takeOff('head'); hats.push({id: head, x: P.x + vx * .45, y: P.y + vy * .45, z: P.z, t: 0}); ui()?.float(P.x, P.y, P.z + 2, 'hat off!', '#e8eef8'); }
      }
      host.events.push({type: 'snow.hit', x: P.x, y: P.y, z: P.z, id});
    }
  }
  function burst(x, y, h, n) { for (let i = 0; i < n && bursts.length < 90; i++) { const a = R() * 6.283, s = rr(.6, 1.8); bursts.push({x, y, h, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: rr(.6, 1.8), t: rr(.35, .6)}); } }

  F.update = dt => {
    if (!active()) { if (key !== -1) { key = -1; host.mods.clear('winter'); } balls.length = 0; F.holding = false; return; }
    caves ??= host.feature('caves') || false; coop ??= host.feature('coop') || false; gear ??= host.feature('gear') || false;
    const P = host.player;
    F.depth = depthAt(P.x, P.y);
    setNotes(F.depth);
    // the friends' snowballs: who was hit, by whom
    if (coop?.mail) for (const m of coop.mail) if (m.k === 'snow' && m.by !== myId()) struck(m.id, m.vx || 0, m.vy || 0, !!m.hat);
    // making one: E held on snow, still standing, empty hands
    cd = Math.max(0, cd - dt);
    eHeld = host.keys.has('e');
    if (making >= 0) {
      if (!eHeld || F.depth <= 0 || !free()) making = -1;
      else if ((making += dt) >= B.make) { making = -1; F.holding = true; ui()?.float(P.x, P.y, P.z + 1.8, 'a snowball', '#e8eef8'); }
    }
    if (wantThrow) { wantThrow = false; if (F.holding && cd <= 0) { F.holding = false; cd = B.cd; const a = host.aim(); throwAt(a.x, a.y); } }
    // the balls in flight
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vh -= B.g * dt; b.h += b.vh * dt;
      const g = host.elev(b.x, b.y);
      let done = b.h <= g || b.t > B.life;
      if (!done) for (const p of host.entities.near(b.x, b.y, .6, nearT)) if (p.kind === 'tree' && !p.gone && b.h < g + 4) { done = true; break; }
      if (!done && b.mine && coop?.online) for (const q of coop.net.peers.values()) {
        if (!q.n) continue; coop.net.sample(q, SMP);
        if (Math.hypot(SMP.x - b.x, SMP.y - b.y) < B.hit && b.h > SMP.z + .2 && b.h < SMP.z + 2) { hitPlayer(q.id, b); done = true; break; }
      }
      if (!done && !b.mine && Math.hypot(P.x - b.x, P.y - b.y) < B.hit && b.h > P.z + .2 && b.h < P.z + 2) { hitPlayer(myId(), b); done = true; }
      if (done) { b.land = true; balls.splice(i, 1); burstQ.push(b.x, b.y, Math.max(g, b.h)); }
    }
    for (const [id, s] of splats) { if (s - dt <= 0) splats.delete(id); else splats.set(id, s - dt); }
    // a hat lying: walk over it to put it back on
    for (let i = hats.length - 1; i >= 0; i--) { const h = hats[i]; if (Math.hypot(h.x - P.x, h.y - P.y) < .6 && Math.abs(h.z - P.z) < .6 && (h.t += dt) > .8) { gear?.wear?.(h.id); hats.splice(i, 1); } else if (Math.hypot(h.x - P.x, h.y - P.y) >= .6) h.t = .8; }
  };
  const burstQ = [];   // (landing spots from the sim, burst in view)

  F.onKey = k => {
    if (k !== 'e' || !active() || F.holding || making >= 0 || !free() || F.depth <= 0) return false;
    if (host.player.state !== 'idle') return false;
    making = 0; host.PL.useE?.(); return true;
  };
  F.lmb = down => { if (!down || !active() || !F.holding) return false; wantThrow = true; return true; };
  F.splatOn = id => splats.get(id) || 0;

  // ---- VIEW
  F.view = dt => {
    dt = Math.min(.05, Math.max(0, dt || 0));
    for (let i = 0; i + 2 < burstQ.length; i += 3) burst(burstQ[i], burstQ[i + 1], burstQ[i + 2] + .1, 10);
    burstQ.length = 0;
    for (let i = bursts.length - 1; i >= 0; i--) { const p = bursts[i]; p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vh -= 7 * dt; p.h += p.vh * dt; if (p.t <= 0) bursts.splice(i, 1); }
  };
  const PO = {size: 2}, PS = {size: 1};
  F.frame = () => {
    if (!active()) return;
    const z = host.zoom || 1; PO.size = 2 * z; PS.size = z;
    for (const b of balls) host.point(b.x, b.y, b.h, SNOWC, PO);
    for (const p of bursts) host.point(p.x, p.y, p.h, SNOWC, PS);
    const P = host.player;
    if (F.holding && !host.playerHidden) host.point(P.x + Math.sin(P.faceAngle ?? 0) * .3, P.y + Math.cos(P.faceAngle ?? 0) * .3, P.z + 1.05, SNOWC, PO);
    // the splats: a few white flecks on the body, fewer as they melt
    for (const [id, s] of splats) {
      let x, y, zz;
      if (id === myId()) { if (host.playerHidden) continue; x = P.x; y = P.y; zz = P.z; }
      else { const q = coop?.net?.peers.get(id); if (!q || !coop.net.sample(q, SMP)) continue; x = SMP.x; y = SMP.y; zz = SMP.z; }
      const n = Math.ceil(5 * s / B.splat);
      for (let k = 0; k < n; k++) host.point(x + FL[k * 2] * .12, y + .02, zz + 1.2 + FL[k * 2 + 1] * .25, SNOWC, PS);
    }
    for (const h of hats) { const c = HATC; host.point(h.x, h.y, h.z + .05, c, PO); host.point(h.x + .08, h.y, h.z + .05, c, PO); }
  };
  const HATC = [.36, .3, .24];
  const FL = [0, 1, -1, .6, 1, .4, -.4, -.2, .5, -.5];   // (the flecks' places on the body: x across, h up)

  F.hud = () => active() && F.depth > 0 ? `snow ${(F.depth * 100) | 0} cm${F.holding ? ' · snowball' : ''}` : '';
  F.menu = () => active() ? [
    {label: 'Winter: a snowball at me (from the north)', run: () => { const P = host.player; balls.push({x: P.x, y: P.y - 6, h: P.z + 1.4, vx: 0, vy: 13, vh: 1.2, t: 0, mine: false}); }},
    {label: 'Winter: a snowball in my hand', run: () => { F.holding = true; }},
  ] : [];
  return F;
}
