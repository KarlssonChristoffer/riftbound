// BATTLE DIRECTOR: the battle music follows the game (the game never waits for the music). It reads a few signals the
// battlemusic feature gathers each view (mode, phase, enemies, the champion's health, the player's, this frame's kills
// and hurts) and tells the file-music player (audio/tracks.js) what to play, where to jump and when. Pure logic: the
// same code runs in the game and in the offline render (dev/bmusic.js), with the audio clock as its only time.
// OWNS: the music state (below), the fight intensity I, the mix targets (filter / duck).  READS: the signals (SIG).
// BUDGET: < 0.01 ms per view (a few comparisons; a request only on a change).
//
// STATES (the song per state is TUNE's):
//   off      outside runs, the sandbox, travel: the procedural score (audio/music.js) plays, this player is silent
//   title    the title screen: the calm song (TUNE.titleSong; null = the procedural score)
//   battle   a stage's waves: its wave song, intro while the stage is announced, then a section by I (low / main /
//            peak, hysteresis; up on the next bar, down on the next phrase, back to `main` where it was left);
//            lulls between waves: a low-pass + a small duck (the song goes on, muffled), a thump when the next wave comes
//   boss     the champion's telegraph: its song on the next beat (a boom masks the switch), intro, then sections by its
//            health: > 60% main, <= 60% drive, <= 30% peak (enrage): each change on the next bar with a stinger on the
//            very next beat (the song's own beat doubled + a hit); the killing blow: a boom on the next beat, then
//   ending   the song's own ending from the next bar (its final bars + ring-out), when the stage is clear
//   calm     victory, the augment pick, the portal: the calm song fades in after the ending
//   saloon   pick / portal near the merchant: the saloon rag (crossfades with calm as you walk up / away)
//   dead     a tape stop (1.5 s) into silence
//   over     the run's summary: the calm song again after a moment
// MIX: player health < 30%: low-pass 1.6 kHz + duck -2.5 dB (until > 36%); paused: low-pass 650 Hz (the menu's own
// -9 dB duck applies too: the music bus); a hit or kill: a 1.5 dB pulse duck (hitstop); the user's music volume.
import {clamp} from '../core/mathx.js';

export const TUNE = {
  stages: [   // per run stage (game/run.js STAGES): the waves' song and the champion's
    {waves: 'reload', boss: 'iron'},       // ruins, day: the 88 BPM swagger, then the 120 BPM showdown
    {waves: 'dust', boss: 'cavalry'},      // frost, dusk: dust (90), then the darker D# minor cavalry (96)
    {waves: 'dawnraid', boss: 'rust'},     // ember, night: the dawn raid (111), then rust spurs in the machine (100)
    {waves: 'reload', boss: 'coyote'},     // rift, night: the last champion gets the fastest, the coin-op showdown (128)
  ],
  calm: 'sunset', saloon: 'rag', titleSong: 'sunset',
  merchantR: 7,                            // m: the saloon plays this near the merchant (pick / portal)
  I: {low: [.24, .34], peak: [.56, .68], rise: .6, fall: 3, dwell: 4},   // [exit, enter] thresholds; time constants (s)
  boss: {p2: .6, p3: .3},
  lowHp: [.3, .36], lowHpHz: 1600, lowHpDb: -2.5, lowHpHold: 2.5,   // under 30% on, over 36% (and 2.5 s later) off
  pauseHz: 650, lullHz: 1100, lullDb: -2,
  pulseDb: -1.5, pulseGap: .08,
  overDelay: 1.5, offFade: 2.5,
};

// the signals the feature fills (one object, reused)
export function makeSignals() {
  return {mode: '', phase: '', dir: '', stage: 0, wave: 0, waves: 0, alive: 0, elites: 0, bossTele: false, bossHp: -1, hp: 1,
    paused: false, nearMerchant: false, musicOn: true, kills: 0, eliteKills: 0, bossKill: false, hurt: 0, hits: 0, shots: 0, booms: 0};
}

export function createBattleDirector(TP, {procedural = () => {}, log = null} = {}) {
  const D = {state: 'off', I: 0, role: '', bossPhase: 0, bossDown: false, forced: null, t: 0, stateT: 0,
    filter: 22000, duck: 0, transitions: 0};
  let introExit = '', lastT = -1, kr = 0, dr = 0, sr = 0, roleT = 0, pulseT = -9, lowHp = false, lowT = -9, wasLull = false, procOn = true, song = '';
  const note = (what, a, b) => { if (log) log(D.t, what, a, b); };

  const PIN = {waves: '', boss: ''};
  function stageSongs(sig, k = 0) {
    const s = TUNE.stages, S = s[clamp((sig.stage | 0) + k, 0, s.length - 1)];
    if (!D.forced?.song) return S;
    PIN.waves = PIN.boss = D.forced.song; return PIN;
  }
  // which state the game asks for
  function decide(sig) {
    if (D.forced) return D.forced.state;
    if (!sig.musicOn) return 'off';
    if (sig.mode === 'title') return TUNE.titleSong ? 'title' : 'off';
    if (sig.mode !== 'run') return 'off';
    const ph = sig.phase, cur = D.state;
    if (ph === 'dead') return cur === 'over' ? 'over' : 'dead';   // (hurt again on the summary screen: not a new death)
    if (ph === 'over') return 'over';
    if (ph === 'travel' || ph === '') return 'off';
    if (ph === 'arrive' || ph === 'wave') {
      if (sig.bossTele || sig.bossHp >= 0 || D.bossDown) return D.bossDown && cur === 'ending' ? 'ending' : 'boss';
      return 'battle';
    }
    // clear / won / pick / portal: the champion's song ends first, then the calm (or the saloon near the merchant)
    if (cur === 'boss' || (cur === 'ending' && TP.playing)) return 'ending';
    if ((ph === 'pick' || ph === 'portal') && sig.nearMerchant && TUNE.saloon) return 'saloon';
    return 'calm';
  }

  function enter(st, sig) {
    const from = D.state; D.state = st; D.stateT = 0; D.transitions++;
    note('state', from, st);
    const S = stageSongs(sig);
    switch (st) {
      case 'off':
        if (TP.playing) TP.stop({q: 'now', fade: TUNE.offFade});
        song = ''; D.role = ''; D.bossDown = false; D.bossPhase = 0;
        break;
      case 'title': case 'calm': case 'over':
        if (st === 'over' && from !== 'calm') break;   // after a moment (update)
        startSong(TUNE.calm, from === 'saloon' ? 'main' : 'intro', 'now', from === 'ending' ? 1 : 1.5);
        break;
      case 'saloon': startSong(TUNE.saloon, 'intro', 'now', 1.5); break;
      case 'battle':
        D.bossDown = false; D.bossPhase = 0; D.I = 0; D.role = ''; roleT = 0;
        startSong(S.waves, 'intro', 'now', .05);
        TP.load(S.boss).catch(() => {});   // the next song: resident before it is needed
        break;
      case 'boss':
        D.bossPhase = 1; D.role = 'main';
        startSong(S.boss, 'intro', 'beat', .05, 'boom');
        TP.setThen('main');
        break;
      case 'ending':
        TP.load(TUNE.calm).catch(() => {});
        if (TP.playing && song) { TP.goto('ending', {q: 'bar'}); D.role = 'ending'; }
        break;
      case 'dead':
        TP.tapeStop(1.5); song = ''; D.role = '';
        TP.load(TUNE.calm).catch(() => {});
        break;
    }
  }
  function startSong(id, role, q, fade, sting) {
    if (song === id && TP.playing) { if (role !== 'intro') TP.goto(role, {q: 'bar'}); return; }
    song = id; D.role = role; introExit = '';
    TP.play(id, {role, q, fade, stinger: sting});
  }

  // the fight's intensity (battle): enemies on the field, kills, damage taken, danger, shots
  function intensity(sig, dt) {
    const a = Math.exp(-dt / 3), b = Math.exp(-dt / 4), c = Math.exp(-dt / 2);
    kr = kr * a + sig.kills / 3; dr = dr * b + sig.hurt / 4; sr = sr * c + (sig.shots + sig.hits) / 2;
    const danger = sig.hp < .5 ? (.5 - sig.hp) * 2 : 0;
    let target = .1 + .45 * Math.min(1, sig.alive / 6) + .2 * Math.min(1, kr / .6) + .25 * Math.min(1, dr / .06)
      + .2 * danger + .1 * Math.min(1, sig.elites) + .1 * Math.min(1, sr / 2);
    if (sig.dir === 'lull') target *= .5;
    target = clamp(target, 0, 1);
    D.I += (target - D.I) * (1 - Math.exp(-dt / (target > D.I ? TUNE.I.rise : TUNE.I.fall)));
  }
  function battleRole(sig) {
    const intro = D.role === 'intro' || TP.role === 'intro';   // the song's intro is pending or playing
    const I = D.I, cur = intro || !D.role ? 'main' : D.role, T = TUNE.I;
    let want = cur;
    if (cur === 'low') { if (I > T.low[1]) want = I > T.peak[1] ? 'peak' : 'main'; }
    else if (cur === 'peak') { if (I < T.peak[0]) want = I < T.low[0] ? 'low' : 'main'; }
    else if (I > T.peak[1]) want = 'peak'; else if (I < T.low[0]) want = 'low';
    if (intro) {   // the intro builds while the stage is announced; the first enemies end it on the next bar
      if (want === 'low') want = 'main';   // (the fight starts: at least the main body)
      TP.setThen(want);
      if (TP.role !== 'intro' && TP.playing) { D.role = TP.role; roleT = 0; return; }   // it has ended (or was left)
      if (sig.alive > 0 && sig.dir === 'wave' && introExit !== want && TP.playing) { TP.goto(want, {q: 'bar'}); introExit = want; note('role', 'intro', want); }
      return;
    }
    if (want === D.role) return;
    const up = want === 'peak' || (want === 'main' && D.role === 'low');
    if (!up && roleT < T.dwell) return;
    TP.goto(want, {q: up ? 'bar' : 'phrase', resume: want === 'main'});
    note('role', D.role, want); D.role = want; roleT = 0;
  }
  function bossUpdate(sig) {
    if (sig.bossKill && !D.bossDown) {
      D.bossDown = true; note('boss', 'down', '');
      TP.stinger('echo', {q: 'beat', db: 2}); TP.stinger('boom', {q: 'beat', db: 0});
    }
    if (D.bossDown) {
      if (sig.alive > 0 && D.role !== 'main') { TP.goto('main', {q: 'bar', resume: true}); D.role = 'main'; }
      return;
    }
    if (sig.bossHp < 0) return;   // the telegraph: the intro plays
    const p = sig.bossHp <= TUNE.boss.p3 ? 3 : sig.bossHp <= TUNE.boss.p2 ? 2 : 1;
    if (p > D.bossPhase) {
      const role = p === 3 ? 'peak' : 'drive';
      D.bossPhase = p; D.role = role; note('boss', 'phase', p);
      TP.goto(role, {q: 'bar', tail: true});
      TP.stinger('echo', {q: 'beat', db: 0}); TP.stinger('hit', {q: 'beat', db: -3});
    }
  }
  function mix(sig) {
    if (lowHp ? sig.hp > TUNE.lowHp[1] && D.t - lowT > TUNE.lowHpHold : sig.hp < TUNE.lowHp[0]) { lowHp = !lowHp; lowT = D.t; note('lowhp', lowHp ? 'on' : 'off', ''); }
    const fighting = D.state === 'battle' || D.state === 'boss';
    const lull = D.state === 'battle' && sig.dir === 'lull';
    let hz = 22000, db = 0;
    if (lowHp && fighting) { hz = TUNE.lowHpHz; db += TUNE.lowHpDb; }
    if (lull) { hz = Math.min(hz, TUNE.lullHz); db += TUNE.lullDb; }
    if (sig.paused) hz = Math.min(hz, TUNE.pauseHz);
    if (hz !== D.filter) { TP.setFilter(hz, sig.paused ? .08 : hz > D.filter ? .5 : .3); D.filter = hz; }
    if (db !== D.duck) { TP.setDuck(db, .4); D.duck = db; }
    if (wasLull && !lull && sig.dir === 'wave' && D.state === 'battle') TP.stinger('thump', {q: 'beat', db: -6});   // the next wave
    wasLull = lull;
    if (fighting && (sig.hits || sig.kills) && D.t - pulseT > TUNE.pulseGap) { TP.pulse(TUNE.pulseDb, .05, .12); pulseT = D.t; }
    if ((D.state === 'battle' || (D.state === 'boss' && !D.bossDown)) && sig.eliteKills) { TP.stinger('echo', {q: 'beat', db: -1}); TP.stinger('thump', {q: 'beat', db: -8}); }
  }

  let lastPhase = '';
  function prefetch(sig) {   // the next song, decoded before it is needed (only on a phase change)
    const ph = sig.mode === 'run' ? sig.phase : sig.mode;
    if (ph === lastPhase) return;
    lastPhase = ph;
    const pf = id => { TP.load(id).catch(() => {}); };
    if (ph === 'travel' || ph === 'arrive') pf(stageSongs(sig).waves);
    else if (ph === 'portal') pf(stageSongs(sig, 1).waves);
    else if (ph === 'title') { if (TUNE.titleSong) pf(TUNE.titleSong); }
  }

  D.update = function (t, sig) {
    const dt = lastT < 0 ? 0 : clamp(t - lastT, 0, .25); lastT = t; D.t = t; D.stateT += dt; roleT += dt;
    const f = D.forced;
    if (f && f.bossHp !== null) sig.bossHp = f.bossHp;
    const want = decide(sig);
    if (want !== D.state) enter(want, sig);
    if (!f) prefetch(sig);
    switch (D.state) {
      case 'battle': if (f && f.I !== null) D.I = f.I; else intensity(sig, dt); battleRole(sig); break;
      case 'boss': bossUpdate(sig); break;
      case 'ending':
        if (sig.bossKill && !D.bossDown) { D.bossDown = true; TP.stinger('echo', {q: 'beat', db: 2}); TP.stinger('boom', {q: 'beat'}); }
        if (D.role !== 'ending' && TP.playing) { TP.goto('ending', {q: 'bar'}); D.role = 'ending'; }
        break;
      case 'over':
        if (!TP.playing && D.stateT > TUNE.overDelay && song !== TUNE.calm) startSong(TUNE.calm, 'intro', 'now', 2);
        break;
    }
    // the procedural score: on in 'off' (cross-fading with this player's fade-out), and whenever the wanted song can't be
    // had (a checkout without the git-ignored songs, a failed fetch): then the game sounds as it did before
    const silent = D.state === 'off' || (!!song && TP.failed(song));
    if (silent && D.state !== 'off' && TP.playing && TP.song !== song) TP.stop({q: 'now', fade: 1.5});   // (not the old song instead)
    if (silent && !procOn && (!TP.playing || D.stateT > .3)) { procedural(true); procOn = true; }
    else if (!silent && procOn) { procedural(false); procOn = false; }
    mix(sig);
  };
  // dev (dev/bmusic.js): pin a state regardless of the game: {state, song (for every stage), I (battle's intensity),
  // bossHp (0..1: the champion's health)}; null = follow the game again
  D.force = function (spec) {
    D.forced = spec ? {state: spec.state || 'battle', song: spec.song || '', I: spec.I ?? null, bossHp: spec.bossHp ?? null} : null;
    if (spec) { D.state = '-'; D.bossDown = false; }
  };
  D.procedural = () => procOn;
  return D;
}
