// MEALS (docs/COOKING.md, docs/FORAGING.md, docs/FISHING.md): cooked at a burning campfire and eaten. The pack panel's Cook list
// offers every meal of content/meals.js; one costs its need from the pouch (each part paid with the kind he has most of), needs a
// campfire burning within COOK_R m (features/campfires.js burningNear) and is cooked on a stick over the flames (features/cooking.js:
// pulled raw, done, just right or burnt; ?cook=0: done at once). Eaten, it is a MOOD for its time (content/meals.js notesOf / durOf:
// its mood notes, + its hidden numbers when done or just right, the burnt twist's alone when burnt): notes in host.mods (source
// 'meal'), read by their owners (mine.ring: mining; light.nightEye: lighting; fish.come: fishing; player.*: the player; fauna.loud:
// fauna; prints.glow: this file's view, stamped into features/prints.js ...). One meal at a time: a new one replaces it. Its time left is saved (pack.store('meals')) and counts
// down in the sim; the chip at the bottom left (HD, the pixel UI) shows the meal and its time while the pack's panel is shut.
// FOUND RECIPES: the Cook list shows only the dishes he knows (store().known: Fish on a stick in a new world); the rest are found on
// the TRY STICK (the Cook journal section: up to 3 kinds of food, 6 in all, over the fire: what covers a dish's need with nothing
// over is that dish, learned; anything else is something odd, 30 s of hiccups) or by eating from a friend's pot. THE SHARED POT:
// the Cook list's first row switches to a pot for four (need x2, the slow game on a fire with no pot; features/builds.js keeps it,
// E by the fire takes a spoon: features/campfires.js). The COOK JOURNAL
// (pack.section 'cook') shows every dish: found ones with how often cooked and marks for just right and burnt, the rest as dark
// shapes with their hint (content/meals.js).
// A meal with trip: true (the fly agaric broth) is drunk, not eaten: features/trip.js starts (the meal eaten stays; burnt: the still).
// ?moods=0: today's numbers (the old notes, dur and Cook words), cooked at once.
// FRIENDS (features/coop.js): the meal's CODE (content/meals.js codeOf: 'smoked_eel!') goes out with his state ('md'); every client
// draws what shows of everyone's mood (this file's view: burnt eel's eye shine, a smoked-out trail, the pike's heavy dust, the glowing
// prints (stamped into features/prints.js on a surface of this file's, LOOK.glow); the fish at a friend's legs are features/fishing.js's).
// Only in the persistent world (the sandbox's ruins biome). The meals were fishing's until the foraging slice (2026-10-15):
// a world saved before that has its meal under pack.store('fishing').meal; it is taken from there once.
// OWNS: the meal eaten, its quality and time, its saved part (meal, known, log), the Try stick's picks, the hiccups, the Cook journal, the modifier source 'meal', the recipe group Cook, the chip, the mood
//   puffs (view: dust, smoke), eye shine and the prints' surface 'blueberry'.
// READS: content/meals.js, content/items.js (names), pack (the pouch, the store, close), campfires (burningNear), cooking (start),
//   trip (start), coop (the peers' codes), host.mods ('prints.glow'), prints (surface, stamp), host.inStream, wading (wet).
// EMITS: meal.cook, meal.hic. API: F.id (the meal eaten, '' none), F.q (its quality), F.code (what friends are told), F.eyes (burnt eel: his
//   eyes shine; the soot things take them for a lantern: features/cavelife.js, coop's lt), F.left (s), F.ver() (changes as the
//   panel's words would), F.note(esc) -> the panel's line about it ('' none), F.eat(id, q?, t?) (cooking, tests, dev),
//   F.moods (on), F.cooked(id, q) (off the stick: learned, written in the journal, eaten), F.potDone(id, q) (a pot he cooked: the
//   journal), F.spoon(id, q) (a spoon from any pot: learned, eaten: features/builds.js), F.odd() (hiccups), F.hicN
//   (hiccups so far: view/livehero.js hops), F.knows(id).
// BUDGET: sim: a compare a step (a save every 5 s while one lasts); view: a pooled puff or two a step while a mood shows (<= 160
//   points), two points a shining pair of eyes; HD: one frame and a line of pixel text while one lasts.
import {MEALS, notesOf, durOf, nameOf, codeOf, parseCode, smokedOf, KNOWN, TRY, FOODS, matchOf} from '../content/meals.js';
import {COMMON_FISH} from '../content/fishing.js';
import {ITEMS} from '../content/items.js';
import {flags} from '../core/flags.js';
import {hdUnit, hdFont, hdFrame, hdText} from '../ui/hdpixel.js';
import {iconURL} from '../ui/packpanel.js';
import {mulberry32, simSeed} from '../core/rng.js';
import {POT} from '../content/builds.js';

const ON = flags.get('pack') !== '0';
const MOODS = flags.get('moods') !== '0';
const LEN = (v => v > 0 ? v : 1)(parseFloat(flags.get('moodlen')));   // a factor on every mood's length
const COOK_R = 2.5;   // m from a burning campfire to cook
// the moods' looks: the eye shine (m: up, apart, ahead of his middle), the smoke trail (s between puffs, life, rise m/s), the pike's dust
// the blueberry soup's prints: a surface of features/prints.js (col, life s, emit: they glow, fade: the last half fades out), a foot
// off the line (side m), a friend's every stride m
const LOOK = {eyes: {h: 1.52, apart: .05, fwd: .12, col: '#7cff9a'}, smoke: {every: .14, life: 2.6, rise: .35, col: '#8e8a84'}, dust: {n: 7, col: ['#9a8a6a', '#7a6c52']}, max: 160,
  glow: {surf: 'blueberry', def: {col: '#b070ff', life: 60, emit: true, fade: .5}, side: .09, stride: .72}};

// ORDER (core/features.js): after the pack (its store); the Cook recipes go to it before fishing's Bait (the panel's group order)
export const order = {after: ['pack'], before: ['fishing']};

export async function create(host) {
  const game = () => host.feature('game'), ui = () => game()?.ui || null, pack = () => host.feature('pack');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const store = () => pack()?.store('meals') || null;
  const cooking = () => MOODS ? host.feature('cooking') : null;
  let id = '', q = 'done', left = 0, saveT = 0, offered = false, restored = false, code = '';

  function eat(m, t, qq = 'done') {
    id = m; q = qq; left = t; code = MOODS ? codeOf(m, qq) : m; host.mods.set('meal', notesOf(m, qq, MOODS));
    const s = store(); if (s) { s.meal = {id: m, t: Math.round(t), q: qq}; pack()?.dirty(); }
  }
  function unEat() {
    id = ''; q = 'done'; left = 0; code = ''; host.mods.clear('meal');
    const s = store(); if (s?.meal) { delete s.meal; pack()?.dirty(); }
  }
  const costOf = need => pack()?.payOf(need) || {};
  const short = o => pack()?.short(o) ?? true;
  const kinds = ids => ids === COMMON_FISH ? 'small fish' : ids.length > 4 ? 'fish' : ids.map(i => ITEMS[i]?.name || i).join(' or ');
  const needWords = need => need.map(q => `${q.n} ${kinds(q.ids)}`).join(' + ');
  const fireNear = () => { const P = host.player; return !!host.feature('campfires')?.burningNear?.(P.x, P.y, COOK_R); };
  // a meal eaten (or drunk) at a quality: its mood starts, a soft chime and its name float up (no words about what it does)
  function serve(m, qq) {
    const M = MEALS[m], P = host.player;
    host.events.push({type: 'meal.cook', x: P.x, y: P.y, id: m, q: qq});
    if (M.trip) {   // (a trip: the meal eaten stays)
      const s = durOf(m, qq, MOODS, LEN);
      host.feature('trip')?.start(s, qq === 'burnt' ? {still: true} : undefined);
      if (MOODS) ui()?.float(P.x, P.y, P.z + 2.1, nameOf(m, qq), qq === 'burnt' ? '#a8b0b8' : '#ffb060');
      return;
    }
    const had = id; eat(m, durOf(m, qq, MOODS, LEN), qq);
    if (MOODS) ui()?.float(P.x, P.y, P.z + 2.1, nameOf(m, qq) + (qq === 'right' ? '!' : ''), qq === 'burnt' ? '#a8b0b8' : qq === 'raw' ? '#d8c890' : '#ffb060');
    else ui()?.toast(M.name, M.say + (had && had !== m ? ` (instead of the ${MEALS[had].name.toLowerCase()})` : ''), '#ffb060');
  }
  // THE SHARED POT (content/builds.js POT): the Cook list's first row switches the dishes between the stick and a pot for four (the
  // need x POT.mul, the slow game: features/cooking.js), on a burning fire within COOK_R m that has no pot on it
  let potMode = false;
  const builds = () => host.feature('builds');
  const potFire = () => { const P = host.player, b = host.feature('campfires')?.burningAt?.(P.x, P.y, COOK_R); return b && !builds()?.hasPot?.(b) ? b : null; };
  const RECIPES = [{id: 'meal.pot', group: 'Cook', shown: () => MOODS && !!cooking()?.game,
    get name() { return potMode ? 'In a pot for four (click: on a stick)' : 'On a stick (click: in a pot for four)'; },
    desc: `A pot takes twice the food and longer over the fire, then gives ${POT.spoons} spoons: one each, E by the fire.`,
    can: () => '', run() { potMode = !potMode; }}];
  for (const m in MEALS) {
    const M = MEALS[m], NEED2 = M.need.map(q => ({ids: q.ids, n: q.n * POT.mul}));
    const need = () => potMode && MOODS && cooking()?.game ? NEED2 : M.need;
    RECIPES.push({id: 'meal.' + m, get name() { return potMode && MOODS && cooking()?.game ? M.name + ', a pot' : M.name; }, group: 'Cook', shown: () => knows(m),
      get cost() { return costOf(need()); },
      desc: MOODS ? `${M.words}. Needs ${needWords(M.need)}, cooked over a burning campfire.`
        : `${M.say}${M.trip ? '' : `, for ${Math.round(M.dur / 60)} min`}. Needs ${needWords(M.need)}, cooked by a burning campfire.`,
      can() {
        if (!active()) return 'only in the open world';
        if (M.trip && !host.feature('trip')?.on) return 'not now';
        if (cooking()?.busy) return 'something is on the stick';
        if (short(costOf(need()))) return `needs ${needWords(need())}`;
        if (need() === NEED2) return potFire() ? '' : fireNear() ? 'a pot is on that fire' : 'by a burning campfire';
        return fireNear() ? '' : 'cook it by a burning campfire';
      },
      run() {
        const c = costOf(need()); if (short(c)) return;
        const ck = cooking();
        if (need() === NEED2) { const b = potFire(); if (b && ck.start(m, {pot: b, cost: c})) { for (const k in c) pack().take(k, c[k]); pack()?.close?.(); } return; }   // THE POT
        if (ck?.game) { if (ck.start(m)) { for (const k in c) pack().take(k, c[k]); pack()?.close?.(); } return; }   // THE STICK: paid when it goes over the fire
        for (const k in c) pack().take(k, c[k]);
        serve(m, 'done');
      }});
  }
  // ---------------------------------------------------------------- found recipes, the Try stick, the Cook journal
  // what he knows: store().known {id: 1} (a new world, or a save from before: KNOWN and the meal he has); ?moods=0: everything.
  // What he has cooked: store().log {id: {n, b: burnt it once, r: had it just right once}}
  let jV = 0;
  function book() {
    const s = store(); if (!s) return null;
    if (!s.known) { s.known = {}; for (const k of KNOWN) s.known[k] = 1; if (MEALS[s.meal?.id]) s.known[s.meal.id] = 1; pack()?.dirty(); }
    s.log ??= {};
    return s;
  }
  const knows = m => !MOODS || !!book()?.known[m];
  function learn(m) {
    const s = book(); if (!s || s.known[m]) return;
    s.known[m] = 1; jV++; pack()?.dirty();
    ui()?.toast('A new dish', MEALS[m].name, '#ffb060');
  }
  // a dish off the stick: learned if new, written in the journal, eaten
  function cooked(m, qq) {
    const s = book();
    if (s) { learn(m); const L = s.log[m] ??= {n: 0}; L.n++; if (qq === 'burnt') L.b = 1; if (qq === 'right') L.r = 1; jV++; pack()?.dirty(); }
    serve(m, qq);
  }
  // a pot he cooked (written in the journal; eaten by the spoon like everyone's), a spoon from any pot (learned, eaten)
  function potDone(m, qq) {
    const s = book(); if (!s) return;
    learn(m); const L = s.log[m] ??= {n: 0}; L.n++; if (qq === 'burnt') L.b = 1; if (qq === 'right') L.r = 1; jV++; pack()?.dirty();
  }
  function spoon(m, qq) { if (!MEALS[m]) return; if (MOODS) learn(m); serve(m, QS.includes(qq) ? qq : 'done'); }
  const QS = ['raw', 'done', 'right', 'burnt'];
  // THE TRY STICK: picks (the panel's clicks, carried out in the sim step) of up to TRY.kinds kinds, TRY.items in all
  const PICK = {};
  const pickKinds = () => { let k = 0; for (const i in PICK) k++; return k; };
  const pickItems = () => { let n = 0; for (const i in PICK) n += PICK[i]; return n; };
  const have = i => pack()?.count(i) || 0;
  function pickAdd(i) {
    if (!FOODS.includes(i) || have(i) <= (PICK[i] || 0) || pickItems() >= TRY.items || (!PICK[i] && pickKinds() >= TRY.kinds)) return;
    PICK[i] = (PICK[i] || 0) + 1; jV++;
  }
  function pickDel(i) { if (PICK[i] > 0) { if (!--PICK[i]) delete PICK[i]; jV++; } }
  function pickClear() { for (const i in PICK) delete PICK[i]; jV++; }
  const TRY_R = {name: 'Try it',
    can() {
      if (!active()) return 'only in the open world';
      if (!pickItems()) return 'put some food on the stick first';
      if (cooking()?.busy) return 'something is on the stick';
      for (const i in PICK) if (have(i) < PICK[i]) return 'you don\'t have that much';
      return !cooking()?.game || fireNear() ? '' : 'try it by a burning campfire';
    },
    // what covers a dish's need with nothing over is that dish (all of it paid); anything else is something odd (one of each kind)
    run() {
      const m = matchOf(PICK), ck = cooking(), cost = {}; let first = '';
      for (const i in PICK) { cost[i] = m ? PICK[i] : 1; first ||= i; }
      if (ck?.game && !ck.start(m, m ? undefined : {odd: true, col: ITEMS[first]?.col})) return;
      for (const k in cost) pack().take(k, cost[k]);
      pickClear(); pack()?.close?.();
      if (!ck?.game) { if (m) cooked(m, 'done'); else odd(); }
    }};
  // something odd eaten: TRY.hic s of hiccups (a hop: view/livehero.js reads F.hicN; a sound: meal.hic); the meal he has stays
  let hic = 0, hicT = 0, hicN = 0, hrng = null;
  const HR = () => (hrng ??= mulberry32(simSeed()))();
  function odd() { const P = host.player; hic = TRY.hic; hicT = .8; ui()?.float(P.x, P.y, P.z + 2.1, 'Something odd', '#c8c0a0'); }
  // THE COOK JOURNAL (pack.section): every dish, found ones with how often cooked and a mark for just right (gold) and burnt
  // (black); the rest as dark shapes with their hint. Then the Try stick: the food he has, what's on the stick, the button
  const SHAPE = {fish_stick: 'stick', fish_lingon: 'stick', fish_soup: 'bowl', pike_stew: 'bowl', blueberry_soup: 'bowl', fly_broth: 'bowl',
    trout_bark: 'plank', smoked_eel: 'plank', salmon_plank: 'plank', fried_chanterelles: 'pan'};
  const SHAPES = {
    stick: ['............', '..........w.', '.........w..', '.....fff....', '...ffdfff...', '..fffffdf...', '...fffff....', '....fw......', '...w........', '..w.........', '.w..........'],
    bowl: ['............', '............', '............', '............', '..ffffffff..', '.rffdfffdfr.', '.wwwwwwwwww.', '..wwwwwwww..', '...wwwwww...', '....wwww....'],
    plank: ['............', '............', '............', '............', '....ffff....', '..ffdffdff..', '.ffffffffff.', '..ffdffdff..', 'wwwwwwwwwwww', 'rrrrrrrrrrrr'],
    pan: ['............', '............', '............', '............', '..f.fdf.f...', '.rffdffffr..', '.rrrrrrrrrww', '..rrrrrrr...']};
  const DICON = {};   // a dish's icon (+ '?': its dark shape), made once
  const shade = (c, k) => { const v = parseInt(c.slice(1), 16), m = sh => Math.round(((v >> sh) & 255) * k); return '#' + ((1 << 24) | (m(16) << 16) | (m(8) << 8) | m(0)).toString(16).slice(1); };
  function dishIcon(m, dark) {
    const key = dark ? m + '?' : m; if (DICON[key]) return DICON[key];
    const c = MEALS[m].col || '#d8c0a0', pal = dark ? {f: '#6a5d4e', d: '#6a5d4e', w: '#6a5d4e', r: '#6a5d4e'} : {f: c, d: shade(c, .7), w: '#6a4a2e', r: '#8e6a44'};
    return DICON[key] = iconURL(SHAPES[SHAPE[m] || 'bowl'], pal);
  }
  const MARK = (col, x) => `<i style="position:absolute;top:3px;left:${x}px;width:4px;height:4px;background:${col};box-shadow:0 0 0 1px #000"></i>`;
  const JOURNAL = {id: 'cook', title: 'Cook journal',
    ver: () => jV,
    html(esc, icon) {
      const s = book(); if (!s) return '';
      let h = '<div class="p-bag p-grid7">', got = 0, all = 0;
      for (const m in MEALS) {
        const M = MEALS[m], L = s.log[m], n = L?.n || 0; all++;
        if (!s.known[m]) { h += `<div class="p-slot p-dim" title="???: ${esc(M.hint)}"><img src="${dishIcon(m, true)}" alt=""></div>`; continue; }
        got++;
        h += `<div class="p-slot" title="${esc(M.name)}: ${esc(M.words)}. ${n ? `Cooked ${n} time${n > 1 ? 's' : ''}` : 'Not cooked yet'}${L?.r ? ', had it just right' : ''}${L?.b ? ', burnt it' : ''}.">`;
        h += `<img src="${dishIcon(m)}" alt="">${L?.r ? MARK('#ffd860', 3) : ''}${L?.b ? MARK('#1a1410', L?.r ? 9 : 3) : ''}${n > 1 ? `<em>${n > 99 ? '99+' : n}</em>` : ''}</div>`;
      }
      h += `</div><div class="p-note">${got} / ${all} dishes found</div><div class="p-note">Try something on a stick:</div><div class="p-bag p-grid7">`;
      let any = false;
      for (const i of FOODS) {
        const n = have(i) - (PICK[i] || 0); if (have(i) <= 0) continue; any = true;
        h += `<div class="p-slot${n > 0 ? '' : ' p-dim'}" data-sec="cook" data-a="add" data-id="${i}" title="${esc(ITEMS[i]?.name || i)}: put one on" style="cursor:pointer"><img src="${icon(i)}" alt="">${n > 1 ? `<em>${n}</em>` : ''}</div>`;
      }
      h += '</div>';
      if (!any) h += '<div class="p-none">no food to try</div>';
      if (pickItems()) {
        h += '<div class="p-bag p-grid7">';
        for (const i in PICK) h += `<div class="p-slot held" data-sec="cook" data-a="del" data-id="${i}" title="${esc(ITEMS[i]?.name || i)}: take one off" style="cursor:pointer"><img src="${icon(i)}" alt="">${PICK[i] > 1 ? `<em>${PICK[i]}</em>` : ''}</div>`;
        const why = TRY_R.can();
        h += `</div><button class="p-build${why ? ' no' : ''}" data-sec="cook" data-a="try"${why ? ` title="${esc(why)}"` : ''}><span>Try it over the fire</span><small>${pickItems()} on the stick</small></button>`;
      }
      return h;
    },
    click(d, ask) {
      if (d.a === 'try') ask(TRY_R);
      else if (d.a === 'add') ask({name: 'Try', run: () => pickAdd(d.id)});
      else if (d.a === 'del') ask({name: 'Try', run: () => pickDel(d.id)});
    }};

  // the meal saved: this feature's store, else (a world saved before meals had their own) fishing's, moved here
  function restore() {
    let m = store()?.meal;
    const old = pack()?.store('fishing');
    if (!m && old?.meal) { m = old.meal; delete old.meal; pack()?.dirty(); }
    if (m && MEALS[m.id] && m.t > 0) eat(m.id, m.t, MOODS && (m.q === 'raw' || m.q === 'right' || m.q === 'burnt') ? m.q : 'done');
  }

  // ---------------------------------------------------------------- the view: what shows of a mood (his and his friends')
  // a pool of puffs (dust off a heavy step, a smoked-out trail), the eyes that shine. PEERS: co-op's peers with their codes
  const PF = []; for (let i = 0; i < LOOK.max; i++) PF.push({x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, t: 0, life: 0, col: '', a: 1, s: 1, on: false});
  let pfN = 0;
  const puff = (x, y, h, vx, vy, vh, life, col, a, s) => {
    let p = null; for (let i = 0; i < LOOK.max; i++) { const c = PF[(pfN + i) % LOOK.max]; if (!c.on) { p = c; pfN = (pfN + i + 1) % LOOK.max; break; } }
    if (!p) { p = PF[pfN]; pfN = (pfN + 1) % LOOK.max; }   // (full: the oldest slot goes)
    p.x = x; p.y = y; p.h = h; p.vx = vx; p.vy = vy; p.vh = vh; p.t = 0; p.life = life; p.col = col; p.a = a; p.s = s; p.on = true;
  };
  const PS = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null}, PC = {id: '', q: 'done'};
  const smokeT = new Map();   // who -> s to the next puff (0: him)
  const peers = () => host.feature('coop')?.net?.peers || null;
  function smokeFrom(key, x, y, z, dt) {
    let t = (smokeT.get(key) ?? 0) - dt;
    if (t <= 0) { t += LOOK.smoke.every; puff(x + (Math.random() - .5) * .2, y + (Math.random() - .5) * .2, z + 1.1 + Math.random() * .3, (Math.random() - .5) * .15, (Math.random() - .5) * .15, LOOK.smoke.rise, LOOK.smoke.life, LOOK.smoke.col, .5, 2); }
    smokeT.set(key, t);
  }
  function eyesAt(x, y, z, phi) {   // two green dots on his face (phi: his facing, world: 0 = +y)
    const fx = Math.sin(phi), fy = Math.cos(phi), L = LOOK.eyes, cx = x + fx * L.fwd, cy = y + fy * L.fwd, h = z + L.h;
    host.point(cx + fy * L.apart, cy - fx * L.apart, h, L.col, EYE); host.point(cx - fy * L.apart, cy + fx * L.apart, h, L.col, EYE);
  }
  const EYE = {emit: true, size: 1}, PUFF = {size: 1, alpha: 1};
  // BLUE FINGERS (blueberry soup: the 'prints.glow' note): a purple print that glows at every step (features/prints.js, the surface
  // LOOK.glow); burnt (< 0) the toes point back where he came from. Friends' from their codes: a print every stride they walk
  let glow = 0; if (host.mods) { const f = () => { glow = host.mods.value('prints.glow', 0); }; host.mods.watch(f); f(); }
  let prints = null, dirX = 0, dirY = 1;
  const G = LOOK.glow, walked = new Map();   // a friend's id -> {x, y, acc, foot}
  const printer = () => { if (prints === null) { prints = host.feature('prints') || false; prints?.surface?.(G.surf, G.def); } return prints; };
  const dry = (x, y) => !host.inStream?.(x, y) && !(host.feature('wading')?.wet?.(x, y) > .5);
  function glowStep(e, P) {
    const pr = printer(); if (!pr) return;
    const side = e.foot === 'R' ? -1 : 1, x = e.x + dirY * side * G.side, y = e.y - dirX * side * G.side, s = glow > 0 ? 1 : -1;
    if (dry(x, y)) pr.stamp(x, y, e.z ?? P.z, dirX * s, dirY * s, 'boot', G.surf);
  }
  function glowFriend(p) {
    const pr = printer(); if (!pr) return;
    let w = walked.get(p.id); if (!w) walked.set(p.id, w = {x: PS.x, y: PS.y, acc: 0, foot: 0});
    const d = Math.hypot(PS.x - w.x, PS.y - w.y);
    if (d > 4) { w.x = PS.x; w.y = PS.y; w.acc = 0; return; }   // (a teleport: no line of prints across it)
    w.acc += d;
    if (w.acc >= G.stride && d > 1e-4) {
      const ux = (PS.x - w.x) / d, uy = (PS.y - w.y) / d, side = (w.foot ^= 1) ? 1 : -1, s = PC.q === 'burnt' ? -1 : 1, x = PS.x + uy * side * G.side, y = PS.y - ux * side * G.side;
      w.acc = 0; if (dry(x, y)) pr.stamp(x, y, PS.z, ux * s, uy * s, 'boot', G.surf);
    }
    w.x = PS.x; w.y = PS.y;
  }

  const F = {
    name: 'meals', label: 'Meals', on: ON,
    get id() { return id; }, get q() { return q; }, get code() { return code; }, get left() { return left; }, moods: MOODS,
    get eyes() { return MOODS && id === 'smoked_eel' && q === 'burnt'; },
    ver: () => id ? Math.ceil(left / 60) * 4 + ['raw', 'done', 'right', 'burnt'].indexOf(q) : 0,
    note: esc => id ? `<div class="p-note">Eaten: ${esc(nameOf(id, q))}, ${Math.ceil(left / 60)} min left (${esc(MOODS ? MEALS[id].words : MEALS[id].say)})</div>` : '',
    cooked(m, qq = 'done') { if (MEALS[m]) cooked(m, qq); },
    potDone(m, qq = 'done') { if (MEALS[m]) potDone(m, qq); },
    spoon,
    odd,
    get hicN() { return hicN; }, get hic() { return hic > 0; },
    knows,
    eat(m, qq, t) { if (MEALS[m]) { if (typeof qq === 'number') { t = qq; qq = 'done'; } if (t !== undefined && !MEALS[m].trip) eat(m, t, qq || 'done'); else serve(m, qq || 'done'); } },
    // each step: the recipes offered to the pack (once: it is made after this feature), the meal saved restored (once), its clock
    update(dt) {
      const pk = pack(); if (!ON || !pk) return;
      if (!offered) { offered = true; for (const r of RECIPES) pk.recipe(r); if (MOODS) pk.section(JOURNAL); }
      if (!restored) { restored = true; restore(); }
      if (hic > 0) {   // (hiccups: one every TRY.every s while they last)
        hic -= dt;
        if ((hicT -= dt) <= 0) {
          hicT = TRY.every[0] + HR() * (TRY.every[1] - TRY.every[0]); hicN++;
          const P = host.player; host.events.push({type: 'meal.hic', x: P.x, y: P.y}); ui()?.float(P.x, P.y, P.z + 1.9, 'hic', '#d8d0c0');
        }
      }
      if (!id) return;
      if ((left -= dt) <= 0) { const n = nameOf(id, q); unEat(); ui()?.toast(n, 'has worn off', '#a39478'); }
      else if ((saveT += dt) > 5) { saveT = 0; const s = store(); if (s?.meal) { s.meal.t = Math.round(left); pk.dirty(); } }
    },
    // the moods' looks: his (the pike's dust on a step, a smoked-out trail) and his friends' (their codes); presentation only
    view(dt, evs) {
      if (!MOODS || !active()) return;
      const P = host.player, heavy = id === 'pike_stew' && q !== 'burnt';
      const sp = Math.hypot(P.vx || 0, P.vy || 0); if (sp > .3) { dirX = P.vx / sp; dirY = P.vy / sp; }
      if (glow && evs) for (const e of evs) if (e.type === 'player.step' || e.type === 'player.land') glowStep(e, P);
      if (heavy && evs) for (const e of evs) if (e.type === 'player.step' || e.type === 'player.land') {
        const z = e.z ?? P.z;
        for (let i = 0; i < LOOK.dust.n; i++) { const a = Math.random() * 6.283, v = .5 + Math.random() * .9; puff(e.x, e.y, z + .04, Math.cos(a) * v, Math.sin(a) * v * .7, .3 + Math.random() * .6, .5 + Math.random() * .3, LOOK.dust.col[i & 1], 1, 1); }
      }
      if (smokedOf(code) && !host.playerHidden) smokeFrom(0, P.x, P.y, P.z, dt);
      const L = peers(), C = host.feature('coop')?.net;
      if (L && C) for (const p of L.values()) {
        if (!p.md || !C.sample(p, PS)) continue;
        if (smokedOf(p.md)) smokeFrom(p.id, PS.x, PS.y, PS.z, dt);
        if (parseCode(p.md, PC).id === 'blueberry_soup') glowFriend(p);
      }
      for (const p of PF) {
        if (!p.on) continue;
        if ((p.t += dt) >= p.life) { p.on = false; continue; }
        const d = Math.exp(-dt * 2.5); p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt; p.h += p.vh * dt; if (p.col !== LOOK.smoke.col) p.vh -= 4 * dt;
      }
    },
    frame() {
      if (!MOODS || !active()) return;
      for (const p of PF) { if (!p.on) continue; PUFF.size = p.s; PUFF.alpha = p.a * (1 - p.t / p.life); host.point(p.x, p.y, p.h, p.col, PUFF); }
      if (F.eyes && !host.playerHidden) { const P = host.player; eyesAt(P.x, P.y, P.z, P.faceAngle); }
      const L = peers(), C = host.feature('coop')?.net;
      if (L && C) for (const p of L.values()) { if (!p.md) continue; parseCode(p.md, PC); if (PC.id === 'smoked_eel' && PC.q === 'burnt' && C.sample(p, PS)) eyesAt(PS.x, PS.y, PS.z, PS.phi); }
    },
    hd(q2) { if (id && active() && !host.hudOff && host.feature('hudboxes')?.on !== false && !host.playerHidden && !pack()?.open) chip(q2); },   // (the pack's panel shows it too, over that corner)
    hud: () => id ? `meal ${code || id} ${Math.ceil(left)}s` : '',
    // DEV (Esc > Sandbox): any mood now, at any quality (the stick's timing bar is features/cooking.js's)
    menu() {
      if (!MOODS || !active()) return [];
      const ids = Object.keys(MEALS), m = ids[devI % ids.length];
      const rows = [{label: `Mood (dev): dish ${MEALS[m].name} (click: next)`, run: () => { devI++; }}];
      for (const qq of ['raw', 'done', 'right', 'burnt']) rows.push({label: `Mood (dev): eat it ${qq === 'right' ? 'just right' : qq}`, run: () => serve(m, qq)});
      if (id) rows.push({label: 'Mood (dev): wear it off now', run: () => { left = .01; }});
      return rows;
    },
  };
  let devI = 0;
  // the meal eaten (bottom left): its name and the time it has left
  function chip(q2) {
    const u = hdUnit(), s = Math.max(0, Math.ceil(left)), t = `${nameOf(id, q)}  ${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
    q2.save(); q2.setTransform(1, 0, 0, 1, 0, 0); q2.imageSmoothingEnabled = false;
    q2.font = hdFont(u);
    const W = Math.ceil(q2.measureText(t).width / u) * u + 10 * u, H = 13 * u, x0 = 6 * u, y0 = q2.canvas.height - H - 6 * u;
    hdFrame(q2, x0, y0, W, H, u);
    hdText(q2, t, x0 + 5 * u, y0 + 10 * u, u, s < 30 && ((performance.now() / 300) | 0) % 2 ? '#a39478' : q === 'burnt' ? '#b8b0a4' : '#ffb060');
    q2.restore();
  }
  return F;
}
