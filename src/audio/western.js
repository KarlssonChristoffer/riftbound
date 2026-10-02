// WESTERN: the desert's score ("Red Mesa"), a spaghetti-western band on music.js's sequencer. OWNER: music (docs/AUDIO.md
// §3.5). music.js keeps the clock, the intensity, the layer gains and the style switch; this plays the bars.
//
// CONTRACT (music.js is the only caller)
//   export function createWestern(ac, {lay, noise}) -> W
//     lay: music.js's layer gains {pad, arp, bass, mel, light, drums, sting: {g, on}}; noise: its 1 s noise buffer
//   W.ready, W.build(ms)   the instrument banks render lazily (western_dsp.js, seeded) in slices of about `ms`, the first
//                          time the desert is asked for; music.js holds the style switch until W.ready
//   W.enter()              the style starts (at a bar line)
//   W.tick(st, t, I, time, s16)   one 16th step: st 0..15 at time t; I the intensity 0..1; time 'day' | 'dusk' | 'night'
//   W.stinger(kind, t, s16)       'open' | 'loot' | 'respawn' (quantised by music.js)
//   W.chord                the current chord's name (MU.state)
//
// THE MUSIC: A minor, 72 bpm, 2 bars per chord, 8-bar phrases. The chords are guitar chords in open position, the
// harmony natural minor with the border flavour of E major (the Andalusian cadence Am G F E) and the Phrygian B-flat.
// Every phrase picks a progression for its section (calm / tension / combat; one plays at most twice in a row), and
// every progression keeps ITS tune once made, so the themes return. A tune is call (2 bars) - answer - the call
// again on the third chord - a cadence that lands on the chord's root.
//   rest (pad only)  space: now and then a slow rolled chord left to ring; dusk / night a low open-fifth drone; at
//                    night, guitar harmonics
//   explore          fingerpicked guitar (a rolling arpeggio, a sparse ballad or boom-chick), the twang bass, and the
//                    WHISTLER: every other phrase by day, every phrase at dusk (the full lonely melody), at night a
//                    distant fragment (the call; the whole call-and-answer every other phrase) with the canyon's echo
//   tension          a tremolo-picked held note per bar, a heartbeat bass, the HARMONICA wailing the tune's long notes
//                    (bending into each), a trotting horse, a shaker, the mission bell on every chord
//   combat           the gallop ("ta-ka-TUM" on every 8th: palm-muted strings and hooves), toms and a bass drum,
//                    strummed accents on 2 and 4, a driving bass, the harmonica pushed through the whole tune
// INSTRUMENTS: rendered once (seeded JS DSP, mono, at 24 or 16 kHz: they are dark), played by playbackRate from the
// nearest pitch: nylon guitar x5, twang bass x2, muted string x2, harmonic x2, tremolo x2, reed x3, bell, 5 percussion
// (4.8 MB; ~0.2 s of CPU in 22 jobs, a few per update). Live voices: the whistler (one sine voice per 2-bar phrase, with
// portamento) and the drone (2 oscillators per chord). Panners are shared, so most voices are a source and a gain.
import {mulberry32} from '../core/rng.js';
import {renderGuitar, renderTwang, renderMute, renderHarmonic, renderTremolo, renderReed, renderBell, renderPerc} from './western_dsp.js';

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const SC = [0, 2, 3, 5, 7, 8, 10];   // A natural minor (degree 0 = A)
// chords: root degree, the altered pitch class (re A) [from, to], an open-position guitar voicing (MIDI, low to high), the bass
const CH = {
  i: {name: 'Am', deg: 0, alt: null, gtr: [45, 52, 57, 60, 64], bass: 45},       // x02210
  iv: {name: 'Dm', deg: 3, alt: null, gtr: [50, 57, 62, 65], bass: 38},          // xx0231
  V: {name: 'E', deg: 4, alt: [10, 11], gtr: [40, 47, 52, 56, 59, 64], bass: 40}, // 022100 (G -> G#)
  bVI: {name: 'F', deg: 5, alt: null, gtr: [41, 48, 53, 57, 60, 65], bass: 41},   // 133211
  bVII: {name: 'G', deg: 6, alt: null, gtr: [43, 47, 50, 55, 59, 67], bass: 43},  // 320003
  bIII: {name: 'C', deg: 2, alt: null, gtr: [48, 52, 55, 60, 64], bass: 36},      // x32010
  bII: {name: 'Bb', deg: 1, alt: [2, 1], gtr: [46, 53, 58, 62, 65], bass: 46},    // x13331 (B -> Bb)
};
const PROGS = [
  ['i', 'bVII', 'bVI', 'V'],   // 0 the Andalusian cadence (the main theme's)
  ['i', 'iv', 'i', 'V'],       // 1
  ['i', 'bVI', 'bIII', 'V'],   // 2
  ['i', 'bVII', 'i', 'V'],     // 3
  ['iv', 'i', 'bVI', 'V'],     // 4
  ['i', 'bII', 'i', 'bII'],    // 5 Phrygian: the stand-off
  ['i', 'iv', 'bII', 'V'],     // 6 the Neapolitan cadence
  ['i', 'bVI', 'bVII', 'i'],   // 7
];
const SETS = {calm: [0, 1, 2, 3, 4], tension: [5, 6, 0], combat: [0, 7, 6]};
// tune rhythms: 2 bars of 16ths, [start, length]; notes of 6+ steps are the long (anchor) notes
const RH = {
  call: [[[0, 4], [4, 4], [8, 18]], [[2, 2], [4, 14], [20, 4], [24, 6]], [[0, 3], [3, 1], [4, 16], [22, 2], [24, 6]], [[0, 12], [12, 2], [14, 2], [16, 14]]],
  resp: [[[0, 6], [6, 2], [8, 8], [16, 12]], [[0, 16], [18, 2], [20, 10]], [[4, 2], [6, 2], [8, 6], [14, 2], [16, 14]]],
  cad: [[[0, 6], [6, 2], [8, 4], [12, 4], [16, 14]], [[0, 8], [8, 4], [12, 4], [16, 14]], [[0, 12], [14, 2], [16, 14]]],
};
// fingerpicking: [step, voicing index (0 = the lowest string; -1 = a muted up-strum of the top strings), level]
const PICK = {
  roll: [[0, 0, 1], [4, 2, .62], [6, 3, .55], [8, 1, .8], [10, 4, .55], [12, 3, .5], [14, 2, .45]],
  ballad: [[0, 0, 1], [6, 3, .55], [8, 1, .75], [12, 4, .55]],
  boom: [[0, 0, 1], [4, -1, .5], [8, 1, .85], [12, -1, .5]],
};
const PATS = ['roll', 'roll', 'ballad', 'boom'];
// the band's gain into music.js's layers (the parts' gains below are relative; this matches the other styles' loudness)
const TRIM = 2.3;

export function createWestern(ac, {lay, noise}) {
  // render rates: 24 kHz, 16 kHz for the darkest (nothing above ~3.5 kHz): half the CPU and memory of the context's rate
  const R = Math.random, rnd = mulberry32(0x3e5a27), HI = Math.min(ac.sampleRate, 24000), LO = Math.min(ac.sampleRate, 16000);
  const buf = (d, sr) => { const b = ac.createBuffer(1, d.length, sr); b.copyToChannel ? b.copyToChannel(d, 0) : b.getChannelData(0).set(d); return b; };
  // ---- the banks: one render job per note, each with its own seeded generator (the result can't depend on the slicing)
  const bank = {gtr: [], twang: [], mute: [], harm: [], trem: [], reed: [], bell: [], perc: {}}, jobs = [];
  let seed = 0x5a1d0;
  const note = (set, m, fn, sr) => { const s = seed++; jobs.push(() => { const r = fn(sr, mtof(m), mulberry32(s)); bank[set].push({m, b: buf(r.data, sr), f0: r.f0}); }); };
  for (const m of [40, 47, 54, 61, 68]) note('gtr', m, renderGuitar, HI);
  for (const m of [36, 45]) note('twang', m, renderTwang, LO);
  for (const m of [40, 47]) note('mute', m, renderMute, LO);
  for (const m of [67, 76]) note('harm', m, renderHarmonic, HI);
  for (const m of [60, 67]) note('trem', m, renderTremolo, HI);
  for (const m of [55, 62, 69]) note('reed', m, renderReed, LO);
  note('bell', 57, renderBell, LO);
  for (const k of ['clip', 'clop', 'tom', 'boom', 'shaker']) { const s = seed++, sr = k === 'tom' || k === 'boom' ? LO : HI; jobs.push(() => { bank.perc[k] = buf(renderPerc(sr, k, mulberry32(s)).data, sr); }); }
  let echoIn = null;
  const W = {ready: false, chord: 'Am', build, enter, tick, stinger};
  function build(ms = Infinity) {
    const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now(), t0 = now();
    while (jobs.length) { jobs.shift()(); if (now() - t0 > ms) break; }
    if (!jobs.length && !W.ready) { makeEcho(); W.ready = true; }
  }
  // the canyon: a dotted-8th echo (dark, thinning) that the whistle and the harmonica send to; it ends in the melody layer
  function makeEcho() {
    echoIn = ac.createGain();
    const dl = ac.createDelay(2), fb = ac.createGain(), lp = ac.createBiquadFilter(), hp = ac.createBiquadFilter(), out = ac.createGain();
    dl.delayTime.value = .625; fb.gain.value = .3; lp.type = 'lowpass'; lp.frequency.value = 1600; hp.type = 'highpass'; hp.frequency.value = 280; out.gain.value = .6;
    echoIn.connect(dl); dl.connect(lp); lp.connect(hp); hp.connect(out); hp.connect(fb); fb.connect(dl); out.connect(lay.mel.g);
  }

  // ---- players
  // panners are shared: one per (layer, position in 0.05 steps), made on first use and kept, so a voice is source -> gain
  const pans = new Map();
  function panTo(out, pan) {
    const q = Math.round(pan * 20); if (!q || !ac.createStereoPanner) return out;
    let m = pans.get(out); if (!m) pans.set(out, m = new Map());
    let p = m.get(q); if (!p) { p = ac.createStereoPanner(); p.pan.value = q / 20; p.connect(out); m.set(q, p); }
    return p;
  }
  const NO = {};
  function play(set, m, t, g, out, o = NO) {
    g *= TRIM;
    let best = set[0]; for (const s of set) if (Math.abs(s.m - m) < Math.abs(best.m - m)) best = s;
    const src = ac.createBufferSource(), rate = mtof(m) / best.f0; src.buffer = best.b; src.playbackRate.value = rate;
    if (o.slide) { src.playbackRate.setValueAtTime(rate * Math.pow(2, -o.slide / 12), t); src.playbackRate.linearRampToValueAtTime(rate, t + .09); }
    const v = ac.createGain(); v.gain.value = g;
    let f = null, e = null;
    if (o.lp) { f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; src.connect(f); f.connect(v); } else src.connect(v);
    v.connect(o.pan ? panTo(out, o.pan) : out);
    if (o.echo && echoIn) { e = ac.createGain(); e.gain.value = o.echo; v.connect(e); e.connect(echoIn); }
    src.start(t);
    if (o.dur) { const rel = o.rel || .06; v.gain.setValueAtTime(g, t + o.dur); v.gain.setTargetAtTime(0, t + o.dur, rel); src.stop(t + o.dur + rel * 7); }
    src.onended = () => { v.disconnect(); if (f) f.disconnect(); if (e) e.disconnect(); };
  }
  function perc(k, t, g, out, pan = 0) {
    g *= TRIM;
    const src = ac.createBufferSource(); src.buffer = bank.perc[k]; src.playbackRate.value = 1 + (R() - .5) * .05;
    const v = ac.createGain(); v.gain.value = g * (.9 + R() * .2); src.connect(v);
    v.connect(pan ? panTo(out, pan) : out);
    src.start(t); src.onended = () => v.disconnect();
  }
  // a strum: down = every string low to high (or the top `top` strings), up = the top strings high to low, quieter
  function strum(t, C, g, out, {up = false, spread = .016, dur = 0, top = 6} = NO) {
    const v = C.gtr, n = v.length, cnt = Math.min(top, n);
    for (let j = 0; j < cnt; j++) {
      const idx = up ? n - 1 - j : n - cnt + j;
      play(bank.gtr, v[idx], t + j * spread * (1 + (R() - .5) * .4), g * (1 - j * .05) * (.9 + R() * .2) * (up ? .8 : 1), out, {pan: (idx / (n - 1) - .5) * .3 - .05, dur, rel: .05});
    }
  }
  const twang = (t, m, dur, g, slide = 0, out = lay.bass.g) => play(bank.twang, m, t, g, out, {dur, rel: .09, slide, pan: -.04});
  // the drone: root + fifth, triangle waves under a low lid, swelling in and out over the chord (live, 2 oscillators)
  function drone(t, C, dur, g) {
    g *= TRIM;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = .5;
    const env = ac.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + Math.min(2, dur * .35));
    env.gain.setValueAtTime(g, t + dur - .3); env.gain.linearRampToValueAtTime(0, t + dur + 1.6);
    f.connect(env); env.connect(lay.pad.g);
    const r = C.bass < 40 ? C.bass + 12 : C.bass;
    for (const m of [r, r + 7]) { const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m); o.detune.value = (R() - .5) * 6; o.connect(f); o.start(t); o.stop(t + dur + 1.8); if (m === r) o.onended = () => env.disconnect(); }
  }

  // ---- the whistler: one live voice per 2-bar phrase. A sine with a faint octave, vibrato on the detune that grows on
  // long notes, breath through a narrow band at the pitch, portamento between legato notes (a tongue dip in the level),
  // a scoop into detached notes, now and then a fall-off at a note's end. `far`: quieter, more canyon echo.
  function whistle(t0, seg, s16, g, far) {
    g *= TRIM;
    const C = CH[prog[seg]], a = tune.segs[seg], b = tune.segs[seg + 1], base = seg * 32;
    if (a >= b) return;
    const o = ac.createOscillator(), o2 = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), h2 = ac.createGain();
    const br = ac.createBufferSource(), bp = ac.createBiquadFilter(), bp2 = ac.createBiquadFilter(), bl = ac.createBiquadFilter(), bg = ac.createGain(), env = ac.createGain(), es = ac.createGain();
    h2.gain.value = .05; lfo.frequency.value = 5.1 + R() * .7; lg.gain.value = 0;
    // the breath: noise through two band-passes at the pitch and a low-pass (one band-pass alone leaks a hiss up to 10 kHz)
    br.buffer = noise; br.loop = true; bp.type = bp2.type = 'bandpass'; bp.Q.value = bp2.Q.value = 4; bl.type = 'lowpass'; bl.frequency.value = 2200;
    bg.gain.value = far ? .8 : 1.2; env.gain.value = 0;
    es.gain.value = far ? .55 : .2;
    lfo.connect(lg); lg.connect(o.detune); lg.connect(o2.detune);
    o.connect(env); o2.connect(h2); h2.connect(env); br.connect(bp); bp.connect(bp2); bp2.connect(bl); bl.connect(bg); bg.connect(env);
    env.connect(panTo(lay.mel.g, .12));
    if (echoIn) { env.connect(es); es.connect(echoIn); }
    const FP = [o.frequency, o2.frequency, bp.frequency, bp2.frequency], FK = [1, 2, 1, 1];
    const fq = (time, f, tau) => { time = Math.max(0, time); for (let i = 0; i < 4; i++) if (tau) FP[i].setTargetAtTime(f * FK[i], time, tau); else FP[i].setValueAtTime(f * FK[i], time); };
    let start = 0, end = 0;
    for (let k = a; k < b; k++) {
      const n = tune.notes[k], pv = k > a ? tune.notes[k - 1] : null, nx = k + 1 < b ? tune.notes[k + 1] : null;
      const m = pitch(n.deg, 69, C), f = mtof(m), ts = t0 + (n.s - base) * s16 + (R() - .5) * .012, dur = n.len * s16, te = ts + dur;
      const legIn = pv && pv.s + pv.len >= n.s, legOut = nx && n.s + n.len >= nx.s;
      if (!pv) { start = ts; fq(ts - .02, f * .965); fq(ts, f, .05); env.gain.setValueAtTime(0, ts); env.gain.setTargetAtTime(g, ts, .03); }   // (ts >= t0 - .006 > .05)
      else if (legIn) {   // slide over to the new note; the level dips a little as the tongue moves
        const leap = Math.abs(m - pitch(pv.deg, 69, C)) > 4;
        fq(ts - .025, f, leap ? .05 : .03); env.gain.setTargetAtTime(g * .62, Math.max(0, ts - .04), .012); env.gain.setTargetAtTime(g, ts + .01, .03);
      } else { fq(ts, f * .97); fq(ts + .005, f, .04); env.gain.setTargetAtTime(g, ts, .03); }
      if (R() < .25 && dur > 1 && !legIn) { fq(ts, f * Math.pow(2, 2 / 12)); fq(ts + .07, f, .02); }   // a grace note from above
      lg.gain.setTargetAtTime(0, ts, .03);
      if (dur > .55) { lg.gain.setTargetAtTime(far ? 14 : 20 + R() * 10, ts + .28, .3); env.gain.setTargetAtTime(g * 1.08, ts + .35, .6); }
      if (!legOut) {
        env.gain.setTargetAtTime(0, te - .05, .05);
        if (dur > 1 && R() < .35) fq(te - .14, f * .93, .07);   // a fall-off
      }
      end = te;
    }
    const t1 = Math.max(0, start - .03), t2 = end + .6;
    for (const s of [o, o2, lfo]) { s.start(t1); s.stop(t2); }
    br.start(t1, R() * .5); br.stop(t2);
    o.onended = () => { env.disconnect(); es.disconnect(); };
  }
  // the harmonica: rendered reed notes (each bends up into its pitch); longOnly = only the tune's long notes, each held
  // until the next one (the tension wail)
  function harmonica(t0, seg, s16, g, longOnly, bright) {
    const C = CH[prog[seg]], a = tune.segs[seg], b = tune.segs[seg + 1], base = seg * 32;
    for (let k = a; k < b; k++) {
      const n = tune.notes[k]; if (longOnly && n.len < 6) continue;
      let len = n.len;
      if (longOnly) { let nx = base + 32; for (let j = k + 1; j < b; j++) if (tune.notes[j].len >= 6) { nx = tune.notes[j].s; break; } len = Math.min(nx - n.s - 1, n.len + 8); }
      const ts = t0 + (n.s - base) * s16 + (R() - .5) * .01;
      play(bank.reed, pitch(n.deg, 57, C), ts, g * (n.len >= 6 ? 1 : .82), lay.mel.g, {dur: len * s16 * .96, rel: .09, lp: 1300 + bright * 1700, pan: -.12, echo: .16});
    }
  }

  // ---- the composition (seeded)
  function pitch(d, base, C) {
    const o = Math.floor(d / 7); let m = base + 12 * o + SC[d - o * 7];
    if (C.alt && (((m - 45) % 12) + 12) % 12 === C.alt[0]) m += C.alt[1] - C.alt[0];
    return m;
  }
  function tonesOf(C) { const T = []; for (let o = -7; o <= 14; o += 7) for (const j of [0, 2, 4]) { const d = C.deg + j + o; if (d >= -3 && d <= 9) T.push(d); } return T; }
  function pickTone(T, p, leapy) {   // mostly near the last anchor, sometimes a 4th-6th away, now and then the octave (a call leaps more)
    const r = rnd(), want = r < (leapy ? .35 : .58) ? 1 : r < (leapy ? .75 : .88) ? 2 : 3, same = rnd() < .1, C = [];   // (the same note again: rarely)
    for (const d of T) { const a = Math.abs(d - p); if (want === 1 ? a <= 2 && (a || same) : want === 2 ? a >= 3 && a <= 5 : a === 7) if (!(p >= 7 && d > p + 1) && !(p <= 0 && d < p - 1)) C.push(d); }
    if (!C.length) { let best = T[0]; for (const d of T) if (Math.abs(d - p) < Math.abs(best - p)) best = d; return best; }
    return C[(rnd() * C.length) | 0];
  }
  function fill(rh, C, prev, cad, leapy) {
    const T = tonesOf(C), deg = new Array(rh.length).fill(null); let p = prev, last = 0;
    for (let i = 0; i < rh.length; i++) if (i === 0 || rh[i][1] >= 6) { deg[i] = p = pickTone(T, p, leapy && i > 0); last = i; }
    if (cad) { let best = 99; for (const d of [C.deg - 7, C.deg, C.deg + 7]) if (d >= -3 && d <= 9 && Math.abs(d - p) < Math.abs(best - p)) best = d; deg[last] = best; }
    for (let i = 1; i < rh.length; i++) if (deg[i] === null) {   // the short notes walk to the next anchor (passing / neighbour tones)
      const q = deg[i - 1]; let nb = -1; for (let j = i + 1; j < rh.length; j++) if (deg[j] !== null && (j === last || rh[j][1] >= 6)) { nb = j; break; }
      let d;
      if (nb < 0) d = q - 1 >= -3 ? q - 1 : q + 1;                                           // a falling tail
      else if (deg[nb] === q) d = q < 9 ? q + 1 : q - 1;                                     // a neighbour note
      else if (nb === i + 1) { d = deg[nb] + (q > deg[nb] ? 1 : -1); if (d === q) d = deg[nb] + (q > deg[nb] ? -1 : 1); }   // approach the anchor (from our side; else from the other)
      else d = q + Math.sign(deg[nb] - q);
      deg[i] = Math.max(-3, Math.min(9, d));
    }
    return rh.map(([s, len], i) => ({s, len, deg: deg[i]}));
  }
  function makeTune(P) {
    const notes = [], segs = [];
    let prev = [0, 2, 4, 4, 7][(rnd() * 5) | 0], A = null;
    for (let k = 0; k < 4; k++) {
      const C = CH[P[k]];
      let seg;
      if (k === 2) {   // the call again, moved to the third chord, its long notes snapped to that chord
        const T = tonesOf(C); let sh = C.deg - CH[P[0]].deg; sh = ((sh % 7) + 7) % 7; if (sh > 3) sh -= 7;
        seg = A.map(n => { let d = Math.max(-3, Math.min(9, n.deg + sh)); if (n.len >= 6 || n === A[0]) { let best = T[0]; for (const x of T) if (Math.abs(x - d) < Math.abs(best - d)) best = x; d = best; } return {s: n.s, len: n.len, deg: d}; });
      } else { const rh = k === 0 ? RH.call : k === 3 ? RH.cad : RH.resp; seg = fill(rh[(rnd() * rh.length) | 0], C, prev, k === 3, k === 0); }
      if (k === 0) A = seg;
      segs.push(notes.length);
      for (const n of seg) notes.push({s: n.s + k * 32, len: n.len, deg: n.deg});
      prev = seg[seg.length - 1].deg;
    }
    segs.push(notes.length);
    return {notes, segs};
  }

  // ---- the sequencer
  let bar = -1, pb = 0, ci = 0, prog = PROGS[0], pi = -1, again = false, tune = null, phraseN = 0, pat = 'roll';
  const tunes = new Map();
  function enter() { bar = -1; pi = -1; }
  function newPhrase(I) {   // the first phrase plays the main theme; a progression plays at most twice in a row
    phraseN++;
    const set = I >= .62 ? SETS.combat : I >= .42 ? SETS.tension : SETS.calm;
    let nx = pi;
    if (pi < 0) nx = I >= .42 ? set[0] : 0;
    else if (!(set.includes(pi) && !again && rnd() < .5)) do nx = set[(rnd() * set.length) | 0]; while (nx === pi);
    again = nx === pi; pi = nx; prog = PROGS[pi];
    if (!tunes.has(pi)) tunes.set(pi, makeTune(prog));
    tune = tunes.get(pi); pat = PATS[(rnd() * PATS.length) | 0];
  }
  function tick(st, t, I, time, s16) {
    const night = time === 'night', dusk = time === 'dusk';
    const A = lay.arp.on, B = lay.bass.on, M = lay.mel.on, L = lay.light.on, D = lay.drums.on;
    if (st === 0) { bar++; pb = bar % 8; if (pb === 0) newPhrase(I); ci = pb >> 1; }
    const C = CH[prog[ci]], first = pb % 2 === 0, hum = () => (R() - .5) * .012;
    W.chord = C.name;
    // ---- the pad layer: the drone, and the rest's own sparse guitar
    if (st === 0 && first && !D) { const lv = L ? .8 : A ? (dusk ? .9 : night ? .5 : .65) : dusk ? .6 : night ? .4 : 0; if (lv) drone(t, C, s16 * 32, .024 * lv); }
    if (!A) {
      const out = lay.pad.g;
      if (st === 0 && first && R() < (night ? .3 : dusk ? .75 : .55)) strum(t, C, .085, out, {spread: .085});   // a slow rolled chord, left to ring
      if (night && (st === 4 || st === 10) && R() < .22) play(bank.harm, C.gtr[C.gtr.length - 1 - ((R() * 3) | 0)] + 12, t + hum(), .09, out, {pan: (R() - .5) * .6});
      if (!night && !first && st === 8 && R() < .25) twang(t, C.bass, s16 * 8, .12, 0, out);
    }
    // ---- guitar (arp layer)
    if (A) {
      const out = lay.arp.g;
      if (D) {   // the gallop: TUM on every 8th, "ta-ka" on the 16th before it (32nds), on the chord's low string
        const r = C.gtr[0];
        if (st % 2 === 0) play(bank.mute, r, t, .27, out, {pan: -.15});
        else { play(bank.mute, r, t, .12, out, {pan: -.15}); play(bank.mute, r, t + s16 / 2, .15, out, {pan: -.15}); }
        if (st === 4 || st === 12) strum(t, C, .09, out, {spread: .011, dur: .3});
        else if (st === 0 && first) strum(t, C, .085, out, {spread: .016, dur: 1.4});
      } else if (L) {   // tension: a held tremolo (a new chord tone each bar), the thumb on 1 and 3
        const v = C.gtr;
        if (st === 0) play(bank.trem, first ? v[v.length - 1] : v[v.length - 2], t, .16, out, {dur: s16 * 16 - .05, rel: .2, pan: .15});
        if (st === 0 || st === 8) play(bank.gtr, v[0], t + hum(), .17, out, {pan: -.12, dur: s16 * 7, rel: .2});
      } else {   // explore: fingerpicking
        const P = PICK[night ? 'ballad' : pat], sp = night ? .6 : dusk ? .95 : .85;
        for (const [s, i, a] of P) if (s === st && (s === 0 || R() < sp)) {
          if (i < 0) strum(t + hum(), C, .07 * a, out, {up: true, top: 3, spread: .012, dur: .2});
          else { const v = C.gtr; play(bank.gtr, v[Math.min(i, v.length - 1)], t + hum(), .27 * a, out, {pan: (i - 2) * .08 - .05}); }
        }
        if (night && (st === 4 || st === 12) && R() < .25) play(bank.harm, C.gtr[C.gtr.length - 1 - ((R() * 3) | 0)] + 12, t + hum(), .08, out, {pan: (R() - .5) * .6});
      }
    }
    // ---- the twang bass
    if (B) {
      const r = C.bass, fifth = r + 7 > 49 ? r - 5 : r + 7;
      if (D) { if (st % 4 === 0) twang(t, r, s16 * 2.2, .23, st === 0 && first ? 2 : 0); else if (st === 6 || st === 14) twang(t, fifth, s16 * 1.5, .15); }
      else if (L) { if (st === 0) twang(t, r, s16 * 5, .22); else if (st === 6) twang(t, r, s16 * 2, .13); else if (st === 8) twang(t, fifth, s16 * 5, .17); }
      else if (st === 0) twang(t, first ? r : fifth, s16 * (night ? 14 : 10), first ? .22 : .17, first && R() < .4 ? 2 : 0);
      else if (!first && !night && st === 14 && R() < .4) { const nx = CH[prog[(ci + 1) % 4]]; twang(t, nx.bass - 2, s16 * 2, .13); }   // a walk-up into the next chord
    }
    // ---- the melody: the whistler / the harmonica, a 2-bar phrase at a time
    if (M && st === 0 && first && tune) {
      const seg = pb >> 1;
      if (D) harmonica(t, seg, s16, .27, false, 1);
      else if (L) harmonica(t, seg, s16, .2, true, .45);
      else if (dusk || (night ? seg === 0 || (seg === 2 && phraseN % 2 === 1) : phraseN % 2 === 1)) whistle(t, seg, s16, night ? .05 : .075, night);
    }
    // ---- percussion
    if (D) {
      const out = lay.drums.g;
      if (st % 2 === 0) perc('clop', t, .12, out, .2); else { perc('clip', t, .06, out, .2); perc('clip', t + s16 / 2, .075, out, .2); }
      if (st === 0 || st === 8) perc('tom', t + hum(), st === 0 ? .2 : .19, out);
      if (st === 0 && first) perc('boom', t, .2, out);
      if (st === 0 && pb === 0) play(bank.bell, 57, t, .12, out, {pan: .2});
    } else if (L) {   // tension: a trotting horse, a shaker, the mission bell on every chord
      const out = lay.light.g;
      if (st === 0 || st === 8) perc('clip', t + hum(), .2, out, -.2); else if (st === 3 || st === 11) perc('clop', t + hum(), .17, out, -.2);
      if (st === 6 || st === 14) perc('shaker', t + hum(), .08, out, .25);
      if (st === 0 && first) play(bank.bell, 57, t, .14, out, {pan: .2});
    }
  }
  function stinger(kind, t, s16) {
    const C = CH[prog[ci]], v = C.gtr, n = v.length, out = lay.sting.g;
    if (kind === 'open') { strum(t, C, .11, out, {spread: .05}); play(bank.harm, v[n - 1] + 12, t + .35, .12, out, {pan: .2}); }
    else if (kind === 'loot') play(bank.harm, v[n - 1 - ((R() * 3) | 0)] + 12, t, .11, out, {pan: (R() - .5) * .5});
    else if (kind === 'respawn') { for (let j = 0; j < 3; j++) play(bank.gtr, v[n - 1 - j], t + j * s16 * 2, .18, out); twang(t + 6 * s16, C.bass, s16 * 8, .22, -3, out); }
  }
  return W;
}
