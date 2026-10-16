// ANIMAL FINDS (living-animals.md slice 3 "Finds without killing", docs/FAUNA.md "Finds"): what the forest's animals leave on the
// floor, nothing killed. Where and when is the plan's (world/fauna.js antlersOf / feathersOf: pure functions of the seed and the
// clock, the same on every client, nothing sent); this feature lays them out, draws them and lets you pick them up.
//   SHED ANTLERS   each roe buck drops SHED.per on seeded hours in the shed window (late autumn into winter) within SHED.r m of his
//                  herd's bed; they lie till the end of the next spring. ?shed=now: this year's lie now
//   FEATHERS       after each lek morning (spring, features/fauna.js THE LEK) 1-2 lie where the cock sang, once he was put up or
//                  the lek's hours are over; in the summer's moult one every LEK.moult days where he spends his day
//   THE LEK'S BONUS  the first to get within LEK.close m of a singing cock gets LEK.bonus feathers straight into the bag
// E within FINDS.reach m picks the nearest up ("+1 Shed Antler" floats up; animal.find). The finds go to the pouch (materials).
// CO-OP (server/animals.mjs 'find'): first finder; the world map ('found'), gone for everyone, a late joiner gets them in the
// welcome. Offline the picked ones are saved (pack.store('animalfinds'): {got: {id: the hour it would have gone anyway}}).
// Only in the sandbox on the ruins biome (the persistent world) with the forest; ?livefauna=0 off.
// OWNS: the finds lying now, the picked set and its saved part, their meshes. READS: world/fauna.js (the plan, antlersOf,
//   feathersOf, seasonOfDay), host.env (t, day, season lock, TUNE.seasonDays), fauna (lekOver, lekForced, lekClose), pack (give,
//   store), coop (online, act, mail, net.id), host.world.mesh, recipes roe_antler / caper_feather. EMITS: animal.find.
// BUDGET: sim: the finds recomputed once a second (a few bucks, a few cocks, cached per year / day); the nearest one a step (a
//   list of ~10). View: a matrix for each find within FINDS.draw m, only when it changes.
import * as THREE from 'three';
import {flags} from '../core/flags.js';
import {nameHash} from '../core/rng.js';
import {FOREST} from '../world/layout.js';
import {faunaPlan, antlersOf, feathersOf, seasonOfDay} from '../world/fauna.js';
import {recipeGeo} from '../world/recipe3d.js';
import {LEK, FINDS} from '../content/animals.js';
import {ITEMS} from '../content/items.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';

const ON = flags.get('livefauna') !== '0', SHED_NOW = flags.get('shed') === 'now';

// ORDER (core/features.js): before forage (E at a find picks it, not the patch under it) and before co-op (its mail a step late)
export const order = {after: ['rope'], before: ['forage', 'coop']};

export async function create(host) {
  const F = {name: 'animalfinds', label: 'Animal finds (antlers, feathers)', on: ON};
  const PLAN = faunaPlan(FOREST);
  if (!PLAN) return Object.assign(F, {on: false, dbg: () => ({off: 'no forest'})});
  const game = () => host.feature('game'), pack = () => host.feature('pack'), coop = () => host.feature('coop'), fauna = () => host.feature('fauna');
  const online = () => !!coop()?.online;
  const active = () => F.on && host.biome?.id === 'ruins' && game()?.mode === 'sandbox' && !!host.layout?.forest;
  const store = () => { const s = pack()?.store('animalfinds'); if (s) s.got ??= {}; return s; };
  const BUCKS = PLAN.animals.filter(a => a.sp === 'roe' && a.buck), COCKS = PLAN.animals.filter(a => a.sp === 'capercaillie' && !a.hen);
  // may a find lie here: the plan's ground (no water, no trunk): the same on every client, whatever has been felled since
  const o = {};
  const ok = (x, y) => !FOREST.inLake(x, y, .3) && (FOREST.at(x, y, o), o.d > o.hw + .3) && PLAN.around(x, y, .6).n === 0;

  // ---------------------------------------------------------------- what lies now (once a second; the lists cached per year / day)
  const cache = new Map();   // 'a:' + buck + ':' + year | 'f:' + cock + ':' + day + ':' + season -> [find]
  const LIVE = [];           // the finds lying now, not picked
  const taken = new Set();   // online: found by anyone (the server's world map); asked: ours on its way
  const asked = new Set();
  const DEV = [];            // (dev: antlers dropped by you, Esc > Sandbox; offline only, the server knows no such buck)
  let acc = 1, ver = 0;
  function cached(key, make) { let l = cache.get(key); if (!l) cache.set(key, l = make()); return l; }
  function refresh() {
    const E = host.env; if (!E) return;
    const t = E.t, d = E.day, sd = E.TUNE?.seasonDays || 3, Y = Math.floor(t / (sd * 96)), st = online() ? null : store(), Fa = fauna();
    const n0 = LIVE.length, first = LIVE[0]; LIVE.length = 0;
    const gone = id => taken.has(id) || (st ? id in st.got : false);
    for (const a of BUCKS) for (let y = Y - 1; y <= Y; y++) {
      for (const f of cached(`a:${a.id}:${y}`, () => antlersOf(PLAN, a, y, sd, ok))) {
        if (t < f.t1 && (t >= f.t0 || (SHED_NOW && y === Y)) && !gone(f.id)) LIVE.push(f);
      }
    }
    for (const f of DEV) if (t < f.t1 && !gone(f.id)) LIVE.push(f);
    for (const a of COCKS) for (let k = d - LEK.lie; k <= d; k++) {
      const season = Fa?.lekForced?.(k) ? LEK.season : E.seasonLock || seasonOfDay(k, sd);
      for (const f of cached(`f:${a.id}:${k}:${season}`, () => feathersOf(PLAN, a, k, season, ok))) {
        const moult = f.id.endsWith(':m'), lying = moult || !Fa ? t >= f.t0 : Fa.lekOver(a.id, k);
        if (t < f.t1 && lying && !gone(f.id)) LIVE.push(f);
      }
    }
    if (LIVE.length !== n0 || LIVE[0] !== first) ver++;
    if (cache.size > 200) cache.clear();   // (a long session: the old years' and days' lists)
    if (st) { let pruned = false; for (const id in st.got) if (st.got[id] < t) { delete st.got[id]; pruned = true; } if (pruned) pack()?.dirty(); }
  }
  // the nearest one in reach (sim: picked from the step's own list)
  function nearest() {
    const P = host.player; let b = null, bd = FINDS.reach;
    for (const f of LIVE) { if (asked.has(f.id)) continue; const d = Math.hypot(f.x - P.x, f.y - P.y); if (d < bd) { bd = d; b = f; } }
    return b;
  }
  const free = () => { const P = host.player; return !host.lock && !host.paused && !host.BUSY?.has(P.state); };

  // ---------------------------------------------------------------- picking up
  let want = null, near = null;
  const CLOSE = [];
  function got(f, n = 1) {
    const at = {x: f.x, y: f.y, h: .6};
    pack()?.give(f.kind, n, at);
    host.events?.push({type: 'animal.find', x: f.x, y: f.y, id: f.id, kind: f.kind});
  }
  function pick(f) {
    const c = coop();
    if (c?.online) { if (c.act('find', f.id)) asked.add(f.id); return; }
    const st = store(); if (!st || f.id in st.got) return;
    st.got[f.id] = f.t1; pack()?.dirty(); got(f, FINDS[f.kind] || 1); ver++; acc = 1;
  }
  // the lek's bonus: you got within LEK.close of a singing cock, the first (online: the server's word on 'lek:' + cock + ':' + day)
  function bonus(key) {
    const id = 'lek:' + key, P = host.player, f = {id, kind: 'caper_feather', x: P.x, y: P.y, t1: (host.env?.t ?? 0) + LEK.lie * 24};
    const c = coop();
    if (c?.online) { c.act('find', id); return; }
    const st = store(); if (!st || id in st.got) return;
    st.got[id] = f.t1; pack()?.dirty(); got(f, LEK.bonus);
    game()?.ui?.toast('He never heard you', `+${LEK.bonus} ${ITEMS.caper_feather.name}s`, '#cfe3a0');
  }
  // co-op: the server's word ({k: 'world', id, s: 'found', by, late}; a deny: someone had it first)
  function mail(m) {
    if (typeof m.id !== 'string') return;
    const ours = m.id.startsWith('antler:') || m.id.startsWith('feather:') || m.id.startsWith('lek:');
    if (!ours) return;
    if (m.k === 'world' && m.s === 'found') {
      taken.add(m.id); asked.delete(m.id); acc = 1;
      if (m.by !== coop()?.net?.id || m.late) return;
      const P = host.player;
      if (m.id.startsWith('lek:')) { got({id: m.id, kind: 'caper_feather', x: P.x, y: P.y}, LEK.bonus); game()?.ui?.toast('He never heard you', `+${LEK.bonus} ${ITEMS.caper_feather.name}s`, '#cfe3a0'); }
      else { const f = LIVE.find(q => q.id === m.id); got(f || {id: m.id, kind: m.id.startsWith('antler:') ? 'roe_antler' : 'caper_feather', x: P.x, y: P.y}); }
    } else if (m.k === 'deny') { asked.delete(m.id); taken.add(m.id); acc = 1; }
  }

  // ---------------------------------------------------------------- the look: a recipe mesh for each find near you
  const MESH = new Map();   // id -> mesh
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  let shownVer = -1, shownX = 1e9, shownY = 1e9;
  function look() {
    const P = host.player;
    if (shownVer === ver && Math.abs(P.x - shownX) < 2 && Math.abs(P.y - shownY) < 2) return;   // (on change, or every 2 m you walk)
    shownVer = ver; shownX = P.x; shownY = P.y;
    for (const m of MESH.values()) m.keep = false;
    if (active()) for (const f of LIVE) {
      if (Math.abs(f.x - P.x) > FINDS.draw || Math.abs(f.y - P.y) > FINDS.draw) continue;
      let m = MESH.get(f.id);
      if (!m) {
        const g = recipeGeo(f.kind, (nameHash(f.id) >>> 0) % 997, null, host.biome?.id); if (!g) continue;
        m = host.world.mesh(g.geo, M4.compose(V.set(f.x, host.elev(f.x, f.y), f.y), Q.setFromAxisAngle(UP, f.yaw), S1), {static: true, shadow: false});
        MESH.set(f.id, m);
      }
      m.keep = true; m.setVisible(true);
    }
    for (const [id, m] of MESH) if (!m.keep) { m.dispose(); MESH.delete(id); }
  }

  Object.assign(F, {
    update(dt) {
      const c = coop(); if (c?.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
      if (!active()) { want = near = null; return; }
      if ((acc += dt) >= 1) { acc = 0; refresh(); }
      CLOSE.length = 0; fauna()?.lekClose?.(CLOSE);
      for (const k of CLOSE) bonus(k);
      if (want) { const f = want; want = null; if (LIVE.includes(f)) pick(f); }
      near = nearest();
    },
    view() { look(); },
    onKey(k) {
      if (k !== 'e' || !active() || !near || !free()) return false;
      want = near; host.PL?.useE?.(); return true;
    },
    hd(q, sc) {   // the prompt over it (the pixel look: ui/hdpixel.js)
      const f = near; if (!f || !active() || host.hudOff || host.playerHidden || pack()?.open || host.lock) return;
      const s = host.G.toScreen(f.x, host.elev(f.x, f.y) + .5, f.y);
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, 'E pick up', s[0] * sc, s[1] * sc, hdUnit(), '#f2d27a');
      q.restore();
    },
    biomeChanged() { MESH.clear(); shownVer = -1; },   // (the rebuild disposed the meshes)
    menu() {
      if (!active()) return [];
      const P = host.player;
      const go = (list, what) => { let b = null, bd = 1e9; for (const f of list) { const d = Math.hypot(f.x - P.x, f.y - P.y); if (d < bd) { bd = d; b = f; } } if (b) host.teleport(b.x, b.y + 3); else game()?.ui?.toast(`No ${what} lying now`, 'try ?shed=now, or start the lek', '#e8a070'); };
      return [
        {label: `Finds: go to the nearest shed antler (${LIVE.filter(f => f.kind === 'roe_antler').length} lying)`, run: () => go(LIVE.filter(f => f.kind === 'roe_antler'), 'antlers')},
        {label: `Finds: go to the nearest feather (${LIVE.filter(f => f.kind === 'caper_feather').length} lying)`, run: () => go(LIVE.filter(f => f.kind === 'caper_feather'), 'feathers')},
        {label: 'Finds: drop a pair of antlers here (offline)', run: () => {
          const t = host.env?.t ?? 0;
          for (let i = 0; i < 2; i++) DEV.push({id: `antler:dev${DEV.length}:0:${i}`, kind: 'roe_antler', x: +(P.x + 1.2 + i * .7).toFixed(2), y: +(P.y + .5 - i).toFixed(2), yaw: i * 2.1, t0: t, t1: t + 48});
          acc = 1;
        }},
      ];
    },
    dbg: () => ({active: active(), live: LIVE.map(f => `${f.id} ${f.x},${f.y}`), near: near?.id ?? null, meshes: MESH.size, taken: taken.size, asked: [...asked]}),
  });
  return F;
}
