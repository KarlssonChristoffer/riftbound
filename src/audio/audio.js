// AUDIO: procedural sound for the proving grounds (SFX, footsteps, the bow, ambient beds, the stream). OWNER: audio agent.
//
// CONTRACT (the host, arena.html, calls exactly these):
//   export function createAudio(ctx, host) -> AU
//   host = {arrows, props, combat, wind}       // each a value OR a getter () => value (the host may create them later).
//                                              //   optional propsVersion: bump it when props are added / removed / change kind
//                                              //   (sound-making props are cached in short lists; also refreshed once a second)
//                                              //   wind (arena/wind.js): wind.gust 0..1 drives the beds' gusts; wind.on false = own random gusts
//                                              //   Read only: new arrows = shots (arrow.ab 'multi'|'boom'|'rain'|'pierce'),
//                                              //   arrows turning .stuck = thuds, brutes landing a hop = stomps,
//                                              //   combat.dbg.zones / .traps growing = rain volley cast / trap laid
//   AU.update(dt, player, events)              // every simulation step, with the SAME events array atmos gets (not spliced here)
//                                              //   player {x, y, z, vx, vy, state, t, aim, biome, time, cam, screenX?}
//                                              //   screenX(x, y) -> view px: optional, pans by the screen when the camera turns (3D page)
//                                              //   aim = LMB held; biome = 'ruins'|'ember'|'frost'|'rift'; time = 'day'|'dusk'|'night'
//   AU.toggle() -> muted                       // host maps key 'm' (remembered per viewer in localStorage)
//   AU.setVolume(k, 0..1) / AU.volumes      // k: master | music | sfx | amb (pause menu > Sound; remembered in localStorage)
//   AU.setMusicMode(m) / AU.musicMode       // 'adaptive' (follows play) | 'explore' | 'combat' (fixed intensity, for previews)
//   AU.toggleMusic() -> on                     // host maps key 'u': the adaptive score (music.js) on / off, remembered too
//   ctx = {PPM, VW, layout, ...}               // only PPM / VW (panning by screen x) and layout.elev are read
//
// Events used: step {big 0|1} / land {big 2 sprint plant, 3 big drop} / jump / splash {small} (player.js, arena.html);
// hit {player?} / break {kind} / explode {r} / loot {n} / coin / open / trap / respawn (combat.js). Derived here from
// player.state transitions: roll start, landing (state -> 'land'), climb scrapes, the bow draw creak (state 'draw' + aim).
//
// RULES: Web Audio only, everything synthesised (oscillators, pre-rendered noise buffers, envelopes); no files, no libs.
// The AudioContext is created / resumed on the first user gesture (keydown / pointerdown). Before that, in the ?sheet=
// capture modes, with ?audio=0, or without Web Audio, every call is a cheap no-op and nothing ever throws.
// Master chain: sfx + ambient + reverb -> master -> compressor -> soft clipper (peaks can't pass ~0.9).
// Voices are capped (MAXV, low-priority sounds drop first), each sound has a cooldown, and repeats of the same sound
// within 0.35 s are attenuated (arrow rain / explosion chains don't stack up). Every trigger varies pitch and gain a bit.
//
// EXTRAS (tests, tuning): window.__audio = AU; AU.on (engine running), AU.muted, AU.play(name, o) (trigger one SFX by name at the player),
// AU.E (the live engine; AU.E.counts = triggers per sound), AU.ms (update cost), and the standalone export renderOffline(list, opts) -> [{name, peak, rms}]
// that renders SFX / beds in an OfflineAudioContext to check levels (see the bottom of this file).

import {STREAM, elev as elevOf} from '../world/layout.js';
import {createMusic} from './music.js';   // the adaptive score, layered with the beds (U toggles it)
// Phase 2 (docs/AUDIO.md): the Sound Forge runtime. Forge sounds baked in a Worker at load play first; this file's
// synth below is the FALLBACK for anything not baked yet (or with ?forge=0, to compare).
import {createEngine, REVERBS} from '../../audio/runtime/engine.js';
import {createBakery} from '../../audio/runtime/bakery.js';
import {createDirector} from '../../audio/runtime/director.js';
import {EVENTS, AMBIENCE, SOURCES} from '../../audio/runtime/events.js';
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';

const R = Math.random, RR = (a, b) => a + R() * (b - a), J = p => 1 + (R() * 2 - 1) * p;
const pick = a => a[(R() * a.length) | 0];
const MAXV = 30;   // simultaneous SFX voices (priority 2 / 3 sounds may go 6 / 12 over)

// THE WATERFALLS (river brief D): the ruins' two falls are positional sources like the torches' fires (the director gives the nearest few on
// screen a loop each: audio/runtime/director.js updateSources, level / pan / low-pass from SPATIAL.world: -6 dB per metre off screen, culled
// 2 m off). The loop is the forge's stream 'rapids' (a strong rush with spray, still dark: docs/AUDIO.md's sound taste), a notch under the
// brook's bank level so a fall near the river stands out only as you come close; `dScale` makes the distance count 1.8x, so the swell from the
// view's edge to the fall's foot is ~11 dB. Added to the director's own SOURCES table by its options (not by writing events.js's constant).
// The ravine's lip: the stream's centre x there, y ~ 27.9 (the biome's own edge as world.js cliffZ reads it; depth.js WA.yEnd 27.85). A proper 'fall' case of the stream
// recipe (more spray, no extra highs) would be the next step: audio/forge/recipes/stream.js.
const WATERFALL = {recipe: 'stream', case: 'rapids', gainDb: -22};
const FALL = {dScale: 1.8, ravineY: 27.9, reach: 32};
// THE DESERT (world/desert.js, "Red Mesa"). Its forge ambience is made of banks the forge already bakes, added to the director
// by its options like the waterfall (events.js's AMBIENCE is not written): a hot, dry wind by day (ember_hot: a low wind, a
// faint roar, next to no leaves), the gustier one at dusk and night, insects by day (a hum, far rasps), crickets at night, the
// creek as the brook. What the forge has no bank for (a hawk's cry by day, cicadas swelling in the heat, coyotes at night) is
// synthesised (desertCalls), far off and panned wide, under the beds; the hawk you SEE cries through SFX.hawk (wildlife.js's
// 'caw'). Footsteps read the ground under the foot (ctx.ground: world/desert.js B.groundAt): paving and rock are stone, sand a
// soft muffled crunch (the forge's fine gravel pitched down and darkened; the synth's 'sand'), hardpan a dry tap. The reverb:
// short dry open air, and near the canyon's rim a long one whose early reflections come late (the far wall answering).
const DESERT_AMB = {
  beds: {
    day: [{recipe: 'wind', case: 'ember_hot', gainDb: -25, gust: 6}, {recipe: 'insects', case: 'day', gainDb: -38, bakePriority: 6}],
    dusk: [{recipe: 'wind', case: 'gusty', gainDb: -26.5, gust: 6}, {recipe: 'insects', case: 'dusk', gainDb: -34, bakePriority: 5}],
    night: [{recipe: 'wind', case: 'gusty', gainDb: -29, gust: 5}, {recipe: 'insects', case: 'night', gainDb: -31, bakePriority: 5}],
  },
  calls: [],
  emitters: [{recipe: 'stream', case: 'brook', at: 'stream', gainDb: -22, floorDb: -14, lpf: [600, 8000]}],
};
const DESERT_REVERBS = {
  desert: {rt: .55, pre: .01, lp0: 8000, lp1: 2200, hp: 160, er: 4, erSpan: .08, erGain: .3, width: 1, wet: -3},
  canyon: {rt: 1.9, pre: .045, lp0: 6000, lp1: 1400, hp: 140, er: 6, erSpan: .32, erGain: .7, width: 1, wet: 0},
};
const CANYON = {in: 23.6, out: 22.8, rev: [.14, .38]};   // the player's y (m) where the canyon's echo comes in / goes (its rim ~27.7); the synth's reverb level out / in
const DESERT_STEP = {sand: {surf: 'sand', ground: 'gravel', semi: -4, lpf: 2400, gainDb: -2}, pan: {surf: 'pan', ground: 'gravel', semi: -1, lpf: 3400, gainDb: -6},
  stone: {surf: 'stone', ground: 'stone'}, rock: {surf: 'stone', ground: 'stone'}};

// ======================================================================================================================
// ENGINE: one per AudioContext (live, or offline for level tests)
// ======================================================================================================================
function makeEngine(ac, dest = null) {   // dest: where the legacy chain ends (the forge engine's master), else the speakers
  const sr = ac.sampleRate;
  // ---- noise buffers, rendered once; loops are cross-faded at the seam so filtered beds never click ----
  function noiseBuf(sec, kind) {
    const L = (sec * sr) | 0, X = (sr * .08) | 0, raw = new Float32Array(L + X);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
    for (let i = 0; i < L + X; i++) {
      const w = R() * 2 - 1;
      if (kind === 'pink') {   // Paul Kellet's filter
        b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
        b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362; b6 = w * .115926;
      } else if (kind === 'brown') { br = (br + .02 * w) / 1.02; raw[i] = br; }
      else raw[i] = w;
    }
    const buf = ac.createBuffer(1, L, sr), d = buf.getChannelData(0);
    for (let i = 0; i < L; i++) d[i] = raw[i];
    for (let i = 0; i < X; i++) { const k = i / X; d[i] = raw[i] * k + raw[L + i] * (1 - k); }   // seam: end flows into start
    let pk = 0; for (let i = 0; i < L; i++) pk = Math.max(pk, Math.abs(d[i]));
    for (let i = 0; i < L; i++) d[i] *= .95 / (pk || 1);
    return buf;
  }
  const W = noiseBuf(2.5, 'white'), PK = noiseBuf(7, 'pink'), BR = noiseBuf(7, 'brown');
  // ---- small dark room / open-air reverb (one convolver for everything) ----
  function impulse(sec) {
    const L = (sec * sr) | 0, b = ac.createBuffer(2, L, sr), pre = (sr * .012) | 0;
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = pre; i < L; i++) { const k = i / L; lp += ((R() * 2 - 1) * Math.pow(1 - k, 2.4) - lp) * (.5 - .4 * k); d[i] = lp; }
    }
    return b;
  }
  // ---- master chain ----
  const out = ac.createGain(); out.gain.value = .9;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = .003; comp.release.value = .22;
  const clip = ac.createWaveShaper(), CN = 2049, curve = new Float32Array(CN);
  for (let i = 0; i < CN; i++) { const x = i / (CN - 1) * 2 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a < .6 ? a : .6 + .32 * Math.tanh((a - .6) / .32)); }
  clip.curve = curve;
  out.connect(comp); comp.connect(clip); clip.connect(dest || ac.destination);
  const sfx = ac.createGain(); sfx.gain.value = .85; sfx.connect(out);
  const amb = ac.createGain(); amb.gain.value = 1; amb.connect(out);
  const conv = ac.createConvolver(); conv.buffer = impulse(1.7);
  const revIn = ac.createGain(), revOut = ac.createGain(); revOut.gain.value = .22;
  revIn.connect(conv); conv.connect(revOut); revOut.connect(out);
  const pan = (dest, p) => { if (!ac.createStereoPanner) return dest; const n = ac.createStereoPanner(); n.pan.value = clamp(p || 0, -.9, .9); n.connect(dest); return n; };

  // ---- voices ----
  const live = [], lastT = {}, recent = {}, counts = {dropped: 0};   // counts: triggers per sound (tests)
  const now = () => ac.currentTime + .012;
  // o: {at, pan, d (m from the listener), g (gain), wet, jit (pitch jitter)}. Returns {t, out, p} or null (dropped).
  function voice(o, name, dur, {pri = 1, cd = 0} = {}) {
    const t = o.at ?? now();
    for (let i = live.length - 1; i >= 0; i--) if (live[i] < t) live.splice(i, 1);
    if (live.length >= MAXV + (pri - 1) * 6) { counts.dropped++; return null; }
    if (cd && lastT[name] !== undefined && t - lastT[name] < cd && t >= lastT[name]) return null;
    const rc = (recent[name] || []).filter(x => t - x < .35 && t >= x); rc.push(t); recent[name] = rc;
    lastT[name] = t; live.push(t + dur); counts[name] = (counts[name] || 0) + 1;
    const d = o.d || 0, g = (o.g ?? 1) * J(.1) / Math.sqrt(1 + (rc.length - 1) * .7) / (1 + d * .08);
    const v = ac.createGain(); v.gain.value = g;
    let n = v;
    if (d > 3) { const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(900, 16000 / (1 + (d - 3) * .25)); v.connect(lp); n = lp; }
    const pn = pan(sfx, o.pan); n.connect(pn);
    const send = ac.createGain(); send.gain.value = (o.wet ?? .35) + Math.min(.5, d * .03); n.connect(send); send.connect(revIn);
    return {t, out: v, p: J(o.jit ?? .06)};
  }
  // an un-capped sub-voice for ambient one-shots (birds, crackles), into a bed
  const sub = (dest, t, p, g = 1) => { const v = ac.createGain(); v.gain.value = g; v.connect(pan(dest, p)); return {t, out: v, p: 1}; };
  function env(p, t, a, peak, d, hold = 0) {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
    if (hold) p.setValueAtTime(peak, t + a + hold);
    p.exponentialRampToValueAtTime(.0001, t + a + hold + d);
  }
  function filt(n, t, o, p) {
    if (!o.type) return n;
    const f = ac.createBiquadFilter(); f.type = o.type; f.frequency.setValueAtTime(o.f * p, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2 * p, t + (o.sw ?? (o.a ?? .002) + (o.d ?? .1)));
    f.Q.value = o.q ?? .8; n.connect(f); return f;
  }
  // filtered noise burst. o: {b: buffer, type, f, f2, sw, q, a, d, hold, g, rate}
  function N(v, dt, o) {
    const t = v.t + dt, a = o.a ?? .002, d = o.d ?? .1, end = t + a + (o.hold || 0) + d;
    const s = ac.createBufferSource(); s.buffer = o.b || W; s.loop = true; if (o.rate) s.playbackRate.value = o.rate;
    const g = ac.createGain(); env(g.gain, t, a, o.g ?? .5, d, o.hold);
    filt(s, t, o, v.p).connect(g); g.connect(v.out);
    s.start(t, R() * (s.buffer.duration - .05)); s.stop(end + .03);
  }
  // oscillator. o: {w: type, f, f2, sw, a, d, hold, g, type/ff/q: a fixed filter after it}
  function O(v, dt, o) {
    const t = v.t + dt, a = o.a ?? .002, d = o.d ?? .1, end = t + a + (o.hold || 0) + d;
    const s = ac.createOscillator(); s.type = o.w || 'sine';
    s.frequency.setValueAtTime(o.f * v.p, t);
    if (o.f2) s.frequency.exponentialRampToValueAtTime(o.f2 * v.p, t + (o.sw ?? a + d));
    const g = ac.createGain(); env(g.gain, t, a, o.g ?? .3, d, o.hold);
    filt(s, t, {type: o.type, f: o.ff, q: o.q}, 1).connect(g); g.connect(v.out);
    s.start(t); s.stop(end + .03);
  }
  // a looping noise source through a filter into a gain (for beds / the creak); returns the nodes to modulate
  function loop(buf, dest, o, list) {
    const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; if (o.rate) s.playbackRate.value = o.rate;
    const g = ac.createGain(); g.gain.value = o.g ?? 0;
    let n = s, f = null;
    if (o.type) { f = ac.createBiquadFilter(); f.type = o.type; f.frequency.value = o.f; f.Q.value = o.q ?? .7; s.connect(f); n = f; }
    n.connect(g); g.connect(dest); s.start(o.at ?? ac.currentTime, R() * buf.duration * .9); list?.push(s);
    return {s, f, g};
  }
  function osc(dest, o, list) {
    const s = ac.createOscillator(); s.type = o.w || 'sine'; s.frequency.value = o.f;
    const g = ac.createGain(); g.gain.value = o.g ?? 0;
    let n = s, f = null;
    if (o.type) { f = ac.createBiquadFilter(); f.type = o.type; f.frequency.value = o.ff; f.Q.value = o.q ?? .7; s.connect(f); n = f; }
    n.connect(g); g.connect(dest); s.start(o.at ?? ac.currentTime); list?.push(s);
    return {s, f, g};
  }
  // a brief duck of the ambient beds under a big sound
  const lv = {amb: 1};   // the user's ambience level (settings); ducks return to it
  function duck(t, k = .5, rec = .8) { amb.gain.cancelScheduledValues(t); amb.gain.setTargetAtTime(k * lv.amb, t, .02); amb.gain.setTargetAtTime(lv.amb, t + .15, rec); }
  return {ac, W, PK, BR, out, sfx, amb, lv, revIn, revOut, voice, sub, N, O, loop, osc, env, duck, pan, live, counts};
}

// ======================================================================================================================
// SOUNDS. Each: (E, o) with o {at?, pan, d, g?, ...fields}. Levels are set so a step peaks ~0.1, a hit ~0.3, a break
// ~0.45, an explosion hits the compressor. Soft, woody, low: nothing above ~6 kHz carries much energy.
// ======================================================================================================================
const SURF = {ruins: 'ruins', ember: 'ember', frost: 'frost', rift: 'rift', desert: 'desert'};
const MAT = {dummy: 'straw', brute: 'straw', gunman: 'straw', crate: 'wood', barrel: 'wood', barrel_x: 'wood', pot: 'clay', crystal: 'glass', chest: 'wood'};   // (gunman: the desert's, a dull hit)

// the ground texture of one footfall (shared by steps, landings, scuffs); k = weight 0..1.5
function surface(E, v, dt, surf, k = .6) {
  const {N, O} = E;
  if (surf === 'ember') {       // gravel: a few dry grit clicks
    for (let i = 0; i < 3 + (k * 3 | 0); i++) N(v, dt + RR(0, .035 + k * .02), {type: 'bandpass', f: RR(1800, 4200), q: 2.5, d: RR(.006, .016), g: RR(.2, .4) * (.6 + k * .4)});
    N(v, dt, {type: 'lowpass', f: 900, d: .045, g: .28 * k + .1});
  } else if (surf === 'frost') {   // snow: a short granular crunch that swells and fades
    const n = 6 + (k * 5 | 0), span = .05 + k * .04;
    for (let i = 0; i < n; i++) N(v, dt + span * i / n + RR(0, .008), {type: 'bandpass', f: RR(1300, 3200), q: 1.4, d: RR(.008, .022), g: RR(.2, .38) * Math.sin(Math.PI * (i + .5) / n)});
    N(v, dt, {type: 'lowpass', f: 650, a: .005, d: .07, g: .22 * k + .08});
  } else if (surf === 'rift') {    // glassy: a dull tap and a faint crystalline ring
    N(v, dt, {type: 'bandpass', f: 2600, q: 2, d: .014, g: .22});
    O(v, dt + .002, {f: pick([1760, 2349, 2637, 3136]), a: .002, d: .09 + k * .05, g: .035 + .02 * k});
    N(v, dt, {type: 'lowpass', f: 700, d: .04, g: .2 * k + .06});
  } else if (surf === 'sand') {   // the desert's sand: a soft, muffled crunch, fine grains giving under the boot
    const n = 4 + (k * 4 | 0);
    for (let i = 0; i < n; i++) N(v, dt + RR(0, .03 + k * .03), {type: 'bandpass', f: RR(900, 2200), q: 1.1, d: RR(.012, .03), g: RR(.08, .16) * (.6 + k * .4)});
    N(v, dt, {type: 'lowpass', f: 520, a: .006, d: .06 + k * .02, g: .16 * k + .06});
  } else if (surf === 'pan') {     // hardpan: a dry, dull tap and a grit or two
    N(v, dt, {type: 'bandpass', f: RR(700, 1000), q: 1.3, d: .03, g: .3});
    for (let i = 0; i < 2; i++) N(v, dt + RR(0, .02), {type: 'bandpass', f: RR(2200, 3400), q: 2.5, d: .008, g: .08});
  } else if (surf === 'stone') {
    N(v, dt, {type: 'bandpass', f: 1500, q: 1.6, d: .025, g: .35});
    N(v, dt, {type: 'lowpass', f: 800, d: .04, g: .25 * k + .08});
  } else {                         // ruins: packed earth + flagstones, and grass brushing
    N(v, dt, {type: 'bandpass', f: RR(600, 1050), q: 1.2, d: .035 + k * .015, g: .38});
    if (R() < .6) N(v, dt + .006, {type: 'highpass', f: 3200, a: .008, d: .05, g: .08 + .05 * k});
  }
}

const SFX = {
  // ---------------- player ----------------
  step(E, o) {   // o.surf, o.k weight (walk .25 .. sprint 1, plant 1.3)
    const v = E.voice({...o, g: (o.g ?? 1) * .75}, 'step', .2, {cd: .06}); if (!v) return;
    const k = o.k ?? .6;
    E.O(v, 0, {f: 95, f2: 52, sw: .04, a: .002, d: .05 + k * .02, g: .2 + .12 * k});
    surface(E, v, 0, o.surf, k);
  },
  land(E, o) {   // o.big: 0 a leap landing, 1 a big drop
    const v = E.voice(o, 'land', .6, {pri: 2, cd: .1}); if (!v) return;
    const big = o.big ? 1 : 0;
    E.O(v, 0, {f: 85, f2: 38, sw: .1, a: .003, d: .14 + big * .1, g: .55 + big * .2});
    E.N(v, 0, {type: 'lowpass', f: 900, f2: 300, d: .12 + big * .1, g: .3 + big * .15});
    surface(E, v, 0, o.surf, 1.1 + big * .4); surface(E, v, .045, o.surf, .6);
    if (big) { E.N(v, .02, {b: E.BR, type: 'lowpass', f: 320, a: .01, d: .35, g: .4}); for (let i = 0; i < 4; i++) E.N(v, RR(.1, .35), {type: 'bandpass', f: RR(900, 2200), q: 3, d: .02, g: RR(.05, .12)}); }
  },
  jump(E, o) {
    const v = E.voice({...o, g: (o.g ?? 1) * 1.6}, 'jump', .4, {cd: .1}); if (!v) return;
    surface(E, v, 0, o.surf, .8);
    E.N(v, .01, {b: E.PK, type: 'bandpass', f: 480, f2: 1150, q: .9, a: .05, d: .17, g: .22});   // cloth
  },
  roll(E, o) {
    const v = E.voice(o, 'roll', .6, {cd: .15}); if (!v) return;
    E.N(v, 0, {b: E.PK, type: 'bandpass', f: 380, f2: 1250, sw: .16, q: 1, a: .07, d: .2, g: .3});
    E.N(v, .15, {b: E.PK, type: 'bandpass', f: 1200, f2: 420, sw: .25, q: 1, a: .04, d: .25, g: .2});
    E.O(v, .12, {f: 90, f2: 55, d: .08, g: .2});   // shoulder meets ground
    surface(E, v, .36, o.surf, .45);
  },
  climb(E, o) {  // one hand-hold / scrape; o.big = mantling over the lip
    const v = E.voice({...o, g: (o.g ?? 1) * 1.8}, 'climb', .3, {cd: .12}); if (!v) return;
    const k = o.big ? 1.4 : 1;
    E.N(v, 0, {type: 'bandpass', f: RR(900, 1600), f2: RR(500, 800), q: 1.5, a: .025, d: .12 * k, g: .22 * k});
    E.O(v, 0, {f: 110, f2: 70, d: .04, g: .18 * k});
    if (o.surf === 'frost' || o.surf === 'ember') surface(E, v, .02, o.surf, .4);
  },
  // ---------------- the bow ----------------
  shot(E, o) {   // o.kind 'arrow'|'multi'|'pierce'|'boom', o.k draw strength 0..1
    const v = E.voice(o, 'shot', .7, {pri: 2, cd: .03}); if (!v) return;
    const k = o.k ?? .7, heavy = o.kind === 'pierce' ? 1 : o.kind === 'multi' ? .5 : 0;
    E.N(v, 0, {type: 'bandpass', f: 3000, f2: 750, q: 1.3, a: .002, d: .07 + heavy * .04, g: .3 + k * .18});   // thwip
    const f = (116 - heavy * 20) * (1 + k * .08);
    E.O(v, .004, {w: 'triangle', f: f * 1.06, f2: f, sw: .04, a: .002, d: .3 + heavy * .1, g: .2 + k * .08, type: 'lowpass', ff: 1300});   // string
    E.O(v, .004, {f: f * 2.01, a: .002, d: .13, g: .06});
    E.O(v, 0, {f: 90, f2: 55, a: .002, d: .06, g: .22});   // limb
    if (o.kind === 'multi') for (const dt of [.011, .024, .037]) E.N(v, dt, {type: 'bandpass', f: RR(2400, 3200), f2: 850, q: 1.2, a: .002, d: .08, g: .2});
    if (o.kind === 'pierce') { E.N(v, 0, {type: 'bandpass', f: 4800, f2: 1100, q: 3, a: .004, d: .24, g: .16}); E.O(v, .01, {f: 1760, a: .002, d: .3, g: .025}); }
    if (o.kind === 'boom') for (let i = 0; i < 9; i++) E.N(v, .03 + RR(0, .38), {type: 'highpass', f: RR(2500, 5000), d: RR(.004, .012), g: RR(.05, .14)});   // lit fuse
  },
  volley(E, o) {  // arrow rain cast: a fan of shafts going up
    const v = E.voice({...o, g: (o.g ?? 1) * 1.7}, 'volley', .7, {pri: 2, cd: .2}); if (!v) return;
    E.N(v, 0, {b: E.PK, type: 'bandpass', f: 500, f2: 2600, sw: .35, q: 1.2, a: .12, d: .25, g: .3});
    E.O(v, 0, {w: 'triangle', f: 104, f2: 98, a: .002, d: .25, g: .16, type: 'lowpass', ff: 1200});
    for (const dt of [0, .02, .045]) E.N(v, dt, {type: 'bandpass', f: 2800, f2: 900, q: 1.2, a: .002, d: .07, g: .16});
  },
  whistle(E, o) {  // one rain arrow coming down
    const v = E.voice({...o, g: (o.g ?? 1) * 2.4, jit: .12}, 'whistle', .35, {cd: .045}); if (!v) return;
    E.N(v, 0, {type: 'bandpass', f: 2600, f2: 800, q: 4, a: .08, d: .14, g: .14});
    E.O(v, 0, {f: 1700, f2: 900, a: .08, d: .12, g: .012});
  },
  creakTick(E, o) {  // (tests only) the draw creak lives in createAudio: see Creak
    const v = E.voice(o, 'creakTick', .1); if (!v) return;
    E.O(v, 0, {w: 'sawtooth', f: 60, a: .01, d: .06, g: .08, type: 'bandpass', ff: 1100, q: 8});
  },
  // ---------------- the revolver (fallbacks for the forge's 'revolver' recipe while it bakes / ?forge=0) ----------------
  gunshot(E, o) {   // o.gun 'peacemaker' | 'brass_navy': crack + bark + thump + a dark, dry tail (nothing rings)
    const v = E.voice({...o, g: (o.g ?? 1) * 1.5}, 'gunshot', 1, {pri: 3, cd: .02}); if (!v) return;
    const navy = o.gun === 'brass_navy';
    E.N(v, 0, {type: 'highpass', f: navy ? 500 : 900, a: .0005, d: navy ? .012 : .008, g: .55});
    E.N(v, 0, {type: 'lowpass', f: navy ? 1800 : 3200, a: .001, d: navy ? .09 : .06, g: .6});
    E.O(v, 0, {f: navy ? 75 : 100, f2: navy ? 45 : 60, sw: .08, a: .002, d: navy ? .16 : .1, g: navy ? .6 : .4});
    E.N(v, .015, {b: E.BR, type: 'lowpass', f: 700, a: .02, d: navy ? .45 : .35, g: .25});
  },
  gunDry(E, o) {   // the hammer on an empty chamber
    const v = E.voice(o, 'gunDry', .15, {cd: .05}); if (!v) return;
    E.N(v, 0, {type: 'bandpass', f: 2200, q: 3, d: .004, g: .15}); E.N(v, .012, {type: 'bandpass', f: 2800, q: 3, d: .007, g: .4}); E.O(v, .012, {f: 800, a: .001, d: .02, g: .1});
  },
  gunDraw(E, o) {   // out of the leather, the hammer cocked
    const v = E.voice(o, 'gunDraw', .3, {cd: .1}); if (!v) return;
    E.N(v, 0, {b: E.PK, type: 'bandpass', f: 750, q: .9, a: .03, d: .05, g: .2});
    E.N(v, .11, {type: 'bandpass', f: 2400, q: 3, d: .006, g: .3}); E.N(v, .14, {type: 'bandpass', f: 2800, q: 3, d: .007, g: .4});
  },
  gunReload(E, o) {   // o.phase start | eject | round | done
    const v = E.voice(o, 'gunReload', .8, {cd: .03}); if (!v) return;
    if (o.phase === 'done') { for (let i = 0, t = 0; i < 9; i++, t += .04 + i * .007) E.N(v, t, {type: 'bandpass', f: 3000, q: 3, d: .004, g: .2 * (1 - i / 12)}); E.N(v, .62, {type: 'bandpass', f: 2000, q: 2, d: .009, g: .45}); }
    else if (o.phase === 'eject') { E.N(v, 0, {type: 'bandpass', f: 1700, q: 1.5, a: .01, d: .03, g: .2}); for (const t of [.18, .26, .37]) E.N(v, t, {type: 'bandpass', f: 3200, q: 2, d: .01, g: .15}); }
    else E.N(v, 0, {type: 'bandpass', f: o.phase === 'round' ? 1500 : 2600, q: 2.5, d: .008, g: .35});
  },
  // the desert's gunmen (features/foes): the revolver's sounds where they stand (the forge's foe* events while it bakes)
  foeShot(E, o) { SFX.gunshot(E, {...o, gun: o.gun === 'navy' ? 'brass_navy' : 'peacemaker', g: (o.g ?? 1) * .8}); },
  foeCock(E, o) { SFX.gunDraw(E, {...o, g: (o.g ?? 1) * .6}); },
  foeDraw(E, o) { SFX.gunHolster(E, {...o, g: (o.g ?? 1) * .5}); },
  foeReload(E, o) { SFX.gunReload(E, {...o, g: (o.g ?? 1) * .7}); },
  foeHolster(E, o) { SFX.gunHolster(E, {...o, g: (o.g ?? 1) * .5}); },
  foeFall(E, o) { SFX.land(E, {...o, big: 1, g: (o.g ?? 1) * .8}); },   // a body hits the ground
  gunHolster(E, o) {   // the twirl drops into leather
    const v = E.voice(o, 'gunHolster', .3, {cd: .15}); if (!v) return;
    E.N(v, 0, {b: E.PK, type: 'bandpass', f: 700, q: .8, a: .05, d: .06, g: .18}); E.N(v, .15, {b: E.PK, type: 'lowpass', f: 1100, a: .001, d: .015, g: .45});
  },
  // ---------------- impacts ----------------
  hit(E, o) {   // o.mat 'wood'|'straw'|'clay'|'glass'|'body'
    const v = E.voice({...o, g: (o.g ?? 1) * 1.2}, 'hit', .45, {pri: 2, cd: .025}); if (!v) return;
    const {N, O} = E;
    switch (o.mat) {
      case 'straw':
        O(v, 0, {f: 135, f2: 70, a: .002, d: .1, g: .45});
        N(v, 0, {type: 'lowpass', f: 1800, d: .11, g: .32}); N(v, .004, {type: 'bandpass', f: 3000, q: .8, a: .01, d: .07, g: .1});
        break;
      case 'clay':
        N(v, 0, {type: 'bandpass', f: 1900, q: 3, d: .03, g: .38}); O(v, 0, {f: 880, a: .001, d: .05, g: .08}); O(v, 0, {f: 150, f2: 95, d: .05, g: .22});
        break;
      case 'glass':
        O(v, 0, {f: 2300, a: .001, d: .35, g: .05}); O(v, 0, {f: 3460, a: .001, d: .22, g: .035});
        N(v, 0, {type: 'highpass', f: 4500, d: .02, g: .15}); O(v, 0, {f: 200, f2: 120, d: .05, g: .14});
        break;
      case 'body':   // the player gets stomped
        O(v, 0, {f: 95, f2: 48, a: .002, d: .16, g: .55}); N(v, 0, {type: 'lowpass', f: 520, d: .14, g: .4}); N(v, 0, {type: 'bandpass', f: 1200, q: 1, d: .05, g: .14});
        break;
      default:       // wood: a solid thunk with a hollow knock
        O(v, 0, {f: 175, f2: 85, a: .002, d: .09, g: .42}); N(v, 0, {type: 'bandpass', f: 900, q: 1.5, d: .05, g: .32});
        N(v, 0, {type: 'highpass', f: 3800, d: .01, g: .16}); O(v, .002, {w: 'triangle', f: 410, a: .001, d: .06, g: .07});
    }
  },
  stuck(E, o) {  // an arrow into the ground (o.surf biome) or a wall (o.surf 'stone')
    const v = E.voice(o, 'stuck', .25, {cd: .03}); if (!v) return;
    const {N, O} = E;
    if (o.surf === 'stone') { N(v, 0, {type: 'bandpass', f: 2500, q: 3, d: .025, g: .34}); O(v, 0, {f: 1150, a: .001, d: .04, g: .06}); O(v, 0, {f: 260, f2: 170, d: .04, g: .14}); return; }
    if (o.surf === 'frost') { N(v, 0, {type: 'bandpass', f: 1500, q: .8, a: .005, d: .08, g: .25}); O(v, 0, {f: 120, f2: 70, d: .04, g: .14}); return; }
    O(v, 0, {f: 150, f2: 70, a: .001, d: .05, g: .28}); N(v, 0, {type: 'lowpass', f: 700, d: .06, g: .26});
    if (o.surf === 'ember') for (let i = 0; i < 3; i++) N(v, RR(0, .03), {type: 'bandpass', f: RR(2500, 4000), q: 2, d: .008, g: RR(.1, .2)});
    else if (o.surf === 'rift') { O(v, .002, {f: 2600, a: .001, d: .12, g: .035}); O(v, .002, {f: 3900, a: .001, d: .08, g: .018}); }
    else N(v, 0, {type: 'bandpass', f: 1200, q: 1, d: .03, g: .12});
  },
  splash(E, o) {  // o.small (an arrow) / a body; o.surf: the stream is water (ruins / frost), lava (ember), a rift crack
    const small = !!o.small, v = E.voice({...o, g: (o.g ?? 1) * (small ? 1.6 : 1)}, small ? 'splashS' : 'splash', small ? .5 : 1.4, {pri: small ? 1 : 2, cd: small ? .05 : .2}); if (!v) return;
    const {N, O} = E;
    if (o.surf === 'ember') {
      if (small) { N(v, 0, {type: 'highpass', f: 2600, a: .01, d: .32, g: .12}); O(v, 0, {f: 110, f2: 70, d: .08, g: .16}); return; }
      N(v, 0, {type: 'highpass', f: 2000, a: .02, d: 1.1, g: .22}); O(v, 0, {f: 90, f2: 42, d: .35, g: .45}); N(v, 0, {b: E.BR, type: 'lowpass', f: 400, d: .5, g: .35});
      for (let i = 0; i < 5; i++) O(v, RR(.1, .7), {f: RR(90, 180), f2: RR(200, 320), sw: .06, a: .005, d: .08, g: .1});
      return;
    }
    if (o.surf === 'rift') {
      if (small) { O(v, 0, {f: 1200, f2: 300, sw: .2, d: .25, g: .05}); N(v, 0, {type: 'bandpass', f: 2000, f2: 400, q: 3, d: .25, g: .1}); return; }
      N(v, 0, {b: E.PK, type: 'bandpass', f: 300, f2: 2500, sw: .35, q: 2, a: .35, d: .15, g: .32}); O(v, .3, {f: 80, f2: 40, d: .5, g: .32}); O(v, .3, {f: 1760, a: .01, d: .6, g: .025});
      return;
    }
    if (small) { N(v, 0, {type: 'bandpass', f: 1700, f2: 3200, q: 1.2, a: .003, d: .09, g: .28}); O(v, .004, {f: 600, f2: 1500, sw: .05, d: .06, g: .08}); }
    else {
      N(v, 0, {type: 'lowpass', f: 3200, f2: 900, sw: .5, a: .01, d: .6, g: .45}); O(v, 0, {f: 150, f2: 55, d: .2, g: .35});
      N(v, .1, {b: E.PK, type: 'bandpass', f: 1200, q: .7, a: .05, d: .8, g: .14});
      for (let i = 0; i < 5; i++) { const f = RR(380, 900); O(v, RR(.1, .6), {f, f2: f * 1.8, sw: .04, a: .003, d: .05, g: .06}); }
    }
    if (o.surf === 'frost') O(v, .02, {f: 2800, a: .001, d: .15, g: .035});
  },
  // ---------------- physical props (events from arena/props3d.js) ----------------
  tip(E, o) {     // a barrel falls over: a hollow wooden boom, the staves knocking, a little settle rattle
    const v = E.voice({...o, g: (o.g ?? 1) * 1.1}, 'tip', 1, {pri: 2, cd: .15}); if (!v) return;
    E.O(v, 0, {f: 118, f2: 64, sw: .18, a: .003, d: .28, g: .42});
    E.N(v, 0, {type: 'bandpass', f: 210, q: 2.5, a: .003, d: .22, g: .5});
    E.N(v, 0, {type: 'bandpass', f: 1300, q: 1.2, a: .001, d: .03, g: .22});
    for (let i = 0; i < 3; i++) E.N(v, .07 + i * RR(.05, .09), {type: 'bandpass', f: RR(500, 1100), q: 2, a: .001, d: .03, g: .16 / (i + 1)});
    surface(E, v, .01, o.surf, 1.2);
  },
  kick(E, o) {    // a boot into a lying barrel / crate: a short dull thump with a wooden knock
    const v = E.voice(o, 'kick', .4, {pri: 1, cd: .12}); if (!v) return;
    E.O(v, 0, {f: 150, f2: 90, sw: .06, a: .002, d: .1, g: .35});
    E.N(v, 0, {type: 'bandpass', f: o.mat === 'clay' ? 1300 : 750, q: 1.6, a: .001, d: .04, g: .3});
  },
  scrape(E, o) {  // a crate dragged a little: stick-slip chatter over a grinding band (fires every ~0.35 s while it moves)
    const v = E.voice({...o, g: (o.g ?? 1) * 2.6}, 'scrape', .5, {pri: 1, cd: .2}); if (!v) return;
    const soft = o.surf === 'frost' || o.surf === 'ruins';
    E.N(v, 0, {b: E.PK, type: 'bandpass', f: soft ? 700 : 1100, q: .9, a: .04, d: .22, hold: .08, g: .16});
    const n = 6 + (R() * 6 | 0); for (let i = 0; i < n; i++) E.N(v, RR(0, .32), {type: 'bandpass', f: RR(900, 2400), q: 2.5, a: .001, d: .012, g: RR(.06, .14)});
  },
  propDrop(E, o) {   // a prop falling off the plateau: a heavy body impact plus the surface
    const v = E.voice({...o, g: (o.g ?? 1) * 1.2}, 'propDrop', .8, {pri: 2, cd: .1}); if (!v) return;
    E.O(v, 0, {f: 95, f2: 50, sw: .12, a: .002, d: .22, g: .5});
    E.N(v, 0, {type: 'bandpass', f: o.mat === 'clay' ? 1500 : 480, q: 1.4, a: .001, d: .08, g: .38});
    surface(E, v, .005, o.surf, 1.4);
  },
  // ---------------- wildlife (events from arena/wildlife.js) ----------------
  wings(E, o) {   // o.n birds taking off: soft feathery flaps (band-passed noise swells), a chirp or two when several go
    const n = o.n || 1, v = E.voice({...o, g: (o.g ?? 1) * (1.1 + .12 * Math.min(n, 5)), wet: .45}, 'wings', 1.2, {pri: 1, cd: .12}); if (!v) return;
    for (let b = 0; b < n; b++) {
      const t0 = RR(0, .08 * n), flaps = 3 + (R() * 4 | 0), per = RR(.065, .1), f = RR(420, 900);
      for (let k = 0; k < flaps; k++) E.N(v, t0 + k * per * J(.12), {b: E.PK, type: 'bandpass', f: f * (1 - k * .04), q: .9, a: .012, d: .04 + k * .004, g: RR(.18, .3) * (1 - k * .08)});
    }
    if (n >= 3 && o.surf !== 'rift') for (let i = 0; i < 2; i++) { const f0 = RR(2800, 4000); E.O(v, RR(.05, .3), {f: f0, f2: f0 * RR(.75, 1.25), a: .004, d: .05, g: .03}); }
  },
  hawk(E, o) {    // the desert's red-tailed hawk (wildlife.js's 'caw'): a hoarse scream falling away
    const v = E.voice({...o, wet: .55}, 'hawk', 2, {pri: 1, cd: 1.5}); if (!v) return;
    const f = RR(2900, 3300);
    E.O(v, 0, {w: 'sawtooth', f, f2: f * .52, sw: 1.4, a: .1, hold: .2, d: 1.1, g: .05, type: 'lowpass', ff: 2600, q: 1.2});
    E.N(v, 0, {type: 'bandpass', f: f * .9, f2: f * .5, sw: 1.4, q: 4, a: .08, hold: .2, d: 1, g: .08});
  },
  caw(E, o) {     // a crow: two harsh nasal calls (a buzzy sawtooth through a vocal formant, plus rasp)
    const v = E.voice({...o, wet: .5}, 'caw', 1, {pri: 1, cd: .8}); if (!v) return;
    const calls = 1 + (R() < .7 ? 1 : 0) + (R() < .25 ? 1 : 0);
    for (let i = 0; i < calls; i++) {
      const t = i * RR(.28, .38), f = RR(520, 640);
      E.O(v, t, {w: 'sawtooth', f, f2: f * .82, sw: .22, a: .02, d: .2, g: .11, type: 'bandpass', ff: 1250, q: 2.2});
      E.N(v, t, {type: 'bandpass', f: 1600, q: 1.5, a: .02, d: .18, g: .09});
    }
  },
  plop(E, o) {    // a fish or a frog breaking the water surface (a frog adds a short throaty croak)
    const v = E.voice({...o, g: (o.g ?? 1) * .8}, 'plop', .6, {pri: 1, cd: .15}); if (!v) return;
    if (o.surf === 'ember' || o.surf === 'rift') { E.N(v, 0, {type: 'highpass', f: 2400, a: .005, d: .12, g: .08}); return; }
    const f = RR(500, 900); E.O(v, .005, {f, f2: f * 2.1, sw: .05, a: .002, d: .06, g: .16});   // the bubble: a rising "plip"
    E.N(v, 0, {type: 'bandpass', f: 1800, f2: 3500, q: 1.1, a: .002, d: .05, g: .14});
    for (let i = 0; i < 3; i++) { const g = RR(700, 1400); E.O(v, RR(.12, .3), {f: g, f2: g * 1.6, sw: .03, a: .002, d: .03, g: .04}); }   // drops
    if (o.frog) for (let i = 0; i < 6; i++) E.N(v, .08 + i * .026, {type: 'bandpass', f: 520, q: 4, a: .003, d: .018, g: .12});      // croak pulses
  },
  rustle(E, o) {  // a small animal dashing through grass / scrub
    const v = E.voice(o, 'rustle', .6, {pri: 1, cd: .2}); if (!v) return;
    const n = 5 + (R() * 5 | 0);
    for (let i = 0; i < n; i++) E.N(v, i * RR(.025, .05), {type: o.surf === 'frost' ? 'bandpass' : 'highpass', f: o.surf === 'frost' ? 2200 : RR(2600, 4200), q: 1.2, a: .004, d: RR(.015, .04), g: RR(.08, .16) * (1 - i / n * .6)});
  },
  // ---------------- breakables ----------------
  brk(E, o) {   // o.kind
    const v = E.voice({...o, g: (o.g ?? 1) * ({pot: 1.1, brute: 1, dummy: 1}[o.kind] ?? 1.4)}, 'brk', 1, {pri: 3, cd: .03}); if (!v) return;
    const {N, O} = E, kind = o.kind;
    if (kind === 'pot') {   // clay: a click, the body's thud, a spray of shards tinkling down
      N(v, 0, {type: 'highpass', f: 5000, d: .006, g: .3}); O(v, 0, {f: 230, f2: 120, d: .07, g: .3});
      N(v, 0, {type: 'bandpass', f: 3000, q: 1, d: .08, g: .24});
      for (let i = 0; i < 11; i++) O(v, RR(0, .26), {f: RR(1500, 4200), a: .001, d: RR(.04, .14), g: RR(.025, .07)});
      for (let i = 0; i < 3; i++) N(v, RR(.2, .45), {type: 'bandpass', f: RR(2000, 3500), q: 3, d: .015, g: .07});
    } else if (kind === 'crystal') {
      N(v, 0, {type: 'highpass', f: 4000, d: .15, g: .18}); O(v, 0, {f: 700, f2: 500, d: .3, g: .06});
      for (let i = 0; i < 14; i++) O(v, RR(0, .3), {f: RR(2000, 6000), a: .001, d: RR(.1, .5), g: RR(.015, .04)});
    } else if (kind === 'brute' || kind === 'dummy') {   // stuffed sack bursting
      N(v, 0, {type: 'lowpass', f: 1500, a: .005, d: .35, g: .45}); O(v, 0, {f: 100, f2: 45, d: .25, g: .5});
      N(v, .02, {type: 'bandpass', f: 2500, q: .7, a: .02, d: .25, g: .14});
      for (let i = 0; i < 3; i++) O(v, RR(.2, .5), {f: 160, f2: 90, d: .05, g: RR(.08, .15)});
    } else if (kind === 'barrel' || kind === 'barrel_x') {   // staves crack, the hoop body booms hollow, staves clatter
      N(v, 0, {type: 'bandpass', f: 800, q: 1.6, a: .001, d: .05, g: .5}); N(v, 0, {type: 'highpass', f: 3000, d: .015, g: .25});
      O(v, 0, {w: 'triangle', f: 92, a: .002, d: .35, g: .28, type: 'lowpass', ff: 600}); O(v, 0, {f: 160, d: .2, g: .12});
      for (let i = 0; i < 5; i++) N(v, RR(0, .12), {type: 'bandpass', f: RR(900, 2400), q: 2.5, a: .001, d: RR(.015, .035), g: RR(.15, .3)});
      for (let i = 0; i < 4; i++) { const dt = RR(.15, .6); O(v, dt, {f: 200, f2: 120, d: .05, g: RR(.07, .15)}); N(v, dt, {type: 'bandpass', f: 1100, q: 2, d: .03, g: .08}); }
    } else {   // crate: splinters crunching, a dull body thud, debris settling
      for (let i = 0; i < 8; i++) N(v, RR(0, .15), {type: 'bandpass', f: RR(1400, 3600), q: 2.5, a: .001, d: RR(.015, .04), g: RR(.18, .36)});
      O(v, 0, {f: 120, f2: 55, d: .14, g: .45}); N(v, 0, {type: 'lowpass', f: 900, a: .005, d: .3, g: .22});
      for (let i = 0; i < 3; i++) N(v, RR(.18, .45), {type: 'bandpass', f: RR(700, 1500), q: 3, d: .03, g: .1});
    }
  },
  explode(E, o) {  // o.r blast radius (m): low boom, noise burst, rumble and a debris tail
    const v = E.voice({...o, wet: .5}, 'explode', 2.4, {pri: 3, cd: .05}); if (!v) return;
    const {N, O} = E, s = clamp((o.r || 2.2) / 2.2, .7, 1.4);
    E.duck(v.t, .35, .9);
    N(v, 0, {type: 'lowpass', f: 7000, d: .035, g: .6});                                    // crack
    O(v, 0, {f: 78 / s, f2: 28, sw: .6, a: .004, d: .85, g: .75});                              // boom
    O(v, 0, {f: 46, f2: 26, a: .01, d: 1.2, g: .35});                                          // sub
    N(v, 0, {b: E.PK, type: 'lowpass', f: 2600, f2: 240, sw: .5, q: .7, a: .004, d: .7, g: .75});  // blast body
    N(v, .05, {b: E.BR, type: 'lowpass', f: 180, a: .1, d: 1.5, g: .5});                       // rumble
    for (let i = 0; i < 12; i++) { const dt = RR(.22, 1.4); N(v, dt, {type: 'bandpass', f: RR(500, 2600), q: 2.5, d: RR(.02, .05), g: RR(.05, .17) * (1 - dt / 1.7)}); if (R() < .35) O(v, dt, {f: 180, f2: 100, d: .04, g: .08}); }
    for (let i = 0; i < 8; i++) N(v, RR(.1, .8), {type: 'highpass', f: 3000, d: .005, g: RR(.04, .1)});   // crackle
  },
  // ---------------- loot / world ----------------
  loot(E, o) {   // coins spilling out: metallic pings, pentatonic
    const v = E.voice({...o, g: (o.g ?? 1) * 1.8, jit: .01}, 'loot', .9, {pri: 2, cd: .08}); if (!v) return;
    const notes = [1568, 1760, 2093, 2349, 2637, 3136], n = clamp(2 + (o.n || 2), 3, 6);
    E.N(v, 0, {type: 'highpass', f: 6000, d: .01, g: .06});
    for (let i = 0; i < n; i++) { const f = pick(notes), dt = i * .05 + RR(0, .02); E.O(v, dt, {f, a: .002, d: .3, g: .05}); E.O(v, dt, {f: f * 2.76, a: .001, d: .1, g: .018}); }
  },
  coin(E, o) {
    const v = E.voice({...o, g: (o.g ?? 1) * 2, jit: .01}, 'coin', .4, {cd: .06}); if (!v) return;
    for (const [dt, f] of [[0, 2637], [.06, 3520]]) { E.O(v, dt, {f, a: .002, d: .22, g: .05}); E.O(v, dt, {f: f * 2.76, a: .001, d: .08, g: .015}); }
  },
  open(E, o) {   // chest: latch clunk, a hinge creak, a small sparkle
    const v = E.voice(o, 'open', 1.2, {pri: 2, cd: .3}); if (!v) return;
    E.N(v, 0, {type: 'bandpass', f: 1800, q: 3, d: .02, g: .28}); E.O(v, 0, {f: 180, f2: 110, d: .06, g: .25});
    E.O(v, .06, {w: 'sawtooth', f: 58, f2: 36, sw: .45, a: .05, hold: .15, d: .3, g: .05, type: 'bandpass', ff: 750, q: 5});
    [1318, 1568, 1976, 2637].forEach((f, i) => E.O(v, .38 + i * .07, {f, a: .003, d: .4, g: .04}));
  },
  trap(E, o) {   // iron jaws snapping, spikes, dirt
    const v = E.voice(o, 'trap', .8, {pri: 3, cd: .1}); if (!v) return;
    E.N(v, 0, {type: 'bandpass', f: 2600, q: 6, d: .1, g: .3});
    for (const [f, d, g] of [[523, .3, .05], [1337, .22, .04], [2210, .15, .03]]) E.O(v, 0, {f, a: .001, d, g});
    E.O(v, 0, {f: 180, f2: 90, d: .08, g: .3}); E.N(v, .01, {type: 'highpass', f: 2500, a: .002, d: .18, g: .16});
    E.N(v, 0, {type: 'lowpass', f: 700, d: .25, g: .22});
  },
  trapSet(E, o) {  // laying the trap + vaulting back
    const v = E.voice({...o, g: (o.g ?? 1) * 2.5}, 'trapSet', .5, {cd: .2}); if (!v) return;
    E.O(v, 0, {f: 1900, a: .001, d: .08, g: .03}); E.O(v, 0, {f: 2870, a: .001, d: .06, g: .02});
    E.N(v, 0, {type: 'bandpass', f: 3000, q: 4, d: .02, g: .14}); E.N(v, 0, {type: 'lowpass', f: 900, d: .12, g: .12});
    E.N(v, .03, {b: E.PK, type: 'bandpass', f: 420, f2: 1100, q: .8, a: .06, d: .2, g: .2});
  },
  respawn(E, o) {  // a soft poof
    const v = E.voice(o, 'respawn', .6, {cd: .2}); if (!v) return;
    E.N(v, 0, {b: E.PK, type: 'lowpass', f: 300, f2: 1600, sw: .3, a: .12, d: .25, g: .3});
    E.O(v, 0, {f: 220, f2: 440, sw: .4, a: .1, d: .3, g: .04}); E.O(v, 0, {f: 330, f2: 660, sw: .4, a: .1, d: .3, g: .025});
  },
  stomp(E, o) {   // a sparring brute landing a hop
    const v = E.voice(o, 'stomp', .3, {cd: .08}); if (!v) return;
    E.O(v, 0, {f: 85, f2: 45, d: .14, g: .42}); E.N(v, 0, {type: 'lowpass', f: 600, d: .12, g: .28});
    surface(E, v, 0, o.surf, .7);
  },
};

// ======================================================================================================================
// AMBIENT BEDS: one per biome, crossfaded. Each owns its stream loop (water / lava / a humming crack).
// env = {prox 0..1 (closeness to the stream), sPan, time 'day'|'dusk'|'night'}
// ======================================================================================================================
function makeBed(E, id, t0) {
  const {ac} = E, out = ac.createGain(), srcs = [];
  out.gain.setValueAtTime(0, t0); out.gain.setTargetAtTime(1, t0, .6); out.connect(E.amb);
  // stream: sg -> lowpass -> panner -> out
  const sg = ac.createGain(); sg.gain.value = 0; const slp = ac.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 800;
  const sp = ac.createStereoPanner ? ac.createStereoPanner() : null;
  sg.connect(slp); if (sp) { slp.connect(sp); sp.connect(out); } else slp.connect(out);
  const st = {gust: .5, gT: .5, gNext: 0, last: t0, next: {}, lfo: R() * 10};
  const L = (buf, dest, o) => E.loop(buf, dest, {...o, at: t0}, srcs), Osc = (dest, o) => E.osc(dest, {...o, at: t0}, srcs);
  const due = (k, t, lo, hi) => { if (st.next[k] === undefined) st.next[k] = t + RR(lo, hi) * .5; if (t < st.next[k]) return false; st.next[k] = t + RR(lo, hi); return true; };
  const set = (p, v, t, tc = .15) => p.setTargetAtTime(v, t, tc);
  let tick = () => {};
  if (id === 'ruins') {
    const wind = L(E.PK, out, {type: 'bandpass', f: 420, q: .6}), leaves = L(E.W, out, {type: 'highpass', f: 3200});
    const water = L(E.PK, sg, {type: 'bandpass', f: 1000, q: .5, g: .5}), spark = L(E.W, sg, {type: 'bandpass', f: 3600, q: 1.5, g: .1});
    tick = (env, t) => {
      const night = env.time === 'night', dusk = env.time === 'dusk';
      set(wind.f.frequency, 280 + 380 * st.gust, t, .4); set(wind.g.gain, (.045 + .075 * st.gust) * (night ? .7 : 1), t, .4);
      set(leaves.g.gain, .006 * st.gust * st.gust, t, .4);
      if (!night && due('bird', t, dusk ? 5 : 1.4, dusk ? 12 : 5)) {   // a small songbird: 2-5 quick sweeps
        const v = E.sub(out, t + .05, RR(-.7, .7), RR(.4, 1)), f0 = RR(2600, 4000), n = 2 + (R() * 4 | 0), up = R() < .5;
        for (let i = 0; i < n; i++) E.O(v, i * RR(.07, .11), {f: f0 * J(.08), f2: f0 * (up ? 1.3 : .75) * J(.1), a: .006, d: .06, g: .022});
      }
      if (night || dusk) for (const [k, f, p] of [['cr1', 4420, -.5], ['cr2', 4710, .55]]) if (due(k, t, .6, 1.2)) {   // crickets
        const v = E.sub(out, t + .05, p, night ? 1 : .4);
        for (let i = 0; i < 3; i++) E.O(v, i * .048, {f, a: .004, d: .026, g: .01});
      }
      if (night && due('owl', t, 12, 26)) {
        const v = E.sub(out, t + .05, RR(-.8, .8), .8);
        [[0, .3], [.55, .16], [.78, .34]].forEach(([dt, d]) => E.O(v, dt, {f: 392, f2: 360, sw: d, a: .05, d, g: .02, type: 'lowpass', ff: 900}));
      }
      set(sg.gain, .018 + .075 * env.prox, t, .3); set(slp.frequency, 500 + 5500 * env.prox * env.prox, t, .3);
      set(water.f.frequency, 800 + 500 * Math.sin(st.lfo * .7), t, .5);
      if (env.prox > .05 && due('plip', t, .06 / env.prox, .3 / env.prox)) { const v = E.sub(sg, t + .03, RR(-.3, .3)), f = RR(500, 1300); E.O(v, 0, {f, f2: f * 1.6, sw: .03, a: .003, d: .04, g: .08}); }
    };
  } else if (id === 'ember') {
    const rumble = L(E.BR, out, {type: 'lowpass', f: 120, g: .035}), roar = L(E.PK, out, {type: 'bandpass', f: 650, q: .5, g: .02});
    const hum = Osc(out, {f: 36, g: .012});
    const lava = L(E.BR, sg, {type: 'lowpass', f: 300, g: .3}), hiss = L(E.W, sg, {type: 'highpass', f: 5000, g: .025});
    tick = (env, t) => {
      set(hum.g.gain, .008 + .008 * Math.sin(st.lfo * .35), t, .5); set(roar.g.gain, .012 + .02 * st.gust, t, .5);
      if (due('crk', t, .05, .3)) {   // crackles, sometimes in little clusters
        const v = E.sub(out, t + .03, RR(-.8, .8)), n = R() < .25 ? 3 + (R() * 4 | 0) : 1;
        for (let i = 0; i < n; i++) E.N(v, RR(0, .12), {type: 'highpass', f: RR(1500, 4000), d: RR(.003, .01), g: RR(.008, .03)});
      }
      if (due('belch', t, 7, 16)) { const v = E.sub(out, t + .05, RR(-.6, .6)); E.O(v, 0, {f: 70, f2: 38, a: .05, d: .5, g: .06}); E.N(v, 0, {b: E.BR, type: 'lowpass', f: 300, a: .1, d: .5, g: .08}); }
      set(sg.gain, .015 + .08 * env.prox, t, .3); set(slp.frequency, 400 + 3500 * env.prox * env.prox, t, .3);
      if (env.prox > .05 && due('blorp', t, .15 / env.prox, .6 / env.prox)) { const v = E.sub(sg, t + .03, RR(-.3, .3)), f = RR(70, 140); E.O(v, 0, {f, f2: f * 1.9, sw: .07, a: .01, d: .1, g: .35}); }
    };
  } else if (id === 'frost') {
    const wind = L(E.PK, out, {type: 'bandpass', f: 500, q: .5}), whistle = L(E.PK, out, {type: 'bandpass', f: 1100, q: 8}), whistle2 = L(E.PK, out, {type: 'bandpass', f: 1650, q: 11});
    const water = L(E.PK, sg, {type: 'bandpass', f: 900, q: .6, g: .4});
    tick = (env, t) => {
      const k = env.time === 'night' ? 1.25 : env.time === 'dusk' ? 1.1 : 1, g = st.gust;
      set(wind.g.gain, (.04 + .07 * g) * k, t, .4); set(wind.f.frequency, 380 + 300 * g, t, .4);
      set(whistle.f.frequency, 800 + 700 * g + 60 * Math.sin(st.lfo * 1.3), t, .3); set(whistle.g.gain, (.02 + .09 * g * g) * k, t, .35);
      set(whistle2.f.frequency, 1300 + 900 * g, t, .3); set(whistle2.g.gain, .05 * g * g * k, t, .35);
      if (due('tink', t, 9, 20)) { const v = E.sub(out, t + .05, RR(-.8, .8)); for (let i = 0; i < 3; i++) E.O(v, i * RR(.08, .2), {f: RR(3000, 5000), a: .001, d: .3, g: .01}); }
      set(sg.gain, .012 + .05 * env.prox, t, .3); set(slp.frequency, 400 + 2600 * env.prox * env.prox, t, .3);
      if (env.prox > .1 && due('plip', t, .12 / env.prox, .5 / env.prox)) { const v = E.sub(sg, t + .03, RR(-.3, .3)), f = RR(700, 1500); E.O(v, 0, {f, f2: f * 1.5, sw: .03, a: .003, d: .04, g: .07}); }
    };
  } else if (id === 'desert') {   // dry wind over sand (a low body, sand hissing in the gusts), insects by day, crickets at night, the creek
    const wind = L(E.PK, out, {type: 'bandpass', f: 360, q: .55}), hiss = L(E.W, out, {type: 'bandpass', f: 1700, q: .8}), hum = L(E.PK, out, {type: 'bandpass', f: 190, q: 2});
    const water = L(E.PK, sg, {type: 'bandpass', f: 900, q: .5, g: .45});
    tick = (env, t) => {
      const night = env.time === 'night', dusk = env.time === 'dusk', g = st.gust;
      set(wind.f.frequency, 240 + 420 * g, t, .4); set(wind.g.gain, (.042 + .07 * g) * (night ? .7 : 1), t, .4);   // (level with the ruins' bed)
      set(hiss.g.gain, .002 + .008 * g * g, t, .4);   // (dark: the user's taste, nothing hissy)
      set(hum.g.gain, night ? 0 : dusk ? .004 : .008, t, 1);
      if (night || dusk) for (const [k, f, p] of [['cr1', 4180, -.5], ['cr2', 4460, .55]]) if (due(k, t, .7, 1.4)) {   // crickets
        const v = E.sub(out, t + .05, p, night ? .9 : .35);
        for (let i = 0; i < 3; i++) E.O(v, i * .05, {f, a: .004, d: .026, g: .009});
      }
      set(sg.gain, .016 + .07 * env.prox, t, .3); set(slp.frequency, 450 + 5000 * env.prox * env.prox, t, .3);
      set(water.f.frequency, 760 + 420 * Math.sin(st.lfo * .7), t, .5);
      if (env.prox > .05 && due('plip', t, .07 / env.prox, .32 / env.prox)) { const v = E.sub(sg, t + .03, RR(-.3, .3)), f = RR(450, 1100); E.O(v, 0, {f, f2: f * 1.5, sw: .03, a: .003, d: .04, g: .07}); }
    };
  } else {   // rift
    const drones = [55, 82.7, 110.4].map((f, i) => Osc(out, {f, g: [.009, .006, .0035][i]}));
    const saw = Osc(out, {w: 'sawtooth', f: 55.3, g: .006, type: 'lowpass', ff: 260, q: 2});
    const shim = [1760, 2217, 2793].map(f => Osc(out, {f, g: 0}));
    const hum = [220, 221.6].map(f => Osc(sg, {f, g: .08})), whisper = L(E.W, sg, {type: 'bandpass', f: 2600, q: 3, g: .08});
    tick = (env, t) => {
      set(saw.f.frequency, 200 + 160 * (.5 + .5 * Math.sin(st.lfo * .4)), t, .5);
      shim.forEach((s, i) => set(s.g.gain, .0035 * (.5 + .5 * Math.sin(st.lfo * (.6 + i * .23) + i * 2)), t, .4));
      if (due('whisper', t, 5, 11)) { const v = E.sub(out, t + .05, RR(-.8, .8)); E.N(v, 0, {b: E.PK, type: 'bandpass', f: RR(900, 2000), f2: RR(700, 2400), sw: 2, q: 4, a: 1, d: 1.2, g: .06}); }
      set(sg.gain, .01 + .06 * env.prox, t, .3); set(slp.frequency, 500 + 4000 * env.prox * env.prox, t, .3);
      if (env.prox > .2 && due('suck', t, 2 / env.prox, 5 / env.prox)) { const v = E.sub(sg, t + .03, 0); E.O(v, 0, {f: 1200, f2: 300, sw: .4, a: .05, d: .35, g: .08}); }
    };
  }
  return {
    out,
    update(env, t) {
      const dt = clamp(t - st.last, 0, .5); st.last = t; st.lfo += dt;
      if (typeof env.gust === 'number') st.gT = clamp(env.gust, 0, 1);          // the arena's wind (wind.js): hear what you see
      else if (t > st.gNext) { st.gT = R() ** 1.3; st.gNext = t + RR(2, 6); }   // no wind module: gusts are a slow random walk
      st.gust += (st.gT - st.gust) * Math.min(1, dt * .6);
      if (sp) sp.pan.setTargetAtTime(clamp(env.sPan, -.8, .8), t, .2);
      tick(env, t);
    },
    stop(t) { out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.setTargetAtTime(0, t, .6); for (const s of srcs) try { s.stop(t + 4); } catch (e) {} setTimeout?.(() => { try { out.disconnect(); } catch (e) {} }, 4500); },
  };
}

// a rolling barrel: low rumble + stave clacks whose rate follows its speed (one continuous voice, the fastest barrel)
function makeRoll(E) {
  const {ac} = E, t = ac.currentTime, out = ac.createGain(); out.gain.value = 0;
  const pn = ac.createStereoPanner ? ac.createStereoPanner() : null; if (pn) { out.connect(pn); pn.connect(E.sfx); } else out.connect(E.sfx);
  const send = ac.createGain(); send.gain.value = .25; out.connect(send); send.connect(E.revIn);
  const srcs = [], rum = E.loop(E.BR, out, {type: 'lowpass', f: 220, g: .5, at: t}, srcs), grit = E.loop(E.PK, out, {type: 'bandpass', f: 900, q: .8, g: .06, at: t}, srcs);
  let clack = 0;
  return {
    set(speed, pan, d, t, dt) {
      const k = Math.min(1, speed / 4), g = k * .55 / (1 + d * .08);
      out.gain.setTargetAtTime(g, t, .06); if (pn) pn.pan.setTargetAtTime(clamp(pan, -.8, .8), t, .05);
      rum.f.frequency.setTargetAtTime(140 + 260 * k, t, .1); grit.f.frequency.setTargetAtTime(700 + 900 * k, t, .1);
      clack -= dt * speed * 2.2;   // ~2 stave knocks per metre travelled
      if (clack <= 0 && speed > .3) { clack = RR(.8, 1.2); const v = E.sub(out, t + .01, 0, 1); E.N(v, 0, {type: 'bandpass', f: RR(500, 900), q: 2, a: .001, d: .035, g: .5}); }
    },
    stop(t) { out.gain.setTargetAtTime(0, t, .08); for (const s of srcs) try { s.stop(t + .5); } catch (e) {} },
  };
}

// the bow's creak / string stretch while drawing (one continuous voice, modulated per frame)
function makeCreak(E) {
  const {ac} = E, t = ac.currentTime, out = ac.createGain(); out.gain.value = 1;
  const pn = E.pan(E.sfx, 0); out.connect(pn); const send = ac.createGain(); send.gain.value = .2; out.connect(send); send.connect(E.revIn);
  const srcs = [], saw = E.osc(out, {w: 'sawtooth', f: 38, g: 0, type: 'bandpass', ff: 900, q: 9, at: t}, srcs);
  const str = E.loop(E.PK, out, {type: 'bandpass', f: 2200, q: 1.6, g: 0, at: t}, srcs);
  let burst = 0;
  return {
    set(k, rate, t, dt) {   // k: draw 0..1, rate: dk/dt
      const rising = rate > .05;
      if (!rising && R() < dt * 1.1) burst = RR(.06, .12);   // held at full draw: the odd creak
      burst = Math.max(0, burst - dt);
      const g = rising ? .2 + .14 * k : burst > 0 ? .16 : .018;
      saw.g.gain.setTargetAtTime(g * J(.35), t, .02);
      saw.s.frequency.setTargetAtTime((30 + 55 * k) * J(.12), t, .03);
      saw.f.frequency.setTargetAtTime(700 + 900 * k, t, .05);
      str.g.gain.setTargetAtTime(rising ? .03 + .07 * k : .012, t, .05);
      str.f.frequency.setTargetAtTime(1600 + 1400 * k, t, .08);
    },
    stop(t) { out.gain.setTargetAtTime(0, t, .025); for (const s of srcs) try { s.stop(t + .2); } catch (e) {} },
  };
}

// the desert's far calls (no forge bank for them): a hawk's cry by day, a cicada swelling in the heat, coyotes at dusk and
// night (yips, a howl, one answering further off). Each far off (quiet, low-passed), panned wide, on its own timer (st)
function desertCalls(E, st, time, t) {
  const due = (k, lo, hi) => { if (st[k] === undefined) st[k] = t + RR(lo, hi) * .4; if (t < st[k]) return false; st[k] = t + RR(lo, hi); return true; };
  const side = () => (R() < .5 ? -1 : 1) * RR(.45, .8);
  if (time === 'day' && due('hawk', 28, 70)) {
    const v = E.sub(E.amb, t + .05, side(), RR(.6, 1));
    for (let i = 0, n = R() < .35 ? 2 : 1; i < n; i++) {
      const dt = i * RR(1.6, 2.2), f = RR(2900, 3300);
      E.O(v, dt, {w: 'sawtooth', f, f2: f * .52, sw: 1.5, a: .12, hold: .25, d: 1.2, g: .012, type: 'lowpass', ff: 2300, q: 1.2});
      E.N(v, dt, {type: 'bandpass', f: f * .9, f2: f * .5, sw: 1.5, q: 4, a: .1, hold: .25, d: 1.1, g: .02});
    }
  }
  if (time === 'day' && due('cicada', 16, 40)) {
    const v = E.sub(E.amb, t + .05, side(), RR(.5, 1)), hold = RR(2, 5), f = RR(3100, 3700);   // (soft and far: a swell under the wind, not a whine)
    E.N(v, 0, {b: E.PK, type: 'bandpass', f, q: 5, a: RR(1, 1.8), hold, d: RR(1.5, 2.5), g: .007});
    E.N(v, 0, {b: E.PK, type: 'bandpass', f: f * 1.5, q: 6, a: 1.6, hold, d: 2, g: .002});
  }
  if (time !== 'day' && due('coyote', time === 'night' ? 30 : 60, time === 'night' ? 75 : 140)) {
    for (const [dt, far] of [[0, 1], [RR(2.5, 4), .45]]) {
      const v = E.sub(E.amb, t + .05 + dt, side(), far), n = 2 + (R() * 4 | 0);
      for (let i = 0; i < n; i++) { const f = RR(620, 820); E.O(v, i * RR(.12, .18), {w: 'triangle', f, f2: f * 1.35, sw: .08, a: .01, d: .1, g: .012, type: 'lowpass', ff: 1600}); }
      const h0 = n * .16 + .15, f = RR(480, 560);
      E.O(v, h0, {w: 'triangle', f, f2: f * 1.55, sw: .45, a: .2, hold: .5, d: .2, g: .014, type: 'lowpass', ff: 1500});
      E.O(v, h0 + .85, {w: 'triangle', f: f * 1.55, f2: f * 1.05, sw: .8, a: .02, d: .9, g: .012, type: 'lowpass', ff: 1400});
    }
  }
}

// ======================================================================================================================
// CONTROLLER
// ======================================================================================================================
export function createAudio(ctx, host = {}) {
  const get = v => typeof v === 'function' ? v() : v;
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  const q = flags;
  const disabled = !AC || !!q.get('sheet') || q.get('audio') === '0';
  let E = null, muted = false, bed = null, bedId = null, bedMuted = false, creak = null, roll = null, prevState = 'idle', prevK = 0, climbT = 0, musicOn = true;
  let nZones = 0, nTraps = 0, canyonOn = false, revBiome = null;
  const callSt = {};   // desertCalls' timers
  // the desert's ground under a foot (DESERT_STEP: the synth's surface + the forge's footstep case), else o as it is
  const grounded = (biome, x, y, o) => { if (biome !== 'desert') return o; const g = DESERT_STEP[ctx.ground?.(x, y)]; if (g) Object.assign(o, g); return o; };
  // settings (pause menu > Sound): slider values 0..1, mapped to gain as v² (perceptually even steps)
  const VOL = {master: 1, music: 1, sfx: 1, amb: 1}, MODES = {adaptive: null, explore: .3, combat: .85};
  let musicMode = 'adaptive';
  try {
    muted = localStorage.getItem('pg.audio.muted') === '1'; musicOn = localStorage.getItem('pg.audio.music') !== '0';
    const v = JSON.parse(localStorage.getItem('pg.audio.vol') || '{}');
    for (const k in VOL) if (typeof v[k] === 'number') VOL[k] = clamp(v[k], 0, 1);
    if (v.mode in MODES) musicMode = v.mode;
  } catch (e) {}
  const seen = new WeakSet(), stuckSeen = new WeakSet(), air = new WeakMap();
  const AU = {muted, ms: 0, get on() { return !!E && E.ac.state === 'running'; }, get E() { return E; }, get music() { return E?.music || null; },
    get musicOn() { return musicOn; }, get volumes() { return {...VOL}; }, get musicMode() { return musicMode; },
    update, toggle, toggleMusic, setVolume, setMusicMode, play};
  if (typeof window !== 'undefined') window.__audio = AU;   // debug handle

  // the forge runtime starts at LOAD (the context stays suspended until a gesture) so banks bake before you play
  let RT = null;   // {ac, EN (engine), B (bakery), D (director)}
  const forgeOff = q.get('forge') === '0';
  if (!disabled && !forgeOff) {
    try {
      const ac = new AC({latencyHint: 'interactive'}), EN = createEngine(ac, {reverbs: {...REVERBS, ...DESERT_REVERBS}}), B = createBakery(ac);
      const D = createDirector(EN, B, {EVENTS, AMBIENCE: {...AMBIENCE, desert: DESERT_AMB}, SOURCES: {...SOURCES, waterfall: WATERFALL}});
      try { EN.prepareReverbs?.(); } catch (e) {}
      D.prefetch({biome: 'ruins'});
      RT = {ac, EN, B, D}; AU.forge = RT;
    } catch (e) { console.warn('audio: forge runtime unavailable, using the built-in synth', e); RT = null; }
  }
  function unlock() {
    if (disabled) return;
    try {
      if (!E) {
        E = makeEngine(RT ? RT.ac : new AC({latencyHint: 'interactive'}), RT ? RT.EN.bus('master') : null);
        try { E.music = createMusic(E.ac, RT ? RT.EN.bus('music') : E.out, {send: E.revIn, enabled: musicOn}); } catch (e) { console.warn('audio: music unavailable', e); }
        applyVolumes();
      }
      if (!muted && E.ac.state !== 'running') { if (RT) RT.EN.unlock?.(); E.ac.resume().catch(() => {}); }
    } catch (e) { console.warn('audio: unavailable', e); }
  }
  if (!disabled && typeof addEventListener === 'function') {
    for (const ev of ['keydown', 'pointerdown', 'mousedown', 'touchstart']) addEventListener(ev, unlock, {capture: true, passive: true});
    document.addEventListener?.('visibilitychange', () => { try { if (!E) return; if (document.hidden) E.ac.suspend(); else if (!muted) E.ac.resume(); } catch (e) {} });
  }
  function toggle() {
    muted = !muted; AU.muted = muted;
    try { localStorage.setItem('pg.audio.muted', muted ? '1' : '0'); } catch (e) {}
    try { if (E) { if (muted) E.ac.suspend(); else E.ac.resume(); } } catch (e) {}
    return muted;
  }
  function saveVol() { try { localStorage.setItem('pg.audio.vol', JSON.stringify({...VOL, mode: musicMode})); } catch (e) {} }
  function applyVolumes() {
    if (!E) return;
    const t = E.ac.currentTime, g = v => v * v;
    const db = v => 20 * Math.log10(Math.max(1e-4, v));
    if (RT) {   // the forge engine owns master / sfx / ambience; the legacy chain feeds its master at a fixed level
      E.out.gain.setTargetAtTime(.9, t, .03);
      RT.EN.setBusDb('master', db(g(VOL.master))); RT.EN.setBusDb('sfx', db(g(VOL.sfx))); RT.EN.setBusDb('amb', db(g(VOL.amb)));
    } else E.out.gain.setTargetAtTime(.9 * g(VOL.master), t, .03);
    E.sfx.gain.setTargetAtTime(.85 * g(VOL.sfx), t, .03);
    E.lv.amb = g(VOL.amb); E.amb.gain.setTargetAtTime(E.lv.amb, t, .03);
    E.music?.setVolume(g(VOL.music)); E.music?.force(MODES[musicMode]);
  }
  function setVolume(k, v) { if (!(k in VOL)) return; VOL[k] = clamp(+v || 0, 0, 1); saveVol(); applyVolumes(); }
  function setMusicMode(m) { if (!(m in MODES)) return; musicMode = m; saveVol(); applyVolumes(); }
  function toggleMusic() {
    musicOn = !musicOn;
    try { localStorage.setItem('pg.audio.music', musicOn ? '1' : '0'); } catch (e) {}
    E?.music?.setEnabled(musicOn);
    return musicOn;
  }
  let L = {x: 0, y: 0, cam: null};   // the listener (player) for positions
  // pan by the sound's screen x. Optional player.screenX(x, y) -> view px (a host whose camera turns, e.g. the 3D page);
  // without it: world x against the camera (the arena), so the arena sounds exactly as before
  // off: metres beyond the edge of the VIEW (0 = on screen). Phase 3: what you hear should be on screen, so the director
  // fades and culls sounds by how far off-screen their source is (docs/AUDIO.md §3.4).
  function at(x, y) {
    const VW = ctx.VW || 480, VH = ctx.VH || 270, PPM = ctx.PPM || 16, PPMY = ctx.PPMY || PPM;
    const dx = L.screenX ? L.screenX(x, y) - VW / 2 : x * PPM - (L.cam ? L.cam.x + VW / 2 : L.x * PPM);
    const dy = L.screenX ? 0 : y * PPMY - (L.cam ? L.cam.y + VH / 2 : L.y * PPMY);
    const off = Math.max(0, (Math.abs(dx) - VW / 2) / PPM, (Math.abs(dy) - VH / 2) / PPMY);
    return {pan: clamp(dx / (VW / 2) * .7, -.8, .8), d: Math.hypot(x - L.x, y - L.y), off: +off.toFixed(2)};
  }
  function fire(name, x, y, o = {}) {
    const px = x ?? L.x, py = y ?? L.y, pos = at(px, py);
    if (RT) { try { if (RT.D.post(name, {...pos, dist: pos.d, x: px, y: py, ...o})) return; } catch (e) { console.warn('audio: forge', name, e); } }
    try { SFX[name](E, {...pos, ...o}); } catch (e) { console.warn('audio:', name, e); }   // legacy synth (not baked yet / ?forge=0)
  }
  function play(name, o = {}) { unlock(); if (E && SFX[name]) fire(name, L.x, L.y, {surf: bedId || 'ruins', ...o}); }

  // Props that can make sound (torches / braziers, brutes, barrels) are collected into short lists, rebuilt when the
  // props array or host.propsVersion changes, and once a second as a safety net: no per-frame walk over every prop
  // (docs/ARCHITECTURE.md rule). Every frame only touches these few.
  const C = {props: null, ver: -1, tick: 0, fires: [], brutes: [], rollers: [], sources: []};
  const FALLS = [{kind: 'waterfall', id: 'fall:plateau', x: 0, y: 0, pan: 0, d: 0, off: 0}, {kind: 'waterfall', id: 'fall:ravine', x: 0, y: 0, pan: 0, d: 0, off: 0}];   // (reused: no allocation per step)
  function candidates() {
    const props = get(host.props) || [], ver = get(host.propsVersion) ?? props.length;
    if (props === C.props && ver === C.ver && (++C.tick % 60)) return C;
    C.props = props; C.ver = ver; C.tick = 0; C.fires.length = C.brutes.length = C.rollers.length = 0;
    for (const p of props) {
      if (p.kind === 'torch' || p.kind === 'brazier') C.fires.push(p);
      else if (p.kind === 'brute') C.brutes.push(p);
      if (p.tip !== undefined || /barrel/.test(p.kind || '')) C.rollers.push(p);
    }
    return C;
  }
  function update(dt, pl, events) {
    const arrows = get(host.arrows) || [];
    if (!E || muted || E.ac.state !== 'running') {   // not started (no gesture yet / sheet mode) or muted: just keep up
      for (const a of arrows) { seen.add(a); if (a.stuck) stuckSeen.add(a); }
      if (creak) { try { creak.stop(E.ac.currentTime); } catch (e) {} creak = null; }
      if (roll) { try { roll.stop(E.ac.currentTime); } catch (e) {} roll = null; }
      prevState = pl.state; return;
    }
    const t0 = performance.now();
    try { run(dt, pl, events || [], arrows); } catch (e) { console.warn('audio: update', e); }
    AU.ms = AU.ms * .95 + (performance.now() - t0) * .05;
  }

  function run(dt, pl, events, arrows) {
    const t = E.ac.currentTime, surf = SURF[pl.biome] || 'ruins';
    L = {x: pl.x, y: pl.y, cam: pl.cam, screenX: pl.screenX};
    // ---- ambient bed + stream ----
    if (pl.biome !== bedId) { bed?.stop(t); bed = makeBed(E, SURF[pl.biome] || 'ruins', t); bedId = pl.biome; bedMuted = false;
      E.revOut.gain.setTargetAtTime({ruins: .22, ember: .15, frost: .3, rift: .45, desert: CANYON.rev[0]}[bedId] ?? .22, t, .5); }
    const sx = STREAM.cx(pl.y), sd = Math.max(0, Math.abs(pl.x - sx) - STREAM.w(pl.y) / 2);
    const prox = clamp(1 - sd / 18, 0, 1) ** 2;
    let W = null; try { W = get(host.wind); } catch (e) {}   // the getter may run before wind.js exists
    const gust = W && W.on !== false && typeof W.gust === 'number' ? W.gust : null;
    bed.update({prox, sPan: at(sx, pl.y).pan, time: pl.time || 'day', gust}, t);
    if (RT) {   // forge ambience (beds, spots, the stream emitter); the legacy bed fades out once forge beds play
      // visible sound sources in the world (torches / braziers): the director gives each on-screen one an emitter
      const cand = candidates(), sources = cand.sources; sources.length = 0;
      for (const p of cand.fires) if (!p.broken) { const a = at(p.x, p.y); if (a.off < 3) sources.push({kind: p.kind, id: p, x: p.x, y: p.y, ...a}); }
      if (pl.biome === 'ruins') {   // the waterfalls (ember's are lava, frost's frozen: no water sound there)
        const f = ctx.layout?.fall;
        FALLS[0].x = f ? f.x : 0; FALLS[0].y = f ? f.foot.y : 0; FALLS[1].x = STREAM.cx(FALL.ravineY); FALLS[1].y = FALL.ravineY;
        for (let i = f ? 0 : 1; i < 2; i++) {
          const w = FALLS[i];
          if (Math.hypot(w.x - pl.x, w.y - pl.y) > FALL.reach) continue;
          const a = at(w.x, w.y); if (a.off < 3) { w.pan = a.pan; w.d = a.d * FALL.dScale; w.off = a.off; sources.push(w); }
        }
      }
      RT.D.ambience.update({biome: pl.biome, time: pl.time || 'day', listener: {x: pl.x, y: pl.y}, stream: {prox, pan: at(sx, pl.y).pan}, gust, dt, sources, combat: E.music?.state?.I ?? 0});
      const fb = (RT.D.ambience.state?.beds?.length || 0) > 0;
      if (fb !== bedMuted) { bed.out.gain.cancelScheduledValues(t); bed.out.gain.setTargetAtTime(fb ? 0 : 1, t, .8); bedMuted = fb; }
    }
    // ---- the desert: the canyon's echo near its rim (both reverbs), the far calls ----
    if (pl.biome !== revBiome) { revBiome = pl.biome; canyonOn = false; }
    if (pl.biome === 'desert') {
      const near = pl.y > (canyonOn ? CANYON.out : CANYON.in);
      if (near !== canyonOn) { canyonOn = near; E.revOut.gain.setTargetAtTime(CANYON.rev[near ? 1 : 0], t, .8); try { RT?.EN.setReverb?.(near ? 'canyon' : 'desert', 1.5); } catch (e) {} }
      desertCalls(E, callSt, pl.time || 'day', t);
    }
    // ---- player state transitions ----
    const st = pl.state, landed = st === 'land' && prevState !== 'land';
    const bigDrop = events.some(e => e.type === 'player.land' && e.big === 3), speed = Math.hypot(pl.vx || 0, pl.vy || 0);
    if (landed) fire('land', pl.x, pl.y, grounded(pl.biome, pl.x, pl.y, {surf, big: bigDrop ? 1 : 0}));
    if (st === 'roll' && prevState !== 'roll') fire('roll', pl.x, pl.y, grounded(pl.biome, pl.x, pl.y, {surf}));
    if (st === 'climb') { climbT -= dt; if (climbT <= 0) { fire('climb', pl.x, pl.y, {surf}); climbT = RR(.26, .34); } }
    else if (prevState === 'climb') { fire('climb', pl.x, pl.y, {surf, big: 1}); climbT = 0; }
    // the draw creak: while the string is held back
    const drawing = st === 'draw' && pl.aim;
    if (drawing && !pl.gun) {   // (a revolver has no string)
      const k = Math.min(1, (pl.t || 0) * 1.5);
      if (!creak) { creak = (RT && RT.D.makeCreak?.()) || makeCreak(E); prevK = k; }
      creak.set(k, dt > 0 ? (k - prevK) / dt : 0, t, dt); prevK = k;
    } else if (creak) { creak.stop(t); creak = null; }
    prevState = st;
    // ---- events ----
    for (const e of events) {
      switch (e.type) {
        case 'player.step': if (!landed) fire('step', e.x, e.y, grounded(pl.biome, e.x, e.y, {surf, k: e.big ? .9 : clamp(speed / 6, .25, 1), g: .55 + clamp(speed / 7, 0, .45)})); break;
        case 'prop.land': fire('propDrop', e.x, e.y, {mat: MAT[e.kind] || 'wood', surf}); break;   // a prop dropped off the plateau (combat/props.js)
        case 'player.land': if (!landed && e.big === 2) fire('step', e.x, e.y, grounded(pl.biome, e.x, e.y, {surf, k: 1.3, g: 1})); break;   // sprint plant
        case 'player.jump': fire('jump', e.x, e.y, grounded(pl.biome, e.x, e.y, {surf})); break;
        case 'player.splash': case 'arrow.splash': case 'prop.splash': case 'wildlife.splash': fire('splash', e.x, e.y, {surf, small: !!e.small}); break;
        // the revolver (sim/player/gun.js): its own sounds; its bullets aren't arrows (no bow shot, no stuck thud)
        case 'player.shoot': fire('gunshot', e.x, e.y, {gun: e.gun, fan: !!e.fan}); break;
        case 'player.dryfire': fire('gunDry', e.x, e.y); break;
        case 'player.draw': fire('gunDraw', e.x, e.y); break;
        case 'player.reload': fire('gunReload', e.x, e.y, {phase: e.phase}); break;
        case 'player.holster': fire('gunHolster', e.x, e.y); break;
        // the desert's gunmen (features/foes/sim.js): the same revolver, heard where they stand
        case 'foe.shoot': fire('foeShot', e.x, e.y, {gun: e.gun}); break;
        case 'foe.aim': fire('foeCock', e.x, e.y); break;
        case 'foe.draw': fire('foeDraw', e.x, e.y); break;
        case 'foe.reload': fire('foeReload', e.x, e.y, {phase: e.phase, gun: e.gun}); break;
        case 'foe.holster': fire('foeHolster', e.x, e.y); break;
        case 'foe.ground': fire('foeFall', e.x, e.y, grounded(pl.biome, e.x, e.y, {surf, heavy: e.foe === 'bruiser'})); break;   // (features/foes/look.js)
        case 'bullet.impact': if (e.surf === 'ground') fire('stuck', e.x, e.y, {surf, g: .55}); else if (e.surf === 'tree' || e.surf === 'prop') fire('hit', e.x, e.y, {mat: 'wood', g: .7}); break;
        case 'arrow.hit': case 'player.hit': {
          const props = get(host.props) || [], p = !e.player && (e.prop || props.find(p => p.x === e.x && p.y === e.y));
          fire('hit', e.x, e.y, {mat: e.player ? 'body' : MAT[p?.kind] || 'wood'}); break;
        }
        case 'prop.break': fire('brk', e.x, e.y, {kind: e.kind}); break;
        case 'combat.explode': fire('explode', e.x, e.y, {r: e.r}); break;
        case 'combat.loot': fire('loot', e.x, e.y, {n: e.n}); break;
        case 'combat.coin': fire('coin', e.x, e.y); break;
        case 'chest.open': fire('open', e.x, e.y); break;
        case 'combat.trap': fire('trap', e.x, e.y); break;
        case 'brute.respawn': case 'prop.respawn': fire('respawn', e.x, e.y); break;
        // physical props (arena/props3d.js)
        case 'prop.tip': fire('tip', e.x, e.y, {mat: MAT[e.kind] || 'wood', surf}); break;
        case 'prop.kick': fire('kick', e.x, e.y, {mat: MAT[e.kind] || 'wood'}); break;
        case 'prop.scrape': fire('scrape', e.x, e.y, {surf}); break;
        case 'prop.impact': fire('hit', e.x, e.y, {mat: MAT[e.kind] || 'wood', g: clamp((e.speed || 3) / 5, .45, 1.4)}); break;
        // wildlife (arena/wildlife.js)
        case 'wildlife.birds_scatter': fire('wings', e.x, e.y, {n: clamp(e.n || 3, 1, 8), surf}); break;
        case 'wildlife.wings': fire('wings', e.x, e.y, {n: 1, surf}); break;
        case 'wildlife.caw': fire(pl.biome === 'desert' ? 'hawk' : 'caw', e.x, e.y); break;   // (the desert's caller is its hawk)
        case 'wildlife.fish_jump': fire('plop', e.x, e.y, {surf, fish: 1}); break;
        case 'wildlife.frog_jump': fire('plop', e.x, e.y, {surf, frog: 1}); break;
        case 'wildlife.critter_dash': fire('rustle', e.x, e.y, {surf}); break;
        case 'tumbleweed.bounce': fire('rustle', e.x, e.y, {surf, g: .35 + .45 * (e.k || 0), gainDb: -6 + 4 * (e.k || 0), semi: -3}); break;   // dry twigs on the ground
      }
    }
    // ---- arrows: shots (new ones, grouped by ability) and thuds (newly stuck) ----
    let volley = null;
    for (const a of arrows) {
      if (a.kind === 'bullet') continue;   // (the revolver's: player.shoot / bullet.impact above)
      if (!seen.has(a)) {
        seen.add(a);
        if (a.ab === 'rain') fire('whistle', a.x, a.y);
        else if (a.ab === 'multi') volley = volley || {kind: 'multi', a};
        else if (!volley || volley.kind === 'multi') volley = {kind: a.ab === 'pierce' ? 'pierce' : a.ab === 'boom' ? 'boom' : 'arrow', a};
      }
      if (a.stuck && !stuckSeen.has(a)) {
        stuckSeen.add(a);
        if (!a.explode) { const g0 = (ctx.layout?.elev || elevOf)(a.x, a.y); fire('stuck', a.x, a.y, {surf: a.h > g0 + .15 ? 'stone' : surf, g: a.ab === 'rain' ? .7 : 1}); }
      }
    }
    if (volley) { const a = volley.a, v = Math.hypot(a.vx, a.vy); fire('shot', pl.x, pl.y, {kind: volley.kind, k: clamp((v - 14) / 12, 0, 1)}); }
    // ---- combat state we can read: rain cast, trap laid, brutes landing ----
    const C = get(host.combat)?.dbg;
    if (C) {
      if (C.zones && C.zones.length > nZones) fire('volley', pl.x, pl.y);
      if (C.traps && C.traps.length > nTraps) { const q = C.traps[C.traps.length - 1]; fire('trapSet', q.x, q.y); }
      nZones = C.zones?.length || 0; nTraps = C.traps?.length || 0;
    }
    let stomps = 0;
    for (const p of candidates().brutes) {
      const was = air.get(p); air.set(p, !!p.air);
      if (was && !p.air && !p.broken) { fire('stomp', p.x, p.y, {surf}); stomps++; }
    }
    // ---- rolling barrels (props3d.js: p.tip set and moving) -> one rumble voice following the fastest nearby one ----
    let rb = null, rs = 0;
    for (const p of candidates().rollers) if (p.tip && !p.broken) { const sp = Math.hypot(p.vx || 0, p.vy || 0), a = at(p.x, p.y); if (sp > .3 && a.d < 25 && sp / (1 + a.d * .1) > rs) { rs = sp / (1 + a.d * .1); rb = {sp, ...a}; } }
    if (rb) { if (!roll) roll = (RT && RT.D.makeRoll?.()) || makeRoll(E); roll.set(rb.sp, rb.pan, rb.d, t, dt, rb.off); }
    else if (roll) { roll.stop(t); roll = null; }
    // ---- music: follows the biome, time of day and how intense play is ----
    E.music?.update(t, {biome: pl.biome, time: pl.time || 'day', speed, drawing, events, stomps});
  }
  return AU;
}

// ======================================================================================================================
// LEVEL TEST: render SFX / beds offline and measure. list: [{name, o?, n? (repeat), gap? (s between repeats)} |
// {bed: 'ruins', time, prox}]. Returns [{name, peak, rms, rmsDb, peakDb}] (after the master chain).
// ======================================================================================================================
export async function renderOffline(list, {sec = 2.5, sr = 44100} = {}) {
  const res = [];
  for (const it of list) {
    const ac = new OfflineAudioContext(2, (sr * (it.sec || sec)) | 0, sr), E = makeEngine(ac);
    if (it.bed) {
      const b = makeBed(E, it.bed, 0);
      for (let t = 0; t < (it.sec || sec); t += 1 / 30) b.update({prox: it.prox ?? 0, sPan: .3, time: it.time || 'day'}, t);
    } else if (it.creak) {
      const c = makeCreak(E); for (let t = 0; t < 1.2; t += 1 / 60) c.set(Math.min(1, t * 1.5), t < .67 ? 1.5 : 0, t + .05, 1 / 60); c.stop(1.3);
    } else for (let i = 0; i < (it.n || 1); i++) SFX[it.name](E, {pan: 0, d: 0, surf: 'ruins', ...it.o, at: .05 + i * (it.gap ?? .05)});
    const buf = await ac.startRendering();
    let pk = 0, ss = 0, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = d[i]; if (Math.abs(x) > pk) pk = Math.abs(x); ss += x * x; n++; } }
    const rms = Math.sqrt(ss / n);
    res.push({name: it.label || it.name || (it.bed ? `bed ${it.bed} ${it.time || 'day'} prox ${it.prox ?? 0}` : 'creak'), peak: +pk.toFixed(3), rms: +rms.toFixed(4),
      peakDb: +(20 * Math.log10(pk || 1e-9)).toFixed(1), rmsDb: +(20 * Math.log10(rms || 1e-9)).toFixed(1)});
  }
  return res;
}
