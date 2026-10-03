// DIRECTOR: the glue between game events, the event data (events.js), the bakery and the engine.
// audio/runtime/CONTRACT.md, docs/AUDIO.md §3.
//
//   const D = createDirector(engine, bakery, {EVENTS, AMBIENCE});   // SPATIAL / SOURCES / AMB_RULES default to events.js
//   D.prefetch({biome, allBiomes})  request every bank EVENTS use, ordered by bakePriority, and the current biome's
//                                  ambience early (other biomes lazily on arrival, or last with allBiomes); returns the list.
//                                  skip(recipe, case) -> true leaves an event bank out (it bakes when a post picks it):
//                                  the gun-sound flavors that aren't playing (events.js otherGunSfx)
//   D.post(name, params) -> bool   false = the bank isn't baked (or the name is unknown): the caller plays its legacy sound.
//                                  true = handled, which includes "culled because its source is off-screen"
//                                  params: {pan, dist | d, off, at, x, y, mat, surf, kind, k, g, n, small, big, ...}
//   D.ambience.update({biome, time, stream: {prox, pan}, sources: [{kind, id, x, y, pan, d, off}], combat, gust?, dt})
//   D.makeCreak() -> {set(k, rate, t, dt), stop(t)} | null             the bow-draw creak (same shape as audio.js makeCreak)
//   D.makeRoll()  -> {set(speed, pan, d, t, dt, off?), stop(t)} | null   the rolling barrel (same shape as audio.js makeRoll)
//   D.ready(name, params?) -> bool, D.stats
//
// SCREEN-BOUND AUDIBILITY (phase 3): what you hear should be on screen. Every post reads `off` (metres beyond the view
// edge, 0 = on screen) and applies its event category's rule from SPATIAL (events.js): world sounds fade 6 dB/m and are
// culled 2 m off-screen, combat 3 dB/m + a closing low-pass, culled at 6 m; player and UI sounds are never touched.
// Ambience has no random close one-shots any more: beds are continuous and quiet, the only random calls are rare,
// far-off, low-passed and panned wide, under a global budget; visible torches / braziers get positional fire loops.
//
// Variation: each post picks a baked variant at random, never one of the last two played from that bank, then adds
// the event's pitch jitter (±pitchSemi, as playbackRate) and gain jitter (±gainJitDb). Layers ride on the first one:
// if the FIRST layer's bank (or its `alt`) is missing the post fails (fallback); a missing later layer is skipped.

import {SPATIAL as SPATIAL0, SOURCES as SOURCES0, AMB_RULES as RULES0, AMB_PRIORITY as AMBP0} from './events.js';

const DB = db => Math.pow(10, db / 20);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export function createDirector(engine, bakery, {EVENTS = {}, AMBIENCE = {}, SPATIAL = SPATIAL0, SOURCES = SOURCES0, AMB_RULES = RULES0,
  AMB_PRIORITY = AMBP0, rng = Math.random, ac = engine?.ac ?? null, now: clockFn = null} = {}) {
  const rnd = () => rng();
  const sym = a => (rnd() * 2 - 1) * a;                         // uniform ±a
  const audioNow = () => ac ? ac.currentTime : 0;
  const wall = clockFn || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);   // cooldowns
  const st = {posted: 0, played: 0, fallback: 0, unknown: 0, cooldown: 0, culled: 0, layersSkipped: 0, alts: 0, errors: 0,
    byName: {}, missing: {}, screen: {world: {faded: 0, culled: 0}, combat: {faded: 0, culled: 0}},
    calls: 0, callsDeferred: 0, bedsStarted: 0, bedsStopped: 0, sourcesStarted: 0, sourcesStopped: 0, sourcesCulled: 0};

  // ---------------------------------------------------------------- banks
  const keyOf = (r, c) => r + ':' + c;
  const requested = new Map();     // bank key -> priority requested at
  const failed = new Set();        // banks whose bake failed (e.g. a recipe or case that doesn't exist yet)
  const bankInfo = new Map();      // bank key -> {variants} (max over the events that use it)
  for (const ev of Object.values(EVENTS)) for (const [r, c] of ev.banks || []) {
    const k = keyOf(r, c), v = ev.variants ?? null, have = bankInfo.get(k);
    bankInfo.set(k, {variants: have ? Math.max(have.variants ?? 0, v ?? 0) || null : v});
  }
  function request(recipe, c, priority = 5, variants) {
    const k = keyOf(recipe, c), have = requested.get(k);
    if (failed.has(k) || (have != null && have <= priority)) return;
    requested.set(k, priority);
    try { bakery.request(recipe, c, {variants: variants ?? bankInfo.get(k)?.variants ?? null, priority})?.catch?.(() => failed.add(k)); }
    catch (e) { st.errors++; }
  }
  const getBank = (recipe, c) => { const b = bakery.get(recipe, c); return b && b.buffers && b.buffers.length ? b : null; };

  // avoid-last-2 variant choice, per bank
  const hist = new Map();
  function chooseVariant(bankKey, n) {
    if (n <= 1) return 0;
    const h = hist.get(bankKey) || [];
    const avoid = n > 2 ? h.slice(-2) : h.slice(-1);
    const free = [];
    for (let i = 0; i < n; i++) if (!avoid.includes(i)) free.push(i);
    const v = free[Math.floor(rnd() * free.length) % free.length];
    h.push(v); if (h.length > 2) h.shift(); hist.set(bankKey, h);
    return v;
  }

  // ---------------------------------------------------------------- screen-bound audibility
  // -> {cull} | {db, lpf, minDist, maxDist} for a category, from the source's metres off-screen
  function screenRule(cat, off) {
    const R = cat && SPATIAL[cat];
    if (!R) return {cull: false, db: 0, lpf: null};
    off = Math.max(0, +off || 0);
    if (off > R.cullOff) return {cull: true};
    return {cull: false, db: -R.fadeDbPerM * off, lpf: off > 0 ? Math.max(R.lpf[2], R.lpf[0] * Math.pow(R.lpf[1], off)) : null,
      minDist: R.minDist, maxDist: R.maxDist, faded: off > 0};
  }
  // the same, for loops (the engine's loop() takes no minDist): distance attenuation computed here, loop played at dist 0
  function loopSpatial(cat, off, d) {
    const r = screenRule(cat, off); if (r.cull) return r;
    const minD = r.minDist ?? 2, dd = Math.max(0, +d || 0);
    return {...r, db: r.db + (dd <= minD ? 0 : -20 * Math.log10(dd / minD))};
  }

  // ---------------------------------------------------------------- post
  const lastPost = {};
  const asLayers = x => (Array.isArray(x) ? x : x ? [x] : []);
  const rangeOf = x => (Array.isArray(x) ? x[0] + rnd() * (x[1] - x[0]) : x || 0);
  function pickLayers(ev, p) { try { return asLayers(ev.pick ? ev.pick(p, rnd) : ev.layers); } catch (e) { st.errors++; return []; } }
  // a layer -> the playable layers: itself if baked, else its `alt` layers that are baked (requesting what is missing)
  function resolve(l, prio) {
    const b = getBank(l.recipe, l.case);
    if (b) return [{l, bank: b}];
    request(l.recipe, l.case, prio);
    const out = [];
    for (const a of asLayers(l.alt)) {
      const ab = getBank(a.recipe, a.case);
      if (ab) out.push({l: {...a, delayMs: a.delayMs ?? l.delayMs}, bank: ab, alt: true}); else request(a.recipe, a.case, prio);
    }
    return out;
  }

  // returns {ok, voices[]}: ok false = fall back
  function fire(name, p = {}) {
    const ev = EVENTS[name];
    if (!ev) { st.unknown++; return {ok: false, voices: []}; }
    const layers = pickLayers(ev, p);
    if (!layers.length) { st.unknown++; return {ok: false, voices: []}; }
    const prio = Math.min(ev.bakePriority ?? 5, 3);   // asked for in play: bake it soon
    const first = resolve(layers[0], prio);
    if (!first.length) {
      st.fallback++; const mk = keyOf(layers[0].recipe, layers[0].case); st.missing[mk] = (st.missing[mk] || 0) + 1;
      for (const l of layers.slice(1)) request(l.recipe, l.case, prio);
      return {ok: false, voices: []};
    }
    const cat = typeof ev.cat === 'function' ? ev.cat(p) : ev.cat;
    const sr = screenRule(cat, p.off);
    if (sr.cull) { st.screen[cat].culled++; return {ok: true, voices: []}; }   // handled: off-screen sources stay silent
    if (sr.faded) st.screen[cat].faded++;
    const tw = wall();
    if (ev.cooldownMs && lastPost[name] != null && (tw - lastPost[name]) * 1000 < ev.cooldownMs && tw >= lastPost[name]) { st.cooldown++; return {ok: true, voices: []}; }
    lastPost[name] = tw;
    st.posted++; st.byName[name] = (st.byName[name] || 0) + 1;
    const pan = p.pan ?? 0, dist = p.dist ?? p.d ?? 0;
    const extraDb = ev.gainFrom ? (+ev.gainFrom(p) || 0) : 0;
    const evDb = (ev.gainDb || 0) + extraDb + sym(ev.gainJitDb || 0) + (p.gainDb || 0) + sr.db;
    const evSemi = sym(ev.pitchSemi || 0) + (p.semi || 0);
    const t0 = p.at ?? null, voices = [];
    const plan = [...first, ...layers.slice(1).flatMap(l => resolve(l, prio))];
    if (first.some(x => x.alt)) st.alts++;
    if (plan.length < first.length + layers.length - 1) st.layersSkipped += first.length + layers.length - 1 - plan.length;
    plan.forEach(({l, bank}, i) => {
      const bk = keyOf(l.recipe, l.case), vi = chooseVariant(bk, bank.buffers.length);
      // later layers get a little independent jitter, so a layered sound doesn't move as one block
      const semi = evSemi + (l.semi || 0) + (i ? sym((ev.pitchSemi || 0) * .3) : 0);
      const delay = rangeOf(l.delayMs) / 1000;
      const at = delay > 0 ? (t0 ?? audioNow()) + delay : t0;
      const lpfs = [p.lpf, l.lpf, ev.lpf, sr.lpf].filter(x => x != null);
      const v = engine.play(bank.buffers[vi], {
        bus: l.bus ?? ev.bus, gainDb: evDb + (l.gainDb || 0) + (i ? sym((ev.gainJitDb || 0) * .5) : 0),
        rate: Math.pow(2, semi / 12) * (l.rate || 1), pan, dist, lpf: lpfs.length ? Math.min(...lpfs) : null,
        minDist: sr.minDist, maxDist: sr.maxDist,
        send: l.send ?? ev.send, at, priority: (ev.priority ?? 50) - (i ? 5 : 0),
        key: l.key ?? (i ? `${name}#${i}` : (ev.key || name)), maxInstances: l.maxInstances ?? ev.maxInstances,
        steal: ev.steal, coalesceMs: l.coalesceMs ?? ev.coalesceMs ?? 0, cullDb: ev.cullDb,
      });
      if (v) { st.played++; voices.push(v); } else if (i === 0) st.culled++;   // culled, coalesced, rejected or suspended
    });
    if (ev.snapshot && engine.snapshot) { try { engine.snapshot(ev.snapshot.name, ev.snapshot); } catch (e) { st.errors++; } }
    return {ok: true, voices};
  }
  function post(name, params) {
    try { return fire(name, params || {}).ok; } catch (e) { st.errors++; console.warn('director.post', name, e); return false; }
  }

  function ready(name, p) {
    const ev = EVENTS[name]; if (!ev) return false;
    if (p) { const l = pickLayers(ev, p)[0]; return !!(l && (getBank(l.recipe, l.case) || asLayers(l.alt).some(a => getBank(a.recipe, a.case)))); }
    return (ev.banks || []).every(([r, c]) => !!getBank(r, c) || failed.has(keyOf(r, c)));
  }

  // ---------------------------------------------------------------- prefetch
  const callsOf = A => A.calls || A.spots || [];
  function prefetch({biome = null, allBiomes = false, skip = null} = {}) {
    const want = new Map();   // key -> {recipe, case, variants, priority}
    const add = (recipe, c, priority, variants) => {
      const k = keyOf(recipe, c), have = want.get(k);
      if (!have) want.set(k, {recipe, case: c, variants: variants ?? null, priority});
      else { have.priority = Math.min(have.priority, priority); if (variants) have.variants = Math.max(have.variants || 0, variants); }
    };
    for (const ev of Object.values(EVENTS)) for (const [r, c, bp] of ev.banks || []) if (!skip || !skip(r, c)) add(r, c, bp ?? ev.bakePriority ?? 5, ev.variants);
    for (const s of Object.values(SOURCES)) add(s.recipe, s.case, AMB_PRIORITY.sources ?? 4, 1);
    // ambience: the current biome now; the others lazily (ambience.update requests them on arrival) unless allBiomes
    for (const [id, A] of Object.entries(AMBIENCE)) {
      const cur = id === biome;
      if (!cur && !allBiomes) continue;
      for (const list of Object.values(A.beds || {})) for (const b of list) add(b.recipe, b.case, cur ? (b.bakePriority ?? AMB_PRIORITY.current) : AMB_PRIORITY.other, 1);
      for (const e of A.emitters || []) add(e.recipe, e.case, cur ? AMB_PRIORITY.current + 1 : AMB_PRIORITY.other, 1);
      for (const s of callsOf(A)) add(s.recipe, s.case, cur ? AMB_PRIORITY.spots : AMB_PRIORITY.other, s.variants ?? 4);
    }
    const list = [...want.values()].sort((a, b) => a.priority - b.priority).filter(x => !failed.has(keyOf(x.recipe, x.case)));
    for (const x of list) { requested.set(keyOf(x.recipe, x.case), x.priority); bankInfo.set(keyOf(x.recipe, x.case), {variants: x.variants}); }
    try {
      for (const x of list) bakery.request(x.recipe, x.case, {variants: x.variants, priority: x.priority})?.catch?.(() => failed.add(keyOf(x.recipe, x.case)));
    } catch (e) { st.errors++; }
    return list;
  }

  // ---------------------------------------------------------------- ambience
  const amb = {biome: null, time: null, beds: new Map(), emitters: new Map(), sources: new Map(), timers: new Map(),
    gust: .5, gT: .5, gNext: 0, gAcc: 0, emAcc: 0, clock: 0, recent: [], combat: 0, duckSet: null};
  function bedsFor(biome, time) { const A = AMBIENCE[biome]; if (!A) return []; return A.beds?.[time] || A.beds?.day || []; }
  function ambUpdate({biome = 'ruins', time = 'day', stream = null, sources = null, combat = 0, gust = null, dt = 1 / 60} = {}) {
    const A = AMBIENCE[biome]; if (!A) return;
    dt = clamp(+dt || 0, 0, .5); amb.clock += dt;
    const changed = biome !== amb.biome || time !== amb.time, biomeChanged = biome !== amb.biome;
    if (biomeChanged) {
      amb.timers.clear();
      // this biome's ambience jumps the bake queue
      for (const b of Object.values(A.beds || {}).flat()) request(b.recipe, b.case, b.bakePriority ?? AMB_PRIORITY.current, 1);
      for (const e of A.emitters || []) request(e.recipe, e.case, AMB_PRIORITY.current + 1, 1);
      for (const s of callsOf(A)) request(s.recipe, s.case, AMB_PRIORITY.spots, s.variants ?? 4);
      if (engine.setReverb) { try { engine.setReverb(biome, 1); } catch (e) {} }
    }
    amb.biome = biome; amb.time = time;
    // gusts: the arena's wind (0..1) when given, otherwise a slow random walk (as the old beds did)
    if (typeof gust === 'number') amb.gT = clamp(gust, 0, 1);
    else { amb.gNext -= dt; if (amb.gNext <= 0) { amb.gT = Math.pow(rnd(), 1.3); amb.gNext = 2 + rnd() * 4; } }
    amb.gust += (amb.gT - amb.gust) * Math.min(1, dt * .6);
    amb.gAcc += dt;
    const gustTick = amb.gAcc >= .25; if (gustTick) amb.gAcc = 0;

    // ---- combat duck: ambience steps back while the fight (the music's intensity) is on ----
    amb.combat += (clamp(+combat || 0, 0, 1) - amb.combat) * Math.min(1, dt * 2);
    if (gustTick && engine.setBusDb && (amb.duckSet == null || Math.abs(amb.combat - amb.duckSet) > .03)) {
      amb.duckSet = amb.combat;
      for (const [bus, d] of Object.entries(AMB_RULES.duck || {})) { try { engine.setBusDb(bus, d * amb.combat, .4); } catch (e) {} }
    }

    // ---- beds: start what this biome / time wants (once baked), retarget shared ones, fade out the rest ----
    const want = new Map(bedsFor(biome, time).map(b => [keyOf(b.recipe, b.case), b]));
    for (const [k, b] of want) {
      const dbNow = b.gainDb + (b.gust ? b.gust * (amb.gust - .5) : 0);
      const have = amb.beds.get(k);
      if (!have) {
        const bank = getBank(b.recipe, b.case);
        if (!bank) { request(b.recipe, b.case, b.bakePriority ?? AMB_PRIORITY.current, 1); continue; }   // not baked (or failed): silent
        const h = engine.loop(bank.buffers[0], {bus: 'amb.beds', gainDb: dbNow, fadeIn: amb.beds.size ? 2.5 : 2, send: b.send ?? .05,
          offset: rnd() * bank.buffers[0].duration});
        amb.beds.set(k, {h, def: b, db: dbNow}); st.bedsStarted++;
      } else if (changed || have.def !== b) { have.def = b; have.db = dbNow; have.h.setGainDb(dbNow, 1.2); }
      else if (gustTick && b.gust) { have.db = dbNow; have.h.setGainDb(dbNow, .4); }
    }
    for (const [k, have] of amb.beds) if (!want.has(k)) { have.h.stop(2.5); amb.beds.delete(k); st.bedsStopped++; }

    // ---- emitters (the stream): level, pan and low-pass follow how close you are ----
    amb.emAcc += dt;
    const emTick = amb.emAcc >= .1 || changed; if (emTick) amb.emAcc = 0;
    const prox = clamp(stream?.prox ?? 0, 0, 1), span = clamp(stream?.pan ?? 0, -1, 1);
    const wantEm = new Map((A.emitters || []).map(e => [keyOf(e.recipe, e.case), e]));
    for (const [k, e] of wantEm) {
      const floor = DB(e.floorDb ?? -16), db = e.gainDb + 20 * Math.log10(floor + (1 - floor) * prox);
      const lpf = (e.lpf?.[0] ?? 600) + ((e.lpf?.[1] ?? 9000) - (e.lpf?.[0] ?? 600)) * prox * prox;
      const pan = span * (.35 + .45 * prox);   // far away it is wide and soft; near, it sits where it is
      const have = amb.emitters.get(k);
      if (!have) {
        const bank = getBank(e.recipe, e.case);
        if (!bank) { request(e.recipe, e.case, AMB_PRIORITY.current + 1, 1); continue; }
        const h = engine.loop(bank.buffers[0], {bus: 'amb.emitters', gainDb: db, pan, lpf, fadeIn: 2, send: e.send ?? .1, offset: rnd() * bank.buffers[0].duration});
        amb.emitters.set(k, {h, def: e}); st.bedsStarted++;
      } else if (emTick) { have.h.setGainDb(db, .3); have.h.setPan(pan, .3); have.h.setLpf(lpf, .3); }
    }
    for (const [k, have] of amb.emitters) if (!wantEm.has(k)) { have.h.stop(2.5); amb.emitters.delete(k); st.bedsStopped++; }

    // ---- visible sources (torches, braziers): the nearest few on screen each get a positional fire loop ----
    if (emTick) updateSources(sources || []);

    // ---- calls: rare, far-off one-shots on their own timers, under the global budget ----
    callsOf(A).forEach((s, i) => {
      if (s.time && !s.time.includes(time)) return;
      const tk = biome + ':' + i;
      let left = amb.timers.get(tk);
      if (left == null) left = rangeOf(s.every) * (.4 + .6 * rnd());   // the first one is not right away
      left -= dt;
      if (left <= 0) left = playCall(s) ? rangeOf(s.every) : 3 + rnd() * 5;   // over budget: try again a little later
      amb.timers.set(tk, left);
    });
  }
  function updateSources(list) {
    const want = [];
    for (const s of list) {
      const def = SOURCES[s.kind]; if (!def) continue;
      const sp = loopSpatial('world', s.off, s.d);
      if (sp.cull) { st.sourcesCulled++; continue; }
      want.push({s, def, sp});
    }
    want.sort((a, b) => (a.s.d ?? 0) - (b.s.d ?? 0));
    const keep = new Set();
    for (const {s, def, sp} of want.slice(0, AMB_RULES.maxSources ?? 4)) {
      const id = s.id ?? `${s.kind}@${s.x},${s.y}`; keep.add(id);
      const db = def.gainDb + sp.db, pan = clamp(s.pan ?? 0, -1, 1);
      const have = amb.sources.get(id);
      if (!have) {
        const bank = getBank(def.recipe, def.case);
        if (!bank) { keep.delete(id); request(def.recipe, def.case, AMB_PRIORITY.sources ?? 4, 1); continue; }
        const h = engine.loop(bank.buffers[0], {bus: 'amb.emitters', gainDb: db, pan, lpf: sp.lpf, fadeIn: .8, send: def.send ?? .12,
          offset: rnd() * bank.buffers[0].duration});
        amb.sources.set(id, {h, kind: s.kind}); st.sourcesStarted++;
      } else { have.h.setGainDb(db, .15); have.h.setPan(pan, .15); have.h.setLpf(sp.lpf, .2); }
    }
    for (const [id, have] of amb.sources) if (!keep.has(id)) { have.h.stop(1); amb.sources.delete(id); st.sourcesStopped++; }
  }
  function playCall(s) {
    const B = AMB_RULES.budget || {max: 2, windowS: 10};
    amb.recent = amb.recent.filter(t => amb.clock - t < B.windowS);
    if (amb.recent.length >= B.max) { st.callsDeferred++; return false; }
    const bank = getBank(s.recipe, s.case);
    if (!bank) { request(s.recipe, s.case, AMB_PRIORITY.spots, s.variants ?? 4); return true; }
    const vi = chooseVariant(keyOf(s.recipe, s.case), bank.buffers.length);
    const [p0, p1] = Array.isArray(s.pan) ? s.pan : [.6, s.pan ?? .8];
    const pan = (rnd() < .5 ? -1 : 1) * (p0 + rnd() * (p1 - p0));   // always to one side, never centre
    const v = engine.play(bank.buffers[vi], {bus: 'amb.spots', gainDb: Math.min(-30, s.gainDb) + sym(s.gainJitDb ?? 1.5), rate: Math.pow(2, sym(s.pitchSemi ?? 1) / 12),
      pan, lpf: s.lpf ? rangeOf(s.lpf) : 1500, send: s.send ?? .5, priority: s.priority ?? 10,
      key: 'call:' + s.recipe + ':' + s.case, maxInstances: 1, steal: 'none'});
    amb.recent.push(amb.clock); if (v) st.calls++;
    return true;
  }
  function ambStop(fade = 1.5) {
    for (const m of [amb.beds, amb.emitters, amb.sources]) { for (const x of m.values()) x.h.stop(fade); m.clear(); }
    amb.biome = amb.time = null; amb.timers.clear();
  }

  // ---------------------------------------------------------------- continuous voices
  // Bow draw: draw_pull while the string comes back (k rising), draw_full when it reaches full draw, then draw_hold
  // segments chained (each started before the last one ends, they have soft edges) for as long as it is held.
  function makeCreak(o = {}) {
    if (!getBank('bow_draw', 'draw') || !getBank('bow_draw', 'hold')) {
      request('bow_draw', 'draw', 2); request('bow_draw', 'hold', 2); return null;
    }
    let phase = 'start', drawT = 0, drawLeft = 0, holdT = 0, cur = [];
    const P = (name, extra = {}) => { const r = fire(name, {pan: o.pan ?? 0, dist: o.dist ?? 0, ...extra}); cur = cur.filter(v => v.playing); cur.push(...r.voices); return r.voices[0] || null; };
    return {
      set(k, rate, t, dt) {
        dt = clamp(+dt || 0, 0, .25);
        if (phase === 'start') {
          if (k < .9) {   // the pull; a quick draw plays the creak a bit faster
            const v = P('draw_pull', {semi: clamp((rate - 1.5) * .8, -1, 1.5)});
            drawLeft = v ? v.dur : .6; phase = 'draw'; drawT = 0;
          } else { P('draw_full'); phase = 'hold'; holdT = .25; }
        } else if (phase === 'draw') {
          drawT += dt;
          if (k >= .999 || (rate <= .05 && drawT > .2)) { if (k >= .95) P('draw_full'); phase = 'hold'; holdT = Math.max(.1, (drawLeft - drawT) * .6); }
        } else if (phase === 'hold') {
          holdT -= dt;
          if (holdT <= 0) { const v = P('draw_hold'); holdT = v ? v.dur * (.7 + .2 * rnd()) : .9; }
        }
      },
      stop() { for (const v of cur) v.stop?.(.04); cur = []; phase = 'done'; },
    };
  }
  // Rolling barrel. With the prop_roll LOOP baked (stone, or dirt in frost / ember): one seamless loop whose level follows the speed and whose playbackRate
  // follows it too (0.7..1.4). The engine's LoopHandle has no live rate, so a rate change of more than 0.08 crossfades to
  // a fresh loop at the new rate (150 ms); h.setRate is used instead if the engine ever offers it.
  // Fallback (prop/roll one-shots only): a ~2 s segment every ~1 s, the previous one faded before its own stop.
  // Both follow the world screen rule (pass `off` as the 6th argument of set()).
  function makeRoll() {
    const ev = EVENTS.barrel_loop, L0 = ev && pickLayers(ev, {surf: amb.biome})[0], lb = L0 && getBank(L0.recipe, L0.case);   // dirt on frost / ember ground
    if (lb) return loopRoll(ev, lb);
    if (L0) request(L0.recipe, L0.case, 3, 1);
    if (!getBank('prop', 'roll')) { request('prop', 'roll', 3); return null; }
    let cur = null, el = 0, seg = 0;
    return {
      mode: 'segments',
      set(speed, pan, d, t, dt, off = 0) {
        el += clamp(+dt || 0, 0, .25);
        const sp = screenRule('world', off);
        if (sp.cull) { if (cur) { cur.stop?.(.3); cur = null; } st.screen.world.culled++; return; }
        if (speed > .8 && (!cur || el >= seg)) {
          const k = clamp(speed / 4, .15, 1);
          const prev = cur;
          const r = fire('barrel_roll', {pan, dist: d, off, gainDb: 20 * Math.log10(k), semi: clamp((speed - 2.5) * .6, -2, 2)});
          if (r.ok && r.voices[0]) { prev?.stop?.(.25); cur = r.voices[0]; el = 0; seg = clamp(cur.dur * .5, .5, 1.2) * (.85 + .3 * rnd()); }
        }
      },
      stop() { cur = null; el = 0; },   // let the last segment roll to its stop
    };
  }
  function loopRoll(ev, bank) {
    const buf = bank.buffers[0];
    let h = null, rate = 0;
    const rateOf = speed => clamp(.7 + .7 * (speed - .3) / 3.7, .7, 1.4);
    return {
      mode: 'loop',
      set(speed, pan, d, t, dt, off = 0) {
        const sp = loopSpatial('world', off, d);
        if (sp.cull || speed < .25) { if (h) { h.stop(.3); h = null; } if (sp.cull) st.screen.world.culled++; return; }
        const db = (ev.gainDb || 0) + 20 * Math.log10(clamp(speed / 4, .08, 1)) + sp.db, r = rateOf(speed);
        if (h && Math.abs(r - rate) > .08 && h.setRate) { h.setRate(r, .1); rate = r; }
        if (!h || Math.abs(r - rate) > .08) {
          const old = h;
          h = engine.loop(buf, {bus: ev.bus || 'sfx.world', gainDb: db, pan, lpf: sp.lpf, rate: r, fadeIn: old ? .15 : .1, send: ev.send ?? .15,
            offset: rnd() * buf.duration});
          old?.stop(.15); rate = r;
        } else { h.setGainDb(db, .06); h.setPan(pan, .06); h.setLpf(sp.lpf, .1); }
      },
      stop() { if (h) { h.stop(.3); h = null; } },
    };
  }

  return {
    EVENTS, AMBIENCE,
    post, ready, prefetch,
    makeCreak, makeRoll,
    ambience: {update: ambUpdate, stop: ambStop, get state() { return {biome: amb.biome, time: amb.time, gust: +amb.gust.toFixed(2), combat: +amb.combat.toFixed(2),
      beds: [...amb.beds.keys()], emitters: [...amb.emitters.keys()], sources: [...amb.sources.values()].map(x => x.kind)}; }},
    get stats() { return {...st, byName: {...st.byName}, missing: {...st.missing}, screen: JSON.parse(JSON.stringify(st.screen)),
      beds: [...amb.beds.keys()], emitters: [...amb.emitters.keys()], sources: amb.sources.size, failed: [...failed],
      requested: requested.size, bakery: bakery.stats, engine: engine.stats}; },
    _chooseVariant: chooseVariant, _screenRule: screenRule,   // tests
  };
}
