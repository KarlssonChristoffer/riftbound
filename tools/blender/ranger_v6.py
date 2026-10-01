# Ranger v6 = v5 reshaped against the master at the locked 20° camera (gate: master vs render at 1x).
# 1. Bigger head and a much bigger open face: head group scaled up about the chin, the hair cap's front edge and the
#    fringe lifted so the face shows from mid-head down (master: ~170 face px at 1x, v5 had 63-100).
# 2. Arms swung out from the body; the bow hand moves out and the bow stays upright, clear of the torso.
# 3. The scarf sits directly under the chin and the tunic's top edge tucks under it.
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_v6.py').read(), ns); ns['build']()
import bpy, math
from mathutils import Matrix, Vector

exec(open(r'D:\Game\tools\blender\ranger_v5.py', encoding='utf-8').read())
COL = ROOT = 'RangerV6'
_build_v5 = build

HEAD = ('Head', 'Hair', 'HairLock.L', 'HairLock.R', 'Fringe', 'Eye.L', 'Eye.R')
CHIN = Vector((0, 0, 1.13))


def verts(name):
    return bpy.data.objects[name].data.vertices


def xform(names, M):
    for n in names:
        for v in verts(n):
            v.co = M @ v.co


def about(p, M3):
    return Matrix.Translation(p) @ M3.to_4x4() @ Matrix.Translation(-p)


def build():
    names = _build_v5()
    P = PARAMS
    # ---- 1. head: open the face, then scale the whole head group up about the chin ----
    for v in verts('Hair'):                       # lift the cap's front edge toward the crown
        front = min(1, max(0, (-v.co.y - .02) / .26))
        if v.co.z < P['hair_edge']:
            v.co.z += front * (P['hair_edge'] - v.co.z) * P['hair_lift']
    for v in verts('Fringe'):
        v.co.z += P['fringe_up']
    for n in ('Eye.L', 'Eye.R'):                  # 1 px wide, 2 px tall eyes like the master
        cx = sum(v.co.x for v in verts(n)) / len(verts(n))
        for v in verts(n):
            v.co.z += P['eye_up']
            v.co.x = cx + (v.co.x - cx) * P['eye_w']
    xform(HEAD, about(CHIN, Matrix.Diagonal((P['head'],) * 3)))
    # ---- 2. arms out: swing each arm about its shoulder around the forward axis; the bow follows the hand, upright ----
    for sfx, sx in (('L', 1), ('R', -1)):
        S = Vector((sx * .245, .01, 1.00))
        a = math.radians(P['arm_out'] if sx > 0 else P['arm_out_r'])
        R = about(S, Matrix.Rotation(-sx * a, 3, 'Y'))
        if sx > 0:
            grip0 = sum((v.co for v in verts('Hand.L')), Vector()) / len(verts('Hand.L'))
        xform((f'Arm.{sfx}', f'Hand.{sfx}'), R)
        if sx > 0:
            grip1 = sum((v.co for v in verts('Hand.L')), Vector()) / len(verts('Hand.L'))
            xform(('Bow', 'BowString'), Matrix.Translation(grip1 - grip0 + Vector((P['bow_out'], 0, 0))))
    # ---- 3. scarf right under the chin, tunic top tucked below it ----
    lo, hi = P['scarf']
    zs = [v.co.z for v in verts('Mantle')]
    z0, z1 = min(zs), max(zs)
    for v in verts('Mantle'):
        v.co.z = lo + (v.co.z - z0) / (z1 - z0) * (hi - lo)
        v.co.x *= P['scarf_w']; v.co.y *= P['scarf_w']
    for v in verts('Hood'):
        v.co.z += hi - 1.04
    for v in verts('Torso'):
        if v.co.z > lo:
            v.co.z = lo + (v.co.z - lo) * .25
    # ---- quiver strap: right shoulder to left hip, lying on the tunic front (the master's diagonal) ----
    rings = [(.52, .255, .175), (.64, .23, .16), (.78, .225, .155), (.94, .245, .165), (1.0, .24, .16)]
    def front(x, z):
        for (z0, a0, b0), (z1, a1, b1) in zip(rings, rings[1:]):
            if z0 <= z <= z1:
                t = (z - z0) / (z1 - z0); rx, ry = a0 + (a1 - a0) * t, b0 + (b1 - b0) * t
                return -ry * max(0, 1 - abs(x / rx) ** 2.8) ** (1 / 2.8)
    pts = []
    for i in range(7):
        t = i / 6
        x, z = -.20 + .40 * t, .97 - .33 * t
        pts.append((x, front(x, z) - .012, z))
    sweep('Strap', pts, [(.012, .032)] * 7, n=6, p=2.0, side=(0, -1, 0))
    bpy.data.objects['Strap'].data.materials.clear()
    bpy.data.objects['Strap'].data.materials.append(bpy.data.materials['PalBelt'])
    return names


PARAMS = dict(head=1.12, hair_edge=1.70, hair_lift=.55, fringe_up=.05, eye_up=.02,
              arm_out=30, arm_out_r=14, bow_out=.12, eye_w=.5, scarf=(.97, 1.12), scarf_w=1.0)
