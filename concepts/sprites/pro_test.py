# Pro-model + crease test (2026-09-30). Two A/B tests from the 3D-pixel-art research, rendered with the same camera,
# canvas, pivot and palette rules as the Ranger atlas:
#   1. crease highlights: the Ranger's saved passes pixelized with and without PIXELIZE_CREASE (pixelize.py)
#   2. a professionally modelled character (KayKit Rogue, CC0) through the same pipeline: tools/blender/kaykit_model.py
#      renders ID/normal/depth + a texture-swatch pass (tools/blender/pixel_rig_tex.py); this file paints them
# Outputs go to out/pro_test/ only (the Ranger atlas dirs are read, never written).  Review: pro_test.html
#   python concepts/sprites/pro_test.py ranger          (copy passes + pixelize plain/crease)
#   python concepts/sprites/pro_test.py kaykit <dir>    (paint a KayKit render dir, plain/crease)
import json, os, shutil, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pixelize as P  # noqa: E402
import palette_harm  # noqa: E402

OUT = os.path.join(HERE, 'out', 'pro_test')
SRC = os.path.join(HERE, 'out', 'outfits', 'ranger_basic')
POSES = [f'idle.{i}' for i in range(8)] + [f'walk.{i}' for i in range(8)] + [f'run.{i}' for i in range(8)]
CREASE = .45


def variants(fn):
    for name, c in (('plain', 0.0), ('crease', CREASE)):
        P.CREASE = c
        fn(name)
    P.CREASE = 0.0


def ranger():
    dst = os.path.join(OUT, 'ranger')
    src_meta = json.load(open(os.path.join(SRC, 'poses.json')))
    for pz in POSES:
        s, d = os.path.join(SRC, pz), os.path.join(dst, pz)
        os.makedirs(d, exist_ok=True)
        for f in os.listdir(s):
            if f.endswith(('_id.png', '_nrm.png', '_dep.png')) or f == 'meta.json':
                shutil.copy2(os.path.join(s, f), os.path.join(d, f))
        variants(lambda name: P.main(d, name))
    json.dump({'poses': POSES, **{k: src_meta[k] for k in ('w', 'h', 'pivot', 'dirs')},
               'clips': {k: src_meta['clips'][k] for k in ('idle', 'walk', 'run')}},
              open(os.path.join(dst, 'poses.json'), 'w'), indent=1)


# ---------------------------------------------------------------- KayKit (texture swatches -> palette families)
def swatch_ramp(rgb):
    """A 4-tone ramp from one flat swatch colour: warm light hi, cool hue-shifted shade and dark (pixel-art ramp),
    then the environment's harmonization (palette_harm) like every other family."""
    c = np.array(rgb, float)
    warm, cool, deep = np.array((255, 236, 196)), np.array((96, 50, 90)), np.array((30, 20, 40))
    hi = np.clip(c + (warm - c) * .28, 0, 255)
    shade = c * .74 + (cool - c * .74) * .2                # darker, hue-shifted toward purple (not grey)
    dark = c * .4 + (deep - c * .4) * .4
    return palette_harm.ramp('kk', [tuple(int(v + .5) for v in t) for t in (hi, c, shade, dark)])


def kaykit(rdir):
    tex = Image.open(json.load(open(os.path.join(rdir, 'poses.json')))['texture']).convert('RGB')
    tw, th = tex.size
    cols, rows = 8, 4
    sw_rgb = {}
    for r in range(rows):
        for c in range(cols):
            cell = np.array(tex.crop((c * tw // cols, r * th // rows, (c + 1) * tw // cols, (r + 1) * th // rows))).reshape(-1, 3)
            sw_rgb[(rows - 1 - r) * cols + c + 1] = tuple(int(v) for v in np.median(cell, 0))  # Blender v is bottom-up
    for sw, rgb in sw_rgb.items():
        P.FAMS[f'sw{sw}'] = swatch_ramp(rgb)
    pj = json.load(open(os.path.join(rdir, 'poses.json')))
    for pz in pj['poses']:
        d = os.path.join(rdir, pz)
        variants(lambda name: paint_kaykit(d, name, sw_rgb))


def is_skin(c):  # faces tilt away from the top-down light; like the Ranger's Head bias
    r, g, b = c
    return r > 200 and r > g > b and r - b > 50


def paint_kaykit(d, name, sw_rgb):
    meta = json.load(open(os.path.join(d, 'meta.json')))
    W, H, ss = meta['w'], meta['h'], meta['ss']
    eps = .06 / (meta['far'] - meta['near'])
    sheet = Image.new('RGBA', (W * len(meta['dirs']), H))
    for i, dr in enumerate(meta['dirs']):
        rgb, alpha = P.load(os.path.join(d, f'{dr}_id.png'))
        ids = np.rint(rgb[..., 0] * 255).astype(int) * (alpha > .5)
        swr, _ = P.load(os.path.join(d, f'{dr}_sw.png'))
        sw = np.rint(swr[..., 0] * 255).astype(int) * (alpha > .5)
        nrm = P.load(os.path.join(d, f'{dr}_nrm.png'))[0] * 2 - 1
        dep = P.load(os.path.join(d, f'{dr}_dep.png'))[0][..., 0]
        cid = ids * 64 + sw                                   # a part = one mesh x one texture swatch
        dark = {k for k, v in sw_rgb.items() if max(v) < 60}  # eyes / pupils: keep them at 1x
        thin = {int(v) for v in np.unique(cid) if v and v % 64 in dark}
        oid, on, od = P.downsample(cid, nrm, dep, alpha, ss, thin)
        objects, table = {}, {}
        for v in np.unique(oid):
            if not v:
                continue
            nm = f'K{v}'
            objects[str(v)] = nm
            opt = {'fixed': 3, 'outline': False, 'lines': False, 'thin': True} if v % 64 in dark else                 {'bias': .15} if is_skin(sw_rgb[v % 64]) else {}
            table[nm] = (nm, f'sw{v % 64}', opt)
        final, _ = P.paint(oid, on, od, objects, eps, table)
        sheet.paste(final, (W * i, 0))
    sheet.save(os.path.join(d, f'{name}_sheet.png'))


if __name__ == '__main__':
    if sys.argv[1] == 'ranger':
        ranger()
    else:
        kaykit(sys.argv[2])
    print('PRO_TEST_OK')
