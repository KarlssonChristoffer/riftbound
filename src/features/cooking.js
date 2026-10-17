// COOKING (docs/COOKING.md): THE STICK. A dish clicked in the pack panel's Cook list (features/meals.js pays for it, closes the
// panel and asks start(id)) goes on a stick over a burning fire within STICK.r m: he crouches facing it (host.PL.hold), the stick
// out with the food over the flames, and the clock starts. The food's look steps through raw, warm, golden, brown and black; the
// sizzle climbs (cook.sizzle); in the "just right" window fat drips and the fire flares (cook.flare: features/campfires.js), so it
// reads without sound too. E, LMB or Space pulls it out and he eats it at its quality (content/meals.js TUNE, the dish's cook.t):
// raw before t - win, just right within t +/- right, done within t +/- win, burnt after. At t + drop it falls into the fire: gone,
// a puff (cook.drop). Walking off (a move key), a hit or the fire going out pulls it out at once, whatever it is by then.
// ?cook=0 (or ?moods=0): no stick, every dish is "done" at once (features/meals.js). ?cookwin= ms: the done window's half-width.
// Local (each player his own stick; the meal it gives goes to friends as its code: features/meals.js).
//   Sim: the stick's clock, the pull, the drop, the quality. View: the stick, the food's colour, fat drips and smoke; HD: the prompt
//   and (Esc > Sandbox) the timing bar.
// OWNS: the stick (S), its particles, the timing bar switch. READS: content/meals.js (MEALS cook.t, TUNE), campfires (burningAt,
//   the fire's fuel), meals (cooked, odd), host.PL (hold, unhold, faceShot, moveInput), host.events (player.hit / player.hurt).
// EMITS: cook.start, cook.sizzle, cook.flare, cook.pull, cook.drop.
// THE SHARED POT (start(id, {pot: the fire's build, cost})): the same game, slower (content/builds.js POT), the pot hung over the
//   fire (features/campfires.js drawPot); taken off, it stays on the fire at its quality for everyone's spoons (builds.pot), and
//   meals.potDone writes it in his journal.
// API: F.game (the stick is on: meals asks before paying), F.busy (a dish is on it now), F.start(id, {odd, col}?) -> bool (odd: the
//   Try stick's something odd, no dish), F.S (tests). Pulled out: meals.cooked(id, q) (learned, journal, eaten) or meals.odd().
// BUDGET: sim: a few compares a step while cooking (nothing otherwise). View: a stick (3 lines), ~10 points of food, <= 40 drips
//   and smoke; HD: one prompt (and the bar) while cooking.
import {MEALS, TUNE, TRY} from '../content/meals.js';
import {POT} from '../content/builds.js';
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {hdUnit, hdPrompt, hdFrame} from '../ui/hdpixel.js';

const ON = flags.get('cook') !== '0' && flags.get('moods') !== '0';
const WIN = (v => v > 0 ? v / 1000 : TUNE.win)(parseFloat(flags.get('cookwin')));   // s: done is cook.t +/- WIN
// the stick: m from a burning fire to cook at; the crouch (s held at most: longer than any dish's t + drop); the stick's reach and the
// food's height over the fire; the sizzle's beat (s, faster as it cooks); the food's looks by stage (warm .. black mix into the dish's
// colour by mix); the drips and the smoke
const STICK = {r: 2.5, pose: 'crouch', hold: 12, over: .55, sizzle: .32, stick: '#6a4a2a', tip: '#8a6a44',
  look: {warm: ['#e0a050', .35], golden: ['#e8b040', .6], brown: ['#8a5228', .8], black: ['#241a14', .95]}, max: 40};

// ORDER (core/features.js): after the meals (they start it from the pack's Cook list), after the fires (their state this step)
export const order = {after: ['meals', 'campfires']};

export async function create(host) {
  const game = () => host.feature('game'), ui = () => game()?.ui || null;
  const fires = () => host.feature('campfires');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const S = {on: false, id: '', odd: false, col: '', pot: null, cost: null, win: WIN, right: TUNE.right, drop: TUNE.drop, t: 0, cookT: 3, fx: 0, fy: 0, fz: 0, presses: 0, sizT: 0, flared: false, bar: false};
  const ev = (type, o) => { o.type = type; host.events.push(o); };
  let devI = 0;

  // the quality if pulled at s on the stick (content/meals.js TUNE: right inside done; raw before, burnt after)
  function qualityAt(t) { const d = t - S.cookT; return d < -S.win ? 'raw' : Math.abs(d) <= S.right ? 'right' : d <= S.win ? 'done' : 'burnt'; }
  // o.odd: the Try stick's something odd (id '': no dish; o.col its colour on the stick, TRY.t s). o.pot: THE SHARED POT's slow game
  // (content/builds.js POT: t, windows, drop) on that fire (a build with no pot on it); o.cost: what was paid (back if the server
  // says no)
  function start(id, o) {
    const odd = !!o?.odd, pot = o?.pot || null;
    if (!ON || S.on || (!odd && !MEALS[id]) || !active()) return false;
    const P = host.player, b = pot || fires()?.burningAt?.(P.x, P.y, STICK.r); if (!b) return false;
    if (pot && (Math.hypot(b.x - P.x, b.y - P.y) > POT.reach || host.feature('builds')?.hasPot(b))) return false;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw), dx = b.x - P.x, dy = b.y - P.y;
    if (dx * dx + dy * dy > .01) host.PL.faceShot?.(dx * c - dy * s, dx * s + dy * c);   // (his view frame)
    host.PL.hold?.(STICK.pose, STICK.hold); if (P.state !== 'hold') return false;   // (busy: rolling, climbing ... no stick)
    Object.assign(S, {on: true, id: odd ? '' : id, odd, col: odd ? o.col || TRY.col : '', pot, cost: o?.cost || null, win: pot ? POT.win : WIN, right: pot ? POT.right : TUNE.right,
      drop: pot ? POT.drop : TUNE.drop, t: 0, cookT: odd ? TRY.t : pot ? POT.t : MEALS[id].cook?.t || 3, fx: b.x, fy: b.y, fz: b.z || 0, presses: 0, sizT: 0, flared: false});
    ev('cook.start', {x: b.x, y: b.y, id});
    return true;
  }
  function done(q) {   // pulled out (q) or dropped (q '')
    S.on = false; S.presses = 0; host.PL.unhold?.();
    if (!q) { ev('cook.drop', {x: S.fx, y: S.fy, id: S.id}); const P = host.player; ui()?.float(P.x, P.y, P.z + 2, 'it fell in the fire', '#a8b0b8'); return; }
    ev('cook.pull', {x: S.fx, y: S.fy, id: S.id, q});
    const M = host.feature('meals');
    if (S.pot) { if (host.feature('builds')?.pot(S.pot, S.id, q, S.cost)) M?.potDone(S.id, q); }   // (the pot stays on the fire: everyone's spoons)
    else if (S.odd) M?.odd(); else M?.cooked(S.id, q);
  }

  // ---------------------------------------------------------------- the view: the stick, the food, drips and smoke
  const PT = []; for (let i = 0; i < STICK.max; i++) PT.push({on: false, x: 0, y: 0, h: 0, vh: 0, t: 0, life: 0, col: '', fat: false});
  function spawn(x, y, h, vh, life, col, fat) { for (const p of PT) if (!p.on) { p.on = true; p.x = x; p.y = y; p.h = h; p.vh = vh; p.t = 0; p.life = life; p.col = col; p.fat = fat; return; } }
  const END = {x: 0, y: 0, h: 0}, HAND = {x: 0, y: 0, h: 0};
  function stickEnds() {   // the hand (the live body's, else in front of him) and the food over the fire (a pot: its broth)
    if (S.pot) { END.x = S.fx; END.y = S.fy; END.h = S.fz + .5; return; }
    const P = host.player, h = host.playerRopeHand?.();
    if (h) { HAND.x = h.x; HAND.y = h.y; HAND.h = h.h; } else { const f = P.faceAngle; HAND.x = P.x + Math.sin(f) * .3; HAND.y = P.y + Math.cos(f) * .3; HAND.h = P.z + .55; }
    END.x = S.fx + (HAND.x - S.fx) * .12; END.y = S.fy + (HAND.y - S.fy) * .12; END.h = S.fz + STICK.over;
  }
  // the food's colour now: the dish's own, then warm, golden (the done window), brown, black
  const mixHex = (a, b, k) => { const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16), m = (s) => Math.round(((p >> s) & 255) * (1 - k) + ((q >> s) & 255) * k);
    return '#' + ((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1); };
  const LOOKS = new Map();   // dish id -> [raw, warm, golden, brown, black] (made once a dish)
  function looksOf(id, col) {   // (col: something odd's, keyed by its colour)
    const key = col || id; let L = LOOKS.get(key); if (L) return L;
    const c = col || MEALS[id].col || '#d8c0a0', K = STICK.look;
    LOOKS.set(key, L = [c, mixHex(c, K.warm[0], K.warm[1]), mixHex(c, K.golden[0], K.golden[1]), mixHex(c, K.brown[0], K.brown[1]), mixHex(c, K.black[0], K.black[1])]);
    return L;
  }
  function stage() { const d = S.t - S.cookT; return d < -1.2 ? 0 : d < -S.win ? 1 : d <= S.win ? 2 : d < S.win + 1.4 ? 3 : 4; }
  const P1 = {size: 1}, P2 = {size: 2}, PS = {size: 2, alpha: .5}, PB = {size: 1, alpha: 1};

  const F = {
    name: 'cooking', label: 'Cooking', on: ON, S,
    get game() { return ON; }, get busy() { return S.on; },
    start,
    // E or Space pulls it out (before the player's own keys: Space would roll); LMB too
    onKey(k) { if (!S.on || (k !== 'e' && k !== ' ')) return false; S.presses++; return true; },
    lmb(down) { if (!S.on) return false; if (down) S.presses++; return true; },
    update(dt, evs) {
      if (!S.on) return;
      S.t += dt;
      const P = host.player, B = fires();
      let hit = false; for (let i = 0; i < evs.length; i++) { const t = evs[i].type; if (t === 'player.hit' || t === 'player.hurt') hit = true; }
      const mv = host.PL.moveInput?.(), walk = !!mv && (mv[0] !== 0 || mv[1] !== 0);
      if (!active() || S.presses > 0 || walk || hit || P.state !== 'hold' || !B?.burningAt?.(S.fx, S.fy, .5)) { done(qualityAt(S.t)); return; }   // (a pot pulled off early: raw)
      if (S.t >= S.cookT + S.drop) { done(''); return; }
      if ((S.sizT -= dt) <= 0) { const k = S.t / S.cookT; S.sizT = STICK.sizzle * clamp(1.15 - .5 * k, .45, 1); ev('cook.sizzle', {x: S.fx, y: S.fy, k}); }
      if (!S.flared && Math.abs(S.t - S.cookT) <= S.right) { S.flared = true; ev('cook.flare', {x: S.fx, y: S.fy, id: S.id}); }
    },
    view(dt) {
      if (S.on) {
        stickEnds();
        const st = stage();
        if (!S.pot && Math.abs(S.t - S.cookT) <= S.right * 1.5 && Math.random() < dt * 30) spawn(END.x + (Math.random() - .5) * .08, END.y + (Math.random() - .5) * .08, END.h - .04, 0, .5, '#ffe090', true);   // (fat drips)
        if (st >= 3 && Math.random() < dt * (st === 4 ? 14 : 5)) spawn(END.x + (Math.random() - .5) * .1, END.y + (Math.random() - .5) * .1, END.h + .05, .45 + Math.random() * .3, 1.4, st === 4 ? '#3a3632' : '#8e8a84', false);   // (smoke)
      }
      for (const p of PT) {
        if (!p.on) continue;
        if ((p.t += dt) >= p.life) { p.on = false; continue; }
        if (p.fat) { p.vh -= 6 * dt; p.h += p.vh * dt; if (p.h < S.fz + .1) p.on = false; } else p.h += p.vh * dt;
      }
    },
    frame() {
      for (const p of PT) if (p.on) { const o = p.fat ? PB : PS; o.alpha = p.fat ? 1 : .5 * (1 - p.t / p.life); host.point(p.x, p.y, p.h, p.col, o); }
      if (!S.on) return;
      if (S.pot) { fires()?.drawPot?.(S.fx, S.fy, S.fz, looksOf(S.id, S.col)[stage()]); return; }
      // the stick: three short lines from his hand past the food; the food: a little cluster in its colour now
      const mx = (HAND.x + END.x) / 2, my = (HAND.y + END.y) / 2, mh = Math.max(HAND.h, END.h) + .06;
      host.line(HAND.x, HAND.y, HAND.h, mx, my, mh, STICK.stick); host.line(mx, my, mh, END.x, END.y, END.h, STICK.stick);
      const ux = END.x - mx, uy = END.y - my, l = Math.hypot(ux, uy) || 1;
      host.line(END.x, END.y, END.h, END.x + ux / l * .1, END.y + uy / l * .1, END.h - .02, STICK.tip);
      const L = looksOf(S.id, S.col), c = L[stage()];
      host.point(END.x, END.y, END.h, c, P2);
      host.point(END.x + ux / l * .05, END.y + uy / l * .05, END.h + .01, c, P2);
      host.point(END.x - ux / l * .05, END.y - uy / l * .05, END.h - .01, c, P1);
    },
    hd(q, sc) {
      if (!S.on || host.hudOff || host.playerHidden) return;
      const G = host.G, u = hdUnit(), s = G.toScreen(END.x, END.h + .5, END.y), x = Math.round(s[0] * sc), y = Math.round(s[1] * sc);
      q.save(); G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, S.pot ? 'E  take the pot off' : 'E  pull it out', x, y, u, '#f2d27a');
      if (S.bar) {   // DEV: the timing bar: raw | done | just right | done | burnt, the drop at its end, where it is now
        const W = 120 * u, H = 9 * u, x0 = Math.round(x - W / 2), y0 = y + 4 * u, end = S.cookT + S.drop, px = t => x0 + 2 * u + Math.round(clamp(t / end, 0, 1) * (W - 4 * u) / u) * u;
        hdFrame(q, x0, y0, W, H, u);
        const zone = (a, b, col) => { q.fillStyle = col; q.fillRect(px(a), y0 + 2 * u, Math.max(u, px(b) - px(a)), H - 4 * u); };
        zone(0, S.cookT - S.win, '#6a5a3a'); zone(S.cookT - S.win, S.cookT + S.win, '#c89a3a'); zone(S.cookT - S.right, S.cookT + S.right, '#ffe08a'); zone(S.cookT + S.win, end, '#3a2a22');
        q.fillStyle = '#f4f0e6'; q.fillRect(px(S.t), y0, u, H);
      }
      q.restore();
    },
    menu() {
      if (!ON || !active()) return [];
      const ids = Object.keys(MEALS), m = ids[devI % ids.length];
      return [{label: `Cooking (dev): the stick's timing bar ${S.bar ? 'on' : 'off'}`, run: () => { S.bar = !S.bar; }},
        {label: `Cooking (dev): dish ${MEALS[m].name} (click: next)`, run: () => { devI++; }},
        {label: 'Cooking (dev): put it on the stick, free (by a burning fire)', run: () => { if (!start(m)) ui()?.toast('Cooking', `needs a burning fire within ${STICK.r} m`, '#e8a070'); }}];
    },
    hud: () => S.on ? `cooking ${S.id} ${S.t.toFixed(2)}/${S.cookT}s ${qualityAt(S.t)}` : '',
    biomeChanged() { if (S.on) { S.on = false; host.PL.unhold?.(); } },
  };
  return F;
}
