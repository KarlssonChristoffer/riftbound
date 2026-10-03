# Writing a forge recipe: rules and lessons

Read with `docs/AUDIO.md` (the models, §2.3) and `recipes/index.js` (the contract). This file holds the practical rules
and what the user's first rating pass taught us (2026-10-01).

## The user's ear (from forge-ratings.json)
- **Loved:** bubbly tonal water plunks (5/5), a crunchy satisfying splinter break, stone and crystal hits, the pot break.
- **Rejected:**
  - **"Hollow"** wood and clay: modal impacts that ring like a box or marimba. Solid things are dense, heavily damped
    "thocks": a strong transient, low q, fast decay, no sustained cavity tone.
  - **"Blocky"** envelopes: every layer must decay naturally. No gated, rectangular or truncated tails.
  - **"Clinky"** metal dominating a wooden object. The material must match the label ("woody and sturdy" crate).
  - **"Too heavy"** footsteps. The hero is a light, agile ranger in soft leather: nimble, quiet, little low end.
  - **"Dripping on wetness"**: textures made of distinct events. Flowing or continuous sounds (water, wind, fire) need
    a continuous bed layer, with the events sitting on top of it.
- If a sound is good but doesn't fit its label, the user wants it kept under a new name, not changed.
- **Second listening pass (2026-10-01):**
  - **"Incredibly disturbing white noise, too loud and annoying"** in every nature texture (water flow, lava, wind,
    campfire).
  - **"Other sound effects are just too high"**: too bright and shrill overall.

## Brightness rules (hard requirements after the second pass)
1. **No static noise beds.** A continuous broadband noise layer (white or pink hiss, "shhh") is not allowed as a
   foreground layer.
   - Continuous beds must be DARK: brown or low-passed pink, rolled off steeply above about 1.5–2.5 kHz (24 dB/oct or
     more), and slowly, organically modulated.
   - High frequencies in textures come only from SPARSE, discrete grains (sparks, droplets, leaf ticks), well under
     the body: at least 15–20 dB below the bed's peak band.
   - Measured on the bake: energy above 4 kHz ≤ about -18 dB relative to the total (≤ 1.5%); for textures `highHz`
     (the 95% band edge) ≤ about 4 kHz, and `flatness` low.
2. **Darker one-shots.**
   - For everything except deliberately bright cues (coins, sparkles, glass, UI ticks), aim the spectral centroid
     roughly an octave lower than "physically bright".
   - Keep the energy in about 150 Hz–3 kHz, with a gentle high-shelf of -6 to -12 dB above about 5 kHz. Avoid shrill
     2–6 kHz peaks and long tonal rings above 2 kHz.
   - Transients may be crisp, but short.
3. **Think "warm game mix",** not "field recording through a bright mic". When in doubt, darker.

## The western-movie guns (2026-10-03): a deliberate exception
The user on the dark v2 guns: "I don't like the sounds, we should try to make them sound more 'western movie'". The gun
sounds (recipes revolver.js v3, coachgun.js v2, bullet.js v2: the `spaghetti_` / `hollywood_` / `gritty_` cases, picked by
audio/runtime/events.js GUN_SFX) are deliberately bright cues: a gunshot's crack, the cock's double click and the falling
ricochet whine may reach 3-7 kHz, and their echoes and tails are long (baked in, not a convolver). Still binding for them:
no hollow / boxy ringing (impacts die in a few periods; only metal "ptangs" ring, ~0.06-0.2 s, under ~4 kHz), no static
hiss (every tail is two one-pole low-passes darkening over its decay), what you hear is on screen (events.js SPATIAL), and
rule 2 (every echo and tail sized to -80 dB). Measure loudness by the transient too (the first 50 ms, K-weighted): the
forge's -20 LUFS normalises the loudest 400 ms, which a wet shot shares with its echoes.

## Rules
1. Follow the contract:
   - deterministic: all randomness from `R`; `R.fork(k)` for independent layers; never `Math.random`
   - pure JS: no Web Audio
   - `render()` returns DRY audio: mono for one-shots, `[L, R]` for loops and wide textures
2. **Never truncate a decay.** Size every buffer from its own decay: long enough to reach about -80 dB, then a short
   raised-cosine end fade. A fixed-length noise buffer with a slow decay leaves a hard edge, which shows as a vertical
   wall in the spectrogram.
3. **Loops** (`loop: true`) must be seamless:
   - Place events on a circular timeline and fold rings past the end back to the start.
   - Run IIR filters circularly (warm the state on the tail first).
   - Give every LFO a whole number of cycles per loop.
   - Keep the level steady (the standard deviation of 400 ms window levels a few dB at most), with no recognisable
     repeating event.
   - The forge DC-blocks loops circularly.
4. **Pass criteria must be honest.** Validate every case on 24 or more seeds, INCLUDING 44291–44296 (the lab's
   default seeds) and some large random seeds. Bound attackMs, t60Ms, centroidHz, lowHz/highHz, flatness, durMs, and
   onsetCount/onsetRate where the physics is clear, and always `clickEnd: [0, .01]` for one-shots.
5. **Variants must differ** but keep one identity. Aim for a variant similarity of about 0.75–0.95 (the forge prints
   it). Vary the event structure, not only pitch.
6. **Budget:** about 20 ms of `render()` per one-shot at 48 kHz, about 400 ms per loop.
7. Bump `version` whenever the sound changes. Set `lufs` only if the sound is meant to sit quieter or louder than
   -20 at the forge stage (normally leave it).
8. Keep helpers inside your own recipe file. Shared kernel changes go through the lead (list them in your report as
   "kernel candidates").
9. Never draw from `R` inside a per-sample callback (an energy or envelope function): it silently changes the shape
   on every sample. Draw the random values once, outside the callback, and close over them.
10. Put scratch scripts in your OWN subfolder of the session scratchpad: parallel agents overwrite each other's files.

## Loop for each recipe
1. `node tools/sfx/forge.mjs <id> --seeds 6 [--case x]` (from D:\Game). It writes WAV + PNG + metrics to
   `audio/forge/out/<id>/`.
2. Read the PNGs (use `limit: 100000` for big files). Each one shows the waveform on top, then log frequency
   30 Hz..Nyquist, with guides at 100 Hz / 1 kHz / 10 kHz and absolute dBFS colour.
   - Check: natural decays, no edges, a sensible band, a believable event structure.
3. Compare with any reference in `audio/forge/refs/` (the ElevenLabs takes measured at -20 LUFS), and against the
   physics in AUDIO.md §2.3.
4. Fix and repeat until it is GOOD, not just passing. The user rates everything by ear in `/audio/forge/lab.html`.
