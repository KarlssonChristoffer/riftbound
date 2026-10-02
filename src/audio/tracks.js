// TRACKS: the file-music player. Pre-made songs (OGG, decoded on demand) played on the cue sheets' beat grid
// (content/cues.js): sections looped seamlessly on bar lines, jumps quantised to the next beat / bar / 4-bar phrase,
// equal-power crossfades, short dark tails, song-to-song switches, unpitched stingers on the next beat, a low-pass and
// ducks for the director, a tape stop. It follows orders; WHAT to play is the director's (audio/battledirector.js).
// OWNS: its nodes (segments -> lp -> duck -> pulse -> vol -> the music bus), the decoded songs (an LRU of TUNE.resident),
//   the schedule (the playing song's beat cursor, the pending request, the clock mapping), its log.
// READS: content/cues.js, the AudioContext it is given (ac.currentTime is the one clock).  EMITS: nothing.
// BUDGET: tick() ~0.01 ms every 25 ms (a few comparisons; new nodes only at a jump: one source + two gains + a filter).
//
// "A Tale of Two Clocks": a 25 ms timer (or the caller, offline) runs tick(), which walks the playing song's beat
// boundaries up to TUNE.lookahead ahead of ac.currentTime and commits what happens at each: nothing (play on), a
// pending request whose quantum this boundary is (jump / song switch / stop), or the region's end (loop back, or go on to
// the region's `then`). Every change starts sample-accurately with AudioBufferSourceNode.start(when, offset), `when` a
// beat time of the cue: file time beats[i] + the segment's base (the ctx time of file t = 0).
//
//   const TP = createTrackPlayer(ac, dest, {offline, base, log});
//   TP.load(id) -> Promise (fetch + decode; resident: the newest TUNE.resident songs, the playing one pinned);
//     TP.ready(id) / TP.failed(id) (a missing file: the director gives the music back to the procedural score)
//   TP.play(id, {role, q, fade, stinger}) / TP.goto(role, {q, resume, tail}) / TP.stop({q, fade}) / TP.setThen(role)
//     q: 'now' | 'beat' | 'bar' | 'phrase' (the earliest boundary of that kind at least TUNE.minLead ahead)
//   TP.stinger(kind, {q, db}) -> ctx time it plays (-1: no song plays): 'echo' (the song's own beat doubled: an accent in
//     its own key and sound) or a synthesized unpitched drum ('boom', 'hit', 'thump'), rendered once at load (seeded)
//   TP.setFilter(hz, tc), TP.setDuck(db, tc), TP.pulse(db, hold, release), TP.setVolume(g), TP.tapeStop(sec)
//   TP.clock: now(), fileTime(t), nextBeat(t), nextBar(t), nextPhrase(t), bpm   TP.state  TP.stats  TP.tick()
import {CUES} from '../content/cues.js';
import {mulberry32} from '../core/rng.js';

// where the songs are: ONE place (shipping moves them). Resolved from this module, so any page that imports it agrees.
export const MUSIC_BASE = new URL('../../assets/src/cowboygameboy/music_ogg/', import.meta.url).href;

export const TUNE = {
  lookahead: .2,      // s: how far ahead the schedule is committed (> xfSong + a tick: a switch's crossfade ends ON the beat)
  tick: 25,           // ms: the timer (live)
  minLead: .04,       // s: a boundary nearer than this is too late to use
  xfJump: .025,       // s: equal-power crossfade at a jump, ending ON the boundary (the new downbeat starts clean)
  xfSong: .12,        // s: ... at a song switch
  tail: {db: -8, tau: .09, lp: 1800},   // the old segment's short dark ring-out after a section change / switch
  phraseWait: 6,      // s: a 'phrase' request waits at most this long, then takes the next bar
  resident: 2,        // decoded songs kept (each ~ 60-115 MB of float32)
  lpOpen: 22000,      // Hz: the low-pass when nothing asks for one
  stingDb: -21,       // dBFS: a synthesized stinger's peak (felt under the song, not over it)
  endFade: .6,        // s: a fade over the file's last moments (an ending that stops on a still-ringing note)
};

const DB = db => Math.pow(10, db / 20);
const N_CURVE = 64;
const FADE_IN = new Float32Array(N_CURVE), FADE_OUT = new Float32Array(N_CURVE), TAIL_OUT = new Float32Array(N_CURVE);
const TAPE_RATE = new Float32Array(N_CURVE), TAPE_GAIN = new Float32Array(N_CURVE);
for (let i = 0; i < N_CURVE; i++) {
  const x = i / (N_CURVE - 1);
  FADE_IN[i] = Math.sin(x * Math.PI / 2); FADE_OUT[i] = Math.cos(x * Math.PI / 2);
  TAIL_OUT[i] = 1 + (DB(TUNE.tail.db) - 1) * Math.sin(x * Math.PI / 2);
  TAPE_RATE[i] = Math.max(.02, Math.pow(1 - x, 1.6));   // the reels slow down (pitch and speed together)
  TAPE_GAIN[i] = x < .55 ? 1 : Math.cos((x - .55) / .45 * Math.PI / 2);
}

// ------------------------------------------------------------------ the stingers' drums (plain JS, seeded, rendered once)
function renderDrum(sr, kind) {
  const R = mulberry32({boom: 11, hit: 23, thump: 37}[kind] || 5);
  const C = {
    boom: {dur: 1.3, f0: 105, f1: 44, pt: .07, T: .55, m2: 1.52, nT: .05, nf: 240, ng: .5, crack: 0},
    hit: {dur: .9, f0: 125, f1: 55, pt: .05, T: .3, m2: 1.5, nT: .04, nf: 320, ng: .45, crack: .5},
    thump: {dur: .5, f0: 150, f1: 70, pt: .035, T: .16, m2: 1.6, nT: .025, nf: 380, ng: .35, crack: 0},
  }[kind];
  const n = Math.ceil(C.dur * sr), d = new Float32Array(n);
  let ph = 0, ph2 = 0, lp = 0, bp1 = 0, bp2 = 0, pk = 0;
  const kl = 1 - Math.exp(-2 * Math.PI * C.nf / sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = C.f1 + (C.f0 - C.f1) * Math.exp(-t / C.pt);
    ph += 2 * Math.PI * f / sr; ph2 += 2 * Math.PI * f * C.m2 / sr;
    const env = Math.min(1, t / .002) * Math.exp(-t / C.T * 2.3);
    let y = env * (Math.sin(ph) + .22 * Math.sin(ph2) * Math.exp(-t / (C.T * .25)));
    const w = R() * 2 - 1; lp += (w - lp) * kl;                       // the skin: low noise, a few ms
    y += C.ng * lp * 3 * Math.exp(-t / C.nT);
    if (C.crack) {                                                    // a dark snare-like crack (band ~ 900 Hz), short
      bp1 += (w - bp1) * .11; bp2 += (bp1 - bp2) * .11;
      y += C.crack * (bp1 - bp2) * 4 * Math.min(1, t / .001) * Math.exp(-t / .06);
    }
    d[i] = Math.tanh(y * 1.2);
    if (Math.abs(d[i]) > pk) pk = Math.abs(d[i]);
  }
  const fo = Math.floor(sr * .03);
  for (let i = 0; i < n; i++) d[i] /= pk || 1;
  for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
  return d;
}

export function createTrackPlayer(ac, dest, {offline = false, base = MUSIC_BASE, logSize = 0} = {}) {
  const sr = ac.sampleRate;
  // ---- the chain: segments -> lp -> duck -> pulse -> vol -> dest
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = TUNE.lpOpen; lp.Q.value = .5;
  const duck = ac.createGain(), pulseG = ac.createGain(), vol = ac.createGain();
  lp.connect(duck); duck.connect(pulseG); pulseG.connect(vol); vol.connect(dest);
  const DRUM = {};
  for (const k of ['boom', 'hit', 'thump']) { const d = renderDrum(sr, k), b = ac.createBuffer(1, d.length, sr); b.getChannelData(0).set(d); DRUM[k] = b; }

  // ---- songs: fetch + decode on demand; an LRU of decoded buffers
  const songs = new Map();   // id -> {id, cue, buf, bytes, used, loading}
  const stats = {decodes: 0, decodeMs: 0, residentBytes: 0, resident: 0, evictions: 0, jumps: 0, loops: 0, switches: 0, stingers: 0, ticks: 0, tickMs: 0, late: 0, errors: 0};
  let useN = 0;
  function entry(id) {
    let e = songs.get(id);
    if (!e) { const cue = CUES[id]; if (!cue) return null; e = {id, cue, buf: null, bytes: 0, used: 0, loading: null, failed: null}; songs.set(id, e); }
    return e;
  }
  function load(id) {
    const e = entry(id); if (!e) return Promise.reject(new Error('tracks: no cue ' + id));
    e.used = ++useN;
    if (e.buf) return Promise.resolve(e.buf);
    if (e.loading) return e.loading;
    if (e.failed) return Promise.reject(e.failed);   // (once: a missing file is not fetched again)
    const url = base + e.cue.file.split('/').map(encodeURIComponent).join('/') + '.ogg';
    const t0 = performance.now();
    e.loading = fetch(url).then(r => { if (!r.ok) throw new Error(`tracks: ${r.status} ${url}`); return r.arrayBuffer(); })
      .then(ab => ac.decodeAudioData(ab))
      .then(buf => {
        e.buf = buf; e.bytes = buf.length * buf.numberOfChannels * 4; e.loading = null; e.used = ++useN;
        stats.decodes++; stats.decodeMs = Math.round(performance.now() - t0);
        evict(); return buf;
      }, err => { e.loading = null; e.failed = err; stats.errors++; console.warn('battle music: ' + (err?.message || err) + ' (the procedural score plays instead)'); throw err; });
    return e.loading;
  }
  function evict() {
    for (;;) {
      let n = 0, old = null;
      for (const e of songs.values()) if (e.buf) { n++; if (!pinned(e) && (!old || e.used < old.used)) old = e; }
      if (n <= TUNE.resident || !old) break;
      old.buf = null; old.bytes = 0; stats.evictions++;
    }
    let b = 0, n = 0; for (const e of songs.values()) if (e.buf) { b += e.bytes; n++; }
    stats.residentBytes = b; stats.resident = n;
  }
  const pinned = e => e === S.e || (REQ.on && REQ.song === e.id) || segUses(e.buf);

  // ---- segments: one source + its fade gain + level gain + a tail filter; a few live at once (cur + fading ones)
  const segs = [];   // live segments (oldest first)
  function segUses(buf) { if (!buf) return false; for (let i = 0; i < segs.length; i++) if (segs[i].src.buffer === buf) return true; return false; }
  function newSeg(e, when, offset, fade) {
    const src = ac.createBufferSource(); src.buffer = e.buf;
    const g = ac.createGain(), lv = ac.createGain(), f = ac.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = TUNE.lpOpen; lv.gain.value = DB(e.cue.gainDb);
    src.connect(g); g.connect(f); f.connect(lv); lv.connect(lp);
    const seg = {src, g, f, lv, e, stopAt: Infinity};
    if (offset < 0) { when -= offset; offset = 0; }
    if (fade > 0) { g.gain.setValueAtTime(0, when); g.gain.setValueCurveAtTime(FADE_IN, when, fade); }
    src.start(when, offset);
    src.onended = () => { const i = segs.indexOf(seg); if (i >= 0) segs.splice(i, 1); try { lv.disconnect(); } catch (err) {} evict(); };
    segs.push(seg);
    return seg;
  }
  const hold = (p, t) => { if (p.cancelAndHoldAtTime) { try { p.cancelAndHoldAtTime(t); return; } catch (err) {} } p.cancelScheduledValues(t); };
  function fadeOut(seg, t0, xf, tail) {
    if (!seg || seg.stopAt <= t0) return;
    hold(seg.g.gain, t0);
    let end = t0 + xf;
    if (tail) {
      seg.g.gain.setValueCurveAtTime(TAIL_OUT, t0, xf);
      seg.g.gain.setTargetAtTime(0, t0 + xf, TUNE.tail.tau);
      seg.f.frequency.setValueAtTime(TUNE.lpOpen, t0); seg.f.frequency.exponentialRampToValueAtTime(TUNE.tail.lp, t0 + xf + .05);
      end += TUNE.tail.tau * 7;
    } else seg.g.gain.setValueCurveAtTime(FADE_OUT, t0, xf);
    seg.stopAt = end + .02;
    try { seg.src.stop(seg.stopAt); } catch (err) {}
  }

  // ---- the schedule
  const S = {e: null, cue: null, playing: false, base: 0, bi: 0, bt: Infinity, ra: 0, rb: 0, then: '', role: '', endAt: Infinity,
    seg: null, prevBase: 0, prevE: null, jumpT: -1, resumeBar: -1, ended: false, bar: -1};
  const REQ = {on: false, kind: '', q: '', role: '', song: '', fade: 0, tail: false, resume: false, sting: '', t: 0, n: 0};
  let then2 = '';   // setThen: overrides the region's `then` (the intro's) with the director's wanted role
  // the log (tests): a ring of preallocated rows. A change at ctx time `at`: what played there (from: song, its file
  // time) and what plays from there (song, file time `to`), the role, the quantum asked for and when it was asked (req).
  // Checked against the cue sheets by the tests: from / to must sit on the cue's beat (bar) times.
  const LOG = {rows: [], n: 0, size: logSize};
  for (let i = 0; i < logSize; i++) LOG.rows.push({t: 0, at: 0, kind: '', from: '', fileFrom: -1, song: '', fileTo: -1, role: '', q: '', req: -1});
  function log(kind, at, from, fileFrom, song, fileTo, q, req) {
    if (!LOG.size) return;
    const r = LOG.rows[LOG.n++ % LOG.size];
    r.t = ac.currentTime; r.at = at; r.kind = kind; r.from = from || ''; r.fileFrom = fileFrom; r.song = song || ''; r.fileTo = fileTo;
    r.role = S.role || ''; r.q = q || ''; r.req = req;
  }

  const nBeats = () => S.cue.beats.length;
  const beatOfBar = bar => S.cue.bars0 + 4 * bar;
  const barOf = bi => { const k = bi - S.cue.bars0; return k >= 0 && k % 4 === 0 ? k / 4 : -1; };
  const barAt = bi => Math.floor((bi - S.cue.bars0) / 4);
  function setBoundary(bi) {   // the next boundary to look at: beat bi of the current mapping
    S.bi = bi;
    S.bt = bi < nBeats() ? S.base + S.cue.beats[bi] : Infinity;
  }
  function region(role) {
    const r = S.cue.roles[role] || S.cue.roles.main;
    S.role = S.cue.roles[role] ? role : 'main'; S.ra = r.loop[0]; S.rb = r.loop[1]; S.then = r.then || '';
    if (S.role !== 'intro') then2 = '';
  }

  // start the request's song at ctx time T (from silence, or cutting the current one at T). On the grid the crossfade
  // (xf) ENDS at T (pre = xf: the new song's first downbeat is clean); asked for 'now' it starts at T (pre = 0)
  function startSong(T, e, role, fade, xf, pre) {
    const old = S.seg, cue = e.cue, from = S.e ? S.e.id : '', ff = old ? T - S.base : -1;
    if (old) { S.prevBase = S.base; S.jumpT = T; S.prevE = S.e; }
    S.e = e; S.cue = cue; region(role);
    const tb = beatOfBar(S.ra), off = cue.beats[tb];
    if (!old) pre = 0;
    S.base = T - off;
    S.seg = newSeg(e, T - pre, off - pre, old ? xf : fade);
    if (old) fadeOut(old, T - pre, xf, xf < .3);
    if (old && REQ.sting) drum(REQ.sting, T, 0);
    S.playing = true; S.ended = false; S.resumeBar = -1;
    S.endAt = S.base + cue.end;
    setBoundary(tb + 1);
    stats.switches++;
    log('song', T, from, ff, e.id, off, REQ.q, REQ.t);
  }
  // cut to beat tb of the current song at boundary time T (a loop or a jump)
  function jump(T, tb, xf, tail, kind) {
    const old = S.seg, off = S.cue.beats[tb], ff = T - S.base;
    S.prevBase = S.base; S.jumpT = T; S.prevE = S.e;
    S.base = T - off;
    S.seg = newSeg(S.e, T - xf, off - xf, xf);
    fadeOut(old, T - xf, xf, tail);
    S.endAt = S.base + S.cue.end;
    if (S.then === 'stop') endFade();
    setBoundary(tb + 1);
    if (kind === 'loop') stats.loops++; else stats.jumps++;
    log(kind, T, S.e.id, ff, S.e.id, off, kind === 'jump' ? REQ.q : 'bar', kind === 'jump' ? REQ.t : -1);
  }
  function endFade() {   // the ending: let the file play out, a gentle fade over its last moments
    const g = S.seg.g.gain, t1 = S.endAt, t0 = Math.max(ac.currentTime + .05, t1 - TUNE.endFade);
    g.setValueAtTime(1, t0); g.linearRampToValueAtTime(0, t1);
  }
  function stopAt(T, fade) {
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.stopAt <= T) continue;
      hold(s.g.gain, T); s.g.gain.setTargetAtTime(0, T, Math.max(.01, fade / 4)); s.stopAt = T + fade + .05;
      try { s.src.stop(s.stopAt); } catch (err) {}
    }
    log('stop', T, S.e ? S.e.id : '', T - S.base, '', -1, REQ.q, REQ.t);
    S.playing = false; S.seg = null; S.bt = Infinity; S.endAt = Infinity;
  }

  function due(bi) {
    const q = REQ.q;
    if (q === 'beat') return true;
    const bar = barOf(bi);
    if (bar < 0) return false;
    if (q === 'phrase') return ((bar - S.ra) % 4 + 4) % 4 === 0 || ac.currentTime - REQ.t > TUNE.phraseWait;
    return true;   // 'bar'
  }
  function apply(T) {
    const bi = S.bi, k = REQ.kind;
    REQ.on = false;
    if (k === 'stop') { stopAt(T, REQ.fade); return; }
    if (k === 'song') {
      const e = songs.get(REQ.song);
      if (e === S.e) { REQ.kind = 'role'; }   // already this song: just its role
      else { startSong(T, e, REQ.role, REQ.fade, TUNE.xfSong, TUNE.xfSong); return; }
    }
    // a role in the current song
    const leaving = S.role, inBar = ((bi - S.cue.bars0) % 4 + 4) % 4;
    if (leaving === 'main' && REQ.role !== 'main') S.resumeBar = Math.min(S.rb - 4, S.ra + Math.ceil((barAt(bi) - S.ra) / 4) * 4);
    region(REQ.role);
    let tb = beatOfBar(S.ra);
    if (REQ.resume && S.role === 'main' && S.resumeBar >= S.ra && S.resumeBar < S.rb) tb = beatOfBar(S.resumeBar);
    if (REQ.q === 'beat') tb += inBar;   // keep the place in the bar
    if (tb === bi) { setBoundary(bi + 1); log('stay', T, S.e.id, T - S.base, S.e.id, S.cue.beats[bi], REQ.q, REQ.t); return; }   // already there
    jump(T, tb, TUNE.xfJump, REQ.tail, 'jump');
  }
  function regionEnd(T) {
    const nx = then2 || S.then;
    if (nx && nx !== 'stop' && S.cue.roles[nx]) { region(nx); jump(T, beatOfBar(S.ra), TUNE.xfJump, false, 'then'); }
    else jump(T, beatOfBar(S.ra), TUNE.xfJump, false, 'loop');
  }

  function tick() {
    const c0 = offline ? 0 : performance.now();
    const now = ac.currentTime, H = now + TUNE.lookahead;
    stats.ticks++;
    if (REQ.on && !S.playing) {
      if (REQ.kind === 'song') { const e = songs.get(REQ.song); if (e?.buf) { REQ.on = false; startSong(now + TUNE.minLead, e, REQ.role, REQ.fade, 0, 0); } }
      else REQ.on = false;
    }
    if (REQ.on && REQ.q === 'now' && S.playing) {   // not on the grid: at once, with a crossfade
      const T = now + TUNE.minLead;
      if (REQ.kind === 'stop') { REQ.on = false; stopAt(T, REQ.fade); }
      else if (REQ.kind === 'song' && songs.get(REQ.song) !== S.e) { const e = songs.get(REQ.song); if (e?.buf) { REQ.on = false; startSong(T, e, REQ.role, REQ.fade, Math.max(TUNE.xfSong, REQ.fade), 0); } }
      else REQ.q = 'beat';
    }
    let guard = 0;
    while (S.playing && S.bt < H && guard++ < 64) {
      if (S.bt - TUNE.xfJump < now + .005) { stats.late++; setBoundary(S.bi + 1); continue; }   // a stalled timer: that boundary is gone
      const bar = barOf(S.bi);
      if (bar >= 0) S.bar = bar;
      if (REQ.on && (REQ.kind !== 'song' || songs.get(REQ.song)?.buf) && S.bt - (REQ.kind === 'song' ? TUNE.xfSong : TUNE.xfJump) >= now + .015 && due(S.bi)) { apply(S.bt); continue; }
      if (bar >= 0 && bar >= S.rb && S.then !== 'stop') { regionEnd(S.bt); continue; }
      setBoundary(S.bi + 1);
    }
    if (S.playing && now >= S.endAt) { S.playing = false; S.ended = true; S.seg = null; S.bt = Infinity; log('end', S.endAt, S.e.id, S.cue.end, '', -1, '', -1); }
    if (!offline) stats.tickMs = stats.tickMs * .98 + (performance.now() - c0) * .02;
  }

  // ---- requests (the latest wins until it is applied)
  function request(kind, o) {
    REQ.on = true; REQ.kind = kind; REQ.q = o.q || 'bar'; REQ.role = o.role || 'main'; REQ.song = o.song || '';
    REQ.fade = o.fade ?? .05; REQ.tail = !!o.tail; REQ.resume = !!o.resume; REQ.sting = o.sting || ''; REQ.t = ac.currentTime; REQ.n++;
  }
  function play(id, o = {}) {
    const e = entry(id); if (!e) return false;
    load(id).catch(() => {});
    request('song', {q: o.q || 'beat', role: o.role || 'intro', song: id, fade: o.fade, sting: o.stinger});
    return true;
  }
  // a role in the current song; while a song switch is pending, the role that song starts in
  function goto(role, o = {}) {
    if (REQ.on && REQ.kind === 'song') { REQ.role = role; return; }
    if (!S.playing) return;
    if (role === S.role && S.cue.roles[role]) { if (REQ.on && REQ.kind === 'role') REQ.on = false; return; }   // already there: cancel a pending change
    request('role', {q: o.q, role, tail: o.tail, resume: o.resume});
  }
  const stop = (o = {}) => { if (S.playing) request('stop', {q: o.q || 'bar', fade: o.fade ?? 1.5}); else REQ.on = false; };

  // ---- the clock
  const fileTime = (t = ac.currentTime) => t - (S.jumpT >= 0 && t < S.jumpT ? S.prevBase : S.base);
  function nextIdx(t) {   // the first beat index whose ctx time is >= t (binary search; no allocation)
    const ft = fileTime(t), b = S.cue.beats;
    let lo = 0, hi = b.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b[m] < ft) lo = m + 1; else hi = m; }
    return lo;
  }
  const timeOf = (i, t) => (S.jumpT >= 0 && t < S.jumpT ? S.prevBase : S.base) + S.cue.beats[i];
  // (in the moment between a committed song switch and its beat, the old song's grid isn't the cue's: answer from the switch on)
  const from = t => (t < S.jumpT && S.prevE !== S.e ? S.jumpT : t);
  const clock = {
    now: () => ac.currentTime,
    fileTime,
    get bpm() { return S.cue ? S.cue.bpm : 0; },
    nextBeat(t = ac.currentTime + TUNE.minLead) { if (!S.playing) return t; t = from(t); const i = nextIdx(t); return i < nBeats() ? timeOf(i, t) : t; },
    nextBar(t = ac.currentTime + TUNE.minLead) { if (!S.playing) return t; t = from(t); let i = nextIdx(t); while (i < nBeats() && barOf(i) < 0) i++; return i < nBeats() ? timeOf(i, t) : t; },
    nextPhrase(t = ac.currentTime + TUNE.minLead) { if (!S.playing) return t; t = from(t); let i = nextIdx(t); while (i < nBeats() && (barOf(i) < 0 || ((barOf(i) - S.ra) % 4 + 4) % 4)) i++; return i < nBeats() ? timeOf(i, t) : t; },
  };

  // ---- stingers: on the next beat (or bar) of the playing song; none without one (they belong to its grid)
  function stinger(kind, o = {}) {
    if (!S.playing) return -1;
    const t = ac.currentTime + TUNE.minLead;
    const T = o.q === 'now' ? t : o.q === 'bar' ? clock.nextBar(t) : clock.nextBeat(t);
    if (kind !== 'echo') { drum(kind, T, o.db || 0); return T; }
    // the song's own beat at T, doubled for a few tens of ms: an accent in its own key and sound
    if (!S.e?.buf || (T < S.jumpT && S.prevE !== S.e)) return -1;
    const src = ac.createBufferSource(), g = ac.createGain();
    {
      src.buffer = S.e.buf;
      g.gain.setValueAtTime(0, T); g.gain.linearRampToValueAtTime(DB(S.cue.gainDb + (o.db || 0)), T + .003);
      g.gain.setTargetAtTime(0, T + .012, .07);
      src.start(T, Math.max(0, fileTime(T)), .5);
    }
    src.connect(g); g.connect(lp);
    src.onended = () => { try { g.disconnect(); } catch (err) {} };
    stats.stingers++;
    log('sting:echo', T, S.e.id, fileTime(T), '', -1, o.q || 'beat', ac.currentTime);
    return T;
  }

  function drum(kind, T, db) {
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = DRUM[kind] || DRUM.thump; g.gain.value = DB(TUNE.stingDb + db);
    src.connect(g); g.connect(lp); src.start(T);
    src.onended = () => { try { g.disconnect(); } catch (err) {} };
    stats.stingers++;
    log(kind === 'boom' ? 'sting:boom' : kind === 'hit' ? 'sting:hit' : 'sting:thump', T, S.playing ? S.e.id : '', S.playing ? fileTime(T) : -1, '', -1, 'beat', ac.currentTime);
  }

  // ---- the mix controls (the director's)
  let lpHz = TUNE.lpOpen;   // the director's low-pass (the tape stop sweeps it down, then puts this back)
  const setFilter = (hz, tc = .2) => { const t = ac.currentTime; lpHz = Math.min(TUNE.lpOpen, Math.max(60, hz)); hold(lp.frequency, t); lp.frequency.setTargetAtTime(lpHz, t, tc); };
  const setDuck = (db, tc = .2) => { const t = ac.currentTime; hold(duck.gain, t); duck.gain.setTargetAtTime(DB(db), t, tc); };
  const setVolume = (g, tc = .05) => { const t = ac.currentTime; hold(vol.gain, t); vol.gain.setTargetAtTime(Math.max(0, g), t, tc); };
  function pulse(db, holdS = .05, release = .12) {   // a tiny duck (hitstop): down in 5 ms, held, back
    const t = ac.currentTime, p = pulseG.gain;
    hold(p, t); p.setTargetAtTime(DB(db), t, .005); p.setTargetAtTime(1, t + .01 + holdS, release / 3);
  }
  function tapeStop(sec = 1.5) {   // the reels stop: speed and pitch fall together, the last part fades; then silence
    const t = ac.currentTime + .01;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]; if (s.stopAt <= t) continue;
      try { hold(s.src.playbackRate, t); s.src.playbackRate.setValueCurveAtTime(TAPE_RATE, t, sec); } catch (err) {}
      hold(s.g.gain, t); s.g.gain.setValueCurveAtTime(TAPE_GAIN, t, sec);
      s.stopAt = t + sec + .02; try { s.src.stop(s.stopAt); } catch (err) {}
    }
    hold(lp.frequency, t); lp.frequency.setValueAtTime(Math.min(TUNE.lpOpen, lp.frequency.value || TUNE.lpOpen), t); lp.frequency.exponentialRampToValueAtTime(260, t + sec);
    lp.frequency.setValueAtTime(lpHz, t + sec + .05);
    log('tapestop', t, S.e ? S.e.id : '', S.playing ? fileTime(t) : -1, '', -1, 'now', t);
    S.playing = false; S.seg = null; S.bt = Infinity; S.endAt = Infinity; REQ.on = false;
  }

  let timer = null;
  if (!offline && typeof setInterval === 'function') timer = setInterval(() => { if (ac.state === 'running') { try { tick(); } catch (err) { stats.errors++; console.warn('tracks', err); } } }, TUNE.tick);

  return {
    load, ready: id => !!songs.get(id)?.buf, failed: id => !!songs.get(id)?.failed, play, goto, stop, stinger, tick, clock, tapeStop, setFilter, setDuck, setVolume, pulse,
    setThen(role) { then2 = role || ''; },
    get state() { return S; }, get request() { return REQ; }, stats, LOG, songs, segs, TUNE, ac,
    get playing() { return S.playing; }, get song() { return S.playing ? S.e.id : ''; }, get role() { return S.playing ? S.role : ''; },
    get ended() { return S.ended; },
    dispose() { if (timer) clearInterval(timer); for (const s of segs) { try { s.src.stop(); } catch (err) {} } try { vol.disconnect(); } catch (err) {} },
  };
}
