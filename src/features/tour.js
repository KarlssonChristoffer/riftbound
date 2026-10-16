// TOUR: the guided playtest tour. A card in the top-right corner walks you through the game one STOP at a time
// (content/tour.js STOPS, then the features' own F.tour?() stops, then LAST): each stop puts you somewhere, sets the
// hour, the weather, the season and the camera, puts things in the pack, and lists a few things to do there. A task
// that knows its event or state ticks itself; the stop's done when they all have.
//   ?tour=1 starts it (from where you left it; ?tour=restart from the first stop; ?tour=<stop id> from that stop), in the
//   sandbox with the forest (game/game.js, core/session.js). Esc > Sandbox > Tour: start it, jump to any stop, end it.
//   Keys while it runs: PgDn the next stop, PgUp back, H hides / shows the card.
// The world's presets apply offline only: in co-op the server owns the clock and the weather (the card says so).
// While it runs the day is 60 real minutes long (a dusk stays dusk while you play it); the end gives the world its own
// clock, weather and season back.
// OWNS: the tour's progress (which stop, the tasks done: localStorage 'riftbound.tour'), the card. Writes nothing of
// another system's but through its API: host.teleport, env.setHour / setSeason / settle / setWeather / setDayMinutes,
// pack.give, gear.wear, chasecam.setView, uncanny.toggle, and the features' own Sandbox rows (F.menu: run as if clicked).
// READS: the events (a task's ev), pack counts, gear worn, body wet / cold, chasecam's view, ice.onIce.
// BUDGET: sim: the step's events against a stop's few tasks; a check poll 4 times a second. HD: a frame and ~15 lines of
// pixel text; the lines are laid out again only when something on the card changes.
import {flags} from '../core/flags.js';
import {LOAD_ORDER} from '../core/features.js';
import {STOPS, LAST} from '../content/tour.js';
import {WEATHER} from '../sim/wxclock.js';
import {gearById} from '../content/gear.js';
import {hdUnit, hdFrame, hdText, hdFont} from '../ui/hdpixel.js';

const FLAG = flags.get('tour');
const SAVE = 'riftbound.tour', DAY_MIN = 60, POLL = .25;
const LOGS = ['log', 'birch_log', 'pine_log', 'aspen_log', 'willow_log', 'rowan_log', 'deadwood'];
const MOVE = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const COL = {head: '#c9a86a', title: '#f2d27a', where: '#b8ad98', todo: '#f4efe4', done: '#9ed07a', look: '#a89f8e', foot: '#8c826f', warn: '#e8a070'};

// the tour plays in the sandbox and after the coop (its online word is read)
export const order = {after: ['game', 'coop']};

export async function create(host) {
  const game = () => host.feature('game'), coop = () => host.feature('coop'), online = () => !!coop()?.online;
  const pack = () => host.feature('pack'), gear = () => host.feature('gear');

  let on = false, idx = 0, pending = -1, list = STOPS, hidden = false, pollT = 0, cheered = false, uncannyMine = false;
  let counts = [], prog = {}, clock0 = null, savedAt = null, hasCounted = false, wasOnline = false;
  try { const sv = JSON.parse(localStorage.getItem(SAVE) || 'null'); if (sv?.prog) prog = sv.prog; if (sv?.at) savedAt = sv.at; } catch (e) {}
  const save = () => { try { localStorage.setItem(SAVE, JSON.stringify({at: list[idx]?.id, prog})); } catch (e) {} };
  const cur = () => on ? list[idx] : null;
  const isDone = (s, k) => ((prog[s.id] || 0) >> k & 1) === 1;
  const counted = t => !!(t.ev || t.check);
  const allDone = s => s.tasks.every((t, k) => !counted(t) || isDone(s, k));

  // a feature's Sandbox row by the start of its label (run as if clicked)
  // (its F.menu rows, else its F.dev rows: there the 'Feature: ' prefix may be gone, docs/DEVMENU.md)
  function rowOf(name, prefix) {
    const f = host.feature(name); if (!f) return null;
    for (const r of f.menu?.() || []) if (r.label.startsWith(prefix)) return r;
    const bare = prefix.replace(/^[^:]+:\s*/, '');
    for (const r of f.dev?.rows?.() || []) if (r.run && (r.label.startsWith(prefix) || r.label.startsWith(bare))) return r;
    return null;
  }
  // T: what a stop's setup / leave / check sees (content/tour.js)
  const T = {
    mem: {},
    get forest() { return host.layout?.forest || null; }, get cave() { return host.world?.cave || null; },
    get player() { return host.player; }, get keys() { return host.keys; }, get env() { return host.env; },
    feat: n => host.feature(n),
    go: (x, y) => host.teleport(x, y),
    row(name, prefix) { const r = rowOf(name, prefix); if (!r) { console.warn('tour: no Sandbox row', name, prefix); return false; } r.run(); return true; },
    // a row that flips a setting ('... (off)' / '... (on)' / '...: on'): run it only if it isn't already as wanted
    toggle(name, prefix, want) { const r = rowOf(name, prefix); if (!r) return false; if (/(\(on\)|: on)\s*$/.test(r.label) !== want) r.run(); return true; },
    give(id, n = 1) { const pk = pack(); if (!pk) return; const have = pk.count(id) || 0; if (have < n) pk.give(id, n - have); },
    has: id => (pack()?.count(id) || 0) > 0,
    wear(id) { const g = gear(); if (g && !g.S.worn.includes(id)) g.wear(id); },
    view: () => host.feature('chasecam')?.info?.().view ?? '',
    sprinting() { if (!host.keys.has('shift')) return false; for (const k of MOVE) if (host.keys.has(k)) return true; return false; },
    body: k => +(host.feature('body')?.[k] || 0),
    logKinds() { const pk = pack(); let n = 0; if (pk) for (const id of LOGS) if (pk.count(id) > 0) n++; return n; },
    charms() { const w = gear()?.S.worn || []; let n = 0; for (const id of w) if (gearById(id)?.slot === 'charm') n++; return n; },
    release,   // (the last stop: the world's own clock and weather back)
  };

  // ---------------------------------------------------------------- the world's presets (offline: the server owns them online)
  function applyWorld(w) {
    const E = host.env; if (!w || !E || online()) return;
    if (!clock0) clock0 = {min: E.TUNE.dayMinutes, frozen: E.frozen};
    E.setDayMinutes(DAY_MIN);
    E.setSeason(w.season || 'summer');
    if (w.hour != null) E.setHour(w.hour);
    const wx = w.weather || 'fair';
    E.settle(wx, w.wet ?? (WEATHER[wx]?.precip ? null : 0), w.snow ?? (w.season === 'winter' ? null : 0));   // (at once, the ground with it: rain wets it, snow covers it, fair dries it; no snow out of winter)
  }
  function release() {
    const E = host.env; if (!E || online() || !clock0) return;
    E.setSeason(null); E.setWeather(null); E.setDayMinutes(clock0.frozen ? 0 : clock0.min); clock0 = null;
  }

  // ---------------------------------------------------------------- the stops
  function build() {
    const extra = [];
    for (const n of LOAD_ORDER) { const f = host.feature(n); if (!f?.tour || n === 'tour') continue; try { for (const s of f.tour() || []) extra.push({section: 'New tonight', ...s}); } catch (e) { console.warn('tour: stops of', n, e); } }
    list = [...STOPS, ...extra, LAST];
  }
  const find = id => list.findIndex(s => s.id === id);
  function leave() {
    const s = cur(); if (!s) return;
    try { s.leave?.(T); } catch (e) { console.warn('tour: leaving', s.id, e); }
    if (uncannyMine) { const u = host.feature('uncanny'); if (u?.on) u.toggle(); uncannyMine = false; }
  }
  function enter(i) {
    leave();
    idx = Math.max(0, Math.min(list.length - 1, i)); on = true;
    const s = list[idx];
    T.mem = {}; counts = s.tasks.map(() => 0); hasCounted = s.tasks.some(counted); cheered = allDone(s); pollT = 0; dirty++;
    applyWorld(s.world);
    if (s.view != null) host.feature('chasecam')?.setView?.(s.view);
    if (s.uncanny) { const u = host.feature('uncanny'); if (u && !u.on && u.toggle) { u.toggle(); uncannyMine = true; } }
    try { s.setup?.(T); } catch (e) { console.warn('tour: setting up', s.id, e); }
    save();
  }
  function start(i) { build(); pending = i; hidden = false; host.uiSound?.('open'); }
  function end() { leave(); release(); on = false; pending = -1; save(); host.uiSound?.('back'); }
  function tick(s, k) {
    prog[s.id] = (prog[s.id] || 0) | 1 << k; dirty++; save();
    if (!cheered && allDone(s)) { cheered = true; host.uiSound?.('confirm'); } else host.uiSound?.('click');
  }

  let boot = FLAG;   // (?tour: started on the first step, once every feature is there to bring its stops)

  // ---------------------------------------------------------------- the card (HD layer): laid out on change
  let dirty = 1, lines = [], cardW = 0, cardH = 0;
  const laid = [0, 0, 0];
  // lay out the card's lines (each {s, col, x, gap}) for a width of W display px at UI pixel u
  function layout(q, u, W) {
    const s = cur(), out = [], inner = W - 16 * u;
    q.font = hdFont(u);
    const push = (str, col, x = 0, gap = 0) => out.push({s: str, col, x, gap});
    const para = (str, col, x = 0, gap = 0) => {   // word-wrapped, the wrapped lines indented to x
      let line = '', first = true;
      for (const w of str.split(' ')) {
        const t = line ? line + ' ' + w : w;
        if (line && q.measureText(t).width > inner - x) { push(line, col, first ? 0 : x, first ? gap : 0); first = false; line = w; }
        else line = t;
      }
      if (line) push(line, col, first ? 0 : x, first ? gap : 0);
    };
    if (hidden) { push(`TOUR ${idx + 1}/${list.length}  ${s.title}  (H)`, COL.head); return out; }
    push(`TOUR ${idx + 1}/${list.length}  ·  ${(s.section || '').toUpperCase()}`, COL.head);
    push(s.title, COL.title, 0, 2 * u);
    para(s.where, COL.where);
    if (online() && s.world) para('Co-op: the server keeps its own clock and weather here', COL.warn);
    const ind = q.measureText('[x] ').width;
    s.tasks.forEach((t, k) => {
      const c = counted(t), d = c && isDone(s, k), n = t.n || 1;
      const mark = !c ? '-   ' : d ? '[x] ' : '[ ] ', tail = c && !d && n > 1 ? `  ${Math.min(counts[k], n)}/${n}` : '';
      para(mark + t.text + tail, !c ? COL.look : d ? COL.done : COL.todo, ind, k === 0 ? 4 * u : 2 * u);
    });
    if (hasCounted && allDone(s)) para('All done! PgDn: the next stop', COL.done, 0, 4 * u);
    else para(idx === list.length - 1 ? 'The last stop. Esc > Sandbox > Tour ends it' : 'PgDn next  ·  PgUp back  ·  H hide', COL.foot, 0, 4 * u);
    return out;
  }

  const F = {
    name: 'tour', label: 'Playtest tour', on: true,
    get running() { return on; }, get stop() { return cur()?.id || null; },
    update(dt, evs) {
      if (boot && game()?.mode && game().mode !== 'title') {
        build(); if (boot === 'restart') prog = {};
        pending = boot === 'restart' ? 0 : find(boot) >= 0 ? find(boot) : Math.max(0, find(savedAt)); boot = null;
      }
      if (pending >= 0 && game()?.mode && game().mode !== 'title') { const i = pending; pending = -1; enter(i); }
      const s = cur(); if (!s) return;
      for (let j = 0; j < evs.length; j++) {
        const e = evs[j];
        for (let k = 0; k < s.tasks.length; k++) {
          const t = s.tasks[k]; if (!t.ev || isDone(s, k)) continue;
          if (t.ev === e.type || (typeof t.ev !== 'string' && t.ev.includes(e.type))) {
            let ok = true; try { ok = !t.when || !!t.when(e, T); } catch (er) { ok = false; }
            if (ok && ++counts[k] >= (t.n || 1)) tick(s, k); else if (ok) dirty++;
          }
        }
      }
      if ((pollT -= dt) <= 0) {
        pollT = POLL;
        for (let k = 0; k < s.tasks.length; k++) { const t = s.tasks[k]; if (!t.check || isDone(s, k)) continue; let ok = false; try { ok = !!t.check(T); } catch (er) {} if (ok) tick(s, k); }
        if (online() !== wasOnline) { wasOnline = online(); dirty++; }
      }
    },
    onKey(k, e) {
      if (!on || host.lock) return false;
      if (k === 'pagedown' || k === 'pageup') { e?.preventDefault?.(); const i = idx + (k === 'pagedown' ? 1 : -1); if (pending < 0 && i >= 0 && i < list.length) { pending = i; host.uiSound?.('click'); } return true; }
      if (k === 'h' && !e?.shiftKey && !e?.ctrlKey) { hidden = !hidden; dirty++; return true; }
      return false;
    },
    hd(q) {
      if (!on || host.hudOff || host.paused || host.photoOpen) return;
      const u = hdUnit(), cw = q.canvas.width, W = Math.min(200 * u, Math.max(120 * u, Math.round(cw * .34 / u) * u));
      if (dirty !== laid[0] || u !== laid[1] || W !== laid[2]) {
        laid[0] = dirty; laid[1] = u; laid[2] = W; lines = layout(q, u, W);
        q.font = hdFont(u); let w = 0; for (const l of lines) w = Math.max(w, l.x + q.measureText(l.s).width);
        cardW = hidden ? Math.ceil(w / u) * u + 16 * u : W; cardH = 8 * u; for (const l of lines) cardH += 12 * u + l.gap;
        cardH += 2 * u;
      }
      const x = cw - cardW - 6 * u, y = 6 * u;
      hdFrame(q, x, y, cardW, cardH, u);
      let ly = y + 6 * u;
      for (const l of lines) { ly += 12 * u + l.gap; hdText(q, l.s, x + 8 * u + l.x, ly - 2 * u, u, l.col); }
    },
    // the Esc menu's Game tab (ui/pause.js GAME_ROWS): start it, step it, end it
    menu() {
      if (!on) {
        const at = find(savedAt);
        return [{label: 'Playtest tour: start' + (at > 0 ? ` (from ${list[at].title})` : ''), run: () => start(Math.max(0, at))},
          ...(at > 0 ? [{label: 'Playtest tour: start from the first stop', run: () => { prog = {}; start(0); }}] : [])];
      }
      return [{label: 'Playtest tour: the next stop (PgDn)', run: () => { pending = Math.min(list.length - 1, idx + 1); }},
        {label: 'Playtest tour: back a stop (PgUp)', run: () => { pending = Math.max(0, idx - 1); }},
        {label: `Playtest tour: ${hidden ? 'show' : 'hide'} the card (H)`, run: () => { hidden = !hidden; dirty++; }},
        {label: 'Playtest tour: end it (the world\'s own weather and clock back)', run: end}];
    },
    // the dev menu (F10, docs/DEVMENU.md): the same, and a jump to any stop
    dev: {group: 'Panels', rows() {
      const rows = F.menu();
      for (let i = 0; i < list.length; i++) { const s = list[i]; rows.push({label: `${i + 1}. ${s.section || ''}: ${s.title}${s.tasks.some(counted) && allDone(s) ? ' (done)' : ''}${on && i === idx ? ' <' : ''}`, run: () => start(i)}); }
      return rows;
    }},
    hud: () => on ? `tour: ${idx + 1}/${list.length} ${cur()?.id}${pending >= 0 ? ' (going to ' + pending + ')' : ''}` : '',
  };
  return F;
}
