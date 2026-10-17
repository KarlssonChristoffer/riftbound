// ICE (docs/WINTER.md "The lake ice"): the forest lake freezes through winter, from the shore out, and thaws in the spring.
// Rules and knobs: sim/ice.js, content/ice.js (shared with the co-op server).
//   SIM    update: the thickness is the clock's (sim/ice.js thickYear(env.year): no state, the same everywhere). Where it holds him
//          (world/layout.js ICE.solid: on the lake, thick enough, not a hole) there's no water for the sim: no swimming, no wading,
//          no fishing (world.js waterSample). On thin ice (under TUNE.walk) it cracks under him and after TUNE.tell s he goes
//          through: a hole opens where he stood, he's held in it (the 'player.stuck' note) till he climbs out (hold Space). A pick
//          or an axe cuts a hole (LMB on the ice: sim/player/tool.js's job 'ice'). Holes freeze over again in a day. On the ice his
//          starts and stops slip ('player.accel' / 'player.decel' notes; snow on it gives grip back)
//   VIEW   the ice in the water shader (G.setIce: on a change), the cracks spreading at his feet, chips off a blow
// Online the holes are the server's ('hole' act; world 'i' + n: {x, y, r, at}); offline they're saved (pack.store('ice')).
// Only in the persistent world (the sandbox's ruins biome: the forest); ?ice=1 frozen now (mid-winter's ice), ?ice=0 never.
// OWNS: the modifier source 'ice', the holes (offline), layout's ICE.solid hook. READS: host.player, host.env (year, t, snowCover),
//   world/layout.js FOREST (the lake), host.keys (Space held), host.PL.tool (wantBy / aimBy), pack (best tools, store), gear (S.worn:
//   the mail shirt), coop (online, act, mail, net: a friend near), body (chill). EMITS: ice.crack, ice.break, ice.out, ice.hole, ice.sing.
// API: F.thick (m, the open lake's), F.solidAt(x, y), F.onIce (he stands on it), F.holes (Map), F.inHole(x, y)
// BUDGET: sim ~.005 ms a step (a few distance tests); ICE.solid ~.001 ms a call (the lake's ellipse, three thin spots, <= 8 holes).
import {TUNE} from '../content/ice.js';
import {thickYear, createLake, refreezeAt} from '../sim/ice.js';
import {TUNE as WXT} from '../sim/wxclock.js';
import {FOREST, ICE} from '../world/layout.js';
import {flags} from '../core/flags.js';
import {viewRandom} from '../core/rng.js';

const ON = flags.get('wx2') !== '0' && flags.get('ice') !== '0' && !!FOREST?.lake;
const NOW = flags.get('ice') === '1';
const R = viewRandom('ice'), rr = (a, b) => a + R() * (b - a);

// ORDER (core/features.js): after co-op (its mail this step: a hole cut, frozen over); the body's chill lands a step late (it goes before co-op)
export const order = {after: ['coop']};

export async function create(host) {
  const game = () => host.feature('game'), pack = () => host.feature('pack'), ui = () => game()?.ui || null;
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const L = createLake(FOREST);
  const F = {name: 'ice', label: 'Lake ice', on: true, thick: 0, onIce: false, holes: L.holes, inHole: L.inHole};
  let coop = null, gear = null, body = null, live = false;
  const thickNow = () => NOW ? TUNE.max * .8 : thickYear(host.env?.year ?? 0);
  F.solidAt = (x, y) => live && L.inLake(x, y) && L.localAt(x, y, F.thick) >= TUNE.crack && !L.inHole(x, y);
  ICE.solid = F.solidAt;

  // ---- holes: offline saved; online the server's
  const online = () => !!coop?.online;
  const store = () => pack()?.store?.('ice');
  let restored = false, holeN = 0;
  function restore() {
    const s = store(); if (!s) return;
    restored = true; L.holes.clear();
    for (const h of s.holes || []) if (Array.isArray(h)) L.open(h[0], h[1], h[2], h[3], h[4]);
    holeN = s.n | 0;
  }
  function save() { const s = store(); if (!s) return; s.holes = [...L.holes.values()].map(h => [h.id, h.x, h.y, h.r, h.at]); s.n = holeN; }
  function openHole(x, y, broke) {
    if (online()) { coop.act('hole', '', {x: +x.toFixed(2), y: +y.toFixed(2), b: broke ? 1 : 0}); if (broke) L.open('pending', x, y, TUNE.hole.breakR, (host.env?.t ?? 0) + .06); return; }   // (the server's word makes it; a break opens under him now)
    const id = 'o' + (++holeN); L.open(id, x, y, broke ? TUNE.hole.breakR : TUNE.hole.r, refreezeAt(host.env?.t ?? 0, WXT.seasonDays)); save(); verIce++;
    host.events.push({type: 'ice.hole', x, y, broke: !!broke});
  }

  // ---- him on the ice: cracking, going through, climbing out, the slip
  let crackT = 0, inIce = false, climbT = 0, back = [0, 0], key = '', growT = 0, singT = rr(...TUNE.sing);
  const dir = [0, 1];
  function notes(onIce, stuck) {
    const snow = host.env?.snowCover ?? 0, slip = onIce ? Math.round((TUNE.slip + (1 - TUNE.slip) * Math.min(1, snow)) * 10) / 10 : 1;
    const k = `${slip}|${stuck ? 1 : 0}`; if (k === key) return; key = k;
    const n = [];
    if (slip < 1) n.push({stat: 'player.accel', mul: slip}, {stat: 'player.decel', mul: slip});
    if (stuck) n.push({stat: 'player.stuck', add: 1});
    if (n.length) host.mods.set('ice', n); else host.mods.clear('ice');
  }
  const SMP = {x: 0, y: 0, z: 0, phi: 0};
  function friendNear(P) {
    const C = online() ? coop.net : null; if (!C) return false;
    for (const q of C.peers.values()) { if (!q.n || !C.sample(q, SMP)) continue; if (Math.hypot(SMP.x - P.x, SMP.y - P.y) < TUNE.climb.friendR) return true; }
    return false;
  }
  function climbOut(P) {   // onto the ice he came from, past the hole's edge
    const h = L.inHole(P.x, P.y);
    let x = back[0], y = back[1];
    // (back the way he came, onto ice that holds: past the thin spot if it reaches; else the nearest solid ice; else where he stood)
    const firm = (tx, ty) => !L.inLake(tx, ty) || (F.solidAt(tx, ty) && L.localAt(tx, ty, F.thick) >= TUNE.walk);
    let found = false;
    for (let d = (h?.r ?? 1) + .35; d < 6 && !found; d += .2) { const tx = (h?.x ?? P.x) - dir[0] * d, ty = (h?.y ?? P.y) - dir[1] * d; if (firm(tx, ty)) { x = tx; y = ty; found = true; } }
    if (!found) for (let d = (h?.r ?? 1) + .35; d < 4; d += .2) { const tx = (h?.x ?? P.x) - dir[0] * d, ty = (h?.y ?? P.y) - dir[1] * d; if (F.solidAt(tx, ty)) { x = tx; y = ty; break; } }
    inIce = false; climbT = 0; notes(true, false);
    host.teleport(x, y);
    body?.chill?.(TUNE.climb.chill);
    host.events.push({type: 'ice.out', x, y});
    ui()?.float(x, y, 1.9, 'out of the ice', '#cfe4f4');
  }

  // ---- the pick or the axe on the ice (sim/player/tool.js's job 'ice')
  let toolSet = false, blows = 0, blowAt = [0, 0], noteT = 0;
  const AIM = {x: 0, y: 0, keep: .9, far: 3};
  function cursorIce() {
    const a = host.aim?.(); if (!a || a.target) return null;
    const P = host.player; if (Math.hypot(a.x - P.x, a.y - P.y) > 3.2 || !F.solidAt(a.x, a.y)) return null;
    return a;
  }
  function wantTool() {
    if (!active() || host.lock || F.thick < TUNE.crack) return '';
    const P = host.player; if (P.state === 'draw') return '';
    const a = cursorIce(); if (!a) return '';
    const b = pack()?.best?.('mine') || pack()?.best?.('chop');
    if (!b) { if (host.env && (host.env.t - noteT) > .05) { noteT = host.env.t; ui()?.float(a.x, a.y, .6, 'needs a pick or an axe', '#e8a070'); } return ''; }
    AIM.x = a.x; AIM.y = a.y; return b.id;
  }
  const aimPoint = () => AIM;
  function blow(e) {
    const x = e.x + e.vx * .9, y = e.y + e.vy * .9;
    if (!F.solidAt(x, y)) return;
    if (Math.hypot(x - blowAt[0], y - blowAt[1]) > .5) { blows = 0; blowAt[0] = x; blowAt[1] = y; }
    blows++; chips.push(x, y);
    const job = pack()?.best?.('mine')?.id === e.tool ? 'mine' : 'chop', need = TUNE.hole.blows[job] || 4;
    if (blows >= need) { blows = 0; openHole(blowAt[0], blowAt[1], false); ui()?.float(x, y, .8, 'a hole in the ice', '#cfe4f4'); }
  }

  // ---- the server's word on holes
  function mail(m) {
    if (m.k !== 'world' || typeof m.id !== 'string' || m.id[0] !== 'i') return;
    if (m.s === 'hole') { L.close('pending'); L.open(m.id, m.x, m.y, m.r, m.at); verIce++; if (!m.late) host.events.push({type: 'ice.hole', x: m.x, y: m.y, broke: m.r > TUNE.hole.r}); }
    else if (m.s === 'grown') { L.close(m.id); verIce++; }
  }

  let wasOnline = false;
  F.update = (dt, evs) => {
    live = active();
    if (!live) { if (key) { key = ''; host.mods.clear('ice'); } return; }
    coop ??= host.feature('coop') || false; gear ??= host.feature('gear') || false; body ??= host.feature('body') || false;
    const T = host.PL?.tool; if (T && !toolSet) { T.aimBy(aimPoint, 'ice'); T.wantBy(wantTool, 'ice'); toolSet = true; }
    F.thick = thickNow();
    const ol = online();
    if (ol !== wasOnline || (!ol && !restored)) { wasOnline = ol; L.holes.clear(); verIce++; if (!ol) restore(); }
    if (ol && coop.mail) for (const m of coop.mail) mail(m);
    for (const e of evs || []) if (e.type === 'player.chop' && e.job === 'ice') blow(e);
    // offline: holes freeze over (once a second)
    if ((growT += dt) >= 1) { growT = 0; const pd = L.holes.get('pending'); if (pd && (host.env?.t ?? 0) > pd.at) { L.close('pending'); verIce++; } if (!ol) { const t = host.env?.t ?? 0; let ch = false; for (const h of [...L.holes.values()]) if (t >= h.at) { L.close(h.id); ch = true; } if (ch) { save(); verIce++; } } }
    const P = host.player;
    const sp = Math.hypot(P.vx, P.vy); if (sp > .3) { dir[0] = P.vx / sp; dir[1] = P.vy / sp; }
    // in the ice: held, climbing out
    if (inIce) {
      if (P.state !== 'swim') { inIce = false; climbT = 0; }
      else {
        notes(false, true);
        if (host.keys.has(' ')) {
          const mail = gear?.S?.worn?.includes('mail_shirt'), need = (mail ? TUNE.climb.mail : TUNE.climb.s) * (friendNear(P) ? TUNE.climb.friend : 1);
          if ((climbT += dt) >= need) climbOut(P);
        } else climbT = Math.max(0, climbT - dt * .5);
        F.onIce = false; return;
      }
    }
    // on it
    const on = P.state !== 'swim' && L.inLake(P.x, P.y) && F.solidAt(P.x, P.y) && Math.abs(P.z - host.elev(P.x, P.y)) < .2;
    F.onIce = on;
    if (on) { back[0] = P.x; back[1] = P.y; }
    notes(on, false);
    const local = on ? L.localAt(P.x, P.y, F.thick) : 1;
    if (on && local < TUNE.walk) {
      const was = crackT; crackT += dt;
      if (Math.floor(was / .3) !== Math.floor(crackT / .3)) host.events.push({type: 'ice.crack', x: P.x, y: P.y, k: crackT / TUNE.tell});
      if (crackT >= TUNE.tell) {   // through
        crackT = 0; inIce = true; climbT = 0;
        openHole(P.x + dir[0] * .15, P.y + dir[1] * .15, true);
        host.events.push({type: 'ice.break', x: P.x, y: P.y});
        ui()?.float(P.x, P.y, 2, 'hold Space to climb out', '#cfe4f4');
      }
    } else crackT = Math.max(0, crackT - dt * 2);
    // a swim into a hole he didn't break (walked in): held too
    if (P.state === 'swim' && L.inHole(P.x, P.y) && !inIce) { inIce = true; climbT = 0; }
    // the singing: on a cold, clear night with ice to sing
    if (F.thick >= TUNE.walk && host.env?.part === 'night' && (host.env?.sky?.cloud ?? 1) < .5 && (singT -= dt) <= 0) {
      singT = rr(...TUNE.sing); host.events.push({type: 'ice.sing', x: FOREST.lake.x, y: FOREST.lake.y});
    }
  };

  // ---- VIEW: the ice in the water shader (on a change), the cracks at his feet, the chips off a blow
  let verIce = 1, shownKey = '';
  const LOOK = {cover: 0, snow: 0, thick: 0, thin: L.thin.map(t => [t[0], t[1], t[2], 1]), holes: []};
  const chips = [], bits = [];
  F.view = dt => {
    dt = Math.min(.05, Math.max(0, dt || 0));
    const G = host.G; if (!G?.setIce) return;
    if (!live || F.thick <= .01) { if (shownKey !== 'off') { shownKey = 'off'; G.setIce(null); } }
    else {
      const cover = Math.min(1, F.thick / TUNE.crack), snow = Math.min(1, (host.env?.snowCover ?? 0)), th = Math.min(1, F.thick / TUNE.max);
      const k = `${cover.toFixed(2)}|${snow.toFixed(2)}|${th.toFixed(2)}|${verIce}`;
      if (k !== shownKey) {
        shownKey = k; LOOK.cover = cover; LOOK.snow = snow; LOOK.thick = th;
        for (const t of LOOK.thin) t[3] = th > .55 ? .55 : 1;   // (thicker ice round them: less grey, still a tell)
        LOOK.holes.length = 0; for (const h of L.holes.values()) LOOK.holes.push([h.x, h.y, h.r]);
        G.setIce(LOOK);
      }
    }
    for (let i = 0; i + 1 < chips.length; i += 2) for (let n = 0; n < 6 && bits.length < 60; n++) { const a = R() * 6.283, s = rr(.8, 2); bits.push({x: chips[i], y: chips[i + 1], h: .05, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vh: rr(1, 2.4), t: rr(.3, .5)}); }
    chips.length = 0;
    if (live) thing(dt);
    for (let i = bits.length - 1; i >= 0; i--) { const b = bits[i]; b.t -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vh -= 9 * dt; b.h = Math.max(0, b.h + b.vh * dt); if (b.t <= 0) bits.splice(i, 1); }
  };
  // THE THING UNDER THE ICE (view only, his own): one visit to the ice in three, something long and dark slides up under the ice
  // beneath him, follows when he walks, stops when he stops; it keeps to the deep (THING.deep m from the shore) and goes after a while
  const THING = {odds: 1 / 3, off: 30, life: [35, 60], len: 2.6, wide: .8, speed: 3.2, deep: 2.2, alpha: .34, col: [11, 18, 24]};
  const U = {on: false, x: 0, y: 0, hd: 0, t: 0, a: 0, offT: 99};
  function spawn() { const P = host.player, a = R() * 6.283; U.on = true; U.t = rr(...THING.life); U.x = P.x + Math.cos(a) * 7; U.y = P.y + Math.sin(a) * 7; U.hd = a + Math.PI; U.a = 0; }
  function thing(dt) {
    const P = host.player;
    if (!F.onIce) U.offT += dt;
    else if (U.offT > THING.off) { U.offT = 0; if (R() < THING.odds && F.thick >= TUNE.walk) spawn(); }
    else U.offT = 0;
    if (!U.on) return;
    U.t -= dt;
    const leaving = U.t <= 0 || !F.onIce;
    U.a = Math.max(0, Math.min(1, U.a + (leaving ? -dt / 2 : dt / 3)));
    if (leaving && U.a <= 0) { U.on = false; return; }
    const sp = Math.hypot(P.vx, P.vy), tx = P.x - dir[0] * .6, ty = P.y - dir[1] * .6, dx = tx - U.x, dy = ty - U.y, d = Math.hypot(dx, dy);
    const v = leaving ? THING.speed * .6 : U.a < 1 || sp > .2 ? Math.min(THING.speed, d * 1.2) : 0;   // (it comes in, then moves only while he does)
    if (d > .05 && v > 0) {
      const ux = leaving ? -dx / d : dx / d, uy = leaving ? -dy / d : dy / d, nx = U.x + ux * v * dt, ny = U.y + uy * v * dt;
      if (FOREST.lakeEdge(nx, ny) > THING.deep || !L.inLake(U.x, U.y)) { U.x = nx; U.y = ny; }
      const want = Math.atan2(uy, ux); let dh = want - U.hd; dh -= Math.round(dh / 6.283) * 6.283; U.hd += dh * Math.min(1, dt * 2);
    }
  }
  function drawThing() {
    if (!U.on || U.a <= 0) return;
    const q = host.glayer('ground'), z = host.zoom || 1, c = Math.cos(U.hd), s = Math.sin(U.hd), g = host.elev(U.x, U.y);
    const o = host.toView(U.x, U.y, g), ax = host.toView(U.x + c, U.y + s, g), ppm = Math.hypot(ax[0] - o[0], ax[1] - o[1]);
    q.globalAlpha = THING.alpha * U.a;
    for (let i = 0; i <= 10; i++) {   // its body: a spine of blocks, widest a third back, a tail
      const u = i / 10 - .5, w = THING.wide * Math.sin(Math.PI * Math.min(1, (u + .5) * 1.25)) + .08, x = U.x + c * u * THING.len, y = U.y + s * u * THING.len;
      const p = host.toView(x, y, g), sz = Math.max(z, Math.round(w * ppm / z) * z);
      q.fillRectRGB(Math.floor(p[0] - sz / 2), Math.floor(p[1] - sz / 2), sz, sz, THING.col[0], THING.col[1], THING.col[2]);
    }
    q.globalAlpha = 1;
  }
  const CRK = [.86, .92, .98], PS = {size: 1};
  F.frame = () => {
    if (!live) return;
    const z = host.zoom || 1; PS.size = z;
    const P = host.player, g = host.elev(P.x, P.y) + .01;
    if (crackT > 0) {   // white cracks spreading from his feet: longer as the tell runs out
      const k = Math.min(1, crackT / TUNE.tell), n = 7;
      for (let i = 0; i < n; i++) { const a = i * 2.4 + 1, l = (.35 + (i % 3) * .25) * k * 1.6; host.line(P.x, P.y, g, P.x + Math.cos(a) * l, P.y + Math.sin(a) * l * .8, g, CRK, false); }
    }
    for (const b of bits) host.point(b.x, b.y, host.elev(b.x, b.y) + b.h, CRK, PS);
    drawThing();
  };
  F.hud = () => live && F.thick > 0 ? `ice ${(F.thick * 100) | 0} cm${F.onIce ? ' · on it' : ''}${crackT > 0 ? ' · cracking' : ''}${inIce ? ' · in the ice' : ''} · holes ${L.holes.size}` : '';
  F.menu = () => live ? [
    {label: 'Ice: take me to the lake', run: () => { const l = FOREST.lake; host.teleport(l.x - l.rx - 1.5, l.y); }},
    {label: 'Ice: to the nearest thin spot', run: () => { const P = host.player; let b = L.thin[0]; for (const t of L.thin) if (Math.hypot(t[0] - P.x, t[1] - P.y) < Math.hypot(b[0] - P.x, b[1] - P.y)) b = t; host.teleport(b[0] + .3, b[1]); }},
    {label: 'Ice: the thing under the ice (now)', run: () => spawn()},
    {label: 'Ice: a hole here', run: () => { const P = host.player; openHole(P.x + dir[0] * 1.2, P.y + dir[1] * 1.2, false); }},
  ] : [];
  F.biomeChanged = () => { shownKey = ''; };
  return F;
}
