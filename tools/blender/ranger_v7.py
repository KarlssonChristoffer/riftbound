# Ranger v7 = v6 made angular ("less curvy, sharper face and hair"):
# - every lofted part is rebuilt with fewer ring segments (octagons/hexagons) and fewer rings, so volumes read as planes
# - flat shading, so each plane lands as one tone band after pixelize (crisp facets instead of soft gradients)
# - saw-toothed fringe, pointed side locks, nape tufts and a V chin
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_v7.py').read(), ns); ns['build']()
import bpy, math
from mathutils import Vector

exec(open(r'D:\Game\tools\blender\ranger_v6.py', encoding='utf-8').read())
COL = ROOT = 'RangerV7'
_build_v6 = build
_sweep = sweep
HEM = -.11  # how far the hair clumps hang below the cap

# base name -> (ring segments, keep every k-th ring). The first and last ring are always kept.
LOW = {'Head': (8, 2), 'Hair': (12, 3), 'Torso': (8, 2), 'Mantle': (8, 1), 'Cape': (6, 1), 'Neck': (6, 1),
       'Arm': (6, 1), 'Hand': (6, 1), 'Leg': (6, 1), 'Boot': (6, 2), 'Foot': (6, 1), 'Belt': (8, 1), 'Quiver': (6, 1)}


def sweep(name, pts, radii, n=12, p=2.6, side=(1, 0, 0), warp=None, caps=True):
    base = name.split('.')[0]
    if base in LOW:
        n, step = LOW[base]
        idx = list(range(0, len(pts), step))
        if idx[-1] != len(pts) - 1:
            idx.append(len(pts) - 1)
        pts, radii = [pts[i] for i in idx], [radii[i] for i in idx]
        if warp:  # warps are written against the original ring index
            w0 = warp; warp = lambda k, x, y: w0(idx[k], x, y)
        if base == 'Hair':  # clumped hem: every other vertex of the bottom ring drops into a point
            def warp(k, x, y, n=n):
                i = round((math.atan2(y, x) - math.pi / n) / (2 * math.pi / n)) % 2
                return (0, 0, HEM if k == 0 and i == 0 else 0)  # dt runs along the path (up the cap): negative hangs down
    elif base == 'Fringe':
        # diamond section; the lower two vertices of every other ring drop -> a row of hair points
        n, p = 4, 2.0
        radii = [(r[0] * 1.15, r[1]) for r in radii]
        warp = lambda k, x, y: (-(.12 if k % 2 == 0 and 0 < k < len(pts) - 1 else .0) if x < 0 else 0, 0, 0)
    elif base == 'HairLock':
        n, p = 4, 2.0
        radii = list(radii[:-1]) + [(.004, .004)]  # taper to a point
    return _sweep(name, pts, radii, n=n, p=p, side=side, warp=warp, caps=caps)


def build():
    names = _build_v6()
    # V chin: the front-bottom vertices of the head come down and forward
    hv = bpy.data.objects['Head'].data.vertices
    zmin = min(v.co.z for v in hv)
    for v in hv:
        if v.co.z < zmin + .02 and v.co.y < -.02:
            v.co.z -= .045 * (1 - min(1, abs(v.co.x) / .12)); v.co.y -= .015
    # tapered jaw: the lower third of the head narrows toward the chin
    z1 = max(v.co.z for v in hv); jaw = zmin + .38 * (z1 - zmin)
    for v in hv:
        if v.co.z < jaw:
            v.co.x *= .72 + .28 * (v.co.z - zmin) / (jaw - zmin)
    # nape tufts: three pointed wedges under the back of the hair cap
    hair = bpy.data.objects['Hair'].data.vertices
    zb = min(v.co.z for v in hair)
    back = max(v.co.y for v in hair)
    for i, x in enumerate((-.17, 0, .17)):
        top = Vector((x, back - .06, zb + .10))
        sweep(f'HairTuft.{i}', [top, top + Vector((x * .15, .03, -.10)), top + Vector((x * .25, .05, -.17))],
              [(.07, .05), (.045, .035), (.004, .004)], n=4, p=2.0, side=(1, 0, 0))
        ob = bpy.data.objects[f'HairTuft.{i}']
        ob.data.materials.clear(); ob.data.materials.append(bpy.data.materials['PalHair'])
    for ob in bpy.data.collections[COL].objects:  # flat shading everywhere
        if ob.type == 'MESH':
            for f in ob.data.polygons:
                f.use_smooth = False
    return names
