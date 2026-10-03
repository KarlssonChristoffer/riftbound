// CHEATS: the Proving Grounds' cheat panel (F2 in dev mode; also Menu > Dev > Other > Cheat panel). God mode, the damage
// you deal, move speed, no cooldowns, endless ammo, heal, gold, teleport; spawn enemies near you or where you click (the
// run's brutes anywhere, the desert's gunmen in its sandbox), kill or clear them all, the gunmen's raids; game speed and
// the world's dials (biome, time, weather).
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it). F.on is the panel
// showing. Its update (the sim step) carries out what the panel asked for, so spawns, kills and teleports land inside a
// step like any other sim change; its frame draws the placing ring and refreshes the panel (4 times a second).
// Every lasting cheat is a MODIFIER note under the source 'cheats' (core/modifiers.js), applied by the stat's owner:
//   game.hurt x 0 (god: game/stats.js)        combat.cd.<slot> x 0 (combat/core.js)    player.speed x (player.js)
//   weapon.endless (sim/player/gun.js)        sim.speed x (core/loop.js)               foes.raids x 0 (features/foes/sim.js)
// and the damage you deal is combat's hit mod (combat/core.js hitMod). They hold in DEV MODE only: when it goes off (a
// run without ?dev=1) the notes go, and they come back with it. Remembered on this machine ('rb.cheats').
// Enemies it spawns: the run's (game/enemies.js spawnEnemy: brute, elite, champion; they hunt you, and in the sandbox
// they make it a fight: game/game.js stakes) and the gunmen (features/foes.js: its sim's spawnAt / spawnGang, only where
// it is on: the desert sandbox).
// OWNS: the panel (#cheats + its style), the 'cheats' notes, its hit mod, placing (the next click on the world).
// READS: host (the game, combat, foes, the player, the world, env), the camera's offset (cam: the cursor's ground point).
// BUDGET: closed and no cheat on: nothing. Open: a few text writes 4 times a second; placing: 10 points a frame.
import {spawnEnemy, scaleOf, ENEMIES} from '../game/enemies.js';
import {TYPES} from '../content/foes.js';
import {roamable} from '../world/world.js';
import {WEATHER} from '../sim/env.js';
import {mulberry32} from '../core/rng.js';
import {hypot2, TAU} from '../core/mathx.js';

const STORE = 'rb.cheats';
const DEF = {open: false, god: false, dmg: 1, speed: 1, nocd: false, ammo: false, sim: 1, raids: true, n: 1, at: 'near'};
const OPT = {dmg: [1, 2, 5, 10, 100], speed: [1, 1.5, 2, 3], sim: [.1, .25, .5, 1, 2], n: [1, 3, 5, 10], at: ['near', 'click']};
const NEAR = [3.5, 6.5], CLICK = 1.5;   // m from you a spawn lands ("near me"); m round a clicked spot it may move to find room
const CSS = `
#cheats { position: fixed; right: 10px; top: 64px; z-index: 15; width: 256px; max-height: calc(100vh - 150px); overflow: auto; padding: 8px 8px 6px;
  background: rgba(14, 16, 15, .93); border: 1px solid var(--line); border-radius: 6px; scrollbar-width: thin; user-select: none; }
body:has(#pause:not(.hidden)) #cheats { visibility: hidden; }
body:has(#cheats:not(.hidden)) #help { right: 276px; max-width: calc(100vw - 690px); }   /* (the key help moves out from under it, clear of the health bar) */
#cheats header { display: flex; justify-content: space-between; align-items: baseline; padding: 0 4px; }
#cheats header b { color: var(--key); letter-spacing: .14em; }
#cheats header small, #cheats .c-stat, #cheats .c-note { color: var(--dim); }
#cheats .c-stat { padding: 2px 4px 0; }
#cheats h5 { margin: 9px 4px 2px; font-size: 10px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--dim); }
#cheats .c-row { display: flex; justify-content: space-between; gap: 8px; width: 100%; padding: 2px 4px; font: inherit; color: var(--ink); text-align: left;
  background: none; border: 0; border-radius: 3px; cursor: pointer; }
#cheats .c-row:hover { background: rgba(255, 255, 255, .07); }
#cheats .c-row .v { color: var(--dim); white-space: nowrap; }
#cheats .c-row .v i { padding: 0 4px; font-style: normal; opacity: .5; }
#cheats .c-row .v i:hover { opacity: 1; }
#cheats .c-row.on .v { color: var(--key); }
#cheats .c-row.off { opacity: .45; }
#cheats .c-btns { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px 4px; }
#cheats .c-btn { flex: 1 0 auto; padding: 2px 6px; font: inherit; color: var(--ink); background: rgba(255, 255, 255, .05); border: 1px solid var(--line);
  border-radius: 4px; cursor: pointer; }
#cheats .c-btn:hover:not(:disabled) { border-color: var(--key); }
#cheats .c-btn.armed { border-color: var(--key); background: rgba(240, 192, 96, .2); }
#cheats .c-btn:disabled { opacity: .35; cursor: default; }
#cheats .c-note { padding: 0 4px; font-size: 11px; }
#cheats .c-msg { min-height: 1.45em; margin-top: 4px; padding: 0 4px; color: var(--key); }
body.c-placing #screen { cursor: cell; }`;
const fmtX = v => '×' + v;

// opts: {host, cam (the camera's offset in view px: main.js), canvas}
export function createCheats({host, cam, canvas}) {
  const P = host.player, mouse = host.mouse, R = mulberry32((Date.now() % 2147483646) + 1);
  const C = {...DEF};
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  for (const k in OPT) if (!OPT[k].includes(C[k])) C[k] = DEF[k];
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(C)); } catch (e) {} };
  const game = () => host.feature('game'), core = () => host.feature('combat')?.core, foes = () => host.feature('foes');
  const foesOn = () => { const f = foes(); return !!f?.on && host.biome.id === 'desert' && game()?.mode === 'sandbox'; };
  const desertI = () => host.BIOMES.findIndex(b => b.id === 'desert');

  // ---------------------------------------------------------------- the notes (applied on change and as dev mode turns)
  const dmgMod = (p, o, M) => { M.dmg *= C.dmg; };
  function apply() {
    const notes = [];
    if (host.dev) {
      if (C.god) notes.push({stat: 'game.hurt', mul: 0});
      if (C.speed !== 1) notes.push({stat: 'player.speed', mul: C.speed});
      if (C.nocd) for (const k of core()?.SLOTS || []) notes.push({stat: 'combat.cd.' + k, mul: 0});
      if (C.ammo) notes.push({stat: 'weapon.endless', add: 1});
      if (C.sim !== 1) notes.push({stat: 'sim.speed', mul: C.sim});
      if (!C.raids) notes.push({stat: 'foes.raids', mul: 0});
    }
    if (notes.length) host.mods.set('cheats', notes); else host.mods.clear('cheats');
    core()?.hitMod(dmgMod, host.dev && C.dmg !== 1);
  }
  const set = (k, v) => { C[k] = v; save(); apply(); sync(); };

  // ---------------------------------------------------------------- what the panel asks for: carried out in the sim step
  const queue = [];
  const ask = c => { queue.push(c); };
  let msg = '', msgT = 0;
  const say = s => { msg = s; msgT = performance.now(); };
  const nearL = [], AT = {x: 0, y: 0};
  // room for a body r m wide at (x, y): nobody there (the player, an enemy, a gunman)
  function free(x, y, r) {
    if (hypot2(x - P.x, y - P.y) < r + .6) return false;
    for (const p of host.entities.near(x, y, r + .5, nearL)) {
      if (!p.broken && !p.gone && (p.hunter || p.sparring || p.kind === 'gunman') && hypot2(p.x - x, p.y - y) < r + (p.r || .3)) return false;
    }
    return true;
  }
  const bruteOk = (x, y) => roamable(x, y) && host.elev(x, y) === 0 && !host.blocked(x, y, 0) && free(x, y, .5);   // (combat's brutes: inside the walls, the trail)
  const gunOk = (x, y) => { const n = foes()?.sim.nav; return !!n?.built && n.isOpen(x, y) && free(x, y, .5); };   // (the gunmen's own nav: the ground you walk)
  // a spot that passes test: (x0, y0) itself (r0 = 0) or between r0 and r1 m from it, the ring widening as tries fail
  function spot(test, x0, y0, r0, r1) {
    if (r0 <= 0 && test(x0, y0)) { AT.x = x0; AT.y = y0; return AT; }
    for (let k = 0; k < 60; k++) {
      const a = R() * TAU, r = r0 + (r1 - r0 + k * .08) * R(), x = x0 + Math.sin(a) * r, y = y0 + Math.cos(a) * r;
      if (test(x, y)) { AT.x = x; AT.y = y; return AT; }
    }
    return null;
  }
  function spawn(type, n, at) {
    const gun = !!TYPES[type], name = gun ? TYPES[type].name : ENEMIES[type].name, c = core();
    if (gun && !foesOn()) { say('gunmen: the Red Mesa sandbox only'); return; }
    if (!gun && !c) return;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const s = at ? spot(gun ? gunOk : bruteOk, at.x, at.y, 0, CLICK) : spot(gun ? gunOk : bruteOk, P.x, P.y, NEAR[0], NEAR[1]);
      if (!s) break;
      if (gun) foes().sim.spawnAt(type, s.x, s.y); else spawnEnemy(c, type, s.x, s.y, scaleOf(game()?.run?.stage || 0, 0));
      made++;
    }
    say(made ? `${made > 1 ? made + ' × ' : ''}${name}${made < n ? ` (room for ${made})` : ''}` : `no room there (${name})`);
  }
  function killAll() {
    const c = core(); if (!c) return;
    let n = 0;
    const kill = p => {   // through combat's damage (the number, coins, enemy.kill; a gunman's ragdoll thrown away from you)
      if (p.broken) return;
      const d = hypot2(p.x - P.x, p.y - P.y) || 1, ux = (p.x - P.x) / d, uy = (p.y - P.y) / d, o = {quiet: true, ux, uy, dir: [ux * 3, uy * 3]};
      c.damage(p, Math.ceil(p.hp), o); if (!p.broken) c.breakProp(p, o);
      n++;
    };
    for (const b of c.enemies) kill(b);
    for (const g of foes()?.sim.gang || []) kill(g.p);
    say(n ? `killed ${n}` : 'nobody to kill');
  }
  function clearAll() {   // gone without a death
    const n = (core()?.enemies.length || 0) + (foes()?.sim.alive || 0);
    core()?.clearEnemies(); foes()?.sim.removeAll();
    say(n ? `cleared ${n}` : 'nobody to clear');
  }
  function teleport(x, y) {
    if (host.blocked(x, y, host.elev(x, y))) { say("can't stand there"); return; }
    host.teleport(x, y);
  }
  function run(c) {
    const g = game();
    if (c.op === 'spawn') spawn(c.type, c.n, c.at);
    else if (c.op === 'gang') say(foes()?.spawnGang(0) ? 'a gang rides in' : 'gunmen: the Red Mesa sandbox only');
    else if (c.op === 'kill') killAll();
    else if (c.op === 'clear') clearAll();
    else if (c.op === 'tp') teleport(c.at.x, c.at.y);
    else if (c.op === 'fort') { const s = host.layout.spawn; host.teleport(s.x, s.y); }
    else if (c.op === 'heal' && g) { const h = g.stats.heal(g.stats.S.maxHp); say(h >= 1 ? `+${Math.round(h)} health` : 'already at full health'); }
    else if (c.op === 'gold' && g) { g.rewards.addGold(100); say('+100 gold'); }
  }

  // ---------------------------------------------------------------- placing: the next click on the world
  let armed = null, swallow = false;
  const G0 = {x: 0, y: 0};
  // the ground under the cursor (world m): the cursor's view-frame point at height h, h found from the ground there
  function ground(out) {
    const a = host.yaw, ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0, h = 0; i < 4; i++) {
      const vx = (mouse.x + cam.x) / host.PPM, vy = (mouse.y + cam.y + h * host.PPMH) / host.PPMY;
      out.x = vx * ca + vy * sa; out.y = -vx * sa + vy * ca;
      const e = host.elev(out.x, out.y); if (e === h) break; h = e;
    }
    return out;
  }
  function arm(a) {
    armed = armed && armed.op === a.op && armed.type === a.type ? null : a;   // (its button again: cancel)
    document.body.classList.toggle('c-placing', !!armed);
    if (armed) say(`click the ground${armed.op === 'tp' ? ' to go there' : ` for ${armed.label}`} · right-click cancels · Shift: keep going`);
    else say('');
    sync();
  }
  const disarm = () => { if (armed) arm(armed); };
  // (capture: before core/input.js's handlers, so the click places instead of shooting)
  addEventListener('mousedown', e => {
    if (!armed || e.target !== canvas || host.paused) return;
    e.preventDefault(); e.stopPropagation(); swallow = true;
    if (e.button !== 0) { disarm(); return; }
    ground(G0); ask({...armed, n: C.n, at: {x: G0.x, y: G0.y}});
    if (!e.shiftKey) disarm();
  }, true);
  addEventListener('mouseup', e => { if (swallow) { swallow = false; e.stopPropagation(); } }, true);
  const PT = {emit: true};

  // ---------------------------------------------------------------- the panel
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'cheats'; root.className = 'hidden';
  document.body.appendChild(root);
  root.addEventListener('mousedown', e => e.preventDefault());   // no focus: Space / Enter stay the game's
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; root.appendChild(e); return e; };
  const rows = [];   // each: sync() (writes only what changed)
  const put = (e, k, v) => { if (e[k] !== v) e[k] = v; };
  const head = el('header'); head.innerHTML = '<b>CHEATS</b><small>F2</small>';
  const stat = el('div', 'c-stat');
  // a switch row: label ... On / Off
  function sw(label, get, flip, note) {
    const b = el('button', 'c-row'); b.innerHTML = `<span>${label}</span><span class="v"></span>`; const v = b.lastChild;
    if (note) b.title = note;
    b.onclick = () => { flip(!get()); sync(); };
    rows.push(() => { const on = get(); put(v, 'textContent', on ? 'On' : 'Off'); b.classList.toggle('on', on); });
  }
  // a value row: label ... ‹ value ›  (‹ steps back, the rest forward)
  function val(label, text, step, dim) {
    const b = el('button', 'c-row'); b.innerHTML = `<span>${label}</span><span class="v"><i data-d="-1">‹</i><span></span><i>›</i></span>`;
    const v = b.querySelector('.v span');
    b.onclick = e => { step(e.target.dataset?.d === '-1' ? -1 : 1); sync(); };
    rows.push(() => { put(v, 'textContent', text()); if (dim) b.classList.toggle('off', dim()); });
  }
  const pick = (label, k, fmt = String) => val(label, () => fmt(C[k]), d => { const o = OPT[k]; set(k, o[(o.indexOf(C[k]) + d + o.length) % o.length]); });
  // a row of buttons: [{text, go(e), ok?() (enabled), on?() (lit), show?()}]
  function btns(list) {
    const d = el('div', 'c-btns');
    const bs = list.map(o => { const b = document.createElement('button'); b.className = 'c-btn'; b.textContent = o.text; if (o.title) b.title = o.title; b.onclick = e => { o.go(e); sync(); }; d.appendChild(b); return b; });
    rows.push(() => list.forEach((o, i) => {
      const b = bs[i]; put(b, 'disabled', o.ok ? !o.ok() : false); b.classList.toggle('armed', !!o.on?.()); put(b.style, 'display', o.show && !o.show() ? 'none' : '');
    }));
  }
  function note(text) { const n = el('div', 'c-note'); rows.push(() => { const t = text(); put(n, 'textContent', t); put(n.style, 'display', t ? '' : 'none'); }); }
  // a spawn button: now (near you), or armed for a click on the world
  const spawnBtn = (type, ok) => {
    const label = (TYPES[type] || ENEMIES[type]).name;
    return {text: label.replace(' Brute', ''), title: label, ok,
      go: () => { if (C.at === 'click') arm({op: 'spawn', type, label: label.toLowerCase()}); else ask({op: 'spawn', type, n: C.n}); },
      on: () => armed?.op === 'spawn' && armed.type === type};
  };

  el('h5', '', 'Player');
  sw('God mode', () => C.god, v => set('god', v), 'take no damage (hits still land: the flicker, the knock)');
  pick('Damage dealt', 'dmg', v => v === 100 ? 'one-shot' : fmtX(v));
  pick('Move speed', 'speed', fmtX);
  sw('No cooldowns', () => C.nocd, v => set('nocd', v), "the bow's abilities (RMB, 1-4) always ready");
  sw('Endless ammo', () => C.ammo, v => set('ammo', v), 'the revolver: the cylinder refills as it empties (a fan refills as it ends)');
  btns([{text: 'Heal', go: () => ask({op: 'heal'})}, {text: '+100 gold', go: () => ask({op: 'gold'})}]);
  btns([{text: 'Teleport…', title: 'then click where to go', go: () => arm({op: 'tp'}), on: () => armed?.op === 'tp'},
    {text: 'To the fort', go: () => ask({op: 'fort'})}]);

  el('h5', '', 'Spawn');
  pick('How many', 'n');
  pick('Where', 'at', v => v === 'near' ? 'near me' : 'where I click');
  note(() => 'brutes: hunt you anywhere');
  btns(['brute', 'elite', 'champion'].map(t => spawnBtn(t)));
  note(() => {
    const f = foes(), g = game();
    if (!f) return 'gunmen: not loaded';
    return g?.mode !== 'sandbox' ? 'gunmen: the sandbox only' : host.biome.id !== 'desert' ? 'gunmen: Red Mesa only' : !f.on ? 'gunmen: switched off (below)' : 'gunmen';
  });
  btns([...['bandit', 'sheriff', 'bruiser'].map(t => spawnBtn(t, foesOn)), {text: 'Gang', title: '2-4 ride in from the edge', ok: foesOn, go: () => ask({op: 'gang'})}]);
  btns([{text: 'Go to Red Mesa', show: () => !!foes() && game()?.mode === 'sandbox' && host.biome.id !== 'desert' && desertI() >= 0,
    go: () => { disarm(); host.setBiome(desertI()); }}]);
  btns([{text: 'Kill all', title: 'every enemy and gunman dies (coins, ragdolls)', go: () => ask({op: 'kill'})},
    {text: 'Clear all', title: 'every enemy and gunman gone, no deaths', go: () => ask({op: 'clear'})}]);
  sw('Gunmen', () => !!foes()?.on, () => foes()?.toggle(), 'the desert\'s gunmen at all (off: every one gone)');
  sw('Gunmen raids', () => C.raids, v => set('raids', v), 'gangs ride in on their own every so often (off: only the ones you spawn)');

  el('h5', '', 'World');
  pick('Game speed', 'sim', fmtX);
  val('Biome', () => host.biome.name, d => { disarm(); const n = host.BIOMES.length; host.setBiome((host.biomeI + d + n) % n); });
  val('Time', () => `${host.env.clock()} ${host.env.part}`, () => host.env.nextPart());
  val('Weather', () => host.env.weatherLock || `auto (${host.env.weather})`, d => {
    const env = host.env, o = ['auto', ...Object.keys(WEATHER).filter(w => !WEATHER[w].precip || env.TUNE.precip)];
    env.setWeather(o[((o.indexOf(env.weatherLock || 'auto') + d) % o.length + o.length) % o.length]);
  });
  const msgEl = el('div', 'c-msg');

  function sync() {
    if (!F.on) return;
    const g = game(), S = g?.stats.S, c = core(), f = foes(), parts = [];
    if (S) parts.push(`hp ${Math.ceil(S.hp)}/${S.maxHp}`);
    if (c) parts.push(`${c.gold} gold`, `${c.enemies.length} brute${c.enemies.length === 1 ? '' : 's'}`);
    if (f?.on && (f.sim.alive || foesOn())) parts.push(`${f.sim.alive} gunm${f.sim.alive === 1 ? 'a' : 'e'}n`);
    put(stat, 'textContent', parts.join(' · '));
    for (const r of rows) r();
    if (msg && !armed && performance.now() - msgT > 4000) msg = '';
    put(msgEl, 'textContent', msg);
  }
  function show() {
    const vis = F.on && host.dev && game()?.mode !== 'title';
    root.classList.toggle('hidden', !vis);
    if (!vis) disarm();
    return vis;
  }

  let devWas = null, syncT = 0;
  const F = {
    name: 'cheats', label: 'Cheat panel', key: 'f2', on: !!C.open,
    toggle() {
      if (!host.dev && !F.on) return F.on;   // (dev mode only)
      F.on = !F.on; C.open = F.on; save();
      if (show()) sync(); else disarm();
      return F.on;
    },
    update() {
      if (host.dev !== devWas) { devWas = host.dev; apply(); }   // (the first step too: the remembered cheats)
      if (!queue.length) return;
      for (const c of queue) run(c);
      queue.length = 0; syncT = 0;
    },
    frame({t, dt}) {
      if (!show()) return;
      if (host.paused) disarm();
      if ((syncT -= dt) <= 0) { syncT = .25; sync(); }
      if (!armed) return;
      ground(G0);   // the placing ring at the cursor
      const h = host.elev(G0.x, G0.y) + .03, col = armed.op === 'tp' ? '#9ad0ff' : '#ff8a5a';
      for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + t * 1.5; host.point(G0.x + Math.sin(a) * .45, G0.y + Math.cos(a) * .45, h, col, PT); }
    },
    hud() {
      if (!host.dev) return '';
      const a = [];
      if (C.god) a.push('god'); if (C.dmg !== 1) a.push(`dmg ${fmtX(C.dmg)}`); if (C.speed !== 1) a.push(`speed ${fmtX(C.speed)}`);
      if (C.nocd) a.push('no cd'); if (C.ammo) a.push('endless ammo'); if (C.sim !== 1) a.push(`game ${fmtX(C.sim)}`); if (!C.raids) a.push('no raids');
      return a.length ? `<b>cheats</b> ${a.join(' · ')}` : '';
    },
  };
  return F;
}
