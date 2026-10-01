# Audio runtime: contract (Phase 2)

How forge sounds reach the game. Design reasoning is in `docs/AUDIO.md` §3. Files live in `audio/runtime/`, as plain
ES modules that are engine-agnostic: the arena uses them now, and the game can later.

```
 game events ──► arena/audio.js ──► director.post(name, params) ──► events.js (data) ──► engine.play(...)
                 (keeps its old synth                │                                      ▲
                  as the fallback)                   └── bakery.get(recipe, case) ──────────┘ (AudioBuffers baked
                                                                                               in a Worker at load)
```

## bakery.js: background baking (Worker)
```js
export function createBakery(ac, {workers = 'auto'} = {}) -> B
  // 'auto' = 2 module workers when navigator.hardwareConcurrency >= 4, else 1. Bakes at ac.sampleRate.
  // The AudioContext may still be suspended; that's fine (tested).
B.request(recipe, caseName, {variants = null, priority = 5, seeds = null}) -> Promise<Bank>
  // variants null = the recipe's own `variants` (fallback 6). Queued by priority (lower runs first, ties FIFO);
  // one job = one (recipe, case) with all its seeds. A duplicate request returns the same promise (and can raise the
  // priority of a job that is still queued). An unknown recipe or case rejects.
B.get(recipe, caseName) -> Bank | null          // only once it is fully baked
B.ready(recipe, caseName) -> boolean
B.prefetch([{recipe, case, variants?, priority?, seeds?}, ...]) -> Promise<allSettled results>
B.stats -> {queued, baking, done, failed, ms (sum of worker bake ms), buildMs (main-thread AudioBuffer copies), wallMs,
            bytes, workers, restarts, errors: string[] (last 20)}
B.onReady(fn) -> unsubscribe                    // fn(bank) each time a bank completes (the director uses it to swap in beds)
B.banks() -> Bank[]                             // every finished bank (memory reports)
B.dispose()                                     // terminate the workers, reject what is pending
// Bank = {recipe, case, loop: bool, buffers: AudioBuffer[], version, seeds, bytes, ms, buildMs, wallMs,
//         metrics: [{lufsM, durMs, truePeakDb, ..., onsetCount, gainDb, pass, fails}]}   (one metrics entry per variant)
```
- `bake.worker.js` imports `../forge/forge.js` and the recipe module, calls `bake(recipe, case, seed, sr)` per seed, and
  posts one message per job, `{ch: Float32Array[][] (per variant, per channel), metrics, version, loop, seeds, ms}`,
  transferring every channel buffer.
- The main thread wraps them with `ac.createBuffer` + `copyToChannel` (measured: ~0.1 ms for a one-shot bank, ~3 ms for
  4 × 9.5 s stereo loops).
- Seeds default to `1..variants`.
- A failure (an exception in a recipe, a missing module) rejects that request only and is counted; it never stops the
  queue. A failed job is forgotten, so a later request retries it. A crashed worker is restarted (up to 3 times).
- Cache: in memory for the session. IndexedDB is optional, later, keyed by `recipe@version:case:seed:sr`.
- Memory: AudioBuffers are float32. A 4-variant stereo loop bank (stream, wind, fire, rift) is ~14 MB; request beds with
  `variants: 1` or `2` when only `buffers[0]` is played.

## engine.js: the mix, voices, space
```js
export function createEngine(ac, {maxVoices = 32, minDist = 2, maxDist = 25, lpfStart = 3, lpfFar = 4000, panLimit = .8,
                                  reverb = 'ruins'} = {}) -> EN
// bus tree (GainNodes): 'master' -> limiter -> trim -> destination
//   'music' | 'amb' ('amb.beds', 'amb.spots', 'amb.emitters') | 'sfx' ('sfx.player', 'sfx.impacts', 'sfx.world', 'sfx.foot') | 'ui'
//   | 'reverb' (the reverb return). An unknown dotted name is created under its parent on first use ('sfx.enemies').
//   Every bus has a mirrored wet path with the same gains and ducks, so a muted or ducked bus mutes its reverb too.
EN.bus(name) -> GainNode                        // connect external sources (the arena's music.js, the legacy synth) here
EN.setBusDb(name, db, tc = .05)                 // tc = setTargetAtTime time constant (s); also on 'master' and 'reverb'
EN.play(buffer, opts) -> Voice | null           // null = culled, rejected, coalesced, or skipped (context not running)
  opts = {bus: 'sfx', gainDb: 0, rate: 1, pan: 0 (-1..1), dist: 0 (m), lpf: null (Hz, overrides the distance LPF),
          send: .15 (0 on 'ui*' / 'music*'), at: null (ac time), priority: 50 (0..100), key: null (instance group; no
          key = no per-key limit or coalescing), maxInstances: 6, steal: 'quietest' | 'oldest' | 'furthest' | 'none',
          coalesceMs: 0, cullDb: -40, minDist, maxDist}
  Voice = {key, t0, dur, count (merged plays), playing, stop(fade = .015)}
  // voice chain: BufferSource -> gain -> (BiquadFilter lowpass only past lpfStart = 3 m, or when lpf is given)
  //   -> StereoPanner -> bus; StereoPanner -> send gain -> the bus's wet path -> reverb.
  // distance model (top-down): 0 dB within minDist (2 m), then -6 dB per doubling, culled past maxDist (25 m);
  // distance low-pass 20 kHz → 4 kHz at maxDist (exponential in distance from 3 m); equal-power StereoPanner, pan
  // clamped to ±0.8. The reverb send loses only half the distance attenuation (-3 dB per doubling): far = wetter.
  // cull: gainDb + distance dB < cullDb (or dist > maxDist) -> null before any node is created.
  // coalescing: a play of the same key within coalesceMs of the newest voice's start merges into it (+2 dB per
  // doubling of the count, max +6 dB, 3 ms ramp) instead of starting a new one.
  // per key: at maxInstances, steal by policy ('none' = reject the new play).
  // global cap maxVoices; a new voice below the lowest active priority is rejected, otherwise the weakest (lowest
  // priority, then quietest by a rough level-minus-elapsed-decay estimate) is stolen with a 15 ms fade.
  // Effective priority drops by up to 20 at maxDist. Nodes are disconnected in onended.
  // While the context isn't running, play() returns null (stats.skipped), so nothing piles up and fires at unlock.
EN.loop(buffer, opts) -> LoopHandle             // seamless (BufferSource.loop). opts: {bus = 'amb', gainDb, pan, dist, lpf, send,
                                                //   fadeIn = 1.5, offset = 0 (s), rate = 1, cullDb = -50}
  LoopHandle: {setGainDb(db, tc = .1), setPan(p, tc), setLpf(hz | null, tc), setDist(m, tc), setSend(x, tc),
               stop(fadeOut = 1.5), playing, virtual, ended: Promise}
  // fades are equal-power (sin in / cos out), from the current value, so a stop during a fade-in doesn't click.
  // setLpf(null) returns to the distance low-pass. Virtual voice: when dist > maxDist or the level < cullDb the
  // source is stopped (50 ms fade) and the clock kept; it restarts at elapsed % duration when audible again.
  // A loop created while the context is suspended starts (with its fade-in) when it resumes.
EN.snapshot(name, {buses: {'amb': -6, 'music': -4}, attack = .02, hold = .1, release = .6}) -> {name, release(rel?)}
  // stacked ducks: each snapshot is an attack/hold/release envelope (linear in dB) on a per-bus duck gain, separate
  // from the bus's base level; active snapshots add in dB and the bus returns to its base level after release.
  // Re-firing the same name restarts it from its current depth (it doesn't stack with itself).
  // hold: Infinity holds until handle.release() (pause, low-HP).
EN.setReverb(biome, fade = 1)                   // 'ruins' | 'ember' | 'frost' | 'rift': a synthetic IR per biome, crossfaded
  // RT60 (measured): ruins 0.9 s, ember 0.6 s, frost 1.4 s, rift 2.2 s; damping per biome (the tail darkens). A new
  // ConvolverNode gets its .buffer before it is connected; the old one fades out (equal-power) and is disconnected.
EN.prepareReverbs(list?)                        // build the IRs at load (6-23 ms each, main thread) instead of at the switch
EN.limiter                                      // the master DynamicsCompressor (threshold -3, ratio 20, knee 0, attack 1 ms,
                                                // release 150 ms), followed by a -1.62 dB trim that cancels Chrome's auto makeup
EN.output                                       // the final node before destination (analysers, capture)
EN.unlock() -> Promise                          // call inside a user gesture: resume + a 1-sample silent buffer (iOS)
EN.stats -> {voices, peakVoices, loops, virtual, played, culled, stolen, coalesced, rejected, skipped, reverbSlots}
EN.resetStats(), EN.stopAll(fade = .05)
// An OfflineAudioContext counts as running: the same graph renders offline (the tests do this).
```

## events.js: data only
```js
export const EVENTS = {
  // keyed by the names arena/audio.js already fires (see that file's SFX object and its event switch)
  hit: {
    bus: 'sfx.impacts', priority: 60, maxInstances: 6, steal: 'quietest', coalesceMs: 40, gainDb: -2,
    pitchSemi: 1.5, gainJitDb: 2,                 // runtime variation on top of the baked variants
    send: .15,
    pick: o => ({recipe: 'impact', case: {wood: 'wood', clay: 'clay', straw: 'straw', glass: 'crystal', body: 'flesh'}[o.mat] || 'wood'}),
    variants: 6, bakePriority: 1,                 // what the bakery prefetches, and how early
    gainFrom: o => (o.g ? 20 * Math.log10(o.g) : 0),   // map the caller's params to extra dB
  },
  ...
};
export const AMBIENCE = {   // per biome: beds (forge loops), spots (random one-shots), emitters (positional loops)
  ruins: {beds: {day: [{recipe: 'wind', case: 'breeze', gainDb: -8}], night: [...]},
          spots: [{recipe: 'creature', case: 'songbird', every: [6, 18], time: ['day'], gainDb: -14}, ...],
          emitters: [{recipe: 'stream', case: 'brook', at: 'stream', gainDb: -6}]},
  ...
};
```
- `pick` returns `{recipe, case}` or an array of layers `[{recipe, case, gainDb, delayMs}]`.
- An event whose bank isn't baked yet makes `director.post` return `false`, and the caller plays its legacy sound.

## director.js: glue
```js
export function createDirector(engine, bakery, {EVENTS, AMBIENCE}) -> D
D.prefetch()                                     // request every bank EVENTS / AMBIENCE use, by bakePriority
D.post(name, params) -> boolean                  // params: {x, y, pan, dist, mat, surf, kind, k, g, n, small, ...}
  // picks the bank (EVENTS[name].pick), a variant (avoid last 2), pitch / gain jitter, then engine.play(...)
D.ambience.update({biome, time, listener: {x, y}, stream: {prox, pan}, dt})   // beds crossfade on biome / time change,
  // spots fire on their timers, emitters follow position. Uses forge loops once baked.
D.ready(name) -> boolean
D.stats
```
