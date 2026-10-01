# Prop pixelizer: turns the 3D prop kit's data passes (tools/blender/props3d.py) into palette sprites for every biome,
# in the character's language (pixelize.py): the same supersample downsample, top-left light quantised into
# hi / base / shade, seams where one plank / stave / drum meets the next, occlusion lines on depth steps, orphan
# clean-up and the environment's selective exterior outline (the shade tone where the empty side faces the light).
# Extra for props: biome COVER from the normals (moss / ash / snow settles on whatever faces up).
#
#   python concepts/sprites/props_pixelize.py [out/props3d]
# Writes out/props3d/props_<biome>.png (albedo atlas per biome), props_nrm.png (one normal atlas, linear, +x right,
# +y up, +z toward the viewer: the game's convention) and props.json {frames: {state: [x, y, w, h, px, py]}, ...}.
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pixelize import load, downsample  # noqa: E402

LIGHT = np.array((-0.55, -0.62, 0.56)); LIGHT /= np.linalg.norm(LIGHT)   # image space (y down), as spritekit
# props have big flat faces: the thresholds put the top in hi, the front and west faces in base, the east in shade
HI, LO = .62, .12
UP = np.array((0, -np.cos(np.radians(20)), np.sin(np.radians(20))))     # world up in image space at the 20 deg pitch
EPS_M = .02                                                              # a depth step of 2 cm is an occlusion edge

# biome material ramps [hi, base, shade, dark] (arena/biomes.js STYLES, so the props sit in their biome)
RED, HAZ, GOLD = ['d8573e', 'a8342b', '72222a', '3e1420'], ['f2d060', 'd8a830', '9a7020', '4e3812'], ['ffe89a', 'e0b040', 'a87a24', '5a3e14']
BIOMES = {
    'ruins': {'wood': ['8c6c4a', '70543a', '543e2b', '35271c'], 'metal': ['a08650', '7a6438', '56452a', '352a1c'],
              'clay': ['c8845a', 'a8643e', '7e472c', '4e2a1c'], 'stone': ['a09c90', '868278', '6a675f', '46443e'],
              'rock': ['7e786b', '666056', '504b44', '35322d'], 'rope': ['cdb577', 'ad935a', '877043', '594a2b'],
              'cover': ['7d9470', '627a58', '4b6048', '334436'], 'coverK': .08, 'coverT': .86},
    'ember': {'wood': ['5a4a40', '43362f', '30261f', '1c1512'], 'metal': ['6c666a', '4d484d', '363237', '211e22'],
              'clay': ['6a6078', '463e52', '2e2838', '18141e'], 'stone': ['6c5656', '524042', '3e2f32', '261c1f'],
              'rock': ['5f4b4b', '483839', '362a2c', '221a1c'], 'rope': ['8c7a5a', '6e5e44', '4e4230', '2e261c'],
              'cover': ['8c827b', '79716b', '655e59', '4a4441'], 'coverK': .16, 'coverT': .84},
    'frost': {'wood': ['8a7c6e', '6d6055', '534841', '362f2b'], 'metal': ['9ea8b8', '768093', '586275', '39404f'],
              'clay': ['cfdcea', 'a0b6d0', '7690b0', '4a5e80'], 'stone': ['8494ad', '6a7a95', '55647e', '3a455c'],
              'rock': ['717e90', '5a6679', '475264', '2f3747'], 'rope': ['c9bd94', 'a99c74', '857a58', '58503a'],
              'cover': ['eef3f8', 'd6dfeb', 'b4c2d6', '8795b2'], 'coverK': .5, 'coverT': .78, 'drip': .3},
    'rift':  {'wood': ['6a5680', '4e3e66', '392d4e', '221a31'], 'metal': ['6c5c8c', '4f4372', '3b3158', '251e39'],
              'clay': ['7a64a8', '5a4886', '433466', '2a2044'], 'stone': ['5e4e88', '46396a', '352b54', '211a36'],
              'rock': ['4f4270', '3c3158', '2d2545', '1c1730'], 'rope': ['8a78a8', '6a5a88', '4e4268', '2e2644'],
              'cover': None},
}
SHARED = {'red': RED, 'haz': HAZ, 'gold': GOLD}
NO_COVER = {'Hole', 'Coin', 'Fuse', 'Gold', 'HazDark', 'Hazard', 'Rune', 'Crack'}
# families that GLOW in one biome (painted in these tones + written to that biome's emit atlas); elsewhere carved stone
EMIT = {'rune': {'rift': ['ffe0fa', 'ff8ae8', 'c85ad8', '8a4ad8']}, 'crack': {'ember': ['ffe08a', 'ffa040', 'e0541e', '6e1c12']}}


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, k):
    return tuple(int(round(x + (y - x) * k)) for x, y in zip(a, b))


def ramp6(r4):
    """[hi, base, shade, line, outline_shadow, outline_lit] in the environment's rule (selective outlines)."""
    r = [hexrgb(h) for h in r4]
    return [r[0], r[1], r[2], mix(r[3], r[2], .25), r[3], r[2]]


def palette(biome):
    B = BIOMES[biome]
    P = {k: ramp6(v) for k, v in {**SHARED, **{k: B[k] for k in ('wood', 'metal', 'clay', 'stone', 'rock', 'rope')}}.items()}
    w = P['wood']
    P['void'] = [mix(w[4], (0, 0, 0), .3)] * 3 + [mix(w[4], (0, 0, 0), .45)] * 3   # the dark inside of things
    if B.get('cover'):
        P['cover'] = ramp6(B['cover'])
    st = P['stone']
    for fam, per in EMIT.items():
        if biome in per:
            P[fam] = ramp6(per[biome])
        elif fam == 'rune':   # outside the rift the plate is just part of its block
            P[fam] = st
        else:                 # a crack: the stone's line tone
            P[fam] = [st[3]] * 3 + [st[4]] * 3
    return P


def emissive(biome):
    return {fam for fam, per in EMIT.items() if biome in per}


def hsh(x, y, s):
    n = (x * 374761393 + y * 668265263 + s * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffffffff) / 4294967296


def vnoise(x, y, s, cell=3.0):
    gx, gy = x / cell, y / cell
    xi, yi = int(np.floor(gx)), int(np.floor(gy)); fx, fy = gx - xi, gy - yi
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b, c, d = hsh(xi, yi, s), hsh(xi + 1, yi, s), hsh(xi, yi + 1, s), hsh(xi + 1, yi + 1, s)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


def paint(oid, on, od, objects, parts, eps, P, cover=None, seed=0, is_chunk=False, tile=None, glow=()):
    H, W = oid.shape
    info = {int(k): (n.split('.')[0],) + tuple(parts[n.split('.')[0]]) for k, n in objects.items()}   # id -> (base, fam, opt)
    tone = np.full((H, W), -1)
    fam = np.full((H, W), '', object)
    for y in range(H):
        for x in range(W):
            i = oid[y, x]
            if not i:
                continue
            base, f, opt = info[i]
            fam[y, x] = f
            if 'fixed' in opt:
                tone[y, x] = opt['fixed']
                continue
            n = on[y, x] * (1, -1, 1)
            d = float(n @ LIGHT) + opt.get('bias', 0)
            tone[y, x] = 0 if d > HI else 1 if d > LO else 2
    N4 = ((0, -1), (-1, 0), (1, 0), (0, 1))
    inb = lambda y, x: 0 <= y < H and 0 <= x < W and oid[y, x]
    edits = {}
    for y in range(H):
        for x in range(W):
            i = oid[y, x]
            if not i or 'fixed' in info[i][2]:
                continue
            for dx, dy in N4:
                if not inb(y + dy, x + dx):
                    continue
                j = oid[y + dy, x + dx]
                if j == i:
                    continue
                same = info[j][1] == info[i][1]
                if od[y + dy, x + dx] < od[y, x] - eps:          # a nearer part next to this one: occlusion line
                    edits[(y, x)] = 3 if same else max(edits.get((y, x), tone[y, x]), 2)
                elif same and (dx == -1 or dy == -1) and info[i][2].get('seam', True) and info[j][2].get('seam', True) and abs(od[y + dy, x + dx] - od[y, x]) <= eps:
                    edits.setdefault((y, x), min(3, tone[y, x] + 1 if tone[y, x] < 2 else 3))   # a seam: one tone darker
    for (y, x), t in edits.items():
        tone[y, x] = t
    for _ in range(2):   # orphans within an object
        fix = {}
        for y in range(H):
            for x in range(W):
                i = oid[y, x]
                if not i or 'fixed' in info[i][2]:
                    continue
                nb = [tone[y + dy, x + dx] for dx, dy in N4 if inb(y + dy, x + dx) and oid[y + dy, x + dx] == i]
                if len(nb) >= 3 and tone[y, x] not in nb and tone[y, x] != 3:
                    fix[(y, x)] = max(set(nb), key=nb.count)
        for (y, x), t in fix.items():
            tone[y, x] = t
    # biome cover on what faces up: patchy noise, thicker toward the middle of a surface; frost drips a 1 px lip
    cov = np.zeros((H, W), bool)
    if cover and not is_chunk:
        K, T = cover
        for y in range(H):
            for x in range(W):
                i = oid[y, x]
                if not i or info[i][0] in NO_COVER or tone[y, x] >= 3:
                    continue
                up = float(on[y, x] * (1, -1, 1) @ UP)
                if up > T and vnoise(x, y, seed) < K + (up - T) * .8:
                    cov[y, x] = True
    img = np.zeros((H, W, 4), np.uint8)
    emit = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        for x in range(W):
            i = oid[y, x]
            if i:
                img[y, x, :3] = P['cover' if cov[y, x] else info[i][1]][tone[y, x]]
                img[y, x, 3] = 255
                if info[i][1] in glow:   # glowing parts: the same pixels again in the emit layer (added after the light)
                    emit[y, x] = img[y, x]
    if cover and not is_chunk and 'drip' in BIOMES_CUR:
        for y in range(1, H):
            for x in range(W):
                if cov[y - 1, x] and oid[y, x] and not cov[y, x] and info[oid[y, x]][0] not in NO_COVER and hsh(x, y, seed + 7) < BIOMES_CUR['drip']:
                    img[y, x, :3] = P['cover'][2]
    # exterior outline in the family of the nearest neighbouring part; lit side (empty up / left) = its shade tone
    ofam = {}
    for y in range(H):
        for x in range(W):
            if oid[y, x]:
                continue
            best = None
            for dx, dy in N4:
                if (tile == 'x' and dx) or (tile == 'y' and dy == 1):   # tiling segments: no outline across the joins
                    continue
                if inb(y + dy, x + dx) and (best is None or od[y + dy, x + dx] < best[0]):
                    j = oid[y + dy, x + dx]
                    best = (od[y + dy, x + dx], 'cover' if cov[y + dy, x + dx] else info[j][1])
            if best:
                ofam[(y, x)] = best[1]
    empty = lambda y, x: not (0 <= y < H and 0 <= x < W) or (not oid[y, x] and (y, x) not in ofam)
    for (y, x), f in ofam.items():
        img[y, x, :3] = P[f][5 if empty(y, x - 1) or empty(y - 1, x) else 4]
        img[y, x, 3] = 255
    return img, emit


BIOMES_CUR = {}
GROUPS, EMITS = {}, {}   # group.json per group; biome -> frames that have glowing pixels


def main(root):
    parts = json.load(open(os.path.join(root, 'parts.json')))
    frames, order = {}, []   # state -> (group dir, meta)
    for g in sorted(os.listdir(root)):
        gj = os.path.join(root, g, 'group.json')
        if not os.path.exists(gj):
            continue
        for s in json.load(open(gj))['states']:
            order.append((g, s))
    GROUPS.update({g: json.load(open(os.path.join(root, g, 'group.json'))) for g in {g for g, _ in order}})
    data = {}
    for g, s in order:   # downsample once (biome-independent)
        d = os.path.join(root, g, s)
        meta = json.load(open(os.path.join(d, 'meta.json')))
        rgb, alpha = load(os.path.join(d, 'id.png'))
        ids = np.rint(rgb[..., 0] * 255).astype(int) * (alpha > .5)
        nrm = load(os.path.join(d, 'nrm.png'))[0] * 2 - 1
        dep = load(os.path.join(d, 'dep.png'))[0][..., 0]
        thin = {int(k) for k, n in meta['objects'].items() if parts[n.split('.')[0]][1].get('thin')}
        oid, on, od = downsample(ids, nrm, dep, alpha, meta['ss'], thin)
        data[s] = (meta, oid, on, od)
    # shelf-pack (same layout for every biome atlas); frames keep their full canvas so animation pivots line up
    ATW, x, y, rowh = 1024, 0, 0, 0
    for g, s in order:
        meta = data[s][0]
        w, h = meta['w'], meta['h']
        if x + w > ATW:
            x, y, rowh = 0, y + rowh + 1, 0
        frames[s] = [x, y, w, h, meta['pivot'][0], meta['pivot'][1]]
        x += w + 1; rowh = max(rowh, h)
    ATH = y + rowh + 1
    nrm_at = np.zeros((ATH, ATW, 4), np.uint8)
    for g, s in order:
        meta, oid, on, od = data[s]
        fx, fy, w, h = frames[s][:4]
        nm = np.zeros((h, w, 4), np.uint8)
        nm[..., :3] = np.clip((on * .5 + .5) * 255 + .5, 0, 255).astype(np.uint8); nm[..., 3] = (oid > 0) * 255
        nrm_at[fy:fy + h, fx:fx + w] = nm
    Image.fromarray(nrm_at, 'RGBA').save(os.path.join(root, 'props_nrm.png'))
    for biome in BIOMES:
        BIOMES_CUR.clear(); BIOMES_CUR.update(BIOMES[biome])
        P = palette(biome)
        B = BIOMES[biome]
        at = np.zeros((ATH, ATW, 4), np.uint8)
        em = np.zeros((ATH, ATW, 4), np.uint8)
        glow = emissive(biome)
        for k, (g, s) in enumerate(order):
            meta, oid, on, od = data[s]
            eps = EPS_M / (meta['far'] - meta['near'])
            img, emit = paint(oid, on, od, meta['objects'], parts, eps, P, (B['coverK'], B['coverT']) if B.get('cover') else None,
                              seed=sum(map(ord, g)), is_chunk=g.startswith('chunk'), tile=GROUPS[g].get('tile'), glow=glow)
            fx, fy, w, h = frames[s][:4]
            at[fy:fy + h, fx:fx + w] = img
            em[fy:fy + h, fx:fx + w] = emit
            if emit[..., 3].any():
                EMITS.setdefault(biome, []).append(s)
        Image.fromarray(at, 'RGBA').save(os.path.join(root, f'props_{biome}.png'))
        if glow:
            Image.fromarray(em, 'RGBA').save(os.path.join(root, f'props_{biome}_emit.png'))
        print('atlas', biome, ATW, ATH)
    json.dump({'size': [ATW, ATH], 'frames': frames, 'groups': GROUPS, 'emit': EMITS, 'pitch': 20, 'upp': data[order[0][1]][0]['units_per_px'],
               'biomes': list(BIOMES), 'normals': 'props_nrm.png, linear, +x right +y up +z toward the viewer'},
              open(os.path.join(root, 'props.json'), 'w'))
    print('ok', len(frames), 'frames')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'props3d'))
