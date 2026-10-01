// THE GAME on the 3D page: the rules on top of the engine host (main.js: renderer, world, player, features).
// It plugs in as the first feature (main.js FEATURE CONTRACT; it sees keys, hits, interactions and arrows before the
// others) and drives a few host controls: host.dev (the sandbox's keys + debug HUD), host.lock (no player input),
// host.timeScale (slow motion, frozen), host.setBiome / setTime / teleport / setYaw.
//   game.js     modes, the run's phases, wiring        run.js      stages + the wave director
//   enemies.js  enemy table + scaling                  nav.js      walkable grid + flow field (steering, spawn spots)
//   items.js    items + augments (data)                stats.js    the player's numbers + health
//   hud.js      HD-overlay HUD                         screens.js  title / augment pick / run over (DOM)
//   save.js     records (localStorage)
// MODES: 'title' (the world idles behind the menu, the camera turns slowly), 'sandbox' (the Proving Grounds exactly as
// before: every dev key, the yard's sparring brutes, things restock), 'run'. ?mode=run | sandbox skips the title.
// ?dev=1 keeps the dev keys + debug HUD in a run; the key left of 1 (` or §) toggles them any time.
// A RUN: stage = a biome at a time of day (run.js STAGES). Phases: travel (the world rebuilds) -> arrive (banner) ->
// wave / lull (the director) -> clear -> pick (an augment) -> portal (chests cost gold and give items; walk into the
// portal + E) -> next stage ... -> victory. Death anywhere: slow motion, then the run's summary.
import {createStats} from './stats.js';
import {createNav} from '../world/nav.js';
import {createDirector, STAGES, TELE} from './run.js';
import {rollItem, rollAugments} from './items.js';
import {createHud} from '../ui/hud.js';
import {createScreens} from '../ui/screens.js';
import {loadSave, recordRun} from './save.js';
import {flags} from '../core/flags.js';
import {parkMiller} from '../core/rng.js';

const Q = flags;
const TAU = Math.PI * 2;

export async function createGame(host) {
  const combat = host.feature('combat');
  if (!combat) { console.warn('game: no combat feature, the game layer is off'); return {name: 'game', on: false}; }
  const core = combat.core, P = host.player;
  const rng = parkMiller((Date.now() % 2147483646) + 1);   // (core/rng.js)
  const stats = createStats(host, core), nav = createNav(host), hud = createHud(host), screens = createScreens({sound: n => host.uiSound?.(n)});
  const save = loadSave();
  const DEV = Q.get('dev') === '1';
  const base = {propRespawn: core.T.propRespawn, chestReset: core.T.chestReset};

  let boot = null, mode = 'boot', phase = '', phaseT = 0, run = null, portal = null, deadT = 0, rollT = 0, wasRoll = false, shotN = 0, goldSeen = 0, goldFrac = 0;
  const bleeds = [];
  const director = createDirector({core, nav, rng,
    onWaveClear(w, n) {
      if (stats.S.waveHeal) { const h = stats.heal(stats.S.maxHp * stats.S.waveHeal); if (h >= 1) hud.float(P.x, P.y, P.z + 2, '+' + Math.round(h), '#9af07a'); }
      if (w < n) hud.banner(`Wave ${w} cleared`, '', 1.6, '#e8e2d2');
    },
    onStageClear() { setPhase('clear'); hud.banner('Stage cleared', STAGES[run.stage + 1] ? 'choose an augment' : '', 2, '#f2d27a'); },
  });
  core.steer = b => nav.steer(b);
  core.immune = () => mode === 'run' && (phase === 'dead' || phase === 'travel' || P.raw.state === 'roll' || rollT > 0 || (P.raw.blink || 0) > 0);

  const stageName = i => host.BIOMES.find(b => b.id === STAGES[i].biome)?.name ?? STAGES[i].biome;
  const chestCost = () => Math.round(25 * (1 + .5 * (run?.stage || 0)) / 5) * 5;
  function setPhase(p) { phase = p; phaseT = 0; }
  function lock(on) { host.lock = on; if (on) { host.keys.clear(); host.mouse.down = false; } }

  // ---------------------------------------------------------------- modes
  function toTitle() {
    endRunState();
    mode = 'title'; setPhase(''); host.dev = DEV; lock(true); host.timeScale = 1; host.hudOff = true;
    screens.title(save, {run: startRun, sandbox: toSandbox, settings: () => host.openMenu?.()});
  }
  function toSandbox() {
    endRunState(); screens.hide();
    mode = 'sandbox'; setPhase(''); host.dev = true; lock(false); host.timeScale = 1; host.hudOff = false;
    stats.restore(); Object.assign(core.T, base); core.retireYard(false);
  }
  function endRunState() {   // leave a run: no enemies, no portal, the engine's own numbers
    director.stop(); core.clearEnemies(); removePortal(); bleeds.length = 0; hud.clear(); run = null;
  }
  async function startRun() {
    screens.hide(); endRunState();
    mode = 'run'; host.dev = DEV; host.timeScale = 1; host.hudOff = false;
    stats.reset(); core.S.gold = 0; goldSeen = 0; goldFrac = 0; shotN = 0;
    Object.assign(core.T, {propRespawn: 0, chestReset: 0}); core.retireYard(true);
    run = {stage: 0, kills: 0, time: 0, gold: 0, wave: 0};
    await enterStage(0);
  }
  async function enterStage(i) {
    setPhase('travel'); lock(true);
    director.stop(); core.clearEnemies(); removePortal(); bleeds.length = 0;
    run.stage = i;
    const st = STAGES[i], bi = host.BIOMES.findIndex(b => b.id === st.biome), ti = host.TIMES.indexOf(st.time);
    if (bi !== host.biomeI) await host.setBiome(bi);
    if (ti >= 0) host.setTime(ti);
    core.resetYard(); combat.phys.resetAll?.();
    const sp = host.layout.spawn; host.teleport(sp.x, sp.y);
    nav.build(); nav.update(1);
    if (mode !== 'run') return;   // left while the world was building
    lock(false); setPhase('arrive');
    hud.banner(`Stage ${i + 1} · ${stageName(i)}`, `${st.waves} waves`, 2.4);
  }
  function die() {
    setPhase('dead'); deadT = 0; lock(true); host.timeScale = .3;
    director.stop();
    hud.banner('You fell', '', 3, '#e0604a');
  }
  function finish(won) {
    lock(true); host.timeScale = 1;
    const r = {won, stage: run.stage + 1, stageName: stageName(run.stage), wave: Math.min(director.wave + 1, director.waves), time: run.time, kills: run.kills, gold: run.gold, build: stats.build()};
    const best0 = [save.bestStage, save.bestTime];
    recordRun(save, r);
    r.record = save.bestStage !== best0[0] || save.bestTime !== best0[1];
    setPhase(won ? 'won' : 'over');
    screens.over(r, {again: startRun, title: toTitle});
  }

  // ---------------------------------------------------------------- the portal: a prop you interact with (E)
  function openPortal() {
    const r = host.layout.ring;
    portal = host.entities.add({kind: 'portal', x: r.x, y: r.y - 2.2, z: 0, r: 0, interact: 'portal', opened: false, t: 0});
  }
  function removePortal() { if (!portal) return; host.entities.remove(portal); portal = null; }

  // a glowing dashed ring on the ground: one point per screen pixel round the ellipse, `on` of every `of` lit, turning
  function ring(x, y, r, col, turn, of, on) {
    const n = Math.max(12, Math.round(r * (host.PPM + host.PPMY) * 1.6)), sh = Math.floor(turn * n / TAU);
    for (let i = 0; i < n; i++) {
      if ((((i + sh) % of) + of) % of >= on) continue;
      const a = i / n * TAU; host.point(x + Math.sin(a) * r, y + Math.cos(a) * r, .03, col, {emit: true});
    }
  }

  // ---------------------------------------------------------------- run events
  function onEvents(evs) {
    for (const e of evs) {
      if (e.type === 'player.hurt' && phase !== 'dead') {
        const d = stats.hurt(e.dmg); host.PL.flicker(.9);
        hud.float(P.x, P.y, P.z + 1.9, '-' + d, '#ff6a50', true);
        if (stats.S.hp <= 0) die();
      } else if (e.type === 'enemy.kill' && e.who?.hunter) {
        run.kills++;
        if (e.who.boss) hud.banner(`${e.who.name} defeated`, '', 2, '#f2d27a');
      } else if (e.type === 'arrow.hit' && e.prop?.hunter) {
        if (stats.S.leech) { const h = stats.heal(stats.S.leech); if (h >= 1 && rng() < .5) hud.float(P.x, P.y, P.z + 2, '+' + Math.round(h), '#9af07a'); }
        if (stats.S.bleed && rng() < stats.S.bleed) { const b = bleeds.find(q => q.p === e.prop); if (b) b.left = 3; else bleeds.push({p: e.prop, left: 3, tick: .5}); }
      }
    }
  }
  function stepBleeds(dt) {
    for (let i = bleeds.length - 1; i >= 0; i--) {
      const b = bleeds[i]; b.left -= dt; b.tick -= dt;
      if (b.p.broken || b.p.dead) { bleeds.splice(i, 1); continue; }
      if (b.tick <= 0) { b.tick = .5; core.damage(b.p, 2.5 * stats.S.dmg, {quiet: true}); core.part(b.p.x, b.p.y, 1, 0, 0, -1, .4, ['#c8303a', '#8a1a22', '#5a1018'], {grav: 6}); }
      if (b.left <= 0) bleeds.splice(i, 1);
    }
  }
  function stepGold() {   // coins picked up x the gold stat (fractions carry over)
    const g = core.S.gold;
    if (g > goldSeen) {
      const d = g - goldSeen; goldFrac += d * (stats.S.gold - 1);
      const add = Math.floor(goldFrac); goldFrac -= add; core.S.gold += add; run.gold += d + add;
    }
    goldSeen = core.S.gold;
  }

  // ---------------------------------------------------------------- the feature
  const F = {
    name: 'game', label: 'Game', always: true,
    get mode() { return mode; }, get phase() { return phase; }, get run() { return run; }, stats, nav, director, ui: hud, screens, save,   // (F.hud is the dev HUD's line)
    startRun, toTitle, toSandbox, enterStage,

    update(dt, evs) {
      hud.update(dt);
      if (mode !== 'run' || !run) return;
      phaseT += dt;
      // dodge roll: untouchable while rolling, plus the Nimble window after
      const roll = P.raw.state === 'roll'; if (wasRoll && !roll) rollT = stats.S.iframe; wasRoll = roll; rollT = Math.max(0, rollT - dt);
      onEvents(evs);
      stepBleeds(dt); stepGold();
      stats.update(dt, phase !== 'dead');
      nav.update(dt);
      if (phase !== 'travel' && phase !== 'dead' && phase !== 'pick' && phase !== 'won' && phase !== 'over') run.time += dt;
      if (phase === 'arrive' && phaseT > 2.2) { setPhase('wave'); director.start(run.stage, STAGES[run.stage].waves); }
      if (phase === 'wave') { director.update(dt); run.wave = director.wave; }
      if (phase === 'clear' && phaseT > 1.6) {
        if (!STAGES[run.stage + 1]) { hud.banner('Victory', 'the Rift is closed', 3, '#f2d27a'); setPhase('won'); setTimeout(() => mode === 'run' && finish(true), 2200); return; }
        setPhase('pick'); lock(true);
        const choices = rollAugments(rng, stats.augs, 3);
        if (!choices.length) { lock(false); setPhase('portal'); openPortal(); return; }
        screens.pick(stageName(run.stage), choices, a => {
          screens.hide(); stats.addAugment(a); hud.toast(a.name, a.desc, '#f2d27a');
          lock(false); setPhase('portal'); openPortal();
        });
      }
      if (phase === 'portal' && portal) portal.t += dt;
      if (phase === 'dead') { deadT += dt / Math.max(.05, host.timeScale); if (!['hold', 'knock', 'fall'].includes(P.raw.state)) host.PL.hold('crouch', 99); if (deadT > 1.8) { host.timeScale = 1; finish(false); } }
    },

    frame({t, dt}) {
      if (boot) { const f = boot; boot = null; f(); }
      if (mode === 'title') host.setYaw(host.yaw + dt * .07);   // the slow turn behind the title
      if (mode !== 'run') return;
      // spawn telegraphs: a dashed ring that closes in, a glow rising at the centre
      for (const q of director.tele) {
        const k = q.t / TELE, col = q.boss ? '#ffb040' : q.elite ? '#ff6a40' : '#e8d8b0';
        ring(q.x, q.y, (q.boss ? 1.3 : q.elite ? .9 : .65) * (1.4 - k * .6), col, t * 1.5, 5, 3);
        if (k > .5) host.point(q.x, q.y, .1 + k * .6, '#fff4d0', {emit: true, size: 2});
      }
      // elite / champion: a turning dashed ring at the feet (the champion's doubled)
      for (const b of core.enemies) {
        if (!b.aura) continue;
        ring(b.x, b.y, b.boss ? .8 : .55, b.aura, -t * (b.boss ? 1.2 : 2), 4, 3);
        if (b.boss) ring(b.x, b.y, 1, b.aura, t * .8, 6, 2);
      }
      // the portal: two counter-turning rings, motes rising
      if (portal) {
        const x = portal.x, y = portal.y, k = Math.min(1, portal.t / .8);
        ring(x, y, 1.05 * k, '#9ad0ff', t * .9, 8, 7);
        ring(x, y, .62 * k, '#c8a0ff', -t * 1.6, 3, 2);
        for (let i = 0; i < 10; i++) { const ph = (t * .5 + i * .37) % 1, a = i * 2.4; host.point(x + Math.sin(a) * .5 * (1 - ph), y + Math.cos(a) * .5 * (1 - ph), ph * 2.2, ph < .7 ? '#bfe4ff' : '#6a88c0', {emit: true}); }
      }
    },

    lights() {
      if (mode !== 'run') return [];
      const L = [];
      for (const q of director.tele) L.push({x: q.x, y: q.y, h: .5, color: q.boss ? '#ffb040' : '#ffd8a0', radius: 1.2 + q.t, intensity: .6 * q.t / TELE, id: 7300 + L.length});
      for (const b of core.enemies) if (b.aura) L.push({x: b.x, y: b.y, h: .6, color: b.aura, radius: b.boss ? 2.6 : 1.6, intensity: b.boss ? 1 : .7, flicker: .2, id: 7340 + L.length});
      if (portal) L.push({x: portal.x, y: portal.y, h: .9, color: '#9ad0ff', radius: 4, intensity: 1.4 * Math.min(1, portal.t), flicker: .15, id: 7390});
      return L;
    },

    hd(q, sc) {
      if (mode !== 'run' || !run) { hud.draw(q, sc, {run: false, stats, build: [], enemies: []}); return; }
      hud.draw(q, sc, {run: true, stats, build: stats.build(), stage: run.stage, stages: STAGES.length, stageName: stageName(run.stage),
        wave: director.wave, waves: director.waves || STAGES[run.stage].waves, left: director.left, phase, time: run.time, kills: run.kills,
        boss: director.boss, enemies: core.enemies, cost: chestCost()});
    },

    // every arrow as it is fired: damage x the build; the bow's own shots can volley / explode
    arrow(a) {
      if (mode !== 'run' || a.extra) return;
      a.dmg = (a.dmg ?? 10) * stats.S.dmg;
      if (a.explode) a.explode = {...a.explode, dmg: a.explode.dmg * stats.S.dmg};
      if (a.ab) return;   // ability arrows (multishot, rain, piercing, explosive) stop here
      shotN++;
      if (stats.S.nthBoom && shotN % stats.S.nthBoom === 0) a.explode = {r: 1.5, dmg: 14 * stats.S.dmg};
      for (let i = 0; i < stats.S.volley; i++) {
        const off = (i % 2 ? 1 : -1) * (.12 + .08 * Math.floor(i / 2)), c = Math.cos(off), s = Math.sin(off);
        host.spawnArrow({...a, extra: true, trail: undefined, explode: undefined, dmg: a.dmg * .5, vx: a.vx * c - a.vy * s, vy: a.vx * s + a.vy * c});
      }
    },
    onArrowHit(a, p) {   // Executioner: this hit's damage, against this target (pierce arrows keep their own base)
      if (mode !== 'run' || !stats.S.execute) return;
      a.dmg0 ??= a.dmg;
      a.dmg = p.hunter && p.hp < p.maxHp * .35 ? a.dmg0 * (1 + stats.S.execute) : a.dmg0;
    },
    interact(p) {
      if (mode !== 'run') return false;
      if (p === portal) { if (phase === 'portal') enterStage(run.stage + 1); return true; }
      if (p.interact === 'open' && !p.opened) {   // a chest: costs gold, gives an item
        const cost = chestCost();
        if (core.S.gold < cost) { hud.float(p.x, p.y, 1.3, `need ${cost} gold`, '#e0604a'); return true; }
        core.S.gold -= cost; goldSeen = core.S.gold;
        core.interact(p, {coins: 0});
        const it = rollItem(rng, run.stage * .25); stats.addItem(it);
        hud.toast(it.name, it.desc, it.tier === 3 ? '#e8604a' : it.tier === 2 ? '#7ad07a' : '#f4efe4');
        hud.float(p.x, p.y, 1.4, it.name, '#f2d27a', true);
        return true;
      }
      return false;
    },
    prompt(p) {
      if (mode !== 'run') return null;
      if (p === portal) return phase === 'portal' ? {text: `E  enter the portal · stage ${run.stage + 2}`, color: '#9ad0ff'} : null;
      if (p.interact === 'open') { const c = chestCost(); return {text: `E  open · ${c} gold`, color: core.S.gold >= c ? '#f0c060' : '#e0604a'}; }
      return null;
    },
    onKey(k, e) {
      if (e?.code === 'Backquote' || k === '§' || k === '`') { host.dev = !host.dev; return true; }
      if (screens.open) return screens.key(k);
      return false;
    },
    menu() {   // the pause menu's top rows
      if (mode === 'run') return [{label: 'Abandon run', run: () => { finish(false); }}, {label: 'Back to title', run: toTitle}];
      if (mode === 'sandbox') return [{label: 'Start a run', run: startRun}, {label: 'Back to title', run: toTitle}];
      return [];
    },
    hud: () => mode === 'run' && run ? `run: stage ${run.stage + 1} ${phase} · wave ${director.wave + 1}/${director.waves} · alive ${core.enemies.length} · hp ${Math.ceil(stats.S.hp)}/${stats.S.maxHp}` : `mode ${mode}`,
  };

  // start: the title, or straight into a mode (a run starts on the first frame: the host is still booting now)
  const m = Q.get('mode');
  if (m === 'sandbox') toSandbox();
  else { toTitle(); if (m === 'run') { screens.hide(); boot = startRun; } }
  return F;
}
