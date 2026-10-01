# Pixelizer: the "Aseprite step" of the Blender pixel rig, in code. Reads the ID/normal/depth passes written by
# tools/blender/pixel_rig.py and paints each facing with the master sprite's own language (spritekit.py):
# master palette families, top-left light quantised into hi/base/shade bands, interior lines and occlusion where a
# nearer part meets a farther one, exterior local outline, orphan clean-up. Blender decides shape and pose only.
#   python concepts/sprites/pixelize.py [render_dir]
#   python concepts/sprites/pixelize.py <dir with poses.json> body   (one sheet per pose)
# Writes into render_dir: ranger3d_<DIR>.png (+ _raw = bands only), ranger3d_sheet.png, ranger3d_raw_sheet.png,
# ranger3d_normals.png (linear, OpenGL convention: +x right, +y up, +z out) and ranger3d_sheet.json.
import json, os, sys
import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import palette_harm  # noqa: E402  the harmonized ramps (integration step 1): [hi, base, shade, line, outline_shadow, outline_lit]
# PIXELIZE_PALETTE=orig keeps the old 4-tone look (line = outline = the darkest tone) for A/B renders
ORIG = os.environ.get('PIXELIZE_PALETTE') == 'orig'
def ramp_of(fam, tones):
    if ORIG:
        o = [tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) for h in tones]
        return o + [o[3], o[3]]
    return palette_harm.ramp(fam, tones)
FAMS = json.load(open(os.path.join(HERE, 'out', 'ranger_master_layers.json')))['families']
FAMS = {k: ramp_of(k, v) for k, v in FAMS.items()}
LIGHT = np.array((-0.55, -0.62, 0.56)); LIGHT /= np.linalg.norm(LIGHT)  # image space (y down), as spritekit
HI, LO = .78, .36
# opt-in crease highlights (pixel.js edge pass / Kyriota's rule): a pixel on a CONVEX normal crease, that is not the
# farther side of a depth step, goes one tone lighter. The value is the crease strength needed (sum of 1 - n.n'); off by default
CREASE = float(os.environ.get('PIXELIZE_CREASE', 0) or 0)

# object base name -> (part, family, options). fixed=tone: unshaded; bias shifts the lambert term; thin: survives
# downsampling at low coverage; lines/outline as in spritekit.
PARTS = {
    'Hair': ('hair', 'hair', {}), 'HairLock': ('hair', 'hair', {}), 'Fringe': ('hair', 'hair', {}), 'HairTuft': ('hair', 'hair', {}),
    'Head': ('head', 'skin', {'bias': .12}), 'Neck': ('neck', 'skin', {'bias': -.15}),
    'Eye': ('eye', 'char', {'fixed': 3, 'outline': False, 'lines': False, 'thin': True}),
    'Hand': ('hand', 'skin', {}),
    'Mantle': ('mantle', 'red', {}), 'Hood': ('mantle', 'red', {}), 'Cape': ('cape', 'red', {'bias': -.1}),
    'Torso': ('torso', 'green', {}), 'Arm': ('arm', 'green', {}), 'Belt': ('belt', 'leather', {'bias': -.2}),
    'Leg': ('leg', 'char', {}), 'Boot': ('boot', 'leather', {}), 'Foot': ('boot', 'leather', {}),
    'Strap': ('strap', 'leather', {'bias': -.1}), 'Quiver': ('quiver', 'leather', {'bias': -.1}), 'Fletch': ('fletch', 'red', {'thin': True}),
    'Bow': ('bow', 'leather', {'bias': .15, 'thin': True}),
    'BowString': ('string', 'skin', {'fixed': 0, 'outline': False, 'lines': False, 'thin': True}),
}


def srgb_decode(c):
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def load(path):
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED).astype(np.float64) / 65535
    rgb = srgb_decode(a[..., 2::-1])  # BGRA -> RGB, undo Blender's Standard view (sRGB) encoding
    return rgb, a[..., 3]


def downsample(ids, nrm, dep, alpha, ss, thin_ids, line_ids=(), skip_ids=()):
    """ss x ss block -> one pixel: majority coverage, then the most common object (thin objects win at >= 1/4)."""
    H, W = ids.shape[0] // ss, ids.shape[1] // ss
    oid = np.zeros((H, W), int); on = np.zeros((H, W, 3)); od = np.ones((H, W))
    for y in range(H):
        for x in range(W):
            sl = (slice(y * ss, y * ss + ss), slice(x * ss, x * ss + ss))
            cov = alpha[sl] > .5
            if skip_ids:  # HD overlay parts are drawn by the game; their thin samples must not punch holes
                cov = cov & ~np.isin(ids[sl], list(skip_ids))
            ob = ids[sl][cov]
            if not len(ob):
                continue
            vals, cnt = np.unique(ob, return_counts=True)
            # line parts (a bowstring): any coverage counts, so a sub-pixel line stays continuous; the ID pass already
            # holds only its visible samples, so it still vanishes behind nearer parts
            line = [v for v in vals if v in line_ids]
            if line:
                pick = line[0]
                m = cov & (ids[sl] == pick)
                n = nrm[sl][m].mean(0)
                oid[y, x], on[y, x], od[y, x] = pick, n / (np.linalg.norm(n) + 1e-9), dep[sl][m].mean()
                continue
            thin = [(c, v) for v, c in zip(vals, cnt) if v in thin_ids and c * 4 >= ss * ss]
            if thin:
                pick = max(thin)[1]
            elif cov.sum() * 2 >= ss * ss or (skip_ids and cov.sum() * 2 >= (ss * ss - np.isin(ids[sl], list(skip_ids)).sum())):
                pick = vals[cnt.argmax()]
            else:
                continue
            m = cov & (ids[sl] == pick)
            n = nrm[sl][m].mean(0)
            oid[y, x], on[y, x], od[y, x] = pick, n / (np.linalg.norm(n) + 1e-9), dep[sl][m].mean()
    return oid, on, od


def paint(oid, on, od, objects, eps, table=None):
    H, W = oid.shape
    info = {}
    for k, name in objects.items():
        base, side = name.split('.')[0], name.split('.')[1] if '.' in name else ''
        if table:  # the model's own table: every left/right segment is its own part (limbs crossing get lines)
            part, fam, opt = table[base]
            info[int(k)] = (part + ('.' + side if side else ''), fam, opt)
        else:
            part, fam, opt = PARTS[base]
            info[int(k)] = (part + ('.' + side if side and part in ('hand', 'arm', 'leg', 'boot') else ''), fam, opt)
    tone = np.full((H, W), -1)
    for y in range(H):
        for x in range(W):
            if oid[y, x]:
                _, _, opt = info[oid[y, x]]
                if 'fixed' in opt:
                    tone[y, x] = opt['fixed']
                else:
                    n = on[y, x] * (1, -1, 1)  # camera space (y up) -> image space (y down)
                    d = float(n @ LIGHT) + opt.get('bias', 0)
                    tone[y, x] = 0 if d > HI else 1 if d > LO else 2
    raw = tone.copy()
    part = lambda y, x: info[oid[y, x]] if 0 <= y < H and 0 <= x < W and oid[y, x] else None
    N4 = ((0, -1), (-1, 0), (1, 0), (0, 1))
    # interior lines / occlusion: a nearer, different part next to this pixel
    edits = {}
    for y in range(H):
        for x in range(W):
            p = part(y, x)
            if not p or not p[2].get('lines', True):
                continue
            for dx, dy in N4:
                q = part(y + dy, x + dx)
                if not q or q[0] == p[0] or not q[2].get('outline', True) or od[y + dy, x + dx] > od[y, x] - eps:
                    continue
                if q[1] == p[1]:
                    edits[(y, x)] = 3
                elif dy == -1 or dx == -1:
                    edits[(y, x)] = max(edits.get((y, x), tone[y, x]), 2)
    for (y, x), t in edits.items():
        tone[y, x] = t
    # orphan clean-up within a part
    for _ in range(2):
        fix = {}
        for y in range(H):
            for x in range(W):
                p = part(y, x)
                if not p or 'fixed' in p[2]:
                    continue
                nb = [tone[y + dy, x + dx] for dx, dy in N4 if part(y + dy, x + dx) and part(y + dy, x + dx)[0] == p[0]]
                if len(nb) >= 3 and tone[y, x] not in nb and tone[y, x] != 3:
                    fix[(y, x)] = max(set(nb), key=nb.count)
        for (y, x), t in fix.items():
            tone[y, x] = t
    if CREASE:
        lift = {}
        for y in range(H):
            for x in range(W):
                p = part(y, x)
                if not p or 'fixed' in p[2] or tone[y, x] >= 3:
                    continue
                n, e = on[y, x], 0.0
                for dx, dy in N4:
                    if not part(y + dy, x + dx) or abs(od[y + dy, x + dx] - od[y, x]) > 4 * eps:
                        continue            # a depth step is an outline/occlusion edge, not a crease
                    nn = on[y + dy, x + dx]
                    if (nn - n) @ (dx, -dy, 0) > .05:   # normals splay apart toward the neighbour: convex
                        e += 1 - float(n @ nn)
                if e > CREASE:
                    lift[(y, x)] = max(0, tone[y, x] - 1)
        for (y, x), t in lift.items():
            tone[y, x] = t

    def img(tn, outline):
        out = np.zeros((H, W, 4), np.uint8)
        ofam = {}
        for y in range(H):
            for x in range(W):
                if oid[y, x]:
                    out[y, x] = FAMS[info[oid[y, x]][1]][tn[y, x]] + (255,)
                elif outline:  # exterior local outline: the family of the nearest neighbouring part
                    best = None
                    for dx, dy in N4:
                        q = part(y + dy, x + dx)
                        if q and q[2].get('outline', True) and (best is None or od[y + dy, x + dx] < best[0]):
                            best = (od[y + dy, x + dx], q[1])
                    if best:
                        ofam[(y, x)] = best[1]
        # selective outline (the environment's rule): where the empty side is up or left, i.e. the edge faces the
        # top-left light, the outline takes the shade tone; elsewhere the lifted dark
        empty = lambda y, x: not (0 <= y < H and 0 <= x < W) or (not oid[y, x] and (y, x) not in ofam)
        for (y, x), f in ofam.items():
            out[y, x] = FAMS[f][5 if empty(y, x - 1) or empty(y - 1, x) else 4] + (255,)
        return Image.fromarray(out, 'RGBA')

    return img(tone, True), img(raw, False)


def depth_map(opaque, oid, od):
    """Per sprite pixel view depth (0 = near .. 254 = far of the render box, 255 = empty) for the game's runtime cloth.
    Outline pixels (no part) take the nearest neighbouring part's depth, so cloth behind the body stays behind them."""
    H, W = oid.shape
    d = np.full((H, W), 255, np.uint8)
    body = oid > 0
    d[body] = np.clip(np.rint(od[body] * 254), 0, 254).astype(np.uint8)
    for y, x in zip(*np.nonzero(opaque & ~body)):
        nb = [d[y + dy, x + dx] for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1))
              if 0 <= y + dy < H and 0 <= x + dx < W and body[y + dy, x + dx]]
        d[y, x] = min(nb) if nb else 0
    return d


OVERLAYS = {}  # frame -> dir -> overlay data, written once per set as overlays.json
# stylization: HD string/arrow count as behind these parts (never a line across the chest or face at 1x)
CORE = ('Head', 'Neck', 'Chest', 'Ribs', 'Belly', 'Pelvis', 'Eye', 'Shirt', 'Tunic', 'Pants', 'Scarf', 'Cloak', 'Hair',
        'Quiver', 'Belt', 'Thigh', 'Shin', 'Leg', 'Boot', 'Foot', 'Toe')


def overlay_paths(meta, d, ids, ss, over, table, n=24):
    """HD overlay data for one facing. over = {type: set(ids)}.
    string: tip A -> nock -> tip B (sprite px) + per-sample visibility (the ID pass shows the string there).
    arrow: nock, BowArrow0 tail, len_ratio (tip = nock + (tail - nock) * len_ratio) + visibility along the arrow."""
    b = meta['bones'][d]
    H, W = ids.shape
    names = meta['objects']
    core = {int(k) for k, nm in names.items() if nm.split('.')[0].startswith(CORE) and not any(w in nm for w in ('Sleeve', 'Arm', 'Hand'))}
    all_over = set().union(*over.values())
    def vis(P, Q, which):
        out = []
        for t in np.linspace(0, 1, n):
            x, y = ((P + (Q - P) * t) * ss).astype(int)
            win = ids[max(0, y - 2):min(H, y + 3), max(0, x - 2):min(W, x + 3)]
            seen = np.isin(win, list(which)).any()             # really visible (nothing nearer in front of it)
            under = win[(win > 0) & ~np.isin(win, list(all_over))]
            behind_core = under.size and np.isin(under, list(core)).mean() > .5   # would cross the torso/head/...
            out.append(int(seen and not behind_core))
        return out
    res = {}
    if 'string' in over and all(k in b for k in ('BowTipA0', 'BowNock0', 'BowTipB0')):
        A, N, B = (np.array(b[k][:2]) for k in ('BowTipA0', 'BowNock0', 'BowTipB0'))
        res['string'] = [[round(float(v), 2) for v in (*A, *N, *B)], vis(A, N, over['string']), vis(N, B, over['string'])]
    if 'arrow' in over and 'BowArrow0' in b:
        hx, hy, tx, ty = b['BowArrow0']
        N, T = np.array([hx, hy]), np.array([tx, ty])
        ratio = table.get('Arrow', [0, 0, {}])[2].get('len_ratio', 9.5)
        if np.linalg.norm(T - N) > .05:     # the arrow bone is collapsed when nothing is nocked
            tip = N + (T - N) * ratio
            res['arrow'] = [[round(float(v), 2) for v in (*N, *T)] + [round(ratio, 3)], vis(N, tip, over['arrow'])]
    return res or None


def main(rdir, name='ranger3d'):
    meta = json.load(open(os.path.join(rdir, 'meta.json')))
    W, H, ss = meta['w'], meta['h'], meta['ss']
    for k, v in meta.get('families', {}).items():  # extra palette families from the model (garments)
        FAMS[k] = ramp_of(k, v)
    table = meta.get('parts')
    thin = {int(k) for k, n in meta['objects'].items() if (table or PARTS)[n.split('.')[0]][2].get('thin')}
    lines = {int(k) for k, n in meta['objects'].items() if (table or PARTS)[n.split('.')[0]][2].get('line')}
    over = {}
    for k, n in meta['objects'].items():
        kind = (table or PARTS)[n.split('.')[0]][2].get('overlay')
        if kind:
            over.setdefault(kind, set()).add(int(k))
    over_ids = set().union(*over.values()) if over else set()
    eps = .06 / (meta['far'] - meta['near'])  # 6 cm of depth separates "in front" from "touching"
    sheet, rsheet, nsheet = (Image.new('RGBA', (W * len(meta['dirs']), H)) for _ in range(3))
    dsheet = Image.new('L', (W * len(meta['dirs']), H), 255) if 'sim' in meta else None   # runtime cloth occlusion
    for i, d in enumerate(meta['dirs']):
        rgb, alpha = load(os.path.join(rdir, f'{d}_id.png'))
        ids = np.rint(rgb[..., 0] * 255).astype(int) * (alpha > .5)
        nrm = load(os.path.join(rdir, f'{d}_nrm.png'))[0] * 2 - 1
        dep = load(os.path.join(rdir, f'{d}_dep.png'))[0][..., 0]
        oid, on, od = downsample(ids, nrm, dep, alpha, ss, thin, lines, over_ids)
        if over_ids:  # HD overlay parts (the bowstring, the nocked arrow) are drawn by the game at screen resolution
            OVERLAYS.setdefault(os.path.basename(os.path.normpath(rdir)), {})[d] = overlay_paths(meta, d, ids, ss, over, table or {})
        final, raw = paint(oid, on, od, meta['objects'], eps, table)
        final.save(os.path.join(rdir, f'{name}_{d}.png')); raw.save(os.path.join(rdir, f'{name}_{d}_raw.png'))
        sheet.paste(final, (W * i, 0)); rsheet.paste(raw, (W * i, 0))
        nm = np.zeros((H, W, 4), np.uint8)
        nm[..., :3] = np.clip((on * .5 + .5) * 255 + .5, 0, 255).astype(np.uint8); nm[..., 3] = (oid > 0) * 255
        nsheet.paste(Image.fromarray(nm, 'RGBA'), (W * i, 0))
        if dsheet:
            dsheet.paste(Image.fromarray(depth_map(np.array(final)[..., 3] > 0, oid, od), 'L'), (W * i, 0))
    sheet.save(os.path.join(rdir, f'{name}_sheet.png')); rsheet.save(os.path.join(rdir, f'{name}_raw_sheet.png'))
    nsheet.save(os.path.join(rdir, f'{name}_normals.png'))
    if dsheet:
        dsheet.save(os.path.join(rdir, f'{name}_depth.png'))
    cols = {tuple(c) for c in np.array(sheet).reshape(-1, 4) if c[3]}
    json.dump({'frame': [W, H], 'pivot': meta['pivot'], 'dirs': meta['dirs'], 'layout': 'one row, dirs left to right',
               'colours': len(cols), 'source': meta['model'], 'camera': {'yaw': meta['yaw'], 'pitch': meta['pitch']},
               'normals': f'{name}_normals.png, linear, +x right +y up +z toward viewer'},
              open(os.path.join(rdir, f'{name}_sheet.json'), 'w'), indent=1)
    print('ok', len(cols), 'colours')


if __name__ == '__main__':
    # pixelize.py [render_dir] [name]; a dir holding poses.json is processed pose by pose
    rdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'out', 'render')
    nm = sys.argv[2] if len(sys.argv) > 2 else 'ranger3d'
    pj = os.path.join(rdir, 'poses.json')
    force = os.environ.get('PIXELIZE_ALL') == '1'
    for d in ([os.path.join(rdir, p) for p in json.load(open(pj))['poses']] if os.path.exists(pj) else [rdir]):
        sheet, meta = os.path.join(d, f'{nm}_sheet.png'), os.path.join(d, 'meta.json')
        if not force and os.path.exists(sheet) and os.path.getmtime(sheet) >= os.path.getmtime(meta):
            continue  # already up to date (incremental renders only touch new/changed frames)
        main(d, nm)
    ovf = os.path.join(rdir, 'overlays.json')
    if OVERLAYS and os.path.exists(pj) and os.environ.get('PIXELIZE_NO_OVERLAYS') != '1':   # (palette-only passes skip it)
        merged = json.load(open(ovf)) if os.path.exists(ovf) else {}
        merged.update(OVERLAYS)
        json.dump(merged, open(ovf, 'w'))
        print('overlays for', len(OVERLAYS), 'frames')
