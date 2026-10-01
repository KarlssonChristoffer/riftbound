// FORGE LAB: audition, compare and rate Sound Forge recipes in the browser (docs/AUDIO.md §4.4).
// The designer can't hear; this page is where a person listens and rates. Ratings live in localStorage
// ('forge.ratings.v1') and export as forge-ratings.json for the designer to read.
//
//   - recipe browser: every case rendered with bake() for N seeds, spectrograms, metrics, pass/fail, similarity
//   - references: recipe.refs[case] (and any take you add) decoded, loudness-matched and measured the same way
//   - blind A/B: forge vs reference or forge vs forge, hidden labels, tally per case
//   - machine-gun: all variants in a row with runtime jitter, the way the game will fire them
//
// Nothing here touches the recipes: they are imported (cache-busted so "Reload recipes" picks up edits).
// window.__lab exposes the state for headless checks.

import {bake, defaults} from './forge.js';
import {analyze, lufsMomentaryMax, spectrumProfile, similarity} from './metrics.js';
import {spectrogramImage} from './spectro.js';

const dbToGain = db => Math.pow(10, db / 20);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const tick = () => new Promise(r => setTimeout(r));
const errMsg = e => String(e?.message || e).split(/\r?\n/)[0];
const hz = v => v == null ? 'n/a' : v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(v);
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const ROOT = new URL('../../', location.href);           // the project root (serve.py serves D:\Game)
const rootUrl = p => new URL(String(p).replace(/^\/+/, ''), ROOT).href;
const baseName = p => String(p).split('/').pop();

// ---------------------------------------------------------------------------------------------------- state + store
// PLAYBACK LEVELS (never baked in: bake() and the metrics stay as they are). Louder reads as "more real" in a blind
// test, so every card and both A/B sides play at one common momentary-max loudness. If some buffer in the comparison
// can't reach it without its sample peak passing PEAK_CAP, the whole comparison drops to the lowest reachable level.
const PLAY_LUFS = -24, PEAK_CAP = -1.2;
function levelOf(it) {   // measured on the stored buffer: {lufs, pk (sample peak dB, all channels), reach (max LUFS under the cap)}
  if (!it.lvl) {
    const chans = Array.isArray(it.ch) ? it.ch : [it.ch]; let pk = 0;
    for (const c of chans) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
    const lufs = lufsMomentaryMax(it.ch, it.sr), pkDb = 20 * Math.log10(Math.max(1e-9, pk));
    it.lvl = {lufs, pk: pkDb, reach: lufs + (PEAK_CAP - pkDb)};
  }
  return it.lvl;
}
const groupTarget = items => Math.min(PLAY_LUFS, ...items.map(it => levelOf(it).reach));
function computeLevels() {   // cards: one target for everything rendered in this case (variants + references)
  const items = [...S.variants, ...S.refs].filter(it => it.ch && Number.isFinite(levelOf(it).lufs));
  S.target = items.length ? groupTarget(items) : PLAY_LUFS;
  for (const it of items) { it.playDb = S.target - it.lvl.lufs; const f = it.el && $('.foot', it.el); if (f) f.innerHTML = footOf(it); }
}
const KEY = 'forge.ratings.v1', EXTRA_KEY = 'forge.lab.extraRefs', SR_KEY = 'forge.lab.sr';
const S = {
  ids: [], recipes: {}, errors: {}, rid: null, cs: null,
  n: 6, seedBase: 1, custom: null, sr: +ls.get(SR_KEY, 0) || 48000,
  variants: [], refs: [], token: 0, mode: 'grid', focus: null, ab: null, done: Promise.resolve(), busy: false,
};
const store = (() => { const s = ls.get(KEY, null); return s && typeof s === 'object' && s.ratings ? {ratings: s.ratings, ab: s.ab || {}} : {ratings: {}, ab: {}}; })();
const saveStore = () => { if (!ls.set(KEY, store)) toast('Could not save to localStorage', true); };
const extraRefs = ls.get(EXTRA_KEY, {});
const caseKey = () => `${S.rid}/${S.cs}`;
const recipe = () => S.recipes[S.rid];

// ---------------------------------------------------------------------------------------------------- ui helpers
let toastT = 0;
function toast(msg, bad = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = '', bad ? 4000 : 1800);
}
function setStatus(msg) { $('#status').textContent = `${S.sr / 1000} kHz` + (ac && ac.sampleRate !== S.sr ? ` (device ${ac.sampleRate / 1000})` : '') + (msg ? ' · ' + msg : ''); }
addEventListener('error', e => toast('Error: ' + errMsg(e.error || e.message), true));
addEventListener('unhandledrejection', e => toast('Error: ' + errMsg(e.reason), true));

// ---------------------------------------------------------------------------------------------------- audio
// The AudioContext is created on the first gesture; before that everything is plain Float32Arrays and AudioBuffers
// (which don't need a context). Renders use the device rate once it is known (remembered for the next visit).
let ac = null, master = null, cur = null, voices = [], timers = [], seq = null;
function ctx() {
  if (!ac) {
    ac = new AudioContext(); master = ac.createGain(); master.connect(ac.destination);
    if (ac.sampleRate !== S.sr) { ls.set(SR_KEY, ac.sampleRate); S.sr = ac.sampleRate; toast(`Device runs at ${ac.sampleRate / 1000} kHz: the next render uses it`); }
    setStatus();
  }
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
addEventListener('pointerdown', () => ctx(), {once: true, capture: true});
addEventListener('keydown', e => { if (!e.repeat) ctx(); }, {once: true, capture: true});
function bufferOf(it) {
  if (it.buffer) return it.buffer;
  const chans = (Array.isArray(it.ch) ? it.ch : [it.ch]).map(c => c instanceof Float32Array ? c : Float32Array.from(c));
  const b = new AudioBuffer({length: chans[0].length, numberOfChannels: chans.length, sampleRate: it.sr});
  chans.forEach((c, i) => b.copyToChannel(c, i));
  return it.buffer = b;
}
function mark(it, on) { it?.el?.classList.toggle('playing', on); const b = it?.el && $('.play', it.el); if (b) b.textContent = on ? '■' : '▶'; }
function play(it, {loop = it.loop, onend, gainDb = it.playDb ?? 0} = {}) {
  const a = ctx(); stopAll();
  const src = a.createBufferSource(); src.buffer = bufferOf(it); src.loop = !!loop;
  const g = a.createGain(); g.gain.value = dbToGain(gainDb); src.connect(g).connect(master);
  const t0 = a.currentTime; src.start();
  cur = {src, it, g, gainDb}; mark(it, true); playhead(it, src, t0);
  src.onended = () => { if (cur?.src === src) { cur = null; mark(it, false); onend?.(); } };
}
function toggle(it) { if (!it?.ch) return; if (cur?.it === it) stopAll(); else play(it); }
function playhead(it, src, t0) {
  const ph = it.el && $('.ph', it.el); if (!ph) return;
  const dur = src.buffer.duration; ph.hidden = false;
  const step = () => {
    if (cur?.src !== src) { ph.hidden = true; return; }
    let t = ac.currentTime - t0; if (src.loop) t %= dur;
    ph.style.left = Math.min(100, t / dur * 100) + '%'; requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function schedule(it, when, {rate = 1, gainDb = 0, dur} = {}) {   // fire-and-forget voice (machine-gun, back-to-back)
  const a = ctx(), src = a.createBufferSource(), g = a.createGain();
  src.buffer = bufferOf(it); src.playbackRate.value = rate; g.gain.value = dbToGain(gainDb);
  src.connect(g).connect(master); dur ? src.start(when, 0, dur) : src.start(when);
  voices.push(src); src.onended = () => { voices = voices.filter(v => v !== src); };
  const ms = Math.max(0, (when - a.currentTime) * 1000);
  timers.push(setTimeout(() => { it.el?.classList.add('hit'); timers.push(setTimeout(() => it.el?.classList.remove('hit'), 130)); }, ms));
  return src;
}
function stopAll() {
  if (cur) { const c = cur; cur = null; try { c.src.onended = null; c.src.stop(); } catch {} mark(c.it, false); }
  for (const v of voices) try { v.stop(); } catch {}
  voices = []; timers.forEach(clearTimeout); timers = [];
  if (seq) { seq = null; }
  $$('.card.hit').forEach(el => el.classList.remove('hit'));
  syncSeqButtons();
}
function runSeq(kind, plan) {          // plan: [{it, at (s from start), dur?, rate?, gainDb?}]
  stopAll(); if (!plan.length) return;
  S.lastPlan = plan;   // inspected by headless checks
  const a = ctx(), t0 = a.currentTime + .08;
  for (const p of plan) schedule(p.it, t0 + p.at, p);
  const end = Math.max(...plan.map(p => p.at + (p.dur ?? bufferOf(p.it).duration / (p.rate || 1))));
  seq = kind; syncSeqButtons();
  timers.push(setTimeout(() => { if (seq === kind) { seq = null; syncSeqButtons(); } }, (end + .15) * 1000 + 80));
}
function syncSeqButtons() {
  const mg = $('#mg'), b2b = $('#b2b');
  if (mg) { mg.classList.toggle('on', seq === 'mg'); mg.textContent = seq === 'mg' ? 'Machine-gun ■' : 'Machine-gun ▶'; }
  if (b2b) { b2b.classList.toggle('on', seq === 'b2b'); b2b.textContent = seq === 'b2b' ? '■ Stop' : '▶ Play variants back-to-back'; }
}
function machineGun() {
  if (seq === 'mg') return stopAll();
  const V = S.variants.filter(v => v.ch); if (!V.length) return toast('Nothing rendered yet');
  const iv = +$('#mgi').value / 1000, rounds = +$('#mgr').value, rnd = $('#mgo').value === 'rnd', order = [];
  for (let r = 0; r < rounds; r++) {
    if (!rnd) { order.push(...V); continue; }
    const pool = [...V];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    if (pool.length > 1 && pool[0] === order[order.length - 1]) [pool[0], pool[1]] = [pool[1], pool[0]];
    order.push(...pool);
  }
  // runtime jitter, as the game's voice manager will do it: pitch ±1 semitone (playbackRate), gain -2..0 dB
  const G = (S.target ?? PLAY_LUFS) - Math.max(...V.map(v => levelOf(v).lufs));   // one gain for the whole group
  runSeq('mg', order.map((it, i) => { const jit = -2 * Math.random(); return {it, at: i * iv, rate: 2 ** ((Math.random() * 2 - 1) / 12), gainDb: G + jit, groupDb: G, jitDb: jit}; }));
}
function backToBack() {
  if (seq === 'b2b') return stopAll();
  const V = S.variants.filter(v => v.ch); if (!V.length) return toast('Nothing rendered yet');
  const plan = []; let at = 0;
  for (const it of V) { const d = it.loop ? Math.min(2.5, bufferOf(it).duration) : bufferOf(it).duration; plan.push({it, at, dur: it.loop ? d : undefined, gainDb: it.playDb ?? 0}); at += d + .3; }
  runSeq('b2b', plan);
}

// ---------------------------------------------------------------------------------------------------- recipes
async function listRecipeFiles() {   // serve.py serves directory listings: which recipe files exist (null = unknown)
  try {
    const res = await fetch('recipes/', {cache: 'no-store'}); if (!res.ok) return null;
    const html = await res.text(); if (!/Directory listing/i.test(html)) return null;
    return [...html.matchAll(/href="([A-Za-z0-9][\w.-]*)\.js"/g)].map(m => m[1]).filter(id => id !== 'index');
  } catch { return null; }
}
async function loadAll() {
  const v = '?v=' + Date.now();   // cache-bust: a reload must see the files as they are now
  let ids = [];
  try { ids = [...(await import('./recipes/index.js' + v)).RECIPES]; }
  catch (e) { S.errors['(index)'] = errMsg(e); }
  const files = await listRecipeFiles(), listed = (files || []).filter(id => !ids.includes(id));
  const extra = (new URLSearchParams(location.search).get('extra') || '').split(',').filter(Boolean);
  S.recipes = {}; S.errors = {}; S.ids = [];
  const res = await Promise.all([...ids, ...extra, ...listed].map(async id => {
    if (files && !files.includes(id)) return [id, null, `recipes/${id}.js does not exist yet (registered in RECIPES, probably still being written)`];
    try {
      const r = (await import(`./recipes/${id}.js${v}`)).default;
      if (!r || typeof r.render !== 'function') throw new Error('default export is not a recipe (no render function)');
      return [id, r, null];
    } catch (e) { return [id, null, errMsg(e)]; }
  }));
  for (const [id, r, err] of res) {
    if (listed.includes(id) && !r) continue;   // helper modules that happen to live in recipes/
    S.ids.push(id); if (r) S.recipes[id] = r; else S.errors[id] = err;
  }
}
const casesOf = r => { const c = Object.keys(r?.cases || {}); return c.length ? c : ['default']; };
const criteriaOf = (r, cs) => r.criteria?.[cs] || r.criteria?.['*'] || {};
const allCases = () => S.ids.flatMap(id => S.recipes[id] ? casesOf(S.recipes[id]).map(cs => [id, cs]) : [[id, null]]);

// ---------------------------------------------------------------------------------------------------- nav + header
function renderNav() {
  $('#nav').innerHTML = S.ids.map(id => {
    const r = S.recipes[id];
    if (!r) return `<div class="rec missing"><div class="rid">${esc(id)}<small>not loaded</small></div><button data-rid="${esc(id)}" class="${S.rid === id ? 'sel' : ''}" title="${esc(S.errors[id])}">show error</button></div>`;
    return `<div class="rec"><div class="rid">${esc(id)}<small>v${esc(r.version ?? '?')}${r.loop ? ' · loop' : ''}</small></div><div class="cases">${casesOf(r).map(cs => {
      const rt = store.ratings[`${id}/${cs}`];
      const dot = rt ? (rt.realism ? '★' + rt.realism : '●') + (rt.recipeVersion != null && rt.recipeVersion !== r.version ? '!' : '') : '';
      return `<button class="case${S.rid === id && S.cs === cs ? ' sel' : ''}" data-rid="${esc(id)}" data-case="${esc(cs)}"><span>${esc(cs)}</span><span class="dot">${dot}</span></button>`;
    }).join('')}</div></div>`;
  }).join('') || '<div class="muted" style="padding:6px">No recipes.</div>';
  $('#nav .sel')?.scrollIntoView({block: 'nearest'});
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-rid]'); if (b) selectCase(b.dataset.rid, b.dataset.case || null); });

function renderHead() {
  const r = recipe(), head = $('#head');
  if (!r) {
    head.className = 'panel err';
    head.innerHTML = `<h2>${esc(S.rid)}</h2><p><b>This recipe didn't load.</b> It may not be written yet (other agents are working on recipes), or it throws on import.</p><div class="err">${esc(S.errors[S.rid] || 'unknown error')}</div><p class="muted">Fix the file, then press <b>Reload recipes</b>.</p>`;
    return;
  }
  head.className = 'panel';
  const cp = r.cases?.[S.cs] || {}, crit = criteriaOf(r, S.cs), stale = S.custom ? '<span class="hot">custom params</span>' : '';
  head.innerHTML = `<div class="ttl"><h2>${esc(S.rid)} / ${esc(S.cs)}</h2><span class="tags"><span>v${esc(r.version ?? '?')}</span>${r.loop ? '<span>loop</span>' : ''}<span>runtime variants ${esc(r.variants ?? '?')}</span><span>${esc(r.lufs ?? -20)} LUFS</span>${stale}</span></div>
    <div class="desc">${esc(r.desc || '')}</div>
    <div class="kv">case params: <b>${esc(JSON.stringify(S.custom || cp))}</b></div>
    ${r.notes ? `<div class="kv">notes: ${esc(r.notes)}</div>` : ''}
    <div class="crit">${Object.entries(crit).map(([k, [lo, hi]]) => `<span>${esc(k)} ${esc(lo ?? '−∞')}…${esc(hi ?? '∞')}</span>`).join('') || '<span>no pass criteria for this case</span>'}</div>
    <div class="summary" id="summary">rendering…</div>`;
}
function renderSummary() {
  const el = $('#summary'); if (!el) return;
  const V = S.variants, ok = V.filter(v => v.ch), pass = ok.filter(v => v.check?.pass).length, errs = V.filter(v => v.error).length;
  const sim = S.sim, rms = ok.map(v => v.renderMs), avg = rms.length ? rms.reduce((a, b) => a + b, 0) / rms.length : 0;
  el.innerHTML = [
    `${V.length} variants`,
    `<span class="${pass === ok.length ? 'g' : 'w'}">${pass}/${ok.length} pass</span>`,
    errs ? `<span class="w">${errs} errors</span>` : '',
    S.target != null && ok.length ? `playback <span class="${S.target < PLAY_LUFS - .05 ? 'w' : ''}">${S.target.toFixed(1)} LUFS</span>` : '',
    sim ? `similarity <span class="${sim.max > .9 ? 'w' : ''}">${sim.min.toFixed(2)}–${sim.max.toFixed(2)}</span> (mean ${sim.mean.toFixed(2)})` : '',
    rms.length ? `render avg <span class="${avg > 20 && !recipe()?.loop ? 'w' : ''}">${avg.toFixed(1)} ms</span>` : '',
  ].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------------------------------------------- params panel
function renderParams() {
  const r = recipe(), box = $('#pbody'), det = $('#params');
  det.hidden = !r || !Object.keys(r.params || {}).length; if (det.hidden) return;
  const p = S.custom || {...defaults(r), ...(r.cases?.[S.cs] || {})};
  box.innerHTML = `<div class="pgrid">${Object.entries(r.params).map(([k, d]) => {
    if (d.values) return `<label>${esc(k)}<span class="v"></span><select data-p="${esc(k)}">${d.values.map(v => `<option${String(v) === String(p[k]) ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
    const min = d.min ?? 0, max = d.max ?? 1, span = max - min, ints = Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(d.def ?? min) && span >= 10;
    const step = d.step ?? (ints ? 1 : +(span / 200).toPrecision(2));
    return `<label>${esc(k)}<span class="v">${esc(p[k])}</span><input type="range" data-p="${esc(k)}" min="${min}" max="${max}" step="${step}" value="${esc(p[k] ?? d.def ?? min)}"></label>`;
  }).join('')}</div>
  <div class="pbtns"><button id="prender" class="on">Render with these params</button><button id="preset">Reset to case</button><small class="hint" style="align-self:center">${S.custom ? 'Showing custom params; ratings made now record them.' : 'Defaults merged with this case.'}</small></div>`;
  box.oninput = e => { const i = e.target.closest('input[type=range]'); if (i) i.parentElement.querySelector('.v').textContent = i.value; };
  $('#prender').onclick = () => {
    const o = {};
    for (const el of $$('[data-p]', box)) { const d = r.params[el.dataset.p]; o[el.dataset.p] = d.values ? d.values.find(v => String(v) === el.value) ?? el.value : +el.value; }
    S.custom = o; renderHead(); renderParams(); renderCase();
  };
  $('#preset').onclick = () => { S.custom = null; renderHead(); renderParams(); renderCase(); };
}

// ---------------------------------------------------------------------------------------------------- cards
const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); queueDraw(e.target); } }, {rootMargin: '300px'});
const drawQ = []; let drawing = false;
function queueDraw(cv) { drawQ.push(cv); if (!drawing) drainDraw(); }
async function drainDraw() {   // spectrograms on demand, one per task so the page stays responsive
  drawing = true;
  while (drawQ.length) {
    const cv = drawQ.shift(), it = cv.__item;
    if (it?.ch && cv.isConnected) {
      try { const img = spectrogramImage(it.ch, it.sr, {width: cv.width, height: cv.height}); cv.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0); it.drawn = true; }
      catch (e) { const q = cv.getContext('2d'); q.fillStyle = '#e07a5f'; q.font = '14px monospace'; q.fillText('spectrogram failed: ' + errMsg(e), 8, 20); }
    }
    await tick();
  }
  drawing = false;
}
function drawRest() { for (const it of [...S.variants, ...S.refs]) if (it.ch && !it.drawn && it.el && !drawQ.includes($('canvas', it.el))) { const cv = $('canvas', it.el); io.unobserve(cv); queueDraw(cv); } }
function cardFor(it) {
  const el = document.createElement('article'); el.className = 'card ' + it.kind; el.tabIndex = 0; it.el = el;
  el.innerHTML = `<div class="hd"><button class="play" title="Play / stop (Space)" disabled>▶</button><span class="name" title="${esc(it.path || it.label)}">${esc(it.label)}</span><span class="badge">…</span>${it.extra ? '<button class="x" title="Remove this reference">×</button>' : ''}</div>
    <div class="spec"><canvas width="480" height="176"></canvas><div class="ph" hidden></div></div><div class="body"><div class="foot">${it.kind === 'ref' ? 'decoding…' : 'waiting…'}</div></div>`;
  el.addEventListener('focus', () => setFocus(it));
  $('.play', el).onclick = e => { e.stopPropagation(); setFocus(it); toggle(it); };
  $('.spec', el).onclick = () => { setFocus(it); toggle(it); };
  if (it.extra) $('.x', el).onclick = e => { e.stopPropagation(); removeExtraRef(it.path); };
  return el;
}
function setFocus(it) { if (S.focus === it) return; S.focus?.el?.classList.remove('focus'); S.focus = it; it?.el?.classList.add('focus'); }
function fillCard(it) {
  const el = it.el; if (!el) return;
  const badge = $('.badge', el), body = $('.body', el);
  if (it.error) {
    badge.className = 'badge error'; badge.textContent = 'ERROR';
    body.innerHTML = `<div class="err">${esc(it.error)}</div>`; return;
  }
  $('.play', el).disabled = false;
  const m = it.metrics, fails = it.check?.fails || [], bad = new Set(fails.map(f => f.split(/[ :]/)[0]));
  if (it.kind === 'ref') { badge.className = 'badge ref'; badge.textContent = it.extra ? 'REF +' : 'REF'; }
  else { badge.className = 'badge ' + (it.check.pass ? 'pass' : 'fail'); badge.textContent = it.check.pass ? 'PASS' : `FAIL ${fails.length}`; }
  const cell = (keys, label, val) => { const b = [].concat(keys).some(k => bad.has(k)) ? ' class="bad"' : ''; return `<span${b}>${label}</span><b${b}>${val}</b>`; };
  body.innerHTML = `<div class="m">
      ${cell('lufsM', 'LUFS-M', m.lufsM)}${cell('truePeakDb', 'true pk', m.truePeakDb + ' dB')}
      ${cell('attackMs', 'attack', m.attackMs + ' ms')}${cell('t60Ms', 'T60', m.t60Ms == null ? 'n/a' : m.t60Ms + ' ms')}
      ${cell(['centroidHz', 'rolloffHz'], 'centroid', hz(m.centroidHz) + ' Hz')}${cell(['lowHz', 'highHz'], 'band', hz(m.lowHz) + '–' + hz(m.highHz))}
      ${cell(['onsetCount', 'onsetRate'], 'onsets', m.onsets.length)}${cell('durMs', 'dur', m.durMs + ' ms')}
    </div>
    ${fails.length ? `<div class="fails">✗ ${fails.map(esc).join('<br>✗ ')}</div>` : ''}
    <div class="foot">${footOf(it)}</div>`;
  const cv = $('canvas', el); cv.__item = it; if (!it.drawn) io.observe(cv);
}
function playTag(it) {
  if (it.playDb == null) return '';
  const v = it.lvl.lufs + it.playDb;
  return `<span title="plays at this momentary-max loudness (gain ${it.playDb >= 0 ? '+' : ''}${it.playDb.toFixed(1)} dB); the whole case plays at one level" class="${v < PLAY_LUFS - .05 ? 'w' : ''}">play ${v.toFixed(1)} LUFS</span>`;
}
function footOf(it) {
  const s = it.sim ? `sim ${it.sim.min.toFixed(2)}–${it.sim.max.toFixed(2)}` : '';
  if (it.kind === 'ref') return `${playTag(it)}<span>matched ${it.gainDb > 0 ? '+' : ''}${it.gainDb} dB · ${it.nch}ch</span><span title="spectral similarity to the forge variants">${s ? s.replace('sim', 'vs forge') : ''}</span>`;
  const slow = it.renderMs > 20 && !it.loop;
  return `${playTag(it)}<span>render <span class="${slow ? 'w' : ''}">${it.renderMs.toFixed(1)} ms</span> · bake ${it.bakeMs.toFixed(0)} ms</span><span title="spectral similarity to the other variants"${it.sim && it.sim.max > .9 ? ' class="w"' : ''}>${s}</span>`;
}

// ---------------------------------------------------------------------------------------------------- render a case
async function renderCase() {
  const tok = ++S.token, r = recipe();
  stopAll(); S.sim = null; S.target = null; S.ab = null; S.focus = null;
  $('#variants').innerHTML = ''; $('#refs').innerHTML = ''; $('#refadd').innerHTML = '';
  $('#gridview').hidden = !r || S.mode !== 'grid'; $('#abview').hidden = !r || S.mode !== 'ab'; $('#bar').hidden = !r; $('#rating').hidden = !r;
  if (!r) { S.variants = []; S.refs = []; setStatus(); return; }
  $('#mg').disabled = !!r.loop; $('#mg').title = r.loop ? 'Loop recipe: machine-gun does not apply' : 'Fire every variant in a row with runtime jitter (pitch ±1 st, gain −2..0 dB)';
  const seeds = Array.from({length: S.n}, (_, i) => S.seedBase + i);
  $('#seedinfo').textContent = `seeds ${seeds[0]}–${seeds[seeds.length - 1]}`;
  S.variants = seeds.map(seed => ({kind: 'forge', seed, label: `seed ${seed}`, loop: !!r.loop}));
  S.refs = [];
  for (const v of S.variants) $('#variants').append(cardFor(v));
  setFocus(S.variants[0]);
  let finish; S.done = new Promise(res => finish = res); S.busy = true;
  const rec = S.custom ? {...r, cases: {...(r.cases || {}), [S.cs]: S.custom}} : r;
  const sr = S.sr;
  for (const [i, v] of S.variants.entries()) {
    await tick(); if (tok !== S.token) return finish();
    setStatus(`rendering ${i + 1}/${S.variants.length}`);
    let renderMs = 0;
    const timed = {...rec, render(p, R, rate) { const t = performance.now(); try { return r.render.call(r, p, R, rate); } finally { renderMs = performance.now() - t; } }};
    const t0 = performance.now();
    try {
      const b = bake(timed, S.cs === 'default' && !r.cases?.default ? undefined : S.cs, v.seed, sr);
      if (!b.metrics || !Number.isFinite(b.metrics.durMs)) throw new Error('render returned no audio');
      Object.assign(v, {ch: b.ch, sr, metrics: b.metrics, check: b.check, gainDb: b.gainDb, params: b.params, renderMs, bakeMs: performance.now() - t0, nch: Array.isArray(b.ch) ? b.ch.length : 1});
    } catch (e) { v.error = `render failed: ${errMsg(e)}`; }
    fillCard(v);
  }
  // variant similarity (spectral profiles; >0.9 means the variants will sound like the same sample)
  await tick(); if (tok !== S.token) return finish();
  const ok = S.variants.filter(v => v.ch);
  for (const v of ok) v.prof = spectrumProfile(v.ch, v.sr);
  let all = [];
  for (const v of ok) {
    const s = ok.filter(o => o !== v).map(o => similarity(v.prof, o.prof));
    if (s.length) { v.sim = {min: Math.min(...s), max: Math.max(...s)}; all.push(...s); }
    $('.foot', v.el).innerHTML = footOf(v);
  }
  S.sim = all.length ? {min: Math.min(...all), max: Math.max(...all), mean: all.reduce((a, b) => a + b, 0) / all.length} : null;
  computeLevels(); renderSummary(); setStatus('refs…');
  await loadRefs(tok);
  if (tok === S.token) { computeLevels(); renderSummary(); }
  if (tok !== S.token) return finish();
  S.busy = false; setStatus(); finish();
  // background fill: spectrograms still off-screen get drawn now (one per task), so scrolling finds them ready
  drawRest();
  if (S.mode === 'ab') renderAB();
}

// ---------------------------------------------------------------------------------------------------- references
const refCache = new Map();   // `${path}@${sr}` -> Promise<{chans, nch}>
function decodeRef(path, sr) {
  const k = `${path}@${sr}`;
  if (!refCache.has(k)) refCache.set(k, (async () => {
    const res = await fetch(rootUrl(path)); if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const b = await new OfflineAudioContext(1, 1, sr).decodeAudioData(await res.arrayBuffer());
    const chans = []; for (let c = 0; c < Math.min(2, b.numberOfChannels); c++) chans.push(b.getChannelData(c).slice());
    return {chans, nch: b.numberOfChannels};
  })());
  const p = refCache.get(k); p.catch(() => refCache.delete(k)); return p;
}
function refsFor() {
  const r = recipe(), own = (r?.refs?.[S.cs] || []).map(path => ({path, extra: false}));
  const add = (extraRefs[caseKey()] || []).filter(p => !own.some(o => o.path === p)).map(path => ({path, extra: true}));
  return [...own, ...add];
}
async function loadRefs(tok) {
  const r = recipe(), sr = S.sr, target = r.lufs ?? -20;
  renderRefAdd();
  const list = refsFor();
  if (!list.length) { $('#refs').innerHTML = `<div class="muted" style="font-size:13px">No reference takes for this case${r.refs ? '' : ' (the recipe has no <code>refs</code>)'}. Add one above to compare by ear and in A/B.</div>`; return; }
  $('#refs').innerHTML = '';
  S.refs = list.map(({path, extra}) => ({kind: 'ref', path, extra, label: baseName(path), loop: !!r.loop}));
  for (const it of S.refs) $('#refs').append(cardFor(it));
  const ok = S.variants.filter(v => v.prof);
  for (const it of S.refs) {
    try {
      const {chans, nch} = await decodeRef(it.path, sr);
      if (tok !== S.token) return;
      // loudness-match to the forge output: momentary-max LUFS to the recipe target, sample peak capped at -1.2 dB
      const ch = chans.map(c => c.slice()), x = ch.length === 1 ? ch[0] : ch, cl = lufsMomentaryMax(x, sr);
      let g = Number.isFinite(cl) ? dbToGain(target - cl) : 1, pk = 0;
      for (const c of ch) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
      if (pk * g > dbToGain(-1.2)) g = dbToGain(-1.2) / pk;
      for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= g;
      await tick(); if (tok !== S.token) return;
      Object.assign(it, {ch: x, sr, nch, gainDb: +(20 * Math.log10(g)).toFixed(1), metrics: analyze(x, sr), check: {pass: true, fails: []}});
      it.prof = spectrumProfile(x, sr);
      const s = ok.map(v => similarity(it.prof, v.prof)); if (s.length) it.sim = {min: Math.min(...s), max: Math.max(...s)};
    } catch (e) { if (tok !== S.token) return; it.error = `decode failed: ${errMsg(e)}`; }
    fillCard(it);
  }
}
let refOptions = null;
async function refChoices() {   // every take the project has: assets/sfx/index.json + the prepared refs in audio/forge/refs
  if (refOptions) return refOptions;
  const out = [];
  try { const idx = await (await fetch(rootUrl('assets/sfx/index.json'), {cache: 'no-store'})).json(); for (const [id, e] of Object.entries(idx.sounds || {})) for (const f of e.files || []) out.push({group: 'assets/sfx · ' + id, path: 'assets/sfx/' + f}); } catch {}
  try { const html = await (await fetch('refs/', {cache: 'no-store'})).text(); for (const m of html.matchAll(/href="([^"/]+\.(?:wav|mp3|ogg))"/g)) out.push({group: 'audio/forge/refs', path: 'audio/forge/refs/' + decodeURIComponent(m[1])}); } catch {}
  return refOptions = out;
}
async function renderRefAdd() {
  const el = $('#refadd'), opts = await refChoices(), have = new Set(refsFor().map(r => r.path));
  const groups = [...new Set(opts.map(o => o.group))];
  el.innerHTML = `<span>Compare with another take:</span><select id="refsel"><option value="">choose a take…</option>${groups.map(g => `<optgroup label="${esc(g)}">${opts.filter(o => o.group === g).map(o => `<option value="${esc(o.path)}"${have.has(o.path) ? ' disabled' : ''}>${esc(baseName(o.path))}</option>`).join('')}</optgroup>`).join('')}</select><small class="hint">Remembered per case in this browser.</small>`;
  $('#refsel').onchange = e => { if (e.target.value) addExtraRef(e.target.value); };
}
function addExtraRef(path) { const k = caseKey(); (extraRefs[k] ||= []).includes(path) || extraRefs[k].push(path); ls.set(EXTRA_KEY, extraRefs); reloadRefs(); }
function removeExtraRef(path) { const k = caseKey(); extraRefs[k] = (extraRefs[k] || []).filter(p => p !== path); if (!extraRefs[k].length) delete extraRefs[k]; ls.set(EXTRA_KEY, extraRefs); reloadRefs(); }
async function reloadRefs() { stopAll(); S.ab = null; const tok = S.token; await S.done; if (tok !== S.token) return; await loadRefs(tok); if (tok !== S.token) return; computeLevels(); renderSummary(); drawRest(); if (S.mode === 'ab') renderAB(); }

// ---------------------------------------------------------------------------------------------------- ratings
function rate(field, value) {
  const r = recipe(); if (!r) return;
  const k = caseKey(), e = store.ratings[k] ||= {recipe: S.rid, case: S.cs};
  if (e[field] === value) delete e[field]; else e[field] = value;   // clicking the chosen value again clears it
  stamp(e); saveStore(); renderRating(); renderNav();
}
function stamp(e) {
  const r = recipe(), ok = S.variants.filter(v => v.ch);
  e.recipeVersion = r.version ?? null; e.ts = new Date().toISOString();
  e.seeds = S.variants.map(v => v.seed);
  e.pass = `${ok.filter(v => v.check?.pass).length}/${ok.length}`;
  if (S.sim) e.similarity = [+S.sim.min.toFixed(3), +S.sim.max.toFixed(3)]; else delete e.similarity;
  if (S.custom) e.params = {...S.custom}; else delete e.params;
}
function renderRating() {
  const r = recipe(), el = $('#rating'); if (!r) return;
  const e = store.ratings[caseKey()] || {};
  const seg = (f, vals, labels = vals) => `<span class="seg" data-f="${f}">${vals.map((v, i) => `<button data-v="${v}" class="${e[f] === v ? 'on' : ''}">${labels[i]}</button>`).join('')}</span>`;
  const stale = e.ts && e.recipeVersion != null && e.recipeVersion !== r.version;
  el.innerHTML = `<div class="rate">
    <span class="lbl">Realism</span><div class="row">${seg('realism', [1, 2, 3, 4, 5])}<small class="hint">keys 1–5 · 1 = obviously synthetic, 5 = could be a recording</small></div>
    <span class="lbl">Fits the game</span><div class="row">${seg('fit', [1, 2, 3, 4, 5])}<small class="hint">for a 2.5D pixel-art roguelike</small></div>
    <span class="lbl">Repetition</span><div class="row"><button id="b2b">▶ Play variants back-to-back</button><span class="muted" style="font-size:13px">feels repetitive?</span>${seg('repetitive', [true, false], ['yes', 'no'])}</div>
    <span class="lbl">Note</span><textarea id="note" placeholder="What sounds wrong or right? (e.g. too clicky, ring too long, plastic)">${esc(e.note || '')}</textarea>
    <div class="saved" id="saved">${savedLine(e, stale)}</div></div>`;
  $$('.seg[data-f] button', el).forEach(b => b.onclick = () => { const f = b.parentElement.dataset.f, v = b.dataset.v; rate(f, f === 'repetitive' ? v === 'true' : +v); });
  $('#b2b').onclick = backToBack; syncSeqButtons();
  let t = 0; $('#note').oninput = ev => { clearTimeout(t); t = setTimeout(() => saveNote(ev.target.value), 350); };
  $('#note').onchange = ev => { clearTimeout(t); saveNote(ev.target.value); };
}
function saveNote(text) {
  const k = caseKey(), e = store.ratings[k] ||= {recipe: S.rid, case: S.cs}, v = text.trim();
  if ((e.note || '') === v) return;
  if (v) e.note = v; else delete e.note;
  stamp(e); saveStore(); $('#saved').innerHTML = savedLine(e, false); renderNav();
}
function savedLine(e, stale) {
  if (!e.ts) return 'not rated yet · saved automatically';
  return `saved ${new Date(e.ts).toLocaleString()} · recipe v${esc(e.recipeVersion)}${e.params ? ' · custom params' : ''}${stale ? ` · <span class="w">recipe is now v${esc(recipe().version)}: re-rate</span>` : ''}`;
}

// ---------------------------------------------------------------------------------------------------- blind A/B
function abTally(k) { return store.ab[k] ||= {forgeVsRef: {forge: 0, ref: 0, same: 0}, forgeVsForge: {n: 0, same: 0, wins: {}}, trials: []}; }
const describe = it => it.kind === 'ref' ? `reference ${it.path}` : `forge seed ${it.seed}${S.custom ? ' (custom params)' : ''}`;
function newPair() {
  const V = S.variants.filter(v => v.ch), R = S.refs.filter(r => r.ch), mode = $('#abmode')?.value || 'mix';
  const pick = a => a[Math.floor(Math.random() * a.length)];
  let pair = null;
  const canRef = V.length && R.length, canFF = V.length > 1;
  if (mode === 'ref' ? canRef : mode === 'ff' ? false : canRef && (!canFF || Math.random() < .6)) pair = [pick(V), pick(R)];
  else if (canFF) { const i = Math.floor(Math.random() * V.length); let j = Math.floor(Math.random() * (V.length - 1)); if (j >= i) j++; pair = [V[i], V[j]]; }
  if (!pair) { S.ab = null; return; }
  if (Math.random() < .5) pair.reverse();
  const T = groupTarget(pair);   // both sides at one level (the lower reachable one if a peak cap binds)
  S.ab = {A: pair[0], B: pair[1], answered: null, heard: {A: false, B: false}, target: T, gainDb: {A: T - levelOf(pair[0]).lufs, B: T - levelOf(pair[1]).lufs}};
}
function abPlay(side) {
  const p = S.ab; if (!p) return;
  if (cur?.it === p[side]) return stopAll();
  play(p[side], {loop: false, gainDb: p.gainDb[side]}); p.heard[side] = true;
  $$('.abplay button').forEach(b => { const s = b.dataset.s; b.classList.toggle('heard', p.heard[s]); b.classList.toggle('on', s === side); });
  cur.src.addEventListener('ended', () => $$('.abplay button').forEach(b => b.classList.remove('on')));
}
function abAnswer(pick) {
  const p = S.ab; if (!p || p.answered) return;
  stopAll(); p.answered = pick;
  const t = abTally(caseKey()), r = recipe(), sides = {A: p.A, B: p.B};
  const refSide = p.A.kind === 'ref' ? 'A' : p.B.kind === 'ref' ? 'B' : null;
  let winner;
  if (refSide) { winner = pick === 'same' ? 'same' : pick === refSide ? 'ref' : 'forge'; t.forgeVsRef[winner]++; }
  else { t.forgeVsForge.n++; if (pick === 'same') { t.forgeVsForge.same++; winner = 'same'; } else { const s = sides[pick].seed; t.forgeVsForge.wins[s] = (t.forgeVsForge.wins[s] || 0) + 1; winner = 'seed ' + s; } }
  const note = $('#abnote').value.trim();
  t.trials.push({ts: new Date().toISOString(), recipeVersion: r.version ?? null, A: describe(p.A), B: describe(p.B), pick, winner, ...(note ? {note} : {})});
  t.recipeVersion = r.version ?? null;
  saveStore(); renderAB();
}
function renderAB() {
  const el = $('#abview'); if (!recipe()) return;
  if (!S.ab && !S.busy) newPair();
  const p = S.ab, k = caseKey(), t = store.ab[k], mode = $('#abmode')?.value || 'mix';
  const pickLabel = {A: 'A sounds more real', same: 'Same', B: 'B sounds more real'};
  el.innerHTML = `<h2>Blind A/B · ${esc(k)}</h2>
    <p class="muted" style="margin:6px 0 0;font-size:13px">Two sounds, identities hidden until you answer. Both play at the same loudness (${S.ab ? S.ab.target.toFixed(1) : PLAY_LUFS} LUFS momentary max), so pick on character, not level.</p>
    <div class="abrow"><label>pairs <select id="abmode"><option value="mix">mixed</option><option value="ref">forge vs reference</option><option value="ff">forge vs forge</option></select></label><button id="abnext">New pair</button></div>
    ${S.busy ? '<p class="muted">Rendering… the pair appears when the case is ready.</p>' : !p ? `<p class="muted">Not enough sounds for this pairing: ${mode === 'ref' || !S.refs.some(r => r.ch) ? 'add a reference take (Variants view) or ' : ''}render at least two variants.</p>` : `
    <div class="abrow abplay"><button data-s="A">▶ A</button><button data-s="B">▶ B</button></div>
    <div class="abrow abans">${['A', 'same', 'B'].map(x => `<button data-p="${x}"${p.answered ? ' disabled' : ''} class="${p.answered === x ? 'on' : ''}">${pickLabel[x]}</button>`).join('')}</div>
    <div class="abrow"><input id="abnote" placeholder="optional note (saved with this answer)"${p.answered ? ' disabled' : ''}></div>
    ${p.answered ? `<div class="reveal">A was <b>${esc(describe(p.A))}</b><br>B was <b>${esc(describe(p.B))}</b><br>you picked: ${esc(pickLabel[p.answered])}</div>` : '<div class="reveal muted">Listen to both (keys A and B), then answer. The answer reveals which is which.</div>'}`}
    <div class="tally">${tallyText(t)}</div>`;
  $('#abmode').value = mode;
  $('#abmode').onchange = () => { S.ab = null; renderAB(); };
  $('#abnext').onclick = () => { stopAll(); S.ab = null; renderAB(); };
  $$('.abplay button', el).forEach(b => b.onclick = () => abPlay(b.dataset.s));
  $$('.abans button', el).forEach(b => b.onclick = () => abAnswer(b.dataset.p));
}
function tallyText(t) {
  if (!t || !t.trials.length) return 'No answers for this case yet.';
  const r = t.forgeVsRef, f = t.forgeVsForge, nr = r.forge + r.ref + r.same;
  const wins = Object.entries(f.wins).sort((a, b) => b[1] - a[1]).map(([s, n]) => `seed ${s}×${n}`).join(', ');
  return `Tally (${t.trials.length} answers)<br>forge vs reference: forge more real <b>${r.forge}</b> · reference <b>${r.ref}</b> · same <b>${r.same}</b>${nr ? ` · forge “passes” ${Math.round((r.forge + r.same) / nr * 100)}%` : ''}<br>forge vs forge: <b>${f.n}</b> pairs · same <b>${f.same}</b>${wins ? ' · preferred: ' + esc(wins) : ''}`;
}

// ---------------------------------------------------------------------------------------------------- export
function exportData() {
  return {
    kind: 'forge-ratings', schema: 1, exported: new Date().toISOString(), storageKey: KEY, sampleRate: S.sr,
    help: 'ratings[recipe/case]: realism & fit 1-5, repetitive true/false (heard back-to-back), note. seeds/pass/similarity are the render the user heard. ab[recipe/case]: blind A/B tallies + trials. Compare recipeVersion with recipes[id].version: older ratings are stale.',
    recipes: Object.fromEntries(S.ids.filter(id => S.recipes[id]).map(id => [id, {version: S.recipes[id].version ?? null, cases: casesOf(S.recipes[id])}])),
    ratings: store.ratings, ab: store.ab,
  };
}
const exportText = () => JSON.stringify(exportData(), null, 2);
function download() {
  const url = URL.createObjectURL(new Blob([exportText()], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = 'forge-ratings.json'; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast(`Exported ${Object.keys(store.ratings).length} ratings`);
}
async function copyJSON() {
  const txt = exportText();
  try { await navigator.clipboard.writeText(txt); }
  catch {
    const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); if (!ok) return toast('Copy failed: use Export instead', true);
  }
  toast('Ratings JSON copied');
}

// ---------------------------------------------------------------------------------------------------- navigation
function selectCase(rid, cs, {push = true} = {}) {
  stopAll();
  const r = S.recipes[rid];
  if (r && (!cs || !casesOf(r).includes(cs))) cs = casesOf(r)[0];
  S.rid = rid; S.cs = r ? cs : null; S.custom = null; S.ab = null;
  if (push) history.replaceState(null, '', '#' + encodeURIComponent(rid) + (S.cs ? '/' + encodeURIComponent(S.cs) : ''));
  renderNav(); renderHead(); renderParams(); renderRating(); renderCase();
}
function stepCase(d) {
  const list = allCases(); if (!list.length) return;
  let i = list.findIndex(([id, cs]) => id === S.rid && (cs === S.cs || cs === null));
  i = (i + d + list.length) % list.length; selectCase(list[i][0], list[i][1]);
}
function setMode(m) {
  S.mode = m; stopAll();
  $$('#mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  const r = recipe(); $('#gridview').hidden = !r || m !== 'grid'; $('#abview').hidden = !r || m !== 'ab';
  if (m === 'ab') { S.ab = null; renderAB(); }
}
$('#mode').onclick = e => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); };
$('#n').onchange = e => { S.n = Math.max(1, Math.min(16, Math.round(+e.target.value) || 6)); e.target.value = S.n; renderCase(); };
$('#reroll').onclick = () => { S.seedBase = 1 + Math.floor(Math.random() * 99990); renderCase(); };
$('#mg').onclick = machineGun;
$('#mgi').oninput = e => $('#mgv').textContent = e.target.value + ' ms';
$('#stop').onclick = stopAll;
$('#export').onclick = download;
$('#copy').onclick = copyJSON;
$('#reload').onclick = async () => { stopAll(); toast('Reloading recipes…'); await loadAll(); const rid = S.recipes[S.rid] || S.errors[S.rid] ? S.rid : S.ids[0]; selectCase(rid, S.cs); toast(`${Object.keys(S.recipes).length} recipes loaded`); };

addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest?.('input,textarea,select')) { if (e.key === 'Escape') t.blur(); return; }
  if (e.key === ' ' || e.code === 'Space') {
    if (t.closest?.('button') && !t.closest('.card')) return;   // let Space press ordinary buttons
    e.preventDefault();
    if (S.mode === 'ab') { if (cur) stopAll(); else if (S.ab) abPlay(S.ab.heard.A && !S.ab.heard.B ? 'B' : 'A'); return; }
    const it = t.closest?.('.card') ? [...S.variants, ...S.refs].find(x => x.el === t.closest('.card')) : S.focus;
    if (it) toggle(it); else stopAll();
  } else if (/^[1-5]$/.test(e.key)) { e.preventDefault(); rate('realism', +e.key); toast(`Realism ${store.ratings[caseKey()]?.realism ?? 'cleared'}`); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); stepCase(e.key === 'ArrowLeft' ? -1 : 1); }
  else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && S.mode === 'grid') {
    const items = [...S.variants, ...S.refs].filter(x => x.el); if (!items.length) return;
    e.preventDefault(); const i = items.indexOf(S.focus), n = items[(i + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length];
    n.el.focus({preventScroll: false}); setFocus(n); n.el.scrollIntoView({block: 'nearest'});
  } else if (e.key === 'Escape') stopAll();
  else if (S.mode === 'ab' && (e.key === 'a' || e.key === 'b')) abPlay(e.key.toUpperCase());
});
addEventListener('hashchange', () => { const [rid, cs] = location.hash.slice(1).split('/').map(decodeURIComponent); if (rid && (rid !== S.rid || cs !== S.cs) && S.ids.includes(rid)) selectCase(rid, cs, {push: false}); });

// ---------------------------------------------------------------------------------------------------- boot
window.__lab = {S, store, exportData, exportText, selectCase, setMode, rate, newPair, abAnswer, ready: null, get ac() { return ac; }, get cur() { return cur; }};
window.__lab.ready = (async () => {
  setStatus('loading recipes');
  await loadAll();
  if (S.errors['(index)']) $('#fatal').innerHTML = `<section class="panel err"><b>recipes/index.js failed to load.</b><div class="err">${esc(S.errors['(index)'])}</div></section>`;
  const [hr, hc] = location.hash.slice(1).split('/').map(s => s && decodeURIComponent(s));
  const first = S.ids.find(id => S.recipes[id]) || S.ids[0];
  if (!first) { renderNav(); $('#head').innerHTML = '<p class="muted">No recipes found in recipes/.</p>'; ['#bar', '#rating', '#params', '#gridview'].forEach(s => $(s).hidden = true); setStatus(); return; }
  selectCase(S.ids.includes(hr) ? hr : first, hc);
  await S.done;
})();
