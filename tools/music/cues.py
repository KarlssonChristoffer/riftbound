# CUES: builds the battle-music cue sheets (src/content/cues.js) for the file-music player (src/audio/tracks.js).
# Source: the offline analysis of the Six Chambers Suno tracks (tmp/western/music_probe/analyze.py -> cues/<name>.json:
# tempo, a tracked beat grid, bars, sections, loop candidates). This script REFINES that into what a runtime can jump on:
#   1. the beat grid, re-fitted on the shipped OGG with a fine onset envelope (2.7 ms hop): the tracked beats wobble
#      +-10..30 ms (tracker noise), which would make every bar-line jump stumble. A global (period, phase) fit by folding
#      the onset envelope, then a drift check in 32-beat windows (piecewise-linear offsets only where the song drifts).
#   2. bars (4/4; the downbeat phase is the one with the most low-band onset, i.e. the kick), per-bar loudness, onset
#      density, intensity (as the probe: .65 loudness + .35 onset density, normalised per song), and a feature vector
#      (chroma + band timbre) for bar similarity.
#   3. sections: the probe's boundaries, moved to the refined bars.
#   4. ROLES, by clear heuristics over the sections' intensity (see roles() below): intro, low, main, drive, peak, ending;
#      each a loop range [a, b) on bar lines, phrase-aligned, chosen where the bar after the loop end looks like the
#      loop's first bar (the seam is then inaudible), plus the ending (the final hit and its natural ring-out).
#   5. the per-song gain: its integrated loudness (BS.1770 K-weighting in the frequency domain, gated) to TARGET_LUFS.
#   python tools/music/cues.py            (numpy + soundfile; ~1 min)  -> src/content/cues.js, tmp/western/bmusic/cues_report.txt
import json, math, os, sys
import numpy as np
import soundfile as sf

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = 'D:/Game/assets/src/cowboygameboy/music_ogg'
PROBE = 'D:/Game/tmp/western/music_probe/cues'
OUT = os.path.join(ROOT, 'src', 'content', 'cues.js')
REPORT = 'D:/Game/tmp/western/bmusic/cues_report.txt'
# the level each kind of song is brought to (integrated LUFS, K-weighted, after its gain; the masters sit at -9..-16).
# docs/AUDIO.md's mix: the procedural score plays ~ -36.7 idle / -33 in combat (LUFS-M), combat SFX -20..-22
TARGET_LUFS = {'waves': -33.5, 'boss': -33.0, 'calm': -36.5, 'saloon': -35.5}

# id, file (folder/name, exactly as on disk: Dead Man's Reload's apostrophe is stored as the 3 characters U+00E2 U+20AC
# U+2122, a mis-decoded U+2019), what it is for
SONGS = [
    ('reload', 'tempo/Dead Man\u00e2\u20ac\u2122s Reload', 'waves'),
    ('dust', 'tempo/dust', 'waves'),
    ('dawnraid', 'boss/Black Smoke Cavalry - Dawn Raid', 'waves'),
    ('iron', 'boss/Iron Dust Showdown', 'boss'),
    ('cavalry', 'boss/Black Smoke Cavalry', 'boss'),
    ('rust', 'boss/Rust Spurs in the Machine', 'boss'),
    ('coyote', 'boss/Coin-Op Coyote Showdown', 'boss'),
    ('sunset', 'relax/Last Sunset in 16 Bits - Pixel Lullaby', 'calm'),
    ('rag', 'saloon/Tipsy Tumbleweed Rag - Saloon', 'saloon'),
]
N, HOP = 1024, 128
log = []


def say(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); log.append(s)


def stft_mag(x):
    win = np.hanning(N).astype(np.float32)
    nfr = 1 + (len(x) - N) // HOP
    out = np.empty((nfr, N // 2 + 1), np.float32)
    for s in range(0, nfr, 4096):
        e = min(nfr, s + 4096)
        idx = np.arange(s, e)[:, None] * HOP + np.arange(N)[None, :]
        out[s:e] = np.abs(np.fft.rfft(x[idx] * win, axis=1))
    return out


def band_energy(mag, sr, lo=30, hi=12000, nb=32):
    f = np.fft.rfftfreq(N, 1 / sr)
    edges = np.geomspace(lo, hi, nb + 1)
    B = np.stack([(mag[:, (f >= a) & (f < b)] ** 2).sum(1) for a, b in zip(edges[:-1], edges[1:])], 1)
    return B, edges


def chroma(mag, sr):
    f = np.fft.rfftfreq(N, 1 / sr)
    ok = (f > 400) & (f < 5000)
    pc = (np.round(12 * np.log2(f[ok] / 440.0)) % 12).astype(int)
    P = mag[:, ok] ** 2
    return np.stack([P[:, pc == k].sum(1) for k in range(12)], 1)


def interp(env, fps, t):
    """onset envelope at times t (s), linear interpolation (frame i is centred at i / fps + N / 2 / sr)."""
    i = np.asarray(t) * fps
    i0 = np.clip(np.floor(i).astype(int), 0, len(env) - 2); fr = np.clip(i - i0, 0, 1)
    return env[i0] * (1 - fr) + env[i0 + 1] * fr


def fold(env, fps, P, t_from=0.0, t_to=None, bins=None):
    """the onset envelope folded with period P: energy per phase bin (1 ms), circularly smoothed."""
    nb = bins or max(8, int(round(P * 1000)))
    t = np.arange(len(env)) / fps
    sel = (t >= t_from) & (t < (t_to if t_to is not None else 1e9))
    ph = np.mod(t[sel], P) / P * nb
    h = np.bincount(ph.astype(int) % nb, weights=env[sel], minlength=nb)
    k = np.array([.25, .5, 1, .5, .25])
    hs = sum(np.roll(h, j - 2) * k[j] for j in range(5))
    return hs, nb


def fit_grid(env, fps, p0, dur):
    best = (-1, 0, 0)
    for P in p0 * (1 + np.linspace(-.004, .004, 321)):
        h, nb = fold(env, fps, P)
        i = int(np.argmax(h))
        if h[i] > best[0]: best = (h[i], P, i / nb * P)
    _, P, ph = best
    for P2 in P * (1 + np.linspace(-.0002, .0002, 81)):   # finer
        h, nb = fold(env, fps, P2, bins=int(round(P2 * 4000)))
        i = int(np.argmax(h))
        if h[i] > best[0]: best = (h[i], P2, i / nb * P2)
    _, P, ph = best
    # drift: the best phase offset in 32-beat windows, against the global grid (+-40 ms)
    offs, ctr = [], []
    W = 32 * P
    for w0 in np.arange(0, dur - W, 16 * P):
        h, nb = fold(env, fps, P, w0, w0 + W, bins=int(round(P * 1000)))
        g = int(round(ph / P * nb)) % nb
        rng = np.arange(-40, 41)
        sc = h[(g + rng) % nb]
        j = int(np.argmax(sc))
        # confident only when the window's peak stands well over its folded mean (weak rhythm: intros, breaks)
        offs.append(rng[j] / 1000.0 if sc[j] > 2.2 * h.mean() else np.nan); ctr.append(w0 + W / 2)
    offs, ctr = np.array(offs), np.array(ctr)
    ok = ~np.isnan(offs)
    if ok.sum() >= 2: offs = np.interp(ctr, ctr[ok], offs[ok])   # unsure windows take their confident neighbours' offset
    else: offs = np.zeros_like(ctr)
    return P, ph, offs, ctr


def lufs_integrated(x, sr):
    """BS.1770-style integrated loudness: K-weighted energy of 400 ms blocks (75% overlap; the weighting applied as |H|^2
    on each block's spectrum), absolute gate -70, relative gate -10."""
    n, h = int(.4 * sr), int(.1 * sr)
    f = np.fft.rfftfreq(n, 1 / sr); z = np.exp(-2j * np.pi * f / sr)
    biq = lambda b, a: np.abs((b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)) ** 2
    W = biq([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]) * biq([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
    E = []
    for s in range(0, len(x) - n, h):
        e = 0.0
        for c in range(x.shape[1]):
            X = np.fft.rfft(x[s:s + n, c]); e += float((np.abs(X) ** 2 * W).sum()) * 2 / (n * n)
        E.append(e)
    E = np.array(E); L = -0.691 + 10 * np.log10(E + 1e-12)
    g1 = E[L > -70]; Lg = -0.691 + 10 * np.log10(g1.mean())
    g2 = g1[-0.691 + 10 * np.log10(g1 + 1e-12) > Lg - 10]
    return float(-0.691 + 10 * np.log10(g2.mean()))


def bar_vectors(mag, sr, fps, bars_t, dur):
    B, edges = band_energy(mag, sr, 60, 8000, 8)
    CH = chroma(mag, sr)
    V = []
    for i in range(len(bars_t)):
        a = int(bars_t[i] * fps); b = int((bars_t[i + 1] if i + 1 < len(bars_t) else min(dur, bars_t[i] + (bars_t[i] - bars_t[i - 1]))) * fps)
        b = max(a + 1, min(b, len(CH)))
        ch = CH[a:b].sum(0); ch = ch / (np.linalg.norm(ch) + 1e-9)
        tb = np.log1p(B[a:b].mean(0) * 1e3); tb = (tb - tb.mean()) / (tb.std() + 1e-9)
        V.append(np.concatenate([ch, tb * .35]))
    V = np.array(V); return V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)


def analyse(sid, name, use, levels):
    x, sr = sf.read(f'{SRC}/{name}.ogg', dtype='float32')
    xm = x.mean(1) if x.ndim > 1 else x
    dur = len(xm) / sr
    probe = json.load(open(f'{PROBE}/{os.path.basename(name)}.json', encoding='utf-8'))
    mag = stft_mag(xm); fps = sr / HOP
    B, edges = band_energy(mag, sr)
    LB = np.log1p(B * 1e3)
    flux = np.maximum(0, np.diff(LB, axis=0, prepend=LB[:1]))
    on = flux.sum(1); on = np.maximum(0, (on - on.mean()) / (on.std() + 1e-9))
    low = flux[:, edges[1:] < 160].sum(1)
    # frame i covers samples [i*HOP, i*HOP+N): its onset belongs to ~ the frame's centre: shift by N/2
    shift = (N / 2) / sr
    env = np.concatenate([np.zeros(int(round(shift * fps))), on])
    lowe = np.concatenate([np.zeros(int(round(shift * fps))), low])
    P, ph, offs, ctr = fit_grid(env ** 1.5, fps, probe['beat_period'], dur)
    drift = float(np.ptp(offs)) if len(offs) else 0.0
    # beats: the grid (+ the window offsets, interpolated, where the song drifts by more than 4 ms)
    k0 = -int(ph // P)
    kk = np.arange(k0, int((dur - ph) / P) + 2)
    bt = ph + kk * P
    use_off = len(offs) > 2 and drift > .004
    if use_off:
        om = np.array([np.median(offs[max(0, i - 1):i + 2]) for i in range(len(offs))])
        bt = bt + np.interp(bt, ctr, om)
    bt = bt[(bt >= -1e-3) & (bt < dur)]
    bt = np.maximum(bt, 0)
    # quality: onset on the grid vs half a beat off it (the probe's tracked beats, measured the same way)
    q = lambda ts: float(np.mean(interp(env, fps, ts)))
    fit_new = q(bt) / (q(bt[:-1] + P / 2) + 1e-9)
    pb = np.array(probe['beats'])
    fit_old = q(pb) / (q(pb[:-1] + P / 2) + 1e-9)
    # tracker noise: the probe's beats against the new grid
    near = bt[np.clip(np.searchsorted(bt, pb), 0, len(bt) - 1)]
    near2 = bt[np.clip(np.searchsorted(bt, pb) - 1, 0, len(bt) - 1)]
    dev = np.where(np.abs(pb - near) < np.abs(pb - near2), pb - near, pb - near2)
    # downbeat phase (which beat of 4 starts a bar): three votes, each normalised to its best phase: the kick (low-band
    # onset), harmony (chroma change across the beat) and form (novelty of 4-beat feature windows: sections start on a
    # downbeat; counted double), plus a small prior for the probe's own choice. (Kick and chords alone confuse beat 1
    # with beat 3; the form vote separates them.)
    sh = int(round(shift * fps))
    CH = np.concatenate([np.zeros((sh, 12)), chroma(mag, sr)])
    B16, _ = band_energy(mag, sr, 40, 10000, 16); L16 = np.log1p(B16 * 1e3)
    Fz = np.concatenate([CH / (CH.sum(1, keepdims=True) + 1e-9), np.concatenate([np.zeros((sh, 16)), (L16 - L16.mean(0)) / (L16.std(0) + 1e-9) * .15])], 1)
    nbt = len(bt) - 1
    bf = np.array([Fz[int(t * fps):max(int(t * fps) + 1, int((t + P) * fps))].mean(0) for t in bt[:-1]])
    nov = np.zeros(nbt); chg = np.zeros(nbt)
    for k in range(4, nbt - 4):
        nov[k] = np.linalg.norm(bf[k - 4:k].mean(0) - bf[k:k + 4].mean(0))
        u, v = bf[k - 1, :12], bf[k, :12]; chg[k] = 1 - float(u @ v / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-9))
    lb = interp(lowe, fps, bt[:-1])
    nrm = lambda a: a / (a.max() + 1e-9)
    v_low = nrm(np.array([lb[r::4].mean() for r in range(4)]))
    v_chg = nrm(np.array([chg[r::4].mean() for r in range(4)]))
    v_nov = nrm(np.array([np.sort(nov[r::4])[-6:].mean() for r in range(4)]))
    pfd = probe['first_downbeat']; pr = int(np.argmin(np.abs(bt - pfd))) % 4
    vote = v_low + v_chg + 2 * v_nov + .3 * (np.arange(4) == pr)
    r = int(np.argmax(vote))
    bars_t = bt[r::4]
    bars_t = bars_t[bars_t + 2 * P < dur]   # bars that have at least half their length in the file
    nb = len(bars_t)
    # per-bar loudness / onset / intensity
    rms = np.sqrt(np.convolve(xm.astype(np.float64) ** 2, np.ones(HOP) / HOP, 'same')[::HOP])
    db, ons = [], []
    for i in range(nb):
        a, b = int(bars_t[i] * fps), int((bars_t[i] + 4 * P) * fps)
        db.append(20 * math.log10(math.sqrt(float((rms[a:b] ** 2).mean())) + 1e-9)); ons.append(float(env[a:b].mean()))
    db, ons = np.array(db), np.array(ons)
    dbn = (db - db.min()) / (np.ptp(db) + 1e-9); onn = (ons - ons.min()) / (np.ptp(ons) + 1e-9)
    inten = .65 * dbn + .35 * onn
    V = bar_vectors(mag, sr, fps, bars_t, dur)
    # sections: the probe's boundaries moved to the refined bars
    bnd = sorted({int(np.argmin(np.abs(bars_t - s['t0']))) for s in probe['sections']} | {0})
    bnd = [b for b in bnd if b < nb] + [nb]
    secs = []
    for a, b in zip(bnd[:-1], bnd[1:]):
        if b - a < 2: continue
        secs.append({'bar0': a, 'bar1': b, 'intensity': round(float(inten[a:b].mean()), 3), 'db': round(float(db[a:b].mean()), 1)})
    if secs and secs[-1]['bar1'] != nb: secs[-1]['bar1'] = nb
    # the ending: where the last loud bar is, and what follows it in the file (the final hit's ring-out)
    tail = dur - (bars_t[-1] + 4 * P)
    med = float(np.median(db))
    last_loud = max(i for i in range(nb) if db[i] > med - 6)
    env20 = np.sqrt(np.convolve(xm.astype(np.float64) ** 2, np.ones(960) / 960, 'same')[::960])   # 20 ms
    t_end = dur
    for i in range(len(env20) - 1, 0, -1):   # where the file falls below -50 dB for good
        if 20 * math.log10(env20[i] + 1e-12) > -50: t_end = (i + 1) * .02; break
    lvl = levels.get(name.split('/', 1)[0] + '/' + os.path.basename(name) + '.wav')
    lufs = lufs_integrated(x if x.ndim > 1 else x[:, None], sr)
    gain = round(TARGET_LUFS[use] - lufs, 1)
    say(f'{sid:9s} {name}')
    say(f'   grid {60 / P:8.3f} BPM (probe {probe["bpm"]}), phase {ph:.4f} s, window drift {drift * 1000:.1f} ms {"(piecewise)" if use_off else "(steady)"}; '
        f'onset on-grid / off-grid {fit_new:.2f} (probe beats {fit_old:.2f}); probe beats vs grid: sd {np.std(dev) * 1000:.1f} ms, max {np.max(np.abs(dev)) * 1000:.0f} ms')
    say(f'   downbeat votes ' + ' '.join(f'{v:.2f}' for v in vote))
    say(f'   bars {nb} (downbeat phase {r}, probe {pr}), first bar {bars_t[0]:.3f} s, last bar ends {bars_t[-1] + 4 * P:.2f} s, file {dur:.2f} s (audible to {t_end:.2f}), tail {tail:.2f} s')
    say(f'   loudness: median bar {med:.1f} dB; last bars ' + ' '.join(f'{d:.0f}' for d in db[-6:]) + f'; last loud bar {last_loud}; {lufs:.1f} LUFS-I (RMS {lvl["rms_dBFS"]} dBFS) -> gain {gain} dB')
    say('   sections ' + ' '.join(f"[{s['bar0']},{s['bar1']}) {s['intensity']:.2f}" for s in secs))
    return dict(id=sid, name=name, use=use, dur=dur, t_end=t_end, P=P, beats=bt, bars_t=bars_t, r=r, db=db, inten=inten, V=V, secs=secs,
                last_loud=last_loud, gain=gain, lufs=round(lufs, 1), rms=lvl['rms_dBFS'], peak=lvl['peak_dBFS'], probe=probe)


def seam(V, a, b):
    """how well a jump from the end of bar b - 1 back to bar a hides: the bar it plays (a) against the bar that would have
    followed (b), and the bars before the seam (a - 1 vs b - 1), cosine similarity of the bar vectors."""
    s1 = float(V[a] @ V[b]) if b < len(V) else float(V[a] @ V[b - 1]) - .1
    s2 = float(V[a - 1] @ V[b - 1]) if a > 0 else s1
    return .6 * s1 + .4 * s2


def best_loop(S, a0, b0, lens=(16, 12, 8, 4)):
    """a loop [a, a + L) inside bars [a0, b0): phrase-aligned (a - a0 multiple of 4), its seam as good as possible;
    longer loops win a close call (+.05 per extra phrase: a 16-bar loop with a .9 seam beats an 8-bar one at .99)."""
    V = S['V']
    best = None
    for L in lens:
        if L > b0 - a0: continue
        for a in range(a0, b0 - L + 1, 4):
            q = seam(V, a, a + L); sc = q + .05 * (L / 4 - 1)
            if best is None or sc > best[0]: best = (sc, a, a + L, q)
    if best is None: return [a0, b0], 0.0
    return [best[1], best[2]], round(best[3], 3)


def roles(S):
    """ROLES from the sections' intensity (sections: the analysis' boundaries; the first is the intro, the bars from the
    ending's start on are the ending, the rest is the BODY):
      intro   the intro section's last phrase (4 bars) when it opens quieter than the song's median; else its first
              phrase. Played once, then `main`
      main    most of the body as ONE long loop (>= 24 bars), so the song plays through its own arrangement: a start in the
              body's first 16 bars and an end before the ending, phrase-aligned, whose seam hides best (longer wins ties)
      peak    a loop inside the most intense body section,
      drive   ... the next most intense one (above the median; else = peak),
      low     ... the least intense one (a lull, a break); each pick weighs intensity against the loop's seam
              (score = +-intensity + .5 min(seam, .9): a section whose bars all differ, so no loop in it hides, loses
              to a slightly less fitting one that loops cleanly)
      ending  from one bar before the last loud bar (bar dB > median - 6) to the end of the file (its own final hit and
              ring-out), then stop
    Body loops are 8-16 bars where the section allows (best_loop)."""
    secs, nb, V = S['secs'], len(S['bars_t']), S['V']
    end0 = max(0, S['last_loud'] - 1)
    intro = secs[0]
    body = [s for s in secs[1:] if s['bar0'] < end0 - 3] or secs
    med = float(np.median([s['intensity'] for s in secs]))
    ia = intro['bar1'] - 4 if intro['intensity'] < med - .03 and intro['bar1'] >= 4 else intro['bar0']
    R = {'intro': {'loop': [max(0, ia), max(0, ia) + 4], 'then': 'main'}}
    b0 = body[0]['bar0']
    cands = [(seam(V, m0, m1) + .15 * (m1 - m0) / max(1, end0 - b0), m0, m1) for m0 in range(b0, min(b0 + 17, end0 - 24), 4)
             for m1 in range(m0 + 24, end0 + 1, 4)]
    if cands:
        sc, m0, m1 = max(cands); R['main'] = {'loop': [m0, m1], 'seam': round(seam(V, m0, m1), 3)}
    else:
        lp, q = best_loop(S, b0, end0); R['main'] = {'loop': lp, 'seam': q}
    loops = [(s, *best_loop(S, s['bar0'], min(s['bar1'], end0))) for s in body]
    pick = lambda fit, skip=None: max((x for x in loops if x[0] is not skip), key=lambda x: fit(x[0]['intensity']) + .5 * min(x[2], .9))
    pk = pick(lambda i: i); lo = pick(lambda i: -i)
    dr = pick(lambda i: i, pk[0]) if len(loops) > 1 else pk
    if dr[0]['intensity'] < med: dr = pk
    for k, x in (('peak', pk), ('drive', dr), ('low', lo)): R[k] = {'loop': x[1], 'seam': x[2]}
    R['ending'] = {'loop': [end0, nb], 'then': 'stop'}
    return R


def js_num(a, d=4):
    return '[' + ','.join(f'{v:.{d}f}'.rstrip('0').rstrip('.') if v else '0' for v in a) + ']'


def main():
    levels = {d['track']: d for d in json.load(open(f'{SRC}/levels.json', encoding='utf-8'))}
    out = []
    for sid, name, use in SONGS:
        S = analyse(sid, name, use, levels)
        R = roles(S)
        say('   roles ' + ' '.join(f"{k}{v['loop']}" + (f"~{v['seam']}" if 'seam' in v else '') for k, v in R.items()))
        out.append((S, R))
    L = ['// CUES: the battle-music cue sheets (data). GENERATED by tools/music/cues.py from the offline analysis of the Six',
         '// Chambers Suno tracks (tmp/western/music_probe/analyze.py), the beat grid re-fitted on the shipped OGG. Do not edit by',
         '// hand: change the script (its roles() heuristics) and run it again.',
         '//   file      path under the music folder (tracks.js MUSIC_BASE), without .ogg',
         "//   gainDb    the song's gain to its kind's level (TARGET_LUFS in cues.py; lufs: the file's own integrated loudness)",
         '//   beats     beat times (s) in the file; bars: index of each bar\'s first beat (4/4); bar i = beats[bars0 + 4 i]',
         '//   barDb / barI  per-bar loudness (dB) and intensity (0..1, per song)',
         '//   sections  [bar0, bar1, intensity] (the analysis\' boundaries on the refined bars)',
         '//   roles     {intro, low, main, drive, peak, ending}: loop = [a, b) bars played, looped on bar lines; then = what',
         '//             follows when the region ends instead of looping (intro -> the wanted body role, ending -> stop)',
         '//   end       where the file is audible to (s): the ending\'s ring-out stops there',
         'export const CUES = {']
    for S, R in out:
        bt = S['beats']; b0 = int(np.argmin(np.abs(bt - S['bars_t'][0])))
        roles_js = ', '.join(f"{k}: {{loop: [{v['loop'][0]}, {v['loop'][1]}]" + (f", then: '{v['then']}'" if 'then' in v else '') + '}' for k, v in R.items())
        fname = S['name'].encode('ascii', 'backslashreplace').decode('ascii').replace('\\x', '\\u00')
        L.append(f"  {S['id']}: {{file: '{fname}', use: '{S['use']}', bpm: {60 / S['P']:.3f}, lufs: {S['lufs']}, gainDb: {S['gain']}, dur: {S['dur']:.3f}, end: {S['t_end']:.2f},")
        L.append(f"    bars0: {b0}, nBars: {len(S['bars_t'])},")
        L.append(f"    roles: {{{roles_js}}},")
        L.append('    sections: [' + ', '.join(f"[{s['bar0']}, {s['bar1']}, {s['intensity']}]" for s in S['secs']) + '],')
        L.append('    barDb: ' + js_num(S['db'], 1) + ',')
        L.append('    barI: ' + js_num(S['inten'], 2) + ',')
        L.append('    beats: ' + js_num(bt, 4) + '},')
    L.append('};')
    open(OUT, 'w', newline='\n', encoding='utf-8').write('\n'.join(L) + '\n')
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    open(REPORT, 'w', encoding='utf-8').write('\n'.join(log) + '\n')
    print('wrote', OUT, os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main()
