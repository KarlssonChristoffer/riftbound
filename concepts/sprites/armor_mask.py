# EXPERIMENT (arena "M" key): which sprite pixels are shiny metal, per pose and facing.
# Reads the same ID passes pixelize.py turns into sprites, with pixelize's exact downsampling, so the mask lines up
# with body_sheet.png pixel for pixel. Writes one grey sheet per pose (same layout as body_sheet: facings side by side):
#   0 = not metal, 255 = steel plate (the tunic becomes a breastplate / faulds / pauldrons, toe caps), 128 = gold trim
# into out/experiments/armor/<atlas>/<pose>.png. Nothing in the atlas itself is touched.
#   python armor_mask.py [atlas ...]        (default: ranger_basic ranger_sim)
import os, sys, json
import numpy as np
from PIL import Image
from multiprocessing import Pool
import pixelize as px

HERE = os.path.dirname(os.path.abspath(__file__))
STEEL = ('TunicChest', 'TunicRibs', 'TunicBelly', 'TunicHip', 'TunicSkirt', 'TunicSleeveUp', 'BootToe')
GOLD = ('Belt',)


def pose_mask(args):
    rdir, out = args
    meta = json.load(open(os.path.join(rdir, 'meta.json')))
    W, H, ss = meta['w'], meta['h'], meta['ss']
    table = meta.get('parts') or px.PARTS
    kind = lambda n, key: table.get(n.split('.')[0], (None, None, {}))[2].get(key)
    objs = meta['objects']
    thin = {int(k) for k, n in objs.items() if kind(n, 'thin')}
    lines = {int(k) for k, n in objs.items() if kind(n, 'line')}
    over = {int(k) for k, n in objs.items() if kind(n, 'overlay')}
    mat = {int(k): 255 if n.split('.')[0] in STEEL else 128 if n.split('.')[0] in GOLD else 0 for k, n in objs.items()}
    sheet = np.zeros((H, W * len(meta['dirs'])), np.uint8)
    for i, d in enumerate(meta['dirs']):
        rgb, alpha = px.load(os.path.join(rdir, f'{d}_id.png'))
        ids = np.rint(rgb[..., 0] * 255).astype(int) * (alpha > .5)
        nrm = px.load(os.path.join(rdir, f'{d}_nrm.png'))[0] * 2 - 1
        dep = px.load(os.path.join(rdir, f'{d}_dep.png'))[0][..., 0]
        oid, _, _ = px.downsample(ids, nrm, dep, alpha, ss, thin, lines, over)
        sheet[:, W * i:W * (i + 1)] = np.vectorize(lambda v: mat.get(int(v), 0))(oid)
    Image.fromarray(sheet, 'L').save(out)
    return os.path.basename(rdir)


if __name__ == '__main__':
    atlases = sys.argv[1:] or ['ranger_basic', 'ranger_sim']
    jobs = []
    for a in atlases:
        root = os.path.join(HERE, 'out', 'outfits', a)
        dst = os.path.join(HERE, 'out', 'experiments', 'armor', a)
        os.makedirs(dst, exist_ok=True)
        for p in json.load(open(os.path.join(root, 'poses.json')))['poses']:
            out = os.path.join(dst, f'{p}.png')
            src = os.path.join(root, p, 'meta.json')
            if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(src):
                continue   # up to date
            jobs.append((os.path.join(root, p), out))
    print(len(jobs), 'poses to mask')
    with Pool(max(1, os.cpu_count() - 2)) as pool:
        for n, name in enumerate(pool.imap_unordered(pose_mask, jobs), 1):
            if n % 25 == 0: print(n, name, flush=True)
    print('done')
