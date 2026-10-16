// BODY (docs/WEATHER.md): the weather felt. Each player's own WET and COLD (content/body.js: the rules and the knobs), sheltering
// (the cave, the hut, a tree's crown), the wind's push in the open, and what it all looks like: drips off a wet body, steam off
// it by a fire, breath in the cold, frost creeping in at the screen's edges. Never a number or a bar on screen.
//   SIM    update: wet and cold step by the rules (the rain where he stands, the shelter over him, a fire near, the season, the
//          night, the wind, a meal eaten); their effects are modifier notes (source 'body': the player's speeds, the tool's
//          rhythm, the wind's 'player.windX / windY' share and its drift on arrows 'proj.windX / windY'), set only when a reading crosses a step (TUNE.q)
//   VIEW   view / frame: the drips, steam and breath (a small pool of points and soft particles), his and every friend's (their
//          look comes in their snapshots: co-op's st.bd, content/body.js packBody); the frost (G.setFrost)
// Only in the persistent world (the sandbox's ruins biome: the forest); ?wx2=0: none (the weather is show only, as before).
// OWNS: wet, cold, shelter (0..1), its modifier source 'body', its particles. READS: host.player, host.env (skyAt, sky, season, part,
//   sunView, leafK), host.wind (dir), host.entities (near: the trees), world/layout.js HUT, world.js waterSample, caves (down),
//   campfires (burningNear), meals (id), coop (peers' bd), host.mods (the gear's body.* notes). EMITS: nothing.
// API: F.chill(k) (cold + k at once: out of the ice, features/ice.js), F.wet, F.cold, F.shelter (0..1), F.bits() (the look for co-op's state: packBody), F.lookOf(peer, out) (a friend's), F.soaked.
// BUDGET: sim ~.01 ms a step (a near() of 3 m, a few reads); view < .03 ms (64 drips, 48 puffs).
import {TUNE, crownCover, windPush, soakRate, chillRate, packBody, unpackBody} from '../content/body.js';
import {SPEED0} from '../sim/player/player.js';
import {HUT} from '../world/layout.js';
import {waterSample} from '../world/world.js';
import {flags} from '../core/flags.js';
import {clamp, smooth} from '../core/mathx.js';
import {viewRandom} from '../core/rng.js';

const ON = flags.get('wx2') !== '0';
const R = viewRandom('body'), rr = (a, b) => a + R() * (b - a);

// ORDER (core/features.js): after the caves (down: no rain, no wind) and the campfires (a fire's fuel this step); before co-op (its
// state carries the look) and the meals (nothing: it reads meals.id, a step late is fine)
export const order = {after: ['caves', 'campfires', 'weather'], before: ['coop']};

export async function create(host) {
  const game = () => host.feature('game');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const F = {name: 'body', label: 'Body (wet, cold, shelter)', on: true, wet: 0, cold: 0, shelter: 0, inHut: false, fire: false, windShare: 0,
    get soaked() { return F.wet > .7; }};
  // the gear's notes (content/gear.js mods), read on a change of host.mods (mods.value makes an array a call: never per step)
  let soakK = 1, chillK = 1, heavy = false;
  host.mods.watch(() => { soakK = host.mods.value('body.soak', 1); chillK = host.mods.value('body.chill', 1); heavy = host.mods.value('body.wetHeavy', 0) > 0; });
  soakK = host.mods.value('body.soak', 1); chillK = host.mods.value('body.chill', 1); heavy = host.mods.value('body.wetHeavy', 0) > 0;
  const near = [], WS = {kind: 0};
  let caves = null, camp = null, meals = null, coop = null;

  // ---- SHELTER: 1 in the cave or the hut, else the trees round him (each crown's cover, combined: 1 - the product of what each lets through)
  function shelterAt(x, y) {
    F.inHut = !!HUT && x > HUT.x0 && x < HUT.x1 && y > HUT.y0 && y < HUT.y1;
    if (F.inHut || caves?.down) return 1;
    const leafK = host.env?.leafK ?? 1; let through = 1;
    for (const p of host.entities.near(x, y, 3.2, near)) {
      if (p.kind !== 'tree' || p.gone || !p.species) continue;
      through *= 1 - crownCover(p.species, p.scale, Math.hypot(p.x - x, p.y - y), leafK);
    }
    return 1 - through;
  }
  // ---- the notes: set when a reading crosses a step
  let key = '';
  const notes = [];
  function setNotes() {
    const E = TUNE.effects, q = TUNE.q, wq = Math.round(F.wet * q) / q, cq = Math.round(F.cold * q) / q, ws = Math.round(F.windShare / TUNE.windQ) * TUNE.windQ;
    const d = host.wind?.dir, dx = d ? d[0] : .94, dy = d ? d[1] : .34, k = `${wq}|${cq}|${heavy ? 1 : 0}|${ws}|${dx.toFixed(2)}|${dy.toFixed(2)}`;
    if (k === key) return;
    key = k; notes.length = 0;
    const c = smooth((cq - E.coldFrom) / (1 - E.coldFrom));
    const speed = (1 + E.walk * c) * (heavy ? 1 + E.wetHeavy * wq : 1);
    if (speed !== 1) notes.push({stat: 'player.speed', mul: speed});
    if (c > 0) {
      notes.push({stat: 'player.speed.sprint', mul: 1 + (SPEED0.run / SPEED0.sprint - 1) * c});   // (no sprint at full: its speed down to the run's)
      notes.push({stat: 'tool.rhythm', mul: 1 + (E.rhythm - 1) * c});
    }
    if (ws) {
      const W = TUNE.wind, a = W.proj * ws * W.run / W.push[W.push.length - 1][1];   // (what he shoots drifts too: sim/projectiles.js)
      notes.push({stat: 'player.windX', add: dx * ws}, {stat: 'player.windY', add: dy * ws}, {stat: 'proj.windX', add: dx * a}, {stat: 'proj.windY', add: dy * a});
    }
    if (notes.length) host.mods.set('body', notes.slice()); else host.mods.clear('body');
  }
  function reset() { F.wet = F.cold = F.shelter = F.windShare = 0; key = ''; host.mods.clear('body'); }

  F.update = dt => {
    if (!active()) { if (key) reset(); return; }
    const env = host.env, P = host.player; if (!env) return;
    caves ??= host.feature('caves') || false; camp ??= host.feature('campfires') || false; meals ??= host.feature('meals') || false;
    const down = !!caves?.down, sh = F.shelter = shelterAt(P.x, P.y);
    F.fire = !!camp?.burningNear?.(P.x, P.y, TUNE.warm.reach);
    // WET: soaked in a swim; the legs in shallow water; rain where he stands less what's over him; dried by a fire, the sun, the air
    const swim = P.state === 'swim', S = env.sky;
    const rain = down || F.inHut ? 0 : env.skyAt ? env.skyAt(P.x, P.y, 'rain') : S.rain;
    const soak = soakRate(rain, S.storm) * soakK * (1 - sh);
    if (swim) F.wet = 1;
    else {
      if (soak > 0) F.wet += soak * dt;
      else {
        const D = TUNE.dry, s = F.fire ? D.fire : down ? D.cave : env.sunView > .6 && rain < .02 ? D.sun : D.overcast;
        F.wet -= dt / s;
      }
      if (waterSample(P.x, P.y, WS).kind && P.z < host.elev(P.x, P.y) + .3 && F.wet < TUNE.wade) F.wet = Math.min(TUNE.wade, F.wet + dt / TUNE.wadeS);
    }
    F.wet = clamp(F.wet, 0, 1);
    // COLD: the season and the night, wet clothes in the wind, a blizzard; a fire warms, a meal holds it off, out of it he warms
    const night = env.part === 'night' || env.part === 'dawn', wind = down || F.inHut ? 0 : S.wind * (1 - .8 * sh), snow = down ? 0 : S.snow * (1 - sh);
    let chill = chillRate(env.season, night && !down, F.wet, wind, snow, S.storm) * chillK;
    if (meals?.id) chill = 0;
    if (F.fire) F.cold -= dt / TUNE.warm.fire;
    else if (chill > 0) F.cold += chill * dt;
    else F.cold -= dt / TUNE.warm.recover;
    F.cold = clamp(F.cold, 0, 1);
    // WIND: the push in the open (none in the cave or the hut), less under the trees, more on the fell top; as the share of his run
    const W = TUNE.wind, high = host.elev(P.x, P.y) > W.fellH;
    F.windShare = down || F.inHut ? 0 : windPush(S.wind) * (1 - sh * (1 - W.under)) * (high ? W.fell : 1) / W.run;
    setNotes();
  };
  F.biomeChanged = () => reset();
  let thunder = null;
  F.bits = () => packBody(F.wet, F.cold) | ((thunder ??= host.feature('thunder') || false)?.bits?.() ?? 0);   // (knocked flat, smouldering: features/thunder.js)
  const PL = {wet: 0, cold: 0, sunk: 0, down: false, smoulder: false};
  F.lookOf = (q, out = PL) => unpackBody(q?.bd | 0, out);
  F.chill = k => { if (k > 0) F.cold = Math.min(1, F.cold + k); };

  // ---------------------------------------------------------------- VIEW: drips, steam, breath (his and his friends'), frost
  const DN = 96, dX = new Float32Array(DN), dY = new Float32Array(DN), dH = new Float32Array(DN), dV = new Float32Array(DN); let dn = 0;
  const PN = 64, pX = new Float32Array(PN), pY = new Float32Array(PN), pH = new Float32Array(PN), pT = new Float32Array(PN), pL = new Float32Array(PN),
    pVx = new Float32Array(PN), pVy = new Float32Array(PN), pK = new Uint8Array(PN); let pn = 0;   // (pK: 0 breath, 1 steam)
  const BODY = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', ls: null}, LOOK = {wet: 0, cold: 0, sunk: 0, down: false, smoulder: false};
  const clocks = new Map();   // a body's own drip / breath clocks (id: 0 him, else a friend's)
  function drip(x, y, z) { if (dn >= DN) return; const i = dn++; dX[i] = x + rr(-.18, .18); dY[i] = y + rr(-.12, .12); dH[i] = z + rr(.35, 1.35); dV[i] = rr(.2, .8); }
  function puff(x, y, h, k, vx, vy, life) { if (pn >= PN) return; const i = pn++; pX[i] = x; pY[i] = y; pH[i] = h; pT[i] = 0; pL[i] = life; pK[i] = k; pVx[i] = vx; pVy[i] = vy; }
  // one body's drips / breath / steam this view step (x, y, z: his feet; phi: his facing, the arena's atan2(x, y); a look)
  function emit(id, dt, x, y, z, phi, L, fire) {
    let c = clocks.get(id); if (!c) clocks.set(id, c = {drip: 0, breath: rr(0, 2), steam: 0});
    const T = TUNE.look, env = host.env;
    if (L.wet > T.drip) { c.drip -= dt * 14 * L.wet; while (c.drip < 0) { c.drip += 1; drip(x, y, z); } }
    const coldAir = env && env.season === 'winter' && (env.part !== 'day');
    if ((L.cold > T.breath || coldAir) && (c.breath -= dt) <= 0) {
      c.breath = rr(2.4, 3.6) * (L.cold > .7 ? .75 : 1);
      const fx = Math.sin(phi), fy = Math.cos(phi);
      for (let k = 0; k < 3; k++) puff(x + fx * (.22 + k * .05), y + fy * (.22 + k * .05), z + 1.52 - k * .02, 0, fx * .25 + rr(-.05, .05), fy * .25 + rr(-.05, .05), rr(.9, 1.4));
    }
    if (fire && L.wet > T.steam && (c.steam -= dt * 6 * L.wet) <= 0) { c.steam = 1; puff(x + rr(-.2, .2), y + rr(-.15, .15), z + rr(.6, 1.3), 1, rr(-.04, .04), rr(-.04, .04), rr(1.2, 2)); }
  }
  F.view = dt => {
    if (!active()) { dn = pn = 0; return; }
    const P = host.player;
    LOOK.wet = F.wet; LOOK.cold = F.cold;
    if (!host.playerHidden) emit(0, dt, P.x, P.y, P.z, P.faceAngle ?? 0, LOOK, F.fire);
    coop ??= host.feature('coop') || false;
    const C = coop?.online ? coop.net : null;
    if (C) for (const q of C.peers.values()) { if (!q.n) continue; C.sample(q, BODY); unpackBody(q.bd | 0, LOOK); emit(q.id, dt, BODY.x, BODY.y, BODY.z, BODY.phi, LOOK, !!camp?.burningNear?.(BODY.x, BODY.y, TUNE.warm.reach)); }
    for (let i = dn - 1; i >= 0; i--) {   // drips fall (a little faster as they go), gone at the ground
      dV[i] += 9 * dt; dH[i] -= dV[i] * dt;
      if (dH[i] <= host.elev(dX[i], dY[i])) { dn--; dX[i] = dX[dn]; dY[i] = dY[dn]; dH[i] = dH[dn]; dV[i] = dV[dn]; }
    }
    for (let i = pn - 1; i >= 0; i--) {   // puffs drift and rise
      pT[i] += dt; pX[i] += pVx[i] * dt; pY[i] += pVy[i] * dt; pH[i] += (pK[i] ? .45 : .12) * dt;
      if (pT[i] >= pL[i]) { pn--; pX[i] = pX[pn]; pY[i] = pY[pn]; pH[i] = pH[pn]; pT[i] = pT[pn]; pL[i] = pL[pn]; pK[i] = pK[pn]; pVx[i] = pVx[pn]; pVy[i] = pVy[pn]; }
    }
  };
  const DRIP = host.rgb('#b8cde0'), BREATH = [.86, .9, .96], STEAM = [.82, .84, .86], P1 = {size: 1};
  let frostK = 0;
  F.frame = f => {
    const G = host.G;
    // the frost: in from the edges as the cold sets in (eased; none underground's dark or in another biome)
    const want = active() ? smooth((F.cold - TUNE.look.frost) / (1 - TUNE.look.frost)) : 0;
    frostK += (want - frostK) * (1 - Math.exp(-f.dt * 1.5)); if (frostK < .002 && want === 0) frostK = 0;
    G.setFrost?.(frostK);
    if (!dn && !pn) return;
    for (let i = 0; i < dn; i++) host.point(dX[i], dY[i], dH[i], DRIP, P1);
    for (let i = 0; i < pn; i++) {
      const u = pT[i] / pL[i], a = (pK[i] ? .16 : .22) * Math.sin(Math.PI * Math.min(1, u * 1.4));
      G.fx(pX[i], pH[i], pY[i], (pK[i] ? .08 : .05) + u * (pK[i] ? .22 : .12), pK[i] ? STEAM : BREATH, a, 'blend');
    }
  };
  F.hud = () => active() && (F.wet > .01 || F.cold > .01) ? `wet ${F.wet.toFixed(2)} · cold ${F.cold.toFixed(2)} · shelter ${F.shelter.toFixed(2)}${F.windShare ? ' · wind ' + F.windShare.toFixed(2) : ''}` : '';
  F.menu = () => active() ? [
    {label: 'Body: soak me (wet 1)', run: () => { F.wet = 1; }},
    {label: 'Body: chill me (cold 1)', run: () => { F.cold = 1; }},
    {label: 'Body: dry and warm', run: () => { F.wet = 0; F.cold = 0; }},
  ] : [];
  return F;
}
