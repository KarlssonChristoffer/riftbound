// STORM-CHARGED (features/surprises.js; content/surprises.js CHARGE, ROD): lightning that pays you back. A bolt that hits you
// (features/thunder.js thunder.strike with you, a graze too) leaves you CHARGED for CHARGE.dur s:
//   - you run faster and get going quicker ('player.speed', 'player.accel' notes under the source 'charged')
//   - sparks crackle off you and off every footfall, and a blue light goes with you (a lantern of your own in the storm)
//   - a jump's landing is a THUNDERCLAP: the ground shakes and sparks ring out round your feet
//   - wade or jump into water and it all goes out of you at once: a blue ring over the water, and the fish it stunned float up
//     (CHARGE.fish of them, small fry and now and then a pike) into your pouch. Stunned, not caught: the journal doesn't count them
// THE LIGHTNING ROD: a thunderwood splinter in the pouch (the one a struck pine drops) draws the bolts to you, as iron on you does
// (thunder's own stat 'thunder.iron', a note under 'stormrod'). They say it keeps a house safe; carried, it does the opposite.
// So the build is: dance the storm up at the stones, keep a splinter on you, stand out on the fell, take the bolt, run to the lake.
// MULTIPLAYER: the charge is yours (a mood on your own body: the notes are this client's, the fish go to your own pouch).
// Online the server aims the bolts by your gear, so the splinter's pull is offline only for now; a server bolt that hits you
// charges you all the same.
import {CHARGE, ROD} from '../../content/surprises.js';
import {COMMON_FISH} from '../../content/fishing.js';
import {TAU} from '../../core/mathx.js';

export function createCharged(C) {
  const {host} = C, R = C.R, V = C.V;
  let left = 0, rodT = 0, rod = false, inAir = false, wasWet = true;
  const fishQ = [];   // stunned fish on their way up: {id, t, x, y}
  // view
  const SP = Array.from({length: 96}, () => ({t: 9, life: 1, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, b: 0}));
  let si = 0, sparkT = 0;
  const RING = {t: 9, x: 0, y: 0, h: 0};
  const FLOAT = Array.from({length: 6}, () => ({t: 9, x: 0, y: 0, h: 0}));

  function spark(x, y, h, sp, up, life = .35) {
    const s = SP[si = (si + 1) % SP.length], a = V() * TAU;
    s.x = x; s.y = y; s.h = h; s.vx = Math.cos(a) * sp; s.vy = Math.sin(a) * sp; s.vh = up * (.3 + V()); s.t = 0; s.life = life * (.6 + V() * .8); s.b = V() < .5 ? 1 : 0;
  }
  function charge(s) {
    const P = host.player, was = left > 0;
    left = Math.max(left, s);
    host.mods.set('charged', [{stat: 'player.speed', mul: CHARGE.speed}, {stat: 'player.accel', mul: CHARGE.accel}]);
    if (!was) {
      host.events.push({type: 'charged.start', x: P.x, y: P.y, t: left});
      C.toast('Storm-charged', 'run, jump, or wade into the water', '#9cc8ff');
    }
  }
  function end(why, force = false) {
    if (left <= 0 && !force) return;
    left = 0; host.mods.clear('charged');
    const P = host.player; host.events.push({type: 'charged.end', x: P.x, y: P.y, why});
  }
  function discharge() {
    const P = host.player, n = CHARGE.fish[0] + Math.floor(R() * (CHARGE.fish[1] - CHARGE.fish[0] + 1));
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = 1 + R() * 2.5;
      fishQ.push({id: R() < CHARGE.rare ? 'pike' : COMMON_FISH[Math.floor(R() * COMMON_FISH.length)], t: .5 + i * .35, x: P.x + Math.cos(a) * d, y: P.y + Math.sin(a) * d});
    }
    host.events.push({type: 'charged.discharge', x: P.x, y: P.y, n});
    host.shake(3, .3);
    C.toast('Zap!', `${n} stunned fish float up`, '#9cc8ff');
    end('water');
  }

  return {
    charge,
    get left() { return left; },
    update(dt, evs) {
      if (!C.active()) { if (left > 0) end('away'); if (rod) { rod = false; host.mods.clear('stormrod'); } fishQ.length = 0; return; }
      // the rod: a look in the pouch now and then
      if ((rodT -= dt) <= 0) {
        rodT = ROD.every;
        const has = (C.pack()?.count(ROD.item) || 0) > 0;
        if (has !== rod) { rod = has; if (rod) host.mods.set('stormrod', [{stat: 'thunder.iron', add: 1}]); else host.mods.clear('stormrod'); }
      }
      for (const e of evs) if (e.type === 'thunder.strike' && e.you) charge(CHARGE.dur);
      for (let i = fishQ.length - 1; i >= 0; i--) {
        const f = fishQ[i];
        if ((f.t -= dt) > 0) continue;
        C.pack()?.give(f.id, 1, {x: f.x, y: f.y, h: host.player.z + .4});
        fishQ.splice(i, 1);
      }
      if (left <= 0) return;
      const P = host.player, wet = host.inStream(P.x, P.y) && P.z < host.elev(P.x, P.y) + .6;
      for (const e of evs) {
        if (e.type === 'player.jump') inAir = true;
        else if (e.type === 'player.land' && inAir) {
          inAir = false;
          host.events.push({type: 'charged.clap', x: P.x, y: P.y});
          host.shake(CHARGE.clapShake[0], CHARGE.clapShake[1]); host.hitstop(.03);
        }
      }
      if (wet && !wasWet) { wasWet = wet; discharge(); return; }
      wasWet = wet;
      if ((left -= dt) <= 0) end('spent', true);
    },
    view(dt, evs) {
      const P = host.player;
      for (const e of evs) {
        if (e.type === 'charged.clap') for (let i = 0; i < 26; i++) spark(e.x, e.y, host.elev(e.x, e.y) + .05, 3.5, .4, .5);
        else if (e.type === 'charged.discharge') { RING.t = 0; RING.x = e.x; RING.y = e.y; RING.h = host.elev(e.x, e.y); for (let i = 0; i < 20; i++) spark(e.x, e.y, RING.h + .1, 2.5, 1.5, .6); }
        else if (e.type === 'charged.start') for (let i = 0; i < 30; i++) spark(P.x, P.y, P.z + .3 + V() * 1.6, 2, 1, .5);
        else if (left > 0 && (e.type === 'player.step' || e.type === 'player.land')) for (let i = 0; i < 4; i++) spark(e.x, e.y, (e.z ?? P.z) + .03, 1.2, .5, .25);
      }
      if (left > 0 && (sparkT -= dt) <= 0) { sparkT = CHARGE.sparkEvery; spark(P.x + (V() - .5) * .4, P.y + (V() - .5) * .4, P.z + .2 + V() * 1.7, .8, .8, .3); }
      for (const s of SP) if (s.t < s.life) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.h += s.vh * dt; s.vh -= 3 * dt; }
      if (RING.t < 1.2) RING.t += dt;
      // the stunned fish: a silver glint where each will come up, just before it does
      let j = 0; for (const f of fishQ) { if (j >= FLOAT.length) break; const q = FLOAT[j++]; q.t = f.t; q.x = f.x; q.y = f.y; q.h = host.elev(f.x, f.y); }
      for (; j < FLOAT.length; j++) FLOAT[j].t = 9;
    },
    frame() {
      for (const s of SP) if (s.t < s.life) host.point(s.x, s.y, s.h, s.b ? '#ffffff' : s.t < s.life * .5 ? '#bfe0ff' : '#5c8cff', C.PE);
      if (RING.t < 1.2) {   // the discharge's ring over the water
        const r = .4 + RING.t * 5, n = 40, lit = RING.t < .6 || ((RING.t * 20) | 0) % 2;
        if (lit) for (let i = 0; i < n; i++) { const a = i / n * TAU; host.point(RING.x + Math.cos(a) * r, RING.y + Math.sin(a) * r, RING.h + .04, i % 3 ? '#9cc8ff' : '#ffffff', C.PE); }
      }
      for (const q of FLOAT) if (q.t < .6 && ((q.t * 14) | 0) % 2) host.point(q.x, q.y, q.h + .03, '#e8f0f4', C.PE2);
      if (left > 0 && !host.playerHidden && ((performance.now() / 70) | 0) % 3 === 0) {   // his hair stands up: a spark on his crown
        const P = host.player; host.point(P.x, P.y, P.z + 1.9, '#ffffff', C.PE);
      }
    },
    lights(out, Rl) {
      if (left <= 0 && RING.t >= 1.2) return;
      const P = host.player, L = CHARGE.light, r = Rl(); if (!r) return;
      if (left > 0) { r.x = P.x; r.y = P.y; r.h = P.z + 1.4; r.color = L.color; r.radius = L.radius; r.intensity = L.intensity; r.flicker = L.flicker; }
      else { r.x = RING.x; r.y = RING.y; r.h = RING.h + .5; r.color = L.color; r.radius = 6; r.intensity = 2 * (1 - RING.t / 1.2); r.flicker = .5; }
      out.push(r);
    },
    chip() {
      const a = left > 0 ? {text: `Storm-charged ${C.mmss(left)}`, col: '#9cc8ff'} : null;
      const b = rod && C.stormy() ? {text: 'Thunderwood: the bolts want you', col: '#d8c8a0'} : null;
      return a && b ? [a, b] : a || b;
    },
    menu: () => [{label: 'Surprise: get struck by lightning (storm-charged)', run: () => C.queue(() => charge(CHARGE.dur))}],
    dispose() { host.mods.clear('charged'); host.mods.clear('stormrod'); },
  };
}
