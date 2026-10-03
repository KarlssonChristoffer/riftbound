// STAGE OMENS (the game's rules through the living world). As a run's stage arrives it may roll an OMEN (content/omens.js:
// the table, the chance by stage, the tuning): the arrive banner names it and its rule (ui/hud.js note), a HUD icon keeps it
// on screen with a tooltip (omens/hud.js), and it changes the stage's rules THROUGH the world's own systems, so you see and
// hear it:
//   the weather   sim/env.js setWeather(w, ease): locked for the stage, rolling in over TUNE.ease s (rain, storm clouds,
//                 fog; the wind feature, grass, trees, cloth and the audio follow env.windLevel / env.sky by themselves)
//   the clock     env.setHour + setDayMinutes(0): held at the omen's hour (a blood moon's night, the golden hour)
//   the light     env.setGrade('omen', g): a colour grade over the mood, eased in and out here (g.k); the lantern through
//                 host.mods 'light.lantern' (render/lighting.js)
//   the rules     host.mods notes under 'omen' (combat's brutes, the arrows' wind, the player's run, the lantern), combat's hit
//                 mods (a hit's crit / damage), and each omen's own sim (omens/storm.js: lightning)
// It passes when the stage is cleared (or the run ends): the notes and the hit mod go at once, the weather lock and the
// clock's hold are given back (only if nobody changed them since), the grade eases out; the clock's hour stays in a run
// (the next stage sets its own), and is put back when you leave the run or switch a sandbox omen off.
//   omens/storm.js  Thunderstorm (telegraphed strikes, rods)   omens/gale.js   Gale (drift, the run with / against the wind)
//   omens/fog.js    Rift Fog (veiled enemies, eyes, crits)     omens/moons.js  Blood Moon, Eclipse, Golden Hour
//   omens/kit.js    rings, eyes                                omens/hud.js    the icon + tooltip
// ON / OFF: off by default. ?omens=1 (or the Dev tab's 'Stage omens' toggle, remembered: localStorage 'rb.omens') rolls them
// in runs; ?omen=<id> brings that one on every stage (and in the sandbox from the start). In the sandbox the menu's Game tab
// has a row per omen to force it on and off (while omens are on). Off, nothing here runs or draws (no generator draws, no
// notes, no menu rows but the Dev toggle).
// SIM vs VIEW: update() is the truth (the roll, strikes, regen: its own generator, seeded from the clock like the game's);
// view / frame / lights / hd are presentation (viewRandom), writing only their own state and the view-side APIs (the grade's
// k, world.veil).
// OWNS: whether omens are on, the active omen {def, stage, t}, its generator, the 'omen' notes and grade, what it locked in
//   the clock. READS: the game (mode, phase, run, ui, stats), host.env, combat's core, lights, weather, audio, host.wind.
// EMITS: omen.begin, omen.end (+ omens/storm.js: omen.strike, player.hit / hurt). BUDGET: sim ~.01-.03 ms a step, view
//   ~.05 ms (a storm's bolt, the fog's banks); nothing while no omen is up.
import {flags} from '../core/flags.js';
import {mulberry32} from '../core/rng.js';
import {clearArray} from '../core/mathx.js';
import {OMENS, TUNE, omenById} from '../content/omens.js';
import {createKit} from './omens/kit.js';
import {createStorm} from './omens/storm.js';
import {createGale} from './omens/gale.js';
import {createFog} from './omens/fog.js';
import {createBloodMoon, createEclipse, createGolden} from './omens/moons.js';
import {createOmenHud} from './omens/hud.js';

const KEY = 'rb.omens';
const END = {clear: 1, pick: 1, portal: 1, travel: 1, won: 1, over: 1};   // a run's phases where a stage's omen has passed
const FIGHT = {wave: 1, lull: 1};                                          // ... and where its hazards are live

// ORDER (core/features.js): it reads this step's fight (combat moved the brutes, lights lit and burned, the weather ran)
export const order = {after: ['combat', 'lights', 'weather']};
export async function create(host) {
  const Q = flags, env = host.env;
  let saved = false; try { saved = localStorage.getItem(KEY) === '1'; } catch (e) {}
  const force = omenById(Q.get('omen'))?.id || null;
  let enabled = Q.get('omens') === '1' || !!force || (Q.get('omens') !== '0' && saved);
  // the sim's own draws (core/rng.js): seeded from the clock, as the game's run is (no Math.random: off, nothing is drawn)
  const R = mulberry32(((Date.now() % 2147483646) ^ 0x6f6d656e) | 0);
  const game = () => host.feature('game'), core = () => host.feature('combat')?.core || null;
  const K = Object.assign(createKit(host), {R, core, game});
  const MOD = {storm: createStorm(host, K), gale: createGale(host, K), riftfog: createFog(host, K), bloodmoon: createBloodMoon(host, K),
    eclipse: createEclipse(host, K), golden: createGolden(host, K)};
  const hud = createOmenHud(host);
  let active = null, lastId = null, seenRun = null, seenStage = -1, sandboxTried = false;
  let grade = null, gradeOut = null;   // the grade env reads (k eased by the view), the last one easing out
  const held = {lock: null, mine: null, hour: null, myHour: null, frozen: false, dayMin: 20, froze: false};
  const hitMod = (p, o, M) => { const m = active?.m; if (m?.hit) m.hit(p, o, M); };

  const nameOf = def => def.frostName && host.biome.id === 'frost' ? def.frostName : def.name;
  function begin(def, stage) {
    if (active) end(false);
    const sk = stage >= 0 ? stage : TUNE.sandboxStage, m = MOD[def.id], w = def.world || {};
    active = {def, m, stage, sk, t: 0, name: nameOf(def)}; lastId = def.id;
    // the weather (locked for the stage, rolling in), the clock (held), the light (a grade, eased in by the view)
    const wt = host.biome.id === 'frost' && w.frost ? w.frost : w.weather;
    if (wt) { held.lock = env.weatherLock; held.mine = wt; env.setWeather(wt, TUNE.ease); }
    else held.mine = null;
    if (w.hour !== undefined) {
      held.hour = env.hour; held.frozen = env.frozen; held.dayMin = env.TUNE.dayMinutes; held.myHour = w.hour; held.froze = true;
      env.setHour(w.hour); env.setDayMinutes(0);
    } else held.froze = false;
    if (w.grade) { grade = Object.assign({k: 0}, w.grade); env.setGrade('omen', grade); gradeOut = null; }
    // the rules
    const notes = m.notes?.(sk);
    if (notes?.length) host.mods.set('omen', notes);
    core()?.hitMod?.(hitMod, true);
    m.begin?.(sk);
    host.events.push({type: 'omen.begin', id: def.id, stage});
    const g = game();
    if (g?.ui) {
      if (stage >= 0) g.ui.note((def.good ? 'Blessing · ' : 'Omen · ') + active.name, def.rule, def.col);
      else g.ui.banner(active.name, def.rule, 3.4, def.col);
    }
  }
  // the omen passes. stageOver: the stage was cleared and the run goes on (the hour stays: the next stage sets its own)
  function end(stageOver) {
    if (!active) return;
    const {def, m} = active;
    m.end?.();
    core()?.hitMod?.(hitMod, false);
    host.mods.clear('omen');
    if (held.mine && env.weatherLock === held.mine) env.setWeather(held.lock, TUNE.ease * 2);
    held.mine = null;
    if (held.froze) {
      if (!stageOver && Math.abs(env.hour - held.myHour) < .01) env.setHour(held.hour);
      if (env.frozen && !held.frozen) env.setDayMinutes(held.dayMin);
      held.froze = false;
    }
    if (grade) { gradeOut = grade; grade = null; }   // (the view eases it out: F.on holds while it does)
    host.events.push({type: 'omen.end', id: def.id});
    if (stageOver) game()?.ui?.toast(`${active.name} passes`, '', def.col);
    active = null;
  }
  // a stage arrives: maybe an omen (the forced one, else by chance, never the same twice in a row)
  function roll(stage) {
    if (force) return begin(omenById(force), stage);
    const ch = TUNE.chance[Math.min(stage, TUNE.chance.length - 1)];
    if (R() >= ch) return;
    let tot = 0;
    for (const o of OMENS) if (stage >= o.from && o.id !== lastId) tot += o.weight;
    let r = R() * tot;
    for (const o of OMENS) if (stage >= o.from && o.id !== lastId && (r -= o.weight) <= 0) return begin(o, stage);
  }
  function save() { try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch (e) {} }

  const F = {
    name: 'omens', label: 'Stage omens',
    get on() { return enabled || !!active || !!gradeOut; },
    get active() { return active; }, MOD, TUNE,
    toggle() { enabled = !enabled; save(); if (!enabled) end(false); return enabled; },
    force(id) { const def = omenById(id); if (!def) { end(false); return; } if (active?.def.id === id) end(false); else begin(def, -1); },

    update(dt, evs) {
      const g = game(); if (!g) return;
      if (g.mode === 'run' && g.run) {
        if (active && active.stage < 0) end(false);   // a sandbox omen doesn't follow you into a run
        if (g.phase === 'arrive' && (seenRun !== g.run || seenStage !== g.run.stage)) {
          seenRun = g.run; seenStage = g.run.stage;
          if (enabled) roll(g.run.stage);
        }
        if (active && END[g.phase]) end(g.phase === 'clear' || g.phase === 'pick' || g.phase === 'portal');
      } else {
        if (active && (active.stage >= 0 || g.mode !== 'sandbox')) end(false);   // left the run (or the sandbox: the title)
        if (g.mode === 'sandbox' && force && !sandboxTried) { sandboxTried = true; begin(omenById(force), -1); }
      }
      if (!active) return;
      active.t += dt;
      const fight = active.stage < 0 || !!FIGHT[g.phase];
      active.m.update?.(dt, evs, fight);
    },

    view(dt, evs) {
      if (grade) grade.k = Math.min(1, grade.k + dt / TUNE.ease);
      if (gradeOut) { gradeOut.k -= dt / TUNE.ease; if (gradeOut.k <= 0) { if (!grade) env.clearGrade('omen'); gradeOut = null; } }
      active?.m.view?.(dt, evs);
    },
    frame({t}) { active?.m.frame?.(t); },
    lights() { clearArray(LL); active?.m.lights?.(LL); return LL; },
    hd(q, sc) {
      if (!active) return;
      const m = active.m; let alert = 0;
      if (m.marks) for (const x of m.marks) if (x.on) alert = 1;
      hud.draw(q, sc, active.def, active.name, active.t, alert, active.def.id === 'gale' ? m.dir : null);
    },
    menu() {   // the sandbox, while omens are on: force each omen on / off (the Game tab)
      const g = game(); if (g?.mode !== 'sandbox' || !(enabled || active)) return [];
      return OMENS.map(o => ({label: `Omen: ${o.name}${active?.def.id === o.id ? '  (on)' : ''}`, run: () => F.force(o.id)}));
    },
    hud: () => active ? `omen ${active.def.id} (${active.stage < 0 ? 'sandbox' : 'stage ' + (active.stage + 1)}, ${active.t.toFixed(1)} s)` : enabled ? 'omens on' : '',
  };
  const LL = [];
  return F;
}
