// WIND AUDIO (render3d): what a brisk wind sounds like in the foliage, on top of the forge's ambient wind beds (those
// only swing about ±6 dB with the gust). Driven every step by the wind feature: W.rustle {e, pan} (the leafy crowns and
// bushes near the player: how hard the wind works them, where they are on screen) and W.strength (the wind at the player,
// 1 = a full gust of a plain breeze). Silent in a calm; it swells with every gust front that rolls through the trees.
//   rustle   the leaves: pink noise through a band (~350-1400 Hz), 36 dB/oct down from ~1.4 kHz (three low-passes), its loudness
//            roughened by a fast random envelope (~11 Hz, peaky): many leaves stirring, never a steady hiss. Two
//            decorrelated voices, panned toward the trees
//   ticks    sparse grains (5-14 ms, band 1.6-3.2 kHz): single leaves slapping, the ONLY high frequencies, far under
//   whoosh   the gust itself, around the player: pink noise through a band swept 170-600 Hz by the strength, under 1 kHz
// The user's ear (audio/forge/RECIPE_GUIDE.md "Brightness rules"): no static hiss beds, continuous layers dark, highs only
// as sparse grains, ambience level. createWindAudio(ac, dest) -> {update(dt, s | null), swish(pan, k), stop()};
// s = {e, pan, strength}. swish: a wind line (windlines.js) streaking past the player.
// Levels: TUNE (linear gains into the ambience bus); measure(ac) renders a few seconds offline for level checks.
import {clamp} from '../core/mathx.js';
const R = Math.random;
export const TUNE = {
  rustle: .39,     // gain at full agitation (saturates: 1 - exp(-.8 e)). Measured (measure()): calm -52 dBFS RMS, a breeze
                   // gust -34, a brisk lull -36, a brisk gust -30, a gale -28: ambience level, gusts stand out a little.
                   // Above 2 kHz: -14.5 dB under the whole (the ticks included); above 5 kHz -35 dB
  tick: .04,       // a leaf tick's peak gain
  ticks: 26,       // ticks per second at full agitation
  whoosh: .23,     // gain of the gust layer at strength 2.5 (it starts above strength .6)
  swish: .3,       // peak gain of a wind line streaking past (x strength)
  smooth: .22,     // s: how fast the layers follow the wind
};

// a seamless loop: n samples, the tail cross-faded into the head
export function loopBuf(ac, sec, fill) {   // (also used by rainaudio.js)
  const n = Math.round(sec * ac.sampleRate), X = Math.round(.08 * ac.sampleRate), raw = fill(n + X), b = ac.createBuffer(1, n, ac.sampleRate), o = b.getChannelData(0);
  for (let i = 0; i < n; i++) o[i] = i < X ? raw[i] * (i / X) + raw[n + i] * (1 - i / X) : raw[i];
  return b;
}
export function pink(n, r = R) {   // Paul Kellet's filter, normalised to RMS .3 (r: the noise's generator)
  const o = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, s = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852; b3 = .8665 * b3 + w * .3104856;
    b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898; o[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362; b6 = w * .115926; s += o[i] * o[i];
  }
  const k = .3 / Math.sqrt(s / n || 1); for (let i = 0; i < n; i++) o[i] *= k;
  return o;
}
// a rough loudness envelope: random points at ~11 Hz, smoothed (cosine), made peaky (^1.6) -> 0..1, circular
function rough(sr, r = R) {
  return n => {
    const per = Math.round(sr / 11), m = Math.ceil(n / per) + 2, pts = Array.from({length: m}, () => r()), o = new Float32Array(n);
    for (let i = 0; i < n; i++) { const f = i / per, k = Math.floor(f), t = (1 - Math.cos((f - k) * Math.PI)) / 2, v = pts[k % m] * (1 - t) + pts[(k + 1) % m] * t; o[i] = .12 + .88 * v ** 1.6; }
    return o;
  };
}
export function burst(ac, r = R) {   // 16 ms of noise for the ticks (each tick filters and envelopes it)
  const n = Math.round(.016 * ac.sampleRate), b = ac.createBuffer(1, n, ac.sampleRate), o = b.getChannelData(0);
  for (let i = 0; i < n; i++) o[i] = (r() * 2 - 1) * .5;
  return b;
}

// rnd: the generator for what's made here (the loops' noise, their start points); the ticks and swishes keep Math.random.
// features/audio.js makes it at load with core/rng.js viewRandom (no Math.random draws there)
export function createWindAudio(ac, dest, rnd = R) {
  const out = ac.createGain(); out.gain.value = 1; out.connect(dest);
  const srcs = [], at = ac.currentTime + .05;
  const loop = (buf, off = 0) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(at, off * buf.duration); srcs.push(s); return s; };
  const biq = (type, f, q) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const pan = p => { const n = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain(); if (n.pan) n.pan.value = p; n.connect(out); return n; };
  const pk = n => pink(n, rnd), PK = [loopBuf(ac, 3.1, pk), loopBuf(ac, 3.7, pk), loopBuf(ac, 4.3, pk)], RG = loopBuf(ac, 5.3, rough(ac.sampleRate, rnd)), BU = burst(ac, rnd);
  // rustle: two voices; vca.gain = (rough envelope x level) through `amt`
  const voices = [-1, 1].map((side, i) => {   // band ~350-1400 Hz, then 36 dB/oct down from ~1.4 kHz (three low-passes)
    const bp = biq('bandpass', 700, .6), lp1 = biq('lowpass', 1350, .7), lp2 = biq('lowpass', 1550, .5), lp3 = biq('lowpass', 1750, .5), vca = ac.createGain(), p = pan(side * .35);
    vca.gain.value = 0; loop(PK[i], rnd()).connect(bp); bp.connect(lp1); lp1.connect(lp2); lp2.connect(lp3); lp3.connect(vca); vca.connect(p);
    const amt = ac.createGain(); amt.gain.value = 0; loop(RG, i * .41 + rnd() * .2).connect(amt); amt.connect(vca.gain);
    return {side, amt, p, bp};
  });
  // whoosh: the gust around the player
  const wbp = biq('bandpass', 260, .7), wlp = biq('lowpass', 950, .6), wg = ac.createGain(); wg.gain.value = 0;
  loop(PK[2], rnd()).connect(wbp); wbp.connect(wlp); wlp.connect(wg); wg.connect(pan(0));
  let tickAcc = 0, setAcc = 1, alive = true;   // (setAcc: the levels are set 30 times a second, not every frame: they glide anyway)
  const set = (p, v, tc = TUNE.smooth) => p.setTargetAtTime(v, ac.currentTime, tc);
  function tick(t, e, panC) {
    const s = ac.createBufferSource(); s.buffer = BU; s.playbackRate.value = .8 + R() * .5;
    const bp = biq('bandpass', 1600 + R() * 1600, 1.4), g = ac.createGain(), p = pan(clamp(panC + (R() - .5) * 1.1, -.9, .9)), d = .005 + R() * .009, A = TUNE.tick * (.4 + R() * .6) * Math.min(1, e);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A, t + .0012); g.gain.exponentialRampToValueAtTime(.0005, t + .0012 + d);
    s.connect(bp); bp.connect(g); g.connect(p); s.start(t); s.stop(t + .03); s.onended = () => { try { p.disconnect(); } catch (e) {} };
  }
  return {
    out,
    // a wind line streaking past the player (windlines.js): pink noise through a band rising 330 -> 850 Hz and falling
    // back, under 1.2 kHz, ~0.55 s, panned to its side. k 0..1 (the strength)
    swish(panX = 0, k = 1) {
      if (!alive) return;
      const t = ac.currentTime + .01, s = ac.createBufferSource(); s.buffer = PK[R() * 3 | 0]; s.playbackRate.value = .9 + R() * .2;
      const bp = biq('bandpass', 330, 1.1), lp = biq('lowpass', 1200, .6), g = ac.createGain(), p = pan(clamp(panX, -.9, .9)), A = TUNE.swish * k * (.7 + R() * .3);
      bp.frequency.setValueAtTime(330, t); bp.frequency.exponentialRampToValueAtTime(850, t + .22); bp.frequency.exponentialRampToValueAtTime(380, t + .55);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(A, t + .16); g.gain.exponentialRampToValueAtTime(.0005, t + .58);
      if (p.pan) { p.pan.setValueAtTime(clamp(panX - .25, -.9, .9), t); p.pan.linearRampToValueAtTime(clamp(panX + .25, -.9, .9), t + .5); }
      s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(p); s.start(t, R() * 2); s.stop(t + .62); s.onended = () => { try { p.disconnect(); } catch (e) {} };
    },
    update(dt, s) {
      if (!alive) return;
      const e = s ? Math.max(0, s.e || 0) : 0, panC = s ? clamp(s.pan || 0, -1, 1) : 0, st = s ? s.strength || 0 : 0;
      const lv = TUNE.rustle * (1 - Math.exp(-.8 * e));
      if ((setAcc += dt) >= 1 / 30) { setAcc = 0;
      for (const v of voices) { set(v.amt.gain, lv); if (v.p.pan) set(v.p.pan, clamp(panC * .75 + v.side * .3, -.9, .9), .3); set(v.bp.frequency, 600 + 180 * Math.min(2, e), .4); }
      const k = clamp((st - .6) / 1.9, 0, 1) ** 1.3;
      set(wg.gain, TUNE.whoosh * k); set(wbp.frequency, 170 + 430 * clamp(st / 2.6, 0, 1), .5); }
      tickAcc += dt * TUNE.ticks * clamp(e - .15, 0, 2) ** 1.5;
      const t = ac.currentTime + .02;
      for (let i = 0; tickAcc >= 1 && i < 4; i++) { tickAcc -= 1; tick(t + R() * .04, e, panC); }
      if (tickAcc > 4) tickAcc = 0;
    },
    stop() { alive = false; const t = ac.currentTime; out.gain.setTargetAtTime(0, t, .2); for (const x of srcs) try { x.stop(t + 1); } catch (e) {} setTimeout(() => { try { out.disconnect(); } catch (e) {} }, 1500); },
  };
}

// level check: render `sec` s offline at fixed inputs -> {rms, peak} in dBFS (no dest bus: straight to the speakers)
export async function measure(s = {e: 1, pan: 0, strength: 1.5}, sec = 4) {
  const ac = new OfflineAudioContext(2, Math.round(sec * 48000), 48000), W = createWindAudio(ac, ac.destination);
  for (let t = 0; t < sec; t += 1 / 60) ac.suspend(t).then(() => { W.update(1 / 60, s); ac.resume(); }).catch(() => {});
  const b = await ac.startRendering(), d = b.getChannelData(0), from = Math.round(1 * 48000);
  let sq = 0, pk = 0; for (let i = from; i < d.length; i++) { sq += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
  const db = x => +(20 * Math.log10(Math.max(1e-6, x))).toFixed(1);
  return {rms: db(Math.sqrt(sq / (d.length - from))), peak: db(pk)};
}
