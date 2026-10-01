// MUSIC: an adaptive, generative score for the proving grounds. It plays WITH the ambient beds (wind, birds, drones),
// not instead of them. OWNER: music (see docs/AUDIO.md §3.5).
//
// CONTRACT
//   export function createMusic(ac, dest, {send, enabled, offline}) -> MU
//     ac: the AudioContext (or an OfflineAudioContext for level tests); dest: the master input (audio.js E.out);
//     send: the shared reverb input (E.revIn)
//   MU.update(t, s)       every simulation step. s = {biome, time, speed, drawing, events, stomps}
//                         events = the frame's gameplay events (hit / break / explode / loot / open / respawn / ...)
//   MU.setEnabled(bool)   fade in / out (the host's U key); MU.enabled
//   MU.force(I | null)    pin the intensity 0..1 (settings: music intensity preview), null = adaptive
//   MU.setVolume(g)       the user's music volume (linear gain)
//   MU.schedule(until)    render notes up to `until` (seconds); called by the internal timer, or directly offline
//   MU.state              {biome, section, I, bar, chord} for the HUD / tests
//
// HOW IT WORKS
//   Style per biome: key and mode chosen to agree with that biome's ambient drones (rift drones sit on A,
//     ember's hum near D), tempo, progressions, and an instrument set.
//   Harmony: a 4-chord progression, 2 bars per chord; a new progression and melody motif every 8-bar phrase.
//   Vertical layers (the Hades / FMOD way): pad, arp, bass, melody, light percussion, drums. Each layer has its own
//     GainNode, and the INTENSITY I (0..1) decides which are on:
//       I < .2 rest (pad + a few notes)  .2 explore (+ arp, bass)  .42 tension (+ shaker)  .62 combat (+ drums, driving bass, 16th arps)
//     Layers enter on the next beat and leave at the next bar (quantised), with a short ramp and hysteresis.
//   Intensity: moving or drawing the bow lifts a floor; hits, breaks, explosions, brute stomps and getting hit add
//     heat; after ~6 s of quiet it decays back. Night plays sparser and softer, dusk a little warmer.
//   Instruments: pluck = Karplus-Strong, bell/glock = modal partials with beating pairs, drums = pitched-sine +
//     noise models. All are rendered once to AudioBuffers with plain seeded JS DSP, and played with playbackRate.
//     Pad, flute and bass are live oscillators (few voices, cheap).
//   Stingers: opening a chest plays a bell arpeggio in the current chord, loot plays a note from the scale, and a
//     respawn plays a falling pluck. All are quantised to the next 16th so they land in time with the music.

const DORIAN = [0, 2, 3, 5, 7, 9, 10], PHRYGIAN = [0, 1, 3, 5, 7, 8, 10], AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const HUNGARIAN = [0, 2, 3, 6, 7, 8, 11];   // minor with a raised 4th and 7th: eerie, still has the 5th for the rift's A-E drones

// chord degrees (0 = i); each progression is 4 chords x 2 bars
const STYLES = {
  ruins: {root: 50, scale: DORIAN, bpm: 84, progs: [[0, 3, 6, 0], [0, 6, 3, 4], [0, 4, 6, 3], [5, 3, 0, 6]],
    pad: {wave: 'sawtooth', cut: 950, det: 7, oct: 0, g: .038}, arp: {inst: 'pluck', oct: 1, pat: 'rise'},
    mel: {inst: 'flute', oct: 2, every: 2}, bass: {oct: -1}, drums: 'folk', level: 1},
  ember: {root: 50, scale: PHRYGIAN, bpm: 96, progs: [[0, 1, 0, 6], [0, 5, 1, 0], [0, 6, 5, 1]],
    pad: {wave: 'sawtooth', cut: 620, det: 11, oct: -1, g: .04}, arp: {inst: 'pluck', oct: 0, pat: 'ostinato'},
    mel: {inst: 'pluck', oct: 1, every: 2}, bass: {oct: -1}, drums: 'war', level: 1},
  frost: {root: 52, scale: AEOLIAN, bpm: 72, progs: [[0, 5, 2, 6], [0, 3, 5, 4], [5, 2, 6, 0]],
    pad: {wave: 'triangle', cut: 2400, det: 5, oct: 1, g: .05}, arp: {inst: 'glock', oct: 1, pat: 'sparse'},
    mel: {inst: 'bell', oct: 1, every: 2}, bass: {oct: -1}, drums: 'soft', level: .9},
  rift: {root: 45, scale: HUNGARIAN, bpm: 66, progs: [[0, 1, 0, 5], [0, 3, 1, 0], [0, 5, 3, 1]],
    pad: {wave: 'sawtooth', cut: 720, det: 16, oct: 0, g: .036}, arp: {inst: 'glock', oct: 1, pat: 'sparse'},
    mel: {inst: 'flute', oct: 1, every: 3}, bass: {oct: -1}, drums: 'ritual', level: .95},
};
// arp: [step (16ths), chord-tone index]; tones = [root, 3rd, 5th, root+12, 3rd+12, 5th+12]
const ARPS = {
  rise: [[0, 0], [2, 1], [4, 2], [6, 3], [8, 4], [10, 3], [12, 2], [14, 1]],
  ostinato: [[0, 0], [1, 0], [3, 2], [4, 0], [6, 1], [8, 0], [9, 0], [11, 2], [12, 3], [14, 1]],
  sparse: [[0, 3], [6, 2], [10, 4], [14, 1]],
};
// light percussion (I >= .42) and drums (I >= .62): [instrument, steps, velocity]
const KITS = {
  folk: {light: [['shaker', [2, 6, 10, 14], .5], ['click', [4, 12], .35]], full: [['frame', [0, 3, 6, 8, 11, 14], .8], ['tom', [0, 8], .9], ['shaker', [1, 3, 5, 7, 9, 11, 13, 15], .3]]},
  war: {light: [['shaker', [2, 6, 10, 14], .45], ['tom', [0], .5]], full: [['tom', [0, 3, 6, 8, 11, 14], .9], ['frame', [4, 12], .75], ['taiko', [0], 1], ['click', [2, 10], .3]]},
  soft: {light: [['shaker', [4, 12], .35]], full: [['frame', [0, 8], .7], ['shaker', [2, 6, 10, 14], .4], ['click', [12], .3]]},
  ritual: {light: [['click', [6, 14], .3]], full: [['tom', [0, 6, 12], .85], ['frame', [3, 9], .5], ['taiko', [0], .8]]},
};
// melody rhythms over 2 bars: [start step, length in steps]
const RHYTHMS = [
  [[0, 6], [6, 2], [8, 4], [12, 4], [16, 8], [24, 8]],
  [[0, 4], [4, 4], [8, 8], [18, 2], [20, 4], [24, 8]],
  [[2, 2], [4, 6], [10, 2], [12, 4], [16, 12]],
  [[0, 8], [8, 3], [11, 1], [12, 4], [16, 4], [20, 4], [24, 8]],
];

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ======================================================================================================================
// INSTRUMENT RENDERING: plain JS DSP into Float32Arrays (deterministic, seeded)
// ======================================================================================================================
function biquadBP(f, q, sr) {   // RBJ band-pass (constant 0 dB peak); returns a per-sample function
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
function finish(d, sr, peak = .9) {   // 2 ms fade-in, 30 ms fade-out, peak-normalise
  const fi = sr * .002 | 0, fo = sr * .03 | 0;
  for (let i = 0; i < fi; i++) d[i] *= i / fi;
  for (let i = 0; i < fo; i++) d[d.length - 1 - i] *= i / fo;
  let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i]));
  if (pk > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / pk;
  return d;
}
// Karplus-Strong pluck with a darker excitation, a pick-position comb and a small wooden body resonance
function renderPluck(sr, f, rnd, {dur = 2.4, bright = .45, damp = .9955} = {}) {
  const n = dur * sr | 0, out = new Float32Array(n), N = Math.max(2, Math.round(sr / f - .5));
  const line = new Float32Array(N); let lp = 0;
  for (let i = 0; i < N; i++) { lp += (rnd() * 2 - 1 - lp) * bright; line[i] = lp; }
  const pk = Math.max(1, Math.round(N * .13));   // pick position: remove the harmonics with a node there
  const exc = line.slice(); for (let i = 0; i < N; i++) line[i] = exc[i] - exc[(i + pk) % N] * .7;
  const b1 = biquadBP(180, 1.2, sr), b2 = biquadBP(420, 1.5, sr);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = line[k], b = line[(k + 1) % N], y = damp * .5 * (a + b);
    line[k] = y; k = (k + 1) % N;
    out[i] = a + b1(a) * .35 + b2(a) * .2;
  }
  return {data: finish(out, sr), f0: sr / (N + .5)};
}
// modal bell: partials (ratio, amp, T60 seconds), the main ones doubled with a slightly detuned twin so they beat
function renderBell(sr, f, rnd, {dur = 3.2, decay = 1} = {}) {
  const P = [[.5, .3, 2.6], [1, 1, 1.9], [1.19, .32, 1.1], [1.5, .22, .9], [2, .45, .8], [2.52, .18, .5], [3.01, .14, .4], [4.07, .09, .28], [5.2, .05, .18]];
  const n = dur * sr | 0, out = new Float32Array(n);
  for (const [r, a, T] of P) for (const tw of r === 1 || r === 2 ? [0, 1] : [0]) {
    const fr = f * r + (tw ? .6 + rnd() * .8 : 0), k = 6.91 / (T * decay * sr), w = 2 * Math.PI * fr / sr, ph = rnd() * 6.28, amp = a * (tw ? .5 : 1);
    if (fr > sr * .45) continue;
    for (let i = 0; i < n; i++) out[i] += amp * Math.exp(-k * i) * Math.sin(w * i + ph);
  }
  const s = sr * .004 | 0; for (let i = 0; i < s; i++) out[i] += (rnd() * 2 - 1) * .15 * (1 - i / s);   // mallet tick
  return {data: finish(out, sr, .85), f0: f};
}
// drums: pitched sine with a falling pitch + a noise body
function renderDrum(sr, kind, rnd) {
  const cfg = {
    frame: {dur: .45, f0: 190, f1: 72, pt: .05, T: .22, noise: .35, nf: 1800, nT: .03, mode2: 1.58},
    tom: {dur: .8, f0: 125, f1: 58, pt: .08, T: .42, noise: .25, nf: 700, nT: .05, mode2: 1.5},
    taiko: {dur: 1.4, f0: 95, f1: 42, pt: .1, T: .75, noise: .4, nf: 500, nT: .09, mode2: 1.47},
    shaker: {dur: .12, noise: 1, nf: 7000, nT: .035, hp: true},
    click: {dur: .08, f0: 820, f1: 760, pt: .01, T: .025, noise: .6, nf: 2600, nT: .008, mode2: 1.6},
  }[kind];
  const n = cfg.dur * sr | 0, out = new Float32Array(n);
  if (cfg.f0) {
    let ph = 0, ph2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = cfg.f1 + (cfg.f0 - cfg.f1) * Math.exp(-t / cfg.pt), e = Math.exp(-6.91 * t / cfg.T / 2.3);
      ph += 2 * Math.PI * f / sr; ph2 += 2 * Math.PI * f * (cfg.mode2 || 1.5) / sr;
      out[i] = e * (Math.sin(ph) + .25 * Math.sin(ph2) * Math.exp(-t / (cfg.T * .3)));
    }
  }
  const bp = biquadBP(cfg.nf, cfg.hp ? .7 : 1.1, sr);
  for (let i = 0; i < n; i++) { const t = i / sr, e = cfg.hp ? Math.min(1, t / .006) * Math.exp(-t / cfg.nT) : Math.exp(-t / cfg.nT); out[i] += cfg.noise * e * bp(rnd() * 2 - 1) * 2.2; }
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(out[i]));
  return {data: finish(out, sr, .9), f0: 1};
}

// ======================================================================================================================
// MUSIC ENGINE
// ======================================================================================================================
export function createMusic(ac, dest, {send = null, enabled = true, offline = false} = {}) {
  const sr = ac.sampleRate, rnd = mulberry32(0x5eed), R = Math.random;
  const buf = d => { const b = ac.createBuffer(1, d.length, sr); b.copyToChannel ? b.copyToChannel(d, 0) : b.getChannelData(0).set(d); return b; };
  // ---- render the instrument banks once (≈ 0.3 s of CPU) ----
  const bank = {pluck: [], bell: [], glock: [], drum: {}};
  for (const m of [45, 57, 69, 81]) { const r = renderPluck(sr, mtof(m), rnd); bank.pluck.push({m, b: buf(r.data), f0: r.f0}); }
  for (const m of [69, 81]) { const r = renderBell(sr, mtof(m), rnd); bank.bell.push({m, b: buf(r.data), f0: r.f0}); }
  for (const m of [69, 81]) { const r = renderBell(sr, mtof(m), rnd, {dur: 1.4, decay: .35}); bank.glock.push({m, b: buf(r.data), f0: r.f0}); }
  for (const k of ['frame', 'tom', 'taiko', 'shaker', 'click']) bank.drum[k] = buf(renderDrum(sr, k, rnd).data);
  const noise = (() => { const d = new Float32Array(sr); for (let i = 0; i < sr; i++) d[i] = rnd() * 2 - 1; return buf(d); })();

  // ---- graph: layers -> music bus -> dest (+ reverb send) ----
  const bus = ac.createGain(); bus.gain.value = enabled ? .0001 : 0;
  const vol = ac.createGain(); vol.gain.value = 1; bus.connect(vol); vol.connect(dest);   // the user's music volume (settings)
  if (send) { const s = ac.createGain(); s.gain.value = .45; vol.connect(s); s.connect(send); }
  const LAYERS = ['pad', 'arp', 'bass', 'mel', 'light', 'drums', 'sting'];
  const lay = {}; for (const k of LAYERS) { const g = ac.createGain(); g.gain.value = k === 'pad' || k === 'sting' ? 1 : 0; g.connect(bus); lay[k] = {g, on: k === 'pad' || k === 'sting'}; }
  const MASTER = .25;   // music sits under the SFX and ALONGSIDE the beds (explore ≈ -26 dB RMS, beds -33..-41)

  // ---- state ----
  let style = STYLES.ruins, styleId = 'ruins', pending = null, time = 'day';
  let step = 0, nextT = null, bar = 0, chord = 0, prog = style.progs[0], motif = null, phrase = 0;
  let I = .15, heat = 0, lastHeat = -99, forced = null, clock = 0, on = enabled;
  const MU = {get enabled() { return on; }, state: {}, update, setEnabled, force, schedule,
    setVolume: v => vol.gain.setTargetAtTime(Math.max(0, v), ac.currentTime, .03)};

  const spb = () => 60 / style.bpm, s16 = () => spb() / 4;
  const scaleNote = (deg, oct = 0) => { const L = style.scale.length, o = Math.floor(deg / L), d = ((deg % L) + L) % L; return style.root + style.scale[d] + 12 * (o + oct); };
  const chordTones = (deg, oct = 0) => [0, 2, 4, 7, 9, 11].map(i => scaleNote(deg + i, oct));   // root, 3rd, 5th, then an octave up
  const night = () => time === 'night', dusk = () => time === 'dusk';

  function sample(set, m, t, g, dest, {pan = 0} = {}) {
    let best = set[0]; for (const s of set) if (Math.abs(s.m - m) < Math.abs(best.m - m)) best = s;
    const src = ac.createBufferSource(); src.buffer = best.b; src.playbackRate.value = mtof(m) / best.f0;
    const v = ac.createGain(); v.gain.value = g; src.connect(v);
    if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = pan; v.connect(p); p.connect(dest); } else v.connect(dest);
    src.start(t); src.onended = () => v.disconnect();
  }
  function drum(kind, t, g, layer) { const src = ac.createBufferSource(); src.buffer = bank.drum[kind]; src.playbackRate.value = 1 + (R() - .5) * .04; const v = ac.createGain(); v.gain.value = g; src.connect(v); v.connect(lay[layer].g); src.start(t); src.onended = () => v.disconnect(); }
  function padChord(t, notes, dur) {
    const P = style.pad, f = ac.createBiquadFilter(); f.type = 'lowpass';
    const bright = 1 + I * .8 + (night() ? -.3 : dusk() ? .1 : 0);
    f.frequency.setValueAtTime(P.cut * bright, t); f.frequency.linearRampToValueAtTime(P.cut * bright * 1.25, t + dur * .6); f.Q.value = .6;
    const env = ac.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(P.g, t + Math.min(1.6, dur * .3));
    env.gain.setValueAtTime(P.g, t + dur - .2); env.gain.linearRampToValueAtTime(0, t + dur + 1.8);
    f.connect(env); env.connect(lay.pad.g);
    for (const m of notes) for (const c of [-P.det, P.det]) {
      const o = ac.createOscillator(); o.type = P.wave; o.frequency.value = mtof(m + 12 * P.oct); o.detune.value = c + (R() - .5) * 4;
      o.connect(f); o.start(t); o.stop(t + dur + 2);
    }
    setTimeoutSafe(() => { try { env.disconnect(); } catch (e) {} }, (t - ac.currentTime + dur + 2.2) * 1000);
  }
  function flute(t, m, dur, g) {
    const f = mtof(m), o = ac.createOscillator(), o2 = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f * 2;
    lfo.frequency.value = 5 + R() * .6; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * .006, t + Math.min(.35, dur * .6));
    lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
    const h2 = ac.createGain(); h2.gain.value = .12; o2.connect(h2);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(6000, f * 5);
    const env = ac.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + .07);
    env.gain.setValueAtTime(g * .85, t + Math.max(.08, dur - .05)); env.gain.linearRampToValueAtTime(0, t + dur + .12);
    o.connect(lp); h2.connect(lp); lp.connect(env); env.connect(lay.mel.g);
    const br = ac.createBufferSource(); br.buffer = noise; const bf = ac.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = f * 2; bf.Q.value = 1.5;
    const bg = ac.createGain(); bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(g * .35, t + .03); bg.gain.linearRampToValueAtTime(g * .06, t + .15); bg.gain.linearRampToValueAtTime(0, t + dur + .1);
    br.connect(bf); bf.connect(bg); bg.connect(lay.mel.g);
    const end = t + dur + .2;
    for (const s of [o, o2, lfo]) { s.start(t); s.stop(end); }
    br.start(t, R() * .5); br.stop(end); o.onended = () => { env.disconnect(); bg.disconnect(); };
  }
  function bass(t, m, dur, g) {
    const o = ac.createOscillator(), s = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m); s.frequency.value = mtof(m);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420 + I * 500;
    const env = ac.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(g, t + .012); env.gain.setTargetAtTime(g * .55, t + .05, .15);
    env.gain.setValueAtTime(g * .5, t + dur); env.gain.linearRampToValueAtTime(0, t + dur + .08);
    o.connect(lp); s.connect(lp); lp.connect(env); env.connect(lay.bass.g);
    for (const x of [o, s]) { x.start(t); x.stop(t + dur + .1); } o.onended = () => env.disconnect();
  }
  const setTimeoutSafe = (fn, ms) => { if (!offline && typeof setTimeout === 'function') setTimeout(fn, Math.max(0, ms)); };

  // ---- melody: a 2-bar motif (scale-degree random walk on a rhythm), repeated over the chords with variation ----
  function newMotif() {
    const rh = RHYTHMS[(rnd() * RHYTHMS.length) | 0]; let deg = [0, 2, 4][(rnd() * 3) | 0];
    const notes = rh.map(([s, len], i) => {
      if (i) { const r = rnd(); deg += r < .35 ? 1 : r < .7 ? -1 : r < .82 ? 2 : r < .92 ? -2 : 0; deg = clamp(deg, -2, 7); }
      return {s, len, deg};
    });
    notes[notes.length - 1].deg = [0, 2, 4][(rnd() * 3) | 0];   // land on a chord tone
    return notes;
  }

  // ---- intensity ----
  function heatUp(v, t) { heat = Math.min(1, heat + v); lastHeat = t; }
  const HEAT = {hit: .22, break: .1, explode: .45, trap: .15, open: 0, loot: 0};
  function update(t, s = {}) {
    const dt = clamp(t - clock, 0, .25); clock = t;
    if (s.biome && STYLES[s.biome] && s.biome !== styleId && (!pending || pending.id !== s.biome)) pending = {id: s.biome};
    time = s.time || 'day';
    for (const e of s.events || []) {
      if (HEAT[e.type]) heatUp(e.player ? .4 : HEAT[e.type], t);
      if (e.type === 'open') stinger('open'); else if (e.type === 'loot' || e.type === 'coin') stinger('loot'); else if (e.type === 'respawn') stinger('respawn');
    }
    if (s.stomps) heatUp(.12 * s.stomps, t);
    if (t - lastHeat > 6) heat = Math.max(0, heat - dt * .07);   // ~6 s of quiet, then it cools over ~12 s
    const floor = (s.drawing ? .36 : s.speed > .5 ? .26 : .12) * (night() ? .8 : 1);
    const target = forced ?? clamp(floor + heat * .75, 0, 1);
    I += (target - I) * Math.min(1, dt * (target > I ? 2.5 : .5));   // rise fast, settle slowly
    if (on && !offline) schedule(ac.currentTime + .2);
    MU.state = {biome: styleId, section: section(), I: +I.toFixed(2), bar, chord: prog[chord]};
  }
  function force(v) {   // a fixed level applies at once (also while the game is paused: the sequencer keeps running)
    forced = v ?? null; if (forced !== null) I = forced;
    MU.state = {biome: styleId, section: section(), I: +I.toFixed(2), bar, chord: prog[chord]};
  }
  const section = () => I >= .62 ? 'combat' : I >= .42 ? 'tension' : I >= .2 ? 'explore' : 'rest';
  // layer wanted states with hysteresis
  function want(k) {
    const th = {arp: .2, bass: .2, mel: .2, light: .42, drums: .62}[k], cur = lay[k].on;
    return I >= th - (cur ? .08 : 0);
  }
  function applyLayers(t, barStart) {
    for (const k of ['arp', 'bass', 'mel', 'light', 'drums']) {
      const w = want(k);
      if (w === lay[k].on) continue;
      if (!w && !barStart) continue;   // leave at bar lines, enter on any beat
      lay[k].on = w;
      lay[k].g.gain.setTargetAtTime(w ? 1 : 0, t, w ? .08 : .6);
    }
    const lv = MASTER * style.level * (night() ? .72 : dusk() ? .9 : 1) * (on ? 1 : 0);
    bus.gain.setTargetAtTime(Math.max(.0001, lv), t, on ? .8 : .5);
  }

  // ---- stingers (quantised to the next 16th) ----
  const stingQ = [];
  function stinger(kind) { if (on) stingQ.push(kind); }
  function playStingers(t) {
    while (stingQ.length) {
      const k = stingQ.shift(), tones = chordTones(prog[chord], 1), sd = s16();
      if (k === 'open') tones.slice(0, 5).forEach((m, i) => sample(bank.bell, m + 12, t + i * sd, .16 - i * .015, lay.sting.g, {pan: (i - 2) * .15}));
      else if (k === 'loot') sample(bank.glock, tones[(R() * 3) | 0] + 24, t, .12, lay.sting.g, {pan: (R() - .5) * .6});
      else if (k === 'respawn') [5, 4, 2, 0].forEach((j, i) => sample(bank.pluck, tones[j], t + i * sd * 2, .2, lay.sting.g));
    }
  }

  // ---- the sequencer ----
  function schedule(until) {
    if (nextT === null || nextT < ac.currentTime - .1) nextT = ac.currentTime + .06;
    while (nextT < until) { tick(step % 16, nextT); nextT += s16(); step++; }
  }
  function tick(st, t) {
    const hum = () => (R() - .5) * .01;   // ±5 ms humanise
    if (st === 0) {   // bar line: style changes, chords, phrases
      if (pending) {
        style = STYLES[pending.id]; styleId = pending.id; pending = null; bar = 0;
        prog = style.progs[(rnd() * style.progs.length) | 0]; motif = newMotif();
        bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(bus.gain.value * .3, t + .05);   // soft reset
      }
      if (bar % 8 === 0) { if (bar) prog = style.progs[(rnd() * style.progs.length) | 0]; phrase++; if (!motif || phrase % 2 === 0) motif = newMotif(); }
      if (bar % 2 === 0) { chord = (bar / 2) % 4; padChord(t, chordTones(prog[chord], 0).slice(0, 3), spb() * 8); }
      applyLayers(t, true); bar++;
    } else if (st % 4 === 0) applyLayers(t, false);
    playStingers(t);
    const deg = prog[chord], tones = chordTones(deg, 0), sparse = night() ? .5 : dusk() ? .8 : 1;
    // arp
    if (lay.arp.on) {
      const A = style.arp, fast = I >= .62 && A.pat !== 'sparse';
      const pat = fast ? ARPS.rise.map(([s, i]) => [[s, i], [s + 1, (i + 2) % 6]]).flat() : ARPS[A.pat];
      for (const [s, i] of pat) if (s === st && R() < sparse * (.7 + I * .4)) {
        const set = bank[A.inst], m = tones[i] + 12 * A.oct;
        sample(set, m, t + hum(), (A.inst === 'pluck' ? .28 : .17) * (st % 4 === 0 ? 1 : .8), lay.arp.g, {pan: (i - 2.5) * .12});
      }
    }
    // bass
    if (lay.bass.on) {
      const B = style.bass, root = tones[0] + 12 * B.oct;
      if (I >= .62) { if (st % 2 === 0) bass(t, st % 8 === 6 ? root + 12 : root, s16() * 1.6, st % 4 === 0 ? .21 : .15); }
      else if (st === 0) bass(t, root, spb() * 2.6, .2);
      else if (st === 10 && R() < .5) bass(t, tones[2] + 12 * B.oct - 12, spb() * 1.2, .14);
    }
    // melody: every Nth phrase, bars 1-6 of the phrase, the motif follows the chord
    if (lay.mel.on && motif && phrase % style.mel.every === 0 && (bar - 1) % 8 < 6 && !(night() && I < .5)) {
      const local = ((bar - 1) % 2) * 16 + st, vary = (bar - 1) % 8 >= 4;
      for (const n of motif) if (n.s === local) {
        const d = n.deg + deg - prog[0] + (vary && n === motif[motif.length - 1] ? 1 : 0), m = scaleNote(d, style.mel.oct), len = n.len * s16();
        if (style.mel.inst === 'flute') flute(t + hum(), m, len * .95, .09);
        else sample(bank[style.mel.inst], m, t + hum(), .2, lay.mel.g, {pan: .1});
      }
    }
    // percussion
    const kit = KITS[style.drums];
    if (lay.light.on && !lay.drums.on) for (const [k, steps, v] of kit.light) if (steps.includes(st)) drum(k, t + hum(), v * .5, 'light');
    if (lay.drums.on) for (const [k, steps, v] of kit.full) if (steps.includes(st) && !(k === 'taiko' && (bar - 1) % 2)) drum(k, t + hum(), v * (st === 0 ? .6 : .48) * (.9 + R() * .2), 'drums');
  }

  function setEnabled(v) { on = !!v; if (on) nextT = null; bus.gain.setTargetAtTime(on ? Math.max(.0001, MASTER * style.level) : 0, ac.currentTime, on ? .8 : .4); }
  if (!offline && typeof setInterval === 'function') setInterval(() => { if (on && ac.state === 'running') schedule(ac.currentTime + .25); }, 50);
  return MU;
}
