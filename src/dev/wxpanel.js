// WEATHER PANEL: a dev panel (F9 in dev mode; also Menu > Dev > Other > Weather panel) to judge how a change of the weather
// plays out. A READOUT of the world clock's weather (sim/env.js) and of the god rays' strength:
//   Weather      the spell (locked or auto)
//   Change       the change in progress: env.trans (its kind, phase, k 0..1, t s); without one, the old front's edge (arriving
//                / clearing, m from the player, the storm's share of the view's light), or an ease, or steady
//   Sun / Broken the share of the view's ground the sun reaches (env.sunView) and how broken the sky over it is (env.broken);
//                "est." where the env has none and the rays work it out (render/godrays.js: 1 - .9 x cloud, a front's edge)
//   Open / Under the weather the sun gets through and the weather under the deck (env.open / env.under: cloud, rain);
//                "= light" where the env has none (both are the view's one light then)
//   At player    the weather felt where you stand (env.sky: cloud, rain), the ground's wetness, the mist's medium (G.mist)
//   God rays     the strength drawn (rays.strength: x the view's share toward the sun) and THE ENVELOPE's parts (rays.env):
//                the sun's share target -> smoothed, the air's moisture, the breakthrough (broken x moist), the boost
//                target -> smoothed, and what the old formula gives from the same inputs
//   a TRACE of the last ~2 min 20 s: the envelope's strength (gold) against the old formula's (grey), before the view's share.
// TRIGGERS: a change from a settled start (storm -> clear, clear -> storm, fair -> cloudy: the start forced as it would be
// after hours of it, the way tmp/wx/front_probe.mjs does, then env.setWeather one sim step later), Auto (the weather back to
// the climate), and the game speed x1 / x4 (a 'sim.speed' note: core/loop.js; with the cheat panel's it multiplies; the
// envelope's clock follows the game speed: rays.rate).
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it). F.on is the panel
// showing. Its update (the sim step) carries out the triggers, so a change lands inside a step like any other; its frame
// refreshes the readout 4 times a second and samples the trace twice a second while it shows.
// OWNS: the panel (#wxpanel + its style), the 'wxpanel' note (dev mode only, like the cheat panel's), the trace, rays.rate.
// WRITES (a trigger's settled start, dev only, as the probe does): env.sky / light / open / under channels, env.wet,
// env.front.on (or env.settle(w), if the world clock has one). READS: host.env, host.G (G.godrays, G.mist), host.mods.
// BUDGET: closed: nothing (a watch on the notes). Open: a few text writes and a 276 x 52 trace 4 times a second.
import {WEATHER} from '../sim/env.js';

const STORE = 'rb.wxpanel';
const CH = ['cloud', 'rain', 'snow', 'fog', 'storm', 'wind'];
const RUNS = [{from: 'storm', to: 'clear', text: 'Storm → clear'}, {from: 'clear', to: 'storm', text: 'Clear → storm'}, {from: 'fair', to: 'cloudy', text: 'Fair → cloudy'}];
const TW = 276, TH = 52, TSTEP = .5;   // the trace: px wide (one sample each), tall, s a sample (~2 min 20 s)
const CSS = `
#wxpanel { position: fixed; left: 10px; top: 64px; z-index: 15; width: 300px; max-height: calc(100vh - 150px); overflow: auto; padding: 8px 8px 6px;
  background: rgba(14, 16, 15, .93); border: 1px solid var(--line); border-radius: 6px; scrollbar-width: thin; user-select: none; }
body:has(#pause:not(.hidden)) #wxpanel { visibility: hidden; }
body:has(#gunfeel:not(.hidden)) #wxpanel { left: 276px; }
#wxpanel { overflow-x: hidden; }
#wxpanel header { display: flex; justify-content: space-between; align-items: baseline; padding: 0 4px; }
#wxpanel header b { color: var(--key); letter-spacing: .14em; }
#wxpanel header small, #wxpanel .w-note { color: var(--dim); }
#wxpanel h5 { margin: 9px 4px 2px; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
#wxpanel .w-row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 4px; color: var(--ink); }
#wxpanel .w-row .v { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--dim); white-space: nowrap; }
#wxpanel .w-row > span:first-child { flex: none; }
#wxpanel .w-row.hot .v { color: var(--key); }
#wxpanel .w-btns { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px 4px; }
#wxpanel .w-btn { flex: 1 0 auto; padding: 2px 6px; font: inherit; color: var(--ink); background: rgba(255, 255, 255, .05); border: 1px solid var(--line);
  border-radius: 4px; cursor: pointer; }
#wxpanel .w-btn:hover:not(:disabled) { border-color: var(--key); }
#wxpanel .w-btn.armed { border-color: var(--key); background: rgba(240, 192, 96, .2); }
#wxpanel .w-btn:disabled { opacity: .35; cursor: default; }
#wxpanel canvas { display: block; margin: 4px 4px 0; width: ${TW}px; height: ${TH}px; background: rgba(0, 0, 0, .35); border: 1px solid var(--line); border-radius: 3px; }
#wxpanel .w-note { padding: 0 4px; font-size: 11px; }
#wxpanel .w-note i { font-style: normal; color: var(--key); }
#wxpanel .w-msg { min-height: 1.45em; margin-top: 4px; padding: 0 4px; color: var(--key); }`;
const f2 = v => v == null || v !== v ? '–' : (+v).toFixed(2);
const chans = o => o ? `cloud ${f2(o.cloud)} · rain ${f2(o.rain)}` : '–';

// opts: {host}
export function createWxPanel({host}) {
  const C = {open: false, fast: false};
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  C.open = false;   // (closed at the start, like every dev panel: F9 opens it)
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(C)); } catch (e) {} };
  const game = () => host.feature('game'), rays = () => host.G.godrays;
  // the game speed: x4 as a note (dev mode only); the rays' envelope follows the whole game speed (every source's notes)
  function apply() {
    if (host.dev && C.fast) host.mods.set('wxpanel', [{stat: 'sim.speed', mul: 4}]); else host.mods.clear('wxpanel');
  }
  const rate = () => { const r = rays(); if (r) r.rate = Math.max(0, host.mods.value('sim.speed', 1)); };
  host.mods.watch(rate); rate();

  // ---------------------------------------------------------------- the triggers: carried out in the sim step
  let run = null, msg = '', msgT = 0;   // run: {from, to, step} (step 0: settle the start, 1: settle again and change)
  const say = s => { msg = s; msgT = performance.now(); };
  // the start as it would be after hours of it: every channel at the spell's value, the ground wet after rain or dry, no
  // change in progress (the probe's way; a world clock with its own settle(w) does it itself)
  function settle(w) {
    const env = host.env, W = WEATHER[w];
    if (typeof env.settle === 'function') { env.settle(w); return; }
    for (const o of [env.sky, env.light, env.open, env.under]) if (o) for (const c of CH) o[c] = W[c] ?? (c === 'wind' ? 1 : 0);
    env.wet = W.rain ? 1 : 0;
    if (env.front) env.front.on = false;
  }
  function stepRun() {
    const env = host.env;
    if (run.step === 0) { env.setWeather(run.from); settle(run.from); run.step = 1; return; }   // (the clock takes the spell next step: no change, it's there)
    settle(run.from); env.setWeather(run.to);
    say(`${run.from} → ${run.to}: from a settled ${run.from}`); run = null;
  }

  // ---------------------------------------------------------------- the trace (the last TW samples, TSTEP s apart)
  const TN = new Float32Array(TW), TO = new Float32Array(TW);   // the envelope's base, the old formula's
  let tI = 0, tN = 0, tT = 0;
  function sample() {
    const e = rays()?.env; if (!e) return;
    TN[tI] = e.base; TO[tI] = e.old; tI = (tI + 1) % TW; tN = Math.min(TW, tN + 1);
  }
  function plot(cv) {
    const g = cv.getContext('2d'), mx = rays()?.TUNE.max || 1.8;
    g.clearRect(0, 0, TW, TH);
    g.fillStyle = 'rgba(232, 226, 210, .08)'; for (let s = 30; s < TW * TSTEP; s += 30) g.fillRect(TW - 1 - s / TSTEP, 0, 1, TH);   // (every 30 s)
    const line = (A, col) => {
      g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
      for (let i = 0; i < tN; i++) { const v = A[(tI - tN + i + TW) % TW], x = TW - tN + i + .5, y = TH - 2 - v / mx * (TH - 4); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    };
    line(TO, 'rgba(154, 147, 127, .9)'); line(TN, '#f0c060');
  }

  // ---------------------------------------------------------------- the panel
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'wxpanel'; root.className = 'hidden';
  document.body.appendChild(root);
  root.addEventListener('mousedown', e => e.preventDefault());   // no focus: Space / Enter stay the game's
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; root.appendChild(e); return e; };
  const rows = [];   // each: sync() (writes only what changed)
  const put = (e, k, v) => { if (e[k] !== v) e[k] = v; };
  el('header').innerHTML = '<b>WEATHER</b><small>F9</small>';
  // a readout row: label ... value (hot: lit)
  function row(label, text, hot, title) {
    const r = el('div', 'w-row'); r.innerHTML = `<span>${label}</span><span class="v"></span>`; const v = r.lastChild;
    if (title) r.title = title;
    rows.push(() => { const t = text(); put(v, 'textContent', t); if (!title) put(r, 'title', t); if (hot) r.classList.toggle('hot', !!hot()); });
  }
  // a row of buttons: [{text, go(), ok?() (enabled), on?() (lit)}]
  function btns(list) {
    const d = el('div', 'w-btns');
    const bs = list.map(o => { const b = document.createElement('button'); b.className = 'w-btn'; b.textContent = o.text; if (o.title) b.title = o.title; b.onclick = () => { o.go(); sync(); }; d.appendChild(b); return b; });
    rows.push(() => list.forEach((o, i) => { put(bs[i], 'disabled', o.ok ? !o.ok() : false); bs[i].classList.toggle('armed', !!o.on?.()); }));
  }
  const env = () => host.env, R = () => rays()?.env, In = () => rays()?.In;
  // the change in progress: the env's own account (env.trans), else the old front, else an ease toward the spell, else steady
  function change() {
    const E = env(), T = E.trans, F = E.front;
    if (T) return T.kind ? `${T.kind} · ${T.phase || ''} · k ${f2(T.k)} · ${(+T.t || 0).toFixed(1)} s` : 'none';
    if (F?.on) return `${F.arrive ? 'arriving' : 'clearing'} · edge ${(+F.up).toFixed(0)} m · storm ${f2(F.storm)}`;
    const W = WEATHER[E.weather]; if (!W) return 'steady';
    let d = 0; for (const c of CH) d = Math.max(d, Math.abs((W[c] ?? (c === 'wind' ? 1 : 0)) - E.sky[c]));
    return d > .01 ? `ease (Δ ${f2(d)})` : 'steady';
  }
  el('h5', '', 'Sky');
  row('Spell', () => env().weatherLock ? `${env().weatherLock} (lock)` : `auto (${env().weather})`);
  row('Change', change, () => !!(env().trans?.kind || env().front?.on));
  row('Sun in view', () => env().sunView != null ? f2(env().sunView) : `${f2(In()?.sunView)} est.`, null, 'env.sunView: the share of the view\'s ground the sun reaches');
  row('Broken', () => `${f2(In()?.broken)}${R()?.est ? ' est.' : ''}`, () => (In()?.broken || 0) > .05, 'env.broken: how broken the sky over the view is');
  row('Open', () => env().open ? chans(env().open) : `${chans(env().light)} = light`, null, 'env.open: the weather where the sun gets through');
  row('Under', () => env().under ? chans(env().under) : `${chans(env().light)} = light`, null, 'env.under: the weather under the deck');
  row('At player', () => chans(env().sky), null, 'env.sky: the weather where you stand');
  row('Ground wet', () => f2(env().wet));
  row('Mist medium', () => `${host.G.mist?.on ? f2(host.G.mist.medium) : 'off'} · fog ${f2(env().sky.fog)}`);
  el('h5', '', 'God rays');
  row('Strength', () => { const r = rays(); return !r ? '–' : `${f2(r.strength)}${r.live ? '' : ' (off)'} · base ${f2(R()?.base)}`; }, () => rays()?.live);
  row('Sun', () => `${f2(R()?.sun)} → ${f2(R()?.sunS)}`, null, 'the sun\'s share in the beams: target -> smoothed (grows in over ~rise s, fades over ~fall s)');
  row('Moisture', () => f2(R()?.moist), null, 'the air: the ground\'s wetness, or the mist / fog');
  row('Breakthrough', () => f2(R()?.burst), () => (R()?.burst || 0) > .02, 'burst x broken x moist');
  row('Boost', () => `${f2(R()?.x)} → ${f2(R()?.xS)}`, null, 'wet ground + the breakthrough: target -> smoothed (ebbs over ~ebb s)');
  row('Old formula', () => f2(R()?.old), null, 'the old strength from the same inputs (?rayenv=0), before the view\'s share');
  row('Envelope', () => !rays() ? '–' : rays().TUNE.env ? (R()?.held ? 'preview (at once)' : `on · ×${f2(rays().rate)}`) : 'off (?rayenv=0)');
  const cv = el('canvas'); cv.width = TW; cv.height = TH;
  el('div', 'w-note').innerHTML = '<i>━</i> envelope <span>━</span> old formula · 30 s marks';
  el('h5', '', 'Change from a settled start');
  btns(RUNS.map(r => ({text: r.text, title: `force a settled ${r.from} (the ground ${WEATHER[r.from].rain ? 'wet' : 'dry'}), then the weather -> ${r.to}`,
    ok: () => !run, go: () => { run = {...r, step: 0}; tN = 0; }})));
  btns([{text: 'Auto', title: 'the weather back to the climate (the next spell it draws)', go: () => { host.env.setWeather(null); say('weather: auto'); }},
    {text: '×1', title: 'game speed as set (the cheat panel\'s)', on: () => !C.fast, go: () => { C.fast = false; save(); apply(); }},
    {text: '×4', title: 'the game (the world clock, the weather, the rays\' envelope) 4x as fast', on: () => C.fast, go: () => { C.fast = true; save(); apply(); }}]);
  const msgEl = el('div', 'w-msg');

  function sync() {
    if (!F.on) return;
    for (const r of rows) r();
    plot(cv);
    if (msg && performance.now() - msgT > 4000) msg = '';
    put(msgEl, 'textContent', msg);
  }
  function show() {
    const vis = F.on && host.dev && game()?.mode !== 'title';
    root.classList.toggle('hidden', !vis);
    return vis;
  }

  let devWas = null, syncT = 0;
  const F = {
    name: 'wxpanel', label: 'Weather panel', key: 'f9', on: !!C.open,
    toggle() {
      if (!host.dev && !F.on) return F.on;   // (dev mode only)
      F.on = !F.on; C.open = F.on; save();
      if (show()) { tN = 0; sync(); }
      return F.on;
    },
    update() {
      if (host.dev !== devWas) { devWas = host.dev; apply(); }   // (the first step too: the remembered speed)
      if (run) stepRun();
    },
    frame({dt}) {
      if (!show()) return;
      if ((tT -= dt) <= 0) { tT += TSTEP; if (tT < 0) tT = TSTEP; sample(); }
      if ((syncT -= dt) <= 0) { syncT = .25; sync(); }
    },
    hud() { return host.dev && C.fast ? '<b>weather panel</b> game ×4' : ''; },
  };
  return F;
}
