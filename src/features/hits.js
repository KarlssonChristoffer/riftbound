// HITS: the shared combat model's service (/mnt/project-files/briefs/combat-shared.md; the "Melee combat" thread owns it).
// The one way a blow, a thrown blade, a smash or a status hurts a creature or a breakable thing, whoever made it:
//   deal(target, hit) -> {dmg, ko, blocked}   the hit's riders (player hits), its parts (main + extra by type), the target's
//                                             HANDLER (a registered one first; built in: foes' gunmen, combat core's brutes,
//                                             dummies and breakables), the statuses its elemental parts start, hit.land
//   register(name, {test, take, push?, stun?, alive?})   another system's creatures (trolls): their own state, their own take
//   rider(source, fn | null)                  fn(hit, target) sees every player hit first (runes, attachments, fire bullets)
//   slowOf(p) / stunned(p) / status(p)        what the statuses mean for a mover (chill's speed share, jolt's stun)
//   push(p, vx, vy, up) / stun(p, s)          through the target's handler
//   kindOf(p) -> 'body' | 'dummy' | 'thing' | ''   what a blow would meet (the melee feature's sweep)
//   defend(atk) -> {out: 'hit' | 'block' | 'parry', k}   any attack on the player asks it first; the defender (features/melee.js:
//                                             setDefender) answers from the shield / the guard; none: a plain hit
// A hit: {by, from ('player' | an entity), weapon, dmg, type (content/damage.js TYPES), extra {type: n}?, x, y, h, ux, uy, knock,
// lift, stun, crit, power, guard (true: through a block), quiet (no number), noStatus, arc (false: a jolt's arc doesn't arc)}.
// STATUSES (content/damage.js STATUS) are this feature's own state, one record a target, ticked in its update (the dots are
// deals of their own: by 'burn' / 'poison', no status); a target that breaks or leaves drops its record.
// SIM: update (the statuses: dots, clocks, jolt arcs, void lifts), its own seeded generator (none needed yet: no draws).
// VIEW: the statuses' particles (flames licking a burning body, frost glints, venom drips, void motes, the jolt's zigzag)
// and a burst of the hit's type at its contact: its own pool of world pixels (host.point, emit), Math.random.
// OWNS: the handlers, the riders, the status records, the defender, its view's particles.
// READS: combat (core: damage, launch, hold, BS), foes (sim: brawler, recOf), host.entities (near: the jolt's arc).
// EMITS: hit.land, hit.status, hit.arc. BUDGET: sim: nothing without statuses; a few multiplies a status a step. view: <= NP pixels.
import {TYPES, STATUS} from '../content/damage.js';

const NP = 160, NARC = 6;
const RES = {dmg: 0, ko: false, blocked: false};
const NO = {out: 'hit', k: 1};
// a gunman's reaction (features/foes/brawler.js REACT, content/fists.js) by the hit's weight
const reactOf = h => h.lift > 2 ? 'upper' : h.knock >= 5 ? 'knock' : h.stun >= .5 ? 'daze' : h.knock >= 2.5 ? 'cross' : (h.ux || 0) * (h.uy || 0) > 0 ? 'hook_l' : 'jab';

export const order = {};   // (combat and foes are read when a hit lands, not before: no order needed; melee runs ahead of combat)
export async function create(host) {
  let combat = null, foes = null;
  const core = () => (combat ??= host.feature('combat'))?.core || null;
  const fsim = () => (foes ??= host.feature('foes'))?.sim || null;
  const brawler = () => fsim()?.brawler || null;
  const handlers = [], riders = new Map(), ST = new Map(), NEAR = [];
  let defender = null, simT = 0;
  const S = {deals: 0, dmg: 0};

  // ---------------------------------------------------------------- the built-in handlers
  const downed = p => { const g = fsim()?.recOf?.(p); return !!(g && g.down); };
  const GUNMAN = {
    test: p => p.kind === 'gunman',
    alive: p => !p.broken && !p.gone && !downed(p),
    take(p, h) {
      const cr = core(); RES.dmg = 0; RES.ko = false; RES.blocked = false; if (!cr) return RES;
      const r = brawler()?.punched(p, {mv: h.weapon || h.by, react: 'cross', guard: !!h.guard, ux: h.ux, uy: h.uy, counter: false, k: h.power || 0, clinch: false});
      let d = h.total; if (r?.blocked) { RES.blocked = true; d *= .25; }
      RES.dmg = Math.max(1, Math.round(d));
      RES.ko = !!cr.damage(p, RES.dmg, {quiet: !!h.quiet, by: h.by, canCrit: false, dir: [h.ux * 3, h.uy * 3], ux: h.ux, uy: h.uy, hx: h.x, hy: h.y, hh: h.h});
      if (!RES.ko && !RES.blocked && h.by !== 'burn' && h.by !== 'poison') brawler()?.react(p, reactOf(h), h.ux, h.uy, h.power || 0);
      return RES;
    },
    push(p, vx, vy, up) { const l = Math.hypot(vx, vy) || 1; brawler()?.react(p, up > 2 ? 'upper' : 'knock', vx / l, vy / l, 1); },
    stun(p, s) { brawler()?.react(p, s >= .6 ? 'daze' : 'jab', 0, 0, 0); },
  };
  const BRUTE = {
    test: p => !!core()?.BS.has(p),
    alive: p => !p.broken && !p.gone && !p.retired,
    take(p, h) {
      const cr = core(); RES.dmg = Math.max(1, Math.round(h.total)); RES.blocked = false;
      RES.ko = !!cr.damage(p, RES.dmg, {quiet: !!h.quiet, by: h.by, canCrit: false, dir: [h.ux * 3, h.uy * 3], ux: h.ux, uy: h.uy, hx: h.x, hy: h.y, hh: h.h});
      if (!RES.ko && h.by !== 'burn' && h.by !== 'poison') {
        const heft = p.boss ? 0 : p.elite ? 1.7 : 1;
        if (heft && (h.knock >= 3.5 || h.lift > 0)) cr.launch(p, h.ux * h.knock / heft, h.uy * h.knock / heft, (h.lift || 1.2) / Math.sqrt(heft), {stun: Math.max(.3, h.stun || 0)});
        else if (h.stun > 0) cr.hold(p, h.stun * (heft ? 1 : .5));
      }
      return RES;
    },
    push(p, vx, vy, up) { const heft = p.boss ? 0 : p.elite ? 1.7 : 1; if (heft) core()?.launch(p, vx / heft, vy / heft, up / Math.sqrt(heft), {stun: .4}); },
    stun(p, s) { core()?.hold(p, s); },
  };
  const THING = {   // a dummy (straw), a pot, a crate, a barrel, a crystal: combat's breakables
    test: p => (p.hp > 0 || p.target || p.breakable) && !p.wall && !p.rect && p.kind !== 'gunman',
    alive: p => !p.broken && !p.gone,
    take(p, h) {
      RES.dmg = Math.max(1, Math.round(h.total)); RES.blocked = false;
      RES.ko = !!core()?.damage(p, RES.dmg, {quiet: !!h.quiet, by: h.by, canCrit: false, dir: [h.ux * 3, h.uy * 3], ux: h.ux, uy: h.uy, hx: h.x, hy: h.y, hh: h.h});
      return RES;
    },
  };
  function handlerOf(p) {
    if (!p) return null;
    for (let i = 0; i < handlers.length; i++) if (handlers[i].h.test(p)) return handlers[i].h;
    if (GUNMAN.test(p)) return GUNMAN;
    if (BRUTE.test(p)) return BRUTE;
    if (THING.test(p)) return THING;
    return null;
  }
  const aliveBy = (h, p) => !!h && !p.gone && (h.alive ? h.alive(p) : !p.broken && !p.dead);
  // what a blow meets: a body (a gunman, a brute, a registered creature), a dummy, a breakable thing
  function kindOf(p) {
    const h = handlerOf(p); if (!h || !aliveBy(h, p)) return '';
    if (h === THING) return p.target && !(p.hp > 0) ? 'dummy' : 'thing';
    return 'body';
  }

  // ---------------------------------------------------------------- statuses
  function recOf(p) {
    let r = ST.get(p);
    if (!r) { r = {burn: 0, burnD: 0, poison: 0, poisonD: 0, poisonN: 0, chill: 0, jolt: 0, void: 0, tick: 0, from: null}; ST.set(p, r); }
    return r;
  }
  const ARCS = [];   // the jolt arcs of this step (deals inside the loop would recurse into arcs of arcs: no, arc: false)
  function startStatus(p, type, part, h) {
    const s = TYPES[type]?.status; if (!s || !(part > 0)) return;
    const C = STATUS[s], r = recOf(p); r.from = h.from;
    if (s === 'burn') { r.burn = C.dur; r.burnD = Math.max(r.burnD, part * C.dot); }
    else if (s === 'poison') { r.poisonN = Math.min(C.max, r.poisonN + 1); r.poison = C.dur; r.poisonD = Math.max(r.poisonD, part * C.dot); }
    else if (s === 'chill') r.chill = C.dur;
    else if (s === 'jolt') {
      r.jolt = C.stun; handlerOf(p)?.stun?.(p, C.stun);
      if (h.arc !== false && ARCS.length < NARC) ARCS.push({p, dmg: part * C.arc, from: h.from, weapon: h.weapon});
    } else if (s === 'void') { r.void = C.dur; handlerOf(p)?.push?.(p, 0, 0, C.lift); }
    host.events.push({type: 'hit.status', x: p.x, y: p.y, who: p, kind: s});
  }

  // ---------------------------------------------------------------- deal
  function deal(p, h) {
    RES.dmg = 0; RES.ko = false; RES.blocked = false;
    const hd = handlerOf(p); if (!hd || !aliveBy(hd, p)) return RES;
    if (h.from === 'player' && riders.size) for (const fn of riders.values()) { try { fn(h, p); } catch (e) { console.warn('hits: a rider failed', e); } }
    h.ux ??= 0; h.uy ??= 1; h.knock ??= 0; h.lift ??= 0; h.stun ??= 0; h.x ??= p.x; h.y ??= p.y; h.h ??= (p.z || 0) + 1;
    const T0 = TYPES[h.type]; if (T0?.knock) h.knock *= T0.knock; if (T0?.guard) h.guard = true;
    let total = h.dmg || 0; const ex = h.extra; if (ex) for (const k in ex) total += ex[k] || 0;
    if (h.crit) total *= h.critMul || 2;
    h.total = total;
    const r = hd.take(p, h), out = {dmg: r?.dmg || 0, ko: !!r?.ko, blocked: !!r?.blocked};
    S.deals++; S.dmg += out.dmg;
    if (!h.noStatus && !out.blocked && !out.ko) {
      startStatus(p, h.type, h.dmg, h);
      if (ex) for (const k in ex) startStatus(p, k, ex[k], h);
    }
    if (out.ko) ST.delete(p);
    host.events.push({type: 'hit.land', x: h.x, y: h.y, h: h.h, who: p, by: h.by, type2: h.type, dmg: out.dmg, ko: out.ko, crit: !!h.crit, blocked: out.blocked,
      from: h.from, weapon: h.weapon || '', extra: ex || null, dx: h.ux, dy: h.uy, power: h.power || 0});
    burst(h, out);
    if (ARCS.length && h.arc !== false) runArcs();
    return out;
  }
  function runArcs() {
    while (ARCS.length) {
      const a = ARCS.shift(), p = a.p; let best = null, bd = 1e9;
      for (const q of host.entities.near(p.x, p.y, STATUS.jolt.reach, NEAR)) {
        if (q === p || kindOf(q) !== 'body') continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd && d <= STATUS.jolt.reach) { bd = d; best = q; }
      }
      if (!best) continue;
      host.events.push({type: 'hit.arc', x: p.x, y: p.y, h: (p.z || 0) + 1, x1: best.x, y1: best.y, h1: (best.z || 0) + 1});
      arcFx(p.x, p.y, (p.z || 0) + 1, best.x, best.y, (best.z || 0) + 1);
      const d = Math.hypot(best.x - p.x, best.y - p.y) || 1;
      deal(best, {by: 'arc', from: a.from, weapon: a.weapon, dmg: Math.max(1, Math.round(a.dmg)), type: 'shock', ux: (best.x - p.x) / d, uy: (best.y - p.y) / d, stun: STATUS.jolt.stun, arc: false, quiet: true, power: .3});
    }
  }

  // ---------------------------------------------------------------- the view's pixels (presentation: Math.random)
  const PX = Array.from({length: NP}, () => ({on: false, x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, t: 0, life: .4, c: '#fff', g: 0, drag: 0}));
  let pi = 0;
  const VR = (a, b) => a + Math.random() * (b - a);
  function px(x, y, h, vx, vy, vh, life, c, g = 0, drag = 2) {
    const q = PX[pi]; pi = (pi + 1) % NP;
    q.on = true; q.x = x; q.y = y; q.h = h; q.vx = vx; q.vy = vy; q.vh = vh; q.t = 0; q.life = life; q.c = c; q.g = g; q.drag = drag;
  }
  const ZAPS = Array.from({length: NARC}, () => ({on: false, t: 0, x0: 0, y0: 0, h0: 0, x1: 0, y1: 0, h1: 0, seed: 0}));
  let zi = 0;
  function arcFx(x0, y0, h0, x1, y1, h1) { const z = ZAPS[zi]; zi = (zi + 1) % NARC; Object.assign(z, {on: true, t: 0, x0, y0, h0, x1, y1, h1}); }
  // a burst of the hit's types at its contact (only what isn't plain steel: the elements)
  const PEND = [];
  function burst(h, out) {
    if (out.blocked) return;
    const add = (type, n) => { const s = TYPES[type]?.status; if (s && PEND.length < 24) PEND.push({x: h.x, y: h.y, h: h.h, s, n, ux: h.ux, uy: h.uy}); };
    add(h.type, 8); if (h.extra) for (const k in h.extra) if (h.extra[k] > 0) add(k, 6);
  }

  const F = {
    name: 'hits', label: 'Hits', on: true, S, ST,
    deal, kindOf, handlerOf,
    register(name, h) { const i = handlers.findIndex(x => x.name === name); if (i >= 0) handlers.splice(i, 1); if (h) handlers.push({name, h}); },
    rider(source, fn) { if (fn) riders.set(source, fn); else riders.delete(source); },
    slowOf(p) { const r = ST.get(p); return r && r.chill > 0 ? STATUS.chill.slow : 1; },
    stunned(p) { const r = ST.get(p); return !!r && r.jolt > 0; },
    status(p) { return ST.get(p) || null; },
    push(p, vx, vy, up = 0) { handlerOf(p)?.push?.(p, vx, vy, up); },
    stun(p, s) { handlerOf(p)?.stun?.(p, s); },
    setDefender(fn) { defender = fn; },
    defend(atk) { if (!defender) return NO; try { return defender(atk) || NO; } catch (e) { console.warn('hits: the defender failed', e); return NO; } },

    update(dt) {
      simT += dt;
      if (!ST.size) return;
      for (const [p, r] of ST) {
        const hd = handlerOf(p);
        if (!hd || !aliveBy(hd, p)) { ST.delete(p); continue; }
        if (r.chill > 0) r.chill -= dt;
        if (r.jolt > 0) r.jolt -= dt;
        if (r.void > 0) r.void -= dt;
        r.tick += dt;
        if (r.burn > 0 || r.poison > 0) {
          const due = r.tick >= STATUS.burn.tick;
          if (r.burn > 0) { r.burn -= dt; if (due) deal(p, {by: 'burn', from: r.from, dmg: Math.max(1, Math.round(r.burnD * STATUS.burn.tick)), type: 'fire', noStatus: true, quiet: true, power: 0, h: (p.z || 0) + 1}); if (r.burn <= 0) r.burnD = 0; }
          if (r.poison > 0 && ST.has(p)) { r.poison -= dt; if (due) deal(p, {by: 'poison', from: r.from, dmg: Math.max(1, Math.round(r.poisonD * r.poisonN * STATUS.burn.tick)), type: 'venom', noStatus: true, quiet: true, power: 0, h: (p.z || 0) + 1}); if (r.poison <= 0) { r.poisonD = 0; r.poisonN = 0; } }
          if (due) r.tick = 0;
        }
        if (r.burn <= 0 && r.poison <= 0 && r.chill <= 0 && r.jolt <= 0 && r.void <= 0) ST.delete(p);
      }
    },
    view(dt) {
      // the hits' bursts
      while (PEND.length) {
        const b = PEND.pop(), C = STATUS[b.s].col;
        for (let i = 0; i < b.n; i++) px(b.x, b.y, b.h + VR(-.1, .1), b.ux * VR(.5, 2.5) + VR(-1.2, 1.2), b.uy * VR(.5, 2.5) + VR(-1.2, 1.2), VR(-.5, 2.5), VR(.18, .4), C[i % 3], b.s === 'burn' ? -2 : 4, 4);
      }
      // the statuses on their targets
      for (const [p, r] of ST) {
        const z = (p.z || 0) + (p.h || 0);
        if (r.burn > 0 && Math.random() < dt * 40) px(p.x + VR(-.25, .25), p.y + VR(-.2, .2), z + VR(.3, 1.4), VR(-.2, .2), VR(-.2, .2), VR(1, 2.2), VR(.2, .45), STATUS.burn.col[Math.floor(Math.random() * 3)], -1, 1);
        if (r.poison > 0 && Math.random() < dt * 14) px(p.x + VR(-.2, .2), p.y + VR(-.2, .2), z + VR(.6, 1.3), 0, 0, VR(-1, -.3), VR(.3, .6), STATUS.poison.col[1 + Math.floor(Math.random() * 2)], 3, 0);
        if (r.chill > 0 && Math.random() < dt * 16) px(p.x + VR(-.3, .3), p.y + VR(-.25, .25), z + VR(.2, 1.5), 0, 0, VR(-.2, .2), VR(.15, .35), STATUS.chill.col[Math.floor(Math.random() * 2)], 0, 0);
        if (r.jolt > 0 && Math.random() < dt * 30) px(p.x + VR(-.3, .3), p.y + VR(-.25, .25), z + VR(.3, 1.5), VR(-3, 3), VR(-3, 3), VR(-2, 2), .06, STATUS.jolt.col[Math.floor(Math.random() * 2)], 0, 0);
        if (r.void > 0 && Math.random() < dt * 20) px(p.x + VR(-.4, .4), p.y + VR(-.3, .3), z + VR(0, 1.6), VR(-.3, .3), VR(-.3, .3), VR(.2, .9), VR(.4, .8), STATUS.void.col[Math.floor(Math.random() * 3)], -.5, 0);
      }
      const O = F._o || (F._o = {size: 1, emit: true});
      for (const q of PX) {
        if (!q.on) continue;
        q.t += dt; if (q.t >= q.life) { q.on = false; continue; }
        const d = Math.exp(-q.drag * dt); q.vx *= d; q.vy *= d; q.vh -= q.g * dt;
        q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
        host.point(q.x, q.y, q.h, q.c, O);
      }
      // the jolt's zigzags: a few segments jittering between the two bodies, twice
      for (const z of ZAPS) {
        if (!z.on) continue;
        z.t += dt; if (z.t > .16) { z.on = false; continue; }
        for (let k = 0; k < 2; k++) {
          let ax = z.x0, ay = z.y0, ah = z.h0;
          for (let i = 1; i <= 5; i++) {
            const u = i / 5, j = i === 5 ? 0 : .22;
            const bx = z.x0 + (z.x1 - z.x0) * u + VR(-j, j), by = z.y0 + (z.y1 - z.y0) * u + VR(-j, j), bh = z.h0 + (z.h1 - z.h0) * u + VR(-j, j);
            host.line(ax, ay, ah, bx, by, bh, k ? '#ffffff' : '#8ac0f0', true); ax = bx; ay = by; ah = bh;
          }
        }
      }
    },
    hud: () => `hits ${S.deals} dmg ${S.dmg} statuses ${ST.size}`,
    biomeChanged() { ST.clear(); },
  };
  return F;
}
