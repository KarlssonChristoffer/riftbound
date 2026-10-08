// AFFIXES feature: Risk of Rain style ELITE AFFIXES, an experiment (docs/exp/affixes.md). In a run, elites and champions
// roll an affix (later stages, now and then a regular brute too) that changes how they fight AND how they look: an aura
// ring and a light in the affix's colour, its name ("Blazing Elite Brute"), its HP bar, and its own marks and threats,
// every one telegraphed:
//   Blazing      burning ground where it lands; a fire burst when it dies (wooden props catch)
//   Glacial      its blows chill you; a frost nova when it dies
//   Overloaded   calls lightning on you and where you're heading: rings close in, then the bolt
//   Splitting    splits into quicker, weaker Splitlings when it dies
//   Warded       a ward in front of it stops your shots until broken: flank it, blow it up, pierce it
//   Vampiric     a drain beam (break it: get out of reach or roll); heals from its blows
// OFF by default: ?affixes=1, or menu > Dev > Features > Elite affixes (remembered on this machine). In the sandbox
// (dev): the menu's Sandbox > Elites rows, or the . key (Shift: a champion), put one ~5 m from you to fight; the sandbox doesn't
// count hurts, so the ones you would have taken float up in red.
//   features/affixes/sim.js   the truth (rolls, behaviours, deaths, the ward, the beam; the hazard kit: sim/hazards.js)
//   features/affixes/look.js  the view (marks, ward, beam, deaths, chill; the zones: view/hazards.js)
//   content/affixes.js        the numbers (chances by stage, every affix's tuning)
// HOOKS INTO: game/enemies.js onSpawn (the roll, before an enemy joins), combat core heal (Vampiric), features/lights.js
//   ignite (Blazing), the onArrowHit chain before combat (the ward).
// OWNS: through sim / look (see there). READS: the game's mode / phase / stage, flags, localStorage 'rb.affixes'.
// EMITS: player.hurt, player.hit, hazard.burst (sim/hazards.js).
// BUDGET (2026-10-03, headless, 3-4 affixed elites fighting): sim ~.01-.03 ms a step; view + frame + hd ~.1-.25 ms.
import {createAffixSim} from './affixes/sim.js';
import {createAffixLook} from './affixes/look.js';
import {AFFIXES, AFFIX_IDS, CHANCE, WEIGHT} from '../content/affixes.js';
import {flags} from '../core/flags.js';

const STORE = 'rb.affixes';
// ORDER (core/features.js): before combat, so the ward sees a shot before combat resolves it (the onArrowHit chain)
export const order = {before: ['combat']};
export async function create(host) {
  let saved = null; try { saved = localStorage.getItem(STORE); } catch (e) {}
  const q = flags.get('affixes'), on = q === '1' || (q !== '0' && saved === '1');
  const F = {name: 'affixes', label: 'Elite affixes', on, ms: 0};
  const sim = createAffixSim(host, F), look = createAffixLook(host, sim);
  let tU = 0, tF = 0, cyc = 0, game = null;
  const now = () => performance.now(), gameF = () => game ??= host.feature('game');
  const canTry = () => F.on && host.dev && !host.lock && (gameF()?.mode === 'sandbox' || gameF()?.mode === 'run');
  Object.assign(F, {
    sim, look, AFFIXES, CHANCE, WEIGHT,   // (test handles: the content tables, live)
    update(dt, evs) { const t0 = now(); sim.update(dt, evs); tU += now() - t0; },
    view(dt, evs) { const t0 = now(); look.view(dt, evs); tU += now() - t0; },
    frame(f) { const t0 = now(); look.frame(f); tF = now() - t0; },
    lights: () => look.lights(),
    hd(q, sc) { const t0 = now(); look.hd(q, sc); const ms = tU + tF + now() - t0; tU = 0; F.ms = F.ms * .95 + ms * .05; F.msLast = ms; },
    onArrowHit: (a, p) => sim.onArrowHit(a, p),
    // the Elite affixes row (menu > Dev > Features): off clears its zones at once; the enemies that have one keep their
    // names and colours, without their tricks
    toggle() {
      F.on = !F.on; if (F.on) sim.seed(); else { sim.clear(); look.clear(); }
      try { localStorage.setItem(STORE, F.on ? '1' : '0'); } catch (e) {}
      return F.on;
    },
    // a trial: an enemy with this affix ~5 m away (the sandbox, or a run with dev on)
    trial: (id, type = 'elite', at = null) => sim.trial(id, type, at),
    menu() {
      if (!canTry() || gameF()?.mode !== 'sandbox') return [];
      return [...AFFIX_IDS.map(id => ({label: `Try: ${AFFIXES[id].name} Elite`, run: () => sim.trial(id)})),
        {label: 'Try: one of each', run: () => AFFIX_IDS.forEach(id => sim.trial(id))}];
    },
    // . : the next affix's elite; Shift+. (: on a Nordic keyboard, > on a US one): its champion
    onKey(k) {
      if ((k !== '.' && k !== ':' && k !== '>') || !canTry()) return false;
      sim.trial(AFFIX_IDS[cyc++ % AFFIX_IDS.length], k === '.' ? 'elite' : 'champion'); return true;
    },
    hud: () => F.on ? `affixes: ${sim.bearers.length} bearers · zones ${sim.H.n} · rolled ${sim.stats.rolled} · patches ${sim.stats.patches} · strikes ${sim.stats.strikes} · splits ${sim.stats.splits} · blocked ${sim.stats.blocked} · drained ${sim.stats.drained.toFixed(0)}` : '',
  });
  return F;
}
