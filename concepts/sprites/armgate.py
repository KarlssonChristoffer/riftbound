# Arm pixel gate: every VISIBLE elbow must put a readable kink in the silhouette, in the side and three-quarter
# facings, in every frame of the checked clips. Measured on the rendered data, not the pose numbers:
#   kink  = distance (sprite px) of the projected elbow from the straight line shoulder -> wrist
#   bend  = how far the projected arm deviates from straight at the elbow (degrees)
#   visible = the ID pass shows that side's upper arm or forearm at the elbow (not hidden behind the body)
# Pass: kink >= MIN_KINK px for every visible elbow.   python concepts/sprites/armgate.py [skel_dir]
import json, os, sys
import numpy as np
from pixelize import load

MIN_KINK = 1.0
FRONT_BACK = {'S', 'N', 'SSE', 'SSW', 'NNE', 'NNW'}   # checked: side + three-quarter facings (not ~front/back)
CLIPS = ('walk', 'run')


def main(root):
    idx = json.load(open(os.path.join(root, 'poses.json')))
    frames = [p for p in idx['poses'] if p.split('.')[0] in CLIPS or p.startswith('turn_')]
    rows, fails = [], []
    for fr in frames:
        meta = json.load(open(os.path.join(root, fr, 'meta.json')))
        ss, names = meta['ss'], meta['objects']
        for d in [d for d in meta['dirs'] if d not in FRONT_BACK]:
            rgb, alpha = load(os.path.join(root, fr, f'{d}_id.png'))
            ids = np.rint(rgb[..., 0] * 255).astype(int) * (alpha > .5)
            b = meta['bones'][d]
            for side, m in (('L', 'Left'), ('R', 'Right')):
                sh, el, wr = (np.array(b[f'{m}{k}'][:2]) for k in ('Arm', 'ForeArm', 'Hand'))
                v = wr - sh
                kink = abs(v[0] * (el - sh)[1] - v[1] * (el - sh)[0]) / (np.linalg.norm(v) + 1e-9)
                u1, u2 = sh - el, wr - el
                bend = 180 - np.degrees(np.arccos(np.clip(u1 @ u2 / (np.linalg.norm(u1) * np.linalg.norm(u2) + 1e-9), -1, 1)))
                x, y = int(el[0] * ss), int(el[1] * ss)
                win = ids[max(0, y - ss):y + ss + 1, max(0, x - ss):x + ss + 1]
                own = {int(k) for k, n in names.items() if n.endswith('.' + side) and any(t in n.split('.')[0] for t in ('UpperArm', 'ForeArm', 'Sleeve'))}
                visible = bool(np.isin(win, list(own)).any())
                ok = bool((not visible) or kink >= MIN_KINK)
                rows.append(dict(frame=fr, dir=d, side=side, kink=round(float(kink), 2), bend=round(float(bend), 1), visible=visible, ok=ok))
                if not ok:
                    fails.append(rows[-1])
    vis = [r for r in rows if r['visible']]
    summary = {'checked': len(vis), 'failed': len(fails), 'min_kink': min(r['kink'] for r in vis) if vis else None,
               'mean_kink': round(float(np.mean([r['kink'] for r in vis])), 2) if vis else None, 'threshold_px': MIN_KINK}
    json.dump({'summary': summary, 'fails': fails, 'rows': rows}, open(os.path.join(root, 'armgate.json'), 'w'), indent=1)
    print('ARM GATE', 'PASS' if not fails else 'FAIL', json.dumps(summary))
    for f in fails[:40]:
        print('  fail', f['frame'], f['dir'], f['side'], 'kink', f['kink'], 'px', 'bend', f['bend'])
    return not fails


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out', 'skel'))
