# REPORT: what bmtest.mjs produced, made readable without ears.
#   python tools/music/report.py <dir>   (reads <dir>/offline*.wav + .json; writes .ogg, _timeline.png,
#                                         _report.txt for each; with <dir>/live.json also live_timeline.png + live_report.txt)
# Loudness: BS.1770 K-weighting applied in the frequency domain (|H|^2 on 400 ms windows, hop 100 ms): momentary LUFS.
# Seams: for every cut the player made (jump / loop / switch), the loudness and spectral flux in the 60 ms around it
# against the song's own bar lines elsewhere (a cut that hides is no louder / no more "new" than an ordinary downbeat),
# and clicks (a sample step over 8x the local step RMS).
import json, math, os, sys
import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw

D = sys.argv[1] if len(sys.argv) > 1 else 'tmp/bmusic'


def k_weight_gain(f, sr):
    """|H(f)|^2 of the BS.1770 K-weighting (pre-filter shelf + RLB high-pass), biquads at sr."""
    def biq(b, a):
        z = np.exp(-2j * np.pi * f / sr)
        return np.abs((b[0] + b[1] * z + b[2] * z * z) / (a[0] + a[1] * z + a[2] * z * z)) ** 2
    # the published 48 kHz coefficients (re-derived for other rates would be better; the renders are 48 kHz)
    sh = biq([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
    hp = biq([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])
    return sh * hp


def momentary(x, sr, win=.4, hop=.1):
    n, h = int(win * sr), int(hop * sr)
    f = np.fft.rfftfreq(n, 1 / sr); W = k_weight_gain(f, sr)
    out, ts = [], []
    for s in range(0, len(x) - n, h):
        e = 0.0
        for c in range(x.shape[1]):
            X = np.fft.rfft(x[s:s + n, c]); e += float((np.abs(X) ** 2 * W).sum()) * 2 / (n * n)
        out.append(-0.691 + 10 * math.log10(e + 1e-12)); ts.append((s + n / 2) / sr)
    return np.array(ts), np.array(out)


def clicks(x, sr):
    d = np.diff(x.mean(1)); a = np.abs(d)
    w = int(.01 * sr); r = np.sqrt(np.convolve(d * d, np.ones(w) / w, 'same')) + 1e-6
    idx = np.where(a > 8 * r)[0]
    return idx / sr


def flux_at(x, sr, t, w=.03):
    """spectral flux (log magnitude rise) across t: the 30 ms after vs the 30 ms before."""
    n = int(w * sr); i = int(t * sr)
    if i - n < 0 or i + n > len(x): return 0.0
    a = np.abs(np.fft.rfft(x[i - n:i].mean(1) * np.hanning(n))); b = np.abs(np.fft.rfft(x[i:i + n].mean(1) * np.hanning(n)))
    return float(np.maximum(0, np.log1p(b * 100) - np.log1p(a * 100)).mean())


def timeline(path, T, ts, lufs, marks, bands, title):
    W, H = 1800, 420
    img = Image.new('RGB', (W, H), (26, 26, 30)); d = ImageDraw.Draw(img)
    X = lambda t: 40 + t / T * (W - 60)
    d.text((10, 6), title, fill=(235, 235, 235))
    # state bands
    pal = {'off': (70, 70, 80), 'battle': (180, 120, 60), 'boss': (190, 70, 60), 'ending': (220, 170, 80), 'calm': (90, 150, 190), 'saloon': (160, 120, 200),
           'dead': (40, 40, 40), 'over': (90, 150, 190), 'title': (90, 150, 190)}
    for t0, t1, st, role in bands:
        d.rectangle([X(t0), 30, X(t1), 46], fill=pal.get(st, (100, 100, 100))); d.text((X(t0) + 2, 31), st, fill=(10, 10, 10))
        if role: d.text((X(t0) + 2, 48), role, fill=(200, 200, 200))
    # loudness curve (momentary LUFS, -60..-10)
    y = lambda v: 300 - (max(-60, min(-10, v)) + 60) / 50 * 220
    for v in (-50, -40, -30, -20):
        d.line([40, y(v), W - 20, y(v)], fill=(50, 50, 58)); d.text((4, y(v) - 6), str(v), fill=(140, 140, 150))
    pts = [(X(t), y(v)) for t, v in zip(ts, lufs)]
    if len(pts) > 1: d.line(pts, fill=(150, 200, 160), width=1)
    # marks: game events (top, orange) and the music's answers (bottom, green / blue for stingers)
    for t, label, kind in marks:
        if kind == 'game': d.line([X(t), 64, X(t), 300], fill=(230, 130, 80)); d.text((X(t) + 2, 66 + (hash(label) % 5) * 11), label[:22], fill=(240, 170, 130))
        elif kind == 'sting': d.line([X(t), 300, X(t), 340], fill=(110, 160, 240))
        else: d.line([X(t), 290, X(t), 380], fill=(120, 210, 140)); d.text((X(t) + 2, 384 - (hash(label) % 3) * 11), label[:24], fill=(150, 230, 160))
    for s in range(0, int(T) + 1, 10): d.text((X(s), H - 14), f'{s}s', fill=(190, 190, 190))
    img.save(path)


KEYS = ('phase', 'dir', 'bossTele', 'bossKill', 'paused', 'nearMerchant', 'eliteKills')


def label(e):
    # a script row as a short label: the keys that matter for the music (and the champion / player health thresholds)
    out = [f'{k}={e[k]}' for k in KEYS if k in e and e[k] not in (0, False, None)]
    if 'bossHp' in e and 0 <= e['bossHp'] <= .6: out.append(f"boss {e['bossHp']:.2f}")
    if 'hp' in e and e['hp'] < .3: out.append(f"hp {e['hp']:.2f}")
    return ' '.join(out)


def offline(name='offline'):
    x, sr = sf.read(f'{D}/{name}.wav', dtype='float32')
    J = json.load(open(f'{D}/{name}.json', encoding='utf-8'))
    T = len(x) / sr
    # ogg (libsndfile: write in blocks)
    with sf.SoundFile(f'{D}/{name}.ogg', 'w', sr, 2, format='OGG', subtype='VORBIS') as f:
        for s in range(0, len(x), 8192): f.write(x[s:s + 8192])
    ts, L = momentary(x, sr)
    out = [f'offline render: {T:.1f} s at {sr} Hz, peak {20 * math.log10(np.abs(x).max() + 1e-9):.1f} dBFS']
    # state bands from the director's notes
    bands, cur, t0, role = [], 'off', 0.0, ''
    roles = [(n['t'], n['b']) for n in J['notes'] if n['what'] == 'role']
    for n in J['notes']:
        if n['what'] == 'state': bands.append((t0, n['t'], cur, '')); cur, t0 = n['b'], n['t']
    bands.append((t0, T, cur, ''))
    out.append('loudness (momentary LUFS, K-weighted) per state:')
    for a, b, st, _ in bands:
        sel = (ts >= a + .5) & (ts < b - .2)
        if sel.sum() > 3: out.append(f'   {st:8s} {a:6.1f}-{b:6.1f} s  median {np.median(L[sel]):6.1f}  max {L[sel].max():6.1f}')
    # seams
    cuts = [r for r in J['log'] if r['kind'] in ('jump', 'loop', 'then', 'song') and r['fileFrom'] >= 0]
    ck = clicks(x, sr)
    out.append(f'cuts {len(cuts)}; clicks (|step| > 8x local) anywhere: {len(ck)}; within 50 ms of a cut: {sum(1 for c in ck if any(abs(c - r["at"]) < .05 for r in cuts))}')
    for r in cuts:
        i0, i1 = int((r['at'] - .2) * sr), int((r['at'] + .2) * sr)
        lv = 20 * math.log10(np.sqrt((x[i0:i1] ** 2).mean()) + 1e-9)
        out.append(f"   {r['at']:7.2f} {r['kind']:5s} {r['from']:>8s} {r['fileFrom']:7.2f} -> {r['song']:8s} {r['fileTo']:7.2f}  ({r['role']}, {r['q']})  flux {flux_at(x, sr, r['at']):.3f}  level {lv:.1f} dB")
    # the bar lines of the playing song elsewhere: flux at ordinary downbeats for comparison
    fl = []
    for r in J['log']:
        if r['kind'] in ('jump', 'loop', 'then', 'song') and r['song']:
            pass
    out.append(f"check: {J['check']['ok']} / {J['check']['n']} changes on the cue grid; bad: {len(J['check']['bad'])}")
    out.append('stats ' + json.dumps(J['stats']))
    marks = [(e['t'], label(e), 'game') for e in J['timeline'] if label(e)]
    marks += [(r['at'], f"{r['kind']} {r['role']}", 'sting' if r['kind'].startswith('sting') else 'music') for r in J['log']]
    timeline(f'{D}/{name}_timeline.png', T, ts, L, marks, bands, f'{name}: game script (orange) vs the music (green: cuts, blue: stingers); curve = momentary LUFS')
    open(f'{D}/{name}_report.txt', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print('\n'.join(out))


def live():
    J = json.load(open(f'{D}/live.json', encoding='utf-8'))
    P = J['probe']; T = P[-1]['t'] if P else 1
    bands, cur, t0, role = [], P[0]['state'] if P else 'off', 0.0, ''
    for p in P:
        if p['state'] != cur: bands.append((t0, p['t'], cur, '')); cur, t0 = p['state'], p['t']
    bands.append((t0, T, cur, ''))
    marks = [(a['t'], a['what'] + (f" {a['x']}" if a.get('x') is not None else ''), 'game') for a in J['acts'] if a['what'] not in ('kill', 'heal', 'boss hit')]
    t0a = J['t0']
    marks += [(r['at'] - t0a, f"{r['kind']} {r['role']}", 'sting' if r['kind'].startswith('sting') else 'music') for r in J['log']]
    # phase changes in the game
    last = None
    for p in P:
        k = (p['phase'], p['dir'])
        if k != last: marks.append((p['t'], f'{p["phase"]}/{p["dir"]}', 'game')); last = k
    timeline(f'{D}/live_timeline.png', T, np.array([p['t'] for p in P]), np.array([-60 + 50 * p['I'] for p in P]), marks, bands,
             'live run: game (orange: phases + actions) vs the music (green: cuts, blue: stingers); curve = the director\'s intensity I')
    out = [f"live run {T:.1f} s: {J['check']['ok']} / {J['check']['n']} changes on the cue grid, bad {len(J['check']['bad'])}",
           f"feature view cost (EMA) {J['featMs'] * 1000:.1f} us; songs {json.dumps(J['songs'])}", 'stats ' + json.dumps(J['stats'])]
    # latency: game change -> musical answer
    out.append('the music\'s answers (ctx time - run start):')
    for r in J['log']:
        asked = f"asked {r['req'] - t0a:7.2f}  wait {r['at'] - r['req']:5.2f} s" if r['req'] >= 0 else "(its region's own end)"
        out.append(f"   {r['at'] - t0a:7.2f} {r['kind']:11s} {r['from']:>8s} -> {r['song']:8s} {r['role']:7s} q={r['q']:6s} {asked}")
    open(f'{D}/live_report.txt', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
    print('\n'.join(out[:3]))


if __name__ == '__main__':
    for f in sorted(os.listdir(D)):
        if f.startswith('offline') and f.endswith('.wav') and os.path.exists(f'{D}/{f[:-4]}.json'): offline(f[:-4])
    if os.path.exists(f'{D}/live.json'): live()
