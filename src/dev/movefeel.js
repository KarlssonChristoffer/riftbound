// MOVE FEEL: a dev panel (F7 in dev mode; also Menu > Dev > Features > Move feel panel) to feel the player's movement against
// the animation it drives: how fast he goes, how quickly he gets there and stops, and how long his strides are. Every slider
// is a MODIFIER note under the source 'movefeel' (core/modifiers.js) on the owner's own number; sim/player/player.js applies it:
//   Walk / Run / Sprint speed   player.speed.walk / .run / .sprint x   (shown in m/s; the authored speeds: SPEED0)
//   Get going                   player.accel x   (setting off, building a sprint: ACC.start / sprintUp)
//   Slow down                   player.decel x   (stopping, easing out of a sprint, a skid: ACC.stop / sprintDown / skid)
//   Walk / Run / Sprint stride  player.stride.walk / .run / .sprint x   (the style: the clip's stride as the legs advance, shown x
//                               the clip's; > 1 longer strides, slower legs, the feet slide a little. On top of it the stride
//                               grows with his real speed by itself: player.js strideK)
// The readout: his speed, the gait, and the legs' cadence (steps a minute) next to the cadence the clip was made at (its own
// fps over its frames: what the animation looks right at), and the footsteps the sound plays a minute (they fire on the clip's contact
// frames, so they follow the legs). Presets set every slider at once (PageUp / PageDown cycle them); Shift+F7 (or the A/B button)
// flips between what's set and the standard (Jog, the authored profile), to feel the two back to back.
// They hold in DEV MODE only, like the gun feel panel's (dev/gunfeel.js). Remembered on this machine ('rb.movefeel2').
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it).
// OWNS: the panel (#movefeel + its style), the 'movefeel' notes.  READS: host.mods, host.dev, host.P, the atlas's clips
// (hero.atlas), player.js's authored numbers (SPEED0, ACC0, STRIDE0) and strideK.
// BUDGET: closed: nothing. Open: a few text writes 4 times a second.
import {SPEED0, ACC0, STRIDE0, strideK} from '../sim/player/player.js';

const STORE = 'rb.movefeel2';   // (2: the profile became Jog's; the first panel's remembered sliders meant other numbers)
// speed knobs are in m/s and strides as the style (both: their note is x of the authored value); get going / slow down are x
const STRIDE_NOTE = 'the style; it also grows with his real speed by itself. Longer: slower legs, the feet slide';
const KNOBS = [
  {k: 'walk', label: 'Walk speed (Q)', stat: 'player.speed.walk', base: SPEED0.walk, min: .8, max: 2.2, step: .05, unit: 'm/s'},
  {k: 'run', label: 'Run speed', stat: 'player.speed.run', base: SPEED0.run, min: 2, max: 6, step: .05, unit: 'm/s'},
  {k: 'sprint', label: 'Sprint speed (Shift)', stat: 'player.speed.sprint', base: SPEED0.sprint, min: 3.5, max: 9, step: .05, unit: 'm/s'},
  {k: 'accel', label: 'Get going', stat: 'player.accel', base: 1, min: .2, max: 4, step: .05, note: 'how quickly he reaches his speed'},
  {k: 'decel', label: 'Slow down', stat: 'player.decel', base: 1, min: .2, max: 4, step: .05, note: 'how quickly he stops'},
  {k: 'swalk', label: 'Walk stride', stat: 'player.stride.walk', base: STRIDE0.walk, min: .5, max: 2, step: .05, note: STRIDE_NOTE},
  {k: 'srun', label: 'Run stride', stat: 'player.stride.run', base: STRIDE0.run, min: .5, max: 2, step: .05, note: STRIDE_NOTE},
  {k: 'ssprint', label: 'Sprint stride', stat: 'player.stride.sprint', base: STRIDE0.sprint, min: .5, max: 2, step: .05, note: STRIDE_NOTE},
];
const AUTHORED = Object.fromEntries(KNOBS.map(n => [n.k, n.base]));
// the presets (the label's title says what each tries). Jog is the authored profile (player.js); the others are the ones tried
// on 2026-10-12 against the first profile (walk 1.4 / run 4.6 / sprint 7.2), turned into today's terms so each feels as it did then
// at full speed: the strides net of the speed's own share (strideK), get going / slow down x Jog's rates
const PRESETS = [
  {name: 'Jog', title: 'the standard: a relaxed exploring pace, a gentle start and stop', v: {}},
  {name: 'Original', title: 'the first profile: fast, quick legs, instant start and stop', v: {walk: 1.4, swalk: .889, run: 4.6, srun: .774, sprint: 7.2, ssprint: .803, accel: 2.222, decel: 2}},
  {name: 'Slower', title: "near the speeds the clips were animated at, instant start and stop", v: {walk: 1.2, swalk: .975, run: 3.4, srun: .928, sprint: 5.2, ssprint: .977, accel: 2.222, decel: 2}},
  {name: 'Long stride', title: "the first profile's speeds, the strides stretched to the clips' pace (the feet slide)",
    v: {walk: 1.4, swalk: 1.066, run: 4.6, srun: 1.083, sprint: 7.2, ssprint: 1.326, accel: 2.222, decel: 2}},
  {name: 'Weighty', title: "the first profile's speeds, but he takes a moment to get going and to stop", v: {walk: 1.4, swalk: .889, run: 4.6, srun: .774, sprint: 7.2, ssprint: .803, accel: .778}},
  {name: 'Blend', title: 'a bit slower than the first profile, a bit longer strides, a bit of weight', v: {walk: 1.25, swalk: 1.094, run: 3.9, srun: .982, sprint: 6, ssprint: 1.165, accel: 1.111, decel: 1.2}},
  {name: 'Brisk', title: 'quicker than Jog, legs at a natural pace, quick to react', v: {walk: 1.3, swalk: 1.022, run: 4, srun: 1.01, sprint: 6.2, ssprint: 1.23, accel: 1.556, decel: 1.6}},
  {name: 'Heavy boots', title: 'a lumbering cowboy: slow to build up and slow to stop', v: {walk: 1.1, swalk: 1.027, run: 3.5, srun: .957, sprint: 5.4, ssprint: 1.146, accel: .489, decel: .6}},
  {name: 'Sprint burst', title: "a calm run near the clip's pace, and a sprint that is a real burst you build into", v: {walk: 1.4, swalk: .889, run: 3.4, srun: .928, sprint: 6.6, ssprint: 1.27, accel: 1.333, decel: 1.4}},
  {name: 'Nimble', title: 'fast and very responsive, with long natural strides', v: {walk: 1.3, swalk: 1.022, run: 4.3, srun: 1.047, sprint: 6.6, ssprint: 1.27, accel: 2.667, decel: 2.4}},
];
// the look: the game's own, in pixels (hard edges, no rounding or blur, a stepped frame, square knobs), not a web card
const CSS = `
#movefeel { position: fixed; left: 10px; top: 64px; z-index: 15; width: 276px; padding: 8px 8px 6px; background: #121412;
  border: 2px solid #3b3a30; box-shadow: 0 0 0 2px #070807, 4px 4px 0 2px rgba(0, 0, 0, .55); border-radius: 0; user-select: none;
  font: 11px/1.35 ui-monospace, Consolas, monospace; image-rendering: pixelated; -webkit-font-smoothing: none; font-smooth: never; }
body:has(#pause:not(.hidden)) #movefeel { visibility: hidden; }
#movefeel header { display: flex; justify-content: space-between; align-items: baseline; margin: -8px -8px 6px; padding: 4px 8px;
  background: #2a2618; border-bottom: 2px solid #070807; }
#movefeel header b { color: var(--key); letter-spacing: .18em; text-shadow: 1px 1px 0 #000; }
#movefeel header small { color: var(--dim); font-size: 10px; }
#movefeel .read { padding: 2px 4px 6px; margin-bottom: 4px; color: var(--ink); background: #0a0b0a; border: 1px solid #2a2a22; }
#movefeel .read em { font-style: normal; color: var(--key); }
#movefeel .read .bad { color: #ff8a6a; }
#movefeel label { display: block; padding: 3px 4px 1px; color: var(--ink); }
#movefeel label span { float: right; color: var(--dim); }
#movefeel label.on span { color: var(--key); }
#movefeel input { -webkit-appearance: none; appearance: none; width: 100%; height: 6px; margin: 2px 0 3px; background: #2a2a22;
  border: 1px solid #070807; border-radius: 0; outline: none; }
#movefeel input::-webkit-slider-thumb { -webkit-appearance: none; width: 8px; height: 12px; background: #f0c060; border: 1px solid #070807;
  border-radius: 0; box-shadow: inset -2px -2px 0 #a8782c; cursor: pointer; }
#movefeel input::-moz-range-thumb { width: 8px; height: 12px; background: #f0c060; border: 1px solid #070807; border-radius: 0; }
#movefeel .row { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; }
#movefeel button { flex: 1 1 auto; padding: 2px 5px; font: inherit; color: var(--ink); background: #1e1f1a; border: 2px solid #3b3a30;
  border-radius: 0; box-shadow: inset -2px -2px 0 #0e0f0d; cursor: pointer; }
#movefeel button:hover { border-color: #6a6448; }
#movefeel button.on { color: #120f08; background: #f0c060; border-color: #070807; box-shadow: inset -2px -2px 0 #a8782c; }`;

export function createMoveFeel({host, atlas}) {
  const C = {open: false, ab: false, ...AUTHORED};
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  C.open = false; C.ab = false;   // (closed at the start, like every dev panel: F7 opens it; never starts on the A/B's standard)
  for (const n of KNOBS) if (!(C[n.k] >= n.min && C[n.k] <= n.max)) C[n.k] = n.base;
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(C)); } catch (e) {} };
  const game = () => host.feature('game');
  function apply() {
    const notes = [];
    if (host.dev && !C.ab) for (const n of KNOBS) if (C[n.k] !== n.base) notes.push({stat: n.stat, mul: C[n.k] / n.base});
    if (notes.length) host.mods.set('movefeel', notes); else host.mods.clear('movefeel');
  }

  // ---------------------------------------------------------------- the panel
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'movefeel'; root.className = 'hidden'; document.body.appendChild(root);
  root.addEventListener('mousedown', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });   // (no focus but the sliders': Space stays the game's)
  root.addEventListener('keydown', e => e.target.blur?.());   // (a key on a focused slider is the game's)
  root.innerHTML = '<header><b>MOVE FEEL</b><small>F7 · PgUp/PgDn preset · Shift+F7 A/B</small></header><div class="read"></div>';
  const read = root.querySelector('.read');
  const rows = KNOBS.map(n => {
    const l = document.createElement('label'); l.title = n.note || ''; l.innerHTML = `${n.label}<span></span>`;
    const s = document.createElement('input'); s.type = 'range'; s.min = n.min; s.max = n.max; s.step = n.step; s.value = C[n.k];
    s.oninput = () => { C[n.k] = +s.value; C.ab = false; save(); apply(); sync(); };
    s.ondblclick = () => { C[n.k] = n.base; s.value = n.base; save(); apply(); sync(); };   // (a double click: the standard)
    s.onchange = () => s.blur();   // (let go: the keys are the game's again)
    root.appendChild(l); root.appendChild(s);
    return {n, l, v: l.firstElementChild, s};
  });
  const bar = document.createElement('div'); bar.className = 'row'; root.appendChild(bar);
  const pbtn = PRESETS.map(p => {
    const b = document.createElement('button'); b.textContent = p.name; b.title = p.title; bar.appendChild(b);
    b.onclick = () => pick(PRESETS.indexOf(p));
    return {p, b};
  });
  const bar2 = document.createElement('div'); bar2.className = 'row'; root.appendChild(bar2);
  const abB = document.createElement('button'); abB.title = "flip between what's set and the standard, Jog (Shift+F7)"; bar2.appendChild(abB);
  abB.onclick = () => flip();
  const flip = () => { C.ab = !C.ab; apply(); sync(); };
  const current = () => PRESETS.findIndex(p => KNOBS.every(n => C[n.k] === (p.v[n.k] ?? n.base)));
  let lastP = 0;   // (the preset cycling goes on from: the one set, else the last one picked)
  const pick = i => { lastP = i; Object.assign(C, AUTHORED, PRESETS[i].v); C.ab = false; save(); apply(); sync(); };
  const cycle = d => { const c = current(); pick(((c >= 0 ? c : lastP) + d + PRESETS.length) % PRESETS.length); };

  const f1 = (v, d = 1) => v.toFixed(d);
  // steps a minute at speed v (m/s) on a clip with stride s (m a cycle: two steps); the clip's own pace: its fps over its frames
  const spm = (v, s) => v / s * 2 * 60, own = c => c.fps / c.frames * 2 * 60;
  function readout() {
    const P = host.P, CL = atlas.CLIP || {}, v = Math.hypot(P.vx, P.vy), g = P.gait, c = CL[g];
    const t = (a, b) => b > 0 ? f1(a / b, 2) + ' s' : '-';
    const ci = current();
    let h = `preset <em>${C.ab ? 'Jog (A/B)' : ci >= 0 ? PRESETS[ci].name : 'custom'}</em>`;
    h += `<br>speed <em>${f1(v)}</em> m/s · ${P.state === 'move' ? g : P.state}`;
    if (P.state === 'move' && c?.stride && c.fps) {
      const now = spm(v, c.stride * strideK(g, v)), want = own(c), off = now / want;
      h += `<br>legs <em class="${off > 1.2 || off < .8 ? 'bad' : ''}">${now | 0}</em> steps/min · clip made for ${want | 0}`;
      h += `<br>footsteps heard <em>${heard()}</em>/min`;
    } else h += '<br>&nbsp;<br>&nbsp;';
    // what each gait's clip looks right at (its own pace x its stride), and how quickly he gets going / stops now
    const at = k => CL[k]?.stride && CL[k].fps ? f1(CL[k].fps / CL[k].frames * CL[k].stride) : '?';
    h += `<br><small>clips look right at: walk ${at('walk')} · run ${at('run')} · sprint ${at('sprint')} m/s</small>`;
    const k = C.ab ? AUTHORED : C, run = k.run, acc = ACC0.start * k.accel, dec = ACC0.stop * k.decel;
    h += `<br><small>0 → run in ${t(run, acc)} · run → stop in ${t(run, dec)}</small>`;
    if (read.innerHTML !== h) read.innerHTML = h;
  }
  function sync() {
    for (const r of rows) {
      const v = C[r.n.k], t = r.n.unit ? `${v.toFixed(2)} ${r.n.unit}` : '×' + v.toFixed(2);
      if (r.v.textContent !== t) r.v.textContent = t;
      r.l.classList.toggle('on', v !== r.n.base);
      if (+r.s.value !== v) r.s.value = v;
    }
    for (const {p, b} of pbtn) b.classList.toggle('on', KNOBS.every(n => C[n.k] === (p.v[n.k] ?? n.base)));
    abB.textContent = C.ab ? 'A/B: standard (click: yours)' : 'A/B: yours (click: standard)';
    abB.classList.toggle('on', C.ab);
    readout();
  }
  function show() {
    const vis = F.on && host.dev && game()?.mode !== 'title';
    root.classList.toggle('hidden', !vis);
    return vis;
  }

  // the footsteps the sound plays (player.step, and a sprint's footfall player.land big 2: features/audio.js): their pace over the
  // last few, to check against the legs'. Sim times of the last STEPS footfalls in a ring
  const STEPS = 8, steps = new Float64Array(STEPS); let simT = 0, nStep = 0;
  const heard = () => {
    if (nStep < 3 || simT - steps[(nStep - 1) % STEPS] > .6) return '-';   // (not stepping just now)
    const n = Math.min(nStep, STEPS) - 1, span = steps[(nStep - 1) % STEPS] - steps[(nStep - 1 - n) % STEPS];
    return span > 0 ? (n / span * 60 | 0) : '-';
  };

  let devWas = null, syncT = 0;
  const F = {
    name: 'movefeel', label: 'Move feel panel', key: 'f7', on: !!C.open,   // (key: the menu's label; onKey takes F7 first)
    toggle() {
      if (!host.dev && !F.on) return F.on;   // (dev mode only)
      F.on = !F.on; C.open = F.on; save();
      if (show()) sync();
      return F.on;
    },
    onKey(k, e) {   // F7 (not Chrome's caret browsing); Shift+F7: the A/B; PageUp / PageDown: the presets while it shows
      if ((k === 'pagedown' || k === 'pageup') && show()) { e?.preventDefault(); cycle(k === 'pagedown' ? 1 : -1); return true; }
      if (k !== 'f7') return false;
      e?.preventDefault();
      if (e?.shiftKey) { if (host.dev) flip(); } else F.toggle();
      return true;
    },
    update(dt, evs) {
      if (host.dev !== devWas) { devWas = host.dev; apply(); }   // (the first step too: the remembered sliders)
      if (!F.on) return;
      simT += dt;
      for (const e of evs) if (e.type === 'player.step' || (e.type === 'player.land' && e.big === 2)) {
        if (nStep && simT - steps[(nStep - 1) % STEPS] > .6) nStep = 0;   // (a pause: count from this run's footfalls only)
        if (nStep && simT === steps[(nStep - 1) % STEPS]) continue;   // (a plant-turn's two feet in one step: one footfall)
        steps[nStep++ % STEPS] = simT;
      }
    },
    frame({dt}) { if (!show()) return; if ((syncT -= dt) <= 0) { syncT = .25; sync(); } },
    hud() {
      if (!host.dev) return '';
      if (C.ab) return '<b>move feel</b> A/B: standard';
      const a = []; for (const n of KNOBS) if (C[n.k] !== n.base) a.push(`${n.label.toLowerCase().replace(/ \(.*\)/, '')} ${n.unit ? C[n.k].toFixed(2) : '×' + C[n.k].toFixed(2)}`);
      return a.length ? `<b>move feel</b> ${a.join(' · ')}` : '';
    },
  };
  return F;
}
