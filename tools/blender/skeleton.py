# Base skeleton + base body (step 1 of the layered character: skeleton -> body -> hair -> clothing/armour).
# - Armature with Mixamo bone names (the game aliases them, Mixamo clips can be used as motion reference).
# - Every landmark comes from one proportions table (PROP), in metres; the character faces -Y, its left is +X, Z up.
# - Base body: angular low-poly segments (8-sided rings, flat shading). Each segment is bound 100% to one bone
#   (rigid skinning): at sprite size, blended weights only add pinched joints; rigid segments with overlapping
#   joint caps always stay clean. Clothing will be separate meshes bound to the same bones.
# - POSES: a test library (A-pose, idle, walk contact/passing, bow draw, lunge, reach, crouch) written as
#   rotations about the rest-frame axes of each bone: X = side axis (bend fwd/back), Y = forward axis (raise/lower
#   sideways), Z = vertical (twist). Right-side bones are mirrored automatically. Feet are snapped to the ground.
# Render:  D:\Blender\blender.exe -b --factory-startup --python tools/blender/pixel_rig.py -- \
#            --model tools/blender/skeleton.py --out concepts/sprites/out/skel --poses apose,idle,... --fig 54
import bpy, bmesh, math
from mathutils import Matrix, Vector

COL, ROOT = 'Skeleton', 'Skel'
BODY_TAGS = {'human_small'}   # garments declare which body archetypes they fit (no arbitrary scaling)
HOLD_HOOKS = []               # held items (bow, staff, ...) adjust the hand after each pose: grip constraints
PIXEL_FAMILIES = {}           # extra palette families (hi, base, shade, outline) added by garments
SOFT_PARTS = set()            # cloth part base names: excluded from the ground snap (a hem may brush the floor)

PROP = dict(
    height=1.80, heads=3.6,            # 3.6 heads for the bare body: hair adds volume on top later
    hip_z=.40, knee_z=.21, ankle_z=.045,  # joint heights as fractions of height (long, athletic legs)
    hip_w=.095, shoulder_w=.20,        # half-widths of the hip and shoulder joints, metres at 1.80 m
    upper_arm=.27, fore_arm=.24, hand=.13, arm_down=45,  # rest = A-pose, arms 45 deg below horizontal
    waist=.14, chest=.19, pelvis=.165,  # torso half-widths: V-taper
)

# object base name -> (part, family, options) for concepts/sprites/pixelize.py (written into meta.json)
PIXEL = {
    'Head': ['head', 'skin', {'bias': .12}], 'Eye': ['eye', 'char', {'fixed': 3, 'outline': False, 'lines': False, 'thin': True}],
    'Neck': ['neck', 'skin', {'bias': -.15}], 'Chest': ['torso', 'skin', {}], 'Ribs': ['torso', 'skin', {}],
    'Belly': ['torso', 'skin', {}], 'Pelvis': ['pelvis', 'char', {}],
    'UpperArm': ['uarm', 'skin', {}], 'ForeArm': ['farm', 'skin', {}], 'Hand': ['hand', 'skin', {}],
    'Thigh': ['thigh', 'skin', {}], 'Shin': ['shin', 'skin', {}], 'Foot': ['foot', 'skin', {'bias': -.05}], 'Toe': ['foot', 'skin', {'bias': -.05}],
}


def landmarks(P=PROP):
    s = P['height'] / 1.8
    H = P['height']
    chin = H - H / P['heads']
    J = {}
    J['hips'] = Vector((0, 0, P['hip_z'] * H + .04 * s))
    J['spine'] = Vector((0, 0, J['hips'].z + .08 * s))
    J['spine1'] = Vector((0, 0, J['spine'].z + .11 * s))
    J['neck'] = Vector((0, 0, chin - .08 * s))
    J['spine2'] = Vector((0, 0, (J['spine1'].z + J['neck'].z) / 2))
    J['head'] = Vector((0, 0, chin))
    J['top'] = Vector((0, 0, H))
    a = math.radians(P['arm_down'])
    for side, sx in (('L', 1), ('R', -1)):
        sh = Vector((sx * P['shoulder_w'] * s, 0, J['neck'].z - .03 * s))
        d = Vector((sx * math.cos(a), 0, -math.sin(a)))
        J['clav' + side] = Vector((sx * .03 * s, 0, sh.z + .01 * s))
        J['shoulder' + side] = sh
        J['elbow' + side] = sh + d * P['upper_arm'] * s
        J['wrist' + side] = J['elbow' + side] + d * P['fore_arm'] * s
        J['hand' + side] = J['wrist' + side] + d * P['hand'] * s
        J['hip' + side] = Vector((sx * P['hip_w'] * s, 0, P['hip_z'] * H))
        J['knee' + side] = Vector((sx * P['hip_w'] * .95 * s, -.005 * s, P['knee_z'] * H))
        J['ankle' + side] = Vector((sx * P['hip_w'] * .95 * s, .01 * s, P['ankle_z'] * H))
        J['ball' + side] = Vector((sx * P['hip_w'] * .95 * s, -.11 * s, .025 * s))
        J['toe' + side] = Vector((sx * P['hip_w'] * .95 * s, -.175 * s, .02 * s))
    return J


BONES = [  # name, head, tail, parent
    ('Hips', 'hips', 'spine', None), ('Spine', 'spine', 'spine1', 'Hips'), ('Spine1', 'spine1', 'spine2', 'Spine'),
    ('Spine2', 'spine2', 'neck', 'Spine1'), ('Neck', 'neck', 'head', 'Spine2'), ('Head', 'head', 'top', 'Neck'),
]
for _s, _m in (('L', 'Left'), ('R', 'Right')):
    BONES += [(f'{_m}Shoulder', 'clav' + _s, 'shoulder' + _s, 'Spine2'), (f'{_m}Arm', 'shoulder' + _s, 'elbow' + _s, f'{_m}Shoulder'),
              (f'{_m}ForeArm', 'elbow' + _s, 'wrist' + _s, f'{_m}Arm'), (f'{_m}Hand', 'wrist' + _s, 'hand' + _s, f'{_m}ForeArm'),
              (f'{_m}UpLeg', 'hip' + _s, 'knee' + _s, 'Hips'), (f'{_m}Leg', 'knee' + _s, 'ankle' + _s, f'{_m}UpLeg'),
              (f'{_m}Foot', 'ankle' + _s, 'ball' + _s, f'{_m}Leg'), (f'{_m}ToeBase', 'ball' + _s, 'toe' + _s, f'{_m}Foot')]


# ---------------- geometry helpers ----------------
def ring(n, rx, ry, p):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n + math.pi / n
        c, s = math.cos(a), math.sin(a)
        out.append((rx * math.copysign(abs(c) ** (2 / p), c), ry * math.copysign(abs(s) ** (2 / p), s)))
    return out


def loft(name, bone, pts, radii, side=(1, 0, 0), n=8, p=2.2):
    """Rings along a path; radii[k] = (r along the side axis, r across it). Bound 100% to `bone`."""
    P = [Vector(q) for q in pts]
    S = Vector(side)
    bm = bmesh.new()
    rings = []
    for k, c in enumerate(P):
        t = (P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]).normalized()
        u = S - t * S.dot(t)
        if u.length < 1e-4:
            u = Vector((0, 1, 0)) - t * t.y
        u.normalize()
        v = t.cross(u)
        rings.append([bm.verts.new(c + u * x + v * y) for x, y in ring(n, radii[k][0], radii[k][1], p)])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for f in me.polygons:
        f.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.data.collections[COL].objects.link(ob)
    arm = bpy.data.objects[ROOT]
    ob.parent = arm
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    me.materials.append(bpy.data.materials['BodyGrey'])
    return ob


def setup():
    sc = bpy.context.scene
    for ob in list(sc.objects):
        if ob.name in ('Cube', 'Light', 'Camera') and ob.parent is None:
            ob.hide_render = True
            ob.hide_set(True)
    col = bpy.data.collections.get(COL)
    if col:
        for ob in list(col.objects):
            bpy.data.objects.remove(ob)
    else:
        col = bpy.data.collections.new(COL)
        sc.collection.children.link(col)
    m = bpy.data.materials.get('BodyGrey') or bpy.data.materials.new('BodyGrey')
    m.diffuse_color = (.6, .45, .38, 1)
    return col


def build_armature(J):
    ad = bpy.data.armatures.new(ROOT)
    arm = bpy.data.objects.new(ROOT, ad)
    bpy.data.collections[COL].objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, h, t, parent in BONES:
        eb = ad.edit_bones.new(name)
        eb.head, eb.tail, eb.roll = J[h], J[t], 0
        if parent:
            eb.parent = ad.edit_bones[parent]
            eb.use_connect = (eb.head - eb.parent.tail).length < 1e-5
    bpy.ops.object.mode_set(mode='OBJECT')
    ad.display_type = 'STICK'
    return arm


def build_body(J, P=PROP):
    s = P['height'] / 1.8
    z = lambda k: J[k].z
    # ---- torso: pelvis, belly, ribs, chest (V-taper), neck ----
    pw, ww, cw = P['pelvis'] * s, P['waist'] * s, P['chest'] * s
    loft('Pelvis', 'Hips', [(0, 0, z('hipL') - .07 * s), (0, 0, z('hipL')), (0, 0, z('hips') + .03 * s), (0, 0, z('spine'))],
         [(pw * .8, .095 * s), (pw, .11 * s), (pw * .95, .11 * s), (ww, .105 * s)], p=2.6)
    loft('Belly', 'Spine', [(0, .005, z('spine')), (0, .005, z('spine1'))], [(ww, .105 * s), (ww * 1.05, .11 * s)], p=2.6)
    loft('Ribs', 'Spine1', [(0, .005, z('spine1')), (0, 0, z('spine2'))], [(ww * 1.05, .11 * s), (cw * .95, .13 * s)], p=2.6)
    loft('Chest', 'Spine2', [(0, 0, z('spine2')), (0, 0, z('spine2') + .06 * s), (0, .005, z('neck') - .015 * s), (0, .01, z('neck') + .02 * s)],
         [(cw * .95, .13 * s), (cw, .135 * s), (cw * .92, .12 * s), (.08 * s, .07 * s)], p=2.6)
    loft('Neck', 'Neck', [(0, .01, z('neck') - .02 * s), (0, 0, z('head') + .04 * s)], [(.05 * s, .05 * s), (.048 * s, .048 * s)], n=6)
    # ---- head: angular, flat face plane, jaw tapering to a chin point ----
    c, hh = z('head'), z('top') - z('head')
    rows = [(0, -.035, .05, .05), (.08, -.012, .13, .14), (.26, 0, .175, .19), (.54, 0, .19, .20),
            (.78, .005, .18, .19), (.93, .01, .12, .13), (1.0, .01, .04, .04)]
    loft('Head', 'Head', [(0, yc * s, c + f * hh) for f, yc, rx, ry in rows], [(rx * s, ry * s) for f, yc, rx, ry in rows], p=2.4)
    for side, sx in (('L', 1), ('R', -1)):
        ez = c + .42 * hh
        loft(f'Eye.{side}', 'Head', [(sx * .075 * s, -.19 * s, ez - .03 * s), (sx * .075 * s, -.19 * s, ez + .03 * s)],
             [(.017 * s, .02 * s)] * 2, n=4, p=2.0)
    # ---- arms: deltoid cap overlaps the chest, elbow/wrist caps overlap the next segment ----
    for side, m in (('L', 'Left'), ('R', 'Right')):
        sh, el, wr, hd = J['shoulder' + side], J['elbow' + side], J['wrist' + side], J['hand' + side]
        d = (el - sh).normalized()
        loft(f'UpperArm.{side}', f'{m}Arm', [sh - d * .04 * s, sh + d * .03 * s, sh + (el - sh) * .55, el + d * .02 * s],
             [(.065 * s, .07 * s), (.075 * s, .075 * s), (.055 * s, .058 * s), (.045 * s, .047 * s)], side=(0, -1, 0))
        f = (wr - el).normalized()
        loft(f'ForeArm.{side}', f'{m}ForeArm', [el - f * .025 * s, el + (wr - el) * .3, wr + f * .01 * s],
             [(.046 * s, .046 * s), (.05 * s, .046 * s), (.032 * s, .03 * s)], side=(0, -1, 0))
        h = (hd - wr).normalized()
        loft(f'Hand.{side}', f'{m}Hand', [wr - h * .01 * s, wr + (hd - wr) * .45, hd],
             [(.038 * s, .022 * s), (.046 * s, .024 * s), (.03 * s, .018 * s)], side=(0, -1, 0), n=6)
    # ---- legs: thigh overlaps the pelvis, knee cap overlaps the shin, foot + toe ----
    for side, m in (('L', 'Left'), ('R', 'Right')):
        hp, kn, an, ba, to = (J[k + side] for k in ('hip', 'knee', 'ankle', 'ball', 'toe'))
        dl = (kn - hp).normalized()
        loft(f'Thigh.{side}', f'{m}UpLeg', [hp - dl * .05 * s, hp + (kn - hp) * .3, hp + (kn - hp) * .75, kn + dl * .025 * s],
             [(.085 * s, .09 * s), (.08 * s, .085 * s), (.062 * s, .066 * s), (.05 * s, .052 * s)], side=(0, -1, 0))
        ds = (an - kn).normalized()
        loft(f'Shin.{side}', f'{m}Leg', [kn - ds * .03 * s, kn + (an - kn) * .3, an],
             [(.05 * s, .052 * s), (.056 * s, .06 * s), (.034 * s, .036 * s)], side=(0, -1, 0))
        fz = .045 * s
        loft(f'Foot.{side}', f'{m}Foot', [(an.x, an.y + .045 * s, fz), (an.x, an.y - .02 * s, fz), (ba.x, ba.y, fz * .8)],
             [(.038 * s, .042 * s), (.044 * s, .045 * s), (.045 * s, .036 * s)], side=(1, 0, 0), n=6)
        loft(f'Toe.{side}', f'{m}ToeBase', [(ba.x, ba.y + .01 * s, fz * .7), (to.x, to.y, fz * .5)],
             [(.043 * s, .03 * s), (.034 * s, .022 * s)], side=(1, 0, 0), n=6)


def build():
    setup()
    J = landmarks()
    build_armature(J)
    build_body(J)
    return sorted(o.name for o in bpy.data.collections[COL].objects)


# ---------------- poses ----------------
# bone -> [(axis, degrees), ...] for the LEFT side and the spine; 'Right*' is mirrored unless given explicitly.
# Rotations are applied parent-first, about WORLD axes through the joint, starting from the bone's current posed
# orientation ("swing the thigh forward, then bend the knee"). Legs/arms hang down: X- swings them forward;
# spine points up: X+ leans forward; left arm: Y+ lowers it toward the body, Y- raises it.
IDLE_ARMS = {'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 37), ('X', 3)], 'LeftForeArm': [('X', -16)], 'LeftHand': [('Y', 10), ('X', -6)]}
POSES = {
    'apose': {},
    'idle': {**IDLE_ARMS, 'LeftUpLeg': [('X', -4), ('Y', -3)], 'LeftLeg': [('X', 7)], 'LeftFoot': [('X', -3), ('Z', -8)],
             'Spine2': [('X', -3)], 'Neck': [('X', 4)]},
    'walk_contact': {'LeftUpLeg': [('X', -28)], 'LeftLeg': [('X', 6)], 'LeftFoot': [('X', 8)],
                     'RightUpLeg': [('X', 20)], 'RightLeg': [('X', 22)], 'RightFoot': [('X', -12)],
                     'LeftArm': [('Y', 34), ('X', 24)], 'LeftForeArm': [('X', -10)],
                     'RightArm': [('Y', -34), ('X', -26)], 'RightForeArm': [('X', -28)],
                     'Spine1': [('Z', 6)], 'Spine2': [('Z', 4)], 'Hips': [('Z', -6)]},
    'walk_pass': {'LeftUpLeg': [('X', -3)], 'LeftLeg': [('X', 3)],
                  'RightUpLeg': [('X', -28)], 'RightLeg': [('X', 62)], 'RightFoot': [('X', -8)],
                  'LeftArm': [('Y', 34), ('X', 4)], 'LeftForeArm': [('X', -14)],
                  'RightArm': [('Y', -34), ('X', -4)], 'RightForeArm': [('X', -14)]},
    'bow_draw': {'Hips': [('Z', -60)], 'Spine': [('Z', -10)], 'Spine1': [('Z', -10)], 'Spine2': [('Z', -10)],
                 'Neck': [('Z', 45)], 'Head': [('Z', 40)],
                 'LeftArm': [('X', -45)], 'LeftHand': [('X', 90)], 'RightArm': [('X', 60)], 'RightForeArm': [('Z', 165), ('X', 30)],
                 'LeftUpLeg': [('X', -10)], 'RightUpLeg': [('X', 10)]},
    'lunge': {'LeftUpLeg': [('X', -62)], 'LeftLeg': [('X', 72)], 'LeftFoot': [('X', -8)],
              'RightUpLeg': [('X', 32)], 'RightLeg': [('X', 8)], 'RightFoot': [('X', -30)],
              'Spine': [('X', 8)], 'Spine1': [('X', 6)],
              'LeftArm': [('Y', 20), ('X', -65)], 'LeftForeArm': [('X', -20)],
              'RightArm': [('Y', -34), ('X', 35)], 'RightForeArm': [('X', -25)]},
    'reach_up': {'LeftArm': [('Y', -128)], 'LeftForeArm': [('X', -8)], 'RightArm': [('Y', -32)], 'RightForeArm': [('X', -12)],
                 'Neck': [('X', -8)], 'Head': [('X', -12)], 'Spine2': [('Y', 5)]},
    'crouch': {'LeftUpLeg': [('X', -85), ('Y', -10)], 'LeftLeg': [('X', 115)], 'LeftFoot': [('X', -32)],
               'Spine': [('X', 18)], 'Spine1': [('X', 10)], 'Neck': [('X', -18)],
               'LeftArm': [('Y', 25), ('X', -35)], 'LeftForeArm': [('X', -45)]},
}


def _flip(rots):
    return [(a, d if a == 'X' else -d) for a, d in rots]  # mirror across the X=0 plane


def expand(spec):
    """Fill in 'Right*' bones from their 'Left*' twin unless given explicitly."""
    out = {k: v for k, v in spec.items() if not k.startswith('_')}
    for bn, rots in spec.items():
        if bn.startswith('Left') and 'Right' + bn[4:] not in out:
            out['Right' + bn[4:]] = _flip(rots)
    return out


def mirrored(spec):
    """The same pose on the other side (walk contact with the right foot forward, ...)."""
    out = {k: v for k, v in spec.items() if k.startswith('_')}
    for bn, rots in expand(spec).items():
        nb = 'Right' + bn[4:] if bn.startswith('Left') else 'Left' + bn[5:] if bn.startswith('Right') else bn
        out[nb] = _flip(rots)
    return out


# demo poses: the bow shot's anticipation / follow-through
_TWIST = {'Hips': [('Z', -60)], 'Spine': [('Z', -10)], 'Spine1': [('Z', -10)], 'Spine2': [('Z', -10)],
          'Neck': [('Z', 45)], 'Head': [('Z', 40)], 'LeftUpLeg': [('X', -10)], 'RightUpLeg': [('X', 10)]}
POSES['bow_aim'] = {**_TWIST, 'LeftArm': [('X', -40)], 'LeftForeArm': [('X', -8)], 'LeftHand': [('X', 90)],
                    'RightArm': [('X', 20), ('Y', -10)], 'RightForeArm': [('Z', 120)]}
POSES['bow_release'] = {**_TWIST, 'LeftArm': [('X', -45)], 'LeftHand': [('X', 90)], 'RightArm': [('X', 62), ('Z', -25)], 'RightForeArm': [('Z', 70)],
                        'RightHand': [('X', 20)]}


# ---------------- locomotion key poses (classic 4 keys per step: contact, down, passing, up) ----------------
def _legs(lu, ll, lf, ru, rl, rf):
    """Thigh/shin/foot swings about X. Thigh X- = forward, shin X+ = knee bend, foot X+ = toe down."""
    return {'LeftUpLeg': [('X', lu)], 'LeftLeg': [('X', ll)], 'LeftFoot': [('X', lf)],
            'RightUpLeg': [('X', ru)], 'RightLeg': [('X', rl)], 'RightFoot': [('X', rf)]}


def _arms(la, ra, lfa, rfa, lower=37):
    """Swinging arms, built from the swing angle so they never move as one rigid stick:
    - the collarbone rolls forward with a forward swing and lifts a little (shoulders take part in the swing)
    - the swing arcs: forward swings come slightly across the body, backward ones slightly out
    - the hand flicks on at the ends of the swing (wrist overlap); the elbow bend is given per key (lfa/rfa), bent
      most at the front of the swing and opened up at the back, so the forearm trails the upper arm.
    la/ra: upper-arm swing about X (X- = forward); lfa/rfa: forearm bend (negative = bent forward)."""
    def side(sw, fa, sgn):  # sgn = +1 left, -1 right (mirror: Y and Z flip)
        fa = min(fa, -14)   # the elbow is never straight
        fwd, back = max(0, -sw), max(0, sw)
        return ([('Z', sgn * .3 * sw), ('Y', -sgn * .12 * fwd)],
                [('Y', sgn * (lower + .15 * fwd - .1 * back)), ('X', sw)],
                [('X', fa)],
                [('Y', sgn * 8), ('X', .3 * sw)])
    L, R = side(la, lfa, 1), side(ra, rfa, -1)
    return {'LeftShoulder': L[0], 'LeftArm': L[1], 'LeftForeArm': L[2], 'LeftHand': L[3],
            'RightShoulder': R[0], 'RightArm': R[1], 'RightForeArm': R[2], 'RightHand': R[3]}


def _merge(*specs):
    """Combine pose specs; a bone named in several gets all their rotations (applied in order)."""
    out = {}
    for sp in specs:
        for k, v in sp.items():
            out[k] = v if k.startswith('_') else out.get(k, []) + v
    return out


def _rhythm(phi, A, e_mid, e_amp, wrist, lower, hips, chest, d1=1 / 8, d2=2 / 8):
    """Upper body of a locomotion cycle as one continuous rhythm over the phase phi (0 = left heel strike, cycle = 1),
    so arms carry mass instead of being posed frame by frame:
    - the shoulder starts the swing (the collarbone rolls slightly ahead of the upper arm),
    - the elbow follows d1 later and is ALWAYS bent: most at the front of the swing, open-but-soft at the back,
    - the wrist comes last (d2 later),
    - the pelvis twists with the legs and the chest counter-twists (the neck gives it back, the head looks ahead).
    Left arm swings back while the left leg is forward; the right arm is the same curve half a cycle later."""
    c = lambda x: math.cos(2 * math.pi * x)
    spec = {'Hips': [('Z', -hips * c(phi))],
            'Spine': [('Z', .35 * chest * c(phi))], 'Spine1': [('Z', .35 * chest * c(phi))], 'Spine2': [('Z', .3 * chest * c(phi))],
            'Neck': [('Z', (hips - chest) * c(phi))]}
    for side, sgn, off in (('Left', 1, 0.0), ('Right', -1, .5)):
        f = phi + off
        sw = A * c(f)                                   # + = back
        flex = e_mid - e_amp * c(f - d1)                # biggest bend just after the arm reaches the front
        fwd, back = max(0, -sw), max(0, sw)
        cl = .3 * A * c(f + .06)                        # collarbone leads the swing a little
        spec[side + 'Shoulder'] = [('Z', sgn * cl), ('Y', -sgn * .12 * max(0, -cl) / .3)]
        spec[side + 'Arm'] = [('Y', sgn * (lower + .15 * fwd - .1 * back)), ('X', sw)]
        spec[side + 'ForeArm'] = [('X', -flex)]
        spec[side + 'Hand'] = [('Y', sgn * 8), ('X', wrist * c(f - d2))]
    return spec


WALK_ARMS = dict(A=24, e_mid=32, e_amp=8, wrist=10, lower=37, hips=6, chest=9)    # elbow 24..40 deg (arm gate: >= 1 px kink)
RUN_ARMS = dict(A=38, e_mid=85, e_amp=15, wrist=12, lower=32, hips=7, chest=12)   # elbow 70..100 deg

# walk, left foot leading. contact = heel strike (front toe up, legs at full split); down = weight lands on the
# front leg (knee absorbs, body lowest, back heel peels off); passing = weight over the support leg (pelvis shifts
# over it), swing knee forward; up = support leg straight and on its toe (body highest), swing leg reaching.
POSES['wk_contact'] = _merge(_legs(-30, 0, 12, 18, 34, -31), _rhythm(0 / 8, **WALK_ARMS))
POSES['wk_down'] = _merge(_legs(-20, 26, -6, 16, 48, -26), _rhythm(1 / 8, **WALK_ARMS),
                          {'Hips': [('Y', 3)], 'Spine': [('X', 5)], 'Spine1': [('Y', -3)], 'Neck': [('X', 2)]})
POSES['wk_pass'] = _merge(_legs(1, 6, -6, -18, 62, -20), _rhythm(2 / 8, **WALK_ARMS),
                          {'Hips': [('Y', 4)], 'Spine1': [('Y', -3)]})
POSES['wk_up'] = _merge(_legs(17.5, 0, 13, -32, 22, -4), _rhythm(3 / 8, **WALK_ARMS),
                        {'Hips': [('Y', 2)], 'Spine2': [('X', -3)], 'Neck': [('X', -2)]})
_LEAN = {'Spine': [('X', 9)], 'Spine1': [('X', 5)], 'Neck': [('X', -9)]}
# light run: per step 2 ground frames (forefoot landing under the body with a soft knee, mid-stance with little
# compression) and 2 air frames (push-off rising, float at the peak), so the body bounces UP instead of sinking.
POSES['rn_contact'] = _merge(_legs(-22, 30, -8, 32, 72, -22), _rhythm(0 / 8, **RUN_ARMS), _LEAN)
POSES['rn_down'] = _merge(_legs(4, 30, -10, -38, 104, -24), _rhythm(1 / 8, **RUN_ARMS), _LEAN)
POSES['rn_pass'] = _merge(_legs(30, 10, 30, -52, 76, -14), _rhythm(2 / 8, **RUN_ARMS), _LEAN, {'_air': .05})
POSES['rn_flight'] = _merge(_legs(22, 58, 12, -42, 34, -4), _rhythm(3 / 8, **RUN_ARMS), _LEAN, {'_air': .11})
# sprint: longer stride, high knee drive, bigger lean and arm pump, longer flight
SPRINT_ARMS = dict(A=50, e_mid=85, e_amp=15, wrist=14, lower=28, hips=9, chest=15)
_SLEAN = {'Spine': [('X', 16)], 'Spine1': [('X', 8)], 'Neck': [('X', -16)]}
POSES['sp_contact'] = _merge(_legs(-26, 28, -10, 40, 88, -26), _rhythm(0 / 8, **SPRINT_ARMS), _SLEAN)
POSES['sp_down'] = _merge(_legs(6, 32, -12, -52, 118, -26), _rhythm(1 / 8, **SPRINT_ARMS), _SLEAN)
POSES['sp_pass'] = _merge(_legs(28, 10, 32, -64, 82, -12), _rhythm(2 / 8, **SPRINT_ARMS), _SLEAN, {'_air': .07})
POSES['sp_flight'] = _merge(_legs(28, 72, 14, -52, 30, -4), _rhythm(3 / 8, **SPRINT_ARMS), _SLEAN, {'_air': .15})
# drive (accelerating into a sprint): shorter powerful steps, strong forward lean, low flight, big arm pump
DRIVE_ARMS = dict(A=56, e_mid=88, e_amp=12, wrist=14, lower=26, hips=8, chest=12)
_DLEAN = {'Spine': [('X', 24)], 'Spine1': [('X', 12)], 'Neck': [('X', -26)]}
POSES['dr_contact'] = _merge(_legs(-30, 40, -14, 36, 70, -30), _rhythm(0 / 8, **DRIVE_ARMS), _DLEAN)
POSES['dr_down'] = _merge(_legs(-4, 46, -16, -44, 104, -26), _rhythm(1 / 8, **DRIVE_ARMS), _DLEAN)
POSES['dr_pass'] = _merge(_legs(24, 18, 30, -58, 90, -16), _rhythm(2 / 8, **DRIVE_ARMS), _DLEAN, {'_air': .03})
POSES['dr_flight'] = _merge(_legs(32, 40, 22, -50, 50, -6), _rhythm(3 / 8, **DRIVE_ARMS), _DLEAN, {'_air': .06})
# skid stop from a sprint: the lead leg digs in (heel first), torso leans back, arms thrown forward for balance;
# then a crouched recovery before standing
POSES['skid_a'] = {**_legs(-38, 6, 12, 22, 62, -20), 'Spine': [('X', -12)], 'Spine1': [('X', -6)], 'Neck': [('X', 12)],
                   'LeftArm': [('Y', 20), ('X', -42)], 'LeftForeArm': [('X', -25)], 'RightArm': [('Y', -26), ('X', -30)],
                   'RightForeArm': [('X', -30)]}
POSES['skid_b'] = {**_legs(-20, 48, -14, 8, 58, -18), 'Spine': [('X', 10)], 'Spine1': [('X', 6)], 'Neck': [('X', -6)],
                   'LeftArm': [('Y', 30), ('X', -12)], 'LeftForeArm': [('X', -30)], 'RightArm': [('Y', -32), ('X', 8)],
                   'RightForeArm': [('X', -24)]}
for _k in ('sp_contact', 'sp_down', 'sp_pass', 'sp_flight', 'dr_contact', 'dr_down', 'dr_pass', 'dr_flight'):
    POSES[_k + '_r'] = mirrored(POSES[_k])
for _k in ('wk_contact', 'wk_down', 'wk_pass', 'wk_up', 'rn_contact', 'rn_down', 'rn_pass', 'rn_flight'):
    POSES[_k + '_r'] = mirrored(POSES[_k])
# idle breathing: chest and shoulders rise, head lifts, arms settle
POSES['idle_in'] = {**POSES['idle'], 'Spine2': [('X', -8)], 'LeftShoulder': [('Z', -4), ('Y', -8)], 'Neck': [('X', 8)], 'LeftArm': [('Y', 34), ('X', 2)]}
POSES['idle_out'] = {**POSES['idle'], 'Spine': [('X', 3)], 'Spine2': [('X', 2)], 'LeftShoulder': [('Z', -3), ('Y', 3)], 'Neck': [('X', 2)],
                     'LeftArm': [('Y', 39), ('X', 4)], 'LeftForeArm': [('X', -19)]}
# dodge roll: dive into a tucked ball, hips rotate forward through a full turn (the ground snap keeps it on the
# floor), then come up in a crouch
# dodge roll, 8 keys interpolated to 14 frames: dive (arms reach, body tips forward) -> tucked ball rotating a full
# turn about the hips (arms hug the shins, chin down) -> legs reach for the ground -> crouch -> rise into the run.
# Consecutive keys differ < 180 deg so the slerp in-betweens always turn forward.
_TUCK = {**_legs(-108, 128, -28, -108, 128, -28), 'Spine': [('X', 30)], 'Spine1': [('X', 24)], 'Spine2': [('X', 16)], 'Neck': [('X', 26)],
         'LeftArm': [('Y', 18), ('X', -78)], 'LeftForeArm': [('X', -95)], 'LeftHand': [('X', -20)]}
POSES['roll_0'] = {**_legs(-40, 62, -10, 34, 36, -30), 'Hips': [('X', 18)], 'Spine': [('X', 28)], 'Spine1': [('X', 14)], 'Neck': [('X', -6)],
                   'LeftArm': [('Y', 16), ('X', -85)], 'LeftForeArm': [('X', -18)]}
for _i, _a in enumerate((80, 160, 240, 310), 1):
    POSES[f'roll_{_i}'] = {**_TUCK, 'Hips': [('X', _a)]}
POSES['roll_5'] = {**_legs(-70, 92, -18, -40, 60, -20), 'Hips': [('X', 345)], 'Spine': [('X', 26)], 'Spine1': [('X', 16)],
                   'Neck': [('X', 8)], 'LeftArm': [('Y', 22), ('X', -50)], 'LeftForeArm': [('X', -60)]}     # legs reach for the ground
POSES['roll_6'] = {**POSES['crouch'], 'Spine': [('X', 24)]}                                             # land in a crouch
POSES['roll_7'] = {**_legs(-30, 48, -10, 12, 40, -16), 'Spine': [('X', 14)], 'Spine1': [('X', 6)],
                   'LeftArm': [('Y', 30), ('X', -20)], 'LeftForeArm': [('X', -40)], 'RightArm': [('Y', -30), ('X', 18)],
                   'RightForeArm': [('X', -35)]}                                                         # rise into the run

# ---------------- traversal (arena): leap, fall, land, climb, mantle ----------------
# No root motion: the game moves the body (leap arc, fall, climb speed); these only pose it. Flight poses keep
# _air 0 because the game lifts the sprite itself.
# leap: 0 anticipation crouch (arms swung back) -> 1 push-off (back leg extended, knee drives up, arms swing
# forward-up) -> 2 reach (front leg reaches for the far bank, back leg tucks, arms out for balance) -> 3 absorb
POSES['lp_0'] = {**_legs(-38, 84, -22, 12, 72, -34), **_arms(48, 48, -24, -24, lower=30),
                 'Spine': [('X', 26)], 'Spine1': [('X', 12)], 'Neck': [('X', -22)]}
POSES['lp_1'] = {**_legs(-78, 86, 10, 34, 12, 34), **_arms(-105, -70, -30, -22, lower=26),
                 'Spine': [('X', 12)], 'Spine1': [('X', 4)], 'Neck': [('X', -10)]}
POSES['lp_2'] = {**_legs(-58, 22, -6, 14, 92, 18), **_arms(-55, -20, -20, -30, lower=-10),
                 'Spine': [('X', 6)], 'Spine1': [('X', 2)], 'Neck': [('X', 4)]}
POSES['lp_3'] = {**_legs(-46, 92, -26, 18, 84, -30), **_arms(-35, -25, -34, -30, lower=10),
                 'Spine': [('X', 24)], 'Spine1': [('X', 10)], 'Neck': [('X', -20)]}
# fall: arms flung out and up, knees loosely bent (one higher), leaning back a little, looking down at the landing
POSES['fall'] = {**_legs(-30, 48, 16, 4, 58, 24), 'Spine': [('X', -6)], 'Spine1': [('X', -4)], 'Neck': [('X', 16)],
                 'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', -62), ('X', -38)], 'LeftForeArm': [('X', -28)], 'LeftHand': [('X', -10)],
                 'RightArm': [('Y', 56), ('X', 36)], 'RightForeArm': [('X', -34)]}
# land: deep two-foot knee absorb, chest over the knees, arms forward for balance, head up
POSES['land'] = {**_legs(-78, 116, -34, -62, 104, -38), 'LeftUpLeg': [('X', -78), ('Y', -12)], 'RightUpLeg': [('X', -62), ('Y', 12)],
                 'Spine': [('X', 30)], 'Spine1': [('X', 14)], 'Neck': [('X', -26)],
                 'LeftArm': [('Y', 8), ('X', -42)], 'LeftForeArm': [('X', -34)], 'RightArm': [('Y', -8), ('X', -30)], 'RightForeArm': [('X', -40)]}
# climb (facing the wall = back to the camera when rendered facing N): contralateral hand-over-hand. 0 left hand
# reaches high while the right knee steps up; 1 pull (hands meet near the head, the body rises, the stepping leg
# straightens); 2/3 = the mirror. Chest close to the wall.
POSES['cl_0'] = {'LeftArm': [('Y', -168), ('X', -8)], 'LeftForeArm': [('X', -12)],
                 'RightArm': [('Y', 50), ('X', -14)], 'RightForeArm': [('Y', 100)], 'RightHand': [('X', -20)],
                 'LeftUpLeg': [('X', 4)], 'LeftLeg': [('X', 22)], 'LeftFoot': [('X', 20)],
                 'RightUpLeg': [('X', -62), ('Y', 8)], 'RightLeg': [('X', 88)], 'RightFoot': [('X', 10)],
                 'Spine': [('X', 8)], 'Spine1': [('X', 4)], 'Neck': [('X', -18)]}
POSES['cl_1'] = {'LeftArm': [('Y', -52), ('X', -14)], 'LeftForeArm': [('Y', -104)], 'LeftHand': [('X', -20)],
                 'RightArm': [('Y', 28), ('X', -18)], 'RightForeArm': [('Y', 112)], 'RightHand': [('X', -20)],
                 'LeftUpLeg': [('X', -22)], 'LeftLeg': [('X', 46)], 'LeftFoot': [('X', 12)],
                 'RightUpLeg': [('X', -30), ('Y', 6)], 'RightLeg': [('X', 36)], 'RightFoot': [('X', 16)],
                 'Spine': [('X', 12)], 'Spine1': [('X', 4)], 'Neck': [('X', -22)]}
POSES['cl_2'], POSES['cl_3'] = mirrored(POSES['cl_0']), mirrored(POSES['cl_1'])
# mantle: chest folds over the lip, hands press down beside it, one knee comes up onto the ledge
POSES['mantle_0'] = {'Spine': [('X', 48)], 'Spine1': [('X', 20)], 'Spine2': [('X', 8)], 'Neck': [('X', -30)],
                     'LeftArm': [('Y', 30), ('X', 24)], 'LeftForeArm': [('X', -18)], 'LeftHand': [('X', 50)],
                     'LeftUpLeg': [('X', -92)], 'LeftLeg': [('X', 118)], 'LeftFoot': [('X', -10)],
                     'RightUpLeg': [('X', 8)], 'RightLeg': [('X', 26)], 'RightFoot': [('X', 24)]}

# clips: key poses -> frames. interp=True samples frames between keys (smoothstep slerp per bone);
# otherwise one frame per key (the classic hand-keyed pixel cycle).
ANIMS = {
    'idle': dict(keys=['idle_in', 'idle_out'], frames=8, interp=True, loop=True, fps=6),
    'walk': dict(keys=['wk_contact', 'wk_down', 'wk_pass', 'wk_up', 'wk_contact_r', 'wk_down_r', 'wk_pass_r', 'wk_up_r'],
                 frames=8, loop=True, fps=10, locomotion=True),
    'run': dict(keys=['rn_contact', 'rn_down', 'rn_pass', 'rn_flight', 'rn_contact_r', 'rn_down_r', 'rn_pass_r', 'rn_flight_r'],
                frames=8, loop=True, fps=13, locomotion=True),
    'roll': dict(keys=[f'roll_{i}' for i in range(8)], frames=14, interp=True, loop=False, fps=28),
    'draw': dict(keys=['bow_aim', 'bow_draw'], frames=3, interp=True, loop=False, fps=14),
    'release': dict(keys=['bow_release', 'idle'], frames=3, interp=True, loop=False, fps=10),
}
ANIMS['sprint'] = dict(keys=['sp_contact', 'sp_down', 'sp_pass', 'sp_flight', 'sp_contact_r', 'sp_down_r', 'sp_pass_r', 'sp_flight_r'],
                       frames=8, loop=True, fps=15, locomotion=True, air_scale=1.6)
ANIMS['drive'] = dict(keys=['dr_contact', 'dr_down', 'dr_pass', 'dr_flight', 'dr_contact_r', 'dr_down_r', 'dr_pass_r', 'dr_flight_r'],
                      frames=8, loop=True, fps=14, locomotion=True)
ANIMS['leap'] = dict(keys=['lp_0', 'lp_1', 'lp_2', 'lp_3'], frames=4, loop=False, fps=9)
ANIMS['climb'] = dict(keys=['cl_0', 'cl_1', 'cl_2', 'cl_3'], frames=4, loop=True, fps=7)
ANIMS['mantle'] = dict(keys=['mantle_0'], frames=1, loop=False, fps=4)
POSE_INFO = {}  # pose/frame name -> foot sole points after the ground snap (x, y, z in metres, character faces -Y)


def _apply(spec, stable=False):
    """Reset, then apply a pose spec parent-first. Returns {bone: quaternion basis}.
    stable: the upper body ignores the pelvis (aiming on the move: the legs and pelvis stride, the chest and bow hold
    still). The spine is turned back to rest BEFORE its own rotations, so every world-axis rotation above it lands
    exactly as in a pose with a neutral pelvis."""
    arm = bpy.data.objects[ROOT]
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    for pb in arm.pose.bones:  # creation order = parents first
        if stable and pb.name == 'Spine':
            hp = arm.pose.bones['Hips']
            H = (hp.matrix.to_3x3() @ hp.bone.matrix_local.to_3x3().inverted()).inverted().to_4x4()
            h = pb.matrix.translation.copy()
            pb.matrix = Matrix.Translation(h) @ H @ Matrix.Translation(-h) @ pb.matrix
            bpy.context.view_layer.update()
        if not spec.get(pb.name):
            continue
        R = Matrix.Identity(4)
        for ax, deg in spec[pb.name]:
            R = Matrix.Rotation(math.radians(deg), 4, ax) @ R
        M = pb.matrix.copy()
        h = M.translation.copy()
        pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ M
        bpy.context.view_layer.update()
    return {pb.name: pb.matrix_basis.to_quaternion() for pb in arm.pose.bones}


def _snap(name, air=0.0):
    """Ground snap (lowest body vertex on z = 0, plus _air for flight frames) and record the foot soles."""
    arm = bpy.data.objects[ROOT]
    dg = bpy.context.evaluated_depsgraph_get()
    zmin, feet = 1e9, {'L': [], 'R': []}
    for ob in bpy.data.collections[COL].objects:
        if ob.type != 'MESH':
            continue
        oe = ob.evaluated_get(dg)
        me = oe.to_mesh()
        vs = [oe.matrix_world @ v.co for v in me.vertices]
        oe.to_mesh_clear()
        if ob.hide_render or ob.name.split('.')[0] in SOFT_PARTS:
            continue
        zmin = min([zmin] + [v.z for v in vs])
        if ob.name.split('.')[0] in ('Foot', 'Toe', 'BootFoot', 'BootToe') and '.' in ob.name:
            feet[ob.name.split('.')[1]] += vs
    lift = -zmin + air
    arm.location.z = lift
    info = {}
    for side, vs in feet.items():
        lo = min(v.z for v in vs)
        sole = [v for v in vs if v.z < lo + .012]
        info[side] = [round(sum(v.x for v in sole) / len(sole), 4), round(sum(v.y for v in sole) / len(sole), 4), round(lo + lift, 4)]
    POSE_INFO[name] = info
    return zmin


def _post(spec):
    """Upper-body twist on top of a finished pose (walk + aim, standing aim twists)."""
    arm = bpy.data.objects[ROOT]
    for bn, deg in spec.get('_post', []):
        pb = arm.pose.bones[bn]
        h = pb.matrix.translation.copy()
        pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, 'Z') @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()


def pose(name):
    """A named pose ('idle', 'bow_draw') or a clip frame ('walk.3')."""
    arm = bpy.data.objects[ROOT]
    rz = arm.rotation_euler.z
    arm.rotation_euler.z = 0
    arm.location = (0, 0, 0)
    if '.' in name:
        clip, i = name.split('.')
        A, i = ANIMS[clip], int(i)
        keys = A['keys']
        if A.get('interp'):
            n = len(keys)
            t = i / A['frames'] * n if A.get('loop') else i / max(1, A['frames'] - 1) * (n - 1)
            a = min(int(t), n - 1)
            b = (a + 1) % n if A.get('loop') else min(a + 1, n - 1)
            f = t - int(t)
            f = f * f * (3 - 2 * f)
            qa = _apply(expand(POSES[keys[a]]), stable=POSES[keys[a]].get('_stable', False))
            qb = _apply(expand(POSES[keys[b]]), stable=POSES[keys[b]].get('_stable', False))
            for pb in arm.pose.bones:
                pb.matrix_basis = qa[pb.name].slerp(qb[pb.name], f).to_matrix().to_4x4()
            bpy.context.view_layer.update()
            air = POSES[keys[a]].get('_air', 0) * (1 - f) + POSES[keys[b]].get('_air', 0) * f
        else:
            _apply(expand(POSES[keys[i]]), stable=POSES[keys[i]].get('_stable', False))
            air = POSES[keys[i]].get('_air', 0)
            _post(POSES[keys[i]])
    else:
        _apply(expand(POSES[name]), stable=POSES[name].get('_stable', False))
        air = POSES[name].get('_air', 0)
        _post(POSES[name])
    for hook in HOLD_HOOKS:
        hook(name)
    zmin = _snap(name, air)
    arm.rotation_euler.z = rz
    bpy.context.view_layer.update()
    return zmin


def clip_frames(*clips):
    return [f'{c}.{i}' for c in clips for i in range(ANIMS[c]['frames'])]


def clips_meta():
    """Per rendered clip: frames, nominal fps, loop, and for locomotion the ground data the game needs for
    distance-matched playback (the game's own movement drives the phase; nothing here moves the player):
      planted[i]  foot carrying the weight in frame i ('L'/'R', lowest sole)
      contacts    frames where a foot lands (heel strike) -> dust puffs, footstep sounds
      advance[i]  metres the body travels from frame i to i+1 while that foot stays planted
      stride      metres per full cycle (sum of advance) -> phase = distance travelled / stride"""
    out = {}
    for clip, A in ANIMS.items():
        names = [f'{clip}.{i}' for i in range(A['frames'])]
        if not all(n in POSE_INFO for n in names):
            continue
        m = {'frames': A['frames'], 'fps': A['fps'], 'loop': bool(A.get('loop'))}
        if A.get('locomotion'):
            F = [POSE_INFO[n] for n in names]
            n = len(F)
            planted = ['L' if f['L'][2] <= f['R'][2] else 'R' for f in F]
            adv = []
            for i in range(n):  # the foot carrying the weight at frame i slides back (+Y) as the body goes forward
                a, b = F[i], F[(i + 1) % n]
                s = planted[i]
                adv.append(round(max(0.0, b[s][1] - a[s][1]), 4) if a[s][2] < .02 else None)
            known = [v for v in adv if v is not None]
            air = A.get('air_scale', 1.0)  # a sprinter covers more ground per flight frame than per ground frame
            adv = [round(sum(known) / len(known) * air, 4) if v is None else v for v in adv]  # flight frames
            # heel strike: a foot that was in the air in the previous frame touches the ground in this one
            contacts, cfoot = [], []
            for i in range(n):
                for s in 'LR':
                    if F[i][s][2] < .015 and F[i - 1][s][2] > .02:
                        contacts.append(i); cfoot.append(s)
            m.update(planted=planted, advance=adv, stride=round(sum(adv), 4), contacts=contacts, contact_foot=cfoot)
        out[clip] = m
    return out


# ---------------- turn transitions (rendered in the NEW facing; the lower body still lags toward the old one) ----
# A left turn (counter-clockwise from above, facing index +1 per 45 deg) plants the right, outside foot wide with
# bent knees and leans into the turn; head and shoulders already face the new way, hips and legs follow.
# Frame 'a' = plant/cut (big lag), 'b' = push-off with the left leg reaching into the new direction.
# Right turns are mirrors. The spine chain takes back exactly what the hips lag, so the head faces the new way.
def _turn(delta, frame):
    lag = (.7 if frame == 'a' else .35) * delta
    lean = (12 if frame == 'a' else 7) * min(1, delta / 90)
    spec = {'Hips': [('Z', -lag), ('Y', lean)], 'Spine': [('Z', .45 * lag)], 'Spine1': [('Z', .2 * lag)],
            'Spine2': [('Z', .15 * lag)], 'Neck': [('Z', .15 * lag)], 'Head': [('Z', .05 * lag)]}
    if frame == 'a':
        body = {**_legs(-48, 88, -12, -4, 24, -12), **_arms(22, -34, -55, -70, 28)}
        body['RightUpLeg'] = [('X', -4), ('Y', 9)]
    else:
        body = {**_legs(-36, 20, 2, 26, 58, -22), **_arms(34, -38, -70, -85, 26)}
        for k, v in _LEAN.items():
            body[k] = body.get(k, []) + v
    for k, v in body.items():  # merge: a bone can both twist (turn) and bend (pose)
        spec[k] = v + spec.get(k, [])
    return spec


for _d in (45, 90, 135):
    for _f in ('a', 'b'):
        if _d == 45 and _f == 'a':
            continue
        POSES[f'turn_l{_d}{_f}'] = _turn(_d, _f)
        POSES[f'turn_r{_d}{_f}'] = mirrored(POSES[f'turn_l{_d}{_f}'])
TURN_POSES = [k for k in POSES if k.startswith('turn_')]


# ---------------- walk + shoot (upper body split from the legs) ----------------
# Legs and hips come from walk frame i (so the feet keep the walk's ground contact data and distance matching);
# the upper body is the full-draw archer, side-on to the target, and then twisted by `delta` relative to the legs
# (+ = toward the character's left). The twist is spread over the spine so it reads as a turning torso, not a swivel.
LEG_BONES = {'Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'}
# The bow is in the LEFT hand, so the torso only twists the aim toward the character's left, and at most 90 deg
# (no shooting back over the shoulder). Targets further round: the legs turn (walk backwards) or the aim is clamped.
WS_DELTAS = {'0': 0, 'p11': 11.25, 'p22': 22.5, 'p33': 33.75, 'p45': 45, 'p56': 56.25, 'p67': 67.5, 'p78': 78.75,
             'p90': 90}   # 11.25 deg steps: the aim moves in half-facing steps


def _walk_shoot(i, delta, clip='walk'):
    """Legs + hips from locomotion frame i of `clip` (same ground data as the plain clip), full-draw upper body
    twisted by delta toward the character's left."""
    key = POSES[ANIMS[clip]['keys'][i]]
    walk = expand(key)
    spec = {k: v for k, v in walk.items() if k in LEG_BONES}
    lean = 6 if clip == 'run' else 0
    spec.update({'Spine': [('Z', -45), ('X', lean)], 'Spine1': [('Z', -22)], 'Spine2': [('Z', -23)],   # side-on stance
                 'Neck': [('Z', 45), ('X', -lean)], 'Head': [('Z', 40)],                               # eyes on target
                 'LeftArm': [('X', -45)], 'LeftHand': [('X', 90)], 'RightArm': [('X', 60)], 'RightForeArm': [('Z', 165), ('X', 30)]})
    spec['_post'] = [('Spine', .4 * delta), ('Spine1', .3 * delta), ('Spine2', .3 * delta)]
    spec['_stable'] = True   # the bow holds still over the stride: only the legs and pelvis move with the gait
    if '_air' in key:
        spec['_air'] = key['_air']
    return spec


for _dn, _d in WS_DELTAS.items():
    for _i in range(8):
        POSES[f'ws_{_dn}_{_i}'] = _walk_shoot(_i, _d, 'walk')   # walk + shoot
        POSES[f'rs_{_dn}_{_i}'] = _walk_shoot(_i, _d, 'run')    # light run + shoot
WS_POSES = [f'{g}_{d}_{i}' for g in ('ws', 'rs') for d in WS_DELTAS for i in range(8)]
# standing full draw, twisted half a facing (11.25 deg) either way: 16 facings x 3 = aim in 11.25 deg steps
for _n, _d in (('draw_m11', -11.25), ('draw_p11', 11.25)):
    POSES[_n] = {**POSES['bow_draw'], '_post': [('Spine', .4 * _d), ('Spine1', .3 * _d), ('Spine2', .3 * _d)]}


# ---------------- standing aim (arena): waist twists, slow re-plant steps, quick pivots ----------------
# Upper body = the side-on full-draw archer of _walk_shoot (spine -90 total, eyes on target), made independent of the
# pelvis with _stable, so a Hips yaw only turns the legs. The draw stance's legs sit at Hips -60 (as bow_draw).
_AIM_UP = {'Spine': [('Z', -45)], 'Spine1': [('Z', -22)], 'Spine2': [('Z', -23)], 'Neck': [('Z', 45)], 'Head': [('Z', 40)],
           'LeftArm': [('X', -45)], 'LeftHand': [('X', 90)], 'RightArm': [('X', 60)], 'RightForeArm': [('Z', 165), ('X', 30)]}
_TUCK_UP = {'Spine': [('Z', -45), ('X', 8)], 'Spine1': [('Z', -22)], 'Spine2': [('Z', -23)], 'Neck': [('Z', 45), ('X', -6)],
            'Head': [('Z', 40)], 'LeftArm': [('X', -25), ('Y', 10)], 'LeftForeArm': [('X', -70)], 'LeftHand': [('X', 90)],
            'RightArm': [('X', 20), ('Y', -10)], 'RightForeArm': [('Z', 120), ('X', 20)]}   # bow pulled in tight


def _aim_stand(legs_off=0.0, torso_off=0.0, legs=None, up=_AIM_UP, lean=0.0, air=0.0):
    """legs_off: legs yaw (deg, + = character's left) relative to the draw stance; torso_off: upper-body twist
    relative to the render facing. legs: extra leg-bone rotations (step, soft knees, balls of the feet)."""
    spec = {'Hips': [('Z', -60 + legs_off)] + ([('Y', lean)] if lean else []),
            'LeftUpLeg': [('X', -10)], 'RightUpLeg': [('X', 10)], **{k: list(v) for k, v in up.items()}}
    for k, v in (legs or {}).items():
        spec[k] = spec.get(k, []) + v
    spec['_stable'] = True
    if torso_off:
        spec['_post'] = [('Spine', .4 * torso_off), ('Spine1', .3 * torso_off), ('Spine2', .3 * torso_off)]
    if air:
        spec['_air'] = air
    return spec


# A) twists: facing = the LEGS (like draw_m11/p11); p = toward the character's left
for _n, _d in (('m22', -22.5), ('m34', -33.75), ('m45', -45), ('p22', 22.5), ('p34', 33.75), ('p45', 45)):
    POSES[f'aim_tw_{_n}'] = {**POSES['bow_draw'], '_post': [('Spine', .4 * _d), ('Spine1', .3 * _d), ('Spine2', .3 * _d)]}

# B) slow step: facing = the TORSO (aim). _l = the body turns to its left: the legs start 45 deg to its right and
# re-plant under it; the left foot pivots, the right foot lifts, swings and plants. _r mirrors the LEGS only (the bow
# stays in the left hand).
_STEP_L = [(-45, {'LeftLeg': [('X', 10)], 'RightLeg': [('X', 6)]}, 4),                                    # weight onto the pivot foot
           (-28, {'LeftLeg': [('X', 14)], 'RightUpLeg': [('X', -32)], 'RightLeg': [('X', 58)], 'RightFoot': [('X', 12)]}, 3),   # swing
           (-10, {'LeftLeg': [('X', 12)], 'RightUpLeg': [('X', -6)], 'RightLeg': [('X', 14)]}, 1),         # plant
           (0, {'LeftLeg': [('X', 8)], 'RightLeg': [('X', 8)], 'LeftFoot': [('X', 6)]}, 0)]                # pivot foot settles
_LR = lambda d: {('Right' + k[4:] if k.startswith('Left') else 'Left' + k[5:]): v for k, v in d.items()}
for _i, (_off, _legs, _lean) in enumerate(_STEP_L):
    POSES[f'aimst_l{_i}'] = _aim_stand(_off, legs=_legs, lean=_lean)
    POSES[f'aimst_r{_i}'] = _aim_stand(-_off, legs=_LR(_legs), lean=-_lean)
ANIMS['aim_step_l'] = dict(keys=[f'aimst_l{i}' for i in range(4)], frames=4, loop=False, fps=16)
ANIMS['aim_step_r'] = dict(keys=[f'aimst_r{i}' for i in range(4)], frames=4, loop=False, fps=16)

# C) quick pivot: facing = the FINAL aim. Torso leads, legs trail, compact: .0 torso -60 / legs -90 bow tucked,
# .1 torso -15 / legs -45 up on the balls of the feet, .2 torso 0 full draw / legs -15 knees soft. _l = turning left
# (the body comes from its right), _r mirrored offsets.
_PIV = [(-90, -60, _TUCK_UP, {'LeftLeg': [('X', 22)], 'RightLeg': [('X', 22)], 'LeftFoot': [('X', 10)], 'RightFoot': [('X', 10)]}, 0),
        (-45, -15, _TUCK_UP, {'LeftLeg': [('X', 10)], 'RightLeg': [('X', 10)], 'LeftFoot': [('X', 26)], 'RightFoot': [('X', 26)]}, .03),
        (-15, 0, _AIM_UP, {'LeftLeg': [('X', 20)], 'RightLeg': [('X', 20)], 'LeftFoot': [('X', -4)], 'RightFoot': [('X', -4)]}, 0)]
for _i, (_lo, _to, _up, _legs, _air) in enumerate(_PIV):
    POSES[f'aimpv_l{_i}'] = _aim_stand(_lo, _to, legs=_legs, up=_up, air=_air)
    POSES[f'aimpv_r{_i}'] = _aim_stand(-_lo, -_to, legs=_legs, up=_up, air=_air)
ANIMS['aim_pivot_l'] = dict(keys=[f'aimpv_l{i}' for i in range(3)], frames=3, loop=False, fps=24)
ANIMS['aim_pivot_r'] = dict(keys=[f'aimpv_r{i}' for i in range(3)], frames=3, loop=False, fps=24)
AIM_DRAW = {'aim_pivot_l.0': .25, 'aim_pivot_r.0': .25, 'aim_pivot_l.1': .55, 'aim_pivot_r.1': .55}   # tucked -> full
