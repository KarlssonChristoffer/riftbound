// ALMANAC (docs/ALMANAC.md): the first loop. A pixel almanac that walks the player through the persistent world's systems in the
// order they need each other (content/almanac.js CHAPTERS: the forest, the cave, fire down there, the furnace, iron, the dark),
// one chapter at a time, each goal counted from the events the systems already emit; a chapter done tears out its page (a hint,
// never an explanation) and gives its gift. From chapter II on, TODAY: three small things a world's day, rolled from the world's
// seed and its day (the same for everyone in that world; online the third is the party's: friends' fells and picks count too),
// a gift each and a bonus for all three.
//   THE CARD    top left (ui/almanaccard.js): the chapter, its goals with their counts, Today. Shift+J folds it to a tab and back.
//   THE POINTER a small arrow round the player toward what the first unfinished goal with a place asks for (WHERE: the cave's
//               mouth, the miner's camp, the nearest unspent vein of a kind), its distance on that goal's line.
//   THE PANEL   Tab: a section with every chapter (done ones with their pages, the current one's goals with their hints, the
//               next ones as dark names) and Today.
// CO-OP: nothing on the server. Every count is of something the server already decided (a fell, a pick, a spent vein, a smelt, a
//   made thing come back as its word first); the almanac is each player's own (their save), Today the same for everyone (the seed
//   and the server's day, which the client's clock follows).
// SIM vs VIEW: the counts, chapters, gifts and Today are the sim (update: from this step's events; no randomness at all: Today and
//   its gifts are hashes of the seed and the day). The card's flashes, the pointer's place and the sounds are the view's.
// THE STORY (features/story.js) puts words on the card: each chapter's lead (Hilma's line under its name) and the Lead line under
//   Today (the next of her places to find); chapter VII counts her places (C.found) and the tear (C.atTear, WHERE 'tear').
// OWNS: its save (pack.store('almanac'): {ch, g: {goal: count}, pages: [chapter ids], day, seed, t: [counts], tg: [gifted], tb, fold}),
//   the card, the pointer. READS: pack (give, count, level, store), coop (online), the cave's plan (host.world.cave: its mouth,
//   camp, veins), mining (isSpent, shown), caves (lit), host.env (day, part), host.mods ('light.nightglass'), SESSION.seed.
// EMITS: almanac.goal, almanac.chapter, almanac.today. BUDGET: update: a loop over this step's events against at most 8 goals;
//   the state goals and the pointer every .5 s; hd: the card (laid out on a change only) and the arrow.
import {flags} from '../core/flags.js';
import {SESSION} from '../core/session.js';
import {CHAPTERS, TODAY_BY_ID, TODAY_FROM, rollToday, giftOf, bonusOf, soloText, countOf} from '../content/almanac.js';
import {SKILLS, inCave} from '../content/skills.js';
import {ITEMS} from '../content/items.js';
import {createAlmanacCard} from '../ui/almanaccard.js';
import {hdUnit} from '../ui/hdpixel.js';

const ON = flags.get('almanac') !== '0';
const START = Math.max(0, Math.min(CHAPTERS.length, (parseInt(flags.get('chapter')) || 0) - 1));
const PAGE_T = 9, HOT_T = 1.4, LOOK = .5;   // s a done chapter's page shows on the card; s the frame flashes; s between state looks

// ORDER (core/features.js): after the pack and co-op (their mail this step), and after every system whose events it counts, so
// a count lands the step its event was pushed (the rest arrive the step after: the bus delivers them then)
export const order = {after: ['pack', 'coop', 'woodcut', 'forage', 'mining', 'builds', 'workshop', 'meals', 'cooking', 'fishing', 'caves', 'keepsakes']};

export async function create(host) {
  const pack = () => host.feature('pack'), game = () => host.feature('game'), coop = () => host.feature('coop');
  const online = () => !!coop()?.online;
  const card = createAlmanacCard();
  let ver = 0, cardVer = -1;   // (ver: what the card and the panel show changed)

  // ---------------------------------------------------------------- the save
  function S() {
    const s = pack()?.store('almanac'); if (!s) return null;
    s.ch ??= START; s.g ??= {}; s.pages ??= []; s.t ??= [0, 0, 0]; s.tg ??= [false, false, false]; s.tb ??= false; s.fold ??= false;
    return s;
  }
  let started = false;
  function applyStart(s) {   // (?chapter=n: start there, once a page load; the chapters before it count as done)
    if (started || !flags.get('chapter')) { started = true; return; }
    started = true; s.ch = START; s.g = {}; s.pages = CHAPTERS.slice(0, START).map(c => c.id); pack().dirty(); ver++;
  }
  const chapter = s => CHAPTERS[s.ch] || null;
  const gkey = (c, g) => c.id + '.' + g.id;
  const isDone = (s, c, g) => (s.g[gkey(c, g)] || 0) >= g.n;

  // ---------------------------------------------------------------- the context goals read (content/almanac.js C)
  let ngVer = -1, ng = false;
  const nightglass = () => { const m = host.mods; if (m.ver !== ngVer) { ngVer = m.ver; ng = m.value('light.nightglass', 0) > 0; } return ng; };
  const caveC = () => host.world?.cave || null;
  const C = {
    cave(x, y) { const P = host.player; return inCave(caveC(), x ?? P.x, y ?? P.y); },
    count: id => pack()?.count(id) || 0,
    level: id => pack()?.level(id) || 0,
    levels() { let L = 0; for (const id in SKILLS) L = Math.max(L, pack()?.level(id) || 0); return L; },
    part: 'day',
    nightLit() {
      const cv = host.feature('caves'), mi = host.feature('mining'), cc = caveC();
      if (!nightglass() || !cv?.lit || !mi || !cc?.veins) return false;
      const P = host.player;
      for (let i = 0; i < cc.veins.length; i++) { const v = cc.veins[i]; if (v.kind === 'night' && !mi.isSpent(i) && mi.shown(i) && Math.hypot(v.x - P.x, v.y - P.y) < 3.5) return true; }
      return false;
    },
    found: () => host.feature('story')?.found || 0,
    atTear: () => host.env?.part === 'night' && nightglass() && !!host.feature('story')?.near('tear', 5),
  };

  // ---------------------------------------------------------------- gifts (their pack.add events aren't counted)
  const skip = {};
  function give(gift, at) {
    const pk = pack(); if (!pk || !gift) return;
    let k = 0;
    for (const id in gift) { if (!ITEMS[id]) continue; skip[id] = (skip[id] || 0) + gift[id]; pk.give(id, gift[id], {x: at.x, y: at.y, h: 2 + .4 * k++}); }
  }
  function skipped(e) {   // a pack.add of a gift: eaten here
    const n = skip[e.id] || 0; if (!n) return false;
    skip[e.id] = Math.max(0, n - (e.n || 1)); return true;
  }

  // ---------------------------------------------------------------- counting
  const P0 = () => host.player;
  let hot = 0, pageT = 0, pageOf = null, lookT = 0;
  const said = [];   // (the view's: what happened this step, for its sounds: 'goal' | 'chapter' | 'today')
  function bump(s, c, g, n) {
    const k = gkey(c, g), was = s.g[k] || 0; if (was >= g.n || n <= 0) return;
    s.g[k] = Math.min(g.n, was + n); pack().dirty(); ver++;
    if (s.g[k] >= g.n) { const P = P0(); host.events.push({type: 'almanac.goal', x: P.x, y: P.y, ch: c.id, goal: g.id, today: false}); said.push('goal'); hot = HOT_T; }
  }
  function setState(s, c, g, v) {   // a state goal: the most it has read (latched once met)
    const k = gkey(c, g), was = s.g[k] || 0; if (was >= g.n) return;
    if (v > was) bump(s, c, g, v - was);
  }
  function finishChapter(s) {
    const c = chapter(s); if (!c) return;
    if (!s.pages.includes(c.id)) s.pages.push(c.id);
    s.ch++; pack().dirty(); ver++;
    pageOf = c; pageT = PAGE_T; hot = HOT_T;
    const P = P0(); give(c.gift, P);
    host.events.push({type: 'almanac.chapter', x: P.x, y: P.y, ch: c.id, next: chapter(s)?.id || ''});
    said.push('chapter');
  }

  // TODAY
  const todayOn = s => ON && s.pages.length >= TODAY_FROM;
  let todayList = [], todayKey = '';
  function todayRoll(s) {
    const day = host.env?.day ?? 0, seed = SESSION.seed | 0, key = seed + ':' + day;
    if (key !== todayKey) { todayKey = key; todayList = rollToday(seed, day); ver++; }
    if (s.day !== day || s.seed !== seed) { s.day = day; s.seed = seed; s.t = [0, 0, 0]; s.tg = [false, false, false]; s.tb = false; pack().dirty(); ver++; }
    return todayList;
  }
  function todayBump(s, i, n) {
    const T = todayList[i]; if (!T || s.tg[i] || n <= 0) return;
    s.t[i] = Math.min(T.n, (s.t[i] || 0) + n); pack().dirty(); ver++;
    if (s.t[i] < T.n) return;
    s.tg[i] = true; hot = HOT_T;
    const P = P0(); give(giftOf(s.seed, s.day, i), P);
    const all = s.tg.every(Boolean) && !s.tb;
    if (all) { s.tb = true; give(bonusOf(s.seed, s.day), P); }
    host.events.push({type: 'almanac.today', x: P.x, y: P.y, i, goal: T.id, all});
    said.push('today');
  }

  function count(s, evs) {
    const c = chapter(s), party = online();
    C.part = host.env?.part || 'day';
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'pack.add' && skipped(e)) continue;
      if (c) for (const g of c.goals) if (g.on && !isDone(s, c, g)) bump(s, c, g, countOf(g, e, C));
      if (todayOn(s)) for (let k = 0; k < todayList.length; k++) if (!s.tg[k]) todayBump(s, k, countOf(todayList[k], e, C, party && !!todayList[k].party));
    }
  }
  function look(s) {   // the state goals (every LOOK s)
    const c = chapter(s); if (!c) return;
    for (const g of c.goals) if (g.state && !isDone(s, c, g)) setState(s, c, g, g.state(C) | 0);
  }

  // ---------------------------------------------------------------- the pointer (WHERE)
  const AIM = {on: false, x: 0, y: 0, d: 0, goal: ''};
  function nearestVein(kind) {
    const cc = caveC(), mi = host.feature('mining'), P = P0(); if (!cc?.veins || !mi) return null;
    let best = null, bd = 1e9;
    for (let i = 0; i < cc.veins.length; i++) {
      const v = cc.veins[i];
      if (v.kind === 'hollow' || (kind && v.kind !== kind) || mi.isSpent(i)) continue;
      const d = Math.hypot(v.x - P.x, v.y - P.y); if (d < bd) { bd = d; best = v; }
    }
    return best;
  }
  function where(w) {
    if (w === 'tear') return host.feature('story')?.place('tear') || null;   // (above ground, by the spawn)
    const cc = caveC(); if (!cc) return null;
    const down = C.cave();
    if (w === 'cave') return down ? null : cc.mouth;
    if (!down) return cc.mouth;   // (everything else is down there: to the slot first)
    if (w === 'camp') return cc.camp;
    if (w === 'vein') return nearestVein('');
    if (w === 'copper' || w === 'iron' || w === 'night') return nearestVein(w);
    return null;
  }
  function aim(s) {
    AIM.on = false; AIM.goal = '';
    const c = chapter(s); if (!c || pageT > 0 || game()?.mode !== 'sandbox') return;
    for (const g of c.goals) {
      if (isDone(s, c, g) || !g.where) continue;
      const t = where(g.where); if (!t) continue;
      const P = P0(), d = Math.hypot(t.x - P.x, t.y - P.y); if (d < 3) return;
      AIM.on = true; AIM.x = t.x; AIM.y = t.y; AIM.d = d; AIM.goal = g.id; return;
    }
  }

  // ---------------------------------------------------------------- the card's model (made again on a change)
  let farTxt = '', farD = -1, storyVer = -1;
  function model(s) {
    const c = chapter(s), fold = !!s.fold;
    const st = host.feature('story'), M = {title: '', lead: '', rows: [], today: null, page: null, side: st?.side || null, fold, hot, key: 'Shift+J'};
    if (pageT > 0 && pageOf) M.page = {title: pageOf.name, text: pageOf.page};
    else if (c) {
      M.title = c.name; M.lead = st?.on ? c.lead || '' : '';
      for (const g of c.goals) M.rows.push({text: g.text, n: s.g[gkey(c, g)] || 0, of: g.n, done: isDone(s, c, g), far: AIM.on && AIM.goal === g.id ? farTxt : ''});
    } else { M.title = 'The almanac is full'; M.lead = st?.on ? st.after : ''; }
    if (todayOn(s) && todayList.length) M.today = todayList.map((T, i) => ({text: T.party && !online() ? soloText(T) : T.text, n: s.t[i] || 0, of: T.n, done: !!s.tg[i]}));
    return M;
  }
  const shown = () => ON && !host.hudOff && !host.playerHidden && !host.lock && game()?.mode === 'sandbox' && !pack()?.open && !!S();

  // ---------------------------------------------------------------- the pack panel's section
  const esc0 = s => s;
  function sectionHTML(esc = esc0) {
    const s = S(); if (!s) return '';
    let h = '<div class="p-skill">';
    CHAPTERS.forEach((c, i) => {
      if (i < s.ch) h += `<div class="p-move"><b style="color:#9ad878">${esc(c.name)}: done</b><small>${esc(c.page)}</small></div>`;
      else if (i === s.ch) {
        h += `<div class="p-move"><b style="color:#f2d27a">${esc(c.name)}</b>${c.lead ? `<small>"${esc(c.lead)}"</small>` : ''}</div>`;
        for (const g of c.goals) { const n = s.g[gkey(c, g)] || 0, d = n >= g.n; h += `<div class="p-move"><b style="color:${d ? '#9ad878' : '#efe6cf'}">${d ? 'x ' : '- '}${esc(g.text)}${!d && g.n > 1 ? ` ${n}/${g.n}` : ''}</b><small>${esc(g.hint || '')}</small></div>`; }
      } else h += `<div class="p-move p-next">${esc(c.name.split(' ')[0])} ...</div>`;
    });
    if (todayOn(s) && todayList.length) {
      h += `<div class="p-move"><b style="color:#8ac8e8">Today (day ${(s.day ?? 0) + 1})</b><small>the same three for everyone in this world; a new three each day</small></div>`;
      todayList.forEach((T, i) => { const d = !!s.tg[i]; h += `<div class="p-move"><b style="color:${d ? '#9ad878' : '#efe6cf'}">${d ? 'x ' : '- '}${esc(T.party && !online() ? soloText(T) : T.text)}${!d && T.n > 1 ? ` ${s.t[i] || 0}/${T.n}` : ''}</b></div>`; });
    }
    return h + '</div>';
  }
  let sectionAdded = false;

  // ---------------------------------------------------------------- dev
  const queue = [];
  function dev(what) {
    const s = S(); if (!s) return;
    if (what === 'finish') { const c = chapter(s); if (c) { for (const g of c.goals) s.g[gkey(c, g)] = g.n; ver++; } }
    else if (what === 'reset') { s.ch = 0; s.g = {}; s.pages = []; s.t = [0, 0, 0]; s.tg = [false, false, false]; s.tb = false; pageT = 0; ver++; }
    else if (what === 'today') { for (let i = 0; i < todayList.length; i++) if (!s.tg[i]) todayBump(s, i, todayList[i].n); }
    pack().dirty();
  }

  const F = {
    name: 'almanac', label: 'Almanac', on: ON,
    get chapter() { const s = S(); return s ? s.ch : -1; },
    get today() { return todayList; },
    get aim() { return AIM; },
    state: () => S(),
    html: () => sectionHTML(),
    claims: k => ON && k === 'j',
    onKey(k, e) {   // Shift+J folds the card (a plain J is the player window's Journal, where the almanac's page is)
      if (!ON || k !== 'j' || !e?.shiftKey || host.lock) return false;
      queue.push(() => { const s = S(); if (s) { s.fold = !s.fold; pack().dirty(); ver++; } });
      return true;
    },
    update(dt, evs) {
      if (!ON) return;
      const s = S(); if (!s) return;
      applyStart(s);
      if (!sectionAdded) { sectionAdded = true; pack().section({id: 'almanac', title: 'Almanac', order: 0, ver: () => ver, html: esc => sectionHTML(esc)}); }   // (order 0: the Journal's first page)
      while (queue.length) queue.shift()();
      if (game()?.mode !== 'sandbox') return;
      todayRoll(s);
      if (evs?.length) count(s, evs);
      if ((lookT -= dt) <= 0) { lookT = LOOK; look(s); aim(s); }
      const c = chapter(s);
      if (c && c.goals.every(g => isDone(s, c, g))) finishChapter(s);
    },
    view(dt) {
      if (!ON) return;
      if (hot > 0) hot = Math.max(0, hot - dt);
      if (pageT > 0) { pageT = Math.max(0, pageT - dt); if (pageT === 0) { pageOf = null; ver++; } }
      const st = host.feature('story'); if (st && st.ver !== storyVer) { storyVer = st.ver; ver++; }   // (the story's Lead line on the card)
      if (AIM.on) { const d = Math.round(AIM.d); if (d !== farD) { farD = d; farTxt = d + ' m'; ver++; } } else if (farD !== -1) { farD = -1; farTxt = ''; ver++; }
      while (said.length) { const w = said.shift(); host.uiSound?.(w === 'chapter' ? 'confirm' : 'click'); }
    },
    hd(q, sc) {
      if (!shown()) return;
      const s = S(), u = hdUnit();
      if (ver !== cardVer) { cardVer = ver; card.set(model(s)); }
      card.model.hot = hot;   // (the flash: no new layout)
      card.draw(q, u, q.canvas.width, q.canvas.height);
      if (AIM.on && !s.fold && !host.G.cine) {   // the pointer: the way from him to a point 5 m toward it, on the screen
        const P = host.player, dx = AIM.x - P.x, dy = AIM.y - P.y, k = 5 / (Math.hypot(dx, dy) || 1), h = (P.z || 0) + .9;
        const a = host.G.toScreen(P.x, h, P.y), ax = a[0], ay = a[1], b = host.G.toScreen(P.x + dx * k, h, P.y + dy * k);
        const ux = b[0] - ax, uy = b[1] - ay, l = Math.hypot(ux, uy);
        if (l > 1e-3) { q.save(); host.G.hdShift?.(q, sc); card.arrow(q, ax * sc, ay * sc, ux / l, uy / l, u); q.restore(); }
      }
    },
    dev: {group: 'Gathering'},   // (its menu rows: F10's dev menu, Gathering > Almanac)
    menu() {
      if (!ON || game()?.mode !== 'sandbox') return [];
      return [
        {label: 'Almanac: finish this chapter', run: () => queue.push(() => dev('finish'))},
        {label: 'Almanac: finish Today', run: () => queue.push(() => dev('today'))},
        {label: 'Almanac: back to chapter I (clear it)', run: () => queue.push(() => dev('reset'))},
      ];
    },
    hud() { const s = S(); return ON && s ? `almanac ch ${s.ch + 1}/${CHAPTERS.length} · today ${todayList.map((T, i) => (s.t[i] || 0) + '/' + T.n).join(' ')}${AIM.on ? ` · aim ${AIM.goal} ${Math.round(AIM.d)} m` : ''}` : ''; },
  };
  return F;
}
