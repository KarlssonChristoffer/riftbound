// HAPPENINGS (docs/WORLDLIFE.md "Happenings"): now and then something HAPPENS in the forest. From the world's seed and the in-game
// day (sim/happenings.js) each day gets 0..2 of them, where and when (content/happenings.js: one table entry each):
//   STAR     a clear night: a bright streak, a flash and a thump of light where it comes down in the woods; a small smoking
//            crater with a pulsing star shard in it, lighting the trees round it, sparks rising, till dawn (then the glow dies;
//            the scorch stays till the next evening). E takes the shard (Star Shard)
//   RING     the morning after rain: a ring of pale mushrooms (3.5 m across) in a glade; at night tiny lights dance over it. Step
//            into the middle at night: the world goes dreamy a moment (a grade over the mood and a slow sway) and you are
//            LIGHT-FOOTED for 2 min (a 'player.speed' note, source 'happenings'), motes trailing you. Once a night each
//   VÄTTAR  at dusk, now and then: 5 .. 9 knee-high hooded little ones with lanterns walk in a line from a big boulder to the lake
//            and into it. They ignore you; walk alongside within 4 m for 20 s and the last one stops, turns, and leaves you a
//            gift on the ground (a small thing: berries, a button, a feather, a thimble with a name on it)
//   RAINBOW  a rain spell clearing by day: a banded arc standing over the trees, its foot on a seeded spot; reach the foot and its
//            colours pool on the ground round you: a Rainbow Scale
// A toast says what started and roughly where ("A star fell, north-east of you, 40 m").
// MULTIPLAYER: nothing is sent. The schedule is a pure function of the seed and the shared clock (env.t: the server's in co-op), so
//   friends see the same star land at the same spot at the same hour, the same little ones walk the same way. Rewards are
//   PERSONAL: each player takes their own (pack.store('happenings'): a happening's id once each, offline too); the vättar's gift
//   and the ring's dream are each player's own (each client plays its own player's). Forced ones (the dev menu, ?happen=) are
//   this client's only.
// URL: ?happen=0 none; ?happen=star|ring|vattar|rainbow that one soon, near you; ?happen=often every kind every day, no conditions.
// DEV MENU (F10) > World > Happenings: each one now, near me; go to the current one; today's list; forget what I took.
// OWNS: the schedule (its own sim/happenings.js), the forced ones, what this player took (its store), the Light-footed buff (the
//   modifier source 'happenings'), the grade 'happenings', its particles and pictures. READS: host.env (t, hour, seed, TUNE),
//   the forest plan, pack (give, store, dirty), game (mode, ui.toast), coop (net.id), panels (part: the journal, if any).
// EMITS: happening.start / happening.end {kind, x, y, id}, happening.take {kind, x, y, item}.
// BUDGET: sim: the day's list from a cache, a few distances a step. View: a few dozen points and sprites near you; up to 5 lights.
import {flags} from '../core/flags.js';
import {FOREST} from '../world/layout.js';
import {createHappenings, compass} from '../sim/happenings.js';
import {HAPPENINGS} from '../content/happenings.js';
import {ITEMS} from '../content/items.js';
import {hash3, clamp, smooth} from '../core/mathx.js';
import {viewRandom, nameHash} from '../core/rng.js';
import {iconCanvas} from '../ui/packpanel.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';

const Q = flags.get('happen'), ON = Q !== '0', OFTEN = Q === 'often', FORCE = HAPPENINGS[Q] ? Q : null;
const TAU = Math.PI * 2;

// ORDER (core/features.js): before foraging and the fox's den (E at a star shard or a gift takes it, not the patch under it)
export const order = {before: ['forage', 'foxden']};

// ---------------------------------------------------------------- pixel pictures (painted once)
function paint(w, h, rows, pal) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d');
  for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) { const k = rows[y][x]; if (k !== '.' && pal[k]) { q.fillStyle = pal[k]; q.fillRect(x, y, 1, 1); } }
  return c;
}
const SHARD = ['...w...', '..wbw..', '..wbw..', '.wbWbc.', '.bWWbc.', 'wbWWWbc', '.bWWbc.', '..bbc..', '...c...'];
const SHARD_P = {w: '#e8f4ff', b: '#9cc8ff', W: '#ffffff', c: '#5a7ad8'};
const SHROOMS = [
  ['.ccc.', 'ccCcc', 'sCCCs', '..s..', '..S..'],
  ['..cc.', '.cCcc', 'cCCcs', '..s..', '..S..'],
  ['.....', '.ccc.', 'cCCcc', '.ss..', '..S..'],
];
const SHROOM_P = {c: '#e8e0cc', C: '#fff8e8', s: '#c8bca0', S: '#8a7c64'};
const SHROOM_E = {c: '#3a3828', C: '#6a6a48', s: '#000000', S: '#000000'};   // (their caps glow a little at night)
// a vätte (7 x 11): hooded, grey-brown cloak, a pale nose under the hood, a lantern on a stick; two strides and turned to you
const VAT = [
  ['...h...', '..hHh..', '.hHHHh.', '.hfnfh.', '..hdh..', '.hcccc.', 'hccccc.', '.cccccL', '.cccc.l', '.c.c...', '.b..b..'],
  ['...h...', '..hHh..', '.hHHHh.', '.hfnfh.', '..hdh..', '.hcccc.', 'hccccc.', '.cccccL', '.cccc.l', '..cc...', '..bb...'],
  ['...h...', '..hHh..', '.hHHHh.', '.hfffh.', '.hfnfh.', '.cdddc.', 'cccccc.', 'cccccL.', '.cccc.l', '.c..c..', '.b..b..'],
];
const VAT_P = {h: '#6a5a48', H: '#7e6c56', f: '#3a3028', n: '#d8b89a', d: '#4a3e32', c: '#5e5446', b: '#2e2620', L: '#ffd890', l: '#8a6a3a'};
const VAT_E = {L: '#ffc860'};

export async function create(host) {
  const F = {name: 'happenings', label: 'Happenings', on: ON, dev: {group: 'World', rows: () => devRows()}};
  if (!FOREST) return Object.assign(F, {on: false, dev: {group: 'World'}, today: () => [], dbg: () => ({off: 'no forest'})});
  let GA = null, PK = null;
  const game = () => GA ??= host.feature('game'), pack = () => PK ??= host.feature('pack'), coop = () => host.feature('coop');
  const ui = () => game()?.ui || null;
  const active = () => F.on && host.biome?.id === 'ruins' && game()?.mode === 'sandbox' && !!host.layout?.forest;
  const P = host.player, env = host.env;
  const me = () => coop()?.online ? String(coop().net?.id ?? 'me') : 'me';
  const S = createHappenings(FOREST, env.seed ?? FOREST.seed, {often: OFTEN, precip: env.TUNE?.precip !== false, seasonDays: env.TUNE?.seasonDays});
  const now = () => env.t ?? 0;
  const secPerH = () => (env.TUNE?.dayMinutes || 20) * 60 / 24;
  const V = viewRandom('happenings'), vr = (a, b) => a + V() * (b - a);

  // ---------------------------------------------------------------- what this player took (personal, saved)
  const store = () => pack()?.store('happenings') || null;
  const took = id => !!store()?.taken?.[id];
  function mark(id) {
    const st = store(); if (!st) return; st.taken ??= {};
    st.taken[id] = +now().toFixed(2);
    for (const k in st.taken) if (st.taken[k] < now() - 24 * 8) delete st.taken[k];   // (a week's worth is enough)
    pack().dirty(); ver++;
  }
  let ver = 0;
  function give(h, item, x, y, why) {
    if (!ITEMS[item]) return;
    pack()?.give(item, 1, {x, y, h: .6});
    mark(h.id);
    host.events.push({type: 'happening.take', kind: h.kind, x, y, item});
    ui()?.toast(ITEMS[item].name, why, HAPPENINGS[h.kind].col);
    (found[item] = (found[item] || 0) + 1);
  }
  const found = {};

  // ---------------------------------------------------------------- the clock: what's on, starts and ends
  const CUR = [], seen = new Set(), ended = new Set();
  let acc = 1, first = true;
  function toastStart(h, late) {
    const T = HAPPENINGS[h.kind], m = Math.round(Math.hypot(h.x - P.x, h.y - P.y) / 5) * 5;
    const text = m < 8 ? T.toast[1].replace('{dir} of you, {m} m', 'right by you') : T.toast[1].replace('{dir}', compass(P.x, P.y, h.x, h.y)).replace('{m}', String(m));
    ui()?.toast(late ? T.toast[0].replace('A star fell', 'A fallen star glows') + ' (still there)' : T.toast[0], text, T.col);
  }
  function clock() {
    S.around(now(), CUR);
    const t = now();
    for (const h of CUR) {
      if (t < h.t0) continue;
      if (!seen.has(h.id)) {
        seen.add(h.id);
        const late = t - h.t0 > .08;
        host.events.push({type: 'happening.start', kind: h.kind, x: h.x, y: h.y, id: h.id});
        if (!(late && t > h.t1)) toastStart(h, late);
        if (h.kind === 'star' && !late) fall(h);
        ver++;
      }
      if (t >= h.t1 && !ended.has(h.id)) { ended.add(h.id); host.events.push({type: 'happening.end', kind: h.kind, x: h.x, y: h.y, id: h.id}); ver++; }
    }
  }

  // ---------------------------------------------------------------- the player's part: take, step in, walk along, reach
  let near = null, want = null;   // near: {kind: 'shard' | 'gift', h | g, x, y, label}
  const gifts = [];   // {h, item, x, y, t (s on the ground)}
  const walk = new Map();   // vättar id -> s walked alongside (this player)
  const stop = {id: '', s: 0, d: 0, x: 0, y: 0, hd: 0, done: false};   // the last little one stopping for you
  let buff = 0, dream = 0;
  const W = {x: 0, y: 0, hd: 0, d: 0};
  function vattarStep(h, dt) {
    const T = HAPPENINGS.vattar, t = now();
    if (stop.id === h.id) {   // it stands, turned to you; then the gift, then on it goes
      stop.s += dt;
      if (!stop.done && stop.s > 1.6) {
        stop.done = true;
        const r = hash3(h.seed, nameHash(me()), 7), item = T.gifts.filter(i => ITEMS[i])[Math.floor(r * T.gifts.filter(i => ITEMS[i]).length)] || 'blueberries';
        gifts.push({h, item, x: stop.x + Math.cos(stop.hd + 1.2) * .35, y: stop.y + Math.sin(stop.hd + 1.2) * .35, t: 0}); mark(h.id);
        host.events.push({type: 'happening.take', kind: 'vattar', x: stop.x, y: stop.y, item, gift: true});
      }
      return;
    }
    if (took(h.id) || t >= h.t1) return;
    // alongside: within reach of any walking one
    let close = false;
    for (let i = 0; i < h.n; i++) { S.walkerAt(h, i, t, W); if (W.d > 0 && W.d < h.path.L && Math.hypot(W.x - P.x, W.y - P.y) < T.reach) { close = true; break; } }
    if (!close) return;
    const s = (walk.get(h.id) || 0) + dt; walk.set(h.id, s);
    if (s >= T.walk) {
      S.walkerAt(h, h.n - 1, t, W);
      if (W.d > .5 && W.d < h.path.L - 2) { stop.id = h.id; stop.s = 0; stop.d = W.d; stop.x = W.x; stop.y = W.y; stop.hd = W.hd; stop.done = false; }
    }
  }
  function playerStep(dt) {
    near = null; const t = now();
    let bd = 1e9;
    for (const h of CUR) {
      if (t < h.t0) continue;
      const T = HAPPENINGS[h.kind], d = Math.hypot(h.x - P.x, h.y - P.y);
      if (h.kind === 'star' && t < h.t1 && !took(h.id) && d < T.reach && d < bd) { bd = d; near = {kind: 'shard', h, x: h.x, y: h.y, label: 'E take the star shard'}; }
      else if (h.kind === 'ring' && t >= h.n0 && t < h.n1 && d < T.reach && !took(h.id)) {
        mark(h.id); buff = T.buff.s; dream = 1;
        host.mods.set('happenings', [{stat: 'player.speed', mul: T.buff.speed}]);
        host.events.push({type: 'happening.take', kind: 'ring', x: h.x, y: h.y, item: null, buff: 'light-footed'});
        ui()?.toast('Light-footed', 'the ring\'s dance is in your feet (2 min)', T.col);
      } else if (h.kind === 'vattar') vattarStep(h, dt);
      else if (h.kind === 'rainbow' && t < h.t1 && d < T.reach && !took(h.id)) { give(h, T.reward, h.x, h.y, 'the colours pooled round your feet, and there it was'); pool(h.x, h.y); }
    }
    for (const g of gifts) { const d = Math.hypot(g.x - P.x, g.y - P.y); if (d < 1.4 && d < bd) { bd = d; near = {kind: 'gift', g, x: g.x, y: g.y, label: `E take the ${ITEMS[g.item]?.name || g.item}`}; } }
    if (stop.id && !CUR.some(h => h.id === stop.id)) stop.id = '';
  }

  // ---------------------------------------------------------------- the dev menu / URL: one now
  function startNow(kind, soon = .04) {
    const h = S.force(kind, now() + soon, {x: P.x, y: P.y});
    if (!h) { ui()?.toast('Happenings', 'no room for one here: try in the woods', '#e8a070'); return null; }
    acc = 1; return h;
  }
  function goCurrent() {
    const t = now(); let b = null;
    for (const h of CUR) if (t >= h.t0 && t < h.t1 && (!b || h.t0 > b.t0)) b = h;
    if (!b) for (const h of CUR) if (t >= h.t0 && (!b || h.t0 > b.t0)) b = h;
    if (!b) { const L = S.day(Math.floor(t / 24)).filter(h => h.t0 > t); b = L[0] || null; }
    if (!b) { ui()?.toast('Happenings', 'nothing today', '#e8a070'); return; }
    let x = b.x, y = b.y;
    if (b.kind === 'vattar') { S.walkerAt(b, 0, Math.max(t, b.t0), W); x = W.x; y = W.y; }
    host.teleport(x + 2.6, y + 2.6);
  }
  const hhmm = h => { const m = Math.round((((h % 24) + 24) % 24) * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
  F.today = () => {
    const t = now(), D = Math.floor(t / 24), out = [];
    for (const h of [...S.day(D - 1), ...S.day(D), ...S.forced]) {
      if (h.tEnd < t && h.day !== D) continue;
      out.push({id: h.id, kind: h.kind, name: HAPPENINGS[h.kind].name, x: h.x, y: h.y, at: hhmm(h.t0), t0: h.t0, t1: h.t1,
        state: t < h.t0 ? 'soon' : t < h.t1 ? 'now' : 'over', taken: took(h.id), forced: !!h.forced});
    }
    return out;
  };
  const line = e => `${e.at} ${e.name} (${e.state}${e.taken ? ', yours taken' : ''}) at ${Math.round(e.x)}, ${Math.round(e.y)}`;
  function devRows() {
    if (!active()) return [{label: 'Happenings', text: () => 'only in the forest (sandbox)'}];
    const L = F.today();
    return [{label: 'Today', text: () => L.length ? `${L.length}` : 'nothing'}, ...L.map((e, i) => ({label: `${i + 1}.`, text: () => line(e)}))];
  }
  F.menu = () => active() ? [
    {label: 'Happenings: a falling star now, near me', run: () => startNow('star', .008)},
    {label: 'Happenings: a fairy ring now, near me (its lights dance at once)', run: () => startNow('ring', 0)},
    {label: 'Happenings: the vättar walk now, near me', run: () => startNow('vattar', .01)},
    {label: 'Happenings: a rainbow now, near me', run: () => startNow('rainbow', 0)},
    {label: 'Happenings: go to the current one (or the next today)', run: goCurrent},
    {label: 'Happenings: what\'s on today (toast)', run: () => { const L = F.today(); ui()?.toast('Happenings today', L.length ? L.map(line).join(' · ') : 'nothing today', '#d8e0f0'); }},
    {label: 'Happenings: forget what I took (offline)', run: () => { const st = store(); if (st) { st.taken = {}; pack().dirty(); ver++; } }},
  ] : [];

  // ---------------------------------------------------------------- the journal (the tabbed GUI's, when there is one)
  const esc0 = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
  function journal(esc = esc0) {
    const L = F.today(), you = Object.keys(found);
    let s = '<div class="hp-list">';
    s += L.length ? L.map(e => `<div>${esc(e.at)} &middot; ${esc(e.name)} &middot; ${esc(e.state)}${e.taken ? ' &middot; taken' : ''}</div>`).join('') : '<div>Nothing yet today. Keep an eye on the sky.</div>';
    if (you.length) s += `<div>Found this session: ${you.map(k => esc(ITEMS[k]?.name || k) + (found[k] > 1 ? ' x' + found[k] : '')).join(', ')}</div>`;
    return s + '</div>';
  }
  function registerPart() {
    const Pn = host.feature('panels');
    Pn?.part?.({id: 'happenings', tab: 'journal', order: 50, title: 'Happenings', ver: () => ver + Math.floor(now() * 4), html: (esc) => journal(esc), click: () => {}});
  }

  // ---------------------------------------------------------------- the look: particles (pools), pictures, the dream
  const NP = 220, pX = new Float32Array(NP), pY = new Float32Array(NP), pH = new Float32Array(NP), pVX = new Float32Array(NP), pVY = new Float32Array(NP),
    pVH = new Float32Array(NP), pT = new Float32Array(NP), pL = new Float32Array(NP), pC = new Uint8Array(NP);
  let pn = 0;
  const C = c => host.rgb(c);
  const PAL = [C('#ffffff'), C('#cfe6ff'), C('#8ab8ff'), C('#ffd890'), C('#e8ffb0'), C('#ffb0f0'), C('#b0f0ff'),
    C('#ff6a5a'), C('#ffa850'), C('#ffe070'), C('#80e070'), C('#60b8ff'), C('#8070e0'), C('#c070e0')];   // 7..13: the bands
  const BANDS = [7, 8, 9, 10, 11, 12, 13];
  function spawn(x, y, h, vx, vy, vh, life, c) { if (pn >= NP) return; const i = pn++; pX[i] = x; pY[i] = y; pH[i] = h; pVX[i] = vx; pVY[i] = vy; pVH[i] = vh; pT[i] = 0; pL[i] = life; pC[i] = c; }
  function stepParts(dt) {
    for (let i = 0; i < pn; i++) {
      pT[i] += dt; pX[i] += pVX[i] * dt; pY[i] += pVY[i] * dt; pH[i] += pVH[i] * dt;
      if (pT[i] >= pL[i]) { pn--; pX[i] = pX[pn]; pY[i] = pY[pn]; pH[i] = pH[pn]; pVX[i] = pVX[pn]; pVY[i] = pVY[pn]; pVH[i] = pVH[pn]; pT[i] = pT[pn]; pL[i] = pL[pn]; pC[i] = pC[pn]; i--; }
    }
  }
  // the star's fall (view timers, real s)
  const FALL = {h: null, s: 0, impact: -1, x: 0, y: 0, ang: 0};
  function fall(h) { FALL.h = h; FALL.s = 0; FALL.impact = -1; FALL.x = h.x; FALL.y = h.y; FALL.ang = h.ang || 0; }
  function pool(x, y) { POOL.s = 0; POOL.x = x; POOL.y = y; }
  const POOL = {s: 99, x: 0, y: 0};
  // the dream (the ring): a grade over the mood and a slow sway
  const GR = {k: 0, amb: [1.3, 1, 1.4], sun: [1.1, .95, 1.2], lift: [1.25, 1.05, 1.3], fill: [1.2, 1, 1.3], fog: [.16, .08, .2, .12], glow: 1.8};
  let graded = false, dreamK = 0, dreamT = 0;
  const OFF = {x: 0, y: 0};
  F.camera = () => { if (dreamK <= 0) return null; OFF.x = Math.sin(dreamT * 1.3) * 2.5 * dreamK; OFF.y = Math.sin(dreamT * .9 + 1) * 2 * dreamK; return OFF; };

  // pictures
  let PIC = null;
  function pics() {
    if (PIC) return PIC;
    const shard = paint(7, 9, SHARD, SHARD_P);
    const shrooms = SHROOMS.map(r => paint(5, 5, r, SHROOM_P)), shroomsE = SHROOMS.map(r => paint(5, 5, r, SHROOM_E));
    const vat = VAT.map(r => paint(7, 11, r, VAT_P)), vatE = VAT.map(r => paint(7, 11, r, VAT_E));
    // the rainbow: a half ring of 7 bands, dithered (every other pixel: you see the trees through it), fading at the feet
    const R0 = Math.round(HAPPENINGS.rainbow.r * host.PPM), bw = Math.max(2, Math.round(host.PPM * .16)), RW = R0 + 7 * bw + 2;
    const bow = document.createElement('canvas'); bow.width = RW * 2; bow.height = Math.ceil(RW * host.PPMH / host.PPM) + 2;
    const q = bow.getContext('2d'), cols = ['#ff5a4a', '#ffa040', '#ffe060', '#70d860', '#50b0ff', '#6a60e0', '#c060e0'];
    const sy = host.PPMH / host.PPM;   // (the art's heights are drawn at PPMH a m: the arc stands upright in the world)
    for (let y = 0; y < bow.height; y++) for (let x = 0; x < bow.width; x++) {
      const dx = x + .5 - RW, dy = (bow.height - y - .5) / sy, r = Math.hypot(dx, dy), b = Math.floor((RW - r) / bw);
      if (b < 0 || b > 6) continue;
      const foot = dy / (RW * .35);   // (fades in from the ground up)
      if (((x + y) & 1) && foot > .5) continue;   // the dither: every other pixel, near the ground thinner still
      if (foot < .5 && ((x + y) % 3 !== 0)) continue;
      q.fillStyle = cols[6 - b]; q.fillRect(x, y, 1, 1);
    }
    const gifts = new Map();
    PIC = {shard, shrooms, shroomsE, vat, vatE, bow, RW, gifts, Rmid: R0 + 3.5 * bw};
    return PIC;
  }
  const giftPic = id => { const G = pics().gifts; let c = G.get(id); if (!c) { const d = ITEMS[id]; c = iconCanvas(d?.icon || ['a'], d?.pal); G.set(id, c); } return c; };

  // ---------------------------------------------------------------- the crater: scorch dots, seeded per star (made once)
  const CRATER = new Map();
  function craterOf(h) {
    let c = CRATER.get(h.id); if (c) return c;
    const n = 70, d = new Float32Array(n * 3); let s = h.seed | 0;
    const r = () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    for (let i = 0; i < n; i++) { const a = r() * TAU, k = i < 46 ? Math.sqrt(r()) * 1.15 : 1.15 + r() * .35; d[i * 3] = Math.cos(a) * k; d[i * 3 + 1] = Math.sin(a) * k; d[i * 3 + 2] = i < 46 ? (r() * 3) | 0 : 3 + ((r() * 2) | 0); }
    if (CRATER.size > 6) CRATER.delete(CRATER.keys().next().value);
    CRATER.set(h.id, c = d); return c;
  }
  const SCORCH = [C('#120d0a'), C('#1e1712'), C('#2c231b'), C('#6a5a44'), C('#8a7658')];

  // ---------------------------------------------------------------- update / view / frame
  Object.assign(F, {
    update(dt) {
      if (first) {
        first = false;
        registerPart();
      }
      if (!active()) { near = null; return; }
      if (FORCE && !forcedOnce && pack()) { forcedOnce = true; startNow(FORCE, FORCE === 'star' ? .1 : 0); }
      if ((acc += dt) >= .25) { acc = 0; clock(); }
      playerStep(dt);
      if (want) { const w = want; want = null; if (w.kind === 'shard' && !took(w.h.id)) give(w.h, HAPPENINGS.star.reward, w.x, w.y, 'still warm, and it hums when you hold it to your ear');
        else if (w.kind === 'gift') { const i = gifts.indexOf(w.g); if (i >= 0) { gifts.splice(i, 1); pack()?.give(w.g.item, 1, {x: w.g.x, y: w.g.y, h: .5}); found[w.g.item] = (found[w.g.item] || 0) + 1; ver++; ui()?.toast(ITEMS[w.g.item]?.name || w.g.item, 'a gift from the vättar. The little one bowed, and went on to the water', HAPPENINGS.vattar.col); } } }
      if (buff > 0 && (buff -= dt) <= 0) { buff = 0; host.mods.clear('happenings'); ui()?.toast('Light-footed', 'the dance has gone out of your feet', '#c8c0b0'); }
      for (let i = gifts.length - 1; i >= 0; i--) if ((gifts[i].t += dt) > 600) gifts.splice(i, 1);
    },
    view(dt) {
      stepParts(dt);
      const t = now();
      if (flash > 0) flash = Math.max(0, flash - dt / 1.2);
      if (FALL.h) { FALL.s += dt; const fs = HAPPENINGS.star.fall; if (FALL.impact < 0 && FALL.s >= fs) { FALL.impact = 0; impact(); } if (FALL.impact >= 0) FALL.impact += dt; if (FALL.s > fs + 3) FALL.h = null; }
      POOL.s += dt;
      // the dream eases in and out over a few s
      if (dream > 0) { dream = Math.max(0, dream - dt / 6); }
      dreamK = smooth(Math.min(1, dream * 3)) * (dream > 0 ? 1 : 0); dreamT += dt;
      if (dreamK > 0) { GR.k = dreamK * (.7 + .3 * Math.sin(dreamT * 2.3)); if (!graded && env.setGrade) { env.setGrade('happenings', GR); graded = true; } }
      else if (graded) { env.clearGrade?.('happenings'); graded = false; }
      if (!active()) return;
      // sparks over a lying star, motes over a ring at night, the light-footed trail, the vättar's lanterns' glints, the rainbow's foot
      for (const h of CUR) {
        if (t < h.t0 || Math.abs(h.x - P.x) > 40 || Math.abs(h.y - P.y) > 40) continue;
        const g = host.elev(h.x, h.y);
        if (h.kind === 'star' && t < h.t1 && (!FALL.h || FALL.h !== h || FALL.impact >= 0)) {
          if (V() < dt * 9) spawn(h.x + vr(-.4, .4), h.y + vr(-.4, .4), g + .15, vr(-.15, .15), vr(-.15, .15), vr(.6, 1.4), vr(.8, 1.8), V() < .6 ? 1 : 3);
        } else if (h.kind === 'rainbow' && t < h.t1 && !took(h.id)) {
          if (V() < dt * 26) { const a = V() * TAU, r = vr(0, .5); spawn(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, g + .05, 0, 0, vr(1.2, 2.6), vr(.9, 1.7), BANDS[(V() * 7) | 0]); }
        }
      }
      if (buff > 0 && Math.hypot(P.vx || 0, P.vy || 0) > .5 && V() < dt * 20) spawn(P.x + vr(-.2, .2), P.y + vr(-.2, .2), (P.z || 0) + vr(.05, .4), vr(-.1, .1), vr(-.1, .1), vr(.1, .4), vr(.7, 1.3), V() < .5 ? 4 : 6);
      if (dreamK > 0 && V() < dt * 40) { const a = V() * TAU; spawn(P.x + Math.cos(a) * 1.2, P.y + Math.sin(a) * 1.2, (P.z || 0) + vr(.2, 1.6), -Math.sin(a) * 1.5, Math.cos(a) * 1.5, vr(-.1, .3), vr(.8, 1.4), V() < .5 ? 5 : 4); }
      if (POOL.s < 4 && V() < dt * 60) { const a = V() * TAU, r = Math.min(2.4, POOL.s * 1.2) * Math.sqrt(V()); spawn(POOL.x + Math.cos(a) * r, POOL.y + Math.sin(a) * r, host.elev(POOL.x, POOL.y) + .04, 0, 0, vr(0, .25), vr(.6, 1.2), BANDS[Math.min(6, Math.floor(r / 2.4 * 7))]); }
    },
    frame() {
      if (!active() || !pics()) return;
      const t = now(), G = host.G, PI = pics(), T0 = performance.now() / 1000;
      // the falling star's streak (from high up, its tail behind it)
      if (FALL.h && FALL.impact < 0) {
        const k = clamp(FALL.s / HAPPENINGS.star.fall, 0, 1), e = k * k, sx = FALL.x + Math.cos(FALL.ang) * 34, sy = FALL.y + Math.sin(FALL.ang) * 34, g = host.elev(FALL.x, FALL.y);
        const hx = sx + (FALL.x - sx) * e, hy = sy + (FALL.y - sy) * e, hh = 44 + (g - 44) * e;
        for (let j = 1; j <= 12; j++) {
          const e2 = Math.max(0, e - j * .022), x2 = sx + (FALL.x - sx) * e2, y2 = sy + (FALL.y - sy) * e2, h2 = 44 + (g - 44) * e2;
          const e1 = Math.max(0, e - (j - 1) * .022), x1 = sx + (FALL.x - sx) * e1, y1 = sy + (FALL.y - sy) * e1, h1 = 44 + (g - 44) * e1;
          host.line(x1, y1, h1, x2, y2, h2, PAL[j < 3 ? 0 : j < 7 ? 1 : 2], true);
        }
        host.point(hx, hy, hh, PAL[0], E3);
        if (G.fx) G.fx(hx, hh, hy, 1.4, GLOW_B, .9, 'add');
      }
      for (const h of CUR) {
        if (t < h.t0 || Math.abs(h.x - P.x) > 46 || Math.abs(h.y - P.y) > 46) continue;
        const g = host.elev(h.x, h.y);
        if (h.kind === 'star' && !(FALL.h === h && FALL.impact < 0)) {
          const glow = t < h.t1, d = craterOf(h);
          for (let i = 0; i < 70; i++) host.point(h.x + d[i * 3], h.y + d[i * 3 + 1], host.elev(h.x + d[i * 3], h.y + d[i * 3 + 1]) + .02, SCORCH[d[i * 3 + 2]], P2);
          if (glow) {
            const pulse = .5 + .5 * Math.sin(T0 * 2.6 + h.seed);
            if (!took(h.id)) host.sprite({img: PI.shard, em: PI.shard, x: h.x, y: h.y, h: g + .02, px: 3, py: 8, flash: .25 + .45 * pulse});
            if (G.fx) { G.fx(h.x, g + .3, h.y, 1.1 + .4 * pulse, GLOW_B, took(h.id) ? .25 : .55 + .3 * pulse, 'add'); if (V() < .25) G.fx(h.x + vr(-.3, .3), g + vr(.6, 2), h.y + vr(-.3, .3), vr(.4, .8), SMOKE, .18, 'blend'); }
          } else if (G.fx && t < h.t1 + .6 && V() < .1) G.fx(h.x, g + vr(.3, 1.4), h.y, .6, SMOKE, .12, 'blend');   // (smoke a while after dawn)
        } else if (h.kind === 'ring') {
          const T = HAPPENINGS.ring, night = t >= h.n0 && t < h.n1;
          for (let i = 0; i < h.count; i++) {
            const a = i / h.count * TAU + hash3(h.seed, i, 1) * .3, r = T.r * (.92 + hash3(h.seed, i, 2) * .16), x = h.x + Math.cos(a) * r, y = h.y + Math.sin(a) * r, v = (hash3(h.seed, i, 3) * 3) | 0;
            host.sprite({img: PI.shrooms[v], em: night ? PI.shroomsE[v] : null, x, y, h: host.elev(x, y), px: 2, py: 5});
          }
          if (night) for (let i = 0; i < 9; i++) {
            const a = T0 * (.7 + (i % 3) * .15) + i / 9 * TAU, r = T.r * (.55 + .35 * Math.sin(T0 * .9 + i * 1.7)), hh = g + .5 + .4 * Math.sin(T0 * 1.7 + i * 2.1) + .2 * Math.sin(T0 * 5 + i);
            host.point(h.x + Math.cos(a) * r, h.y + Math.sin(a) * r, hh, PAL[i % 2 ? 4 : 3], E2);
            if (G.fx && i % 3 === 0) G.fx(h.x + Math.cos(a) * r, hh, h.y + Math.sin(a) * r, .35, GLOW_G, .35, 'add');
          }
        } else if (h.kind === 'vattar' && t < h.t1) {
          const L = h.path.L;
          for (let i = 0; i < h.n; i++) {
            const stopped = stop.id === h.id && i === h.n - 1;
            if (stopped && stop.s < 3.4) { W.x = stop.x; W.y = stop.y; W.d = stop.d; W.hd = stop.hd; } else S.walkerAt(h, i, t - (stop.id === h.id && i === h.n - 1 ? 3.4 / secPerH() : 0), W);
            if (W.d <= 0 || W.d >= L) continue;
            const inK = clamp(W.d / .8, 0, 1), outK = clamp((L - W.d) / 1.4, 0, 1), sink = (1 - outK) * .35;
            const turned = stopped && stop.s < 3.4, fr = turned ? 2 : ((T0 * 2.6 + i * .37) | 0) & 1;
            const sxv = G.toScreenInto(W.x + Math.cos(W.hd), gh0(W), W.y + Math.sin(W.hd), SA)[0] - G.toScreenInto(W.x, gh0(W), W.y, SB)[0];
            const bob = fr ? .02 : 0, gh = host.elev(W.x, W.y);
            host.sprite({img: PI.vat[fr], em: PI.vatE[fr], x: W.x, y: W.y, h: gh - sink + bob, px: 3, py: 11, flip: turned ? P.x < W.x : sxv < 0, alpha: Math.min(inK, outK, 1), shadow: true});
            if (G.fx && (i === 0 || i === h.n - 1 || i === h.n >> 1)) G.fx(W.x + (sxv < 0 ? -.1 : .1), gh + .2 - sink, W.y, .28, GLOW_L, .5 * Math.min(inK, outK), 'add');
          }
        } else if (h.kind === 'rainbow' && t < h.t1) {
          const k = smooth((t - h.t0) / .25) * (1 - smooth((t - (h.t1 - .35)) / .35));
          // the arc: a camera-facing card standing on its foot (the foot at the left or right end, the arc over the trees)
          host.sprite({img: PI.bow, em: PI.bow, x: h.x, y: h.y, h: g - .1, px: h.side > 0 ? PI.RW - PI.Rmid : PI.RW + PI.Rmid, py: PI.bow.height, alpha: .55 * k});
          if (!took(h.id) && G.fx) for (let j = 0; j < 7; j++) G.fx(h.x, g + .4 + j * .55, h.y, .55, BANDF[j], .32 * k, 'add');
        }
      }
      for (const gf of gifts) host.sprite({img: giftPic(gf.item), x: gf.x, y: gf.y, h: host.elev(gf.x, gf.y), px: 7, py: 13});
      // the impact's ring of light
      if (FALL.h && FALL.impact >= 0 && FALL.impact < .8) {
        const r = FALL.impact * 7, g = host.elev(FALL.x, FALL.y);
        for (let j = 0; j < 40; j++) { const a = j / 40 * TAU; host.point(FALL.x + Math.cos(a) * r, FALL.y + Math.sin(a) * r, g + .05, PAL[j & 1 ? 0 : 1], E2); }
      }
      for (let i = 0; i < pn; i++) host.point(pX[i], pY[i], pH[i], PAL[pC[i]], pT[i] > pL[i] * .7 ? E1 : E2);
    },
    onKey(k) {
      if (k !== 'e' || !active() || host.lock || !near) return false;
      want = near; host.PL?.useE?.(); return true;
    },
    hd(q, sc) {
      if (!active() || host.hudOff || host.playerHidden) return;
      // the star's streak across the sky when it falls out of sight
      if (FALL.h && FALL.impact < 0) {
        const s = host.G.toScreen(FALL.x, host.elev(FALL.x, FALL.y), FALL.y), W2 = q.canvas.width, H2 = q.canvas.height, X = s[0] * sc, Y = s[1] * sc;
        if (X < 0 || Y < 0 || X > W2 || Y > H2) {
          const u = hdUnit(), k = clamp(FALL.s / HAPPENINGS.star.fall, 0, 1), cx = W2 / 2, cy = H2 * .12, dx = X - cx, dy = Y - cy, L = Math.hypot(dx, dy) || 1;
          const hx = cx + dx / L * W2 * .55 * k, hy = cy + dy / L * H2 * .25 * k;
          for (let j = 0; j < 22; j++) { const b = j * 3 * u; q.fillStyle = j < 2 ? '#ffffff' : j < 8 ? '#d8ecff' : '#7a9ad8'; q.globalAlpha = 1 - j / 22; q.fillRect(Math.round((hx - dx / L * b) / u) * u, Math.round((hy - dy / L * b) / u) * u, u * (j < 2 ? 2 : 1), u * (j < 2 ? 2 : 1)); }
          q.globalAlpha = 1;
        }
      }
      if (!near || host.lock || pack()?.open) return;
      const s = host.G.toScreen(near.x, host.elev(near.x, near.y) + .7, near.y);
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, near.label, s[0] * sc, s[1] * sc, hdUnit(), '#f2d27a');
      q.restore();
    },
    test: {   // (the probe: time walked alongside without walking it; a forced one moved to a place to look at it)
      walked(id, s) { walk.set(id, (walk.get(id) || 0) + s); },
      place(id, x, y) { const h = S.forced.find(q => q.id === id); if (h && h.kind !== 'vattar') { h.x = x; h.y = y; } return !!h; },
    },
    hud: () => active() && (CUR.length || buff > 0) ? `happenings: ${CUR.map(h => h.id).join(' ')}${buff > 0 ? ' · light-footed ' + Math.ceil(buff) + 's' : ''}` : '',
    biomeChanged() { graded = false; },
    dbg: () => ({active: active(), t: now(), today: F.today().map(line), cur: CUR.map(h => h.id), near: near?.label || null, buff, gifts: gifts.map(g => g.item), walk: [...walk], stop: stop.id ? {...stop} : null, parts: pn, fall: FALL.h ? {s: +FALL.s.toFixed(2), impact: +FALL.impact.toFixed(2)} : null}),
  });
  let forcedOnce = false;
  // the impact: a flash (a light), a thump (a shake if near), a spray of sparks
  let flash = 0;
  function impact() {
    flash = 1; const g = host.elev(FALL.x, FALL.y), d = Math.hypot(FALL.x - P.x, FALL.y - P.y);
    if (d < 30) host.shake(clamp(4 - d / 8, 1, 4), .35);
    for (let i = 0; i < 40; i++) { const a = V() * TAU, v = vr(1, 4); spawn(FALL.x, FALL.y, g + .2, Math.cos(a) * v, Math.sin(a) * v, vr(1.5, 5), vr(.4, 1.1), V() < .5 ? 0 : 1); }
  }
  // lights: the impact's flash, a lying star's glow, the ring's dance, two of the vättar's lanterns, the rainbow's foot (records reused)
  const LR = Array.from({length: 6}, (_, i) => ({x: 0, y: 0, h: 0, color: '#bcd8ff', radius: 0, intensity: 0, flicker: 0, id: 9940 + i})), LOUT = [];
  F.lights = () => {
    LOUT.length = 0; if (!active()) return LOUT;
    const t = now(), T0 = performance.now() / 1000; let i = 0;
    const put = (x, y, h, color, radius, intensity, flicker) => { if (i >= LR.length) return; const r = LR[i++]; r.x = x; r.y = y; r.h = h; r.color = color; r.radius = radius; r.intensity = intensity; r.flicker = flicker; LOUT.push(r); };
    if (flash > 0) { put(FALL.x, FALL.y, host.elev(FALL.x, FALL.y) + 2, '#e0ecff', 24, 5 * flash * flash, 0); }
    for (const h of CUR) {
      if (t < h.t0 || Math.abs(h.x - P.x) > 40 || Math.abs(h.y - P.y) > 40) continue;
      const g = host.elev(h.x, h.y);
      if (h.kind === 'star' && t < h.t1 && !(FALL.h === h && FALL.impact < 0)) put(h.x, h.y, g + .8, '#a8c8ff', took(h.id) ? 4 : 9, (took(h.id) ? .5 : 1.7) * (.8 + .2 * Math.sin(T0 * 2.6 + h.seed)), .1);
      else if (h.kind === 'ring' && t >= h.n0 && t < h.n1) put(h.x, h.y, g + .9, '#c8ffb0', 5, .8, .3);
      else if (h.kind === 'vattar' && t < h.t1) for (const j of [0, h.n - 1]) { S.walkerAt(h, j, t, W); if (W.d > 0 && W.d < h.path.L) put(W.x, W.y, host.elev(W.x, W.y) + .35, '#ffc070', 3.5, .75, .5); }
      else if (h.kind === 'rainbow' && t < h.t1 && !took(h.id)) put(h.x, h.y, g + 1.2, ['#ff8a70', '#ffe070', '#70e070', '#70b0ff', '#c070ff'][((T0 * 1.5) | 0) % 5], 6, 1.1, 0);
    }
    return LOUT;
  };
  const E1 = {size: 1, emit: true}, E2 = {size: 2, emit: true}, E3 = {size: 3, emit: true}, P2 = {size: 2};
  const GLOW_B = [.55, .7, 1], GLOW_G = [.7, 1, .55], GLOW_L = [1, .75, .35], SMOKE = [.32, .3, .3];
  const BANDF = [[1, .35, .3], [1, .6, .25], [1, .9, .35], [.45, .9, .4], [.35, .7, 1], [.45, .4, .9], [.75, .4, .9]];
  const SA = [0, 0, 0], SB = [0, 0, 0], gh0 = w => host.elev(w.x, w.y);
  return F;
}
