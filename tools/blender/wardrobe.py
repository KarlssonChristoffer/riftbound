# Wardrobe on the standard skeleton (skeleton.py). Every garment is its own module: parts split at the joints,
# each part bound 100% to one named standard bone, so it works on any body of the same archetype. No arbitrary
# scaling: a garment lists the archetypes it fits (compatibility tags); a different body type gets its own variant.
# A loadout is rendered TOGETHER into one outfit atlas (pixel_rig + pixelize), so outlines, depth and shading
# between shirt, pants, scarf and gear are correct - no stacking of finished sprites in the game.
#
# Slots (one garment each): torso, legs, feet, outer, cloak, neck, back, head, hands.
# Cloth (cloaks, scarf tails) hangs on garment-owned bone chains driven by the cloth solver below.
# Use from a loadout file:  exec(open(r'D:\Game\tools\blender\wardrobe.py').read()); LOADOUT = [...]
import bpy, bmesh, math
from mathutils import Matrix, Vector

exec(open(r'D:\Game\tools\blender\skeleton.py', encoding='utf-8').read())
_build_body_only = build
SLOTS = ('torso', 'legs', 'feet', 'outer', 'cloak', 'neck', 'back', 'head', 'hands')  # cloak: over outer, under back items
GARMENTS = {}
LOADOUT = []

PIXEL_FAMILIES.update({
    'linen': ['efe4c8', 'cfbf9c', 'a08e70', '4a3e30'],
    'cloth': ['8c6a4a', '6a4e36', '4a3626', '221812'],   # brown trousers
    'wood': ['c89a5e', '9a6c44', '6e4a2e', '2e1a16'],
})


def garment(gid, slot, fits, hides=(), pixel=None, soft=()):
    """Register a garment builder. hides = body segment base names it fully covers (not rendered when worn).
    pixel = {part base name: [part, family, options]} for the pixelizer."""
    def reg(fn):
        GARMENTS[gid] = dict(slot=slot, fits=set(fits), hides=set(hides), build=fn, pixel=pixel or {}, soft=set(soft))
        return fn
    return reg


def _ctx():
    P = PROP
    s = P['height'] / 1.8
    J = landmarks()
    z = lambda k: J[k].z
    return P, s, J, z


def _grow(radii, t):
    return [(r[0] + t, r[1] + t) for r in radii]


def _torso(P, s, z):
    """The body's own torso sections (same numbers as build_body) so shells follow the standard body."""
    pw, ww, cw = P['pelvis'] * s, P['waist'] * s, P['chest'] * s
    return {
        'hip': ([(0, 0, z('hipL') - .07 * s), (0, 0, z('hipL')), (0, 0, z('hips') + .03 * s), (0, 0, z('spine'))],
                [(pw * .8, .095 * s), (pw, .11 * s), (pw * .95, .11 * s), (ww, .105 * s)]),
        'belly': ([(0, .005, z('spine')), (0, .005, z('spine1'))], [(ww, .105 * s), (ww * 1.05, .11 * s)]),
        'ribs': ([(0, .005, z('spine1')), (0, 0, z('spine2'))], [(ww * 1.05, .11 * s), (cw * .95, .13 * s)]),
        'chest': ([(0, 0, z('spine2')), (0, 0, z('spine2') + .06 * s), (0, .005, z('neck') - .015 * s)],
                  [(cw * .95, .13 * s), (cw, .135 * s), (cw * .92, .12 * s)]),
    }


def _sleeve(name, side, J, s, t, upper=(0, 1), lower=None, cuff=0.0):
    """Arm shells split at the elbow: upper part on <side>Arm, lower part on <side>ForeArm (fractions of the segment)."""
    m = 'Left' if side == 'L' else 'Right'
    sh, el, wr = J['shoulder' + side], J['elbow' + side], J['wrist' + side]
    d, f = (el - sh).normalized(), (wr - el).normalized()
    if upper:
        a, b = upper
        pts = [sh - d * .05 * s, sh + d * .03 * s, sh + (el - sh) * .55, el + d * .03 * s]
        rad = _grow([(.065 * s, .07 * s), (.075 * s, .075 * s), (.055 * s, .058 * s), (.045 * s, .047 * s)], t)
        if b < 1:  # short sleeve: stop part way down the upper arm, with a slightly open hem
            pts = [sh - d * .05 * s, sh + d * .03 * s, sh + (el - sh) * b]
            rad = rad[:2] + [(rad[2][0] + .006, rad[2][1] + .006)]
        loft(f'{name}Up.{side}', f'{m}Arm', pts, rad, side=(0, -1, 0))
    if lower:
        a, b = lower
        pts = [el - f * .03 * s, el + (wr - el) * .3, el + (wr - el) * b]
        rad = _grow([(.046 * s, .046 * s), (.05 * s, .046 * s), (.034 * s + cuff, .032 * s + cuff)], t)
        loft(f'{name}Lo.{side}', f'{m}ForeArm', pts, rad, side=(0, -1, 0))


# ---------------------------------------------------------------- garments ----------------------------------------
@garment('linen_shirt', 'torso', ['human_small'], hides=['Belly', 'Ribs', 'Chest', 'UpperArm', 'ForeArm'],
         pixel={'ShirtBelly': ['shirt', 'linen', {}], 'ShirtRibs': ['shirt', 'linen', {}], 'ShirtChest': ['shirt', 'linen', {}],
                'ShirtHem': ['shirt', 'linen', {}], 'ShirtSleeveUp': ['sleeve', 'linen', {}], 'ShirtSleeveLo': ['sleeve', 'linen', {}]})
def _linen_shirt():
    P, s, J, z = _ctx()
    T, t = _torso(P, s, z), .012 * s
    loft('ShirtHem', 'Hips', [(0, 0, z('hips') + .01 * s), (0, 0, z('spine'))], _grow(T['hip'][1][2:], t), p=2.6)
    loft('ShirtBelly', 'Spine', T['belly'][0], _grow(T['belly'][1], t), p=2.6)
    loft('ShirtRibs', 'Spine1', T['ribs'][0], _grow(T['ribs'][1], t), p=2.6)
    loft('ShirtChest', 'Spine2', T['chest'][0] + [(0, .01, z('neck') + .01 * s)],
         _grow(T['chest'][1], t) + [(.085 * s, .075 * s)], p=2.6)       # round collar just under the neck
    for sd in 'LR':
        _sleeve('ShirtSleeve', sd, J, s, t, upper=(0, 1), lower=(0, .96), cuff=.006 * s)


@garment('green_tunic', 'outer', ['human_small'],
         pixel={'TunicBelly': ['tunic', 'green', {}], 'TunicRibs': ['tunic', 'green', {}], 'TunicChest': ['tunic', 'green', {}],
                'TunicHip': ['tunic', 'green', {}], 'TunicSleeveUp': ['tsleeve', 'green', {}],
                'TunicSkirt': ['skirt', 'green', {'bias': -.06}], 'Belt': ['belt', 'leather', {'bias': -.1}]})
def _green_tunic():
    P, s, J, z = _ctx()
    T, t = _torso(P, s, z), .03 * s
    loft('TunicHip', 'Hips', T['hip'][0], _grow(T['hip'][1], t + .01 * s), p=2.6)
    loft('TunicBelly', 'Spine', T['belly'][0], _grow(T['belly'][1], t), p=2.6)
    loft('TunicRibs', 'Spine1', T['ribs'][0], _grow(T['ribs'][1], t), p=2.6)
    loft('TunicChest', 'Spine2', T['chest'][0] + [(0, .01, z('neck') - .005 * s)],
         _grow(T['chest'][1], t) + [(.1 * s, .09 * s)], p=2.6)          # wider neckline than the shirt: the linen shows
    for sd, m in (('L', 'Left'), ('R', 'Right')):
        _sleeve('TunicSleeve', sd, J, s, t, upper=(0, .5))
        hp, kn = J['hip' + sd], J['knee' + sd]
        dl = (kn - hp).normalized()
        # skirt panel follows its own thigh (split tunic): a flared tube from the hip to ~40% down the thigh
        loft(f'TunicSkirt.{sd}', f'{m}UpLeg', [hp - dl * .07 * s, hp + (kn - hp) * .2, hp + (kn - hp) * .42],
             [(.115 * s, .125 * s), (.118 * s, .122 * s), (.13 * s, .13 * s)], side=(0, -1, 0))
    ww = P['waist'] * s
    loft('Belt', 'Hips', [(0, .005, z('spine') - .045 * s), (0, .005, z('spine') + .005 * s)],
         [(ww + .05 * s, .145 * s), (ww + .048 * s, .143 * s)], p=2.6)


@garment('brown_pants', 'legs', ['human_small'], hides=['Pelvis', 'Thigh', 'Shin'],
         pixel={'PantsHip': ['pants', 'cloth', {}], 'PantsThigh': ['pants', 'cloth', {}], 'PantsShin': ['pants', 'cloth', {}]})
def _brown_pants():
    P, s, J, z = _ctx()
    T, t = _torso(P, s, z), .015 * s
    loft('PantsHip', 'Hips', T['hip'][0][:3], _grow(T['hip'][1][:3], t), p=2.6)
    for sd, m in (('L', 'Left'), ('R', 'Right')):
        hp, kn, an = J['hip' + sd], J['knee' + sd], J['ankle' + sd]
        dl, ds = (kn - hp).normalized(), (an - kn).normalized()
        loft(f'PantsThigh.{sd}', f'{m}UpLeg', [hp - dl * .05 * s, hp + (kn - hp) * .3, hp + (kn - hp) * .75, kn + dl * .03 * s],
             _grow([(.085 * s, .09 * s), (.08 * s, .085 * s), (.062 * s, .066 * s), (.05 * s, .052 * s)], t), side=(0, -1, 0))
        loft(f'PantsShin.{sd}', f'{m}Leg', [kn - ds * .035 * s, kn + (an - kn) * .3, an + ds * .01 * s],
             _grow([(.05 * s, .052 * s), (.056 * s, .06 * s), (.038 * s, .04 * s)], t), side=(0, -1, 0))


@garment('leather_boots', 'feet', ['human_small'], hides=['Foot', 'Toe'],
         pixel={'BootShaft': ['boot', 'leather', {}], 'BootFoot': ['boot', 'leather', {}], 'BootToe': ['boot', 'leather', {}]})
def _leather_boots():
    P, s, J, z = _ctx()
    for sd, m in (('L', 'Left'), ('R', 'Right')):
        kn, an, ba, to = J['knee' + sd], J['ankle' + sd], J['ball' + sd], J['toe' + sd]
        ds = (an - kn).normalized()
        loft(f'BootShaft.{sd}', f'{m}Leg', [an + ds * .02 * s, an - ds * .08 * s, kn + (an - kn) * .5],
             [(.058 * s, .062 * s), (.066 * s, .07 * s), (.08 * s, .084 * s)], side=(0, -1, 0))   # flared cuff at the top
        fz = .05 * s
        loft(f'BootFoot.{sd}', f'{m}Foot', [(an.x, an.y + .058 * s, fz), (an.x, an.y - .02 * s, fz), (ba.x, ba.y, fz * .85)],
             [(.05 * s, .05 * s), (.056 * s, .052 * s), (.056 * s, .042 * s)], side=(1, 0, 0), n=6)
        loft(f'BootToe.{sd}', f'{m}ToeBase', [(ba.x, ba.y + .01 * s, fz * .72), (to.x, to.y - .015 * s, fz * .55)],
             [(.054 * s, .036 * s), (.042 * s, .028 * s)], side=(1, 0, 0), n=6)


@garment('red_scarf', 'neck', ['human_small'], soft=['ScarfTail'],
         pixel={'ScarfWrap': ['scarf', 'red', {}], 'ScarfTail': ['scarf', 'red', {'bias': -.08}]})
def _red_scarf():
    P, s, J, z = _ctx()
    n = z('neck')
    # a thick roll around the neck, sitting on the collar line, then one tail hanging over the left chest
    loft('ScarfWrap', 'Spine2', [(0, .0, n - .06 * s), (0, .005, n - .02 * s), (0, .01, n + .03 * s), (0, .01, n + .065 * s)],
         [(.15 * s, .145 * s), (.155 * s, .15 * s), (.13 * s, .125 * s), (.09 * s, .085 * s)], p=2.4)
    tail = [Vector((.07 * s, -.16 * s, n - .03 * s)), Vector((.095 * s, -.19 * s, z('spine2') - .02 * s)),
            Vector((.11 * s, -.195 * s, z('spine1') + .02 * s))]
    bones = add_chain('ScarfTail', 'Spine2', tail)
    ob = loft('ScarfTail', bones[0], tail, [(.055 * s, .018 * s), (.05 * s, .016 * s), (.046 * s, .014 * s)], side=(1, 0, 0), n=4, p=2.0)
    weight_chain(ob, bones, tail)
    if SIM_CLOTH:   # a two-column ribbon, 5 rows down the tail (a bit longer than the baked one: it streams)
        pts = [tail[0].lerp(tail[1], t * 2) if t <= .5 else tail[1].lerp(tail[2] + (tail[2] - tail[1]) * .35, t * 2 - 1)
               for t in (k / 4 for k in range(5))]
        grid = [[p + Vector((-.045 * s, 0, 0)), p + Vector((.045 * s, 0, 0))] for p in pts]
        sim_cloth('ScarfTail', 'red', -.08, 'Spine2', grid, 1, {'ScarfTail'})
    else:
        CLOTH_CHAINS.append(dict(bones=bones, lift=-.25, side=1.4, flutter=.8, turn=.6))


@garment('quiver', 'back', ['human_small'],
         pixel={'Quiver': ['quiver', 'leather', {'bias': -.1}], 'QuiverFletch': ['fletch', 'red', {}],
                'QuiverStrap': ['strap', 'leather', {'bias': -.15}]})
def _quiver():
    P, s, J, z = _ctx()
    # on the back: low at the left hip, arrows up over the RIGHT shoulder (the draw hand is the right)
    over = .05 * s if any(GARMENTS[g]['slot'] == 'cloak' for g in LOADOUT) else 0   # back items sit over a cloak
    lo, hi = Vector((.1 * s, .215 * s + over, z('spine') + .02 * s)), Vector((-.13 * s, .225 * s + over, z('neck') + .1 * s))
    ax = (hi - lo).normalized()
    loft('Quiver', 'Spine2', [lo - ax * .02 * s, lo, hi, hi + ax * .01 * s],
         [(.035 * s, .03 * s), (.058 * s, .05 * s), (.062 * s, .054 * s), (.05 * s, .045 * s)], n=6)
    loft('QuiverFletch', 'Spine2', [hi + ax * .01 * s, hi + ax * .06 * s, hi + ax * .1 * s],
         [(.05 * s, .04 * s), (.055 * s, .045 * s), (.02 * s, .02 * s)], n=6)
    # strap: right shoulder, diagonally across the tunic front to the left hip
    pts = [(-.15 * s, .05 * s, z('neck') - .0 * s), (-.12 * s, -.14 * s, z('neck') - .05 * s),
           (.02 * s, -.185 * s, z('spine2')), (.14 * s, -.16 * s, z('spine1') - .02 * s)]
    loft('QuiverStrap', 'Spine2', pts, [(.018 * s, .03 * s)] * 4, side=(0, 1, 0), n=4, p=2.0)


BOW_AXIS = {}  # rest-space bow axis (unit vector), for the grip constraint


@garment('short_bow', 'hands', ['human_small'],
         pixel={'Bow': ['bow', 'wood', {'thin': True, 'bias': .1}],
                'BowString': ['string', 'linen', {'fixed': 0, 'outline': False, 'lines': False, 'thin': True, 'line': True, 'overlay': 'string'}],
                # the nocked arrow is drawn by the game at screen resolution, aimed at the exact cursor (len_ratio =
                # arrow length / nock-to-grip distance, to extend the BowArrow0 bone to the arrow tip in 2D)
                'Arrow': ['arrow', 'wood', {'thin': True, 'bias': .15, 'overlay': 'arrow', 'len_ratio': 1.05 / .11}],
                'ArrowHead': ['arrow', 'char', {'thin': True, 'overlay': 'arrow'}],
                'ArrowFletch': ['arrow', 'red', {'thin': True, 'overlay': 'arrow'}]})
def _short_bow():
    P, s, J, z = _ctx()
    wr, hd = J['wristL'], J['handL']
    grip = wr + (hd - wr) * .5
    a = (hd - wr).normalized()               # held in the fist along the hand; the grip constraint turns it upright
    b = a.cross(Vector((0, 1, 0))).normalized()  # the bow's belly side (perpendicular to the axis)
    L, c = 1.15 * s, .11 * s
    pts, rad = [], []
    for i in range(13):
        u = -1 + 2 * i / 12
        pts.append(grip + a * (u * L / 2) + b * (c * (1 - u * u) - c))   # limbs bow away from the string
        g = abs(u) < .12
        rad.append((.024 * s, .03 * s) if g else (.017 * s * (1 - .45 * abs(u)), .02 * s * (1 - .45 * abs(u))))
    # the bow rides on its own holder bone (a rigid child of the hand), so it can be slung on the back (_bow_stow)
    hold = add_chain('BowHold', 'LeftHand', [grip, grip + a * .05 * s])[0]
    loft('Bow', hold, pts, rad, side=b, n=6, p=2.0)
    # string: tip - nocking point - tip. The tips ride on the bow (BowHold); the nocking point has its own bone that
    # the string constraint pulls to the draw hand, so the string forms a V at full draw.
    nock = (pts[0] + pts[-1]) / 2
    bones = add_chain('BowNock', hold, [nock, nock - b * .04 * s])
    add_chain('BowTipA', hold, [pts[0], pts[0] - a * .02 * s])     # tip markers: exported as 2D points per frame
    add_chain('BowTipB', hold, [pts[-1], pts[-1] + a * .02 * s])
    ob = loft('BowString', hold, [pts[0], nock, pts[-1]], [(.006 * s, .006 * s)] * 3, n=4, p=2.0)
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    g_hand, g_nock = ob.vertex_groups.new(name=hold), ob.vertex_groups.new(name=bones[0])
    for v in ob.data.vertices:
        (g_nock if v.index // 4 == 1 else g_hand).add([v.index], 1.0, 'REPLACE')
    # the arrow: its own bone at the nocking point, aimed through the grip by the constraint; hidden when not drawn
    arrow = add_chain('BowArrow', hold, [nock, grip])
    ln = 1.05 * s   # longer than the full draw (~0.95 m here) so the head always sits past the grip
    d = (grip - nock).normalized()
    loft('Arrow', arrow[0], [nock - d * .01 * s, nock + d * ln], [(.007 * s, .007 * s)] * 2, n=4, p=2.0)
    loft('ArrowHead', arrow[0], [nock + d * (ln - .01 * s), nock + d * (ln + .05 * s)], [(.016 * s, .012 * s), (.003 * s, .003 * s)], n=4, p=2.0)
    loft('ArrowFletch', arrow[0], [nock + d * .015 * s, nock + d * .11 * s], [(.022 * s, .006 * s), (.012 * s, .004 * s)], side=b, n=4, p=2.0)
    BOW_AXIS['rest'] = a.copy()
    BOW_AXIS['belly'] = b.copy()
    # slung position (rest armature space, relative to Spine2): diagonally across the back, lower end at the right hip
    # and upper at the left shoulder (crossing the quiver), belly out, over the cloak and quiver
    back = .215 * s + (.1 * s if any(GARMENTS[g]['slot'] == 'cloak' for g in LOADOUT) else .06 * s)
    BOW_AXIS['stow'] = (Vector((0, back, z('spine2') - .04 * s)), Vector((.5, 0, 1)).normalized(), Vector((0, 1, 0)))


STOW = ('climb.', 'mantle.')   # poses with both hands busy: the bow is slung on the back


def _bow_stow(pose_name):
    """Sling the bow across the back (follows Spine2) for poses that need both hands."""
    if not pose_name.startswith(STOW) or 'stow' not in BOW_AXIS:
        return
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    S2 = pbs['Spine2'].matrix @ bones['Spine2'].matrix_local.inverted()     # rest -> posed, for the upper back
    pos, d, e = BOW_AXIS['stow']
    d, e = (S2.to_3x3() @ d).normalized(), (S2.to_3x3() @ e).normalized()
    a, b = BOW_AXIS['rest'], BOW_AXIS['belly']
    # rotation taking the bow's rest frame (axis a, belly b) to the slung frame (axis d, belly e)
    Rm = Matrix((d, e - d * e.dot(d), d.cross(e - d * e.dot(d)))).transposed() @ Matrix((a, b, a.cross(b)))
    Mr = bones['BowHold0'].matrix_local
    pbs['BowHold0'].matrix = Matrix.Translation(S2 @ pos) @ (Rm @ Mr.to_3x3()).to_4x4()
    bpy.context.view_layer.update()


def _bow_grip(pose_name):
    """Grip constraint for the bow: turn the wrist so the bow stands as upright as a wrist can (max 70 deg).
    Poses that already hold it upright (bow_aim / draw / release) need no correction."""
    if 'rest' not in BOW_AXIS:
        return
    arm = bpy.data.objects[ROOT]
    pb = arm.pose.bones['LeftHand']
    L = arm.data.bones['LeftHand'].matrix_local.to_3x3()
    cur = (pb.matrix.to_3x3() @ L.inverted() @ BOW_AXIS['rest']).normalized()
    up = Vector((0, 0, 1 if cur.z >= 0 else -1))
    ang = cur.angle(up)
    if ang < math.radians(3):
        return
    R = Matrix.Rotation(min(ang, math.radians(70)), 4, cur.cross(up).normalized())
    h = pb.matrix.translation.copy()
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- cloth ------------------------------------------
CLOTH_CHAINS = []   # dict(bones, lift, side, flutter, turn): per-chain response scales for the solver
# Runtime cloth (a loadout sets SIM_CLOTH = True): cloth panels are NOT rendered into the sprite. Instead the game
# simulates them (inertia, drag, wind, body collisions) and draws them in the sprite's palette. Exported per pose:
# the pinned particles (riding on their bone) and collision capsules, in metres at facing yaw 0.
SIM_CLOTH = False
SIM = []            # dict(name, fam, bias, bone, grid [[local xyz] rows x cols], pin_rows)
SIM_CAPSULES = [    # (bone, from head/tail, to head/tail, radius m, x offset m): the body the cloth rests on
    ('Spine', 'head', ('Neck', 'head'), .125, .06), ('Spine', 'head', ('Neck', 'head'), .125, -.06),
    ('LeftUpLeg', 'head', ('LeftUpLeg', 'tail'), .075, 0), ('LeftLeg', 'head', ('LeftLeg', 'tail'), .06, 0),
    ('RightUpLeg', 'head', ('RightUpLeg', 'tail'), .075, 0), ('RightLeg', 'head', ('RightLeg', 'tail'), .06, 0),
    ('LeftArm', 'head', ('LeftArm', 'tail'), .05, 0), ('RightArm', 'head', ('RightArm', 'tail'), .05, 0),
    ('Head', 'head', ('Head', 'tail'), .12, 0)]


def sim_cloth(name, fam, bias, bone, grid, pin_rows, part_names):
    """Register a runtime cloth: grid = rows of rest points (armature space) from the pinned edge downward."""
    arm = bpy.data.objects[ROOT]
    inv = arm.data.bones[bone].matrix_local.inverted()
    SIM.append(dict(name=name, fam=fam, bias=bias, bone=bone, pin_rows=pin_rows,
                    grid=[[[round(c, 5) for c in inv @ Vector(p)] for p in row] for row in grid]))
    for ob in bpy.data.collections[COL].objects:
        if ob.name.split('.')[0] in part_names:
            ob.hide_render = True


def sim_rest():
    """Static cloth data for poses.json: rest grids (in their bone's space) and palette families."""
    if not SIM:
        return None
    import json
    fams = json.load(open(r'D:\Game\concepts\sprites\out\ranger_master_layers.json'))['families']   # the master's own
    fams.update(PIXEL_FAMILIES)
    # the harmonized ramps pixelize.py paints with (hi, base, shade, outline), so the cloth matches the baked sprites
    import sys
    sys.path.insert(0, r'D:\Game\concepts\sprites')
    import palette_harm
    return {'cloths': [dict(c, colours=palette_harm.hex4(c['fam'], fams[c['fam']]) if c['fam'] in fams else None) for c in SIM],
            'capsule_names': [c[0] for c in SIM_CAPSULES]}


def sim_frame():
    """Per pose (armature at facing yaw 0, after the ground snap): each cloth bone's matrix (metres), the capsules,
    and a probe point (Spine2 head) the game uses to check its projection against the rendered bones."""
    if not SIM:
        return None
    arm = bpy.data.objects[ROOT]
    W = arm.matrix_world
    pbs = arm.pose.bones
    r = lambda v: [round(c, 4) for c in v]
    mats = {}   # bone -> 3x4 (rotation columns | translation): the game places the pinned rows (and a fresh cloth) with it
    for c in SIM:
        M = W @ pbs[c['bone']].matrix
        mats[c['bone']] = [round(M[i][j], 5) for i in range(3) for j in range(4)]
    caps = []
    for b0, e0, (b1, e1), rad, xo in SIM_CAPSULES:
        pb0, pb1 = pbs[b0], pbs[b1]
        a = getattr(pb0, e0) + pb0.matrix.to_3x3() @ Vector((xo, 0, 0)) * (1 if xo else 0)
        b = getattr(pb1, e1) + pb0.matrix.to_3x3() @ Vector((xo, 0, 0)) * (1 if xo else 0)
        caps.append(r(W @ a) + r(W @ b) + [rad * PROP['height'] / 1.8])
    return {'mats': mats, 'caps': caps, 'probe': r(W @ pbs['Spine2'].head)}


def add_chain(name, parent, pts):
    """Garment-owned bone chain through pts (len(pts)-1 bones), parented to a standard bone."""
    arm = bpy.data.objects[ROOT]
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb, names, prev = arm.data.edit_bones, [], parent
    for i in range(len(pts) - 1):
        b = eb.new(f'{name}{i}')
        b.head, b.tail, b.roll = pts[i], pts[i + 1], 0
        b.parent = eb[prev]
        b.use_connect = i > 0
        names.append(b.name); prev = b.name
    bpy.ops.object.mode_set(mode='OBJECT')
    return names


def weight_chain(ob, bones, pts):
    """Smooth cloth weights: each vertex blends the two nearest chain bones by its position along the chain."""
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    groups = [ob.vertex_groups.new(name=b) for b in bones]
    P = [Vector(p) for p in pts]
    seg = [(P[i + 1] - P[i]).length for i in range(len(P) - 1)]
    total = sum(seg)
    for v in ob.data.vertices:
        # arc-length parameter of the closest point on the polyline
        best, acc, u = 1e9, 0.0, 0.0
        for i in range(len(seg)):
            d = P[i + 1] - P[i]
            t = max(0.0, min(1.0, (v.co - P[i]).dot(d) / d.length_squared))
            dist = (P[i] + d * t - v.co).length
            if dist < best:
                best, u = dist, (acc + t * seg[i]) / total
            acc += seg[i]
        x = u * len(bones) - .5            # blend around bone centres
        i0 = max(0, min(len(bones) - 1, int(math.floor(x))))
        i1 = min(len(bones) - 1, i0 + 1)
        f = max(0.0, min(1.0, x - i0)) if x >= 0 else 0.0
        groups[i0].add([v.index], 1 - f, 'REPLACE')
        if i1 != i0 and f > 0:
            groups[i1].add([v.index], f, 'REPLACE')


# how each clip moves the cloth: lift (deg, streaming back with speed), flutter amplitude (deg), flutters per cycle
CLOTH_MOTION = {'idle': (3, 3, 1), 'walk': (14, 6, 2), 'run': (34, 11, 2), 'sprint': (46, 13, 2), 'drive': (38, 12, 2), 'roll': (60, 14, 1.5),
                'draw': (5, 2, 1), 'release': (8, 5, 1), 'leap': (40, 12, 1), 'climb': (4, 3, 1), 'mantle': (12, 3, 1)}
CLOTH_POSE = {'skid_a': 30, 'skid_b': 12, 'crouch': 26, 'lunge': 24, 'reach_up': 6, 'bow_draw': 5, 'idle': 3, 'apose': 2,
              'fall': 62, 'land': 30}   # (baked cloth only; the ranger_sim cloak is simulated in the game)


def _cloth(pose_name):
    """Cloth solver for sprite frames (deterministic, phase-locked): lift the chains with the motion's speed, send a
    flutter wave down them in time with the gait phase, and swing them outward in turns (lagging the body)."""
    arm = bpy.data.objects[ROOT]
    side_swing, phase, lift, amp, freq = 0.0, 0.0, 3.0, 2.0, 1.0
    if pose_name[:3] in ('ws_', 'rs_'):   # moving + shooting: the cloth moves with the gait frame it is built on
        lift, amp, freq = CLOTH_MOTION['walk' if pose_name.startswith('ws_') else 'run']
        phase = int(pose_name.rsplit('_', 1)[1]) / 8
    elif '.' in pose_name:
        clip, i = pose_name.split('.')
        phase = int(i) / ANIMS[clip]['frames']
        lift, amp, freq = CLOTH_MOTION.get(clip, (4, 2, 1))
    elif pose_name.startswith('turn_'):
        big = pose_name.endswith('a')
        lift, amp, freq, phase = (34, 10, 1, .25) if big else (40, 9, 1, .6)
        side_swing = (22 if big else 12) * (1 if pose_name[5] == 'l' else -1)   # left turn: cloth swings out to the right
    else:
        lift = CLOTH_POSE.get(pose_name, 4)
    share = [.42, .26, .18, .14]
    for ch in CLOTH_CHAINS:
        n = len(ch['bones'])
        w = share[:n] if n == 4 else [1 / n] * n
        for k, bn in enumerate(ch['bones']):
            wave = amp * ch['flutter'] * math.sin(2 * math.pi * (freq * phase - k * .22))
            sway = amp * .45 * ch['side'] * math.sin(2 * math.pi * (freq * .5 * phase + .3) - k * .35)
            rx = lift * ch['lift'] * w[k] * (1 if ch['lift'] >= 0 else 1) + wave * (1 if k else .5)
            ry = side_swing * ch['turn'] * w[k] * n / 2 + sway
            pb = arm.pose.bones[bn]
            R = Matrix.Rotation(math.radians(ry), 4, 'Y') @ Matrix.Rotation(math.radians(rx), 4, 'X')
            h = pb.matrix.translation.copy()
            pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
            bpy.context.view_layer.update()


def cloth_sheet(name, bone, rows, thick):
    """A thin closed cloth panel. rows = [(centre Vector, half-width, forward-wrap)] from top to bottom; the panel
    faces +Y (the back), its side edges curl forward by `wrap` so it drapes around the body."""
    bm = bmesh.new()
    cols = 7
    front, back = [], []
    for c, hw, wrap in rows:
        fr, bk = [], []
        for j in range(cols):
            u = -1 + 2 * j / (cols - 1)
            p = c + Vector((u * hw, -wrap * u * u, 0))
            fr.append(bm.verts.new(p - Vector((0, thick / 2, 0))))
            bk.append(bm.verts.new(p + Vector((0, thick / 2, 0))))
        front.append(fr); back.append(bk)
    R = len(rows)
    for r in range(R - 1):
        for j in range(cols - 1):
            bm.faces.new((front[r][j], front[r][j + 1], front[r + 1][j + 1], front[r + 1][j]))
            bm.faces.new((back[r][j + 1], back[r][j], back[r + 1][j], back[r + 1][j + 1]))
        for j in (0, cols - 1):  # side edges
            bm.faces.new((front[r][j], front[r + 1][j], back[r + 1][j], back[r][j]))
    for r in (0, R - 1):          # top and hem edges
        for j in range(cols - 1):
            bm.faces.new((front[r][j], back[r][j], back[r][j + 1], front[r][j + 1]))
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
    ob.vertex_groups.new(name=bone).add(list(range(len(me.vertices))), 1.0, 'REPLACE')
    ob.modifiers.new('Armature', 'ARMATURE').object = arm
    me.materials.append(bpy.data.materials['BodyGrey'])
    return ob


@garment('travel_cloak', 'cloak', ['human_small'], soft=['Cloak'],
         pixel={'Cloak': ['cloak', 'red', {'bias': -.08}], 'CloakCollar': ['cloak', 'red', {}]})
def _travel_cloak():
    """A big cloak from the shoulders to the calves, draping over the shoulders; it hangs on a 4-bone chain."""
    P, s, J, z = _ctx()
    top, bot = z('neck') - .01 * s, z('kneeL') - .06 * s
    path = [Vector((0, .19 * s, top)), Vector((0, .22 * s, top - (top - bot) * .3)),
            Vector((0, .26 * s, top - (top - bot) * .62)), Vector((0, .3 * s, bot + (top - bot) * .08)), Vector((0, .32 * s, bot))]
    bones = add_chain('Cloak', 'Spine2', path)
    rows = []
    for k in range(9):
        t = k / 8
        # position along the chain path
        u = t * (len(path) - 1)
        i = min(int(u), len(path) - 2)
        c = path[i].lerp(path[i + 1], u - i)
        hw = (.2 + .15 * t) * s                       # widens toward the hem
        wrap = (.13 - .07 * t) * s                    # curls forward over the shoulders at the top
        rows.append((c, hw, wrap))
    ob = cloth_sheet('Cloak', bones[0], rows, .016 * s)
    weight_chain(ob, bones, path)
    if SIM_CLOTH:   # the game simulates it: 9 rows x 7 columns on the panel's mid-surface, top two rows ride on Spine2
        grid = [[c + Vector((u * hw, -wrap * u * u, 0)) for u in (-1 + 2 * j / 6 for j in range(7))] for c, hw, wrap in rows]
        sim_cloth('Cloak', 'red', -.08, 'Spine2', grid, 2, {'Cloak'})
    else:
        CLOTH_CHAINS.append(dict(bones=bones, lift=1.0, side=1.0, flutter=1.0, turn=1.0))
    # a rolled collar over the shoulders (rigid on the chest) so the cloak reads as worn, not glued on
    loft('CloakCollar', 'Spine2', [(0, .03 * s, z('neck') - .05 * s), (0, .03 * s, z('neck') + .0 * s)],
         [(.2 * s, .165 * s), (.14 * s, .14 * s)], p=2.4)


# ---------------------------------------------------------------- hair ---------------------------------------------
@garment('hair_mop', 'head', ['human_small'],
         pixel={'HairCap': ['hair', 'hair', {'bias': .05}], 'HairFringe': ['hair', 'hair', {}], 'HairLock': ['hair', 'hair', {}],
                'HairNape': ['hair', 'hair', {}]})
def _hair_mop():
    """A brown mop: cap leaves the forehead free, a swept saw-tooth fringe, pointed side locks, nape tufts."""
    P, s, J, z = _ctx()
    c, hh = z('head'), z('top') - z('head')
    rows = [(.30, .075, .195, .16), (.45, .04, .21, .205), (.60, .012, .218, .228), (.78, .006, .205, .215),
            (.93, .01, .145, .155), (1.03, .01, .06, .06)]
    loft('HairCap', 'Head', [(0, yc * s, c + f * hh) for f, yc, rx, ry in rows], [(rx * s, ry * s) for f, yc, rx, ry in rows], p=2.3)
    # fringe: a band across the forehead, swept down toward the character's right, every other ring drops a point
    fx = [.2, .12, .04, -.04, -.12, -.2]
    fz = [.66, .65, .63, .61, .59, .58]
    fp = [(x * s, (-.215 + .09 * (x / .21) ** 2) * s, c + f * hh) for x, f in zip(fx, fz)]
    loft('HairFringe', 'Head', fp, [(.045 * s, .03 * s)] * 6, side=(0, 0, 1), n=4, p=2.0)
    ob = bpy.data.objects['HairFringe']
    for v in ob.data.vertices:          # saw teeth: lower vertices of every other ring hang lower
        k = min(range(6), key=lambda i: abs(v.co.x - fp[i][0]))
        if v.co.z < fp[k][2] - .01 * s and k % 2 == 0:
            v.co.z -= .045 * s
    for sd, sx in (('L', 1), ('R', -1)):
        loft(f'HairLock.{sd}', 'Head', [(sx * .19 * s, -.07 * s, c + .64 * hh), (sx * .2 * s, -.075 * s, c + .45 * hh),
                                        (sx * .19 * s, -.07 * s, c + .3 * hh)],
             [(.035 * s, .05 * s), (.032 * s, .045 * s), (.004 * s, .004 * s)], n=4, p=2.0)
    for i, x in enumerate((-.1, 0, .1)):
        loft(f'HairNape.{i}', 'Head', [(x * s, .15 * s, c + .38 * hh), (x * 1.1 * s, .17 * s, c + .24 * hh), (x * 1.2 * s, .165 * s, c + .15 * hh)],
             [(.05 * s, .03 * s), (.035 * s, .022 * s), (.004 * s, .004 * s)], n=4, p=2.0)


DRAW = {'bow_draw': 1.0, 'draw.0': 0.0, 'draw.1': .5, 'draw.2': 1.0, 'release.0': -.12}  # how far the string is drawn


def _bow_string(pose_name):
    """String constraint: pull the nocking point toward the draw hand's fingers by the pose's draw amount (negative =
    the overshoot when the string snaps back on release); aim the arrow from the nock through the grip."""
    arm = bpy.data.objects[ROOT]
    pbs = arm.pose.bones
    amt = 1.0 if pose_name[:3] in ('ws_', 'rs_') or pose_name.startswith('draw_') else DRAW.get(pose_name, 0.0)   # held full draw
    if pose_name.startswith('aim_'):   # standing aim twists / steps hold full draw; a quick pivot tucks the bow first
        amt = AIM_DRAW.get(pose_name, 1.0)
    nk, ar, lh, rh = pbs['BowNock0'], pbs['BowArrow0'], pbs['LeftHand'], pbs['RightHand']
    rest = nk.matrix.translation.copy()
    fingers = rh.head + (rh.tail - rh.head) * .45
    if amt > 0:
        target = rest.lerp(fingers, amt)
    else:
        target = rest + (rest - fingers).normalized() * (-amt) * .12 * PROP['height'] / 1.8   # snap-back overshoot
    nk.matrix = Matrix.Translation(target - rest) @ nk.matrix
    bpy.context.view_layer.update()
    grip = lh.head + (lh.tail - lh.head) * .5
    M = ar.matrix.copy()
    if amt > .01:
        d = (grip - target).normalized()
        R = M.to_3x3().col[1].normalized().rotation_difference(d).to_matrix()
        ar.matrix = Matrix.Translation(target) @ (R @ M.to_3x3()).to_4x4()
    else:
        ar.matrix = M @ Matrix.Scale(.001, 4)   # no arrow on the string
    bpy.context.view_layer.update()


def dress(loadout):
    """Build every garment of the loadout on the current skeleton; enforce one garment per slot and body fit."""
    used = {}
    for gid in loadout:
        g = GARMENTS[gid]
        if g['slot'] in used:
            raise ValueError(f"slot '{g['slot']}' already holds {used[g['slot']]}; cannot also wear {gid}")
        if not (g['fits'] & BODY_TAGS):
            raise ValueError(f"{gid} fits {sorted(g['fits'])}, this body is {sorted(BODY_TAGS)}: needs its own variant")
        used[g['slot']] = gid
    hidden = set()
    for gid in loadout:
        g = GARMENTS[gid]
        g['build']()
        PIXEL.update(g['pixel'])
        SOFT_PARTS.update(g['soft'])
        hidden |= g['hides']
    for ob in bpy.data.collections[COL].objects:
        if ob.type == 'MESH' and ob.name.split('.')[0] in hidden:
            ob.hide_render = True
    if 'short_bow' in loadout and _bow_grip not in HOLD_HOOKS:
        HOLD_HOOKS.extend([_bow_grip, _bow_string, _bow_stow])
    if CLOTH_CHAINS and _cloth not in HOLD_HOOKS:
        HOLD_HOOKS.append(_cloth)
    return used


def build():
    _build_body_only()
    dress(LOADOUT)
    return sorted(o.name for o in bpy.data.collections[COL].objects if not o.hide_render)
