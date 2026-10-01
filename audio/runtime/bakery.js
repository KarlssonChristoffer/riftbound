// BAKERY: bakes forge recipes into AudioBuffers in background Workers (docs/AUDIO.md §2.1, audio/runtime/CONTRACT.md).
//
//   const B = createBakery(ac, {workers: 'auto'});    // 'auto' = 2 workers when navigator.hardwareConcurrency >= 4
//   B.request('impact', 'wood', {variants: 6, priority: 1}) -> Promise<Bank>
//   B.get('impact', 'wood') -> Bank | null              // only once fully baked
//   Bank = {recipe, case, loop, buffers: AudioBuffer[], version, seeds, metrics: [{lufsM, durMs, ...}], bytes, ms}
//
// - One job = one (recipe, case) with all its seeds. Lower `priority` runs first; equal priorities run in request order.
// - A duplicate request returns the same promise (and can raise a queued job's priority).
// - Bakes at ac.sampleRate. The AudioContext may be suspended; AudioBuffers don't need it running, and they can be
//   played in any context with the same sample rate (the tests render them in an OfflineAudioContext).
// - Workers post one message per job, transferring the Float32Arrays; the main thread only copies them into
//   AudioBuffers. A recipe exception rejects that request only; a crashed worker is restarted.
// - Cache: in memory for the session. A failed job is forgotten, so a later request retries it.

export function createBakery(ac, {workers = 'auto', workerUrl = new URL('./bake.worker.js', import.meta.url)} = {}) {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const nWorkers = workers === 'auto' ? (hc >= 4 ? 2 : 1) : Math.max(1, workers | 0);
  const sr = ac.sampleRate;
  const jobs = new Map();          // key -> job
  const queue = [];                // queued jobs (unsorted; picked by min priority, then seq)
  const listeners = new Set();
  const st = {queued: 0, baking: 0, done: 0, failed: 0, ms: 0, buildMs: 0, wallMs: 0, bytes: 0, workers: nWorkers, restarts: 0, errors: []};
  let seq = 0, firstT = null, nextId = 1, disposed = false;
  const pool = [];
  const keyOf = (r, c) => r + ':' + c;

  function spawn(slot) {
    const w = new Worker(workerUrl, {type: 'module', name: 'forge-bake-' + slot.i});
    w.onmessage = e => onMessage(slot, e.data);
    w.onerror = e => { e.preventDefault?.(); crash(slot, e.message || 'worker error (module load failed?)'); };
    w.onmessageerror = () => crash(slot, 'messageerror');
    slot.w = w; slot.job = null;
  }
  for (let i = 0; i < nWorkers; i++) { const slot = {i, w: null, job: null, restarts: 0}; pool.push(slot); spawn(slot); }

  function crash(slot, msg) {
    const job = slot.job; slot.job = null;
    if (job) fail(job, new Error(`bake worker crashed on ${job.key}: ${msg}`));
    slot.w?.terminate();
    if (++slot.restarts <= 3) { st.restarts++; spawn(slot); }
    else { slot.w = null; if (pool.every(s => !s.w)) { for (const j of queue.splice(0)) fail(j, new Error('no bake workers left: ' + msg)); } }
    pump();
  }

  function pump() {
    if (disposed) return;
    for (const slot of pool) {
      if (!slot.w || slot.job || !queue.length) continue;
      let bi = 0;
      for (let i = 1; i < queue.length; i++) {
        const a = queue[i], b = queue[bi];
        if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) bi = i;
      }
      const job = queue.splice(bi, 1)[0];
      job.state = 'baking'; job.t0 = performance.now(); slot.job = job;
      slot.w.postMessage({type: 'bake', id: job.id, recipe: job.recipe, case: job.case, seeds: job.seeds, variants: job.variants, sr});
    }
    st.queued = queue.length; st.baking = pool.filter(s => s.job).length;
  }

  function onMessage(slot, m) {
    const job = slot.job;
    if (!job || job.id !== m.id) return;   // stale (shouldn't happen)
    slot.job = null;
    if (m.type === 'error') fail(job, new Error(m.msg));
    else {
      try {
        const tb = performance.now();
        const buffers = m.ch.map(chans => {
          const b = ac.createBuffer(chans.length, Math.max(1, chans[0].length), sr);
          chans.forEach((c, i) => b.copyToChannel(c, i));
          return b;
        });
        const bytes = buffers.reduce((s, b) => s + b.length * b.numberOfChannels * 4, 0);
        const bank = {recipe: m.recipe, case: m.case, loop: m.loop, version: m.version, seeds: m.seeds, buffers, metrics: m.metrics,
          bytes, ms: m.ms, buildMs: performance.now() - tb, wallMs: performance.now() - job.t0};
        job.state = 'done'; job.bank = bank;
        st.done++; st.ms += m.ms; st.buildMs += bank.buildMs; st.bytes += bytes; st.wallMs = performance.now() - firstT;
        job.resolve(bank);
        for (const fn of listeners) { try { fn(bank); } catch (e) { console.error('bakery onReady listener', e); } }
      } catch (e) { fail(job, e); }
    }
    pump();
  }

  function fail(job, err) {
    job.state = 'failed'; st.failed++;
    st.errors.push(job.key + ': ' + String(err.message).split('\n')[0]); if (st.errors.length > 20) st.errors.shift();
    if (jobs.get(job.key) === job) jobs.delete(job.key);   // forget it: a later request retries
    job.reject(err);
  }

  function request(recipe, caseName, {variants = null, priority = 5, seeds = null} = {}) {
    const key = keyOf(recipe, caseName);
    const have = jobs.get(key);
    if (have) {
      if (have.state === 'queued' && priority < have.priority) have.priority = priority;
      return have.promise;
    }
    if (disposed) return Promise.reject(new Error('bakery disposed'));
    if (firstT == null) firstT = performance.now();
    const job = {key, id: nextId++, recipe, case: caseName, variants, seeds, priority, seq: seq++, state: 'queued', bank: null};
    job.promise = new Promise((res, rej) => { job.resolve = res; job.reject = rej; });
    job.promise.catch(() => {});   // callers may ignore it (prefetch); failures are counted in stats
    jobs.set(key, job); queue.push(job);
    pump();
    return job.promise;
  }

  return {
    sampleRate: sr,
    request,
    get(recipe, caseName) { const j = jobs.get(keyOf(recipe, caseName)); return j?.state === 'done' ? j.bank : null; },
    ready(recipe, caseName) { return jobs.get(keyOf(recipe, caseName))?.state === 'done'; },
    prefetch(list) {
      return Promise.allSettled(list.map(x => request(x.recipe, x.case, {variants: x.variants ?? null, priority: x.priority ?? 5, seeds: x.seeds ?? null})));
    },
    onReady(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    banks() { return [...jobs.values()].filter(j => j.state === 'done').map(j => j.bank); },
    get stats() { return {...st, queued: queue.length, baking: pool.filter(s => s.job).length, errors: st.errors.slice()}; },
    dispose() {
      disposed = true;
      for (const s of pool) { s.w?.terminate(); s.w = null; if (s.job) fail(s.job, new Error('bakery disposed')); s.job = null; }
      for (const j of queue.splice(0)) fail(j, new Error('bakery disposed'));
    },
  };
}
