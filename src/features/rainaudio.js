// RAIN AUDIO (render3d): what the weather sounds like beyond the wind (windaudio.js does the wind): rain and thunder.
// Driven every step by the world clock (sim/env.js host.env.sky: rain, storm) and by weather.js (thunder after a strike).
//   rain     a WASH: pink noise through a band (~300-1200 Hz) under two low-passes, swelling with the rain (the body of a
//            downpour, never a hiss), plus PATTER: sparse droplet grains (4-9 ms, band 0.9-2.4 kHz, random pan), the only
//            high frequencies, their rate following the rain; now and then a low drip on stone
//   thunder  thunder(dist m, pan): after dist / 343 s, a RUMBLE (brown-ish noise under 250 Hz, rolling in a few swells over
//            3-5 s); a close strike (< 150 m) opens with a CRACK (a short dark burst under 2 kHz) and is louder
// The user's ear (audio/forge/RECIPE_GUIDE.md "Brightness rules"): dark continuous layers, highs only as sparse grains,
// ambience level. createRainAudio(ac, dest) -> {update(dt, {rain, storm} | null), thunder(dist, pan), stop()}
// Levels: TUNE (linear gains into the ambience bus).
import {loopBuf, pink, burst} from './windaudio.js';
import {clamp} from '../core/mathx.js';
const R = Math.random;
export const TUNE = {
  wash: .34,       // the rain's body at full rain
  drops: 70,       // patter grains per second at full rain
  drop: .045,      // a grain's peak gain
  drip: 3,         // low drips per second at full rain
  rumble: .55,     // a near thunder's rumble peak (far ones fall off with distance)
  crack: .42,      // a close strike's crack peak
  smooth: .6,      // s: the wash follows the rain this fast
};
function brown(n, r = R) {   // integrated white noise, leaky, normalised to RMS .3: the thunder's body
  const o = new Float32Array(n); let b = 0, s = 0;
  for (let i = 0; i < n; i++) { b = (b + (r() * 2 - 1) * .02) * .997; o[i] = b; s += b * b; }
  const k = .3 / Math.sqrt(s / n || 1); for (let i = 0; i < n; i++) o[i] *= k;
  return o;
}

// rnd: the generator for what's made here (the loops' noise, the wash's start points); the grains, drips and thunder keep
// Math.random. features/audio.js makes it at load with core/rng.js viewRandom (no Math.random draws there)
export function createRainAudio(ac, dest, rnd = R) {
  const out = ac.createGain(); out.gain.value = 1; out.connect(dest);
  const srcs = [], at = ac.currentTime + .05;
  const biq = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const pan = p => { const n = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain(); if (n.pan) n.pan.value = p; n.connect(out); return n; };
  const PK = [loopBuf(ac, 3.3, n => pink(n, rnd)), loopBuf(ac, 4.1, n => pink(n, rnd))], BR = loopBuf(ac, 5.7, n => brown(n, rnd)), BU = burst(ac, rnd);
  // the wash: two decorrelated voices, left / right
  const wash = [-.45, .45].map((side, i) => {
    const s = ac.createBufferSource(); s.buffer = PK[i]; s.loop = true; s.start(at, rnd() * PK[i].duration); srcs.push(s);
    const bp = biq('bandpass', 620, .45), lp1 = biq('lowpass', 1200, .7), lp2 = biq('lowpass', 1500, .5), g = ac.createGain(); g.gain.value = 0;
    s.connect(bp); bp.connect(lp1); lp1.connect(lp2); lp2.connect(g); g.connect(pan(side));
    return g;
  });
  let dropAcc = 0, dripAcc = 0, alive = true;
  function grain(t, k) {   // one droplet: a short band of noise, quiet
    const s = ac.createBufferSource(); s.buffer = BU; s.playbackRate.value = .7 + R() * .6;
    const bp = biq('bandpass', 900 + R() * 1500, 1.6), g = ac.createGain(), p = pan(R() * 1.6 - .8), d = .004 + R() * .005, A = TUNE.drop * k * (.35 + R() * .65);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A, t + .001); g.gain.exponentialRampToValueAtTime(.0004, t + .001 + d);
    s.connect(bp); bp.connect(g); g.connect(p); s.start(t); s.stop(t + .03); s.onended = () => { try { p.disconnect(); } catch (e) {} };
  }
  function drip(t, k) {   // a heavier drop on stone: a low, quick blip
    const o = ac.createOscillator(), g = ac.createGain(), p = pan(R() * 1.4 - .7), f = 420 + R() * 380;
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * .7, t + .05);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05 * k, t + .002); g.gain.exponentialRampToValueAtTime(.0004, t + .06);
    o.connect(g); g.connect(p); o.start(t); o.stop(t + .08); o.onended = () => { try { p.disconnect(); } catch (e) {} };
  }
  return {
    out,
    update(dt, s) {
      if (!alive) return;
      const rain = s ? clamp(s.rain || 0, 0, 1) : 0, t = ac.currentTime;
      for (const g of wash) g.gain.setTargetAtTime(TUNE.wash * rain ** 1.2, t, TUNE.smooth);
      dropAcc += dt * TUNE.drops * rain * rain; dripAcc += dt * TUNE.drip * rain;
      for (let i = 0; dropAcc >= 1 && i < 8; i++) { dropAcc -= 1; grain(t + .02 + R() * .03, .5 + rain * .5); }
      if (dropAcc > 8) dropAcc = 0;
      if (dripAcc >= 1) { dripAcc -= 1; if (R() < .8) drip(t + .02 + R() * .1, rain); }
    },
    thunder(dist = 600, panX = 0) {
      if (!alive) return;
      const t = ac.currentTime + .02 + clamp(dist / 343, 0, 5), near = dist < 150, k = clamp(1.15 - dist / 1800, .25, 1);
      const p = pan(clamp(panX, -.85, .85));
      // the rumble: brown noise under ~250 Hz, swelling 2-4 times as it rolls away
      const s = ac.createBufferSource(); s.buffer = BR; s.playbackRate.value = .8 + R() * .3;
      const lp = biq('lowpass', near ? 260 : 170, .7), lp2 = biq('lowpass', near ? 320 : 220, .5), g = ac.createGain(), dur = 3 + R() * 2.2;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(TUNE.rumble * k, t + (near ? .06 : .35));
      let tt = t + (near ? .06 : .35);
      for (let i = 0, n = 2 + (R() * 3 | 0); i < n; i++) { tt += dur / (n + 1); g.gain.linearRampToValueAtTime(TUNE.rumble * k * (.35 + R() * .5) * (1 - i / (n + 1)), tt); }
      g.gain.exponentialRampToValueAtTime(.0004, t + dur + .8);
      s.connect(lp); lp.connect(lp2); lp2.connect(g); g.connect(p); s.start(t, R() * 3); s.stop(t + dur + 1);
      if (near) {   // the crack: a short dark burst (under 2 kHz), then the rumble
        const c = ac.createBufferSource(); c.buffer = PK[0]; const cb = biq('lowpass', 1900, .7), cg = ac.createGain();
        cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(TUNE.crack, t + .004); cg.gain.exponentialRampToValueAtTime(.0004, t + .22);
        c.connect(cb); cb.connect(cg); cg.connect(p); c.start(t, R() * 2); c.stop(t + .3);
      }
      s.onended = () => { try { p.disconnect(); } catch (e) {} };
    },
    stop() { alive = false; const t = ac.currentTime; out.gain.setTargetAtTime(0, t, .3); for (const x of srcs) try { x.stop(t + 1.5); } catch (e) {} setTimeout(() => { try { out.disconnect(); } catch (e) {} }, 2000); },
  };
}

// level check: render `sec` s offline -> {rms, peak} dBFS (no bus: straight to the speakers)
export async function measure(s = {rain: 1}, sec = 4, thunderAt = -1) {
  const ac = new OfflineAudioContext(2, Math.round(sec * 48000), 48000), A = createRainAudio(ac, ac.destination);
  for (let t = 0; t < sec; t += 1 / 30) ac.suspend(t).then(() => { A.update(1 / 30, s); if (thunderAt >= 0 && Math.abs(ac.currentTime - thunderAt) < .02) A.thunder(80, 0); ac.resume(); }).catch(() => {});
  const b = await ac.startRendering(), d = b.getChannelData(0), from = Math.round(1 * 48000);
  let sq = 0, pk = 0; for (let i = from; i < d.length; i++) { sq += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
  const db = x => +(20 * Math.log10(Math.max(1e-6, x))).toFixed(1);
  return {rms: db(Math.sqrt(sq / (d.length - from))), peak: db(pk)};
}
