// THE THIEVING FOX AND ITS DEN (living-animals.md slice 4, docs/FAUNA.md "The thieving fox"): put a pouch item down (Tab, right-
// click it, "Put down"); food left out at night (a fish, berries) goes to the nearest den's fox: it trots in, takes it in its jaws
// and heads home under its rock. Lasso it on the way and it drops it. The den mouth (a dark hole, a fan of sand, a chewed boot)
// is under the rock: E reaches in (kneeling, DEN.reach s) and you get everything in it, the stolen things ("Perch, Ann's") and
// its own finds (an old boot, a brass button, a thimble scratched "Märta").
// THE RULES are sim/foxden.js (the same file the co-op server runs): offline here, on the world clock, saved in
// pack.store('foxden'); ONLINE the server's (server/room.mjs acts 'leave' / 'take' / 'den' / 'drop'; it sends the whole state,
// {k: 'ev', a: 'foxden', s}, on every change and to a late joiner): this is a mirror of it, and every client plays the same run
// from the clock (sim/foxden.js runAt).
// Only in the sandbox on the ruins biome (the persistent world) with the forest; ?livefauna=0 or ?thief=0 off, ?thief=often soon
// after it went down, day or night.
// OWNS: the offline rules' state and its save, the ground items' cards, the den mouths' meshes, the theft's hold on its fox
//   (fauna.hold with a {thief: true} record). READS: sim/foxden.js, the fauna plan (world/fauna.js), host.env (t), pack (take,
//   give, onPut, store), campfires (fires, burningNear), coop (online, act, mail, net.id, peers' names), fauna (hold, release,
//   byId). EMITS: animal.theft, animal.den.
// BUDGET: sim: the rules a quarter second (a few items); the nearest item / den a step. View: a card a ground item near you, a
//   run's fox placed from the clock.
import * as THREE from 'three';
import {flags} from '../core/flags.js';
import {FOREST} from '../world/layout.js';
import {faunaPlan} from '../world/fauna.js';
import {createFoxden, runAt, runTake} from '../sim/foxden.js';
import {GROUND, DEN} from '../content/animals.js';
import {ITEMS, namedId} from '../content/items.js';
import {recipeGeo} from '../world/recipe3d.js';
import {iconCanvas} from '../ui/packpanel.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';

const ON = flags.get('livefauna') !== '0' && flags.get('thief') !== '0', OFTEN = flags.get('thief') === 'often';

// ORDER (core/features.js): after the rope (a lasso on the thief this step drops the item), before forage (E at an item takes
// it, not the patch under it) and co-op (its mail a step late)
export const order = {after: ['rope'], before: ['forage', 'coop']};

export async function create(host) {
  const F = {name: 'foxden', label: 'The thieving fox', on: ON};
  const PLAN = faunaPlan(FOREST);
  if (!PLAN) return Object.assign(F, {on: false, dbg: () => ({off: 'no forest'})});
  const game = () => host.feature('game'), pack = () => host.feature('pack'), coop = () => host.feature('coop'), fauna = () => host.feature('fauna');
  const ui = () => game()?.ui || null;
  const online = () => !!coop()?.online;
  const active = () => F.on && host.biome?.id === 'ruins' && game()?.mode === 'sandbox' && !!host.layout?.forest;
  const P = host.player;
  const me = () => online() ? coop().net.id : 'me';
  const myName = () => coop()?.net?.name || 'you';
  const OFF = createFoxden(PLAN, {often: OFTEN}), MIR = createFoxden(PLAN, {often: OFTEN});
  const rules = () => online() ? MIR : OFF;
  const store = () => pack()?.store('foxden') || null;
  let loaded = false, dirty = false;
  const nm = it => ITEMS[it.kind]?.name || it.kind;

  // ---------------------------------------------------------------- putting down, taking up, reaching in
  function put(id) {
    if (!active() || !ITEMS[id] || !pack()?.has(id)) return;
    const R = rules(); if (!online() && R.count(me()) >= GROUND.most) { ui()?.toast('Put down', `at most ${GROUND.most} things on the ground`, '#e8a070'); return; }
    const a = P.faceAngle ?? 0, x = P.x + Math.sin(a) * .8, y = P.y + Math.cos(a) * .8;   // (just in front of him)
    if (!pack().take(id, 1)) return;
    if (online()) { coop().act('leave', id, {x: +x.toFixed(2), y: +y.toFixed(2)}); asked.set('leave:' + id, 1); return; }
    OFF.leave(me(), id, x, y, host.env?.t ?? 0, null, myName()); dirty = true;
  }
  function take(it) {
    if (online()) { coop().act('take', it.id); return; }
    if (!OFF.take(it.id)) return;
    pack()?.give(it.kind, 1, {x: it.x, y: it.y, h: .5}); dirty = true;
  }
  function given(things, who) {   // what came out of the den: into the bag, and a toast naming whose each was
    const names = [];
    for (const t of things) {
      const id = t.name && ITEMS[namedId(t.kind, t.name)] ? namedId(t.kind, t.name) : t.kind;
      if (!ITEMS[id]) continue;
      pack()?.give(id, 1, null);
      names.push(t.who ? `${ITEMS[id].name}, ${t.who === who ? 'yours' : t.who + "'s"}` : ITEMS[id].name);
    }
    ui()?.toast(names.length ? 'In the den' : 'The den is empty', names.join(' · ') || 'only sand and an old smell', '#cfe3a0');
  }
  function reach(d) {
    host.events?.push({type: 'animal.den', x: d.mx, y: d.my, fox: d.fox});
    if (online()) { coop().act('den', d.fox); return; }
    given(OFF.reach(d.fox) || [], myName()); dirty = true;
  }
  // the lasso on the fox (features/rope.js): a fox on a run drops what it carries
  F.lassoed = (fox, x, y) => {
    if (!active()) return;
    const R = rules(); let on = false; for (const r of R.runs.values()) if (r.fox === fox) on = true;
    if (!on) return;
    if (online()) { coop().act('drop', fox, {x: +x.toFixed(2), y: +y.toFixed(2)}); return; }
    OFF.drop(fox, x, y, host.env?.t ?? 0); dirty = true;
  };

  // ---------------------------------------------------------------- co-op: the server's word
  const asked = new Map();
  function mail(m) {
    if (m.k === 'ev' && m.a === 'foxden' && m.s) MIR.load(m.s);
    else if (m.k === 'ev' && m.a === 'took' && m.by === me() && typeof m.kind === 'string') pack()?.give(m.kind, 1, {x: +m.x || P.x, y: +m.y || P.y, h: .5});
    else if (m.k === 'ev' && m.a === 'den' && m.by === me() && Array.isArray(m.things)) given(m.things.filter(t => t && typeof t.kind === 'string'), myName());
    else if (m.k === 'deny' && m.a === 'leave' && typeof m.id === 'string' && ITEMS[m.id]) { pack()?.give(m.id, 1, null); ui()?.toast('Put down', m.why || 'not here', '#e8a070'); }
  }

  // ---------------------------------------------------------------- the rules, offline (the world clock)
  const FIRES = [], MOVERS = [], PT = {x: 0, y: 0};
  let acc = 0;
  function stepOffline() {
    const cf = host.feature('campfires'); FIRES.length = 0;
    if (cf?.fires) for (const b of cf.fires) if (cf.burningNear(b.x, b.y, .05)) FIRES.push(b);
    MOVERS.length = 0; if (Math.hypot(P.vx || 0, P.vy || 0) > .3) { PT.x = P.x; PT.y = P.y; MOVERS.push(PT); }
    for (const e of OFF.step(host.env?.t ?? 0, FIRES, MOVERS)) { dirty = true; if (e.a === 'theft') host.events?.push({type: 'animal.theft', x: e.run.ix, y: e.run.iy, fox: e.run.fox, kind: e.run.item.kind}); }
  }

  // ---------------------------------------------------------------- what's in reach
  let near = null, nearDen = null, want = null, kneel = 0, kneelDen = null;
  function nearest() {
    near = nearDen = null; let bd = GROUND.reach;
    for (const it of rules().ground.values()) { const d = Math.hypot(it.x - P.x, it.y - P.y); if (d < bd) { bd = d; near = it; } }
    if (near) return;
    let dd = 1.6; for (const d of rules().dens) { const q = Math.hypot(d.mx - P.x, d.my - P.y); if (q < dd) { dd = q; nearDen = d; } }
  }

  // ---------------------------------------------------------------- the look: item cards, the run's fox, the den mouths
  const CARD = new Map(), JAW = new Map();   // ground item id / run id -> card
  const TEX = new Map();   // item kind -> texture
  const texOf = kind => { let t = TEX.get(kind); if (!t) { const d = ITEMS[kind]; t = host.G.tex(iconCanvas(d?.icon || ['a'], d?.pal)); TEX.set(kind, t); } return t; };
  const mkCard = kind => { const c = host.G.card({tex: texOf(kind), w: 14, h: 14, px: 7, py: 13, type: 3, obj: 1, bias: .00125, shadow: false}); return c; };
  const V3 = new THREE.Vector3();
  const HELD = new Map();   // run id -> the record fauna draws its fox from (thief: the lasso may still take it)
  const RO = {x: 0, y: 0, hd: 0, v: 0, phase: ''};
  let mouths = [];
  function buildMouths() {
    for (const m of mouths) m.dispose(); mouths = [];
    if (!host.world?.mesh) return;
    for (const d of OFF.dens) {
      if (!d.rock) continue;
      const g = recipeGeo('den_mouth', 0, null, host.biome?.id); if (!g) return;
      const yaw = Math.atan2(d.uy, d.ux), M = new THREE.Matrix4().compose(V3.set(d.mx, host.elev(d.mx, d.my), d.my), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw), new THREE.Vector3(1, 1, 1));
      mouths.push(host.world.mesh(g.geo, M, {static: true}));
    }
  }
  let mouthsOn = null;
  function look(dt) {
    if (mouthsOn !== host.world) { mouthsOn = host.world; buildMouths(); }
    const R = rules(), on = active(), t = host.env?.t ?? 0, Fa = fauna();
    for (const c of CARD.values()) c.keep = false;
    if (on) for (const it of R.ground.values()) {
      if (Math.abs(it.x - P.x) > 34 || Math.abs(it.y - P.y) > 34) continue;
      let c = CARD.get(it.id); if (!c) { c = mkCard(it.kind); CARD.set(it.id, c); c.anchor = V3.set(it.x, host.elev(it.x, it.y), it.y); }
      c.keep = true;
    }
    for (const [id, c] of CARD) if (!c.keep) { c.dispose(); CARD.delete(id); }
    // the runs: the fox where the clock has it, the item in its jaws (until it's home: then it goes about its night)
    for (const j of JAW.values()) j.keep = false;
    for (const r of R.runs.values()) {
      if (!on) break;
      runAt(r, t, RO);
      let H = HELD.get(r.id);
      if (RO.phase !== 'home') {
        if (!H) { H = {x: RO.x, y: RO.y, z: 0, h: 0, hd: 0, v: 0, mode: 'carry', thief: true, fox: r.fox}; HELD.set(r.id, H); }
        H.x = RO.x; H.y = RO.y; H.z = host.elev(RO.x, RO.y); H.hd = RO.hd; H.v = RO.v; H.mode = RO.phase === 'in' ? 'walk' : 'carry';
        const a = Fa?.hold(r.fox, H), taken = t >= runTake(r);
        if (a && a.held !== H) continue;   // (someone's lasso has it)
        // the item: still where it lay while the fox trots in, then in its jaws, at its nose
        let j = JAW.get(r.id); if (!j) { j = mkCard(r.item.kind); JAW.set(r.id, j); }
        j.keep = true; j.anchor = taken ? V3.set(RO.x + Math.cos(RO.hd) * .34, H.z + .12, RO.y + Math.sin(RO.hd) * .34) : V3.set(r.ix, host.elev(r.ix, r.iy), r.iy);
      }
    }
    for (const [id, H] of HELD) {   // home, dropped, or off: the fox goes about its night
      const r = R.runs.get(id); let done = !r || !on;
      if (r && !done) { runAt(r, t, RO); done = RO.phase === 'home'; }
      if (!done) continue;
      const a = Fa?.byId(H.fox); if (a && a.held === H) Fa.release(H.fox, 'walk', H.x, H.y);
      HELD.delete(id);
    }
    for (const [id, j] of JAW) if (!j.keep) { j.dispose(); JAW.delete(id); }
  }

  Object.assign(F, {
    update(dt) {
      const c = coop(); if (c?.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
      if (!loaded && pack()?.on) { loaded = true; pack().onPut(put); const st = store(); if (st?.s) OFF.load(st.s); }
      if (!active()) { near = nearDen = null; kneel = 0; return; }
      if (!online() && (acc += dt) >= .25) { acc = 0; stepOffline(); }
      if (dirty && !online()) { dirty = false; const st = store(); if (st) { st.s = OFF.toJSON(); pack().dirty(); } }
      if (kneel > 0) {   // reaching in: kneeling DEN.reach s (moving off ends it)
        if (Math.hypot(kneelDen.mx - P.x, kneelDen.my - P.y) > 2.2) kneel = 0;
        else if ((kneel -= dt) <= 0) { kneel = 0; reach(kneelDen); }
      }
      if (want) { const w = want; want = null; if (w.den) { kneel = DEN.reach; kneelDen = w.den; host.PL?.hold?.('crouch', DEN.reach); } else take(w.it); }
      nearest();
    },
    view(dt) { look(dt); },
    onKey(k) {
      if (k !== 'e' || !active() || host.lock || kneel > 0 || (!near && !nearDen)) return false;
      want = near ? {it: near} : {den: nearDen}; host.PL?.useE?.(); return true;
    },
    hd(q, sc) {
      if (!active() || host.hudOff || host.playerHidden || pack()?.open || host.lock) return;
      const it = near, d = nearDen; if (!it && !d) return;
      const x = it ? it.x : d.mx, y = it ? it.y : d.my;
      const s = host.G.toScreen(x, host.elev(x, y) + .7, y);
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, it ? `E take up ${nm(it)}` : kneel > 0 ? 'reaching in...' : 'E reach in', s[0] * sc, s[1] * sc, hdUnit(), '#f2d27a');
      q.restore();
    },
    biomeChanged() { CARD.clear(); JAW.clear(); mouths = []; mouthsOn = null; },   // (the rebuild disposed them)
    menu() {
      if (!active()) return [];
      const R = rules(), nearestDen = () => { let b = null, bd = 1e9; for (const d of R.dens) { const q = Math.hypot(d.mx - P.x, d.my - P.y); if (q < bd) { bd = q; b = d; } } return b; };
      return [
        {label: 'Fox: go to the nearest den', run: () => { const d = nearestDen(); if (d) host.teleport(d.mx - d.ux * 2.5, d.my - d.uy * 2.5); }},
        {label: 'Fox: send it now for the nearest food on the ground (offline)', run: () => {
          let b = null, bd = 1e9; for (const it of OFF.ground.values()) { const q = Math.hypot(it.x - P.x, it.y - P.y); if (q < bd && ITEMS[it.kind]) { bd = q; b = it; } }
          if (b) { b.next = host.env?.t ?? 0; b.tries = 0; acc = 1; } else ui()?.toast('The fox', 'put a fish or berries down first', '#e8a070');
        }},
        {label: 'Fox: open the nearest den (offline: what it holds, into the bag)', run: () => { const d = nearestDen(); if (d && !online()) { given(OFF.reach(d.fox) || [], myName()); dirty = true; } }},
        {label: 'Fox: a perch in the bag (to put down)', run: () => pack()?.give('perch', 1, null)},
      ];
    },
    dbg: () => { const R = rules(); return {active: active(), online: online(), ground: [...R.ground.values()].map(i => `${i.id} ${i.kind} ${i.x},${i.y} next ${(+i.next).toFixed(2)}`), runs: [...R.runs.values()].map(r => `${r.fox} ${r.item.kind} t0 ${r.t0.toFixed(2)}`), dens: R.dens.map(d => `${d.fox} ${d.mx},${d.my} ${R.lists.get(d.fox)?.things.length ?? 0}+${R.lists.get(d.fox)?.own ?? 0}`), near: near?.id ?? nearDen?.fox ?? null, kneel}; },
  });
  return F;
}
