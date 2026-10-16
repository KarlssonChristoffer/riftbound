// DEV MENU (F10 in dev mode; also Esc > Game > Dev menu): every test action, toggle and setting in one panel, a PAGE per
// feature (its on / off, its settings, its test actions), the pages sorted into SECTIONS (Panels, Character, World,
// Nature, Animals, Gathering, Combat, Effects, Renderer, Sound, Co-op, Other). The player's Esc menu keeps only what a
// player sets (Game / Graphics / Audio / Controls: ui/pause.js); the old Sandbox and Dev tabs live here now.
// THE REGISTRY is the feature list: nothing to register by hand. Each feature's page is built from what it already has
// (F.toggle + F.key, F.settings(), F.menu()) plus, if it wants, its own dev rows:
//   F.dev = {group: 'Gathering',          the section (else SECTION_OF below, else Other)
//            rows: () => [ ...rows ]}     its dev rows (read fresh while the menu shows)
// A ROW (the same shapes as the Esc menu's, plus a plain switch and a read-out):
//   {label, run()}                                  an action: runs at once, the menu stays open
//   {label, get() -> true/false, set(v)}            a switch
//   {label, options: [...], get(), set(v)}           a choice ('on' / 'off' ones are a switch too)
//   {label, min, max, step?, get(), set(n)}          a number (step: default a tenth of the range)
//   {label, value() -> text, run(d), sizes?()}       a value it cycles itself (d = +1 / -1)
//   {label, text() -> text}                         a read-out (counts, state)
//   key: 'F7' | 'Shift+P' ...                       on any row: a keycap hint
// A legacy F.menu() label 'Foraging: marks on' loses its 'Foraging: ' here (the page says whose it is).
// Rows that change the world do it the way the feature always does (in co-op: through its own messages to the server).
// THE PANEL: search on top (type: every row of every page whose words match; Enter runs the highlighted one), the
// section chips (Tab / Shift+Tab), the section's pages (a feature with only an on / off is one line; the others fold:
// click the name), PINNED rows above it all (the * at a row's left; remembered on this machine, 'rb.devmenu').
// While the search box has the keys the game doesn't hear them (Esc clears it, then closes); click the world to play
// with the menu open, F10 closes it. Pixel art like the game (ui/pixelfont.js, ui/pixelframe.js).
// It is a FEATURE the boot adds after the other dev panels (main.js; dev/: nothing in the game imports it). F.on is the
// panel showing. OWNS: #devm + its style, 'rb.devmenu' (section, folds, pins). READS: every feature's toggle / settings /
// menu / dev, the engine (E: the character, the world's dials, the renderer's options).
// BUDGET: closed: nothing. Open: the rows are read 4 times a second; the DOM is rebuilt only when the rows change.
import {FRAMES, uiUnit} from '../ui/pixelframe.js';
import {loadPixelFont} from '../ui/pixelfont.js';
import {GAME_ROWS} from '../ui/pause.js';
import {SAMPLING, DEBUG} from '../render/options.js';
import {SEASONS, WEATHER} from '../sim/env.js';

export const SECTIONS = ['Panels', 'Character', 'World', 'Nature', 'Animals', 'Gathering', 'Combat', 'Effects', 'Renderer', 'Sound', 'Co-op', 'Other'];
// a feature's section when it doesn't say (F.dev.group); open PRs' features are listed too, so their rows land in the
// right place before they move to F.dev
const SECTION_OF = {
  cheats: 'Panels', movefeel: 'Panels', gunfeel: 'Panels', wxpanel: 'Panels', wardrobe: 'Panels', lab: 'Panels',
  aim: 'Character', cinema: 'Character', chasecam: 'Character', gear: 'Character', fists: 'Character', ropetail: 'Character', senses: 'Character',
  body: 'Character', rope: 'Character', firstperson: 'Character',
  caves: 'World', cutaway: 'World', uncanny: 'World', watcher: 'World', anomaly: 'World', frontier: 'World', mire: 'World', ice: 'World',
  winter: 'World', thunder: 'World', prints: 'World', mud: 'World', trip: 'World', floor3d: 'World',
  wind: 'Nature', windlines: 'Nature', litter: 'Nature', weather: 'Nature', mist: 'Nature', garden: 'Nature', riverside: 'Nature',
  stillwater: 'Nature', puddles: 'Nature', wading: 'Nature', grass: 'Nature', atmos: 'Nature', dust: 'Nature', tumbleweed: 'Nature',
  airfx: 'Nature', campfires: 'Nature', wrongwx: 'Nature',
  wildlife: 'Animals', fauna: 'Animals', calls: 'Animals', cavelife: 'Animals', foxden: 'Animals', animalfinds: 'Animals',
  woodcut: 'Gathering', fishing: 'Gathering', pack: 'Gathering', forage: 'Gathering', mining: 'Gathering', builds: 'Gathering',
  cooking: 'Gathering', meals: 'Gathering', workshop: 'Gathering', keepsakes: 'Gathering', skills: 'Gathering',
  equip: 'Combat', affixes: 'Combat', trickshot: 'Combat', bells: 'Combat', combat: 'Combat', gun: 'Combat', brawl: 'Combat',
  foes: 'Combat', shrines: 'Combat', omens: 'Combat', mods: 'Combat',
  almanac: 'World',
  lights: 'Effects', flow: 'Effects', contact: 'Effects', gunfx: 'Effects', blood: 'Effects', depth: 'Effects',
  brutes3d: 'Renderer',
  audio: 'Sound', rainaudio: 'Sound', windaudio: 'Sound', battlemusic: 'Sound',
  coop: 'Co-op',
};
const STORE = 'rb.devmenu', TICK = .25;
const CSS = `
#devm { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c; --mute: #6e604a;
  position: fixed; right: 10px; top: 10px; z-index: 16; width: calc(200 * var(--u)); max-width: calc(100vw - 20px); max-height: calc(100vh - 20px);
  display: flex; flex-direction: column; padding: var(--u) calc(2 * var(--u)); color: var(--ink); user-select: none;
  font: calc(10 * var(--u)) / calc(12 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; image-rendering: pixelated;
  border: calc(3 * var(--u)) solid transparent; border-image: var(--dm-panel) 3 fill / calc(3 * var(--u)); box-sizing: border-box; }
#devm * { box-sizing: border-box; }
#devm.hidden { display: none; }
body:has(#pause:not(.hidden)) #devm { visibility: hidden; }
body:has(#devm:not(.hidden)) #cheats { right: calc(200 * var(--dm-u, 2px) + 18px); }   /* (the cheat panel moves out from under it) */
#devm header { display: flex; justify-content: space-between; align-items: baseline; padding: 0 var(--u); }
#devm header b { font-weight: 400; color: var(--key); letter-spacing: var(--u); text-shadow: var(--u) var(--u) 0 #0c0907; }
#devm header small { color: var(--dim); font-size: inherit; }
#devm header button { font: inherit; color: var(--dim); background: none; border: 0; cursor: pointer; padding: 0 0 0 calc(3 * var(--u)); }
#devm header button:hover { color: var(--ink); }
#devm .dm-find { display: block; width: 100%; margin: calc(2 * var(--u)) 0; padding: 0 calc(2 * var(--u)); font: inherit; color: var(--ink); outline: none;
  background: none; border: calc(2 * var(--u)) solid transparent; border-image: var(--dm-well) 2 fill / calc(2 * var(--u)); caret-color: var(--key); }
#devm .dm-find:focus { border-image-source: var(--dm-card); }
#devm .dm-find::placeholder { color: var(--mute); }
#devm nav { display: flex; flex-wrap: wrap; gap: var(--u); margin-bottom: calc(2 * var(--u)); }
#devm .dm-sec { padding: 0 calc(2 * var(--u)); font: inherit; color: var(--dim); background: none; cursor: pointer;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--dm-btn) 2 fill / calc(2 * var(--u)); }
#devm .dm-sec:hover { border-image-source: var(--dm-hot); color: var(--ink); }
#devm .dm-sec.on { border-image-source: var(--dm-on); color: #fff3c4; }
#devm .dm-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #7a5f3e #15100c; }
#devm h5 { margin: calc(2 * var(--u)) 0 0; padding: 0 calc(2 * var(--u)); font: inherit; color: var(--dim); text-transform: uppercase; }
#devm .dm-r { display: flex; align-items: baseline; gap: calc(2 * var(--u)); padding: 0 calc(2 * var(--u)) 0 0; cursor: pointer; }
#devm .dm-r:hover { background: #2e2318; }
#devm .dm-r.sel { background: #3a2c1e; box-shadow: inset var(--u) 0 0 var(--key); }
#devm .dm-r.sub { padding-left: calc(6 * var(--u)); }
#devm .dm-l { flex: 1; min-width: 0; }
#devm .dm-l em { font-style: normal; color: var(--dim); }
#devm .dm-h .dm-l { color: var(--key); }
#devm .dm-h .dm-l s { text-decoration: none; color: var(--mute); }
#devm kbd { margin-left: calc(3 * var(--u)); font: inherit; color: var(--mute); }
#devm .dm-v { white-space: nowrap; color: var(--dim); }
#devm .dm-v.on { color: var(--key); }
#devm .dm-v i { font-style: normal; color: var(--mute); padding: 0 var(--u); }
#devm .dm-v i:hover { color: var(--ink); }
#devm .dm-v.act { color: var(--mute); }
#devm .dm-r:hover .dm-v.act, #devm .dm-r.sel .dm-v.act { color: var(--key); }
#devm .dm-pin { width: calc(6 * var(--u)); text-align: center; color: var(--mute); visibility: hidden; }
#devm .dm-r:hover .dm-pin { visibility: visible; }
#devm .dm-pin:hover { color: var(--ink); }
#devm .dm-pin.on { visibility: visible; color: var(--key); }
#devm .dm-none { padding: var(--u) calc(2 * var(--u)); color: var(--dim); }
#devm footer { margin-top: calc(2 * var(--u)); padding: var(--u) calc(2 * var(--u)) 0; border-top: var(--u) solid #4a3826; color: var(--dim); min-height: calc(13 * var(--u)); }
#devm footer.ok { color: #b5d77a; }
#devm footer.bad { color: #ec8a6a; }`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const cap = k => k ? String(k).split('+').map(s => s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1)).join('+') : '';
const onOff = (get, set) => ({options: ['on', 'off'], get: () => get() ? 'on' : 'off', set: v => set(v === 'on')});
const pick = (options, get, set) => ({options, get, set});
const cyc = (o, cur, d, set) => set(o[((o.indexOf(cur) + d) % o.length + o.length) % o.length]);
// a row's kind, from its shape
function kindOf(r) {
  if (r.text) return 'text';
  if (r.run) return r.value ? 'cycle' : 'act';
  if (r.options) return r.options.length === 2 && r.options.includes('on') && r.options.includes('off') ? 'switch' : 'choice';
  if (r.min !== undefined) return 'num';
  if (r.get && r.set) return 'bool';
  return 'text';
}
const isOn = r => r.kind === 'bool' ? !!r.get() : r.get() === 'on';
function valueOf(r) {
  switch (r.kind) {
    case 'switch': case 'bool': return isOn(r) ? 'On' : 'Off';
    case 'choice': return String(r.get());
    case 'num': { const st = r.step || (r.max - r.min) / 10, n = r.get(); return st >= 1 ? String(Math.round(n)) : (+n).toFixed(Math.min(4, Math.ceil(-Math.log10(st)))); }
    case 'cycle': return String(r.value());
    case 'text': return String(r.text?.() ?? '');
    default: return '>';
  }
}
// 'Foraging: marks on' on Foraging's page -> 'marks on' (only when the prefix names the feature: 'Try: ...' stays)
function strip(label, f) {
  const m = /^([^:]{1,40}):\s+(.+)$/.exec(label); if (!m) return label;
  const p = m[1].toLowerCase().replace(/\s*\(dev\)$/, '').trim(), t = (f.label || '').toLowerCase();
  return p === f.name || (t && (t === p || t.includes(p) || p.includes(t))) ? m[2] : label;
}
// a pin's id: the page and the label without its changing bits (counts, '(on)')
const pinOf = (page, label) => page.id + '|' + label.replace(/\([^)]*\)|\d+/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// opts: {host, engine: () => E (main.js: the character, the world's dials, the renderer's options)}
export function createDevMenu({host, engine}) {
  const S = {sec: 'World', open: {}, pins: []};
  try { Object.assign(S, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  if (!SECTIONS.includes(S.sec)) S.sec = 'World';
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} };
  const game = () => host.feature('game');

  // ---------------------------------------------------------------- the pages
  // the engine's own rows (they were the Esc menu's Dev tab): the character, the world's dials, the renderer, the tools
  function hostPages(E) {
    const {hero, opt, stage, env, perf} = E, out = [];
    out.push({id: 'h:tools', title: 'Debug tools', section: 'Panels', rows: [
      {label: 'Frame profiler', key: 'F3', ...onOff(() => perf.on, v => { if (perf.on !== v) perf.toggle(); })},
      {label: 'Key help + debug HUD', key: 'F1', ...onOff(() => opt.help, v => { opt.help = v; })},
      {label: 'Dev mode', key: '`', ...onOff(() => host.dev, v => { host.dev = v; })}]});
    out.push({id: 'h:char', title: 'The character', section: 'Character', rows: [
      {label: 'Loadout', key: 'O', value: () => hero.loadName, run: d => hero.switchLoadout(hero.loadI + d)},
      {label: 'Bow', key: 'J', ...pick(['pixel art', 'HD overlay'], () => opt.hdBow ? 'HD overlay' : 'pixel art', v => { opt.hdBow = v === 'HD overlay'; })},
      {label: 'Shiny armour', key: 'I', ...onOff(() => hero.armor.on, v => { if (hero.armor.on !== v) hero.toggleArmour(); })},
      {label: 'Lantern', key: 'L', ...onOff(() => opt.lantern, v => { opt.lantern = v; })}]});
    out.push({id: 'h:world', title: 'Time, season, weather', section: 'World', rows: [
      {label: 'Biome', key: 'N', value: () => stage.biome.name, run: d => E.setBiome(stage.biomeI + d)},
      {label: 'Time', key: 'T', value: () => `${env.clock()} ${env.part}`, run: () => env.nextPart()},
      {label: 'Season', value: () => env.seasonLock || `auto (${env.season})`, run: d => cyc(['auto', ...SEASONS], env.seasonLock || 'auto', d, env.setSeason)},
      {label: 'Weather', value: () => env.weatherLock || `auto (${env.weather})`,
        run: d => cyc(['auto', ...Object.keys(WEATHER).filter(w => !WEATHER[w].precip || env.TUNE.precip)], env.weatherLock || 'auto', d, env.setWeather)},
      {label: 'Day length', value: () => env.frozen ? 'stopped' : `${env.TUNE.dayMinutes} min`, run: d => cyc([20, 5, 60, 0], env.frozen ? 0 : env.TUNE.dayMinutes, d, env.setDayMinutes)}]});
    out.push({id: 'h:render', title: 'Renderer A/B', section: 'Renderer', rows: [
      {label: 'Ground texture', key: 'Shift+2', ...pick(SAMPLING, () => opt.sampling, v => { opt.sampling = v; })},
      {label: 'Prop outlines', key: 'Shift+3', ...onOff(() => opt.outline, v => { opt.outline = v; })},
      {label: 'Props', key: 'P', ...pick(['live 3D', '16-angle sprites'], () => stage.propMode === 'live' ? 'live 3D' : '16-angle sprites', v => { stage.propMode = v === 'live 3D' ? 'live' : 'yaw'; })},
      {label: 'Trees', key: 'Shift+P', ...pick(['3D (grown)', 'painted cards'], () => stage.trees3d ? '3D (grown)' : 'painted cards', v => { stage.trees3d = v === '3D (grown)'; })},
      {label: 'Banded light', key: 'V', ...onOff(() => opt.banded, v => { opt.banded = v; })},
      {label: 'Debug view', key: 'G', ...pick(DEBUG, () => DEBUG[opt.debug], v => { opt.debug = DEBUG.indexOf(v); })},
      {label: 'Colliders', key: 'Shift+G', ...onOff(() => opt.zones, v => { opt.zones = v; })}]});
    return out;
  }
  // a feature's page: its on / off, its settings, its F.menu rows (not the player's: ui/pause.js GAME_ROWS), its F.dev rows
  function featurePage(f) {
    const page = {id: 'f:' + f.name, title: f.label || f.name[0].toUpperCase() + f.name.slice(1), name: f.name, section: f.dev?.group || SECTION_OF[f.name] || 'Other', on: null, rows: []};
    if (!SECTIONS.includes(page.section)) page.section = 'Other';
    if (f.toggle) page.on = {label: page.title, key: cap(f.key), ...onOff(() => f.on !== false, v => { if ((f.on !== false) !== v) f.toggle(); })};
    for (const s of f.settings?.() || []) page.rows.push(s.options ? {label: s.label, ...pick(s.options, s.get, s.set)} : {label: s.label, min: s.min ?? 0, max: s.max ?? 1, step: s.step ?? .01, get: s.get, set: s.set});
    if (!GAME_ROWS.includes(f.name)) for (const m of f.menu?.() || []) page.rows.push({...m, label: strip(m.label, f)});
    for (const r of f.dev?.rows?.() || []) page.rows.push(r);
    return page;
  }
  function collect() {
    const E = engine(), pages = E ? hostPages(E) : [];
    for (const f of E?.features || []) {
      if (f === F || f.name === 'game') continue;
      try { const p = featurePage(f); if (p.on || p.rows.length) pages.push(p); } catch (e) { console.warn('devmenu: page', f.name, e); }
    }
    for (const p of pages) {
      if (p.on) p.on = norm(p.on, p);
      p.rows = p.rows.map(r => norm(r, p));
    }
    return pages;
  }
  const norm = (r, page) => { const n = {...r, kind: kindOf(r), page}; n.pin = pinOf(page, n.label); return n; };

  // ---------------------------------------------------------------- the panel
  const root = document.createElement('div'); root.id = 'devm'; root.className = 'hidden';
  root.innerHTML = `<header><b>DEV MENU</b><span><small>F10</small><button data-close title="Close (F10)">x</button></span></header>
    <input class="dm-find" placeholder="search: fog, spawn, time ..." spellcheck="false" autocomplete="off"><nav></nav><div class="dm-body"></div><footer></footer>`;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  document.body.appendChild(root);
  const find = root.querySelector('.dm-find'), nav = root.querySelector('nav'), body = root.querySelector('.dm-body'), foot = root.querySelector('footer');
  let styled = false, vis = [], sig = '', sel = -1, tick = 0, msgT = 0;

  // what shows: the search's matches, else the pinned rows + the section's pages ({kind: 'head', page} entries fold)
  function layout(pages) {
    const q = find.value.trim().toLowerCase().split(/\s+/).filter(Boolean), out = [];
    const rowsOf = p => p.on && p.rows.length ? [p.on, ...p.rows] : p.on ? [p.on] : p.rows;
    if (q.length) {
      for (const p of pages) {
        const hay = `${p.section} ${p.title} ${p.name || ''}`.toLowerCase(), hit = rowsOf(p).filter(r => q.every(w => (hay + ' ' + r.label.toLowerCase()).includes(w)));
        if (!hit.length) continue;
        out.push({t: 'title', page: p});
        for (const r of hit) out.push({t: 'row', row: r, sub: true});
      }
      return out;
    }
    const all = new Map(); for (const p of pages) for (const r of rowsOf(p)) all.set(r.pin, r);
    const pinned = S.pins.map(id => all.get(id)).filter(Boolean);
    if (pinned.length) { out.push({t: 'h5', text: 'Pinned'}); for (const r of pinned) out.push({t: 'row', row: r, from: true}); out.push({t: 'h5', text: S.sec}); }
    const mine = pages.filter(p => p.section === S.sec), folds = mine.filter(p => p.rows.length).length;
    for (const p of mine) {
      if (!p.rows.length) { out.push({t: 'row', row: p.on}); continue; }
      const open = S.open[p.id] ?? folds === 1;
      out.push({t: 'head', page: p, open});
      if (open) for (const r of p.rows) out.push({t: 'row', row: r, sub: true});   // (its on / off: on the name's line)
    }
    return out;
  }
  function valHtml(r) {
    const v = esc(valueOf(r));
    if (r.kind === 'act') return `<span class="dm-v act">&gt;</span>`;
    if (r.kind === 'switch' || r.kind === 'bool') return `<span class="dm-v${isOn(r) ? ' on' : ''}"><b>${v}</b></span>`;
    if (r.kind === 'text') return `<span class="dm-v"><b>${v}</b></span>`;
    return `<span class="dm-v"><i data-d="-1">&lt;</i><b>${v}</b><i data-d="1">&gt;</i></span>`;
  }
  function entryHtml(e, i) {
    if (e.t === 'h5') return `<h5>${esc(e.text)}</h5>`;
    if (e.t === 'title') return `<h5>${esc(e.page.title)} <em>${esc(e.page.section)}</em></h5>`;
    if (e.t === 'head') {
      const p = e.page, n = p.rows.length;
      return `<div class="dm-r dm-h" data-r="${i}"><span class="dm-pin"></span><span class="dm-l">${e.open ? '-' : '+'} ${esc(p.title)}${e.open ? '' : ` <s>${n}</s>`}${p.on?.key ? `<kbd>[${esc(p.on.key)}]</kbd>` : ''}</span>` +
        (p.on ? `<span class="dm-v${isOn(p.on) ? ' on' : ''}" data-on><b>${isOn(p.on) ? 'On' : 'Off'}</b></span>` : '') + `</div>`;
    }
    const r = e.row, pin = S.pins.includes((e.base || r).pin);
    return `<div class="dm-r${e.sub ? ' sub' : ''}" data-r="${i}"><span class="dm-pin${pin ? ' on' : ''}" data-pin title="pin">*</span>` +
      `<span class="dm-l">${e.from && r.page.on !== r ? `<em>${esc(r.page.title)}:</em> ` : ''}${esc(r.label)}${r.key ? `<kbd>[${esc(r.key)}]</kbd>` : ''}</span>${valHtml(r)}</div>`;
  }
  const sigOf = list => list.map(e => e.t === 'row' ? `${e.row.pin}|${e.row.label}|${e.row.kind}|${e.row.key || ''}` : e.t === 'head' ? `h${e.page.id}${e.open}${e.page.rows.length}` : e.t + (e.text || e.page?.id)).join('\n');

  function sync(force) {
    if (!styled) {
      styled = true; loadPixelFont();
      for (const [k, v] of [['panel', FRAMES.panel()], ['btn', FRAMES.btn()], ['hot', FRAMES.hot()], ['on', FRAMES.on()], ['well', FRAMES.well()], ['card', FRAMES.card()]]) root.style.setProperty('--dm-' + k, v);
    }
    const pages = collect(), secs = SECTIONS.filter(s => pages.some(p => p.section === s));
    if (!secs.includes(S.sec) && secs.length) S.sec = secs[0];
    const navHtml = secs.map(s => `<button class="dm-sec${s === S.sec && !find.value.trim() ? ' on' : ''}" data-sec="${esc(s)}">${esc(s)}</button>`).join('');
    if (nav.innerHTML !== navHtml) nav.innerHTML = navHtml;
    const list = layout(pages), s = sigOf(list);
    if (force || s !== sig) {
      sig = s; vis = list;
      body.innerHTML = list.length ? list.map(entryHtml).join('') : `<div class="dm-none">${find.value.trim() ? 'nothing matches' : 'nothing here'}</div>`;
      const n = vis.filter(e => e.t === 'row' || e.t === 'head').length;
      if (sel >= vis.length || (sel >= 0 && !(vis[sel].t === 'row' || vis[sel].t === 'head'))) sel = -1;
      if (sel < 0 && find.value.trim() && n) sel = vis.findIndex(e => e.t === 'row');
      mark();
      return;
    }
    vis = list;   // (the same rows: fresh getters, the values in place)
    const els = body.querySelectorAll('[data-r]');
    for (const el of els) {
      const e = vis[+el.dataset.r], v = el.querySelector('.dm-v'); if (!e || !v) continue;
      const r = e.t === 'head' ? e.page.on : e.row; if (!r) continue;
      const on = (r.kind === 'switch' || r.kind === 'bool') && isOn(r), t = r.kind === 'act' ? null : valueOf(r), b = v.querySelector('b');
      if (b && t !== null && b.textContent !== t) b.textContent = t;
      if (r.kind === 'switch' || r.kind === 'bool') v.classList.toggle('on', on);
    }
  }
  function mark() {
    for (const el of body.querySelectorAll('.sel')) el.classList.remove('sel');
    const el = sel >= 0 ? body.querySelector(`[data-r="${sel}"]`) : null;
    if (el) { el.classList.add('sel'); el.scrollIntoView({block: 'nearest'}); }
  }
  function say(text, ok = true) { foot.textContent = text; foot.className = ok ? 'ok' : 'bad'; msgT = 3; }
  function act(r, d = 1) {
    try {
      switch (r.kind) {
        case 'act': r.run(); say(`${r.page.title}: ${r.label}`); break;
        case 'switch': r.set(isOn(r) ? 'off' : 'on'); break;
        case 'bool': r.set(!r.get()); break;
        case 'choice': { const o = r.options, c = o.indexOf(r.get()); r.set(o[((c < 0 ? 0 : c + d) % o.length + o.length) % o.length]); break; }
        case 'num': { const st = r.step || (r.max - r.min) / 10; r.set(Math.max(r.min, Math.min(r.max, +(r.get() + d * st).toFixed(6)))); break; }
        case 'cycle': r.run(d); break;
        default: return;
      }
    } catch (e) { console.warn('devmenu:', r.label, e); say(`${r.label}: ${e.message || e}`, false); }
    engine()?.applyOpts?.();
    sync();
  }
  function press(i, d = 1, onPart = false) {
    const e = vis[i]; if (!e) return;
    if (e.t === 'head') {
      if (onPart && e.page.on) { act(e.page.on); return; }
      S.open[e.page.id] = !e.open; save(); sel = i; sync(true); return;
    }
    if (e.t === 'row') { sel = i; act(e.base || e.row, d); mark(); }
  }
  function pinRow(i) {
    const e = vis[i]; if (e?.t !== 'row') return;
    const id = (e.base || e.row).pin, k = S.pins.indexOf(id);
    if (k >= 0) S.pins.splice(k, 1); else S.pins.push(id);
    save(); sync(true);
  }
  function setSec(s) { if (!SECTIONS.includes(s)) return; S.sec = s; find.value = ''; sel = -1; save(); sync(true); body.scrollTop = 0; }

  root.addEventListener('mousedown', e => { if (e.target !== find) e.preventDefault(); });   // (clicks keep the search's focus)
  root.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { show(false); return; }
    const sb = e.target.closest('[data-sec]'); if (sb) { setSec(sb.dataset.sec); return; }
    const el = e.target.closest('[data-r]'); if (!el) return;
    const i = +el.dataset.r;
    if (e.target.closest('[data-pin]')) { pinRow(i); return; }
    press(i, +(e.target.closest('[data-d]')?.dataset.d || 1), !!e.target.closest('[data-on]'));
  });
  find.addEventListener('input', () => { sel = -1; sync(true); body.scrollTop = 0; });
  // the search box's keys never reach the game (F-keys but F10 do: F3, F4 ...)
  find.addEventListener('keydown', e => {
    const k = e.key;
    if (/^F\d+$/.test(k) && k !== 'F10') return;
    e.stopPropagation();
    if (k === 'F10' || (k === 'Escape' && !find.value)) { e.preventDefault(); show(false); return; }
    if (k === 'Escape') { find.value = ''; sel = -1; sync(true); return; }
    if (k === 'Tab') {
      e.preventDefault();
      const secs = SECTIONS.filter(s => nav.querySelector(`[data-sec="${s}"]`)), j = secs.indexOf(S.sec);
      if (secs.length) setSec(secs[((j + (e.shiftKey ? -1 : 1)) % secs.length + secs.length) % secs.length]);
      return;
    }
    const nav2 = vis.map((x, i) => x.t === 'row' || x.t === 'head' ? i : -1).filter(i => i >= 0);
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      e.preventDefault(); if (!nav2.length) return;
      const j = nav2.indexOf(sel), d = k === 'ArrowDown' ? 1 : -1;
      sel = nav2[j < 0 ? (d > 0 ? 0 : nav2.length - 1) : Math.max(0, Math.min(nav2.length - 1, j + d))]; mark(); return;
    }
    if (sel < 0) return;
    if (k === 'Enter') { e.preventDefault(); press(sel, 1); return; }
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && !find.value) {
      e.preventDefault(); const x = vis[sel], d = k === 'ArrowRight' ? 1 : -1;
      if (x.t === 'head') { if ((d > 0) !== x.open) press(sel); } else if (x.row.kind !== 'act') press(sel, d);
    }
  });

  function show(v) {
    v = !!v && host.dev && game()?.mode !== 'title';
    F.on = v; root.classList.toggle('hidden', !v);
    if (!v) { if (document.activeElement === find) find.blur(); return; }
    const u = uiUnit(); root.style.setProperty('--u', u + 'px'); document.documentElement.style.setProperty('--dm-u', u + 'px');
    sync(true); tick = TICK;
    find.focus({preventScroll: true}); find.select();
  }

  const F = {
    name: 'devmenu', label: 'Dev menu', on: false,
    open: () => show(true),
    onKey(k, e) { if (k !== 'f10') return false; e?.preventDefault(); show(!F.on); return true; },
    // the player's Esc menu: a way here (ui/pause.js GAME_ROWS)
    menu: () => host.dev && game()?.mode !== 'title' ? [{label: 'Dev menu (F10)', run: () => show(true)}] : [],
    frame({dt}) {
      if (!host.dev || game()?.mode === 'title') { show(false); return; }
      if (msgT > 0 && (msgT -= dt) <= 0) { foot.textContent = ''; foot.className = ''; }
      if ((tick -= dt) > 0) return;
      tick = TICK; sync();
    },
  };
  return F;
}
