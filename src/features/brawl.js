// BRAWL feature: the live cowboys' hands-on moves (docs/exp/brawl.md). The player's side (the boot, the barge, lifting and
// throwing: when, which way, his frames) is sim/player/brawl.js (host.PL.brawl); this feature gives it its keys and does what
// the moves do, through the owners' APIs:
//   V         the BOOT (a live loadout; ?kick=0: V is the pistol whip again): squared up to the cursor, snapped onto what's in
//             reach near it. Its blow (player.kick) THROWS a gunman (foes/sim.js launch) or a brute (combat/core.js launch): its
//             body flies by sim/bodyfly.js (walls, ledges, water, through a breach), heavier ones less far, a champion only
//             staggers; it kicks a barrel rolling, a crate sliding, a powder keg into whatever it hits (combat/props.js shove), a
//             loose hat or gun away (foes/sim.js kickLoose); everything else hittable takes the blow (combat's damage)
//   V sprint  the SHOULDER BARGE: the same blow every step along his run, each body once (bowled through a line of them)
//   E         LIFT what's liftable in front of him (a crate, a barrel, a powder keg: combat/props.js carry; a gunman's loose hat or
//             gun: foes/sim.js holdLoose), when nothing to use is nearer (a chest, a sign: E is theirs). Carrying: slower (the
//             note 'player.speed' x TUNE.carry.speed), no gun (LMB, RMB and R are the carry's); E sets it down; Space drops it
//   LMB       (carrying) THROW it at the cursor: an arc solved to land there (combat/props.js toss: its own landing and impacts,
//             a keg goes off, a burning barrel carries its fire; a loose gun or hat: foes/sim.js tossLoose)
// OWNS: what is carried (the prop or the loose thing, its kind), the barge's hit list, the modifier source 'brawl'.
// READS: host.PL.brawl, host.player / aim / entities (near) / elev, combat (core, phys), foes (sim). EMITS: kick.hit, carry.throw.
// BUDGET: sim; a blow: one near() query; carrying: a few multiplies a step. Off (a sprite loadout): an early return.
import {TUNE, LIFT} from '../content/brawl.js';
import {flags} from '../core/flags.js';
import {hypot2} from '../core/mathx.js';

const K = TUNE.kick, BG = TUNE.barge, C = TUNE.carry, TH = TUNE.throw, DEG = Math.PI / 180;
const MOVABLE = new Set(['crate', 'barrel', 'barrel_x']);
const KICK = flags.get('kick') !== '0', LIFTS = flags.get('carry') !== '0';
// ORDER (core/features.js): before the gun (V is the boot's; R, RMB and LMB are the carry's while he carries) and before combat
export const order = {before: ['gun', 'combat']};
export async function create(host) {
  let combat = null, foes = null;
  const core = () => (combat ??= host.feature('combat'))?.core || null;
  const phys = () => (combat ??= host.feature('combat'))?.phys || null;
  const fsim = () => (foes ??= host.feature('foes'))?.sim || null;
  const B = () => host.live ? host.PL.brawl : null;   // (a live loadout: its body has the moves; the sprites don't)
  const NEAR = [], hitSet = new Set(), PT = {x: 0, y: 0};
  const S = {carry: null, ckind: '', heavy: false, want: null, wantKind: '', liftT: 0, speedOn: false, kicks: 0, throws: 0};

  // ---------------------------------------------------------------- what's what
  const movable = q => !!q && MOVABLE.has(q.kind) && !q.wall && !q.broken && !q.gone && !q.sink && !q.float && !q.held;
  const creature = p => !!(p.hunter || p.sparring) && !p.broken && !p.gone && !p.retired;
  // the boot's target: what's within reach of him near the cursor's way (within K.snap deg), else that way -> PT (world)
  function kickPoint() {   // (the cursor on the ground, not at chest height: a boot is aimed at the feet of what it kicks)
    const P = host.player, a = host.aim(), gv = a.target ? null : host.PL.cursorGround(), c = Math.cos(host.yaw), s = Math.sin(host.yaw);
    const ax = gv ? gv.x * c + gv.y * s : a.x, ay = gv ? -gv.x * s + gv.y * c : a.y;
    let dx = ax - P.x, dy = ay - P.y, d = Math.hypot(dx, dy);
    if (d < .1) { const f = P.faceAngle; dx = Math.sin(f); dy = Math.cos(f); d = 1; }
    dx /= d; dy /= d;
    const cs = Math.cos(K.snap * DEG); let best = null, bd = 9;
    for (const p of host.entities.near(P.x, P.y, K.reach + .8, NEAR)) {   // (the nearest in reach within K.snap deg of the cursor's way)
      if (p.broken || p.gone || !(creature(p) || movable(p))) continue;
      const ex = p.x - P.x, ey = p.y - P.y, l = Math.hypot(ex, ey); if (l < .05 || l - (p.r || .3) > K.reach + .3 || Math.abs((p.z || 0) - P.z) > 1) continue;
      if ((ex * dx + ey * dy) / l >= (l < .9 ? cs - .35 : cs) && l < bd) { best = p; bd = l; }   // (right at his feet: a wider snap)
    }
    if (best) { PT.x = best.x; PT.y = best.y; } else { PT.x = P.x + dx * 2; PT.y = P.y + dy * 2; }
    return PT;
  }
  // the nearest liftable in front of him within C.reach: a movable prop or a gunman's loose hat / gun -> {q, kind: 'prop' | 'loose', heavy}
  const LF = {q: null, kind: '', heavy: false};
  function liftable() {
    const P = host.player, f = P.faceAngle, fx = Math.sin(f), fy = Math.cos(f);
    LF.q = null; let bd = C.reach;
    for (const q of host.entities.near(P.x, P.y, C.reach + .5, NEAR)) {
      if (!movable(q) || Math.abs((q.z || 0) - P.z) > .6 || (q.vx || q.vy) && Math.hypot(q.vx, q.vy) > 1) continue;
      const dx = q.x - P.x, dy = q.y - P.y, d = Math.hypot(dx, dy) - (q.r || .3) * .5;
      if (d < bd && (d < .5 || (dx * fx + dy * fy) / (Math.hypot(dx, dy) || 1) > .2)) { bd = d; LF.q = q; LF.kind = 'prop'; LF.heavy = LIFT[q.kind] === 'heavy'; }
    }
    const L = fsim()?.loose; if (L) for (const it of L) {
      if (!it.on || it.held || !it.rest || Math.abs(it.h - P.z) > .6) continue;
      const d = Math.hypot(it.x - P.x, it.y - P.y);
      if (d < bd) { bd = d; LF.q = it; LF.kind = 'loose'; LF.heavy = false; }
    }
    return LF.q ? LF : null;
  }

  // ---------------------------------------------------------------- the blow (player.kick: world coordinates)
  // the boot meets ONE thing (the nearest in its arc, a body before a prop at the same reach); the barge everything in its path
  const CAND = [];
  function land(e) {
    const T = e.barge ? BG : K, c0 = Math.cos(K.arc / 2 * DEG);
    if (!e.barge || e.n === 1) hitSet.clear();
    const fs = fsim(); CAND.length = 0;
    for (const p of host.entities.near(e.x, e.y, T.reach + 1, NEAR)) {
      if (p.broken || p.gone || hitSet.has(p) || p.held) continue;
      const kind = creature(p) && (p.kind === 'gunman' || p.kind === 'troll' || core()?.BS.has(p)) ? 'body' : movable(p) ? 'prop'
        : (p.hp > 0 || p.target) && (p.breakable || p.target) && !p.hunter && p.kind !== 'gunman' && !p.wall && !p.rect ? 'thing' : '';
      if (!kind) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1e-6, r = p.hitR ?? p.r ?? .3;
      if (d - r > T.reach || Math.abs((p.z || 0) - e.z) > 1) continue;
      if (e.barge ? (dx * e.vx + dy * e.vy < -.2 || Math.abs(dx * e.vy - dy * e.vx) > BG.width) : (dx * e.vx + dy * e.vy) / d < c0) continue;
      CAND.push(p, kind, d - r - (kind === 'body' ? .25 : 0));
    }
    const L = fs?.loose; if (L) for (const it of L) {   // a hat, a gun on the ground
      if (!it.on || it.held || hitSet.has(it)) continue;
      const dx = it.x - e.x, dy = it.y - e.y, d = Math.hypot(dx, dy) || 1e-6;
      if (d > T.reach || Math.abs(it.h - e.z) > 1 || (!e.barge && (dx * e.vx + dy * e.vy) / d < c0)) continue;
      CAND.push(it, 'loose', d + .2);
    }
    let bi = -1; if (!e.barge) { let bd = 1e9; for (let i = 0; i < CAND.length; i += 3) if (CAND[i + 2] < bd) { bd = CAND[i + 2]; bi = i; } }
    let any = false;
    for (let i = 0; i < CAND.length; i += 3) if (e.barge || i === bi) { blow(e, T, CAND[i], CAND[i + 1]); any = true; }
    if (any) { host.hitstop(e.barge ? .05 : .07); host.shake(e.barge ? 2 : 3, .12); }
    else if (!e.barge) host.events.push({type: 'kick.hit', x: e.x + e.vx * .8, y: e.y + e.vy * .8, who: null, kind: 'air', barge: false});   // (a swing at the air: its whoosh)
    if (!e.barge) S.kicks++;
  }
  function blow(e, T, p, kind) {
    const cr = core(), fs = fsim(); hitSet.add(p);
    // the way it goes: mostly his, a little away from his middle
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    let ux = e.vx * .75 + dx / d * .25, uy = e.vy * .75 + dy / d * .25; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    if (kind === 'body') {
      const heft = p.kind === 'gunman' ? TUNE.heft[p.foe] ?? 1 : p.boss ? TUNE.heft.boss : p.elite ? TUNE.heft.elite : TUNE.heft.brute;
      cr?.damage(p, T.dmg, {canCrit: false, dir: [ux * 3, uy * 3], by: 'melee', ux, uy});
      host.events.push({type: 'kick.hit', x: p.x, y: p.y, who: p, kind: 'body', barge: !!e.barge});
      if (p.broken) return;
      if (p.kind === 'troll') { host.feature('trolls')?.shove(p, ux * T.out, uy * T.out, .5); return; }   // (features/trolls.js: its own push and stagger)
      if (!heft) { cr?.hold(p, TUNE.stagger); return; }   // (a champion: it only staggers)
      const o = 1 / heft, up = T.up / Math.sqrt(heft);
      if (p.kind === 'gunman') fs?.launch(p, ux * T.out * o, uy * T.out * o, up, {gunK: .35, hatK: .55});
      else cr?.launch(p, ux * T.out * o, uy * T.out * o, up);
    } else if (kind === 'prop') {
      const v = e.barge ? BG.prop : p.kind === 'crate' ? K.crate : K.prop;
      phys()?.shove(p, ux * v, uy * v);
      host.events.push({type: 'kick.hit', x: p.x, y: p.y, who: p, kind: p.kind, barge: !!e.barge});
    } else if (kind === 'loose') {
      fs?.kickLoose(p, ux * K.loose, uy * K.loose, K.looseUp);
      host.events.push({type: 'kick.hit', x: p.x, y: p.y, who: null, kind: p.kind, barge: !!e.barge});
    } else {
      cr?.damage(p, T.dmg, {canCrit: false, dir: [ux * 3, uy * 3], by: 'melee', ux, uy});
      host.events.push({type: 'kick.hit', x: p.x, y: p.y, who: p, kind: p.kind, barge: !!e.barge});
    }
  }

  // ---------------------------------------------------------------- carrying
  function hands(out, k = 1) {   // where the load is held (world): ahead of him, at the carry's height (k: 0 at his feet .. 1 held)
    const P = host.player, f = P.faceAngle, hold = C.hold, h0 = P.z + (S.heavy ? C.h : C.hSmall);
    out.x = P.x + Math.sin(f) * hold; out.y = P.y + Math.cos(f) * hold; out.h = (P.z + .05) + (h0 - .3 - (P.z + .05)) * k;   // (h: the load's base)
    return out;
  }
  const HP = {x: 0, y: 0, h: 0};
  function holdStep() {
    const q = S.carry; if (!q) return;
    const b = B(), k = b && b.mode === 'lift' ? Math.min(1, Math.max(0, (b.S.t - C.grab) / (C.lift - C.grab))) : 1;
    hands(HP, k);
    if (S.ckind === 'prop') { if (!phys()?.carry(q, HP.x, HP.y, HP.h, host.player.faceAngle)) drop(false); }
    else { if (!q.on) { S.carry = null; return; } fsim()?.carryLoose(q, HP.x, HP.y, HP.h + .3, host.player.faceAngle); }
  }
  function startCarry(q, kind) {
    S.carry = q; S.ckind = kind;
    if (kind === 'loose') fsim()?.holdLoose(q, true);
    holdStep();
    if (!S.speedOn) { host.mods?.set('brawl', [{stat: 'player.speed', mul: C.speed}]); S.speedOn = true; }
  }
  function endCarry() { S.carry = null; S.ckind = ''; if (S.speedOn) { host.mods?.clear('brawl'); S.speedOn = false; } }
  function drop(put, vx = 0, vy = 0) {   // set down (put: ahead of him) or let fall (a roll, a knock)
    const q = S.carry; if (!q) return;
    const P = host.player, f = P.faceAngle;
    if (S.ckind === 'prop') {
      if (put) phys()?.put(q, P.x + Math.sin(f) * C.put, P.y + Math.cos(f) * C.put);
      else phys()?.toss(q, vx * .5, vy * .5, .5);
    } else if (put) { const s = fsim(); s?.holdLoose(q, false); s?.kickLoose(q, Math.sin(f) * .6, Math.cos(f) * .6, .5); }
    else fsim()?.tossLoose(q, vx * .5, vy * .5, 1);
    endCarry();
  }
  // the throw (player.throw: world): an arc from his hands to land e.d m along (vx, vy), its top `arc` x the way up
  function throwIt(e) {
    const q = S.carry; if (!q) return;
    const g = 18, d = Math.max(TH.min, Math.min(TH.range, e.d)), x1 = host.player.x + e.vx * d, y1 = host.player.y + e.vy * d;
    hands(HP, 1);
    const h0 = HP.h + (S.ckind === 'loose' ? .3 : 0), h1 = host.elev(x1, y1), H = Math.max(.35, (S.heavy ? TH.arcHeavy : TH.arc) * d) + Math.max(0, h1 - h0);
    const vh = Math.sqrt(2 * g * H), t = (vh + Math.sqrt(Math.max(0, vh * vh + 2 * g * (h0 - h1)))) / g;
    let v = (d - .3) / t; const vm = TH.vmax * (S.heavy ? .85 : 1); if (v > vm) v = vm;
    if (S.ckind === 'prop') phys()?.toss(q, e.vx * v, e.vy * v, vh);
    else fsim()?.tossLoose(q, e.vx * v, e.vy * v, vh);
    host.events.push({type: 'carry.throw', x: HP.x, y: HP.y, who: S.ckind === 'prop' ? q : null, kind: q.kind, heavy: S.heavy});
    S.throws++;
    endCarry();
  }

  const PROMPT = {text: 'E  lift', color: '#f2d27a'}, PROMPT2 = {text: 'LMB  throw  ·  E  set down', color: '#f2d27a'};
  const F = {
    name: 'brawl', label: 'Brawl', S, TUNE, on: true,
    update(dt, evs) {
      const b = B();
      if (!b) { if (S.carry) { drop(false); host.PL.brawl?.clear(); } return; }
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'player.kick') land(e);
        else if (e.type === 'player.lift') {
          if (e.phase === 'grab') { if (S.want && (S.wantKind === 'prop' ? movable(S.want) : S.want.on && !S.want.held)) startCarry(S.want, S.wantKind); else b.clear(); S.want = null; }
          else if (e.phase === 'put') drop(true);
          else if (e.phase === 'drop') drop(false, e.vx || 0, e.vy || 0);
        } else if (e.type === 'player.throw') throwIt(e);
      }
      if (S.carry && !b.carrying && b.mode !== 'throw' && b.mode !== 'lift') drop(false);   // (the player's side let go: a loadout switch, a clear)
      holdStep();
    },
    onKey(k, e) {
      const b = B(); if (!b) return false;
      if (k === 'v' && KICK) {
        if (b.carrying) return true;
        const P = host.player, sp = Math.hypot(P.vx, P.vy);
        if (e?.shiftKey) { if (sp < BG.min) return false; b.barge(); return true; }   // (Shift held: at a sprint the barge; else Shift+V stays gunfx's smoke styles)
        const pt = kickPoint(); b.kick(pt.x, pt.y); return true;
      }
      if (k === 'e' && LIFTS) {
        if (b.carrying) { b.put(); return true; }
        if (host.PL.nearInteract?.()) return false;   // (a chest, a sign, a shrine: E is theirs)
        const L = liftable(); if (!L) return false;
        if (b.lift(L.q.x, L.q.y, L.heavy ? 'heavy' : 'small')) { S.want = L.q; S.wantKind = L.kind; S.heavy = L.heavy; return true; }
        return false;
      }
      if (b.carrying && (k === 'r' || k === 'y')) return true;   // (both hands on the load)
      return false;
    },
    ability(slot) { const b = B(); return !!(b && b.carrying && slot === 'rmb'); },   // (RMB while carrying: nothing; not the gun's fan)
    claims: k => k === 'v' && KICK && !!B(),   // (core/input.js: V reaches onKey outside dev mode while he can kick)
    hd(q, sc) {   // the prompt: what E does here (only where nothing else's prompt shows)
      const b = B(); if (!b || host.lock || host.PL.nearInteract?.()) return;
      let at = null, P = host.player;
      if (b.carrying) { if (b.mode) return; at = PROMPT2; }
      else if (LIFTS && !host.BUSY.has(P.state) && liftable()) at = PROMPT;
      if (!at) return;
      const x = b.carrying ? P.x : LF.q.x, y = b.carrying ? P.y : LF.q.y, h = b.carrying ? P.z + 2.1 : (LF.kind === 'loose' ? LF.q.h : (LF.q.z || 0)) + 1.1;
      const s = host.G.toScreen(x, h, y), dpr = devicePixelRatio || 1;
      q.save(); host.G.hdShift?.(q, sc);
      q.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`; q.textAlign = 'center';
      const w = q.measureText(at.text).width + 12 * dpr;
      q.fillStyle = 'rgba(14,16,15,.8)'; q.fillRect(s[0] * sc - w / 2, s[1] * sc - 16 * dpr, w, 18 * dpr);
      q.fillStyle = at.color; q.fillText(at.text, s[0] * sc, s[1] * sc - 3 * dpr);
      q.restore();
    },
    hud: () => { const b = B(); return b ? `brawl ${b.mode || (b.carrying ? 'carry ' + (S.carry?.kind || '') : 'ready')} kicks ${S.kicks} throws ${S.throws}` : ''; },
    biomeChanged() { if (S.carry) endCarry(); host.PL.brawl?.clear(); },
  };
  return F;
}
