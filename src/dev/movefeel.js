// MOVE FEEL: a dev panel (F7 in dev mode; also Menu > Dev > Features > Move feel panel) to feel the player's movement against
// the animation it drives: how fast he goes, how quickly he gets there and stops, and how long his strides are. Every slider
// is a MODIFIER note under the source 'movefeel' (core/modifiers.js) on the owner's own number; sim/player/player.js applies it:
//   Walk / Run / Sprint speed   player.speed.walk / .run / .sprint x   (shown in m/s; the authored speeds: SPEED0)
//   Get going                   player.accel x   (setting off, building a sprint: ACC.start / sprintUp)
//   Slow down                   player.decel x   (stopping, easing out of a sprint, a skid: ACC.stop / sprintDown / skid)
//   Walk / Run / Sprint stride  player.stride.walk / .run / .sprint x   (the clip's stride as the legs advance: > 1 longer
//                               strides, slower legs at the same speed, the feet slide a little; GAIT.stride)
// The readout: his speed, the gait, and the legs' cadence (steps a minute) next to the cadence the clip was made at (its own
// fps over its frames: what the animation looks right at). Presets set every slider at once; Shift+F7 (or the A/B button)
// flips between what's set and the game as authored, to feel the two back to back.
// They hold in DEV MODE only, like the gun feel panel's (dev/gunfeel.js). Remembered on this machine ('rb.movefeel').
// It is a FEATURE the boot puts at the end of the list (main.js; dev/: nothing in the game imports it).
// OWNS: the panel (#movefeel + its style), the 'movefeel' notes.  READS: host.mods, host.dev, host.P, the atlas's clips
// (hero.atlas), player.js's authored numbers (SPEED0, ACC0, GAIT).
// BUDGET: closed: nothing. Open: a few text writes 4 times a second.
import {SPEED0, ACC0, GAIT} from '../sim/player/player.js';

const STORE = 'rb.movefeel';
// speed knobs are in m/s (their note: x of the authored speed); the rest are x
const KNOBS = [
  {k: 'walk', label: 'Walk speed (Q)', stat: 'player.speed.walk', base: SPEED0.walk, min: .8, max: 2.2, step: .05, unit: 'm/s'},
  {k: 'run', label: 'Run speed', stat: 'player.speed.run', base: SPEED0.run, min: 2.5, max: 6, step: .05, unit: 'm/s'},
  {k: 'sprint', label: 'Sprint speed (Shift)', stat: 'player.speed.sprint', base: SPEED0.sprint, min: 4, max: 9, step: .05, unit: 'm/s'},
  {k: 'accel', label: 'Get going', stat: 'player.accel', base: 1, min: .15, max: 1.5, step: .05, note: 'how quickly he reaches his speed'},
  {k: 'decel', label: 'Slow down', stat: 'player.decel', base: 1, min: .15, max: 1.5, step: .05, note: 'how quickly he stops'},
  {k: 'swalk', label: 'Walk stride', stat: 'player.stride.walk', base: 1, min: .7, max: 2, step: .05, note: 'longer: slower legs, feet slide'},
  {k: 'srun', label: 'Run stride', stat: 'player.stride.run', base: 1, min: .7, max: 2, step: .05, note: 'longer: slower legs, feet slide'},
  {k: 'ssprint', label: 'Sprint stride', stat: 'player.stride.sprint', base: 1, min: .7, max: 2, step: .05, note: 'longer: slower legs, feet slide'},
];
const AUTHORED = Object.fromEntries(KNOBS.map(n => [n.k, n.base]));
// the presets: what each one tries (the label's title)
const PRESETS = [
  {name: 'As made', title: 'the game as authored', v: {}},
  {name: 'Slower', title: "the speeds the run / sprint clips were animated at: the legs look right, he's slower", v: {walk: 1.2, run: 3.4, sprint: 5.2}},
  {name: 'Long stride', title: 'the speeds as now, the strides stretched so the legs move at the clips\' pace (the feet slide)',
    v: {swalk: 1.5, srun: 1.4, ssprint: 1.6}},
  {name: 'Weighty', title: 'the speeds as now, but he takes a moment to get going and to stop', v: {accel: .35, decel: .5}},
  {name: 'Blend', title: 'a bit slower, a bit longer strides, a bit of weight', v: {walk: 1.25, run: 3.9, sprint: 6, swalk: 1.15, srun: 1.15, ssprint: 1.3, accel: .5, decel: .6}},
];
const CSS = `
#movefeel { position: fixed; left: 10px; top: 64px; z-index: 15; width: 270px; padding: 8px 8px 6px; background: rgba(14, 16, 15, .93);
  border: 1px solid var(--line); border-radius: 6px; user-select: none; }
body:has(#pause:not(.hidden)) #movefeel { visibility: hidden; }
#movefeel header { display: flex; justify-content: space-between; align-items: baseline; padding: 0 4px 4px; }
#movefeel header b { color: var(--key); letter-spacing: .14em; }
#movefeel header small { color: var(--dim); }
#movefeel .read { padding: 2px 4px 6px; color: var(--ink); line-height: 1.35; }
#movefeel .read em { font-style: normal; color: var(--key); }
#movefeel .read .bad { color: #ff8a6a; }
#movefeel label { display: block; padding: 3px 4px 1px; color: var(--ink); }
#movefeel label span { float: right; color: var(--dim); }
#movefeel label.on span { color: var(--key); }
#movefeel input { width: 100%; margin: 0; accent-color: #f0c060; }
#movefeel .row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
#movefeel button { flex: 1 1 auto; padding: 2px 6px; font: inherit; color: var(--ink); background: rgba(255, 255, 255, .05);
  border: 1px solid var(--line); border-radius: 4px; cursor: pointer; }
#movefeel button:hover, #movefeel button.on { border-color: var(--key); }
#movefeel button.on { color: var(--key); }`;

export function createMoveFeel({host, atlas}) {
  const C = {open: false, ab: false, ...AUTHORED};
  try { Object.assign(C, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  C.open = false; C.ab = false;   // (closed at the start, like every dev panel: F7 opens it; never starts on the A/B's 'as made')
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
  root.innerHTML = '<header><b>MOVE FEEL</b><small>F7 · Shift+F7 A/B</small></header><div class="read"></div>';
  const read = root.querySelector('.read');
  const rows = KNOBS.map(n => {
    const l = document.createElement('label'); l.title = n.note || ''; l.innerHTML = `${n.label}<span></span>`;
    const s = document.createElement('input'); s.type = 'range'; s.min = n.min; s.max = n.max; s.step = n.step; s.value = C[n.k];
    s.oninput = () => { C[n.k] = +s.value; C.ab = false; save(); apply(); sync(); };
    s.ondblclick = () => { C[n.k] = n.base; s.value = n.base; save(); apply(); sync(); };   // (a double click: as made)
    s.onchange = () => s.blur();   // (let go: the keys are the game's again)
    root.appendChild(l); root.appendChild(s);
    return {n, l, v: l.firstElementChild, s};
  });
  const bar = document.createElement('div'); bar.className = 'row'; root.appendChild(bar);
  const pbtn = PRESETS.map(p => {
    const b = document.createElement('button'); b.textContent = p.name; b.title = p.title; bar.appendChild(b);
    b.onclick = () => { Object.assign(C, AUTHORED, p.v); C.ab = false; save(); apply(); sync(); };
    return {p, b};
  });
  const bar2 = document.createElement('div'); bar2.className = 'row'; root.appendChild(bar2);
  const abB = document.createElement('button'); abB.title = "flip between what's set and the game as made (Shift+F7)"; bar2.appendChild(abB);
  abB.onclick = () => flip();
  const flip = () => { C.ab = !C.ab; apply(); sync(); };

  const f1 = (v, d = 1) => v.toFixed(d);
  // steps a minute at speed v (m/s) on a clip with stride s (m a cycle: two steps); the clip's own pace: its fps over its frames
  const spm = (v, s) => v / s * 2 * 60, own = c => c.fps / c.frames * 2 * 60;
  function readout() {
    const P = host.P, CL = atlas.CLIP || {}, v = Math.hypot(P.vx, P.vy), g = P.gait, c = CL[g];
    const t = (a, b) => b > 0 ? f1(a / b, 2) + ' s' : '-';
    let h = `speed <em>${f1(v)}</em> m/s · ${P.state === 'move' ? g : P.state}`;
    if (P.state === 'move' && c?.stride && c.fps) {
      const now = spm(v, c.stride * (GAIT.stride[g] ?? 1)), want = own(c), off = now / want;
      h += `<br>legs <em class="${off > 1.2 || off < .8 ? 'bad' : ''}">${now | 0}</em> steps/min · clip made for ${want | 0}`;
    } else h += '<br>&nbsp;';
    // what each gait's clip looks right at (its pace x its stride), and how quickly he gets going / stops now
    const at = k => CL[k]?.stride && CL[k].fps ? f1(CL[k].fps / CL[k].frames * CL[k].stride * (GAIT.stride[k] ?? 1)) : '?';
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
    abB.textContent = C.ab ? 'A/B: as made (click: yours)' : 'A/B: yours (click: as made)';
    abB.classList.toggle('on', C.ab);
    readout();
  }
  function show() {
    const vis = F.on && host.dev && game()?.mode !== 'title';
    root.classList.toggle('hidden', !vis);
    return vis;
  }

  let devWas = null, syncT = 0;
  const F = {
    name: 'movefeel', label: 'Move feel panel', key: 'f7', on: !!C.open,   // (key: the menu's label; onKey takes F7 first)
    toggle() {
      if (!host.dev && !F.on) return F.on;   // (dev mode only)
      F.on = !F.on; C.open = F.on; save();
      if (show()) sync();
      return F.on;
    },
    onKey(k, e) {   // F7 (not Chrome's caret browsing); Shift+F7: the A/B
      if (k !== 'f7') return false;
      e?.preventDefault();
      if (e?.shiftKey) { if (host.dev) flip(); } else F.toggle();
      return true;
    },
    update() { if (host.dev !== devWas) { devWas = host.dev; apply(); } },   // (the first step too: the remembered sliders)
    frame({dt}) { if (!show()) return; if ((syncT -= dt) <= 0) { syncT = .25; sync(); } },
    hud() {
      if (!host.dev) return '';
      if (C.ab) return '<b>move feel</b> A/B: as made';
      const a = []; for (const n of KNOBS) if (C[n.k] !== n.base) a.push(`${n.label.toLowerCase().replace(/ \(.*\)/, '')} ${n.unit ? C[n.k].toFixed(2) : '×' + C[n.k].toFixed(2)}`);
      return a.length ? `<b>move feel</b> ${a.join(' · ')}` : '';
    },
  };
  return F;
}
