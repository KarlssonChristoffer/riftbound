# Ranger v8 = v7 re-proportioned "thinner, taller, more athletic": ~3.3 heads tall instead of ~2.5.
# The body is remapped in z piecewise (boots keep their size, legs and torso stretch, the head rides on top and is
# scaled down about the chin), slimmed with a width profile (narrow waist, chest wider than the waist, lean legs),
# the arms are lengthened and thinned along their own axis, and the bow follows the bow hand.
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_v8.py').read(), ns); ns['build']()
import bpy
from mathutils import Vector

exec(open(r'D:\Game\tools\blender\ranger_v7.py', encoding='utf-8').read())
COL = ROOT = 'RangerV8'
_build_v7 = build

PROP = dict(boot_top=.275, hip=.58, chin=1.13, legs=2.0, torso=1.25, head=.93,
            leg_w=.85, boot_w=.92, hem=1.1, cape_hem=1.5, leg_d=.82, waist=.72, chest=1.0, shoulder=1.1, depth=.85, arm_len=1.35, arm_thin=.78, bow=1.2)


def zmap(z, P):
    """Piecewise-linear height remap: boots 1:1, hips->legs stretched, belt->chin stretched, above: shifted."""
    b, h, c = P['boot_top'], P['hip'], P['chin']
    if z <= b:
        return z
    if z <= h:
        return b + (z - b) * P['legs']
    top = b + (h - b) * P['legs']
    if z <= c:
        return top + (z - h) * P['torso']
    return top + (c - h) * P['torso'] + (z - c)


def width(z, P):
    """Horizontal scale of torso-attached parts by original height: lean hips, narrow waist, chest, full shoulders."""
    pts = [(0, P['leg_w']), (P['hip'], P['waist']), (.90, P['chest']), (1.02, P['shoulder']), (9, P['shoulder'])]
    for (z0, w0), (z1, w1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            return w0 + (w1 - w0) * (z - z0) / (z1 - z0)
    return pts[0][1]


def centre(ob):
    vs = ob.data.vertices
    return sum((v.co for v in vs), Vector()) / len(vs)


def build():
    names = _build_v7()
    P = PROP
    obs = {o.name: o for o in bpy.data.collections[COL].objects if o.type == 'MESH'}
    head = [n for n in obs if n.split('.')[0] in ('Head', 'Hair', 'HairLock', 'Fringe', 'Eye', 'HairTuft')]
    arms = [n for n in obs if n.split('.')[0] in ('Arm', 'Hand')]
    bow = ['Bow', 'BowString']
    limbs = [n for n in obs if n.split('.')[0] in ('Leg', 'Boot', 'Foot')]
    grip0 = centre(obs['Hand.L'])
    hands0 = {s: centre(obs[f'Hand.{s}']) for s in 'LR'}
    # ---- body: remap height, slim by the width profile (legs slim about their own axis) ----
    for n, ob in obs.items():
        if n in head or n in arms or n in bow:
            continue
        cx = centre(ob).x if n in limbs else 0
        boot = n.split('.')[0] in ('Boot', 'Foot')
        for v in ob.data.vertices:
            w = P['boot_w'] if boot else width(v.co.z, P)
            v.co.x = cx * (.9 if n in limbs else 1) + (v.co.x - cx) * w
            v.co.y *= (P['leg_d'] if n in limbs else P['depth']) if v.co.z < P['hip'] else P['depth'] if n not in ('Cape', 'Quiver', 'Fletch.0', 'Fletch.1', 'Fletch.2', 'Hood') else 1 - (1 - P['depth']) * .5
            if n in ('Torso', 'Cape') and v.co.z < P['hip']:  # tunic skirt and cape hang from the belt line
                v.co.z = zmap(P['hip'], P) - (P['hip'] - v.co.z) * P['hem' if n == 'Torso' else 'cape_hem']
            else:
                v.co.z = zmap(v.co.z, P)
    # ---- head: ride on the new chin, scaled down about it ----
    c0, c1 = Vector((0, 0, P['chin'])), Vector((0, 0, zmap(P['chin'], P)))
    for n in head:
        for v in obs[n].data.vertices:
            v.co = c1 + (v.co - c0) * P['head']
    # ---- arms: move with the shoulder, lengthen along their own axis, thin across it ----
    for s, sx in (('L', 1), ('R', -1)):
        S0 = Vector((sx * .245, .01, 1.00))
        S1 = Vector((S0.x * width(1.0, P), S0.y * P['depth'], zmap(1.0, P)))
        a = (hands0[s] - S0).normalized()
        for n in (f'Arm.{s}', f'Hand.{s}'):
            for v in obs[n].data.vertices:
                d = v.co - S0
                along = d.dot(a)
                v.co = S1 + a * along * P['arm_len'] + (d - a * along) * P['arm_thin']
    # ---- bow: follows the bow hand, a bit longer (longbow) ----
    grip1 = centre(obs['Hand.L'])
    for n in bow:
        for v in obs[n].data.vertices:
            v.co = grip1 + (v.co - grip0) * P['bow']
    return names
