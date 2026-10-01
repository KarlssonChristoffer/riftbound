// Synthesised sound effects and a quiet ambient drone per biome (WebAudio, no sound files).
let ctx = null, master = null, sfxBus = null, musicBus = null, muted = false, drone = null;
const last = {};

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC(); master = ctx.createGain(); master.gain.value = .55; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = .9; sfxBus.connect(comp);
  musicBus = ctx.createGain(); musicBus.gain.value = .22; musicBus.connect(master);
}
// browsers only start audio after a click/key press; gamepad input doesn't count
export function audioBlocked() { return !ctx || ctx.state !== 'running'; }
export function toggleMute() { muted = !muted; if (master) master.gain.setTargetAtTime(muted ? 0 : .55, ctx.currentTime, .05); return muted; }

let noiseBuf = null;
function noise() {
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function tone(type, f0, f1, dur, vol, t = 0, filt) {
  const T = ctx.currentTime + t, o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, T); if (f1) o.frequency.exponentialRampToValueAtTime(f1, T + dur);
  env(g, T, .005, vol, dur); let n = o; if (filt) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filt; o.connect(f); n = f; } n.connect(g); g.connect(sfxBus); o.start(T); o.stop(T + dur + .05);
}
function burst(dur, vol, f0, f1, type = 'bandpass', t = 0, q = 1) {
  const T = ctx.currentTime + t, s = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, T); if (f1) f.frequency.exponentialRampToValueAtTime(f1, T + dur); env(g, T, .004, vol, dur);
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(T, Math.random()); s.stop(T + dur + .05);
}
const ELEM_F = {fire: 180, frost: 900, storm: 1400, void: 260, poison: 520, physical: 700};
const SFX = {
  hit: o => { burst(.08, .25, 2200, 600); tone('square', 180, 90, .06, .06); },
  crit: o => { burst(.12, .35, 3000, 500); tone('square', 320, 120, .1, .1); },
  block: o => { tone('triangle', 900, 700, .12, .15); tone('triangle', 1350, 1100, .1, .08); },
  boom: o => { burst(.6, .7, 900, 60, 'lowpass'); tone('sine', 90, 35, .5, .45); },
  bigboom: o => { burst(1.1, .9, 1200, 40, 'lowpass'); tone('sine', 70, 25, .9, .6); tone('sawtooth', 55, 30, .6, .12, 0, 300); },
  cast: o => { const f = ELEM_F[o.elem] || 500; burst(.25, .2, f * 2, f * .6, 'bandpass', 0, 2); tone('sine', f, f * 1.8, .18, .08); },
  shoot: o => { const f = ELEM_F[o.elem] || 500; burst(.07, .12, f * 3, f, 'bandpass', 0, 3); tone('triangle', f * 1.4, f * .7, .06, .05); },
  swing: o => { burst(.14, .16, 500, 2500, 'bandpass', 0, 1.5); },
  dash: o => { burst(.22, .22, 300, 2000, 'bandpass', 0, 1); },
  hurt: o => { tone('sawtooth', 160, 70, .16, .18, 0, 900); burst(.1, .2, 800, 200); },
  death: o => { burst(.25, .22, 1400, 200); tone('square', 240, 60, .22, .07, 0, 1200); },
  coin: o => { tone('triangle', 1760, 0, .09, .08); tone('triangle', 2640, 0, .12, .06, .05); },
  globe: o => { tone('sine', 520, 880, .25, .12); },
  potion: o => { for (let k = 0; k < 3; k++) tone('sine', 300 + k * 80, 500 + k * 80, .08, .1, k * .07); },
  level: o => { [523, 659, 784, 1047].forEach((f, k) => tone('triangle', f, 0, .35, .12, k * .09)); tone('sine', 262, 0, .8, .1); },
  flip: o => { burst(.05, .14, 3000, 1500); },
  land: o => { const r = o.rarity; const base = r === 'prismatic' ? 880 : r === 'gold' ? 660 : 520; tone('triangle', base, 0, .3, .1); tone('triangle', base * 1.5, 0, .35, r === 'silver' ? .03 : .08, .04); if (r === 'prismatic') tone('sine', base * 2, 0, .6, .07, .08); },
  pick: o => { tone('triangle', 784, 0, .15, .1); tone('triangle', 1175, 0, .25, .1, .07); },
  roar: o => { tone('sawtooth', 110, 55, 1.1, .25, 0, 500); burst(1, .3, 300, 120, 'lowpass'); },
  warn: o => { tone('square', 440, 440, .06, .04); },
  stagger: o => { tone('triangle', 196, 180, 1.4, .22); tone('triangle', 294, 270, 1.2, .12); tone('sine', 98, 0, 1.6, .2); burst(.5, .3, 2500, 400); },
  unstop: o => { tone('sawtooth', 220, 330, .25, .07, 0, 1400); tone('triangle', 440, 660, .3, .06, .04); },
  portal: o => { tone('sine', 220, 880, 1.2, .15); tone('sine', 330, 1320, 1.2, .08); },
};
// play a named effect; the same effect is rate-limited so a big fight doesn't turn into noise
export function sfx(name, o = {}, gap = .035) {
  if (!ctx || muted) return; const now = ctx.currentTime; if (last[name] && now - last[name] < gap) return; last[name] = now;
  try { SFX[name](o); } catch (e) { /* audio is best-effort */ }
}
// ambient drone: two detuned oscillators through a slowly moving filter, rooted per biome
const ROOTS = [55, 49, 61.7, 41.2];
export function setDrone(biome) {
  if (!ctx) return; if (drone) { const d = drone; d.g.gain.setTargetAtTime(0.0001, ctx.currentTime, .8); setTimeout(() => d.nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 4000); }
  const f = ROOTS[biome % 4], g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(1, ctx.currentTime, 2);
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400; lp.Q.value = 4; lp.connect(g); g.connect(musicBus);
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = .07; lg.gain.value = 250; lfo.connect(lg); lg.connect(lp.frequency);
  const nodes = [lfo]; for (const [m, det, type] of [[1, -6, 'sawtooth'], [1, 7, 'sawtooth'], [1.5, 0, 'triangle'], [2, 3, 'sine']]) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * m; o.detune.value = det; const og = ctx.createGain(); og.gain.value = type === 'sawtooth' ? .12 : .08; o.connect(og); og.connect(lp); o.start(); nodes.push(o); }
  lfo.start(); drone = {g, nodes};
}
