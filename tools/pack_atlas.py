# Packs a loadout atlas (one folder per pose: body_sheet.png, body_normals.png, body_depth.png, meta.json) into a few
# big sheets + one JSON, so the game loads ~8 files instead of ~1000 (load time ~40 s -> a few seconds).
#
#   python tools/pack_atlas.py concepts/sprites/out/outfits/ranger_basic [more roots...]
#
# Writes <root>/packed/: albedo_<k>.png, normals_<k>.png, depth_<k>.png (sim sets only), packed.json:
#   {w, h, per: poses per sheet, sheets, depth: bool, sig: signature of poses.json (stale check),
#    poses: {name: [sheet, row]}, meta: {name: {bones, sim}}}
# The loader (src/atlas.js) falls back to the per-file load when packed.json is missing or stale.
# Re-run after any re-render of the atlas.
import json, os, sys, hashlib
from PIL import Image

MAX_H = 8192   # rows per sheet (well under every GPU's texture limit)


def sig(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:16]


def pack(root):
    idx = json.load(open(os.path.join(root, 'poses.json')))
    poses = idx['poses']
    first = Image.open(os.path.join(root, poses[0], 'body_sheet.png'))
    W, H = first.size
    per = MAX_H // H
    depth = all(os.path.exists(os.path.join(root, p, 'body_depth.png')) for p in poses)
    out = os.path.join(root, 'packed')
    os.makedirs(out, exist_ok=True)
    layers = [('albedo', 'body_sheet.png'), ('normals', 'body_normals.png')] + ([('depth', 'body_depth.png')] if depth else [])
    sheets = (len(poses) + per - 1) // per
    where, meta = {}, {}
    for k in range(sheets):
        chunk = poses[k * per:(k + 1) * per]
        for tag, fn in layers:
            img = Image.new('RGBA', (W, H * len(chunk)), (0, 0, 0, 0))
            for r, p in enumerate(chunk):
                src = Image.open(os.path.join(root, p, fn)).convert('RGBA')
                if src.size != (W, H):
                    raise SystemExit(f'{p}/{fn}: {src.size} != {(W, H)}')
                img.paste(src, (0, r * H))
            img.save(os.path.join(out, f'{tag}_{k}.png'), optimize=False, compress_level=6)
        for r, p in enumerate(chunk):
            where[p] = [k, r]
            m = json.load(open(os.path.join(root, p, 'meta.json')))
            meta[p] = {'bones': m.get('bones'), 'sim': m.get('sim')}
    json.dump({'w': W, 'h': H, 'per': per, 'sheets': sheets, 'depth': depth, 'sig': sig(os.path.join(root, 'poses.json')),
               'poses': where, 'meta': meta}, open(os.path.join(out, 'packed.json'), 'w'))
    print(f'{root}: {len(poses)} poses -> {sheets} sheet(s) x {len(layers)} layers ({W}x{H} frames, depth={depth})')


if __name__ == '__main__':
    for r in sys.argv[1:] or ['concepts/sprites/out/outfits/ranger_basic']:
        pack(r)
