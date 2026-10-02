// BATTLE MUSIC: pre-made western songs that follow the fight (audio/tracks.js plays them on their cue sheets' beat
// grid, audio/battledirector.js decides what plays). This feature is the bridge: each VIEW it reads the game READ-ONLY
// (the mode and phase, the wave director, the enemies, the champion's health, the player's, this frame's kills, hurts,
// hits and shots) into one reused signal object and hands it to the director with the audio clock's time. Outside a run
// the procedural score (audio/music.js) plays as before; the director fades it out and in through its public API
// (MU.setEnabled), and never against the player's choice (U: music off, M: mute).
// OWNS: the signals object, the player + director it makes.  READS: host.feature('game' | 'combat' | 'audio'),
//   host.player, host.paused, host.entities.near (the merchant, 4x a second in pick / portal).  EMITS: nothing.
// BUDGET: view < 0.02 ms (a pass over the frame's events and the few enemies; no allocation).
// Presentation only: no update(), no drawing, no Math.random (the golden frames and the sim stay identical with it on).
// ?battlemusic=0 turns it off. Dev: ?bmforce=state[:song[:I or boss health]] pins a state (dev/bmusic.js, loaded only
// then), e.g. ?bmforce=boss:iron:.25 or ?bmforce=battle:dust:.8; window.__bmusic is the handle (tests).
import {flags} from '../core/flags.js';
import {createTrackPlayer} from '../audio/tracks.js';
import {createBattleDirector, makeSignals, TUNE} from '../audio/battledirector.js';

// ORDER: after the game (it runs first anyway) and the audio feature, whose engine the player plays into
export const order = {after: ['audio', 'combat']};
export async function create(host) {
  if (flags.get('battlemusic') === '0') return {name: 'battlemusic', on: false};
  const sig = makeSignals(), near = [];
  let game = null, core = null, AU = null, TP = null, D = null, volT = 0, mT = 0, volK = -1, procWant = true;
  const P = host.player;
  // the procedural score on / off (its own fade); never on when the player has turned the music off
  const procedural = on => { procWant = on; const MU = AU?.music; if (MU && MU.enabled !== (on && AU.musicOn)) MU.setEnabled(on && AU.musicOn); };
  function init() {
    game ??= host.feature('game'); core ??= host.feature('combat')?.core; AU ??= host.feature('audio')?.AU;
    if (!AU || !game) return false;
    const ac = AU.forge?.ac || AU.E?.ac, dest = AU.forge ? AU.forge.EN.bus('music') : AU.E?.out;
    if (!ac || !dest) return false;
    TP = createTrackPlayer(ac, dest, {logSize: flags.get('bmforce') ? 512 : 0});
    D = createBattleDirector(TP, {procedural});
    F.TP = TP; F.D = D;
    if (flags.get('bmforce')) import('../dev/bmusic.js').then(m => m.install(F, flags.get('bmforce'))).catch(e => console.warn('battlemusic: dev', e));
    return true;
  }
  function read(evs) {
    const g = game, d = g.director, S = g.stats?.S;
    sig.mode = g.mode; sig.phase = g.phase; sig.dir = d ? d.phase : ''; sig.stage = g.run ? g.run.stage : 0;
    sig.wave = d ? d.wave : 0; sig.waves = d ? d.waves : 0;
    sig.hp = S && S.maxHp ? S.hp / S.maxHp : 1;
    sig.paused = !!host.paused;
    sig.musicOn = !!AU.musicOn && !AU.muted;
    let alive = 0, elites = 0, boss = -1, tele = false;
    if (g.mode === 'run' && core) {
      const list = core.enemies;
      for (let i = 0; i < list.length; i++) { const b = list[i]; alive++; if (b.elite) elites++; if (b.boss && b.maxHp) boss = b.hp / b.maxHp; }
      if (d) for (let i = 0; i < d.tele.length; i++) if (d.tele[i].boss) tele = true;
    }
    sig.alive = alive; sig.elites = elites; sig.bossHp = boss; sig.bossTele = tele;
    let kills = 0, eliteKills = 0, bossKill = false, hurt = 0, hits = 0, shots = 0, booms = 0;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      switch (e.type) {
        case 'enemy.kill': if (e.who?.hunter) { kills++; if (e.who.boss) bossKill = true; else if (e.who.elite) eliteKills++; } break;
        case 'player.hurt': hurt += (e.dmg || 0) / (S?.maxHp || 100); break;
        case 'arrow.hit': if (e.prop?.hunter) hits++; break;
        case 'bullet.impact': if (e.surf === 'hit') hits++; break;   // (the revolver: western's gun feature)
        case 'player.shoot': shots++; break;
        case 'combat.explode': booms++; break;
      }
    }
    sig.kills = kills; sig.eliteKills = eliteKills; sig.bossKill = bossKill; sig.hurt = hurt; sig.hits = hits; sig.shots = shots; sig.booms = booms;
    // the merchant (the saloon set piece): only between stages, a few times a second
    if (g.mode === 'run' && (g.phase === 'pick' || g.phase === 'portal')) {
      if ((mT -= 1) <= 0) {
        mT = 15; sig.nearMerchant = false;
        host.entities.near(P.x, P.y, TUNE.merchantR, near);
        for (let i = 0; i < near.length; i++) if (near[i].kind === 'merchant') sig.nearMerchant = true;
        near.length = 0;
      }
    } else sig.nearMerchant = false;
  }
  const F = {
    name: 'battlemusic', label: 'Battle music', ambient: true, TP: null, D: null, sig,
    view(dt, evs) {
      if (!TP && !init()) return;
      const t0 = performance.now();
      read(evs);
      const ac = TP.ac;
      if (ac.state === 'running' || ac.state === 'suspended') D.update(ac.currentTime, sig);
      // the player's music volume (the pause menu's slider, v^2 like audio.js), a few times a second
      if ((volT -= 1) <= 0) {
        volT = 20; const v = AU.musicOn && !AU.muted ? (AU.volumes?.music ?? 1) : 0, k = v * v;
        if (k !== volK) { TP.setVolume(k, .15); volK = k; }
        if (AU.music && D.state === 'off' && procWant && AU.musicOn && !AU.music.enabled) procedural(true);   // (U toggled back on)
        if (AU.music && !procWant && AU.music.enabled) procedural(false);                                     // (U while a song plays)
      }
      F.ms = F.ms * .98 + (performance.now() - t0) * .02;
    },
    ms: 0,
  };
  return F;
}
