// DEV: the battle music's test hooks (dev only: loaded by features/battlemusic.js when ?bmforce= is set, or imported by
// tools/music/bmtest.mjs into a page). Nothing in the game imports this.
//   install(F, spec)        pins the director: spec 'state[:song[:x]]' (x = battle intensity I, or the champion's health
//                           for boss), e.g. 'boss:iron:.25', 'battle:dust:.8', 'calm', 'saloon'; window.__bmusic = handle
//   renderScenario(opts)    an OFFLINE render of a scripted fight through the real player + director (OfflineAudioContext,
//                           the director and the scheduler stepped every `step` s of audio time), for listening tests:
//                           -> {sr, frames, log (the player's changes), notes (the director's), checks, stats}; the audio
//                           stays in window.__bmRender (Int16 stereo interleaved) for the driver to fetch in chunks
import {createTrackPlayer, TUNE as PT} from '../audio/tracks.js';
import {createBattleDirector, makeSignals} from '../audio/battledirector.js';
import {CUES} from '../content/cues.js';

export function install(F, spec) {
  const [state, song, x] = String(spec || '').split(':');
  const v = x === undefined || x === '' ? null : +x;
  if (state && state !== '1') F.D.force({state, song: song || '', I: state === 'battle' ? v : null, bossHp: state === 'boss' ? v : null});
  window.__bmusic = {F, TP: F.TP, D: F.D, sig: F.sig, force: s => F.D.force(s), log: () => rows(F.TP), check: () => checkLog(rows(F.TP))};
  console.log('battlemusic: dev hooks on', spec);
}

// the player's log rows in time order (copies)
export function rows(TP) {
  const L = TP.LOG, out = [];
  const n = Math.min(L.n, L.size);
  for (let i = L.n - n; i < L.n; i++) out.push({...L.rows[i % L.size]});
  return out;
}
// every change must sit on the cue sheets' grid: a jump / loop / switch (unless asked for 'now': a fade, not a cut)
// leaves its song ON a beat time of that song's cue
// (and a bar line when the quantum was 'bar' / 'phrase' / a loop), and enters the new place on a beat of its cue; a
// stinger plays on a beat of the playing song. Returns {n, ok, bad: [rows]}.
export function checkLog(list) {
  const near = (cue, ft) => { let best = 1e9, bi = -1; for (let i = 0; i < cue.beats.length; i++) { const d = Math.abs(cue.beats[i] - ft); if (d < best) { best = d; bi = i; } } return {d: best, bi, bar: (bi - cue.bars0) % 4 === 0}; };
  let ok = 0; const bad = [];
  for (const r of list) {
    let good = true; const why = [];
    if ((r.kind === 'jump' || r.kind === 'loop' || r.kind === 'then' || r.kind === 'song') && r.fileFrom >= 0 && r.from && r.q !== 'now') {
      const a = near(CUES[r.from], r.fileFrom);
      if (a.d > .001) { good = false; why.push(`left ${r.from} ${(a.d * 1000).toFixed(1)} ms off its beat`); }
      if ((r.q === 'bar' || r.q === 'phrase') && !a.bar) { good = false; why.push('left off a bar line'); }
      r.fromBeat = a.bi; r.fromBar = a.bar ? (a.bi - CUES[r.from].bars0) / 4 : -1;
    }
    if ((r.kind === 'jump' || r.kind === 'loop' || r.kind === 'then' || r.kind === 'song') && r.song) {
      const b = near(CUES[r.song], r.fileTo);
      if (b.d > .001) { good = false; why.push(`entered ${r.song} ${(b.d * 1000).toFixed(1)} ms off its beat`); }
      r.toBeat = b.bi; r.toBar = b.bar ? (b.bi - CUES[r.song].bars0) / 4 : -1;
    }
    if (r.kind.startsWith('sting') && r.from && r.fileFrom >= 0) {
      const a = near(CUES[r.from], r.fileFrom);
      if (a.d > .001) { good = false; why.push(`stinger ${(a.d * 1000).toFixed(1)} ms off the beat`); }
      r.fromBeat = a.bi;
    }
    if (good) ok++; else bad.push({...r, why: why.join('; ')});
  }
  return {n: list.length, ok, bad};
}

// ------------------------------------------------------------------ the offline render
// script: [[t, {signal changes} | fn(sig)], ...] in audio seconds; `pulse` keys (kills, hurt, hits, shots, bossKill,
// eliteKills) last one step. The default: a stage's waves, the champion (phases, low health, the kill), the victory,
// the merchant's saloon, travel. ~150 s.
export const SCENARIO = [
  [0, {mode: 'run', phase: 'travel', stage: 0, dir: 'idle', hp: 1}],
  [1, {phase: 'arrive'}],
  [3.2, {phase: 'wave', dir: 'wave', wave: 0, waves: 3}],
  [4.6, {alive: 2}], [6, {alive: 3}], [7.5, {kills: 1, alive: 2}], [8, {hits: 2}], [9, {alive: 4, shots: 2}],
  [10, {hurt: .1, hp: .9}], [11, {kills: 1, alive: 3}], [12.5, {alive: 5}], [13, {hits: 3}], [14, {alive: 6, elites: 1}],
  [15, {hurt: .12, hp: .78}], [16, {hits: 2, shots: 3}], [17, {hurt: .1, hp: .68}], [18, {kills: 2, alive: 4}], [19.5, {hits: 2}],
  [21, {kills: 1, eliteKills: 1, alive: 3, elites: 0}], [23, {kills: 1, alive: 2}], [25, {kills: 1, alive: 1}],
  [27, {kills: 1, alive: 0, dir: 'lull', wave: 1}],
  [29.4, {dir: 'wave'}], [31, {alive: 3}], [33, {kills: 1, alive: 2, hits: 2}], [35, {kills: 2, alive: 0, dir: 'lull', wave: 2}],
  [37.4, {dir: 'wave'}], [38.5, {alive: 2}], [39.5, {paused: true}], [41, {paused: false}],
  [42, {bossTele: true}], [42.9, {bossTele: false, bossHp: 1, alive: 3}],
  [46, {kills: 1, alive: 2, hits: 2}], [50, {bossHp: .82, hits: 3}], [54, {hurt: .15, hp: .55}], [57, {bossHp: .7}],
  [60, {bossHp: .58, hits: 2}], [64, {kills: 1, alive: 1}], [67, {hurt: .2, hp: .35}], [70, {bossHp: .45, hits: 3}],
  [73, {hurt: .1, hp: .25}], [77, {bossHp: .36}], [80, {bossHp: .28, hits: 2}], [84, {hp: .4}], [86, {bossHp: .18}],
  [90, {bossHp: .08, hits: 2}], [93, {bossHp: -1, bossKill: true, kills: 1, alive: 0, phase: 'clear', dir: 'clear'}],
  [100, {phase: 'pick'}], [112, {phase: 'portal', hp: 1}], [118, {nearMerchant: true}], [134, {nearMerchant: false}],
  [142, {phase: 'travel', stage: 1, dir: 'idle'}],
];
// a death: a wave, the champion arrives, the player falls (the tape stop), the summary screen (the calm song), ~45 s
const DEATH = [
  [0, {mode: 'run', phase: 'arrive', stage: 1, dir: 'idle', hp: 1}], [2.2, {phase: 'wave', dir: 'wave', wave: 2, waves: 3}],
  [3.5, {alive: 4}], [6, {hurt: .2, hp: .6, hits: 2}], [9, {bossTele: true}], [9.9, {bossTele: false, bossHp: 1, alive: 5}],
  [14, {hurt: .25, hp: .35}], [17, {hurt: .1, hp: .25}], [21, {hurt: .3, hp: 0, phase: 'dead'}], [23.2, {phase: 'over'}],
];
export const SCENARIOS = {fight: SCENARIO, death: DEATH};
const PULSES = ['kills', 'eliteKills', 'bossKill', 'hurt', 'hits', 'shots', 'booms'];

export async function renderScenario({script = SCENARIO, sec = 150, sr = 48000, step = .02, base} = {}) {
  const ac = new OfflineAudioContext(2, Math.ceil(sec * sr), sr);
  const TP = createTrackPlayer(ac, ac.destination, {offline: true, logSize: 2048, ...(base ? {base} : {})});
  const notes = [];
  const D = createBattleDirector(TP, {log: (t, what, a, b) => notes.push({t: +t.toFixed(3), what, a, b}), procedural: on => notes.push({t: +ac.currentTime.toFixed(3), what: 'procedural', a: on})});
  const sig = makeSignals();
  const timeline = [];   // what the game did (the script) vs what the music did (the log): for the chart
  let si = 0, decodeWait = 0;
  const run = async t => {
    for (const k of PULSES) sig[k] = k === 'bossKill' ? false : 0;
    while (si < script.length && script[si][0] <= t + 1e-9) {
      const [st, ch] = script[si++];
      if (typeof ch === 'function') ch(sig); else Object.assign(sig, ch);
      timeline.push({t: st, ...((typeof ch === 'function') ? {fn: 1} : ch)});
    }
    D.update(t, sig);
    // the game never waits for the music, but offline the decode would otherwise take no audio time at all: wait for it
    // here (the render is suspended), then schedule
    const loads = []; for (const e of TP.songs.values()) if (e.loading) loads.push(e.loading.catch(() => {}));
    if (loads.length) { const w0 = performance.now(); await Promise.all(loads); decodeWait += performance.now() - w0; }
    TP.tick();
  };
  let t = 0;
  const next = () => {
    t += step;
    if (t >= sec - step) return;
    ac.suspend(+t.toFixed(6)).then(async () => { try { await run(ac.currentTime); } catch (e) { console.error(e); } next(); ac.resume(); });
  };
  await run(0);
  next();
  const c0 = performance.now();
  const buf = await ac.startRendering();
  const renderMs = performance.now() - c0;
  // to Int16 interleaved (the driver fetches it in chunks)
  const L = buf.getChannelData(0), R = buf.getChannelData(1), n = buf.length, i16 = new Int16Array(n * 2);
  let pk = 0;
  for (let i = 0; i < n; i++) {
    const l = L[i], r = R[i];
    if (Math.abs(l) > pk) pk = Math.abs(l); if (Math.abs(r) > pk) pk = Math.abs(r);
    i16[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l * 32767)));
    i16[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r * 32767)));
  }
  window.__bmRender = {i16, sr, frames: n};
  const log = rows(TP);
  return {sr, frames: n, peak: pk, renderMs: Math.round(renderMs), decodeWaitMs: Math.round(decodeWait), log, check: checkLog(log), notes, timeline,
    stats: {...TP.stats}, tune: {lookahead: PT.lookahead, xfJump: PT.xfJump}};
}
// a chunk of the rendered audio as base64 (the driver's pull)
export function chunk(i, size = 1 << 21) {
  const r = window.__bmRender, a = new Uint8Array(r.i16.buffer, i * size, Math.max(0, Math.min(size, r.i16.byteLength - i * size)));
  let s = ''; for (let k = 0; k < a.length; k += 32768) s += String.fromCharCode.apply(null, a.subarray(k, k + 32768));
  return btoa(s);
}
