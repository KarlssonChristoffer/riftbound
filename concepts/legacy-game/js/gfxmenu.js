// Graphics settings panel: resolution, outlines, edge highlights and lighting style for the pixel pipeline.
// Opens with O, from the pause screen or from camp. It is a side panel, so changes show live on the game behind it.
import {gfx, GFX_DEFAULT, RES, saveGfx} from './pixel.js';

const $ = s => document.querySelector(s);
document.head.insertAdjacentHTML('beforeend', `<style>
#gfx{position:fixed;top:16px;right:16px;width:min(320px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:16px 18px;z-index:50;pointer-events:auto;display:grid;gap:14px}
#gfx .gh{display:flex;align-items:center;justify-content:space-between;gap:10px}#gfx h2{font-size:22px}
#gfx .gx{background:none;border:0;color:#bdb4a8;font-size:22px;cursor:pointer;line-height:1;padding:2px 6px}#gfx .gx:hover{color:#fff}
#gfx .gr{display:grid;gap:6px}
#gfx .gl{display:flex;justify-content:space-between;font:700 11px Inter;letter-spacing:.12em;text-transform:uppercase;color:#bdb4a8}
#gfx .gl output{color:#fff;letter-spacing:0;font-variant-numeric:tabular-nums}
#gfx small{font-size:11.5px;line-height:1.4;color:#9f978c}
#gfx input[type=range]{width:100%;margin:0;accent-color:var(--accent)}
#gfx input[type=range]:disabled{opacity:.35}
#gfx .gs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px}
#gfx .gs button{font:700 12px Inter;color:#cfc6b8;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:7px;padding:7px 4px;cursor:pointer}
#gfx .gs button:hover{border-color:rgba(255,255,255,.35);color:#fff}
#gfx .gs button[aria-pressed="true"]{background:color-mix(in srgb,var(--accent) 28%,transparent);border-color:var(--accent);color:#fff}
#gfx .gs button small{display:block;font:600 10px Inter;color:inherit;opacity:.7}
#gfx .gf{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#8f877c}
#gfx button:focus-visible,#gfx input:focus-visible{outline:2px solid #fff;outline-offset:2px}
.gfxopen{margin-top:12px}
</style>`);

const panel = document.createElement('div');
panel.id = 'gfx'; panel.className = 'panel hidden'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Graphics settings');
panel.innerHTML = `
  <div class="gh"><h2>Graphics</h2><button class="gx" id="gfxClose" aria-label="Close graphics settings">×</button></div>
  <div class="gr"><span class="gl">Resolution</span>
    <div class="gs" id="gfxRes">${RES.map(r => `<button type="button" data-v="${r.rows}">${r.name}<small>${r.rows}p</small></button>`).join('')}</div>
    <small>How many pixel rows the world is drawn with. Fewer rows means bigger, chunkier pixels.</small></div>
  <label class="gr" for="gfxOutline"><span class="gl">Outlines <output id="gfxOutlineV"></output></span>
    <input type="range" id="gfxOutline" min="0" max="1" step="0.05"><small>Dark line around every silhouette.</small></label>
  <label class="gr" for="gfxHigh"><span class="gl">Edge highlights <output id="gfxHighV"></output></span>
    <input type="range" id="gfxHigh" min="0" max="1" step="0.05"><small>Light line along creases, like wall tops and armor edges.</small></label>
  <div class="gr"><span class="gl">Lighting</span>
    <div class="gs" id="gfxLight"><button type="button" data-v="smooth">Smooth</button><button type="button" data-v="toon">Toon steps</button></div>
    <small>Smooth gradients, or flat cel-shaded steps. Both have soft edges.</small></div>
  <label class="gr" for="gfxSteps"><span class="gl">Toon steps <output id="gfxStepsV"></output></span>
    <input type="range" id="gfxSteps" min="2" max="6" step="1"><small>Brightness steps from shadow to full light. Toon only.</small></label>
  <div class="gf"><button type="button" class="btn ghost" id="gfxReset">Reset to defaults</button><span>O toggles · Esc closes</span></div>`;
document.body.appendChild(panel);

const pct = v => Math.round(v * 100) + '%';
function sync() {
  panel.querySelectorAll('#gfxRes button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.v === gfx.rows));
  panel.querySelectorAll('#gfxLight button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === gfx.light));
  $('#gfxOutline').value = gfx.outline; $('#gfxOutlineV').textContent = pct(gfx.outline);
  $('#gfxHigh').value = gfx.highlight; $('#gfxHighV').textContent = pct(gfx.highlight);
  $('#gfxSteps').value = gfx.steps; $('#gfxStepsV').textContent = gfx.light === 'toon' ? gfx.steps : 'off'; $('#gfxSteps').disabled = gfx.light !== 'toon';
}
function set(k, v) { gfx[k] = v; saveGfx(); sync(); }
panel.querySelectorAll('#gfxRes button').forEach(b => b.onclick = () => set('rows', +b.dataset.v));
panel.querySelectorAll('#gfxLight button').forEach(b => b.onclick = () => set('light', b.dataset.v));
$('#gfxOutline').oninput = e => set('outline', +e.target.value);
$('#gfxHigh').oninput = e => set('highlight', +e.target.value);
$('#gfxSteps').oninput = e => set('steps', +e.target.value);
$('#gfxReset').onclick = () => { Object.assign(gfx, GFX_DEFAULT); saveGfx(); sync(); };
sync();

// Opened over the pause screen, the pause panel steps aside so the game stays visible; closing brings it back.
let hidPause = false;
export function openGfx() {
  const pause = $('#pause');
  hidPause = !!pause && !pause.classList.contains('hidden'); if (hidPause) pause.classList.add('hidden');
  panel.classList.remove('hidden'); panel.querySelector('button[aria-pressed="true"]')?.focus({preventScroll: true});
}
export function closeGfx() {
  panel.classList.add('hidden'); if (hidPause) $('#pause').classList.remove('hidden'); hidPause = false;
  if (panel.contains(document.activeElement)) document.activeElement.blur();
}
const isOpen = () => !panel.classList.contains('hidden');
$('#gfxClose').onclick = closeGfx;
// capture phase, so Esc closes this panel instead of reaching the pause toggle
addEventListener('keydown', e => {
  if (e.key === 'Escape' && isOpen()) { e.preventDefault(); e.stopImmediatePropagation(); closeGfx(); return; }
  if (e.key.toLowerCase() === 'o' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { e.stopImmediatePropagation(); isOpen() ? closeGfx() : openGfx(); }
}, true);

// entry points on the pause screen and at camp
const entry = (where, before) => {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost gfxopen'; b.textContent = 'Graphics settings (O)';
  b.dataset.nav = 'gfx'; b.onclick = openGfx; where.insertBefore(b, before); return b;
};
const pw = $('#pause .pausewrap'); if (pw) entry(pw, pw.querySelector('.phint'));
const hf = $('#menu .hubfoot'); if (hf) { const b = entry(hf, hf.firstChild); b.classList.remove('gfxopen'); b.style.marginRight = '8px'; }
