# Western wardrobe: garments for the gunslinger and the Mexican outlaw, the revolver and its poses, on the standard
# skeleton (skeleton.py) and the wardrobe rules (wardrobe.py): parts split at the joints, each bound 100% to one named
# bone; garment-owned bone chains for held and slung things. Loaded by a loadout AFTER wardrobe.py, from the repo root:
#   exec(open(r'D:\Game\tools\blender\wardrobe.py').read()); exec(open('tools/blender/western.py').read())
# Adds two slots to wardrobe.SLOTS' list: 'hat' (over the hair, which keeps its cap, locks and nape tufts) and 'belt'
# (the gun belt + holster). The revolver is a 'hands' item in the RIGHT hand; outside gun poses it sits in the holster
# on the right thigh (_gun_hold), the way the bow is slung for climbing (_bow_stow).
# A loadout may set SPUR_SIZE (1 = a working cowboy's spur, the outlaw's are ~1.8) before build().
import os, sys

PIXEL_FAMILIES.update({
    'darkfelt': ['7a5e48', '5a4434', '3e2e22', '1a120c'],   # the gunslinger's hat: dark brown felt
    'blackfelt': ['5c5450', '403a38', '2c2726', '100c0c'],  # the outlaw's sombrero
    'oilskin': ['7c6a5c', '5a4a40', '3e332c', '18100c'],    # the duster: dark oiled canvas, greyer than the hat
    'vest': ['6a5c56', '4a3e3a', '342a28', '161010'],       # dark wool vest
    'charcoal': ['686262', '4a4646', '343032', '141214'],   # dark trousers
    'denim': ['7088aa', '50668a', '3a4a68', '1c2236'],      # washed indigo
    'serape': ['dc7c44', 'b4522a', '80361e', '34140a'],     # the poncho: madder-red wool
    'iron': ['9a9aa2', '6c6c76', '4a4a54', '1e1e26'],       # gunmetal, spurs, silver trim
    'brass': ['e8c870', 'c09a48', '8a6a30', '3a2a12'],      # buckle, cartridges
    'blued': ['7c8494', '545c6c', '3a404e', '161a22'],      # the Peacemaker's blued steel
    'ivory': ['f0e6cc', 'd4c6a4', 'a89a7a', '4a4234'],      # its grips
    'walnut': ['8a5a36', '643e24', '462a18', '1e120a'],     # the Navy's grip
})
SPUR_SIZE = 1.0


# ---------------------------------------------------------------- helpers ------------------------------------------
def _hand_frame(side='R'):
    """Rest-space frame of a closed fist: grip point, F = along the hand (the barrel axis when holding a pistol),
    U = the thumb side (the gun's top). In the A-pose the hand's width runs front-back with the thumb forward."""
    P, s, J, z = _ctx()
    wr, hd = J['wrist' + side], J['hand' + side]
    F = (hd - wr).normalized()
    U = Vector((0, -1, 0))
    U = (U - F * U.dot(F)).normalized()
    return wr + (hd - wr) * .5, F, U


def _frame_rot(a, b, d, e):
    """Rotation taking the orthonormal pair (a, b) to (d, e) (e is first made orthogonal to d)."""
    e = (e - d * e.dot(d)).normalized()
    return Matrix((d, e, d.cross(e))).transposed() @ Matrix((a, b, a.cross(b)))


def _bind(name, bm, bone):
    """bmesh -> a flat-shaded object bound 100% to `bone` (as skeleton.loft does)."""
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


def _brim(name, bone, centre, r_in, r_out, thick, lift, n=16, rings=4):
    """A hat brim as a solid annulus (so it can curl): r_in / r_out = (rx, ry) of its inner and outer edge;
    lift(ux, uy, t) -> metres up at a point (ux, uy = direction cosines, t = 0 inner .. 1 outer edge)."""
    bm = bmesh.new()
    top, bot = [], []
    for k in range(rings + 1):
        t = k / rings
        rx, ry = r_in[0] + (r_out[0] - r_in[0]) * t, r_in[1] + (r_out[1] - r_in[1]) * t
        T, B = [], []
        for i in range(n):
            a = 2 * math.pi * i / n + math.pi / n
            ux, uy = math.cos(a), math.sin(a)
            p = Vector((centre[0] + ux * rx, centre[1] + uy * ry, centre[2] + lift(ux, uy, t)))
            T.append(bm.verts.new(p + Vector((0, 0, thick / 2))))
            B.append(bm.verts.new(p - Vector((0, 0, thick / 2))))
        top.append(T); bot.append(B)
    for k in range(rings):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((top[k][i], top[k][j], top[k + 1][j], top[k + 1][i]))
            bm.faces.new((bot[k][j], bot[k][i], bot[k + 1][i], bot[k + 1][j]))
    for k in (0, rings):   # inner and outer edge walls
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((top[k][j], top[k][i], bot[k][i], bot[k][j]))
    return _bind(name, bm, bone)


def _sheet(name, bone, rows, thick, cols=7):
    """wardrobe.cloth_sheet with a different half-width and forward wrap on each side (+X = the character's left):
    rows = [(centre, (hw_left, hw_right), (wrap_left, wrap_right))] from the top down; faces +Y (the back)."""
    bm = bmesh.new()
    front, back = [], []
    for c, hw, wrap in rows:
        fr, bk = [], []
        for j in range(cols):
            u = -1 + 2 * j / (cols - 1)
            sd = 0 if u >= 0 else 1
            p = c + Vector((u * hw[sd], -wrap[sd] * u * u, 0))
            fr.append(bm.verts.new(p - Vector((0, thick / 2, 0))))
            bk.append(bm.verts.new(p + Vector((0, thick / 2, 0))))
        front.append(fr); back.append(bk)
    R = len(rows)
    for r in range(R - 1):
        for j in range(cols - 1):
            bm.faces.new((front[r][j], front[r][j + 1], front[r + 1][j + 1], front[r + 1][j]))
            bm.faces.new((back[r][j + 1], back[r][j], back[r + 1][j], back[r + 1][j + 1]))
        for j in (0, cols - 1):
            bm.faces.new((front[r][j], front[r + 1][j], back[r + 1][j], back[r][j]))
    for r in (0, R - 1):
        for j in range(cols - 1):
            bm.faces.new((front[r][j], back[r][j], back[r][j + 1], front[r][j + 1]))
    return _bind(name, bm, bone)


def _capelet(name, bone, rows, thick, cols=13, p=2.6):
    """A cape round the shoulders, open at the front: rows = [(z, yc, hw, d, deg)] from the top down, each a half
    superellipse (power p) from the back (+Y, at yc + d) round the sides (x = +-hw at yc) to `deg` deg from the back
    on either side (past 90: forward of the shoulders)."""
    se = lambda v: math.copysign(abs(v) ** (2 / p), v)
    bm = bmesh.new()
    outer, inner = [], []
    for zz, yc, hw, d, deg in rows:
        o, i = [], []
        for j in range(cols):
            a = math.radians(deg) * (-1 + 2 * j / (cols - 1))
            sx, cy = se(math.sin(a)), se(math.cos(a))
            o.append(bm.verts.new((sx * (hw + thick / 2), yc + cy * (d + thick / 2), zz)))
            i.append(bm.verts.new((sx * (hw - thick / 2), yc + cy * (d - thick / 2), zz)))
        outer.append(o); inner.append(i)
    for r in range(len(rows) - 1):
        for j in range(cols - 1):
            bm.faces.new((outer[r][j], outer[r][j + 1], outer[r + 1][j + 1], outer[r + 1][j]))
            bm.faces.new((inner[r][j + 1], inner[r][j], inner[r + 1][j], inner[r + 1][j + 1]))
        for j in (0, cols - 1):
            bm.faces.new((outer[r][j], outer[r + 1][j], inner[r + 1][j], inner[r][j]))
    for r in (0, len(rows) - 1):
        for j in range(cols - 1):
            bm.faces.new((outer[r][j], inner[r][j], inner[r][j + 1], outer[r][j + 1]))
    return _bind(name, bm, bone)


def _sheet_grid(rows, cols=7):
    """The mid-surface points of a _sheet (runtime cloth grid)."""
    return [[c + Vector((u * hw[0 if u >= 0 else 1], -wrap[0 if u >= 0 else 1] * u * u, 0))
             for u in (-1 + 2 * j / (cols - 1) for j in range(cols))] for c, hw, wrap in rows]


def _ring_at(rows, zz):
    """(yc, rx, ry) of a loft profile rows = [(z, yc, rx, ry)] (top down) at height zz, linearly interpolated."""
    for a, b in zip(rows, rows[1:]):
        if b[0] <= zz <= a[0]:
            f = (a[0] - zz) / (a[0] - b[0])
            return tuple(a[i] + (b[i] - a[i]) * f for i in (1, 2, 3))
    r = rows[0] if zz > rows[0][0] else rows[-1]
    return r[1], r[2], r[3]


# ---------------------------------------------------------------- hats ---------------------------------------------
def _hat(crown, brim_out, lift, crease=.04, band=None):
    """Crown rows (f of the head height, yc, rx, ry) wide enough to enclose the mop's hair cap (which shows under the
    brim at the back and sides; without it the bare back of the head reads as a second face), a band, and a brim
    whose front edge stays >= ~1.5 px above the eyes for the 20 deg camera."""
    P, s, J, z = _ctx()
    c, hh = z('head'), z('top') - z('head')
    zb = c + .69 * hh
    # its own bone at the head's centre (rest = on the head: every pose as before), so a fall can tip it (_fall_keys)
    hold = add_chain('HatHold', 'Head', [Vector((0, .012 * s, c + .5 * hh)), Vector((0, .012 * s, c + .5 * hh + .05 * s))])[0]
    loft('HatCrown', hold, [(0, yc * s, c + f * hh) for f, yc, rx, ry in crown], [(rx * s, ry * s) for f, yc, rx, ry in crown], p=2.3)
    if crease:   # the top dips along the front-back centre line
        ob = bpy.data.objects['HatCrown']
        top = c + (crown[-3][0] + .04) * hh
        for v in ob.data.vertices:
            if v.co.z > top:
                v.co.z -= crease * s * max(0.0, 1 - abs(v.co.x) / (.12 * s))
    r0 = crown[1]
    loft('HatBand', hold, [(0, .012 * s, zb + .005 * s), (0, .012 * s, zb + .035 * s)],
         [((r0[2] + .007) * s, (r0[3] + .007) * s)] * 2, p=2.3)
    _brim('HatBrim', hold, (0, .012 * s, zb), ((r0[2] - .03) * s, (r0[3] - .03) * s), (brim_out[0] * s, brim_out[1] * s),
          .012 * s, lift)


@garment('gunslinger_hat', 'hat', ['human_small'], hides=['HairFringe'],
         pixel={'HatCrown': ['hat', 'darkfelt', {'bias': .05}], 'HatBand': ['hatband', 'leather', {'bias': -.25}],
                'HatBrim': ['brim', 'darkfelt', {}]})
def _gunslinger_hat():
    """Dark brown cattleman: straight-sided creased crown, the brim curled up at the sides (flatter reads as a derby)."""
    _hat([(.68, .012, .232, .244), (.74, .012, .232, .244), (.92, .012, .224, .237), (1.08, .012, .214, .228),
          (1.14, .012, .19, .205), (1.17, .012, .1, .12)],
         (.36, .31), lambda ux, uy, t: .07 * t * t * ux ** 4)


@garment('sombrero', 'hat', ['human_small'], hides=['HairFringe'],
         pixel={'HatCrown': ['hat', 'blackfelt', {'bias': .05}], 'HatBand': ['hatband', 'iron', {'bias': .1}],
                'HatBrim': ['brim', 'blackfelt', {}]})
def _sombrero():
    """A vaquero's sombrero, kept in the cowboy-hat family: a tall tapered crown with a silver band, a wide brim that
    rolls up all round its edge (the rolled front keeps the eyes in view)."""
    _hat([(.68, .012, .232, .244), (.76, .012, .232, .244), (1.0, .012, .21, .222), (1.2, .012, .175, .186),
          (1.31, .012, .13, .14), (1.35, .012, .06, .07)],
         (.5, .44), lambda ux, uy, t: .07 * t ** 4 + .012 * t, crease=.02)


# ---------------------------------------------------------------- neck ---------------------------------------------
@garment('bandana', 'neck', ['human_small'],
         pixel={'BandanaWrap': ['bandana', 'red', {}], 'BandanaFlap': ['bandana', 'red', {'bias': -.05}]})
def _bandana():
    """A neckerchief: a thin roll round the neck and a triangle over the top of the chest."""
    P, s, J, z = _ctx()
    n = z('neck')
    loft('BandanaWrap', 'Spine2', [(0, .0, n - .04 * s), (0, .005, n - .01 * s), (0, .01, n + .035 * s)],
         [(.13 * s, .125 * s), (.12 * s, .115 * s), (.085 * s, .08 * s)], p=2.4)
    loft('BandanaFlap', 'Spine2', [(0, -.15 * s, n - .03 * s), (0, -.167 * s, n - .08 * s), (0, -.17 * s, n - .13 * s)],
         [(.095 * s, .012 * s), (.055 * s, .012 * s), (.008 * s, .01 * s)], side=(1, 0, 0), n=4, p=2.0)


# ---------------------------------------------------------------- vest ---------------------------------------------
@garment('wool_vest', 'outer', ['human_small'],
         pixel={'VestBelly': ['vest', 'vest', {}], 'VestRibs': ['vest', 'vest', {}], 'VestChest': ['vest', 'vest', {}],
                'VestOpen': ['shirt', 'linen', {'thin': True}]})
def _wool_vest():
    """Sleeveless, to the belt; the shirt shows in a V down the front (VestOpen, laid over the closed shell)."""
    P, s, J, z = _ctx()
    T, t = _torso(P, s, z), .022 * s
    loft('VestBelly', 'Spine', [(0, .005, z('spine') - .02 * s), (0, .005, z('spine1'))], _grow(T['belly'][1], t), p=2.6)
    loft('VestRibs', 'Spine1', T['ribs'][0], _grow(T['ribs'][1], t), p=2.6)
    loft('VestChest', 'Spine2', T['chest'][0] + [(0, .01, z('neck') - .01 * s)],
         _grow(T['chest'][1], t) + [(.105 * s, .095 * s)], p=2.6)
    pts, rad = [], []
    for zz, ry, w in ((z('neck') - .02 * s, .12, .045), (z('spine2') + .03 * s, .135, .03), (z('spine1') + .03 * s, .12, .012),
                      (z('spine1') - .02 * s, .113, .004)):
        pts.append((0, -(ry * s + t + .004 * s), zz)); rad.append((w * s, .004 * s))
    loft('VestOpen', 'Spine2', pts, rad, side=(1, 0, 0), n=4, p=2.0)


# ---------------------------------------------------------------- duster (gunslinger) ---------------------------------
@garment('duster', 'cloak', ['human_small'], soft=['Duster', 'DusterCape'], hides=['ShirtSleeveUp', 'ShirtSleeveLo'],
         pixel={'Duster': ['duster', 'oilskin', {'bias': -.06}], 'DusterCape': ['cape', 'oilskin', {'bias': .04}],
                'DusterCollar': ['collar', 'oilskin', {}],
                'DusterSleeveUp': ['dsleeve', 'oilskin', {}], 'DusterSleeveLo': ['dsleeve', 'oilskin', {}],
                'DusterLapel': ['lapel', 'oilskin', {'bias': .12}]})
def _duster():
    """The gunslinger's long coat: to mid-calf, open down the front, its RIGHT front swept back behind the holster
    (the gun hand is free), a short shoulder cape, a turned-up collar, full sleeves. The long panel hangs on a 4-bone
    chain like the travel cloak; with SIM_CLOTH the game simulates it instead (the cape and collar stay in the sprite)."""
    P, s, J, z = _ctx()
    top, bot = z('neck') - .02 * s, .17 * s
    path = [Vector((0, .15 * s, top)), Vector((0, .17 * s, top - (top - bot) * .3)),
            Vector((0, .19 * s, top - (top - bot) * .62)), Vector((0, .21 * s, bot + (top - bot) * .08)), Vector((0, .22 * s, bot))]
    bones = add_chain('Duster', 'Spine2', path)
    rows = []
    for k in range(9):
        t = k / 8
        u = t * (len(path) - 1)
        i = min(int(u), len(path) - 2)
        c = path[i].lerp(path[i + 1], u - i)
        hw = ((.235 + .08 * t) * s, (.215 + .05 * t) * s)          # left / right
        wrap = ((.25 - .04 * t) * s, (.17 - .1 * t) * s)            # the right front swept back past the holster
        rows.append((c, hw, wrap))
    ob = _sheet('Duster', bones[0], rows, .016 * s)
    weight_chain(ob, bones, path)
    if SIM_CLOTH:
        sim_cloth('Duster', 'oilskin', -.06, 'Spine2', _sheet_grid(rows), 2, {'Duster'})
    else:
        CLOTH_CHAINS.append(dict(bones=bones, lift=.8, side=.8, flutter=.7, turn=.9))
    # shoulder cape: a short capelet resting ON the shoulders (over the sleeves' caps, ~1.25 m), open at the front, its
    # edges ending at the front of each shoulder. (It was a parabolic sheet that sank into the sleeves and left its two
    # front corners standing out in front of the arms as flat wings.)
    n = z('neck')
    # (soft: cloth, out of the ground snap: lying on his back it must not lift him)
    _capelet('DusterCape', 'Spine2', [(n + .05 * s, .03 * s, .18 * s, .165 * s, 150), (n + .045 * s, .02 * s, .27 * s, .18 * s, 130),
                                      (n, .02 * s, .335 * s, .19 * s, 118), (n - .18 * s, .02 * s, .375 * s, .2 * s, 112)],
             .014 * s)
    loft('DusterCollar', 'Spine2', [(0, .03 * s, n - .03 * s), (0, .04 * s, n + .06 * s)],
         [(.17 * s, .15 * s), (.15 * s, .14 * s)], p=2.4)     # turned up round the back of the neck
    for sd in 'LR':
        _sleeve('DusterSleeve', sd, J, s, .032 * s, upper=(0, 1), lower=(0, .98), cuff=.012 * s)
    # lapels: the open front folded back, from the collar down and out over the chest (lit a tone lighter than the coat,
    # so the coat reads apart from the dark vest under it from the front). Each point sits 1 cm proud of what is under it.
    from mathutils.bvhtree import BVHTree
    under = [o for o in bpy.data.collections[COL].objects if o.type == 'MESH' and not o.name.startswith('Duster')
             and o.name.split('.')[0] not in ('BandanaFlap', 'BandanaWrap')]
    vs, fs = [], []
    for o in under:
        k = len(vs)
        vs += [v.co.copy() for v in o.data.vertices]
        fs += [tuple(i + k for i in pl.vertices) for pl in o.data.polygons]
    chest = BVHTree.FromPolygons(vs, fs)

    def proud(x, zz, out=.01):
        hit = chest.ray_cast(Vector((x, -1, zz)), Vector((0, 1, 0)))[0]
        return hit - Vector((0, out * s, 0)) if hit else Vector((x, -.16 * s, zz))
    for sd, sx in (('L', 1), ('R', -1)):
        pts = [proud(sx * x * s, n - dz * s, .016) for x, dz in ((.095, .005), (.115, .07), (.14, .14), (.162, .2))]
        for i in range(1, len(pts) - 1):        # (no kinks where the vest's sections step)
            pts[i].y = min(pts[i].y, (pts[i - 1].y + pts[i + 1].y) / 2)
        loft(f'DusterLapel.{sd}', 'Spine2', pts, [(.04 * s, .006 * s), (.036 * s, .006 * s), (.026 * s, .006 * s), (.008 * s, .005 * s)],
             side=(1, 0, 0), n=4, p=2.0)


# ---------------------------------------------------------------- poncho + bandolier (outlaw) ---------------------------
PONCHO = []   # the poncho's profile (z, yc, rx, ry), for the bandolier lying on it
PONCHO_P = 3.0   # its section's superellipse power (flat front and back)


@garment('serape_poncho', 'cloak', ['human_small'], hides=['ShirtSleeveUp'],
         pixel={'Poncho': ['poncho', 'serape', {}], 'PonchoStripe': ['stripe', 'linen', {}],
                'PonchoYoke': ['poncho', 'serape', {}],
                'PonchoBand': ['band', 'vest', {}], 'PonchoGreen': ['band', 'green', {}],
                'PonchoSleeveUp': ['sleeve', 'linen', {}]})
def _serape_poncho():
    """A wool poncho hanging from the shoulders to the hips: wide across (the upper arms under it, the forearms out at
    its sides) but flat front and back (cloth hangs close to the body; a deep section reads as a barrel), the hem
    dipping at the front and back centres. Serape stripes: cream across the chest; dark, green and cream near the hem
    (each >= 1 px tall at the 20 deg camera).
    With SIM_CLOTH (the game's runtime cloth): a rigid YOKE over the shoulders (to below the cream stripe: it keeps the
    shoulders' fit) and the rest as two cloth sheets, front and back, open at the sides (where the forearms come out):
    pinned under the yoke's hem, the hem stripes as the cloth's bands (view/cloth.js CLOTH_MATERIALS PonchoFront /
    PonchoBack), colliding with the forearms too. Without it (CLOTH_BAKED=1: review stills) the whole poncho is rigid.)"""
    P, s, J, z = _ctx()
    n = z('neck')
    # (the shoulder rows sit on the arms' shoulder caps: the poncho rests on the shoulders, so nothing pokes up through it)
    rows = [(n + .005 * s, .005 * s, .1 * s, .095 * s), (n, 0, .2 * s, .15 * s), (n - .04 * s, 0, .3 * s, .168 * s),
            (n - .1 * s, 0, .325 * s, .171 * s), (n - .2 * s, 0, .33 * s, .172 * s), (n - .32 * s, 0, .34 * s, .175 * s),
            (n - .4 * s, 0, .345 * s, .178 * s)]
    PONCHO[:] = rows
    def dip(ob):   # the hem's front and back centres hang lower
        for v in ob.data.vertices:
            if v.co.z < n - .1 * s:
                v.co.z -= .06 * s * max(0.0, 1 - abs(v.co.x) / (.3 * s)) ** 1.5
    if SIM_CLOTH:
        _poncho_cloth(rows, dip)
    else:
        ob = loft('Poncho', 'Spine2', [(0, yc, zz) for zz, yc, rx, ry in rows], [(rx, ry) for zz, yc, rx, ry in rows], n=12, p=PONCHO_P)
        dip(ob)
    stripes = (('PonchoStripe', n - .13 * s, .035 * s),) + ((('PonchoBand', n - .3 * s, .03 * s), ('PonchoGreen', n - .338 * s, .03 * s),
                                                             ('PonchoStripe', n - .372 * s, .03 * s)) if not SIM_CLOTH else ())
    for name, zz, h in stripes:
        yc, rx, ry = _ring_at(rows, zz)
        ob = loft(name, 'Spine2', [(0, yc, zz + h / 2), (0, yc, zz - h / 2)], [(rx + .006 * s, ry + .006 * s)] * 2, n=12, p=PONCHO_P)
        if zz < n - .1 * s:
            dip(ob)
    # the shirt's upper sleeves start 5 cm above the shoulder joint (a deltoid cap) and poked up through the poncho's
    # shoulders as cream blocks: under it they start AT the joint with a slim cap (the rest as the shirt's)
    t = .012 * s
    for sd, m in (('L', 'Left'), ('R', 'Right')):
        sh, el = J['shoulder' + sd], J['elbow' + sd]
        d = (el - sh).normalized()
        loft(f'PonchoSleeveUp.{sd}', f'{m}Arm', [sh + d * .01 * s, sh + d * .05 * s, sh + (el - sh) * .55, el + d * .03 * s],
             _grow([(.045 * s, .05 * s), (.07 * s, .072 * s), (.055 * s, .058 * s), (.045 * s, .047 * s)], t), side=(0, -1, 0))


# the cloth's rows, m below the neck (x s): one pinned under the yoke's hem, then only the stripes' edges (the hem ends on
# the cream stripe: the red edge under it was < 1 px). 5 x 7 a sheet: cloth.sim ~ the duster's (8 rows cost 0.45 ms)
PONCHO_SKIRT = [-.2, -.285, -.315, -.353, -.387]
PONCHO_BANDS = [(1, 1, 'vest', 0.0), (2, 2, 'green', 0.0), (3, 3, 'linen', 0.0)]   # its hem stripes (cell rows)
PONCHO_COLS, PONCHO_PIN = 7, 1


def _poncho_cloth(rows, dip):
    """The SIM_CLOTH poncho: the yoke (rigid, to YOKE below the neck) and the skirt's two cloth sheets."""
    P, s, J, z = _ctx()
    n = z('neck')
    yoke = n - .215 * s
    yc, rx, ry = _ring_at(rows, yoke)
    yr = [r for r in rows if r[0] > yoke] + [(yoke, yc, rx, ry)]
    ob = loft('PonchoYoke', 'Spine2', [(0, c, zz) for zz, c, a, b in yr], [(a, b) for zz, c, a, b in yr], n=12, p=PONCHO_P)
    dip(ob)
    se = lambda v: math.copysign(abs(v) ** (2 / PONCHO_P), v)
    drop = lambda x, zz: .06 * s * max(0.0, 1 - abs(x) / (.3 * s)) ** 1.5 if zz < n - .1 * s else 0.0   # (dip's)
    for name, side in (('PonchoFront', -1), ('PonchoBack', 1)):
        grid = []
        for i, dz in enumerate(PONCHO_SKIRT):
            zz = n + dz * s
            yc, rx, ry = _ring_at(rows, zz)
            off = -.008 * s if i < PONCHO_PIN else 0.0   # the pinned row inside the yoke's hem, the rest on the profile
            row = []
            for j in range(PONCHO_COLS):
                a = math.radians(84) * (-1 + 2 * j / (PONCHO_COLS - 1))   # from his right side round the front (back) to his left
                x = (rx + off) * se(math.sin(a))
                row.append(Vector((x, yc + side * (ry + off) * se(math.cos(a)), zz - drop(x, zz))))
            grid.append(row)
        sim_cloth(name, 'serape', 0.0, 'Spine2', grid, PONCHO_PIN, set(), bands=PONCHO_BANDS)
    SIM_CAPSULES.extend([('LeftForeArm', 'head', ('LeftForeArm', 'tail'), .055, 0), ('RightForeArm', 'head', ('RightForeArm', 'tail'), .055, 0)])


@garment('bandolier', 'back', ['human_small'],
         pixel={'Bandolier': ['strap', 'leather', {'bias': -.1}], 'Rounds': ['rounds', 'brass', {'thin': True, 'bias': .1}]})
def _bandolier():
    """A cartridge belt from the left shoulder across the chest to the right hip and back, lying on the poncho (or on
    the body when there is none); a line of brass cartridges along its front run."""
    P, s, J, z = _ctx()
    n = z('neck')
    prof = PONCHO or [(n, 0, .16 * s, .14 * s), (z('spine'), 0, .17 * s, .14 * s)]
    def on(x, zz, side, off):   # a point on the profile's front (side -1) or back (+1) surface, `off` proud of it
        yc, rx, ry = _ring_at(prof, zz)
        k = max(0.0, 1 - abs(x / rx) ** PONCHO_P) ** (1 / PONCHO_P)    # the loft's superellipse
        return Vector((x, yc + side * (ry * k + off), zz))
    sh, hp = (.15 * s, n - .03 * s), (-.27 * s, n - .37 * s)
    for side, tag in ((-1, 'F'), (1, 'B')):
        pts = [on(sh[0] + (hp[0] - sh[0]) * t, sh[1] + (hp[1] - sh[1]) * t, side, .012 * s) for t in (0, .33, .66, 1)]
        loft(f'Bandolier.{tag}', 'Spine2', pts, [(.008 * s, .032 * s)] * 4, side=(0, side, 0), n=4, p=2.0)
        if side < 0:
            pr = [on(sh[0] + (hp[0] - sh[0]) * t, sh[1] + (hp[1] - sh[1]) * t, side, .022 * s) for t in (.08, .5, .92)]
            loft('Rounds', 'Spine2', pr, [(.006 * s, .011 * s)] * 3, side=(0, side, 0), n=4, p=2.0)
    top = on(.17 * s, n + .005 * s, 0, 0)   # over the shoulder: join the two runs
    loft('Bandolier.T', 'Spine2', [on(sh[0], sh[1], -1, .012 * s), Vector((top.x, top.y, top.z + .02 * s)), on(sh[0], sh[1], 1, .012 * s)],
         [(.008 * s, .032 * s)] * 3, side=(0, 0, 1), n=4, p=2.0)


# ---------------------------------------------------------------- legs, feet -----------------------------------------
def _trousers(seam=False, over=False):
    """Trousers to the knee + the upper shin (tucked into the tall boots); seam: a silver line down the outer side
    (charro trousers); over: straight legs worn OVER the boot shafts, down to the ankle (only the boot's foot shows)."""
    P, s, J, z = _ctx()
    T, t = _torso(P, s, z), .015 * s
    loft('TrouserHip', 'Hips', T['hip'][0][:3], _grow(T['hip'][1][:3], t), p=2.6)
    for sd, m, sx in (('L', 'Left', 1), ('R', 'Right', -1)):
        hp, kn, an = J['hip' + sd], J['knee' + sd], J['ankle' + sd]
        dl, ds = (kn - hp).normalized(), (an - kn).normalized()
        loft(f'TrouserThigh.{sd}', f'{m}UpLeg', [hp - dl * .05 * s, hp + (kn - hp) * .3, hp + (kn - hp) * .75, kn + dl * .03 * s],
             _grow([(.085 * s, .09 * s), (.08 * s, .085 * s), (.062 * s, .066 * s), (.05 * s, .052 * s)], t), side=(0, -1, 0))
        if over:
            loft(f'TrouserShin.{sd}', f'{m}Leg', [kn - ds * .035 * s, kn + (an - kn) * .45, an - ds * .025 * s],
                 _grow([(.05 * s, .052 * s), (.07 * s, .074 * s), (.08 * s, .084 * s)], t), side=(0, -1, 0))
        else:
            loft(f'TrouserShin.{sd}', f'{m}Leg', [kn - ds * .035 * s, kn + (an - kn) * .45],
                 _grow([(.05 * s, .052 * s), (.056 * s, .06 * s)], t), side=(0, -1, 0))
        if seam:
            out = Vector((sx, 0, 0))
            loft(f'TrouserSeam.{sd}', f'{m}UpLeg', [hp + (kn - hp) * .12 + out * .1 * s, hp + (kn - hp) * .5 + out * .09 * s,
                                                     kn + out * .07 * s], [(.004 * s, .007 * s)] * 3, side=(1, 0, 0), n=4, p=2.0)


@garment('denim_jeans', 'legs', ['human_small'], hides=['Pelvis', 'Thigh', 'Shin'],
         pixel={'TrouserHip': ['trousers', 'denim', {}], 'TrouserThigh': ['trousers', 'denim', {}], 'TrouserShin': ['trousers', 'denim', {}]})
def _denim_jeans():
    _trousers()


@garment('dark_trousers', 'legs', ['human_small'], hides=['Pelvis', 'Thigh', 'Shin'],
         pixel={'TrouserHip': ['trousers', 'charcoal', {}], 'TrouserThigh': ['trousers', 'charcoal', {}],
                'TrouserShin': ['trousers', 'charcoal', {}]})
def _dark_trousers():
    _trousers()


@garment('charro_trousers', 'legs', ['human_small'], hides=['Pelvis', 'Thigh', 'Shin'],
         pixel={'TrouserHip': ['trousers', 'charcoal', {}], 'TrouserThigh': ['trousers', 'charcoal', {}],
                'TrouserShin': ['trousers', 'charcoal', {}], 'TrouserSeam': ['seam', 'iron', {'thin': True, 'bias': .15}]})
def _charro_trousers():
    _trousers(seam=True)


@garment('cowboy_boots', 'feet', ['human_small'], hides=['Foot', 'Toe'],
         pixel={'BootShaft': ['boot', 'leather', {}], 'BootFoot': ['boot', 'leather', {}], 'BootToe': ['boot', 'leather', {}],
                'Spur': ['spur', 'iron', {'thin': True, 'bias': .1}]})
def _cowboy_boots():
    """Tall shafts to mid-shin (trousers tuck in), a heel (the back of BootFoot reaches lowest: the ground snap and
    the foot-contact data read BootFoot / BootToe), a pointed toe, and a spur behind each heel (SPUR_SIZE)."""
    P, s, J, z = _ctx()
    k = SPUR_SIZE
    for sd, m in (('L', 'Left'), ('R', 'Right')):
        kn, an, ba, to = J['knee' + sd], J['ankle' + sd], J['ball' + sd], J['toe' + sd]
        ds = (an - kn).normalized()
        loft(f'BootShaft.{sd}', f'{m}Leg', [an + ds * .02 * s, an - ds * .06 * s, kn + (an - kn) * .42],
             [(.058 * s, .062 * s), (.064 * s, .068 * s), (.078 * s, .082 * s)], side=(0, -1, 0))
        fz = .05 * s
        loft(f'BootFoot.{sd}', f'{m}Foot', [(an.x, an.y + .06 * s, fz + .004 * s), (an.x, an.y + .02 * s, fz + .002 * s),
                                            (an.x, an.y - .03 * s, fz + .012 * s), (ba.x, ba.y, fz * .85)],
             [(.046 * s, .054 * s), (.052 * s, .052 * s), (.054 * s, .042 * s), (.054 * s, .042 * s)], side=(1, 0, 0), n=6)
        loft(f'BootToe.{sd}', f'{m}ToeBase', [(ba.x, ba.y + .01 * s, fz * .72), (to.x, to.y - .035 * s, fz * .5)],
             [(.05 * s, .034 * s), (.016 * s, .014 * s)], side=(1, 0, 0), n=6)
        loft(f'Spur.{sd}', f'{m}Foot', [(an.x, an.y + .1 * s, fz + .01 * s), (an.x, an.y + (.1 + .035 * k) * s, fz + .004 * s)],
             [(.006 * s, .006 * s), (.016 * k * s, .016 * k * s)], side=(1, 0, 0), n=6, p=2.0)


# ---------------------------------------------------------------- gun belt + holster ---------------------------------
HOLSTER = {}   # rest-space holster frame for the revolver: grip point, barrel axis, top
# The revolvers are drawn bigger than life: at ~3.3 cm a pixel a real one is a sliver (its barrel half a pixel thick).
# GUN_LEN scales lengths along the barrel, GUN_GIRTH the sections and heights across it (and the holster with them).
GUN_LEN, GUN_GIRTH = 1.3, 1.45


@garment('gun_belt', 'belt', ['human_small'], soft=['Holster'],
         pixel={'GunBelt': ['gunbelt', 'leather', {'bias': -.12}], 'Buckle': ['buckle', 'brass', {'thin': True}],
                'Holster': ['holster', 'leather', {'bias': -.05}], 'HolsterTie': ['tie', 'leather', {'thin': True, 'bias': -.2}]})
def _gun_belt():
    """Slung low and tilted (high on the left hip, low on the right), the holster tied down on the right thigh: the
    revolver hangs muzzle down, grip to the rear and its top forward, butt just above the belt."""
    P, s, J, z = _ctx()
    T = _torso(P, s, z)
    zc = z('hips') - .01 * s
    rx, ry = T['hip'][1][2][0] + .045 * s, T['hip'][1][2][1] + .035 * s
    loft('GunBelt', 'Hips', [(0, .005, zc - .025 * s), (0, .005, zc + .025 * s)], [(rx, ry), (rx * .99, ry * .99)], n=12, p=2.6)
    ob = bpy.data.objects['GunBelt']
    for v in ob.data.vertices:
        v.co.z += .1 * v.co.x                      # +x = the character's left: higher there
    loft('Buckle', 'Hips', [(-.02 * s, -(ry + .004 * s), zc - .002 * s), (-.02 * s, -(ry + .012 * s), zc - .002 * s)],
         [(.022 * s, .018 * s)] * 2, side=(1, 0, 0), n=4, p=2.0)
    hp, kn = J['hipR'], J['kneeR']
    g = Vector((hp.x - .115 * s, .015 * s, zc - .075 * s))   # where the fist closes on the grip, holstered
    Fh = Vector((0, -.15, -1)).normalized()                    # muzzle down, canted a little forward
    Uh = Vector((0, -1, .15)).normalized()                     # the top faces forward
    HOLSTER.update(g=g, F=Fh, U=Uh)
    L, T = GUN_LEN * s, GUN_GIRTH * s
    loft('Holster', 'RightUpLeg', [g + Uh * .03 * T - Fh * .005 * L, g + Uh * .035 * T + Fh * .07 * L, g + Uh * .04 * T + Fh * .25 * L],
         [(.026 * T, .04 * T), (.024 * T, .03 * T), (.018 * T, .02 * T)], side=Fh.cross(Uh), n=6, p=2.2)
    tz = g.z - .2 * s                                           # the tie-down thong round the thigh, under the holster
    c = hp + (kn - hp) * ((hp.z - tz) / (hp.z - kn.z))
    loft('HolsterTie', 'RightUpLeg', [(c.x, c.y, tz - .006 * s), (c.x, c.y, tz + .006 * s)], [(.098 * s, .1 * s)] * 2, p=2.2)


# ---------------------------------------------------------------- revolvers ----------------------------------------
GUN = {}      # rest frame of the gun in the right fist (g, F, U)


def _revolver(barrel, bore, bore_n, cyl, rod, frame=1.0):
    """A single-action six-shooter in the right fist: grip, frame, cylinder, barrel (bore_n = its section's sides: 8
    reads as octagonal), a rod under the barrel (ejector housing / loading lever, `rod` = its share of the barrel), a
    trigger guard; `frame` scales the frame's section (a brass frame has to show round the cylinder at 1x).
    It rides on its own bone (GunHold0, a child of RightHand); GunMuzzle0 marks the muzzle so the game can place the
    flash and the bullet."""
    P, s, J, z = _ctx()
    g, F, U = _hand_frame('R')
    S = F.cross(U)
    GUN.update(g=g, F=F, U=U)
    L, T = GUN_LEN * s, GUN_GIRTH * s
    at = lambda u, f: g + U * u * T + F * f * L          # u up (toward the top), f forward (along the barrel) of the grip point
    r = lambda a, b: (a * T, b * T)
    hold = add_chain('GunHold', 'RightHand', [g, g + F * .05 * s])[0]
    loft('GunGrip', hold, [at(.015, -.012), at(-.045, -.028), at(-.085, -.042)], [r(.013, .018), r(.014, .019), r(.014, .017)],
         side=S, n=6, p=2.2)
    loft('GunFrame', hold, [at(.028, -.045), at(.03, -.01), at(.028, .055)],
         [r(.011 * frame, .016 * frame), r(.012 * frame, .02 * frame), r(.01 * frame, .014 * frame)], side=S, n=6, p=2.2)
    loft('GunGuard', hold, [at(.004, .002), at(-.022, .012), at(-.016, .038)], [r(.006, .007)] * 3, side=S, n=4, p=2.0)
    loft('GunCylinder', hold, [at(.032, 0), at(.032, cyl)], [r(.02, .02)] * 2, side=S, n=6, p=2.0)
    b0, mz = at(.04, cyl - .003), at(.04, cyl + barrel)
    loft('GunBarrel', hold, [b0, mz], [r(bore, bore)] * 2, side=S, n=bore_n, p=2.0)
    loft('GunRod', hold, [b0 - U * .018 * T, b0 - U * .018 * T + F * barrel * rod * L], [r(.006, .006)] * 2, side=S, n=4, p=2.0)
    add_chain('GunMuzzle', hold, [mz, mz + F * .02 * s])     # marker: exported as 2D points per frame


@garment('peacemaker', 'hands', ['human_small'], soft=['GunGrip', 'GunFrame', 'GunGuard', 'GunCylinder', 'GunBarrel', 'GunRod'],
         pixel={'GunGrip': ['grip', 'ivory', {'thin': True, 'bias': .05}], 'GunFrame': ['gun', 'blued', {'thin': True}],
                'GunGuard': ['gun', 'blued', {'thin': True}],
                'GunCylinder': ['gun', 'blued', {'thin': True, 'bias': .08}],
                'GunBarrel': ['barrel', 'blued', {'thin': True, 'bias': .1}], 'GunRod': ['barrel', 'blued', {'thin': True}]})
def _peacemaker():
    """The gunslinger's: blued steel, ivory grips, a long 7.5-inch barrel with the ejector housing under it."""
    _revolver(barrel=.19, bore=.0085, bore_n=6, cyl=.048, rod=.6)


@garment('brass_navy', 'hands', ['human_small'], soft=['GunGrip', 'GunFrame', 'GunGuard', 'GunCylinder', 'GunBarrel', 'GunRod'],
         pixel={'GunGrip': ['grip', 'walnut', {'thin': True}], 'GunFrame': ['frame', 'brass', {'thin': True, 'bias': .05}],
                'GunGuard': ['frame', 'brass', {'thin': True, 'bias': .1}],
                'GunCylinder': ['gun', 'iron', {'thin': True, 'bias': .08}],
                'GunBarrel': ['barrel', 'iron', {'thin': True, 'bias': .1}], 'GunRod': ['lever', 'iron', {'thin': True}]})
def _brass_navy():
    """The outlaw's: a brass-framed cap-and-ball Navy, octagonal iron barrel, long cylinder, the loading lever under
    the barrel, a walnut grip. Longer and heavier than the Peacemaker, and the brass has to read at 1x."""
    _revolver(barrel=.235, bore=.012, bore_n=8, cyl=.056, rod=.75, frame=1.45)


GUN_ITEMS = ('peacemaker', 'brass_navy')
GUN_POSES = ('gun_', 'gws_', 'grs_', 'gwr_', 'grr_')   # pose keys starting with these hold the revolver in the hand;
                                                       # all others: holstered
GUN_SPIN = {}                         # pose key -> the gun's spin (deg, muzzle up and back) about the trigger finger
LEVEL = .25                           # share of the forearm's pitch the barrel keeps: the wrist holds the gun near level
FOLLOW = ('gun_rl_', 'gwr_', 'grr_', 'gun_blow')   # keys whose barrel follows the forearm (muzzle up to eject, at the lips)
REACH = {}                            # pose key -> [(side, bone, rest point fn)]: that wrist onto the point the bone carries
LEFT_TO_GUN = {}                      # pose key -> the left wrist's spot (F, U, S metres) from the gun's hammer (IK)


def _reach(side, target):
    """Two-bone IK baked into the pose: <side>ForeArm's tail (the wrist) onto `target` (armature space). The elbow
    bends in the plane the pose spec already gives it."""
    arm = bpy.data.objects[ROOT]
    pbs = arm.pose.bones
    up, fa = pbs[side + 'Arm'], pbs[side + 'ForeArm']
    emp = bpy.data.objects.new('_reach', None)
    bpy.context.scene.collection.objects.link(emp)
    emp.location = arm.matrix_world @ target
    c = fa.constraints.new('IK')
    c.target, c.chain_count = emp, 2
    bpy.context.view_layer.update()
    mu, mf = up.matrix.copy(), fa.matrix.copy()
    fa.constraints.remove(c)
    bpy.data.objects.remove(emp)
    bpy.context.view_layer.update()
    up.matrix = mu
    bpy.context.view_layer.update()
    fa.matrix = mf
    bpy.context.view_layer.update()


def _key(pose_name):
    """The key pose behind a clip frame ('gun_draw.2' -> its key; interpolated clips: the nearest key)."""
    if '.' not in pose_name:
        return pose_name
    clip, i = pose_name.split('.')
    A, i = ANIMS[clip], int(i)
    keys = A['keys']
    if A.get('tween'):
        return keys[int(round(A['tween'][i])) % len(keys)]
    if not A.get('interp'):
        return keys[i]
    n = len(keys)
    t = i / A['frames'] * n if A.get('loop') else i / max(1, A['frames'] - 1) * (n - 1)
    return keys[int(round(t)) % n]


def _carried(bone, p):
    """A rest-space point as the posed bone carries it (armature space)."""
    arm = bpy.data.objects[ROOT]
    return arm.pose.bones[bone].matrix @ arm.data.bones[bone].matrix_local.inverted() @ p


def _gun_hold(pose_name):
    """First the pose's wrist targets (REACH: a hand on the holstered grip, at the hat brim, the muzzle at the mouth).
    In the hand (gun poses): the gun along the forearm's heading with its top up, its pitch mostly levelled out (LEVEL:
    the wrist keeps a revolver near level while the forearm swings up or down; FOLLOW keys keep the forearm's pitch),
    spun about the trigger finger (twirl, the recoil's flip, muzzle up to blow), then the left hand onto the gun
    (LEFT_TO_GUN). Otherwise: in the holster, following the right thigh."""
    if 'g' not in GUN:
        return
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    Mr = bones['GunHold0'].matrix_local
    key = _key(pose_name)
    for side, bone, fn in REACH.get(key, ()):
        _reach(side, _carried(bone, fn()))
    if key.startswith(GUN_POSES):
        fa, hd = pbs['RightForeArm'], pbs['RightHand']
        d = (fa.tail - fa.head).normalized()
        if not key.startswith(FOLLOW) and Vector((d.x, d.y)).length > .25:
            p = math.asin(max(-1.0, min(1.0, d.z))) * LEVEL
            d = Vector((d.x, d.y, 0)).normalized() * math.cos(p) + Vector((0, 0, math.sin(p)))
        fist = hd.head + (hd.tail - hd.head) * .5
        up = Vector((0, 0, 1)) if abs(d.z) < .95 else Vector((0, -1, 0))
        R = _frame_rot(GUN['F'], GUN['U'], d, up)
        if GUN_SPIN.get(key):
            side = (R @ GUN['F']).cross(R @ GUN['U'])
            R = Matrix.Rotation(math.radians(GUN_SPIN[key]), 3, side) @ R
        pbs['GunHold0'].matrix = Matrix.Translation(fist) @ (R @ Mr.to_3x3()).to_4x4()
        if key in LEFT_TO_GUN:
            F, U = R @ GUN['F'], R @ GUN['U']
            f, u, sd = LEFT_TO_GUN[key]
            hammer = fist + U * .05 * GUN_GIRTH - F * .03 * GUN_LEN
            bpy.context.view_layer.update()
            _reach('Left', hammer + (F * f + U * u + F.cross(U) * sd) * PROP['height'] / 1.8)
    elif 'g' in HOLSTER:
        T = pbs['RightUpLeg'].matrix @ bones['RightUpLeg'].matrix_local.inverted()   # rest -> posed, for the thigh
        T3 = T.to_3x3()
        R = _frame_rot(GUN['F'], GUN['U'], (T3 @ HOLSTER['F']).normalized(), (T3 @ HOLSTER['U']).normalized())
        pbs['GunHold0'].matrix = Matrix.Translation(T @ HOLSTER['g']) @ (R @ Mr.to_3x3()).to_4x4()
    bpy.context.view_layer.update()


def _over_grip(dx, dy, dz):
    """REACH entry: the right wrist (dx, dy, dz) m from the holstered grip (0, .01, .07 closes the hand on it)."""
    return ('Right', 'RightUpLeg', lambda: HOLSTER['g'] + Vector((dx, dy, dz)) * PROP['height'] / 1.8)


def _head_point(side, x, y, f):
    """REACH entry: <side> wrist at a point on the head: x, y metres, at height f of the head (0 chin .. 1 crown)."""
    def fn():
        J = landmarks()
        return Vector((x * PROP['height'] / 1.8, y * PROP['height'] / 1.8, J['head'].z + f * (J['top'].z - J['head'].z)))
    return (side, 'Head', fn)


# ---------------------------------------------------------------- in-betweens --------------------------------------
# A clip made with _clip renders one frame per `tween` entry: a position on its keys (1.5 = halfway from the second key
# to the third), the frame being the blend of the two neighbouring keys' FINISHED poses (the spec, its twist, the IK
# reaches, the gun in the hand or the holster: every bone slerped, the gun's hold carried along). skeleton.py's own
# interp blends only the specs, so a reach or the gun would snap at the halfway frame. `play` (optional) is the order the
# game shows the rendered frames in and `ms` the time of each step (holds and back-and-forths without rendering a frame
# twice); `marks` name the frames the game's gun code starts or cuts at. All three go to poses.json (clips_meta).
def _clip(keys, tween, fps, loop=False, play=None, ms=None, marks=None):
    A = dict(keys=keys, tween=tween, frames=len(tween), fps=fps, loop=loop)
    A.update({k: v for k, v in (('play', play), ('ms', ms), ('marks', marks)) if v})
    return A


_pose_key = globals().get('_pose_key', pose)        # skeleton.py's pose(): a key (or a plain clip frame) as rendered
_clips_meta_plain = globals().get('_clips_meta_plain', clips_meta)
_FINISHED = {}


def _finished(key):
    """Every pose bone's basis in key `key` as rendered on its own, and its _air (cached: a key always renders alike)."""
    if key not in _FINISHED:
        _pose_key(key)
        _FINISHED[key] = ({pb.name: pb.matrix_basis.copy() for pb in bpy.data.objects[ROOT].pose.bones},
                          POSES[key].get('_air', 0))
    return _FINISHED[key]


def pose(name):
    """skeleton.py's pose(), plus the in-between frames of _clip clips."""
    clip, _, i = name.partition('.')
    A = ANIMS.get(clip) if i else None
    if not A or 'tween' not in A:
        return _pose_key(name)
    keys, n, t = A['keys'], len(A['keys']), A['tween'][int(i)]
    a, f = int(t), t - int(t)
    b = (a + 1) % n if A.get('loop') else min(a + 1, n - 1)
    a %= n
    (Ba, air_a), (Bb, air_b) = _finished(keys[a]), _finished(keys[b])
    arm = bpy.data.objects[ROOT]
    rz = arm.rotation_euler.z
    arm.rotation_euler.z = 0
    arm.location = (0, 0, 0)
    for pb in arm.pose.bones:
        ma, mb = Ba[pb.name], Bb[pb.name]
        q = ma.to_quaternion().slerp(mb.to_quaternion(), f)
        pb.matrix_basis = Matrix.Translation(ma.translation.lerp(mb.translation, f)) @ q.to_matrix().to_4x4()
    bpy.context.view_layer.update()
    zmin = _snap(name, air_a * (1 - f) + air_b * f)
    arm.rotation_euler.z = rz
    bpy.context.view_layer.update()
    return zmin


def clips_meta():
    out = _clips_meta_plain()
    for c, m in out.items():
        m.update({k: ANIMS[c][k] for k in ('play', 'ms', 'marks', 'shift', 'travel', 'lie', 'side') if k in ANIMS[c]})
    return out


# ---------------------------------------------------------------- poses --------------------------------------------
# Rotations as in skeleton.py: about WORLD axes through the joint, parent first; explicit Right* specs are not
# mirrored (Right arm: Y- lowers it to the body, X- swings it forward and up, Z- turns it toward the character's right).
# The gunslinger stance is bladed: hips and feet turned `blade` deg to the character's left so the right shoulder
# leads, the head turned back to the facing. A gun pose's facing = where the gun points.
# Names: keys starting with GUN_POSES hold the gun in the hand. The game's clip set for a revolver atlas (next to the
# skeleton's locomotion, traversal and turn clips): gun_draw, gun_fire, gun_fan, gun_reload, gun_holster, gun_twirl,
# gaim_step_l/r, gaim_pivot_l/r, gun_aim (+ _m45.._p45 standing twists), gws_/grs_<delta>_<i> (aim on the move),
# gwr_/grr_<up|load|fetch>_<i> (reload on the move); the gunslinger's flourishes: gun_hipfire, gun_blow, duel_ready,
# hat_tip.
_BLADE = 25
_GLEGS = {'LeftUpLeg': [('X', -9), ('Y', -5)], 'LeftLeg': [('X', 10)],
          'RightUpLeg': [('X', 7), ('Y', 5)], 'RightLeg': [('X', 8)], 'RightFoot': [('Z', 10)]}
_GCROUCH = {'LeftUpLeg': [('X', -18), ('Y', -6)], 'LeftLeg': [('X', 28)], 'LeftFoot': [('X', -8)],
            'RightUpLeg': [('X', -6), ('Y', 6)], 'RightLeg': [('X', 24)], 'RightFoot': [('X', -10), ('Z', 10)]}
_GWIDE = {'LeftUpLeg': [('X', -10), ('Y', -13)], 'LeftLeg': [('X', 22)], 'LeftFoot': [('Y', 8)],
          'RightUpLeg': [('X', 2), ('Y', 13)], 'RightLeg': [('X', 20)], 'RightFoot': [('Y', -8), ('Z', 8)]}
_RL_LEGS = {'LeftUpLeg': [('X', -6), ('Y', -4)], 'LeftLeg': [('X', 8)], 'RightUpLeg': [('X', 4), ('Y', 4)], 'RightLeg': [('X', 6)]}
_LEFT_LOOSE = {'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 36), ('X', 8)], 'LeftForeArm': [('X', -22)], 'LeftHand': [('Y', 10)]}
_TWIST = lambda d: [('Spine', .4 * d), ('Spine1', .3 * d), ('Spine2', .3 * d)]   # an upper-body turn for _post


def _arm(y=-42, x=-72, fx=-4, sz=-6, z=0):
    """The right arm: lowered to the body (y), swung forward (x), forearm bent forward (fx), collarbone (sz), turn (z).
    The defaults hold the gun straight out along the facing, level at chest height (the game's AIM_H, 1.25 m)."""
    return {'RightShoulder': [('Z', sz)], 'RightArm': [('Y', y), ('X', x)] + ([('Z', z)] if z else []), 'RightForeArm': [('X', fx)]}


def _larm(y=40, x=-48, z=-38, fx=-55, hx=0):
    """The left arm reaching across to the gun: lowered (y), forward (x), across to the right (z), forearm (fx)."""
    return {'LeftShoulder': [('Z', -6)], 'LeftArm': [('Y', y), ('X', x), ('Z', z)], 'LeftForeArm': [('X', fx)],
            'LeftHand': [('X', hx)]}


_AIM_ARM = _arm()
_HIP_ARM = _arm(x=-8, fx=-80, sz=-2)     # the gun level at the hip


def _gpose(blade, *parts, legs=_GLEGS, lean=0):
    """A standing gun pose: the bladed stance, the loose left arm, then the given part specs (later ones win)."""
    spec = {'Hips': [('Z', blade)], 'Spine2': [('X', -2)], 'Neck': [('Z', -.6 * blade)], 'Head': [('Z', -.4 * blade)],
            **_LEFT_LOOSE, **legs}
    if lean:
        spec['Spine'] = [('X', lean)]
        spec['Neck'] = spec['Neck'] + [('X', -lean)]
    for p in parts:
        spec.update(p)
    return spec


def _upper(spec, blade):
    """The upper body of a standing gun pose, for use over other legs with _stable: no pelvis or legs; the stance's
    blade carried by the spine instead (the stable spine ignores the pelvis)."""
    out = {k: list(v) for k, v in spec.items() if k not in LEG_BONES and not k.startswith('_')}
    for b, f in (('Spine', .4), ('Spine1', .3), ('Spine2', .3)):
        out[b] = [('Z', f * blade)] + out.get(b, [])
    return out


def _on_legs(i, upper, clip='walk', delta=0.0):
    """Legs and pelvis from locomotion frame i of `clip` (the same ground data as the plain clip) under a held upper
    body, turned by `delta` (+ = toward the character's left)."""
    key = POSES[ANIMS[clip]['keys'][i]]
    spec = {k: v for k, v in expand(key).items() if k in LEG_BONES}
    spec.update({k: list(v) for k, v in upper.items()})
    if clip == 'run':   # the run's lean
        spec['Spine'] = spec.get('Spine', []) + [('X', 6)]
        spec['Neck'] = spec.get('Neck', []) + [('X', -6)]
    if delta:
        spec['_post'] = _TWIST(delta)
    spec['_stable'] = True
    if '_air' in key:
        spec['_air'] = key['_air']
    return spec


# aim: the arm straight out along the facing; standing twists of the upper body over the planted legs (facing = the
# legs, as the bow's aim_tw_*), so a standing aim turns in 11.25 deg steps before the feet re-plant (_gun_aim_set)
POSES['gun_aim'] = _gpose(_BLADE, _AIM_ARM)
AIM_TWISTS = (('m45', -45), ('m34', -33.75), ('m22', -22.5), ('m11', -11.25), ('p11', 11.25), ('p22', 22.5),
              ('p34', 33.75), ('p45', 45))
# ready idle (replaces the skeleton's idle in the western loadouts): the gun hand hangs loose over the holster
POSES['idle_in'] = {**POSES['idle_in'], **_arm(y=-38, x=6, fx=-26, sz=2), 'RightHand': [('X', -12)]}
POSES['idle_out'] = {**POSES['idle_out'], **_arm(y=-40, x=8, fx=-30, sz=3), 'RightHand': [('X', -16)]}
# quick draw: the hand on the holstered grip (crouched a little), the gun clearing the holster muzzle-forward,
# levelled at the hip, then straight out to the aim
POSES['gdraw_grab'] = _gpose(0, _arm(y=-47, x=30, fx=-50, sz=6), {'RightHand': [('X', -10)]}, legs=_GCROUCH, lean=4)
REACH['gdraw_grab'] = [_over_grip(0, .01, .07)]
POSES['gun_draw_lift'] = _gpose(8, _arm(y=-44, x=14, fx=-55, sz=2), legs=_GCROUCH, lean=4)
POSES['gun_draw_hip'] = _gpose(16, _HIP_ARM, lean=2)
ANIMS['gun_draw'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_draw_hip', 'gun_aim'], [0, .55, 1, 1.5, 2, 2.4, 2.75, 3], 32,
                          marks={'lift': 2, 'hip': 4})
# a shot: the muzzle flips up at the wrist and the shoulder rocks back a little, then settles over three frames
POSES['gun_recoil_a'] = _gpose(_BLADE, _arm(x=-77, fx=-8, sz=-10), {'Spine2': [('X', -6)], 'Head': [('Z', -10), ('X', -4)]})
POSES['gun_recoil_b'] = _gpose(_BLADE, _arm(x=-74, fx=-5, sz=-7), {'Spine2': [('X', -3)]})
GUN_SPIN.update({'gun_recoil_a': 26, 'gun_recoil_b': 9})
ANIMS['gun_fire'] = _clip(['gun_recoil_a', 'gun_recoil_b', 'gun_aim'], [0, .8, 1.45, 2], 24)
# fanning the hammer: the gun at the hip, the left palm sweeping back over the hammer for every shot
POSES['gun_fan_a'] = _gpose(-6, _arm(x=-12, fx=-88, sz=-2, z=14), _larm(x=-50, z=-34, fx=-70, hx=20), legs=_GCROUCH, lean=8)
POSES['gun_fan_b'] = _gpose(-6, _arm(x=-12, fx=-78, sz=-2, z=14), _larm(x=-40, z=-40, fx=-40), legs=_GCROUCH, lean=8)
LEFT_TO_GUN.update({'gun_fan_a': (-.02, .1, .02), 'gun_fan_b': (.08, .02, .05)})   # palm up over the hammer / swept past it
ANIMS['gun_fan'] = _clip(['gun_fan_a', 'gun_fan_b'], [0, .5, 1, 1.5], 28, loop=True, marks={'shot': 2})
ANIMS['gun_fan_out'] = _clip(['gun_fan_b', 'gun_aim'], [.3, .6, .85], 28)      # the cylinder empty: back up to the aim
# reload: the muzzle tipped up to drop the cases, then down to thumb in rounds one by one (the left hand fetching each
# from the belt), back to the hip. The game shows it by phase (marks: up, eject, the first fetch, then fetch <-> load
# per round over frames fetch..load, close)
POSES['gun_rl_up'] = _gpose(10, _arm(x=-28, fx=-118, sz=2, z=14), _larm(x=-46, z=-30, fx=-80), legs=_RL_LEGS, lean=4)
POSES['gun_rl_eject'] = _gpose(10, _arm(x=-30, fx=-134, sz=2, z=14), _larm(x=-50, z=-28, fx=-96), legs=_RL_LEGS, lean=4)
POSES['gun_rl_load'] = _gpose(10, _arm(x=-26, fx=-42, sz=2, z=18), _larm(x=-40, z=-40, fx=-62), legs=_RL_LEGS, lean=10)
POSES['gun_rl_fetch'] = _gpose(10, _arm(x=-26, fx=-42, sz=2, z=18),
                               {'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 38), ('X', -8)], 'LeftForeArm': [('X', -42)]},
                               legs=_RL_LEGS, lean=10)
LEFT_TO_GUN.update({'gun_rl_up': (.02, -.01, .07), 'gun_rl_eject': (.06, -.02, .06), 'gun_rl_load': (.0, .01, .07)})
ANIMS['gun_reload'] = _clip(['gun_aim', 'gun_rl_up', 'gun_rl_eject', 'gun_rl_fetch', 'gun_rl_load', 'gun_draw_hip'],
                            [.35, .7, 1, 1.5, 2, 2.33, 2.67, 3, 3.33, 3.67, 4, 4.5, 5], 12,
                            marks={'up': 0, 'eject': 3, 'first': 5, 'fetch': 7, 'load': 10, 'close': 11})
# twirl: the gun spun a full turn backward round the trigger finger at the hip, then up to the aim; holster: down from
# the aim, the turn, then dropped into the holster (gun_spin_4 = 360: the in-betweens turn the short way, forward)
for _i in range(5):
    POSES[f'gun_spin_{_i}'] = _gpose(4, _arm(x=-6, fx=-74, sz=0))
    GUN_SPIN[f'gun_spin_{_i}'] = 90 * _i
POSES['gholster'] = _gpose(0, _arm(y=-46, x=30, fx=-50, sz=4), {'RightHand': [('X', -10)]}, lean=2)
REACH['gholster'] = [_over_grip(0, .01, .07)]
ANIMS['gun_twirl'] = _clip([f'gun_spin_{i}' for i in range(5)] + ['gun_aim'], [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.4, 4.75], 32)
ANIMS['gun_holster'] = _clip(['gun_aim'] + [f'gun_spin_{i}' for i in range(5)] + ['gholster'],
                             [.4, .75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6], 32, marks={'hip': 2, 'in': 10})


# standing aim turns (the bow's aim_step / aim_pivot, gun in hand): facing = the TORSO (aim). Step: the legs start
# offset and re-plant under the aim; pivot: the torso leads with the gun tucked at the hip, the legs trail.
def _gstand(legs_off=0.0, torso_off=0.0, extra=None, up=None, lean=0.0, air=0.0, blade=_BLADE):
    spec = {'Hips': [('Z', blade + legs_off)] + ([('Y', lean)] if lean else []), **{k: list(v) for k, v in _GLEGS.items()},
            **{k: list(v) for k, v in (up or _upper(POSES['gun_aim'], _BLADE)).items()}}
    for k, v in (extra or {}).items():
        spec[k] = spec.get(k, []) + v
    spec['_stable'] = True
    if torso_off:
        spec['_post'] = _TWIST(torso_off)
    if air:
        spec['_air'] = air
    return spec


ANIMS['gaim_step_l'] = dict(keys=[f'gun_st_l{i}' for i in range(4)], frames=4, loop=False, fps=16)
ANIMS['gaim_step_r'] = dict(keys=[f'gun_st_r{i}' for i in range(4)], frames=4, loop=False, fps=16)
ANIMS['gaim_pivot_l'] = dict(keys=[f'gun_pv_l{i}' for i in range(3)], frames=3, loop=False, fps=24)
ANIMS['gaim_pivot_r'] = dict(keys=[f'gun_pv_r{i}' for i in range(3)], frames=3, loop=False, fps=24)

# on the move: the bladed aim held still over the stride, twisted by delta. One-handed, so both ways: out to the right
# up to 90 deg, across the body to the left up to 45 deg. Reloading on the move: three reload keys over the stride.
G_DELTAS = {'m90': -90, 'm67': -67.5, 'm45': -45, 'm22': -22.5, '0': 0, 'p22': 22.5, 'p45': 45}


def _gun_aim_set(blade, tucked):
    """The poses derived from POSES['gun_aim'] (its stance turned `blade` deg): the standing twists, the aim steps and
    pivots (`tucked` = the upper body of a quick pivot's first frames), aiming on the move (gws_ / grs_). A held item
    with its own aim (the coach gun) rebuilds them over its own gun_aim."""
    aim = POSES['gun_aim']
    up = _upper(aim, blade)
    for n, d in AIM_TWISTS:
        POSES[f'gun_aim_{n}'] = {**aim, '_post': _TWIST(d)}
    for i, (off, lg, ln) in enumerate(_STEP_L):          # skeleton.py's step table: legs offset, leg bends, lean
        POSES[f'gun_st_l{i}'] = _gstand(off, extra=lg, up=up, lean=ln, blade=blade)
        POSES[f'gun_st_r{i}'] = _gstand(-off, extra=_LR(lg), up=up, lean=-ln, blade=blade)
    for i, (lo, to, u, lg, air) in enumerate(_PIV):      # and its pivot table (_TUCK_UP = the bow pulled in)
        gu = tucked if u is _TUCK_UP else up
        POSES[f'gun_pv_l{i}'] = _gstand(lo, to, extra=lg, up=gu, air=air, blade=blade)
        POSES[f'gun_pv_r{i}'] = _gstand(-lo, -to, extra=lg, up=gu, air=air, blade=blade)
    for dn, d in G_DELTAS.items():
        for i in range(8):
            POSES[f'gws_{dn}_{i}'] = _on_legs(i, up, 'walk', d)
            POSES[f'grs_{dn}_{i}'] = _on_legs(i, up, 'run', d)


_gun_aim_set(_BLADE, _upper(POSES['gun_draw_hip'], 16))
for _rk in ('up', 'load', 'fetch'):
    _ru = _upper(POSES[f'gun_rl_{_rk}'], 10)
    for _i in range(8):
        for _g, _c in (('gwr', 'walk'), ('grr', 'run')):
            POSES[f'{_g}_{_rk}_{_i}'] = _on_legs(_i, _ru, _c)
            if f'gun_rl_{_rk}' in LEFT_TO_GUN:
                LEFT_TO_GUN[f'{_g}_{_rk}_{_i}'] = LEFT_TO_GUN[f'gun_rl_{_rk}']

# ---------------------------------------------------------------- the gunslinger's flourishes --------------------------
# hip shot leaning back: side-on, knees bent, the body tipped back, the gun level at the hip, the left arm flung back
_LEAN_BACK = {'Spine': [('X', -12)], 'Spine1': [('X', -6)], 'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', 12), ('X', 30)],
              'LeftForeArm': [('X', -24)], 'LeftHand': [('Y', 10)]}
POSES['gun_hip_lean'] = _gpose(32, _arm(x=-6, fx=-49, sz=-2), _LEAN_BACK, {'Neck': [('Z', -19), ('X', 14)], 'Head': [('Z', -13)]},
                               legs=_GCROUCH)
POSES['gun_hip_kick'] = _gpose(32, _arm(x=-8, fx=-66, sz=-6), _LEAN_BACK, {'Spine': [('X', -16)], 'Neck': [('Z', -19), ('X', 17)],
                                                                         'Head': [('Z', -13), ('X', -3)]}, legs=_GCROUCH)
POSES['gun_hip_mid'] = _gpose(32, _arm(x=-7, fx=-56, sz=-4), _LEAN_BACK, {'Spine': [('X', -14)], 'Neck': [('Z', -19), ('X', 15)],
                                                                        'Head': [('Z', -13)]}, legs=_GCROUCH)
ANIMS['gun_hipfire'] = _clip(['gun_hip_kick', 'gun_hip_mid', 'gun_hip_lean', 'gun_aim'], [0, 1, 1.5, 2, 2.35, 2.7], 24,
                             marks={'free': 3})   # (from `free` on, a press cuts the rise short with an aimed shot)
# blowing the smoke off the barrel: the gun comes up muzzle-high in front of the face, a blow, back down to the hip
POSES['gun_blow_up'] = _gpose(10, _arm(x=-40, fx=-100, sz=0, z=24), legs=_RL_LEGS)
POSES['gun_blow'] = _gpose(10, _arm(x=-30, fx=-120, sz=0, z=30), {'Neck': [('Z', -6), ('X', 8)], 'Head': [('Z', -4), ('X', 6)]},
                           legs=_RL_LEGS)
POSES['gun_blow_b'] = _gpose(10, _arm(x=-30, fx=-120, sz=0, z=30), {'Neck': [('Z', -6), ('X', 10)], 'Head': [('Z', -4), ('X', 10)]},
                             legs=_RL_LEGS)
GUN_SPIN.update({'gun_blow_up': 35, 'gun_blow': 65, 'gun_blow_b': 65})
REACH['gun_blow'] = [_head_point('Right', -.065, -.238, -.515)]   # the muzzle just in front of the lips (solved for the
REACH['gun_blow_b'] = [_head_point('Right', -.075, -.228, -.527)]  # GUN_LEN / GUN_GIRTH gun: same muzzle spot as life-size)
ANIMS['gun_blow'] = _clip(['gun_aim', 'gun_blow_up', 'gun_blow', 'gun_blow_b', 'gun_draw_hip'], [.5, 1, 1.5, 2, 3, 3.5, 4], 12,
                          play=[0, 1, 2, 3, 4, 3, 4, 3, 5, 6], ms=[70, 90, 90, 160, 110, 90, 110, 140, 80, 90],
                          marks={'puff0': 3, 'puff1': 4})
# showdown: wide crouched stance, the gun hand hovering over the holstered grip, twitching; the left hand out
_DUEL = {'Spine': [('X', 8)], 'Neck': [('X', -8)], 'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 24), ('X', 6)],
         'LeftForeArm': [('X', -16)]}
POSES['duel_a'] = _gpose(14, _arm(y=-40, x=16, fx=-40, sz=4), _DUEL, legs=_GWIDE)
POSES['duel_b'] = _gpose(14, _arm(y=-40, x=16, fx=-40, sz=4), _DUEL, legs=_GWIDE)
POSES['duel_c'] = _gpose(14, _arm(y=-40, x=16, fx=-40, sz=4), _DUEL, legs=_GWIDE)
REACH.update({'duel_a': [_over_grip(-.02, .0, .17)], 'duel_b': [_over_grip(-.01, .02, .13)], 'duel_c': [_over_grip(-.03, -.01, .18)]})
ANIMS['duel_ready'] = _clip(['duel_a', 'duel_b', 'duel_a', 'duel_c'], [0, .5, 1, 2.5, 3], 8, loop=True,
                            play=[0, 1, 2, 1, 0, 3, 4, 3], ms=[125] * 8)
# hat tip: the left hand up to the front of the brim, a small nod (the hat tips with the head). Built on the ready idle,
# whose right arm is explicit: expand() would otherwise mirror the raised left arm onto the right
POSES['hat_tip_0'] = {**POSES['idle_in'], 'LeftArm': [('Y', 20), ('X', -40)], 'LeftForeArm': [('X', -70)]}
POSES['hat_tip_1'] = {**POSES['idle_in'], 'LeftArm': [('Y', 10), ('X', -55)], 'LeftForeArm': [('X', -110)]}
POSES['hat_tip_2'] = {**POSES['hat_tip_1'], 'Neck': [('X', 14)], 'Head': [('X', 8)]}
REACH.update({'hat_tip_1': [_head_point('Left', .06, -.27, .6)], 'hat_tip_2': [_head_point('Left', .06, -.27, .6)]})
ANIMS['hat_tip'] = _clip(['idle_in', 'hat_tip_0', 'hat_tip_1', 'hat_tip_2'], [.5, 1, 1.5, 2, 2.5, 3], 12,
                         play=[0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0], ms=[70, 70, 80, 80, 90, 280, 90, 80, 80, 70, 70])
GUNSLINGER_CLIPS = ('gun_hipfire', 'gun_blow', 'duel_ready', 'hat_tip')


# ================================================================ the bandits and the sheriff ========================
# Enemies: the masked bandit (revolver, the gun move set unchanged) and the bruiser (a coach gun held two-handed: the
# same clip names, its own arm placements, see LONG GUN). The ally: the sheriff. Enemies wear grubby, desaturated
# earth colours and one accent, the gang's mask ('mask'); the sheriff clean, light and blue with a tin star.
PIXEL_FAMILIES.update({
    'dustfelt': ['aea690', '847c6a', '5e584a', '26221a'],   # the bandit's slouch hat: sun-faded grey-tan felt
    'grubby': ['c6ac74', '9e8654', '725e3a', '2c2416'],     # his shirt: dirty ochre
    'hide': ['86705c', '62503e', '46382c', '1c1410'],       # his vest: worn suede
    'drab': ['8e8e78', '6a6a56', '4c4c3e', '1e1e18'],       # grey-olive canvas: his trousers, the bruiser's coat
    'mask': ['5eaaa4', '3c8282', '2a5e62', '0e282c'],       # the gang's masks: the enemies' one accent (faded teal)
    'creamfelt': ['f4ecda', 'dacfb4', 'b0a286', '4e4636'],  # the sheriff's hat
    'chambray': ['b8cce0', '90a8c4', '6a82a0', '262e40'],   # his shirt
    'navy': ['5c6c90', '404c6e', '2e3650', '10141e'],       # his vest
    'khaki': ['c4b28c', '9c8a68', '74664a', '2e281c'],      # his trousers
    'tin': ['fafaf6', 'd6dade', '9ca4ae', '3a3e48'],        # the star, the nickel revolver
})


def _tilt(names, deg, pivot):
    """Rock built parts about the front-back axis through `pivot` (+deg: the character's left side goes down)."""
    R = Matrix.Rotation(math.radians(deg), 3, 'Y')
    for nm in names:
        for v in bpy.data.objects[nm].data.vertices:
            v.co = pivot + R @ (v.co - pivot)


def _star(name, bone, centre, r_out, r_in, thick, points=5):
    """A flat star facing -Y (the character's front), bound to `bone`: two fans (front, back) and the rim."""
    bm = bmesh.new()
    rings = []
    for side in (-1, 1):
        c = bm.verts.new(centre + Vector((0, side * thick / 2, 0)))
        rim = []
        for i in range(2 * points):
            a = math.pi / 2 + math.pi * i / points
            r = r_out if i % 2 == 0 else r_in
            rim.append(bm.verts.new(centre + Vector((math.cos(a) * r, side * thick / 2, math.sin(a) * r))))
        rings.append((c, rim))
    n = 2 * points
    for c, rim in rings:
        for i in range(n):
            bm.faces.new((c, rim[i], rim[(i + 1) % n]))
    (_, f), (_, b) = rings
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], b[i], b[j], f[j]))
    return _bind(name, bm, bone)


def _boxes(name, bone, items):
    """Small boxes in one object (cartridges in belt loops): items = [(centre, x half, y half, z half)]."""
    bm = bmesh.new()
    for c, hx, hy, hz in items:
        vs = [bm.verts.new(c + Vector((sx * hx, sy * hy, sz * hz))) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        for q in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            bm.faces.new([vs[k] for k in q])
    return _bind(name, bm, bone)


# ---------------------------------------------------------------- hats ---------------------------------------------
@garment('slouch_hat', 'hat', ['human_small'], hides=['HairFringe'],
         pixel={'HatCrown': ['hat', 'dustfelt', {'bias': .05}], 'HatBand': ['hatband', 'leather', {'bias': -.3}],
                'HatBrim': ['brim', 'dustfelt', {}]})
def _slouch_hat():
    """The bandit's battered slouch hat: a low, round, dented crown; a wide floppy brim drooping at the back and on
    the left, cocked up on the right, level at the front (the eyes must show between it and the mask); the whole hat
    knocked askew."""
    P, s, J, z = _ctx()
    _hat([(.68, .012, .232, .244), (.76, .012, .236, .248), (.9, .012, .226, .238), (1.0, .012, .2, .212),
          (1.05, .012, .15, .16), (1.07, .012, .07, .08)],
         (.4, .36), lambda ux, uy, t: t * t * (-.07 * max(0, uy) ** 2 - .05 * max(0, ux) ** 2 + .07 * max(0, -ux) ** 3
                                                + .012 * max(0, -uy)), crease=.03)
    c, hh = z('head'), z('top') - z('head')
    _tilt(('HatCrown', 'HatBand', 'HatBrim'), 6, Vector((0, .012 * s, c + .69 * hh)))


@garment('derby', 'hat', ['human_small'], hides=['HairFringe'],
         pixel={'HatCrown': ['hat', 'blackfelt', {'bias': .08}], 'HatBand': ['hatband', 'charcoal', {'bias': -.2}],
                'HatBrim': ['brim', 'blackfelt', {}]})
def _derby():
    """The bruiser's derby (bowler): a round dome crown, a short brim rolled up at the sides."""
    _hat([(.68, .012, .232, .244), (.74, .012, .235, .247), (.88, .012, .232, .244), (1.0, .012, .208, .22),
          (1.08, .012, .165, .175), (1.13, .012, .09, .1)],
         (.315, .295), lambda ux, uy, t: t * t * (.05 * ux * ux + .015 * uy * uy), crease=0)


@garment('sheriff_hat', 'hat', ['human_small'], hides=['HairFringe'],
         pixel={'HatCrown': ['hat', 'creamfelt', {'bias': .02}], 'HatBand': ['hatband', 'leather', {'bias': -.25}],
                'HatBrim': ['brim', 'creamfelt', {}]})
def _sheriff_hat():
    """A clean, light cattleman: a taller creased crown than the gunslinger's, a dark band, the brim curled at the
    sides."""
    _hat([(.68, .012, .232, .244), (.76, .012, .233, .245), (.96, .012, .226, .238), (1.14, .012, .214, .228),
          (1.21, .012, .19, .205), (1.24, .012, .1, .12)],
         (.37, .32), lambda ux, uy, t: .08 * t * t * ux ** 4, crease=.05)


# ---------------------------------------------------------------- head, face, neck ---------------------------------
@garment('hair_tache', 'head', ['human_small'],
         pixel={**GARMENTS['hair_mop']['pixel'], 'Moustache': ['tache', 'hair', {'bias': -.1}]})
def _hair_tache():
    """The mop and a full horseshoe moustache under the nose (in the hair's colours), its ends drooping past the
    mouth: ~4 px wide and over 1 px tall, so the 1x face reads as moustached; it sits low enough (f .22 of the head)
    that a pixel of skin stays between it and the eyes at the 20 deg camera."""
    _hair_mop()
    P, s, J, z = _ctx()
    c, hh = z('head'), z('top') - z('head')
    pts = [(-.1, -.15, .1), (-.094, -.178, .17), (-.05, -.198, .215), (0, -.203, .22), (.05, -.198, .215),
           (.094, -.178, .17), (.1, -.15, .1)]
    loft('Moustache', 'Head', [(x * s, y * s, c + f * hh) for x, y, f in pts], [(.026 * s, .016 * s)] * len(pts),
         side=(0, 0, 1), n=6, p=2.0)


@garment('hair_bandido', 'head', ['human_small'], hides=['HairNape'],
         pixel={**GARMENTS['hair_mop']['pixel'], 'HairBack': ['hair', 'hair', {}], 'Moustache': ['tache', 'hair', {'bias': -.15}]})
def _hair_bandido():
    """The outlaw's: the mop grown long at the back and sides, down to the collar (it shows under the sombrero's brim
    from behind and beside), and a thick moustache whose ends droop past the corners of the mouth toward the jaw
    (heavier than the sheriff's horseshoe, so the two read apart at 1x)."""
    _hair_mop()
    P, s, J, z = _ctx()
    c, hh = z('head'), z('top') - z('head')
    loft('HairBack', 'Head', [(0, .1 * s, c + .3 * hh), (0, .11 * s, c + .1 * hh), (0, .1 * s, c - .04 * hh), (0, .09 * s, c - .1 * hh)],
         [(.19 * s, .1 * s), (.18 * s, .085 * s), (.16 * s, .07 * s), (.13 * s, .055 * s)], n=8, p=2.4)
    from mathutils.bvhtree import BVHTree
    hd = bpy.data.objects['Head'].data
    face = BVHTree.FromPolygons([v.co.copy() for v in hd.vertices], [tuple(p.vertices) for p in hd.polygons])

    def on_face(x, f, out):   # `out` m in front of the face at x (m), height f of the head: the moustache hugs the jaw
        hit = face.ray_cast(Vector((x * s, -1, c + f * hh)), Vector((0, 1, 0)))[0]
        return hit - Vector((0, out * s, 0)) if hit else Vector((x * s, -.2 * s, c + f * hh))
    pts = [(-.1, .07), (-.098, .13), (-.06, .2), (0, .222), (.06, .2), (.098, .13), (.1, .07)]
    loft('Moustache', 'Head', [on_face(x, f, .012) for x, f in pts], [(.028 * s, .018 * s)] * len(pts), side=(0, 0, 1), n=6, p=2.0)


@garment('bandit_mask', 'neck', ['human_small'], hides=['HairNape'],     # (the mask's back covers the nape tufts)
         pixel={'Mask': ['mask', 'mask', {}], 'MaskPoint': ['mask', 'mask', {'bias': -.06}],
                'MaskKnot': ['mask', 'mask', {'bias': -.1}]})
def _bandit_mask():
    """The bandits' signature: a bandana pulled up over the nose and mouth. It wraps the lower face from just under the
    eyes, hangs loose under the jaw, drops round the back to a knot under the hair, its point over the throat."""
    P, s, J, z = _ctx()
    c, hh = z('head'), z('top') - z('head')
    rows = [(.335, -.012, .2, .214), (.26, -.016, .197, .212), (.13, -.03, .182, .198), (.0, -.045, .152, .17)]
    ob = loft('Mask', 'Head', [(0, yc * s, c + f * hh) for f, yc, rx, ry in rows], [(rx * s, ry * s) for f, yc, rx, ry in rows],
              n=12, p=2.3)
    for v in ob.data.vertices:          # round the back it drops under the hair cap
        v.co.z -= .3 * max(0.0, v.co.y)
    loft('MaskPoint', 'Head', [(0, -.205 * s, c + .06 * hh), (0, -.195 * s, c - .1 * hh), (0, -.18 * s, c - .26 * hh)],
         [(.13 * s, .012 * s), (.075 * s, .012 * s), (.012 * s, .01 * s)], side=(1, 0, 0), n=4, p=2.0)
    loft('MaskKnot', 'Head', [(0, .19 * s, c + .2 * hh), (.005 * s, .215 * s, c + .12 * hh), (.02 * s, .2 * s, c - .08 * hh)],
         [(.042 * s, .03 * s), (.036 * s, .026 * s), (.012 * s, .01 * s)], n=6, p=2.0)


@garment('string_tie', 'neck', ['human_small'], pixel={'Tie': ['tie', 'char', {'thin': True}]})
def _string_tie():
    """The sheriff's string tie: a dark cord from the collar down the open V of the vest."""
    P, s, J, z = _ctx()
    n = z('neck')
    loft('Tie', 'Spine2', [(0, -.13 * s, n - .01 * s), (0, -.168 * s, n - .07 * s), (0, -.172 * s, z('spine2'))],
         [(.012 * s, .006 * s)] * 3, side=(1, 0, 0), n=4, p=2.0)


# ---------------------------------------------------------------- shirts, vests, coat ------------------------------
def _shirt_body(t):
    """The shirt's torso (as wardrobe.linen_shirt)."""
    P, s, J, z = _ctx()
    T = _torso(P, s, z)
    loft('ShirtHem', 'Hips', [(0, 0, z('hips') + .01 * s), (0, 0, z('spine'))], _grow(T['hip'][1][2:], t), p=2.6)
    loft('ShirtBelly', 'Spine', T['belly'][0], _grow(T['belly'][1], t), p=2.6)
    loft('ShirtRibs', 'Spine1', T['ribs'][0], _grow(T['ribs'][1], t), p=2.6)
    loft('ShirtChest', 'Spine2', T['chest'][0] + [(0, .01, z('neck') + .01 * s)],
         _grow(T['chest'][1], t) + [(.085 * s, .075 * s)], p=2.6)


def _shirt_pixel(fam):
    return {k: ['sleeve' if 'Sleeve' in k else 'shirt', fam, {}] for k in
            ('ShirtBelly', 'ShirtRibs', 'ShirtChest', 'ShirtHem', 'ShirtSleeveUp', 'ShirtSleeveLo')}


@garment('rolled_shirt', 'torso', ['human_small'], hides=['Belly', 'Ribs', 'Chest', 'UpperArm'],
         pixel=_shirt_pixel('grubby'))
def _rolled_shirt():
    """The bandit's grubby work shirt, its sleeves rolled to mid-forearm: the bare forearms show below the roll."""
    P, s, J, z = _ctx()
    t = .012 * s
    _shirt_body(t)
    for sd in 'LR':
        _sleeve('ShirtSleeve', sd, J, s, t, upper=(0, 1), lower=(0, .5), cuff=.024 * s)


@garment('chambray_shirt', 'torso', ['human_small'], hides=['Belly', 'Ribs', 'Chest', 'UpperArm', 'ForeArm'],
         pixel=_shirt_pixel('chambray'))
def _chambray_shirt():
    """The sheriff's pale blue shirt (the linen shirt's cut)."""
    _linen_shirt()


@garment('ragged_vest', 'outer', ['human_small'],
         pixel={'VestBelly': ['vest', 'hide', {}], 'VestRibs': ['vest', 'hide', {}], 'VestChest': ['vest', 'hide', {}],
                'VestOpen': ['shirt', 'grubby', {'thin': True}]})
def _ragged_vest():
    """A worn suede vest hanging open (a wide V of shirt down the front), longer than the shirt's waist, its hem torn
    into points below the belt."""
    P, s, J, z = _ctx()
    T, t = _torso(P, s, z), .024 * s
    hip = T['hip'][1][2]
    ob = loft('VestBelly', 'Spine', [(0, .005, z('hips') - .06 * s), (0, .005, z('spine')), (0, .005, z('spine1'))],
              _grow([(hip[0] + .006 * s, hip[1] + .004 * s)] + T['belly'][1], t), n=12, p=2.6)
    for i in range(0, 12, 2):           # torn hem: every other point of the bottom ring (the loft's first) hangs lower
        ob.data.vertices[i].co.z -= .045 * s
    loft('VestRibs', 'Spine1', T['ribs'][0], _grow(T['ribs'][1], t), p=2.6)
    loft('VestChest', 'Spine2', T['chest'][0] + [(0, .01, z('neck') - .01 * s)],
         _grow(T['chest'][1], t) + [(.105 * s, .095 * s)], p=2.6)
    pts, rad = [], []
    for zz, ry, w in ((z('neck') - .02 * s, .12, .07), (z('spine2') + .03 * s, .135, .055), (z('spine1') + .03 * s, .12, .035),
                      (z('spine1') - .04 * s, .113, .02)):
        pts.append((0, -(ry * s + t + .004 * s), zz)); rad.append((w * s, .004 * s))
    loft('VestOpen', 'Spine2', pts, rad, side=(1, 0, 0), n=4, p=2.0)


@garment('lawman_vest', 'outer', ['human_small'],
         pixel={'VestBelly': ['vest', 'navy', {}], 'VestRibs': ['vest', 'navy', {}], 'VestChest': ['vest', 'navy', {}],
                'VestOpen': ['shirt', 'chambray', {'thin': True}], 'Star': ['star', 'tin', {'bias': .3}]})
def _lawman_vest():
    """The sheriff's dark blue vest (the wool vest's cut) with the tin star on the left breast, sized up (12 cm across,
    ~4 px) so it reads at 1x as the brightest spot on the figure."""
    _wool_vest()
    P, s, J, z = _ctx()
    _star('Star', 'Spine2', Vector((.1 * s, -.168 * s, z('spine2') + .03 * s)), .062 * s, .027 * s, .014 * s)


@garment('heavy_coat', 'outer', ['human_small'], hides=['Belly', 'Ribs', 'Chest', 'UpperArm', 'ForeArm'],
         pixel={'CoatHip': ['coat', 'drab', {}], 'CoatBelly': ['coat', 'drab', {}], 'CoatRibs': ['coat', 'drab', {}],
                'CoatChest': ['coat', 'drab', {}], 'CoatSkirt': ['skirt', 'drab', {'bias': -.06}],
                'CoatSleeveUp': ['csleeve', 'drab', {}], 'CoatSleeveLo': ['csleeve', 'drab', {}],
                'CoatCollar': ['collar', 'linen', {'bias': .05}], 'CoatCuff': ['cuff', 'linen', {}]})
def _heavy_coat():
    """The bruiser's heavy canvas coat to the hips, padded out (wider than deep: a bigger torso than the heroes'), a thick
    sheepskin collar standing round the neck, full sleeves with sheepskin cuffs; its skirt splits over each thigh."""
    P, s, J, z = _ctx()
    T = _torso(P, s, z)
    pad = lambda radii, tx, ty: [(r[0] + tx, r[1] + ty) for r in radii]   # padded out sideways more than front-back
    tx, ty = .085 * s, .06 * s
    loft('CoatHip', 'Hips', T['hip'][0][1:], pad(T['hip'][1][1:], tx + .01 * s, ty + .01 * s), p=2.6)
    loft('CoatBelly', 'Spine', T['belly'][0], pad(T['belly'][1], tx, ty), p=2.6)
    loft('CoatRibs', 'Spine1', T['ribs'][0], pad(T['ribs'][1], tx, ty), p=2.6)
    loft('CoatChest', 'Spine2', T['chest'][0] + [(0, .01, z('neck') - .01 * s)],
         pad(T['chest'][1], tx, ty) + [(.17 * s, .14 * s)], p=2.6)
    n = z('neck')
    loft('CoatCollar', 'Spine2', [(0, .015 * s, n - .07 * s), (0, .02 * s, n - .01 * s), (0, .03 * s, n + .05 * s)],
         [(.23 * s, .2 * s), (.21 * s, .185 * s), (.15 * s, .14 * s)], p=2.4)
    for sd, m in (('L', 'Left'), ('R', 'Right')):
        _sleeve('CoatSleeve', sd, J, s, .062 * s, upper=(0, 1), lower=(0, .86))
        el, wr = J['elbow' + sd], J['wrist' + sd]
        loft(f'CoatCuff.{sd}', f'{m}ForeArm', [el + (wr - el) * .78, el + (wr - el) * .97],
             [(.098 * s, .096 * s), (.09 * s, .088 * s)], side=(0, -1, 0))
        hp, kn = J['hip' + sd], J['knee' + sd]
        dl = (kn - hp).normalized()
        loft(f'CoatSkirt.{sd}', f'{m}UpLeg', [hp - dl * .06 * s, hp + (kn - hp) * .24],
             [(.135 * s, .145 * s), (.14 * s, .145 * s)], side=(0, -1, 0))


# ---------------------------------------------------------------- legs, belts ------------------------------------------
@garment('drab_trousers', 'legs', ['human_small'], hides=['Pelvis', 'Thigh', 'Shin'],
         pixel={'TrouserHip': ['trousers', 'drab', {}], 'TrouserThigh': ['trousers', 'drab', {}],
                'TrouserShin': ['trousers', 'drab', {}]})
def _drab_trousers():
    """The bandit's: grey-olive canvas, straight legs over the boots."""
    _trousers(over=True)


@garment('work_trousers', 'legs', ['human_small'], hides=['Pelvis', 'Thigh', 'Shin'],
         pixel={'TrouserHip': ['trousers', 'cloth', {}], 'TrouserThigh': ['trousers', 'cloth', {}],
                'TrouserShin': ['trousers', 'cloth', {}]})
def _work_trousers():
    """The bruiser's: brown wool, tucked into the boots."""
    _trousers()


@garment('khaki_trousers', 'legs', ['human_small'], hides=['Pelvis', 'Thigh', 'Shin'],
         pixel={'TrouserHip': ['trousers', 'khaki', {}], 'TrouserThigh': ['trousers', 'khaki', {}],
                'TrouserShin': ['trousers', 'khaki', {}]})
def _khaki_trousers():
    """The sheriff's: clean khaki, tucked into the boots."""
    _trousers()


@garment('shell_belt', 'belt', ['human_small'],
         pixel={'ShellBelt': ['gunbelt', 'leather', {'bias': -.12}], 'Buckle': ['buckle', 'brass', {'thin': True}],
                'Shells': ['shells', 'brass', {'thin': True, 'bias': .1}]})
def _shell_belt():
    """A wide cartridge belt over the coat (no holster: the coach gun never leaves the hand), a row of brass shotgun
    shells in its loops round the front."""
    P, s, J, z = _ctx()
    zc, rx, ry = z('hips') + .02 * s, .235 * s, .19 * s
    loft('ShellBelt', 'Hips', [(0, .005, zc - .03 * s), (0, .005, zc + .03 * s)], [(rx, ry), (rx * .99, ry * .99)], n=16, p=2.6)
    loft('Buckle', 'Hips', [(0, -(ry + .004 * s), zc), (0, -(ry + .014 * s), zc)], [(.026 * s, .022 * s)] * 2,
         side=(1, 0, 0), n=4, p=2.0)
    items = []
    for a in range(-80, 81, 13):
        if abs(a) < 10:
            continue                     # the buckle
        u = math.radians(a)
        x, y = math.sin(u), -math.cos(u)
        k = (abs(x) ** 2.6 + abs(y) ** 2.6) ** (1 / 2.6)    # onto the belt's superellipse
        items.append((Vector((rx * x / k * 1.04, .005 + ry * y / k * 1.06, zc)), .011 * s, .011 * s, .024 * s))
    _boxes('Shells', 'Hips', items)


# ---------------------------------------------------------------- revolvers ----------------------------------------
_REV_SOFT = ['GunGrip', 'GunFrame', 'GunGuard', 'GunCylinder', 'GunBarrel', 'GunRod']


@garment('iron_colt', 'hands', ['human_small'], soft=_REV_SOFT,
         pixel={'GunGrip': ['grip', 'walnut', {'thin': True}], 'GunFrame': ['gun', 'iron', {'thin': True}],
                'GunGuard': ['gun', 'iron', {'thin': True}], 'GunCylinder': ['gun', 'iron', {'thin': True, 'bias': .08}],
                'GunBarrel': ['barrel', 'iron', {'thin': True, 'bias': .1}], 'GunRod': ['barrel', 'iron', {'thin': True}]})
def _iron_colt():
    """The bandits': a plain iron revolver with a worn walnut grip and a shorter 5.5-inch barrel."""
    _revolver(barrel=.15, bore=.0085, bore_n=6, cyl=.048, rod=.6)


@garment('nickel_colt', 'hands', ['human_small'], soft=_REV_SOFT,
         pixel={'GunGrip': ['grip', 'char', {'thin': True}], 'GunFrame': ['gun', 'tin', {'thin': True}],
                'GunGuard': ['gun', 'tin', {'thin': True}], 'GunCylinder': ['gun', 'tin', {'thin': True, 'bias': .05}],
                'GunBarrel': ['barrel', 'tin', {'thin': True, 'bias': .05}], 'GunRod': ['barrel', 'tin', {'thin': True}]})
def _nickel_colt():
    """The sheriff's: nickel-plated, black grips, the long 7.5-inch barrel."""
    _revolver(barrel=.19, bore=.0085, bore_n=6, cyl=.048, rod=.6)


GUN_ITEMS = GUN_ITEMS + ('iron_colt', 'nickel_colt')


# ---------------------------------------------------------------- LONG GUN: the bruiser's coach gun ------------------
# A double-barrelled coach gun on the revolver's hold bone (GunHold0 on the right hand, GunMuzzle0 at the muzzle).
# Outside the gun poses it hangs from the right fist (no holster). In the gun poses it rides the CHEST (Spine2): the
# butt in the right shoulder pocket for the aim (stance turned LG_BLADE: the left shoulder leads, as a rifleman's),
# at the right hip for the draw; then the right fist IKs onto the grip and the left fist under the fore-end. So the
# muzzle points exactly where the torso puts it: the facing, plus the pose's twist (aim twists, aiming on the move).
# Wearing it re-poses the aiming keys (same names and clips as the revolver set: gun_aim + twists, gun_draw, gun_fire,
# steps, pivots, gws_ / grs_) for two hands, and the reload (gun_reload: break open, tip the spent shells out, two
# fresh shells fetched from the belt one by one, snap shut; gwr_ / grr_ on the move). Fan / twirl / holster keys are
# revolver moves (not re-posed).
LG_BLADE = -30          # the long-gun stance: hips and chest turned to the right
LG_HOLD = {}            # pose key -> (rest grip point, rest barrel axis F, rest top U, left hand on the gun?)
LG = {}                 # the coach gun's geometry (metres along F from the grip): fore-end centre; the belt's loops
LG_HINGE = (.095, .028)  # the break's hinge (metres along F, U from the grip): the front of the frame, under the barrels
LG_BREAK = {}           # pose key -> how far the barrels are broken open (deg)
LG_LEFT = {}            # pose key -> where the left fist goes instead of the fore-end: 'breech' (thumbing a shell in),
                        # 'belt' (fetching one from the shell belt)
LG_SHELL = set()        # pose keys with a fresh shell in the left fist


@garment('coach_gun', 'hands', ['human_small'],
         soft=['GunGrip', 'GunStock', 'GunFrame', 'GunBarrel', 'GunFore', 'GunShell'],
         pixel={'GunGrip': ['stock', 'walnut', {'thin': True}], 'GunStock': ['stock', 'walnut', {'bias': .05}],
                'GunFrame': ['gun', 'iron', {'thin': True}], 'GunBarrel': ['barrel', 'iron', {'thin': True, 'bias': .1}],
                'GunFore': ['stock', 'walnut', {'thin': True, 'bias': .1}],
                'GunShell': ['shells', 'brass', {'thin': True, 'bias': .15}]})
def _coach_gun():
    """A side-by-side double-barrel cut down to a coach gun: 47 cm barrels, a short walnut stock with a pistol grip
    (83 cm in all, ~25 px side-on: a long-gun silhouette), the fore-end under the barrels for the left hand. It breaks
    open: the barrels and fore-end swing down on a hinge at the front of the frame (GunBreak0); GunBreech0 marks the
    chambers. A fresh shell rides in the left fist (GunShell0), shown only while reloading."""
    P, s, J, z = _ctx()
    g, F, U = _hand_frame('R')
    S = F.cross(U)
    GUN.update(g=g, F=F, U=U)
    hold = add_chain('GunHold', 'RightHand', [g, g + F * .05 * s])[0]
    hinge = g + F * LG_HINGE[0] * s + U * LG_HINGE[1] * s
    brk = add_chain('GunBreak', hold, [hinge, hinge + F * .05 * s])[0]
    loft('GunGrip', hold, [g + F * .03 * s + U * .014 * s, g - F * .03 * s - U * .018 * s, g - F * .07 * s - U * .034 * s],
         [(.014 * s, .02 * s)] * 3, side=S, n=6, p=2.2)
    loft('GunStock', hold, [g - F * .06 * s - U * .03 * s, g - F * .16 * s - U * .045 * s, g - F * .27 * s - U * .06 * s],
         [(.016 * s, .026 * s), (.019 * s, .04 * s), (.021 * s, .052 * s)], side=S, n=6, p=2.2)
    loft('GunFrame', hold, [g + U * .028 * s - F * .005 * s, g + F * .1 * s + U * .034 * s], [(.022 * s, .024 * s), (.021 * s, .022 * s)],
         side=S, n=6, p=2.2)
    for k, sx in (('L', 1), ('R', -1)):
        b0 = g + F * .09 * s + U * .042 * s + S * sx * .012 * s
        loft(f'GunBarrel.{k}', brk, [b0, b0 + F * .47 * s], [(.0115 * s, .0115 * s)] * 2, side=S, n=6, p=2.0)
    loft('GunFore', brk, [g + F * .1 * s + U * .022 * s, g + F * .29 * s + U * .026 * s], [(.021 * s, .015 * s), (.019 * s, .013 * s)],
         side=S, n=6, p=2.2)
    mz = g + F * .56 * s + U * .042 * s
    add_chain('GunMuzzle', brk, [mz, mz + F * .02 * s])
    bc = g + F * .09 * s + U * .042 * s
    add_chain('GunBreech', brk, [bc, bc - F * .02 * s])
    gl, FL, UL = _hand_frame('L')                       # the shell pinched in the left fist, its end out past the thumb
    shell = add_chain('GunShell', 'LeftHand', [gl, gl + FL * .03 * s])[0]
    loft('GunShell', shell, [gl - UL * .01 * s, gl + UL * .06 * s], [(.013 * s, .013 * s)] * 2, side=FL, n=6, p=2.0)
    zc, rx, ry = z('hips') + .02 * s, .235 * s, .19 * s   # (as _shell_belt) the belt's loops at the left front
    LG.update(fore=.2, butt=(.27, .06), belt=Vector((rx * .62, -ry * .78 - .04 * s, zc)))
    _lg_install()


def _lg_frame(kind, blade, pitch=0.0):
    """A hold frame given in the FACING frame (the stance turned `blade` deg; x = the character's left, y = back),
    taken back to rest space: the chest's own turn by `blade` brings it to the facing. kind: 'shoulder' (the butt in the
    right shoulder pocket, barrel level at chest height), 'hip' (level at the right hip), 'low' (pointing down-forward)."""
    P, s, J, z = _ctx()
    Rp = Matrix.Rotation(math.radians(-pitch), 3, 'X')       # + pitch = muzzle up
    F, U = Rp @ Vector((0, -1, 0)), Rp @ Vector((0, 0, 1))
    if kind == 'shoulder':
        butt = Vector((-.2 * s, .05 * s, z('neck') - .07 * s))
        g = butt + F * LG['butt'][0] * s + U * LG['butt'][1] * s
    elif kind == 'hip':
        g = Vector((-.22 * s, -.2 * s, z('hips') + .16 * s))
    else:
        g = Vector((-.24 * s, -.1 * s, z('hips') + .06 * s))
    R = Matrix.Rotation(math.radians(-blade), 3, 'Z')
    return R @ g, R @ F, R @ U


def _lg_install():
    """The coach gun's aiming keys: a two-handed stance for the aim, the shot, the draw, rebuilt over the same pose
    names (and the derived twists, steps, pivots, aiming on the move), and where the gun rides in each."""
    LEGS = {'LeftUpLeg': [('X', -14), ('Y', -6)], 'LeftLeg': [('X', 12)], 'LeftFoot': [('Z', -6)],
            'RightUpLeg': [('X', 8), ('Y', 7)], 'RightLeg': [('X', 10)], 'RightFoot': [('Z', -12)]}
    ARMS = {'RightShoulder': [('Z', -4)], 'RightArm': [('Y', -22), ('X', -40)], 'RightForeArm': [('X', -85)],
            'LeftShoulder': [('Z', -10)], 'LeftArm': [('Y', 30), ('X', -55), ('Z', -25)], 'LeftForeArm': [('X', -35)]}
    LOW = {'RightShoulder': [('Z', 2)], 'RightArm': [('Y', -40), ('X', -8)], 'RightForeArm': [('X', -40)]}
    HIP = {'RightShoulder': [('Z', 2)], 'RightArm': [('Y', -38), ('X', 6)], 'RightForeArm': [('X', -80)],
           'LeftShoulder': [('Z', -6)], 'LeftArm': [('Y', 34), ('X', -40), ('Z', -30)], 'LeftForeArm': [('X', -60)]}
    cheek = {'Neck': [('Z', -.6 * LG_BLADE), ('X', 4)], 'Head': [('Z', -.4 * LG_BLADE), ('Y', 5)]}   # cheek toward the stock
    POSES['gun_aim'] = _gpose(LG_BLADE, ARMS, cheek, legs=LEGS)
    POSES['gun_recoil_a'] = _gpose(LG_BLADE, ARMS, cheek, {'Spine': [('X', -5)], 'Spine2': [('X', -9)],
                                                           'Head': [('Z', -.4 * LG_BLADE), ('X', -4)]}, legs=LEGS)
    POSES['gun_recoil_b'] = _gpose(LG_BLADE, ARMS, cheek, {'Spine': [('X', -2)], 'Spine2': [('X', -5)]}, legs=LEGS)
    POSES['gdraw_grab'] = _gpose(-8, LOW, legs=_GCROUCH, lean=6)
    POSES['gun_draw_lift'] = _gpose(-18, HIP, legs=_GCROUCH, lean=4)
    POSES['gun_draw_hip'] = _gpose(-24, HIP, legs=LEGS, lean=2)
    for k in ('gdraw_grab', 'gholster'):
        REACH.pop(k, None)               # no holster to reach for
    _gun_aim_set(LG_BLADE, _upper(POSES['gun_draw_hip'], -24))
    shoulder = _lg_frame('shoulder', LG_BLADE, -2)       # (the stance leans the chest back 2 deg: level the barrel)
    LG_HOLD.clear()
    LG_HOLD.update({k: shoulder + (True,) for k in POSES
                    if k == 'gun_aim' or k.startswith(('gun_aim_', 'gun_st_', 'gws_', 'grs_'))})
    for k in POSES:
        if k.startswith('gun_pv_'):
            tuck = _PIV[int(k[-1])][2] is _TUCK_UP
            LG_HOLD[k] = (_lg_frame('hip', -24) if tuck else shoulder) + (True,)
    LG_HOLD.update({'gun_recoil_a': _lg_frame('shoulder', LG_BLADE, 2) + (True,),
                    'gun_recoil_b': _lg_frame('shoulder', LG_BLADE, 0) + (True,),
                    'gdraw_grab': _lg_frame('low', -8, -40) + (False,),
                    'gun_draw_lift': _lg_frame('hip', -18, -14) + (True,),
                    'gun_draw_hip': _lg_frame('hip', -24) + (True,)})
    # reload: the gun at the right hip, head down over it. Open (the left hand pushes the barrels down), tip the muzzle
    # up so the spent shells slide out, fetch a shell from the belt / thumb it in, close (the barrels swing up shut on
    # the way to the hip hold). In-betweens as the revolver's reload (_clip: blends of the finished keys, the break and
    # the hands carried), the same marks for the game's phase logic (up, eject, first, fetch, load, close) and its
    # stretch per round; `dump` = the shells fall out. Two frames (load -> fetch, positions 6.33 / 6.67, an empty hand
    # going back to the belt) serve only the clip's own timeline: play / ms run the whole two-shell reload (an enemy
    # plays the clip as is) without rendering any frame twice.
    RL = -20
    look = {'Neck': [('Z', -.6 * RL), ('X', 12)], 'Head': [('Z', -.4 * RL), ('X', 8)]}
    fetch_arm = {'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 30), ('X', -14), ('Z', -10)], 'LeftForeArm': [('X', -60)]}
    POSES['gun_rl_up'] = _gpose(RL, HIP, look, legs=LEGS, lean=6)
    POSES['gun_rl_eject'] = _gpose(RL, HIP, look, {'RightForeArm': [('X', -96)]}, legs=LEGS, lean=4)
    POSES['gun_rl_fetch'] = _gpose(RL, HIP, look, fetch_arm, legs=LEGS, lean=8)
    POSES['gun_rl_load'] = _gpose(RL, HIP, look, legs=LEGS, lean=8)
    LG_HOLD.update({'gun_rl_up': _lg_frame('hip', RL, -12) + (True,), 'gun_rl_eject': _lg_frame('hip', RL, 60) + (True,),
                    'gun_rl_fetch': _lg_frame('hip', RL, -6) + (True,), 'gun_rl_load': _lg_frame('hip', RL, -6) + (True,)})
    LG_BREAK.clear(); LG_LEFT.clear(); LG_SHELL.clear()
    LG_BREAK.update({'gun_rl_up': 38, 'gun_rl_eject': 44, 'gun_rl_fetch': 40, 'gun_rl_load': 40})
    LG_LEFT.update({'gun_rl_fetch': 'belt', 'gun_rl_load': 'breech'})
    LG_SHELL.update({'gun_rl_fetch', 'gun_rl_load'})
    A = _clip(['gun_aim', 'gun_rl_up', 'gun_rl_eject', 'gun_rl_fetch', 'gun_rl_load', 'gun_draw_hip', 'gun_rl_load',
               'gun_rl_fetch'],
              [.35, .7, 1, 1.4, 1.7, 2, 2.33, 2.67, 3, 3.33, 3.67, 4, 6.33, 6.67, 4.5, 5], 12,
              play=[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 8, 9, 10, 11, 14, 15],
              ms=[70, 70, 130, 60, 60, 170, 60, 60, 120, 70, 70, 140, 70, 70, 120, 70, 70, 140, 80, 140],
              marks={'up': 0, 'eject': 3, 'dump': 5, 'first': 6, 'fetch': 8, 'load': 11, 'close': 14})
    A['shell'] = [(3, 4)]                # key positions with the fresh shell in the left fist (in-between frames)
    ANIMS['gun_reload'] = A
    # the draw: as the revolver's, one more in-between while the left hand comes up from hanging to the fore-end
    ANIMS['gun_draw'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_draw_hip', 'gun_aim'], [0, .35, .7, 1, 1.5, 2, 2.4, 2.75, 3],
                              32, marks={'lift': 3, 'hip': 5})
    for rk in ('up', 'load', 'fetch'):                 # reloading on the move: the same upper bodies over the stride
        ru = _upper(POSES[f'gun_rl_{rk}'], RL)
        for i in range(8):
            for gk, c in (('gwr', 'walk'), ('grr', 'run')):
                n = f'{gk}_{rk}_{i}'
                POSES[n] = _on_legs(i, ru, c)
                LG_HOLD[n] = LG_HOLD[f'gun_rl_{rk}']
                for d in (LG_BREAK, LG_LEFT):
                    if f'gun_rl_{rk}' in d:
                        d[n] = d[f'gun_rl_{rk}']
                if f'gun_rl_{rk}' in LG_SHELL:
                    LG_SHELL.add(n)
    # hits and a death's first jolt, two-handed: the coach gun rides the chest and kicks with it (+ the hold's pitch);
    # the falls after it in this stance; the long gun lands along the body, not across it (hits and deaths, below)
    POSES['gun_hitf_a'] = _gpose(LG_BLADE, ARMS, JOLT_F, _head(LG_BLADE, -6, -12), legs=HITF_LEGS)
    POSES['gun_hitf_b'] = _gpose(LG_BLADE, ARMS, {'Spine': [('X', 3)], 'Spine2': [('X', 1)]}, cheek, legs=LEGS)
    POSES['gun_hitb_a'] = _gpose(LG_BLADE, ARMS, JOLT_B, _head(LG_BLADE, -2, 10), legs=HITB_LEGS)
    POSES['gun_hitb_b'] = _gpose(LG_BLADE, ARMS, {'Spine': [('X', -3)], 'Spine2': [('X', -3)]}, cheek, legs=LEGS)
    POSES['gun_dieb_a'] = _gpose(LG_BLADE, ARMS, DIE_JOLT_B, _head(LG_BLADE, -14, -14), legs=DIEB_LEGS)
    POSES['gun_dief_a'] = _gpose(LG_BLADE, ARMS, DIE_JOLT_F, _head(LG_BLADE, -12, -16),
                                 {'Hips': [('Z', LG_BLADE), ('X', 4)], '_root': (0, -.06)}, legs=DIEF_LEGS)
    POSES['gun_dies_a'] = _gpose(LG_BLADE, ARMS, DIE_JOLT_S, _head(LG_BLADE, -6, -6, -14),
                                 {'Hips': [('Z', LG_BLADE + 8), ('Y', 6)], '_root': (.06, 0)}, legs=DIES_LEGS)
    LG_HOLD.update({k: _lg_frame('shoulder', LG_BLADE, p) + (True,) for k, p in
                    (('gun_hitf_a', 14), ('gun_hitf_b', -3), ('gun_hitb_a', -16), ('gun_hitb_b', 2),
                     ('gun_dieb_a', 24), ('gun_dief_a', -26), ('gun_dies_a', 8))})
    _fall_keys(LG_BLADE)
    POSES['dieb_b'].update({'LeftArm': [('Y', 16), ('X', -70), ('Z', -26)], 'LeftForeArm': [('X', -30)]})  # off the fore-end
    GUN_FREE.update({'dieb_b': ('at', (-.45, .05, 1.5), -20, 30), 'dieb_c': ('at', (-.6, .2, .9), -35, 8),
                     'dieb_d': ('ground', (-.6, .3), -6), 'dieb_e': ('ground', (-.62, .3), -8),
                     'dieb_f': ('ground', (-.62, .3), -8),
                     'dief_b': ('air', (-.1, -.18, -.12), -25, -45), 'dief_c': ('ground', (-.58, -.3), -12),
                     'dief_d': ('ground', (-.58, -.3), -12), 'dief_e': ('ground', (-.58, -.32), -13),
                     'dief_f': ('ground', (-.58, -.32), -13), 'dief_g': ('ground', (-.58, -.32), -13),
                     'dies_b': ('at', (.4, -.3, 1.2), 40, 20), 'dies_c': ('at', (.62, -.3, .6), 90, -10),
                     'dies_d': ('ground', (.7, -.3), 120), 'dies_e': ('ground', (.72, -.28), 124),
                     'dies_f': ('ground', (.72, -.28), 124)})


def _fist_to(side, p):
    """IK the <side> wrist so that the fist centre (mid-hand) lands on p (armature space)."""
    hd = bpy.data.objects[ROOT].pose.bones[side + 'Hand']
    _reach(side, p - (hd.tail - hd.head) * .5)


def _long_gun_hold(pose_name):
    """The coach gun in a gun pose: placed on the chest (LG_HOLD), the right fist onto the grip and the left fist under
    the fore-end (two IK passes: the wrist sits behind the fist along the hand), the gun set last (it is a child of the
    right hand), then the barrels broken open (LG_BREAK) about the hinge. Reloading, the left fist goes to the breech
    or the belt instead (LG_LEFT), a fresh shell in it (LG_SHELL; otherwise the shell is shrunk out of sight). Other
    poses: the gun stays in the right fist as built (hanging muzzle-down along the hand)."""
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    key = _key(pose_name)
    if 'GunShell0' in pbs:
        pbs['GunShell0'].scale = (1, 1, 1) if key in LG_SHELL else (.001, .001, .001)
        bpy.context.view_layer.update()
    h = LG_HOLD.get(key)
    if not h or 'g' not in GUN:
        return
    g0, F0, U0, left = h
    T = pbs['Spine2'].matrix @ bones['Spine2'].matrix_local.inverted()      # rest -> posed, for the chest
    g, F, U = T @ g0, (T.to_3x3() @ F0).normalized(), (T.to_3x3() @ U0).normalized()
    k = PROP['height'] / 1.8
    a = math.radians(LG_BREAK.get(key, 0.0))
    hinge = g + (F * LG_HINGE[0] + U * LG_HINGE[1]) * k
    Fb, Ub = F * math.cos(a) - U * math.sin(a), U * math.cos(a) + F * math.sin(a)      # the barrels' frame, broken
    on_gun = lambda f, u: hinge + (Fb * (f - LG_HINGE[0]) + Ub * (u - LG_HINGE[1])) * k  # a barrel-side point
    spot = LG_LEFT.get(key)
    for _ in range(2):
        _fist_to('Right', g)
        if spot == 'belt':
            _fist_to('Left', _carried('Hips', LG['belt']))
        elif spot == 'breech':     # behind the chambers and above them, the shell's tip at the breech
            _fist_to('Left', on_gun(.09, .042) - Fb * .045 * k + Ub * .05 * k)
        elif left:
            _fist_to('Left', on_gun(LG['fore'], -.02))
    R = _frame_rot(GUN['F'], GUN['U'], F, U)
    pbs['GunHold0'].matrix = Matrix.Translation(g) @ (R @ bones['GunHold0'].matrix_local.to_3x3()).to_4x4()
    bpy.context.view_layer.update()
    if a:                          # about the hinge's side axis: + would lift the muzzle, so the break is negative
        pb = pbs['GunBreak0']
        pb.matrix = Matrix.Translation(hinge) @ Matrix.Rotation(-a, 4, F.cross(U)) @ Matrix.Translation(-hinge) @ pb.matrix
        bpy.context.view_layer.update()


# ================================================================ hits and deaths (features/foes) ===================
# The foes' contract: hit_f (hit from the front: the torso jolts back, the head snaps, the gun arm flies up, back to the
# aim) and hit_b (from behind: a lurch forward, back to the aim), ~0.28 s, mark `back` = he can act again from there;
# die_b (shot from the front: thrown back, the knees buckle, down on his seat, the back slaps down) and die_f (from
# behind: arched, the knees buckle, onto his knees, then onto his front), each a crumple with a turn in it and a small
# rebound (_fall_keys), the gun out of the hand tumbling onto the ground beside him, the hat off (die_b: thrown off at
# the jolt; die_f: knocked off as his face lands), the last frame the corpse (held by the game); mark `ground` = the
# body slaps the ground (die_f also `knees`). Facing = where he faced when hit. Built on the aim (gun in hand) of each
# gun: the revolvers' keys here, the coach gun's in _lg_install.
#   _root (dx, dy) in a key: the whole body moved on the ground (m, his frame: x his left, y back; _foe_root).
#   GUN_FREE: the gun out of the hand in a key, placed in WORLD space after the key's ground snap (in the air: from the
#     posed right fist, or a spot in his frame; on the ground: a spot in his frame), and an in-between blends the two
#     keys' world placements (a blended basis would ride the moving hand). Gun parts are soft (no part in the ground
#     snap); while a death clip poses the hat and the arms are too: his body carries him, the arms lie on the ground.
#   HAT_FREE: the hat (its own bone, HatHold0, _hat) off the head the same way: a world placement per key (in the air,
#     or on the ground: its lowest point set on it), in-betweens blended; keys without one keep it on the head.
#   The corpse lies on the pivot: the game draws the whole death clip at the corpse's spot (every frame anchored at
#     the pivot) and finds that spot from the clip's root offset (the Hips in the first frame, E facing: how far he
#     stood from it along his facing), so every frame of a death clip is moved along his facing by the last frame's
#     body footprint centre (_fit_clip): the first frame stands off the pivot, the body ends centred on it.
#   The view: a death frame renders through pixel_rig's RENDER VIEW (render_view): the camera's pitch follows how far
#     down he is (`lie`, the hips -> head tilt, a running max: 0 standing .. 1 lying) from the atlas's 20 deg to
#     PITCH_GAME (41.08), heights kept at the atlas's px per metre, so a lying body is drawn in the game's own oblique
#     ground projection (src/main.js PPMY = PPM sin 55): it covers the ground it lies on, at the world's angle, seen
#     from above like the ground, not a 20 deg side-on sliver. The normals stay in the atlas camera's basis.
#   The canvas: lying along the view a body is ~45 px deep on screen and the canvas has 1 px under the pivot, so the
#     frames of a death clip are also moved UP THE SCREEN (the same for all 16 facings) by the whole px the worst facing
#     needs (each frame its own), a camera move (the view's `lift`: the depth pass keeps its range). Clip meta: `shift`
#     = that move per frame as m at the atlas pitch (px = shift * sin(20) / units_per_px, whole px): the game draws frame
#     i that many px lower to put the body where it lies; `lie` per frame (the game lays the sprite's depth and its sun
#     card down by it: gfx.js BATCH_VS); die_s, which ends off to his left, is centred across him too: `side` = how
#     far (m, + his left: the game moves the sprite that way); `travel` = the corpse's
#     centre from where he stood (m, behind him for die_b, in front for die_f; the game's fallback without bones).
FOE_CLIPS = ('hit_f', 'hit_b', 'die_b', 'die_f', 'die_s')
_CAM_YAW, _CAM_PITCH = math.radians(45), math.radians(20)            # pixel_rig's camera(yaw=45, pitch=20)
GUN_FREE = {}      # pose key -> ('air', (x, y, z) m from the right fist, yaw, pitch) | ('at', (x, y, z) m in his frame,
                   # yaw, pitch) | ('ground', (x, y) m, yaw)
GUN_Z = .022       # the grip point's height with the gun lying on its side (m, for a 1.8 m figure)
HAT_PARTS = ('HatCrown', 'HatBand', 'HatBrim')
HAT_FREE = {}      # pose key -> ('air', (x, y, z) m in his frame, tilt, heading, spin) | ('ground', (x, y) m, tilt, heading,
                   # spin) | ('byhead', (x, y) m from where his head lies, ...): the hat bone's head (the head's centre)
                   # there, the hat tipped `tilt` deg (+ toward his front) about the axis `heading` deg round from his
                   # left, spun `spin` about its crown first; on the ground its lowest point is set on it
FIT_MARGIN = 2.2   # px kept clear inside every canvas edge (1 for the outline pixelize adds, + a little)
PITCH_GAME = math.degrees(math.atan(math.sin(math.radians(55)) / math.cos(math.radians(20))))   # 41.08: the game's ground
_GUNW, _HATW, _SHIFT, _ROOT_OFF, _ARMS, _VIEW = {}, {}, {}, {}, [], {}


def _head(blade, nx, hx, hy=0):
    """Neck and head turned back to the facing (the bladed stance), bent nx / hx (+ forward), rolled hy."""
    return {'Neck': [('Z', -.6 * blade), ('X', nx)], 'Head': [('Z', -.4 * blade), ('X', hx)] + ([('Y', hy)] if hy else [])}


HITF_LEGS = {'LeftUpLeg': [('X', -16), ('Y', -5)], 'LeftLeg': [('X', 20)], 'RightUpLeg': [('X', 3), ('Y', 5)],
             'RightLeg': [('X', 16)], 'RightFoot': [('Z', 10)]}                    # weight thrown back, knees soft
HITB_LEGS = {'LeftUpLeg': [('X', -4), ('Y', -5)], 'LeftLeg': [('X', 22)], 'RightUpLeg': [('X', 10), ('Y', 5)],
             'RightLeg': [('X', 24)], 'RightFoot': [('Z', 10)]}                    # pitched forward, both knees bent
DIEB_LEGS = {'LeftUpLeg': [('X', -14), ('Y', -5)], 'LeftLeg': [('X', 28)], 'RightUpLeg': [('X', 2), ('Y', 5)],
             'RightLeg': [('X', 26)], 'RightFoot': [('Z', 10)]}                    # the knees start to give
DIEF_LEGS = {'LeftUpLeg': [('X', -2), ('Y', -5)], 'LeftLeg': [('X', 34)], 'RightUpLeg': [('X', 12), ('Y', 5)],
             'RightLeg': [('X', 30)], 'RightFoot': [('Z', 10)]}
JOLT_F = {'Spine': [('X', -7)], 'Spine1': [('X', -6)], 'Spine2': [('X', -9)]}
JOLT_B = {'Spine': [('X', 12)], 'Spine1': [('X', 8)], 'Spine2': [('X', 6)]}
DIE_JOLT_B = {'Spine': [('X', -12), ('Z', -8)], 'Spine1': [('X', -8), ('Z', -6)], 'Spine2': [('X', -12), ('Z', -5)]}  # thrown back, the gun shoulder knocked open
DIE_JOLT_F = {'Spine': [('X', -16), ('Z', 6)], 'Spine1': [('X', -11), ('Z', 4)], 'Spine2': [('X', -8)]}
DIE_JOLT_S = {'Spine': [('Y', 12), ('Z', 14)], 'Spine1': [('Y', 8), ('Z', 10)], 'Spine2': [('Y', 6), ('Z', 8)]}   # pushed over to his left, the spin begins up top
DIES_LEGS = {'LeftUpLeg': [('X', -10), ('Y', -10)], 'LeftLeg': [('X', 26)], 'RightUpLeg': [('X', 4), ('Y', 2)],
             'RightLeg': [('X', 22)], 'RightFoot': [('Z', 10)]}   # arched: the hit in the back drives the chest on, the shoulders back

# the revolvers: the gun hand flies up (a wrist flip, GUN_SPIN) or dips, the left arm flung
POSES['gun_hitf_a'] = _gpose(_BLADE, _arm(x=-92, fx=-22, sz=-12), JOLT_F, _head(_BLADE, -10, -12),
                             {'LeftShoulder': [('Z', 4)], 'LeftArm': [('Y', 22), ('X', 22)], 'LeftForeArm': [('X', -28)],
                              'LeftHand': [('Y', 10)]}, legs=HITF_LEGS)
POSES['gun_hitf_b'] = _gpose(_BLADE, _arm(x=-70, fx=-6, sz=-8), {'Spine': [('X', 3)], 'Spine2': [('X', 1)]},
                             _head(_BLADE, 3, 2))
POSES['gun_hitb_a'] = _gpose(_BLADE, _arm(x=-58, fx=-12, sz=-2), JOLT_B, _head(_BLADE, -4, 10),
                             {'LeftArm': [('Y', 30), ('X', -26)], 'LeftForeArm': [('X', -44)]}, legs=HITB_LEGS)
POSES['gun_hitb_b'] = _gpose(_BLADE, _arm(x=-77, fx=-4, sz=-9), {'Spine': [('X', -3)], 'Spine2': [('X', -3)]})
POSES['gun_dieb_a'] = _gpose(_BLADE, _arm(x=-104, fx=-34, sz=-14), DIE_JOLT_B, _head(_BLADE, -16, -14),
                             {'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', 14), ('X', -24)], 'LeftForeArm': [('X', -30)],
                              'LeftHand': [('Y', 10)]}, legs=DIEB_LEGS)
POSES['gun_dief_a'] = _gpose(_BLADE, _arm(y=-30, x=24, fx=-36, sz=-6), DIE_JOLT_F, _head(_BLADE, -14, -18),
                             {'Hips': [('Z', _BLADE), ('X', 5)], '_root': (0, -.08),
                              'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', 26), ('X', 30)], 'LeftForeArm': [('X', -34)]},
                             legs=DIEF_LEGS)
POSES['gun_dies_a'] = _gpose(_BLADE, _arm(y=-14, x=-60, fx=-50, sz=-6, z=34), DIE_JOLT_S, _head(_BLADE, -6, -6, -14),
                             {'Hips': [('Z', _BLADE + 8), ('Y', 6)], '_root': (.06, 0),
                              'LeftShoulder': [('Z', 8)], 'LeftArm': [('Y', -30), ('X', 10)], 'LeftForeArm': [('X', -30)]},
                             legs=DIES_LEGS)
GUN_SPIN.update({'gun_hitf_a': 28, 'gun_hitf_b': 6, 'gun_hitb_a': -14, 'gun_dieb_a': 45, 'gun_dief_a': -25, 'gun_dies_a': 30})


def _fall_keys(b):
    """The falls after the first jolt (the gun already out of the hand), for a stance turned b deg. A CRUMPLE, not a
    pivot: the knees go first and the hips drop (the snap keeps the feet down), the torso folds and lags, the head
    whips the other way, the arms fly on and then go slack; contact in stages (die_b: the seat, the back slapping down
    with the head snapping onto the ground, a small rebound, the settle; die_f: the knees, the chest and face, a
    rebound of the legs, the settle), and the body turns as it goes so the silhouette changes shape, not only its
    angle. Specs about world axes (skeleton.py): Hips X -90 = on his back, +90 = on his front; lying, Y rolls him about
    his length, a turn (Z) comes after the tip; lying arms sweep along the ground about Z and lift off it about Y."""
    # die_b: shot from the front, down on his back
    POSES['dieb_b'] = {'Hips': [('Z', .5 * b), ('X', -10)], '_root': (0, .1),                      # the knees buckle
                       'Spine': [('X', -6), ('Z', -6)], 'Spine1': [('X', -2)], 'Spine2': [('X', 2)],
                       'Neck': [('Z', -.3 * b), ('X', 16)], 'Head': [('Z', -.2 * b), ('X', 14)],   # the head lolls on after the snap back
                       'RightShoulder': [('Z', -10)], 'RightArm': [('Y', -18), ('X', -140)], 'RightForeArm': [('X', -40)],
                       'LeftShoulder': [('Z', 10)], 'LeftArm': [('Y', -24), ('X', -58)], 'LeftForeArm': [('X', -50)],
                       'LeftUpLeg': [('X', -40), ('Y', -8)], 'LeftLeg': [('X', 74)], 'LeftFoot': [('X', -16)],
                       'RightUpLeg': [('X', -30), ('Y', 6)], 'RightLeg': [('X', 62)], 'RightFoot': [('X', -14)]}
    POSES['dieb_c'] = {'Hips': [('Z', .1 * b), ('X', -44), ('Y', -8)], '_root': (0, .26),          # down on his seat
                       'Spine': [('X', 6)], 'Spine1': [('X', 4)], 'Spine2': [('X', 2)],
                       'Neck': [('X', 18)], 'Head': [('X', 12)],                                    # chin down: the head lags
                       'RightShoulder': [('Z', -6)], 'RightArm': [('Y', -30), ('X', -112)], 'RightForeArm': [('X', -30)],
                       'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', -36), ('X', -84)], 'LeftForeArm': [('X', -40)],
                       'LeftUpLeg': [('X', -74), ('Y', -12)], 'LeftLeg': [('X', 108)], 'LeftFoot': [('X', -12)],
                       'RightUpLeg': [('X', -62), ('Y', 12)], 'RightLeg': [('X', 96)], 'RightFoot': [('X', -14)]}
    POSES['dieb_d'] = {'Hips': [('X', -86), ('Y', 14), ('Z', -.3 * b)], '_root': (0, .3),          # the back slaps down: `ground`
                       'Spine': [('X', -4)], 'Spine1': [('X', -2)], 'Spine2': [('X', -2)],
                       'Neck': [('X', -8)], 'Head': [('X', -10), ('Y', 10)],                        # the head snaps back onto the ground
                       'RightShoulder': [('Z', -6)], 'RightArm': [('Y', 34), ('Z', -16)], 'RightForeArm': [('X', -50)],   # the arms still up
                       'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', -30), ('Z', 24)], 'LeftForeArm': [('X', -46)],
                       'LeftUpLeg': [('X', -40), ('Y', -10)], 'LeftLeg': [('X', 82)], 'LeftFoot': [('X', -10)],
                       'RightUpLeg': [('X', -30), ('Y', 16)], 'RightLeg': [('X', 66)], 'RightFoot': [('X', -10)]}
    POSES['dieb_e'] = {'Hips': [('X', -82), ('Y', 6), ('Z', -.5 * b)], '_root': (0, .3),           # the rebound
                       'Spine': [('X', 6)], 'Spine1': [('X', 4)],
                       'Neck': [('X', 12)], 'Head': [('X', 8), ('Y', 24)],                          # the head bounces, rolling aside
                       'RightArm': [('Y', 16), ('Z', -24)], 'RightForeArm': [('X', -20)],           # the arms slap down
                       'LeftArm': [('Y', -10), ('Z', 28)], 'LeftForeArm': [('X', -30)],
                       'LeftUpLeg': [('X', -26), ('Y', -30)], 'LeftLeg': [('X', 60)], 'LeftFoot': [('X', -10)],   # the knee falls out
                       'RightUpLeg': [('X', -10), ('Y', 12)], 'RightLeg': [('X', 24)], 'RightFoot': [('X', -8)]}  # the leg slides down
    POSES['dieb_f'] = {'Hips': [('X', -90), ('Y', 4), ('Z', -.6 * b)], '_root': (0, .3),           # the corpse
                       'Neck': [('X', 10)], 'Head': [('X', 6), ('Y', 40)],
                       'RightArm': [('Y', 4), ('Z', -50)], 'RightForeArm': [('Z', 30)],             # flung out past the shoulder
                       'LeftArm': [('Y', 2), ('Z', 20)], 'LeftForeArm': [('Z', -40)],               # bent, the hand on his belly
                       'LeftUpLeg': [('X', -14), ('Y', -60)], 'LeftLeg': [('X', 70)], 'LeftFoot': [('X', -10)],   # the knee fallen out
                       'RightUpLeg': [('X', -2), ('Y', 8)], 'RightLeg': [('X', 8)], 'RightFoot': [('Z', -20)]}
    # die_f: shot from behind, onto his knees, then onto his front
    POSES['dief_b'] = {'Hips': [('Z', .6 * b), ('X', 6)], '_root': (0, -.06),                      # the knees buckle
                       'Spine': [('X', 14), ('Z', 6)], 'Spine1': [('X', 10)], 'Spine2': [('X', 8)],
                       'Neck': [('Z', -.3 * b), ('X', 4)], 'Head': [('Z', -.2 * b), ('X', -6)],    # the head still back from the arch
                       'RightShoulder': [('Z', 6)], 'RightArm': [('Y', -30), ('X', 10)], 'RightForeArm': [('X', -20)],
                       'LeftShoulder': [('Z', -6)], 'LeftArm': [('Y', 30), ('X', 12)], 'LeftForeArm': [('X', -24)],
                       'LeftUpLeg': [('X', -24), ('Y', -6)], 'LeftLeg': [('X', 72)], 'LeftFoot': [('X', 12)],
                       'RightUpLeg': [('X', -14), ('Y', 6)], 'RightLeg': [('X', 66)], 'RightFoot': [('X', 12)]}
    POSES['dief_c'] = {'Hips': [('Z', .4 * b), ('X', 10), ('Y', 6)], '_root': (0, -.08),           # on his knees: `knees`
                       'Spine': [('X', 12)], 'Spine1': [('X', 10)], 'Spine2': [('X', 8)],
                       'Neck': [('X', 14)], 'Head': [('X', 16)],                                    # the head drops
                       'RightArm': [('Y', -40), ('X', -12)], 'RightForeArm': [('X', -10)],          # hanging
                       'LeftArm': [('Y', 38), ('X', -8)], 'LeftForeArm': [('X', -12)],
                       'LeftUpLeg': [('X', -8), ('Y', -5)], 'LeftLeg': [('X', 92)], 'LeftFoot': [('X', 40)],
                       'RightUpLeg': [('X', -2), ('Y', 5)], 'RightLeg': [('X', 90)], 'RightFoot': [('X', 40)]}
    POSES['dief_d'] = {'Hips': [('Z', .2 * b), ('X', 48), ('Y', -6)], '_root': (0, -.2),           # toppling
                       'Spine': [('X', 10)], 'Spine1': [('X', 4)],
                       'Neck': [('X', -6)], 'Head': [('X', -4)],                                    # the head trails
                       'RightArm': [('Y', -20), ('X', -40)], 'RightForeArm': [('X', -10)],          # limp, swinging on
                       'LeftArm': [('Y', 24), ('X', -50)], 'LeftForeArm': [('X', -16)],
                       'LeftUpLeg': [('X', -10), ('Y', -5)], 'LeftLeg': [('X', 60)], 'LeftFoot': [('X', 30)],
                       'RightUpLeg': [('X', -4), ('Y', 5)], 'RightLeg': [('X', 54)], 'RightFoot': [('X', 30)]}
    POSES['dief_e'] = {'Hips': [('X', 84), ('Y', -12), ('Z', -.2 * b)], '_root': (0, -.32),        # chest and face: `ground`
                       'Spine': [('X', 2)], 'Neck': [('X', -12)], 'Head': [('X', -8), ('Y', -50)],   # the face turns aside
                       'RightArm': [('Y', -8), ('Z', 10)], 'RightForeArm': [('X', -10)],
                       'LeftArm': [('Y', 12), ('Z', -30)], 'LeftForeArm': [('X', -20)],
                       'LeftUpLeg': [('X', 4), ('Y', -6)], 'LeftLeg': [('X', 30)], 'LeftFoot': [('X', 30)],
                       'RightUpLeg': [('X', 8), ('Y', 6)], 'RightLeg': [('X', 44)], 'RightFoot': [('X', 30)]}
    POSES['dief_f'] = {'Hips': [('X', 80), ('Y', -6), ('Z', -.3 * b)], '_root': (0, -.32),         # the rebound: a heel kicks up
                       'Neck': [('X', -10)], 'Head': [('X', -6), ('Y', -64)],
                       'RightArm': [('Y', -4), ('Z', 14)], 'RightForeArm': [('X', -6)],
                       'LeftArm': [('Y', 6), ('Z', -60)], 'LeftForeArm': [('Z', -30)],
                       'LeftUpLeg': [('X', 2), ('Y', -6)], 'LeftLeg': [('X', 20)], 'LeftFoot': [('X', 30)],
                       'RightUpLeg': [('X', 6), ('Y', 8)], 'RightLeg': [('X', 52)], 'RightFoot': [('X', 30)]}
    POSES['dief_g'] = {'Hips': [('X', 90), ('Y', -4), ('Z', -.4 * b)], '_root': (0, -.32),         # the corpse
                       'Neck': [('X', -8)], 'Head': [('X', -4), ('Y', -70)],
                       'RightArm': [('Z', -24), ('Y', -8), ('X', -9)], 'RightForeArm': [('Z', -6), ('X', -2)],   # by his side
                       'LeftArm': [('Z', -84), ('Y', 9), ('X', 7)], 'LeftForeArm': [('Z', -46), ('X', 4)],       # by his head
                       'LeftUpLeg': [('X', -2), ('Z', 28)], 'LeftLeg': [('X', 10), ('Z', -50)], 'LeftFoot': [('X', 40)],   # the knee drawn out
                       'RightUpLeg': [('X', 2), ('Y', 8)], 'RightLeg': [('X', 16)], 'RightFoot': [('X', 40)]}
    # die_s: shot from his right side: pushed away from the shot, he spins to his left (Hips Z +) as the knees go,
    # drops on his left knee, lands on his left side and rolls onto his front, turned round about 170 deg
    POSES['dies_b'] = {'Hips': [('X', 8), ('Y', 10), ('Z', b + 50)], '_root': (.12, -.02),          # spinning, the knees go
                       'Spine': [('X', 6), ('Z', 10)], 'Spine1': [('X', 4), ('Z', 6)], 'Spine2': [('X', 2)],
                       'Neck': [('Z', -.4 * b - 14), ('X', 6)], 'Head': [('Z', -.3 * b - 10), ('X', -4)],   # the head lags the spin
                       'RightShoulder': [('Z', -6)], 'RightArm': [('Y', 50), ('X', -20)], 'RightForeArm': [('X', -24)],   # flung out wide
                       'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', -46), ('X', 16)], 'LeftForeArm': [('X', -20)],
                       'LeftUpLeg': [('X', -34), ('Y', -10)], 'LeftLeg': [('X', 64)], 'LeftFoot': [('X', -10)],
                       'RightUpLeg': [('X', -14), ('Y', 8)], 'RightLeg': [('X', 46)], 'RightFoot': [('X', -6)]}
    POSES['dies_c'] = {'Hips': [('X', 18), ('Y', 24), ('Z', b + 110)], '_root': (.26, -.04),        # down on the left knee
                       'Spine': [('X', 10), ('Z', 8)], 'Spine1': [('X', 6)], 'Spine2': [('X', 4)],
                       'Neck': [('Z', -12), ('X', 10)], 'Head': [('Z', -8), ('X', 8)],
                       'RightArm': [('Y', 30), ('X', -40)], 'RightForeArm': [('X', -30)],                 # swinging round
                       'LeftArm': [('Y', 10), ('X', -30)], 'LeftForeArm': [('X', -20)],                   # reaching down
                       'LeftUpLeg': [('X', -40), ('Y', -6)], 'LeftLeg': [('X', 100)], 'LeftFoot': [('X', 30)],
                       'RightUpLeg': [('X', -2), ('Y', 16)], 'RightLeg': [('X', 30)], 'RightFoot': [('X', 10)]}
    POSES['dies_d'] = {'Hips': [('X', 72), ('Y', -34), ('Z', b + 150)], '_root': (.36, .02),        # on his left side: `ground`
                       'Spine': [('X', 4)], 'Neck': [('X', -8)], 'Head': [('X', -6), ('Y', -30)],
                       'RightArm': [('Y', 20), ('Z', 30)], 'RightForeArm': [('X', -30)],                  # still coming over
                       'LeftArm': [('Y', 14), ('Z', -40)], 'LeftForeArm': [('X', -10)],
                       'LeftUpLeg': [('X', -20), ('Y', -6)], 'LeftLeg': [('X', 60)], 'LeftFoot': [('X', 20)],
                       'RightUpLeg': [('X', 10), ('Y', 20)], 'RightLeg': [('X', 40)], 'RightFoot': [('X', 20)]}
    POSES['dies_e'] = {'Hips': [('X', 84), ('Y', -14), ('Z', b + 162)], '_root': (.38, .02),        # rolled onto his front
                       'Neck': [('X', -10)], 'Head': [('X', -6), ('Y', -56)],
                       'RightArm': [('Y', -4), ('Z', 44)], 'RightForeArm': [('Z', 30)],
                       'LeftArm': [('Y', 8), ('Z', -30)], 'LeftForeArm': [('X', -6)],
                       'LeftUpLeg': [('X', -10), ('Z', 24)], 'LeftLeg': [('X', 30), ('Z', -30)], 'LeftFoot': [('X', 30)],
                       'RightUpLeg': [('X', 6), ('Y', 10)], 'RightLeg': [('X', 50)], 'RightFoot': [('X', 30)]}
    POSES['dies_f'] = {'Hips': [('X', 90), ('Y', -6), ('Z', b + 168)], '_root': (.38, .02),         # the corpse
                       'Neck': [('X', -8)], 'Head': [('X', -4), ('Y', -66)],
                       'RightArm': [('Y', -6), ('Z', 60), ('X', -6)], 'RightForeArm': [('Z', 40), ('X', -2)],   # thrown up past his head
                       'LeftArm': [('Y', 9), ('Z', -20), ('X', 7)], 'LeftForeArm': [('Z', -10), ('X', 4)],     # by his side
                       'LeftUpLeg': [('X', -4), ('Z', 30)], 'LeftLeg': [('X', 10), ('Z', -46)], 'LeftFoot': [('X', 40)],
                       'RightUpLeg': [('X', 2), ('Y', 8)], 'RightLeg': [('X', 18)], 'RightFoot': [('X', 40)]}


_fall_keys(_BLADE)
GUN_FREE.update({'dieb_b': ('at', (-.55, .05, 1.84), -60, 70), 'dieb_c': ('at', (-.7, .2, 1.15), -150, -20),
                 'dieb_d': ('ground', (-.72, .1), -205), 'dieb_e': ('ground', (-.76, .06), -214),
                 'dieb_f': ('ground', (-.78, .05), -218),
                 'dief_b': ('air', (-.1, -.25, .22), -20, 40), 'dief_c': ('at', (-.42, -.6, .6), -80, -40),
                 'dief_d': ('ground', (-.6, -.72), -140), 'dief_e': ('ground', (-.62, -.76), -150),
                 'dief_f': ('ground', (-.63, -.78), -152), 'dief_g': ('ground', (-.63, -.78), -152),
                 'dies_b': ('at', (.5, -.3, 1.3), 60, 30), 'dies_c': ('at', (.8, -.25, .7), 140, -30),
                 'dies_d': ('ground', (.88, -.2), 190), 'dies_e': ('ground', (.92, -.18), 198),
                 'dies_f': ('ground', (.93, -.17), 200)})
# the hat off the head (HAT_FREE: placed in world space like a gun out of the hand, in-betweens blended): die_b's flies
# off up and back over his left shoulder at the jolt (tipping back, spinning: crown up enough that its dark inside
# never fills the frame), lands on the back of its brim by his head, rocks and settles flat, crown up; die_f's stays on until his face hits the ground, is knocked off to his right, lands tipped and falls
# over. Both land beside the head, not past it: a lying body already spans most of the canvas
HAT_FREE.update({'dieb_b': ('air', (.25, .5, 1.86), -35, 30, 60), 'dieb_c': ('air', (.48, .95, 1.15), -62, 40, 140),
                 'dieb_d': ('ground', (.55, 1.2), -55, 60, 190), 'dieb_e': ('ground', (.62, 1.28), -24, 80, 215),
                 'dieb_f': ('ground', (.66, 1.3), -5, 90, 228),
                 'dief_e': ('air', (-.3, -1.2, .3), 60, -60, 0), 'dief_f': ('ground', (-.42, -1.28), 36, -70, 20),
                 'dief_g': ('ground', (-.46, -1.3), 5, -80, 30),
                 'dies_b': ('air', (.45, .05, 1.58), 22, 90, 60), 'dies_c': ('air', (.85, .2, .95), 38, 100, 150),
                 'dies_d': ('byhead', (.4, .26), 40, 110, 220), 'dies_e': ('byhead', (.44, .3), 16, 120, 245),
                 'dies_f': ('byhead', (.45, .31), 4, 120, 255)})
ANIMS['hit_f'] = _clip(['gun_aim', 'gun_hitf_a', 'gun_hitf_b', 'gun_aim'], [1, 1.45, 1.9, 2.4, 2.8], 18,
                       ms=[65, 60, 65, 50, 50], marks={'back': 3})      # `back` at 0.19 s (TYPES' flinch .18-.2)
ANIMS['hit_b'] = _clip(['gun_aim', 'gun_hitb_a', 'gun_hitb_b', 'gun_aim'], [1, 1.45, 1.9, 2.4, 2.8], 18,
                       ms=[65, 60, 65, 50, 50], marks={'back': 3})
ANIMS['die_b'] = _clip(['gun_aim', 'gun_dieb_a', 'dieb_b', 'dieb_c', 'dieb_d', 'dieb_e', 'dieb_f'],
                       [1, 1.5, 2, 2.5, 3, 3.35, 3.7, 4, 5, 5.5, 6], 10,
                       ms=[90, 70, 70, 70, 80, 60, 50, 80, 90, 90, 450], marks={'ground': 7})
ANIMS['die_f'] = _clip(['gun_aim', 'gun_dief_a', 'dief_b', 'dief_c', 'dief_d', 'dief_e', 'dief_f', 'dief_g'],
                       [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 6.5, 7], 10,
                       ms=[90, 70, 70, 70, 120, 70, 60, 50, 80, 90, 90, 420], marks={'knees': 4, 'ground': 8})
ANIMS['die_s'] = _clip(['gun_aim', 'gun_dies_a', 'dies_b', 'dies_c', 'dies_d', 'dies_e', 'dies_f'],
                       [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 5.5, 6], 10,
                       ms=[90, 70, 70, 70, 90, 60, 80, 90, 90, 440], marks={'knees': 4, 'ground': 6})
for _c in FOE_CLIPS:
    ANIMS[_c]['foe'] = True
for _c in ('die_b', 'die_f', 'die_s'):
    ANIMS[_c]['fit'] = True
ANIMS['die_s']['fitx'] = True


def _foe_root(pose_name):
    """HOLD hook (first): a key's _root moves the whole body on the ground."""
    r = POSES.get(_key(pose_name), {}).get('_root')
    if r:
        k = PROP['height'] / 1.8
        hp = bpy.data.objects[ROOT].pose.bones['Hips']
        hp.matrix = Matrix.Translation((r[0] * k, r[1] * k, 0)) @ hp.matrix
        bpy.context.view_layer.update()


def _gun_place(spec, Wm, pbs):
    """The world matrix of GunHold0 for a GUN_FREE spec, in a posed and snapped key (Wm = the armature's world)."""
    k = PROP['height'] / 1.8
    hd = pbs['RightHand']
    fist = Wm @ (hd.head + (hd.tail - hd.head) * .5)

    def head(yaw, pitch=0.0):
        y, p = math.radians(yaw), math.radians(pitch)
        return Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    if spec[0] in ('air', 'at'):
        _, off, yaw, pitch = spec
        p, F = (fist if spec[0] == 'air' else Vector()) + Vector(off) * k, head(yaw, pitch)
        U = Vector((0, 0, 1)) if abs(F.z) < .9 else Vector((0, 1, 0))
    else:
        _, xy, yaw = spec
        p, F = Vector((xy[0] * k, xy[1] * k, GUN_Z * k)), head(yaw)
        U = Vector((-F.y, F.x, 0))                      # on its side: the top faces sideways
    R = _frame_rot(GUN['F'], GUN['U'], F, U)
    Mr = bpy.data.objects[ROOT].data.bones['GunHold0'].matrix_local.to_3x3()
    return Matrix.Translation(p) @ (R @ Mr).to_4x4()


def _gun_world(key):
    """The gun's world matrix in key `key` (posed on its own, snapped): its hook's (in the hand) or GUN_FREE's."""
    if key not in _GUNW:
        _pose_key(key)
        arm = bpy.data.objects[ROOT]
        pbs, Wm = arm.pose.bones, arm.matrix_world.copy()
        _GUNW[key] = _gun_place(GUN_FREE[key], Wm, pbs) if key in GUN_FREE else Wm @ pbs['GunHold0'].matrix
    return _GUNW[key]


def _hat_world(key):
    """The hat bone's world matrix in key `key` (posed on its own, snapped): on the head, or HAT_FREE's ('ground': its
    lowest vertex set on the ground, a hair above it)."""
    if key not in _HATW:
        _pose_key(key)
        arm = bpy.data.objects[ROOT]
        pbs = arm.pose.bones
        if key not in HAT_FREE:
            _HATW[key] = arm.matrix_world @ pbs['HatHold0'].matrix
            return _HATW[key]
        k = PROP['height'] / 1.8
        kind, p, tilt, head, spin = HAT_FREE[key]
        h = math.radians(head)
        axis = Vector((math.cos(h), math.sin(h), 0))          # heading 0: his left (+X): + tilt tips the crown toward his front
        R = Matrix.Rotation(math.radians(-tilt), 3, axis) @ Matrix.Rotation(math.radians(spin), 3, 'Z')
        Mr = arm.data.bones['HatHold0'].matrix_local
        if kind == 'byhead':                                   # on the ground, (x, y) m from where his head lies
            hd = arm.matrix_world @ pbs['Head'].head
            pos = Vector((hd.x + p[0] * k, hd.y + p[1] * k, 0.0))
        else:
            pos = Vector((p[0] * k, p[1] * k, p[2] * k if kind == 'air' else 0.0))
        M = Matrix.Translation(pos) @ (R @ Mr.to_3x3()).to_4x4()
        if kind in ('ground', 'byhead'):
            pbs['HatHold0'].matrix = arm.matrix_world.inverted() @ M
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            lo = 1e9
            for ob in bpy.data.collections[COL].objects:
                if ob.type == 'MESH' and not ob.hide_render and ob.name.split('.')[0] in HAT_PARTS:
                    oe = ob.evaluated_get(dg)
                    me = oe.to_mesh()
                    lo = min([lo] + [(oe.matrix_world @ v.co).z for v in me.vertices])
                    oe.to_mesh_clear()
            if lo < 1e8:
                M = Matrix.Translation((0, 0, .004 * k - lo)) @ M
        _HATW[key] = M
    return _HATW[key]


def _blend_bone(bone, Ga, Gb, f):
    """Bone `bone` set to the world-space blend of two placements (position lerped, rotation slerped)."""
    arm = bpy.data.objects[ROOT]
    q = Ga.to_quaternion().slerp(Gb.to_quaternion(), f)
    G = Matrix.Translation(Ga.translation.lerp(Gb.translation, f)) @ q.to_matrix().to_4x4()
    arm.pose.bones[bone].matrix = arm.matrix_world.inverted() @ G
    bpy.context.view_layer.update()


def _foe_frame(clip, i):
    """A hit / death frame: the in-between of its keys, the gun out of the hand and the hat off the head blended in
    world space."""
    A = ANIMS[clip]
    keys, n, t = A['keys'], len(A['keys']), A['tween'][i]
    a, f = int(t), t - int(t)
    ka, kb = keys[a], keys[min(a + 1, n - 1)]
    arm = bpy.data.objects[ROOT]
    free = 'GunHold0' in arm.pose.bones and (ka in GUN_FREE or kb in GUN_FREE)
    hat = 'HatHold0' in arm.pose.bones and (ka in HAT_FREE or kb in HAT_FREE)
    if free:
        Ga, Gb = _gun_world(ka), _gun_world(kb)
    if hat:
        Ha, Hb = _hat_world(ka), _hat_world(kb)
    zmin = _pose_tween(f'{clip}.{i}')
    if free:
        _blend_bone('GunHold0', Ga, Gb, f)
    if hat:
        _blend_bone('HatHold0', Ha, Hb, f)
    return zmin


def _canvas():
    """The atlas canvas from pixel_rig's arguments (the outfit atlases' by default)."""
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    g = lambda k, d: a[a.index(k) + 1] if k in a else d
    px, py = (int(v) for v in g('--pivot', '48,78').split(','))
    return int(g('--w', 96)), int(g('--h', 80)), px, py, float(g('--upp', .0327883818891779))


def _fit_need(pitch=20.0):
    """For the posed frame as it stands (no canvas shift), seen through the render view at `pitch` (pixel_rig's
    view_setup: heights at the atlas pitch's px per metre): (the px up the screen it needs so every one of 16 facings
    stays inside the canvas with a pixel to spare for the outline, what is left over after that shift in px (left,
    right, top: > 0 = off the canvas), the body's ground footprint centre in his frame (m: x his left, y back; the gun
    and the hat left out))."""
    import numpy as np
    W, H, PX, PY, UPP = _canvas()
    M = _cam_matrix(pitch)
    ky = math.cos(_CAM_PITCH) / math.cos(math.radians(pitch))
    right, up = np.array(M @ Vector((1, 0, 0))), np.array(M @ Vector((0, 1, 0))) * ky
    dg = bpy.context.evaluated_depsgraph_get()
    pts, body = [], []
    for ob in bpy.data.collections[COL].objects:
        if ob.type != 'MESH' or ob.hide_render:
            continue
        oe = ob.evaluated_get(dg)
        me = oe.to_mesh()
        a = np.empty(len(me.vertices) * 3)
        me.vertices.foreach_get('co', a)
        Mw = np.array(oe.matrix_world)
        a = a.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]
        oe.to_mesh_clear()
        pts.append(a)
        if not ob.name.startswith('Gun') and ob.name.split('.')[0] not in HAT_PARTS:
            body.append(a)
    P, B = np.concatenate(pts), np.concatenate(body)
    need, xs, ys = 0.0, [], []
    for k in range(16):
        y = math.radians(45 + 22.5 * k)
        c, s = math.cos(y), math.sin(y)
        Q = np.stack([P[:, 0] * c - P[:, 1] * s, P[:, 0] * s + P[:, 1] * c, P[:, 2]], 1)
        sx, sy = PX + .5 + Q @ right / UPP, PY + .5 - Q @ up / UPP   # continuous px (pixel r covers r .. r + 1)
        need = max(need, sy.max() - (H - FIT_MARGIN))
        xs += [sx.min(), sx.max()]
        ys.append(sy.min())
    top = min(ys) - max(0.0, need)
    over = (round(FIT_MARGIN - min(xs), 1), round(max(xs) - (W - FIT_MARGIN), 1), round(FIT_MARGIN - top, 1))
    centre = [float((B[:, 0].min() + B[:, 0].max()) / 2), float((B[:, 1].min() + B[:, 1].max()) / 2)]
    return max(0.0, need), over, centre


def _arm_parts():
    """The base names of the parts bound to an arm bone (shoulder to hand: sleeves, cuffs, hands), found once."""
    if not _ARMS:
        _ARMS.extend(sorted({ob.name.split('.')[0] for ob in bpy.data.collections[COL].objects
                             if ob.type == 'MESH' and ob.vertex_groups and
                             ob.vertex_groups[0].name.startswith(('Left', 'Right')) and
                             ob.vertex_groups[0].name.endswith(('Shoulder', 'Arm', 'ForeArm', 'Hand'))}))
    return tuple(_ARMS)


def _cam_matrix(pitch=20.0):
    """pixel_rig's camera rotation (camera(yaw=45, pitch=20), or a render view's pitch): columns right, up, back."""
    p = math.radians(pitch)
    off = Vector((math.sin(_CAM_YAW) * math.cos(p), -math.cos(_CAM_YAW) * math.cos(p), math.sin(p)))
    return (-off).to_track_quat('-Z', 'Y').to_matrix()


def _lie_now():
    """How far down the posed body is, 0 (upright) .. 1 (lying): the tilt of hips -> head from the vertical, eased
    over 12 .. 78 deg."""
    pbs = bpy.data.objects[ROOT].pose.bones
    d = (pbs['Head'].head - pbs['Hips'].head).normalized()
    t = max(0.0, min(1.0, (math.degrees(math.acos(max(-1.0, min(1.0, d.z)))) - 12) / 66))
    return t * t * (3 - 2 * t)


def _root_to(dy, dx=0.0):
    """The whole posed body (and a gun out of the hand: it hangs off the hand) moved dy m along his back axis (and dx
    to his left)."""
    if dy or dx:
        hp = bpy.data.objects[ROOT].pose.bones['Hips']
        hp.matrix = Matrix.Translation((dx, dy, 0)) @ hp.matrix
        bpy.context.view_layer.update()


def _fit_clip(clip):
    """A death clip, every frame posed once: the corpse centred on the pivot along his facing (the last frame's body
    footprint centre -> _ROOT_OFF, every frame moved by it, so the first frame stands that far from the pivot: the
    root travel the game reads from the Hips); how far down he is (`lie`, a running max from 0 at the first frame) and
    the render view that follows it (pitch 20 -> PITCH_GAME: lying, the frame is the game's own ground projection, so
    the body covers the ground it lies on); then the whole px each frame needs up the screen through its view
    -> the view's `lift` and `shift` (that px as m at the atlas pitch: px = shift * sin(20) / units_per_px, whole:
    the game draws the frame that many px lower) and `travel` (m: the corpse's centre from where he stood, behind him
    for die_b, in front for die_f)."""
    A, req, over, lie = ANIMS[clip], [], [], []
    n = A['frames']
    _frame(f'{clip}.{n - 1}')
    cx, cy = _fit_need()[2]
    cx = cx if A.get('fitx') else 0.0      # (fitx: centred across him too, `side` says how far: a fall off to one side)
    _ROOT_OFF[clip] = (-cy, -cx)
    run = 0.0
    for i in range(n):
        _frame(f'{clip}.{i}')
        _root_to(-cy, -cx)
        run = 0.0 if i == 0 else max(run, _lie_now())
        lie.append(run)
        need, o, centre = _fit_need(20 + (PITCH_GAME - 20) * run)
        req.append(need)
        over.append(o)
    out = [math.ceil(need - 1e-3) for need in req]   # (each frame its own: the game draws every frame by its own shift)
    _SHIFT[clip] = out
    _VIEW[clip] = [(20 + (PITCH_GAME - 20) * l, s) for l, s in zip(lie, out)]
    kpy = math.sin(_CAM_PITCH) / _canvas()[4]
    A['shift'] = [round(v / kpy, 4) for v in out]
    A['lie'] = [round(v, 3) for v in lie]
    A['travel'] = round(cy if clip == 'die_b' else -cy, 3)   # (die_s: its own sign, the game reads the Hips)
    if A.get('fitx'):
        A['side'] = round(cx, 3)
    print('FOE_FIT', clip, 'shift px', out, 'lie', A['lie'], 'travel', A['travel'], 'corpse centre x', round(centre[0], 3),
          'y', round(centre[1], 3), 'over (left, right, top px, worst)', tuple(max(o[j] for o in over) for j in range(3)),
          'top by frame', [round(o[2] + out[i] - req[i], 1) for i, o in enumerate(over)])


def _frame(name):
    """pose() before the canvas shift: a hit / death frame or any other pose, then the fresh shell (the coach gun's)
    for an in-between frame: the blend carries location and rotation only (the shell's shrink is a scale), so a _clip
    frame shows it when its key position lies in one of the clip's `shell` ranges."""
    clip, _, i = name.partition('.')
    A = ANIMS.get(clip) if i else None
    zmin = _foe_frame(clip, int(i)) if A and A.get('foe') else _pose_tween(name)
    pbs = bpy.data.objects[ROOT].pose.bones
    if A and 'tween' in A and 'GunShell0' in pbs:
        t = A['tween'][int(i)]
        pbs['GunShell0'].scale = (1, 1, 1) if any(a <= t <= b for a, b in A.get('shell', ())) else (.001, .001, .001)
        bpy.context.view_layer.update()
    return zmin


_pose_tween = globals().get('_pose_tween', pose)     # the in-between pose() above


def pose(name):
    """_frame(), then for a death clip's frame (fitted on its first frame: every frame posed once, _fit_clip): the body
    moved along his facing so the corpse lies on the pivot; the frame's view (pitch, lift up the screen) is
    render_view's, for pixel_rig. While a death clip poses, the hat and the arms are out of the ground snap (his body
    carries him; the hat flies, the arms lie on the ground)."""
    clip, _, i = name.partition('.')
    A = ANIMS.get(clip) if i else None
    soft = [p for p in HAT_PARTS + _arm_parts() if p not in SOFT_PARTS] if A and A.get('fit') else []
    SOFT_PARTS.update(soft)
    try:
        if A and A.get('fit') and clip not in _SHIFT:
            _fit_clip(clip)
        zmin = _frame(name)
    finally:
        SOFT_PARTS.difference_update(soft)
    if A and clip in _SHIFT:
        _root_to(*_ROOT_OFF[clip])
    return zmin


def render_view(name):
    """pixel_rig's per-pose render view: a death clip's frame through its pitch (20 standing .. PITCH_GAME lying) and
    lifted its whole px up the canvas (_fit_clip); None for every other pose (the atlas camera)."""
    clip, _, i = name.partition('.')
    if not i or clip not in _VIEW:
        return None
    pitch, lift = _VIEW[clip][int(i)]
    return {'pitch': pitch, 'lift': lift}


# ================================================================ LASSO (the cowboys' gadget, key F) ==================
# The game draws the live rope and the loop (3D lines in the hemp palette); the sprite has the body and the COIL in the
# left hand. Poses (the revolver stays holstered: none starts with GUN_POSES):
#   lasso_spin.0-5 (clip, loop)   standing, weight back, right arm up, the hand circling beside / over the hat once
#                                  (counter-clockwise seen from above: right -> left in front of him), coil at the hip
#   lws_0-7 / lrs_0-7             walk / run frames (the legs of walk.i / run.i) under the spin's upper body
#   lasso_throw.<i> (clip)        wind-up (hand high and back) -> release (the arm level along the facing, mark
#                                  `release`) -> follow-through (low forward) -> recover (the coil hand comes up)
#   lasso_haul_0-1                taut hold, leaning back, feet wide, right hand forward at chest height, left at the hip
#   lasso_yank.<i> (clip)         the hard pull: further back, hands in to the chest and hip, a short step back
#   lasso_take.0-1 (clip)         the rope goes taut after a throw: the throw's last frame into lasso_haul_0
#   lasso_hang_in.0-3 (clip)      the grab before a swing (backward: letting go): the arm up to the grip, the hat sliding
#                                  off onto his back; from mark `grip` on the fist is at the hang's grip height
#   lasso_hang_0-2                hanging by the right fist (no coil), knees tucked forward / legs long / knees tucked
#                                  back; every frame has the grip (RopeHand0) at the same height above the pivot
#                                  (LASSO_HANG['grip'], printed when fitted)
# Markers (bones, exported per pose and facing like GunMuzzle0): RopeHand0 = the right fist's grip point (the hanging
# fist in the hang), RopeHand1 = the left fist's; the bone's HEAD is the point.
PIXEL_FAMILIES['hemp'] = ['d5aa68', '9a743d', '624522', '2a1c10']   # -> c8a876 / 9a7c50 / 6a5234 after palette_harm
LASSO_KEYS = set()   # pose keys with the coil shown in the left hand (else collapsed into the fist)
LASSO_AT = {}        # pose key -> [(side, (x, y, z) m in his frame for a 1.8 m figure)]: wrist targets (IK, after REACH)
LASSO_HANG = {}      # the hang's fit: per key the snapped grip height, and 'grip' (the common one, m above the pivot)
LASSO_HAT = {}       # pose key -> deg the hat is tipped back on the head (its front brim up), about the back of its band,
                     # or ('back', (x, y, z) m, deg): off the head onto its back (head-carried), the crown turned back
COIL_TURN = 40       # deg: the coil's plane turned from his frontal plane toward his left side (it reads from most sides)


def _marker(name, parent, head, tail):
    """A lone bone (a marker or a hold bone) on a standard bone: the head is the point."""
    arm = bpy.data.objects[ROOT]
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    b = arm.data.edit_bones.new(name)
    b.head, b.tail, b.roll = head, tail, 0
    b.parent = arm.data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return name


def _tube_loop(bm, pts, r, m=4):
    """A closed tube (a ring of rope) through pts."""
    n, rings = len(pts), []
    for k, c in enumerate(pts):
        t = (pts[(k + 1) % n] - pts[k - 1]).normalized()
        u = Vector((0, 0, 1)) - t * t.z if abs(t.z) < .9 else Vector((1, 0, 0)) - t * t.x
        u.normalize()
        v = t.cross(u)
        rings.append([bm.verts.new(c + (u * math.cos(2 * math.pi * j / m + math.pi / m) +
                                        v * math.sin(2 * math.pi * j / m + math.pi / m)) * r) for j in range(m)])
    for k in range(n):
        a, b = rings[k], rings[(k + 1) % n]
        for j in range(m):
            bm.faces.new((a[j], a[(j + 1) % m], b[(j + 1) % m], b[j]))


@garment('lasso_coil', 'rope', ['human_small'], soft=['RopeCoil'], pixel={'RopeCoil': ['rope', 'hemp', {'thin': True}]})
def _lasso_coil():
    """The lariat's coils in the left fist: 5 turns ~25 cm across hanging from the grip, fanned a little so the turns
    read; on its own bone (CoilHold0), hung plumb by _lasso_hold in the lasso poses and collapsed into the fist in all
    others. Also the rope markers RopeHand0 / RopeHand1 (the fists' grip points)."""
    P, s, J, z = _ctx()
    gR, gL = _hand_frame('R')[0], _hand_frame('L')[0]
    _marker('RopeHand0', 'RightHand', gR, J['handR'])
    _marker('RopeHand1', 'LeftHand', gL, J['handL'])
    hold = _marker('CoilHold0', 'LeftHand', gL, gL + Vector((0, 0, -.05 * s)))
    bm = bmesh.new()
    for k in range(5):
        a, b = (.112 + .007 * k) * s, (.122 + .005 * k) * s        # half width, half height of turn k
        fan = math.radians(-14 + 7 * k)                              # turned about the plumb line through the fist
        dy = (-.012 + .006 * k) * s
        pts = []
        for i in range(20):
            t = 2 * math.pi * i / 20
            p = Vector((a * math.sin(t), dy, -b * (1 - math.cos(t)) - .01 * s))
            pts.append(gL + Matrix.Rotation(fan, 3, 'Z') @ p)
        _tube_loop(bm, pts, .0075 * s)
    _bind('RopeCoil', bm, hold)


def _lasso_reach(pose_name):
    """HOLD hook (BEFORE the gun's: the holstered revolver rides a bone on the right hand, placed after the arms are
    final): the lasso keys' wrist targets (LASSO_AT, IK)."""
    for side, p in LASSO_AT.get(_key(pose_name), ()):
        _reach(side, Vector(p) * PROP['height'] / 1.8)


def _lasso_hold(pose_name, hat=True):
    """HOLD hook (last): the hat (LASSO_HAT: tipped back, or off onto his back; hat=False for a blended in-between,
    whose hat is the blend), then the coil. In a lasso key the coil hangs plumb from the left fist, its plane turned
    COIL_TURN from the chest's frontal plane; otherwise it is collapsed into the fist."""
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    key = _key(pose_name)
    if 'CoilHold0' not in pbs:
        return
    Mr = bones['CoilHold0'].matrix_local
    hd = pbs['LeftHand']
    fist = hd.head + (hd.tail - hd.head) * .5
    hat = hat and LASSO_HAT.get(key)
    if hat and 'HatHold0' in pbs:
        J, k = landmarks(), PROP['height'] / 1.8
        zb = J['head'].z + .69 * (J['top'].z - J['head'].z)          # the band's height (the brim's root)
        hb = pbs['HatHold0']
        if isinstance(hat, tuple):   # ('back', (x, y, z) m, tilt): off the head onto its back, its crown turned back `tilt`
            M = (Matrix.Translation(Vector(hat[1]) * k) @ Matrix.Rotation(math.radians(-hat[2]), 4, 'X') @
                 Matrix.Translation(-Vector((0, .012 * k, zb))))
            hb.matrix = pbs['Head'].matrix @ bones['Head'].matrix_local.inverted() @ M @ bones['HatHold0'].matrix_local
        else:                        # tipped back `hat` deg about the back of its band
            piv = _carried('Head', Vector((0, .2 * k, zb)))
            ax = (pbs['Head'].matrix.to_3x3() @ bones['Head'].matrix_local.to_3x3().inverted() @ Vector((1, 0, 0))).normalized()
            hb.matrix = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(-hat), 4, ax) @ Matrix.Translation(-piv) @ hb.matrix
        bpy.context.view_layer.update()
    if key in LASSO_KEYS:
        f = pbs['Spine2'].matrix.to_3x3() @ bones['Spine2'].matrix_local.to_3x3().inverted() @ Vector((0, -1, 0))
        yaw = math.atan2(f.x, -f.y)
        R = Matrix.Rotation(yaw + math.radians(COIL_TURN), 3, 'Z')
        pbs['CoilHold0'].matrix = Matrix.Translation(fist) @ (R @ Mr.to_3x3()).to_4x4()
    else:
        pbs['CoilHold0'].matrix = Matrix.Translation(fist) @ Mr.to_3x3().to_4x4() @ Matrix.Scale(.001, 4)
    bpy.context.view_layer.update()


def _spin_point(th, c=(-.36, -.12, 1.71), r=.12):
    """REACH entry: the right wrist on the spin circle (centre c, radius r, m at 1.8 m) at angle th, carried by the chest
    (th 0 = his left of the centre, 90 deg = behind it: counter-clockwise seen from above)."""
    k = PROP['height'] / 1.8
    return ('Right', 'Spine2', lambda: Vector((c[0] + r * math.cos(th), c[1] + r * math.sin(th), c[2])) * k)


_SPIN_LEGS = {'LeftUpLeg': [('X', -9), ('Y', -5)], 'LeftLeg': [('X', 8)], 'LeftFoot': [('X', -3)],
              'RightUpLeg': [('X', 8), ('Y', 6)], 'RightLeg': [('X', 14)], 'RightFoot': [('Z', 10)]}
_COIL_ARM = {'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 32)], 'LeftForeArm': [('X', -44)],
             'LeftHand': [('Y', 6)]}                                   # the coil hand in front of the left hip
_SPIN_ARM = {'RightShoulder': [('Y', 40)], 'RightArm': [('Y', 84), ('X', -8)], 'RightForeArm': [('Y', 60)]}
_SPIN = {'Hips': [('Z', -10)], 'Spine': [('X', -3), ('Y', 6)], 'Spine1': [('X', -2), ('Y', 4)], 'Neck': [('Z', 6), ('X', 4), ('Y', -4)],
         'Head': [('Z', 4), ('X', -5), ('Y', -3)], **_COIL_ARM, **_SPIN_ARM, **_SPIN_LEGS}
for _i in range(6):
    POSES[f'lasso_spin_{_i}'] = dict(_SPIN)
    REACH[f'lasso_spin_{_i}'] = [_spin_point(math.radians(-90 + 60 * _i))]   # frame 0: the hand in front
ANIMS['lasso_spin'] = _clip([f'lasso_spin_{i}' for i in range(6)], [0, 1, 2, 3, 4, 5], 12, loop=True)
# on the move: the spin's upper body over the walk / run legs (the hand once round per gait cycle)
_SPIN_UP = _upper({k: v for k, v in _SPIN.items() if k not in LEG_BONES}, -10)
for _i in range(8):
    for _g, _c in (('lws', 'walk'), ('lrs', 'run')):
        POSES[f'{_g}_{_i}'] = _on_legs(_i, _SPIN_UP, _c)
        REACH[f'{_g}_{_i}'] = [_spin_point(math.radians(-90 + 45 * _i))]
# the throw: wind-up (the hand high and back over the right shoulder, the body loaded onto the back foot) -> the whip
# over the top -> release (the arm level along the facing, the right shoulder through) -> follow-through (low forward,
# the weight on the front foot) -> recover (upright, the coil hand comes up in front to take the rope)
_THROW_LEGS = {'LeftUpLeg': [('X', -14), ('Y', -6)], 'LeftLeg': [('X', 10)], 'LeftFoot': [('X', -4)],
               'RightUpLeg': [('X', 10), ('Y', 7)], 'RightLeg': [('X', 14)], 'RightFoot': [('Z', 10)]}
POSES['lasso_throw_a'] = {'Hips': [('Z', -22)], 'Spine': [('X', -6), ('Y', 4)], 'Spine1': [('X', -4)], 'Neck': [('Z', 14), ('X', 6)],
                          'Head': [('Z', 8)], **_COIL_ARM, 'LeftArm': [('Y', 26), ('X', -14)], 'LeftForeArm': [('X', -40)],
                          'RightShoulder': [('Y', 34)], 'RightArm': [('Y', 84), ('X', 20)], 'RightForeArm': [('Y', 50)],
                          **_THROW_LEGS, 'RightLeg': [('X', 20)]}
POSES['lasso_throw_b'] = {'Hips': [('Z', 16)], 'Spine': [('X', 6)], 'Spine1': [('X', 4)], 'Neck': [('Z', -10), ('X', -6)],
                          'Head': [('Z', -6), ('X', -2)], **_COIL_ARM,
                          'RightShoulder': [('Z', -10)], 'RightArm': [('Y', -40), ('X', -80)], 'RightForeArm': [('X', -8)],
                          **_THROW_LEGS, 'LeftLeg': [('X', 16)], 'RightUpLeg': [('X', 14), ('Y', 7)], 'RightLeg': [('X', 10)]}
POSES['lasso_throw_c'] = {'Hips': [('Z', 24)], 'Spine': [('X', 12)], 'Spine1': [('X', 6)], 'Neck': [('Z', -14), ('X', -12)],
                          'Head': [('Z', -8), ('X', -4)], **_COIL_ARM, 'LeftArm': [('Y', 30), ('X', 10)],
                          'RightShoulder': [('Z', -12)], 'RightArm': [('Y', -36), ('X', -48)], 'RightForeArm': [('X', -10)],
                          **_THROW_LEGS, 'LeftLeg': [('X', 22)], 'RightUpLeg': [('X', 18), ('Y', 7)], 'RightLeg': [('X', 16)],
                          'RightFoot': [('X', 20), ('Z', 10)]}
POSES['lasso_throw_d'] = {'Hips': [('Z', 10)], 'Spine': [('X', 4)], 'Neck': [('Z', -6)], 'Head': [('Z', -4)],
                          'LeftShoulder': [('Z', -6)], 'LeftArm': [('Y', 30), ('X', -40), ('Z', -20)], 'LeftForeArm': [('X', -60)],
                          'RightShoulder': [('Z', -4)], 'RightArm': [('Y', -36), ('X', -36)], 'RightForeArm': [('X', -24)],
                          **_SPIN_LEGS}
POSES['lasso_throw_w'] = {'Hips': [('Z', -4)], 'Spine': [('X', 0), ('Y', 2)], 'Spine1': [('X', 0)], 'Neck': [('Z', 2)],
                          'Head': [('Z', 2)], **_COIL_ARM, 'LeftArm': [('Y', 28), ('X', -8)], 'LeftForeArm': [('X', -42)],
                          'RightShoulder': [('Y', 30)], 'RightArm': [('Y', 84), ('X', -30)], 'RightForeArm': [('Y', 40)],
                          **_THROW_LEGS}
LASSO_AT.update({'lasso_throw_a': [('Right', (-.3, .2, 1.68))], 'lasso_throw_w': [('Right', (-.24, -.2, 1.64))],
                 'lasso_throw_b': [('Right', (-.1, -.5, 1.2))],
                 'lasso_throw_c': [('Right', (-.04, -.42, .9))],
                 'lasso_throw_d': [('Right', (-.12, -.34, .96)), ('Left', (.1, -.3, 1.0))]})
ANIMS['lasso_throw'] = _clip(['lasso_throw_a', 'lasso_throw_w', 'lasso_throw_b', 'lasso_throw_c', 'lasso_throw_d'],
                             [0, .5, 1, 1.33, 1.67, 2, 2.5, 3, 3.33, 3.67, 4], 14,
                             ms=[100, 45, 40, 35, 35, 60, 60, 70, 60, 60, 120], marks={'release': 5})
# the taut hold: leaning back on a wide stance, the right hand forward at chest height and the left at the hip, the rope
# running between them along the facing; frame 1 a small strain wobble. The yank: further back, hands in, a step back.
_HAUL_LEGS = {'LeftUpLeg': [('X', 16), ('Y', -9)], 'LeftLeg': [('X', 32)], 'LeftFoot': [('X', -8)],
              'RightUpLeg': [('X', -22), ('Y', 10)], 'RightLeg': [('X', 8)], 'RightFoot': [('X', 6), ('Z', 6)]}
_HAUL = {'Hips': [('Z', 14), ('X', -8)], 'Spine': [('X', -10)], 'Spine1': [('X', -5)], 'Neck': [('Z', -8), ('X', 12)],
         'Head': [('Z', -6), ('X', 4)], 'LeftShoulder': [('Z', 4)], 'LeftArm': [('Y', 34), ('X', 10)], 'LeftForeArm': [('X', -40)],
         'RightShoulder': [('Z', -10)], 'RightArm': [('Y', -40), ('X', -60)], 'RightForeArm': [('X', -20)], **_HAUL_LEGS}
POSES['lasso_haul_0'] = dict(_HAUL)
POSES['lasso_haul_1'] = {**_HAUL, 'Spine': [('X', -12)], 'Spine1': [('X', -6)], 'Neck': [('Z', -8), ('X', 15)],
                         'LeftLeg': [('X', 35)]}
LASSO_AT.update({'lasso_haul_0': [('Right', (-.06, -.36, 1.0)), ('Left', (.2, .06, .8))],
                 'lasso_haul_1': [('Right', (-.06, -.34, .99)), ('Left', (.2, .08, .8))]})
POSES['lasso_yank_b'] = {**_HAUL, 'Hips': [('Z', 18), ('X', -13)], 'Spine': [('X', -17)], 'Spine1': [('X', -8)],
                         'Neck': [('Z', -8), ('X', 22)], 'LeftUpLeg': [('X', 4), ('Y', -9)], 'LeftLeg': [('X', 70)], 'LeftFoot': [('X', 20)],
                         'RightLeg': [('X', 14)]}
POSES['lasso_yank_c'] = {**_HAUL, 'Hips': [('Z', 20), ('X', -16)], 'Spine': [('X', -22)], 'Spine1': [('X', -10)],
                         'Neck': [('Z', -8), ('X', 28)], 'Head': [('Z', -6), ('X', 8)],
                         'LeftUpLeg': [('X', 36), ('Y', -9)], 'LeftLeg': [('X', 30)], 'LeftFoot': [('X', -10)],
                         'RightUpLeg': [('X', -14), ('Y', 9)], 'RightLeg': [('X', 16)]}
LASSO_AT.update({'lasso_yank_b': [('Right', (-.08, -.24, 1.07)), ('Left', (.22, .14, .83))],
                 'lasso_yank_c': [('Right', (-.1, -.15, 1.1)), ('Left', (.24, .22, .86))]})
ANIMS['lasso_yank'] = _clip(['lasso_haul_0', 'lasso_yank_b', 'lasso_yank_c'], [.5, 1, 1.5, 2], 16, ms=[50, 60, 60, 140],
                            marks={'pull': 1})
# (extra) the rope goes taut after a throw: from the throw's recover into the hold, then lasso_haul_0
ANIMS['lasso_take'] = _clip(['lasso_throw_d', 'lasso_haul_0'], [.35, .7], 14, ms=[60, 60])
LASSO_KEYS.update(k for k in POSES if k.startswith(('lasso_spin_', 'lws_', 'lrs_', 'lasso_throw_', 'lasso_haul_', 'lasso_yank_')))
# hanging from the rope (swinging, Indiana Jones on the whip): by the right fist, the arm straight up beside the head and
# the fist the highest point; the body tilted so the fist is over his centre; the left arm out for balance; the hat slid
# off onto the back of his head (on its cord); knees tucked forward (0), legs long (1), knees tucked back (2)
_HANG = {'Hips': [('Y', 8)], 'Spine': [('X', 2)], 'Neck': [('X', -4), ('Y', -4)], 'Head': [('X', -6), ('Y', -2)],
         'RightShoulder': [('Y', 45)], 'RightArm': [('Y', 128)],
         'LeftShoulder': [('Z', -6)], 'LeftArm': [('Y', -60), ('X', -20)], 'LeftForeArm': [('Y', -25), ('X', -15)],
         'LeftHand': [('Y', -10)]}
_hlegs = lambda lu, ll, lf, ru, rl, rf: {'LeftUpLeg': [('X', lu)], 'LeftLeg': [('X', ll)], 'LeftFoot': [('X', lf)],
                                          'RightUpLeg': [('X', ru)], 'RightLeg': [('X', rl)], 'RightFoot': [('X', rf)]}
POSES['lasso_hang_0'] = {**_HANG, **_hlegs(-75, 95, 15, -60, 85, 15), 'Spine': [('X', 7)]}
POSES['lasso_hang_1'] = {**_HANG, **_hlegs(-8, 18, 28, 4, 26, 28)}
POSES['lasso_hang_2'] = {**_HANG, **_hlegs(20, 95, 25, 30, 85, 25), 'Hips': [('Y', 8), ('X', -6)], 'Spine': [('X', -8)]}
_HANG_FIST = ('Right', (-.17, -.02, 1.82))
_HAT_BACK = ('back', (0, .26, 1.38), 80)          # the band's centre behind the head (m, head-carried), crown turned back 80 deg
for _i in range(3):
    LASSO_AT[f'lasso_hang_{_i}'] = [_HANG_FIST]
    LASSO_HAT[f'lasso_hang_{_i}'] = _HAT_BACK
# the grab (lasso_hang_in, played forward into the swing and backward out of it): 0 a crouch, the right arm reaching up,
# looking up, the hat tipped back; 1 halfway (the hat sliding back); 2 the fist closes at the hang's grip (mark `grip`),
# up on his toes, the hat off the back of his head; 3 most of the way into lasso_hang_1 (the hat on his back, the feet
# leaving the ground). From frame 2 on the grip is at the hang's height above the pivot (HANG_KEYS fit + a lift for the
# in-between); frames 0-1 stand on the pivot.
POSES['lasso_grab_0'] = {'Hips': [('Y', 3)], 'Spine': [('X', 6)], 'Neck': [('X', -10)], 'Head': [('X', -8)],
                         'RightShoulder': [('Y', 30)], 'RightArm': [('Y', 110), ('X', -20)],
                         'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 0), ('X', -10)], 'LeftForeArm': [('X', -30)],
                         **_hlegs(-26, 46, -20, -22, 42, -20)}
POSES['lasso_grab_1'] = {**_HANG, 'LeftArm': [('Y', -36), ('X', -14)], 'LeftForeArm': [('Y', -15), ('X', -20)],
                         **_hlegs(-4, 6, 30, 2, 10, 30)}
LASSO_AT.update({'lasso_grab_0': [('Right', (-.24, -.14, 1.55))], 'lasso_grab_1': [_HANG_FIST]})
LASSO_HAT.update({'lasso_grab_0': 25, 'lasso_grab_1': ('back', (0, .2, 1.55), 55)})
ANIMS['lasso_hang_in'] = _clip(['lasso_grab_0', 'lasso_grab_1', 'lasso_hang_1'], [0, .5, 1, 1.6], 14, ms=[70, 60, 70, 80],
                               marks={'grip': 2})   # from `grip` on: the fist closed, the grip at the hang's height
HANG_KEYS = ['lasso_hang_0', 'lasso_hang_1', 'lasso_hang_2', 'lasso_grab_1']   # one grip height (RopeHand0) for these
LASSO_LIST = ['lasso_spin', 'lasso_throw', 'lasso_yank', 'lasso_take', 'lasso_hang_in']   # the clips (poses: lws_, lrs_,
                                                                                          # lasso_haul_, lasso_hang_)


_pose_dead = globals().get('_pose_dead', pose)     # the death-fit pose() above


def _grip_z():
    arm = bpy.data.objects[ROOT]
    return (arm.matrix_world @ arm.pose.bones['RopeHand0'].head).z


def _hang_fit():
    """The hang keys (HANG_KEYS): each posed with no lift, its grip (RopeHand0, the hanging fist) height after the ground
    snap; then every one lifted (_air) so the grip sits at the highest of them (LASSO_HANG['grip'], m above the pivot)."""
    for k in HANG_KEYS:
        POSES[k]['_air'] = 0.0
        _pose_dead(k)
        LASSO_HANG[k] = _grip_z()
    LASSO_HANG['grip'] = max(LASSO_HANG[k] for k in HANG_KEYS)
    for k in HANG_KEYS:
        POSES[k]['_air'] = LASSO_HANG['grip'] - LASSO_HANG[k]
    print('LASSO_HANG grip (RopeHand0)', round(LASSO_HANG['grip'], 4), 'm above the pivot; snapped:',
          {k: round(LASSO_HANG[k], 4) for k in HANG_KEYS})


def _holster_now():
    """The revolver back in its holster on the posed right thigh (as _gun_hold does outside the gun poses)."""
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    if 'GunHold0' not in pbs or 'g' not in HOLSTER or 'g' not in GUN:
        return
    T = pbs['RightUpLeg'].matrix @ bones['RightUpLeg'].matrix_local.inverted()
    T3 = T.to_3x3()
    R = _frame_rot(GUN['F'], GUN['U'], (T3 @ HOLSTER['F']).normalized(), (T3 @ HOLSTER['U']).normalized())
    pbs['GunHold0'].matrix = Matrix.Translation(T @ HOLSTER['g']) @ (R @ bones['GunHold0'].matrix_local.to_3x3()).to_4x4()
    bpy.context.view_layer.update()


def pose(name):
    """The death-fit pose(); a hang frame first fits the hang's common grip height. A lasso clip's in-between blends the
    bones hand-relative, so the holstered revolver (on a right-hand bone) and the coil (on a left-hand one) are set again
    after the blend: the gun in the holster, the coil plumb."""
    if name.startswith(('lasso_hang', 'lasso_grab')) and 'grip' not in LASSO_HANG:
        _hang_fit()
    zmin = _pose_dead(name)
    clip, _, i = name.partition('.')
    if i and clip in LASSO_LIST:
        _holster_now()
        if 'CoilHold0' in bpy.data.objects[ROOT].pose.bones:
            _lasso_hold(name, hat=False)
        if clip == 'lasso_hang_in' and ANIMS[clip]['tween'][int(i)] >= 1:   # the fist closed: at the hang's grip height
            arm = bpy.data.objects[ROOT]
            arm.location.z += LASSO_HANG['grip'] - _grip_z()
            bpy.context.view_layer.update()
    return zmin


_build_wardrobe = build


def build():
    """wardrobe.build (body + dress), then the gun's hold hook for every pose: the revolver's (holster or hand) or the
    coach gun's (on the chest, both hands)."""
    names = _build_wardrobe()
    if _foe_root not in HOLD_HOOKS:
        HOLD_HOOKS.insert(0, _foe_root)
    if any(g in LOADOUT for g in GUN_ITEMS) and _gun_hold not in HOLD_HOOKS:
        HOLD_HOOKS.append(_gun_hold)
    if 'coach_gun' in LOADOUT and _long_gun_hold not in HOLD_HOOKS:
        HOLD_HOOKS.append(_long_gun_hold)
    if 'lasso_coil' in LOADOUT and _lasso_hold not in HOLD_HOOKS:
        HOLD_HOOKS.insert(HOLD_HOOKS.index(_gun_hold) if _gun_hold in HOLD_HOOKS else len(HOLD_HOOKS), _lasso_reach)
        HOLD_HOOKS.append(_lasso_hold)
    return names


# ================================================================ the outlaw's emotes (live only) =====================
# Made for the LIVE hero (src/view/livehero.js): exported as bone matrices by tools/blender/ragdoll_export.py --clips (no
# atlas render, no pixelize: a 5 s export), shown with Shift+9 (the live demos) while he stands still. The sprite atlas
# doesn't have them. Every key starts from the ready idle, so each clip leaves and returns to idle.0. A clip's
# marks.loop (a step of its `play`) is where the demo player loops back to after the last step (else: idle, then again).
#   cheer   the draw, both arms thrown up in a V (the revolver to the sky, the hat pushed back) with two hops, the
#           twirl and back into the holster
#   wave    the left arm up and out (clear of the sombrero's brim), the forearm swung side to side, a head tilt
#   shrug   shoulders up, forearms out, palms up; the head tilted one way, then the other
#   squat   down onto his heels, the forearms over the knees, then resting there (a slow breath, a nod)
OUTLAW_EMOTES = ('cheer', 'wave', 'shrug', 'squat')
_pose_hang = pose   # the hang-fit pose() above


def pose(name):
    """The hang-fit pose(); then a _clip frame outside the lasso's clips packs the lasso's coil away again: its in-between
    is a blend of its keys' bones, which carries no scale, so the coil (collapsed into the fist by scaling it to nothing)
    came back full size in the left hand (the live export, ragdoll_export.py, hides a piece by that scale)."""
    zmin = _pose_hang(name)
    clip, _, i = name.partition('.')
    if i and 'tween' in ANIMS.get(clip, {}) and clip not in LASSO_LIST and 'CoilHold0' in bpy.data.objects[ROOT].pose.bones:
        _lasso_hold(name, hat=False)
    return zmin


FOLLOW = FOLLOW + ('gun_cheer',)   # the cheer's raised revolver points along the forearm (to the sky)
_IDLE_W = POSES['idle_in']
_LEGS_HOP = {'LeftUpLeg': [('X', -16), ('Y', -4)], 'LeftLeg': [('X', 30)], 'LeftFoot': [('X', 12)],
             'RightUpLeg': [('X', -10), ('Y', 4)], 'RightLeg': [('X', 22)], 'RightFoot': [('X', 10)]}
_LEGS_DIP = {'LeftUpLeg': [('X', -24), ('Y', -6)], 'LeftLeg': [('X', 40)], 'LeftFoot': [('X', -14)],
             'RightUpLeg': [('X', -18), ('Y', 6)], 'RightLeg': [('X', 34)], 'RightFoot': [('X', -14)]}
# cheer: `up` the arms in a wide V, ~40 deg over the horizontal (the hands out past the brim, below it: a steeper V puts
# them on the brim from above), in the air; `pump` elbows bent, fists up by the shoulders, knees bent from the landing
POSES['gun_cheer_up'] = {**_IDLE_W, **_LEGS_HOP, 'Spine': [('X', -6)], 'Spine1': [('X', -3)], 'Neck': [('X', -4)],
                         'Head': [('X', -5)],
                         'RightShoulder': [('Y', 8)], 'RightArm': [('Y', 76), ('X', -14)], 'RightForeArm': [('Y', 10)],
                         'RightHand': [],
                         'LeftShoulder': [('Y', -8)], 'LeftArm': [('Y', -76), ('X', -14)], 'LeftForeArm': [('Y', -10)],
                         'LeftHand': [], '_air': .09}
POSES['gun_cheer_pump'] = {**_IDLE_W, **_LEGS_DIP, 'Spine': [('X', 6)], 'Neck': [('X', -4)], 'Head': [('X', -4)],
                           'RightShoulder': [('Y', 8)], 'RightArm': [('Y', 62), ('X', -18)], 'RightForeArm': [('Y', 58)],
                           'RightHand': [],
                           'LeftShoulder': [('Y', -8)], 'LeftArm': [('Y', -62), ('X', -18)], 'LeftForeArm': [('Y', -58)],
                           'LeftHand': []}
LASSO_HAT.update({'gun_cheer_up': 14, 'gun_cheer_pump': 8})
ANIMS['cheer'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_cheer_pump', 'gun_cheer_up', 'gun_spin_0', 'gun_spin_1',
                        'gun_spin_2', 'gun_spin_3', 'gun_spin_4', 'gholster', 'idle_in'],
                       [0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 8.5, 9, 9.5, 10], 14,
                       play=[0, 1, 2, 3, 4, 5, 4, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
                       ms=[60, 50, 50, 80, 50, 230, 50, 90, 50, 260, 70, 50, 45, 45, 45, 55, 60, 90, 80, 120])
# wave: the upper arm ~24 deg over the horizontal and a little forward, the forearm from ~30 deg (out) to ~70 deg (in)
# over it: the hand stays out past the brim and below it (seen from behind too)
POSES['wave_up'] = {**_IDLE_W, 'Hips': [('Y', -3)], 'Neck': [('Z', 6), ('Y', 3)], 'Head': [('Y', 2)],
                    'LeftShoulder': [('Y', -4)], 'LeftArm': [('Y', -65), ('X', -20)], 'LeftForeArm': [('Y', -25)], 'LeftHand': []}
POSES['wave_in'] = {**POSES['wave_up'], 'LeftForeArm': [('Y', -45)]}
POSES['wave_out'] = {**POSES['wave_up'], 'LeftForeArm': [('Y', -5)]}
ANIMS['wave'] = _clip(['idle_in', 'wave_up', 'wave_in', 'wave_out'], [.5, 1, 2, 2.5, 3], 12,
                      play=[0, 1, 2, 3, 4, 3, 2, 3, 4, 3, 2, 1, 0], ms=[70, 80, 110, 60, 110, 60, 110, 60, 110, 60, 140, 80, 70])
# shrug: both arms explicit (the ready idle's right arm would otherwise stay)
_SHRUG = {**_IDLE_W, 'Spine': [('X', -3)],
          'LeftShoulder': [('Y', -14)], 'LeftArm': [('Y', 30), ('X', -18)], 'LeftForeArm': [('X', -70), ('Z', 20)], 'LeftHand': [],
          'RightShoulder': [('Y', 14)], 'RightArm': [('Y', -30), ('X', -18)], 'RightForeArm': [('X', -70), ('Z', -20)],
          'RightHand': []}
# (the head's roll small: the sombrero's wide brim makes a few degrees read as a lot)
POSES['shrug_l'] = {**_SHRUG, 'Neck': [('Y', 4), ('X', -4)], 'Head': [('Y', 3)]}
POSES['shrug_r'] = {**_SHRUG, 'Neck': [('Y', -4), ('X', -4)], 'Head': [('Y', -3)]}
ANIMS['shrug'] = _clip(['idle_in', 'shrug_l', 'shrug_r'], [.4, .8, 1, 1.5, 2], 12,
                       play=[0, 1, 2, 3, 4, 3, 2, 1, 0], ms=[60, 60, 220, 70, 200, 70, 240, 70, 70])
# squat: thighs 15 deg over the horizontal, the heels under the hips; the back leaning in, the head up; the arms over
# the knees. Left only: expand() mirrors it (the right leg, the right arm)
_SQUAT = {'LeftUpLeg': [('X', -105), ('Y', -14)], 'LeftLeg': [('X', 135)], 'LeftFoot': [('X', -28)],
          'Spine': [('X', 22)], 'Spine1': [('X', 10)], 'Spine2': [('X', 4)], 'Neck': [('X', -24)], 'Head': [('X', 2)],
          'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 34), ('X', -40)], 'LeftForeArm': [('X', -48)], 'LeftHand': [('X', 16)]}
POSES['squat_mid'] = {'LeftUpLeg': [('X', -55), ('Y', -8)], 'LeftLeg': [('X', 80)], 'LeftFoot': [('X', -20)],
                      'Spine': [('X', 14)], 'Neck': [('X', -12)],
                      'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 36), ('X', -20)], 'LeftForeArm': [('X', -20)]}
POSES['squat'] = _SQUAT
POSES['squat_b'] = {**_SQUAT, 'Spine2': [('X', 8)], 'Head': [('X', 8)]}
ANIMS['squat'] = _clip(['idle_in', 'squat_mid', 'squat', 'squat_b'], [.5, 1, 1.5, 2, 2.5, 3], 12,
                       play=[0, 1, 2, 3, 4, 5, 4, 3], ms=[70, 70, 70, 900, 400, 900, 400, 900], marks={'loop': 3})


# ================================================================ the gunslinger's live gun moves (live only) ==========
# Trick shots and draws made for the LIVE hero only (src/view/livehero.js), like the outlaw's emotes above: exported as
# bone matrices with ragdoll_export.py --clips (no atlas render), shown with Shift+9 while he stands still. Each is a
# routine from the ready idle back into the holster (the live demos play from the holstered idle), with marks naming the
# frames a game would hook: draw (the hand closes on the grip), shot / shot2 / shot3 (a round leaves), hit (the whip).
#   quickdraw     the fast draw: a hover over the grip, the gun out and fired from the hip, two shots fanned, a twirl home
#   behind_back   the gun hand swung behind his back, the muzzle out past the left hip: two shots to his LEFT, looking
#                 over his shoulder
#   over_shoulder the gun by his right ear, the barrel back over the shoulder: a shot BEHIND him without turning
#   under_arm     the gun hand across the chest, the barrel back past his left side: a no-look shot BEHIND him
#   duelist       the formal duel: side-on, feet in line, the gun raised muzzle-up by the cheek, lowered at arm's length,
#                 the free hand on the small of the back; a shot, the salute
#   kneel         down on the right knee, two-handed (the left hand cupping the right), two careful shots, up again
#   road_agent    the road agent's spin: the gun offered butt-first hanging off the trigger finger, rolled over into the
#                 hand, a shot
#   toss          the revolver tossed up end over end and caught, a shot
#   border_shift  tossed across into the left hand, a left-handed shot, tossed back
#   pistol_whip   a wind-up and a downward strike with the gun (melee), then back to the hip
#   sky_shot      a warning shot: the gun to the sky, the free hand on the hip
#   point_blank   leaning over a foe on the ground, a shot down
#   turn_shot     a target behind him: a spin on the spot over the right shoulder, drawing on the turn, a shot at the end
#                 of it, the twirl turning back
# The kit: a key named gun_* holds the revolver (_gun_hold), LIVE_AT puts a wrist on a point (two-bone IK, after the
# spec), LIVE_GUN holds the revolver another way than along the forearm, LIVE_LEFT puts the left wrist on the gun.
GUNSLINGER_LIVE = ('quickdraw', 'behind_back', 'over_shoulder', 'under_arm', 'duelist', 'kneel', 'road_agent', 'toss',
                   'border_shift', 'pistol_whip', 'sky_shot', 'point_blank', 'turn_shot')
LIVE_AT = {}     # pose key -> [(side, bone | None, (x, y, z) m at 1.8 m)]: that wrist onto the point, carried by the bone (a
                 # rest-space point), or None: in his frame (he faces -Y, +X his left, before the ground snap: hips at .76)
LIVE_GUN = {}    # pose key -> {dir: (x, y, z) the barrel's direction in his frame (else along the forearm, levelled as
                 # LEVEL; follow: True keeps its pitch), up: the gun's top (default up), spin: deg about the trigger finger
                 # (else GUN_SPIN), hand: 'Left' (in the left fist), air: (x, y, z) m in his frame (free, out of the hand)}
LIVE_LEFT = {}   # pose key -> the left wrist (F, U, S m) from the hammer of the gun as LIVE_GUN holds it (LEFT_TO_GUN's)


def _live_gun(pose_name):
    """HOLD hook (last): a live gun move's key: the wrists onto their points (LIVE_AT), the revolver held its way
    (LIVE_GUN), the left wrist onto it (LIVE_LEFT). Keys outside these tables are left as the other hooks posed them."""
    key = _key(pose_name)
    H, at = LIVE_GUN.get(key), LIVE_AT.get(key, ())
    if (H is None and not at) or 'g' not in GUN:
        return
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    k = PROP['height'] / 1.8
    held = pbs['GunHold0'].matrix.copy() if 'GunHold0' in pbs else None   # (where the gun is now: in its holster outside the gun moves)
    for side, bone, p in at:
        _reach(side, _carried(bone, Vector(p) * k) if bone else Vector(p) * k)
    if H is None:
        H = {} if key.startswith(GUN_POSES) else None   # (the hand moved: the gun is placed again, as _gun_hold does)
    if H is None:
        # a holstered revolver is the right hand's child: a wrist put on a point (a climb's, a vault's) must not pull it out
        if held is not None and any(sd == 'Right' for sd, _, _ in at):
            pbs['GunHold0'].matrix = held
            bpy.context.view_layer.update()
        return
    side = H.get('hand', 'Right')
    fa, hd = pbs[side + 'ForeArm'], pbs[side + 'Hand']
    if 'dir' in H:
        d = Vector(H['dir']).normalized()
    else:
        d = (fa.tail - fa.head).normalized()
        if not H.get('follow') and Vector((d.x, d.y)).length > .25:
            p = math.asin(max(-1.0, min(1.0, d.z))) * LEVEL
            d = Vector((d.x, d.y, 0)).normalized() * math.cos(p) + Vector((0, 0, math.sin(p)))
    up = Vector(H.get('up', (0, 0, 1))).normalized()
    if abs(d.dot(up)) > .95:
        up = Vector((0, 1, 0)) if abs(d.y) < .9 else Vector((0, 0, 1))
    R = _frame_rot(GUN['F'], GUN['U'], d, up)
    spin = H.get('spin', GUN_SPIN.get(key, 0))
    if spin:
        R = Matrix.Rotation(math.radians(spin), 3, (R @ GUN['F']).cross(R @ GUN['U'])) @ R
    at = Vector(H['air']) * k if 'air' in H else hd.head + (hd.tail - hd.head) * .5
    pbs['GunHold0'].matrix = Matrix.Translation(at) @ (R @ bones['GunHold0'].matrix_local.to_3x3()).to_4x4()
    bpy.context.view_layer.update()
    if key in LIVE_LEFT:
        F, U = R @ GUN['F'], R @ GUN['U']
        f, u, sd = LIVE_LEFT[key]
        _reach('Left', at + U * .05 * k - F * .03 * k + (F * f + U * u + F.cross(U) * sd) * k)


_build_live = build


def build():
    """western's build, then the live gun moves' hold hook after every other (it re-places what they placed)."""
    names = _build_live()
    if any(g in LOADOUT for g in GUN_ITEMS) and _live_gun not in HOLD_HOOKS:
        HOLD_HOOKS.append(_live_gun)
    return names


def _routine(steps):
    """A live gun move as steps, each shown for its ms: (key, ms[, mark]) shows that key, ('~', f, ms[, mark]) a frame
    f of the way from the key before to the next key (blended: _clip). Played straight through (no `play`)."""
    keys, tween, ms, marks = [], [], [], {}
    for st in steps:
        if st[0] == '~':
            tween.append(len(keys) - 1 + st[1])
            ms.append(st[2])
            mk = st[3] if len(st) > 3 else None
        else:
            if not keys or keys[-1] != st[0]:
                keys.append(st[0])
            tween.append(len(keys) - 1)
            ms.append(st[1])
            mk = st[2] if len(st) > 2 else None
        if mk:
            marks[mk] = len(tween) - 1
    assert max(tween) <= len(keys) - 1, ('an in-between with no key after it', keys)
    return _clip(keys, tween, 12, ms=ms, marks=marks or None)


# the endings: the twirl at the hip (backward, round the trigger finger) into the holster, and the ready idle
_HOME = [('gun_spin_0', 45), ('gun_spin_1', 45), ('gun_spin_2', 45), ('gun_spin_3', 45), ('gun_spin_4', 50), ('~', .5, 50), ('gholster', 70),
         ('~', .5, 80), ('idle_in', 120)]
_DRAW = [('idle_in', 90), ('gdraw_grab', 50, 'draw'), ('~', .5, 40), ('gun_draw_lift', 40)]
_RIGHT_LOOSE = {'RightShoulder': [('Z', 4)], 'RightArm': [('Y', -36), ('X', 8)], 'RightForeArm': [('X', -22)], 'RightHand': [('Y', -10)]}
_HAND_ON_HIP = {'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 10), ('X', 14)], 'LeftForeArm': [('X', -50)]}
_KNEEL = {'LeftUpLeg': [('X', -82), ('Y', -6)], 'LeftLeg': [('X', 84)], 'LeftFoot': [('X', -2)],
          'RightUpLeg': [('X', 6), ('Y', 6)], 'RightLeg': [('X', 100)], 'RightFoot': [('X', -30)]}
_LUNGE = {'LeftUpLeg': [('X', -28), ('Y', -6)], 'LeftLeg': [('X', 26)], 'LeftFoot': [('X', -4)],
          'RightUpLeg': [('X', 16), ('Y', 6)], 'RightLeg': [('X', 10)], 'RightFoot': [('X', 10), ('Z', 10)]}
_HIPS_L = ('Left', 'Hips', (.2, -.03, .86))     # the left fist on the left hip (akimbo)

# ---- quickdraw: hover, grab, the gun out level at the hip (shot), the kick, two fanned shots, the twirl home
POSES['gun_lv_qd_hip'] = _gpose(20, _arm(y=-44, x=-10, fx=-82, sz=-2, z=8), {'LeftArm': [('Y', 30), ('X', -30), ('Z', -20)],
                                'LeftForeArm': [('X', -60)]}, legs=_GWIDE, lean=14)
POSES['gun_lv_qd_kick'] = _gpose(18, _arm(y=-44, x=-14, fx=-84, sz=-4, z=8), {'LeftArm': [('Y', 34), ('X', -44), ('Z', -30)],
                                 'LeftForeArm': [('X', -66)]}, legs=_GWIDE, lean=10)
GUN_SPIN['gun_lv_qd_kick'] = 24
ANIMS['quickdraw'] = _routine([('idle_in', 90), ('duel_a', 380), ('gdraw_grab', 40, 'draw'), ('gun_draw_lift', 30),
                               ('gun_lv_qd_hip', 60, 'shot'), ('gun_lv_qd_kick', 50), ('~', .5, 40), ('gun_fan_a', 50),
                               ('gun_fan_b', 60, 'shot2'), ('gun_fan_a', 50), ('~', .5, 30), ('gun_fan_b', 60, 'shot3'),
                               ('~', .5, 60)] + _HOME)

# ---- behind_back: the gun hand swung round behind the back (wrist behind the left hip, carried by the hips), the
# barrel to his LEFT, the head turned over the left shoulder; two shots
_BB = {'Spine': [('Y', -4)], 'Neck': [('Z', 38), ('Y', 4)], 'Head': [('Z', 26)],
       'RightShoulder': [('Z', 8)], 'RightArm': [('Y', -36), ('X', 36)], 'RightForeArm': [('X', -60)]}
POSES['gun_lv_bb_swing'] = _gpose(-10, _BB, {'RightArm': [('Y', -40), ('X', 28)], 'Neck': [('Z', 20)], 'Head': [('Z', 14)]})
POSES['gun_lv_bb_aim'] = _gpose(-14, _BB)
POSES['gun_lv_bb_kick'] = _gpose(-14, _BB, {'Neck': [('Z', 40), ('Y', 6)]})
LIVE_AT.update({'gun_lv_bb_swing': [('Right', 'Hips', (-.12, .26, .9))], 'gun_lv_bb_aim': [('Right', 'Hips', (.04, .27, .92))],
                'gun_lv_bb_kick': [('Right', 'Hips', (.03, .27, .93))]})
LIVE_GUN.update({'gun_lv_bb_swing': {'dir': (.4, .9, -.2)}, 'gun_lv_bb_aim': {'dir': (1, .2, 0)},
                 'gun_lv_bb_kick': {'dir': (1, .2, 0), 'spin': 24}})
ANIMS['behind_back'] = _routine(_DRAW + [('gun_draw_hip', 50), ('gun_lv_bb_swing', 60), ('~', .5, 40), ('gun_lv_bb_aim', 220),
                                         ('gun_lv_bb_kick', 60, 'shot'), ('gun_lv_bb_aim', 260), ('gun_lv_bb_kick', 60, 'shot2'),
                                         ('gun_lv_bb_aim', 200), ('gun_lv_bb_swing', 60), ('gun_draw_hip', 60)] + _HOME)

# ---- over_shoulder: the gun hand up by the right ear (carried by the chest), the barrel back over the shoulder, the
# left fist on the hip; a no-look shot behind him
_OS = {'RightShoulder': [('Z', 10)], 'RightArm': [('Y', 50), ('X', -40)], 'RightForeArm': [('X', -110)],
       'Neck': [('Z', -40), ('Y', -4)], 'Head': [('Z', -26)], **_HAND_ON_HIP}
POSES['gun_lv_os_up'] = _gpose(6, _OS, {'RightArm': [('Y', 30), ('X', -50)], 'Neck': [('Z', -6)], 'Head': [('Z', -4)]})
POSES['gun_lv_os_aim'] = _gpose(6, _OS)
POSES['gun_lv_os_kick'] = _gpose(6, _OS, {'Spine2': [('X', 4)], 'Head': [('Z', -26), ('X', 6)]})
LIVE_AT.update({'gun_lv_os_up': [('Right', 'Spine2', (-.24, -.14, 1.36)), _HIPS_L],
                'gun_lv_os_aim': [('Right', 'Spine2', (-.31, .03, 1.4)), _HIPS_L],
                'gun_lv_os_kick': [('Right', 'Spine2', (-.31, .05, 1.43)), _HIPS_L]})
LIVE_GUN.update({'gun_lv_os_up': {'dir': (0, .2, 1)}, 'gun_lv_os_aim': {'dir': (-.42, 1, .36)},
                 'gun_lv_os_kick': {'dir': (-.42, 1, .36), 'spin': 26}})
ANIMS['over_shoulder'] = _routine(_DRAW + [('gun_draw_hip', 50), ('gun_lv_os_up', 70), ('~', .5, 50), ('gun_lv_os_aim', 420),
                                           ('gun_lv_os_kick', 70, 'shot'), ('gun_lv_os_aim', 300), ('gun_lv_os_up', 80),
                                           ('gun_draw_hip', 70)] + _HOME)

# ---- under_arm: the gun hand across the front, the wrist beside the left hip under the arm (carried by the hips), the
# barrel BACK past his left side; the left arm lifted clear, the head turned a little after it; a no-look shot behind
_UA = {'RightShoulder': [('Z', 14)], 'RightArm': [('Y', -20), ('X', -30), ('Z', 40)], 'RightForeArm': [('X', -60)],
       'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 14), ('X', -6)], 'LeftForeArm': [('X', -125)],
       'Neck': [('Z', 14)], 'Head': [('Z', 8)]}
POSES['gun_lv_ua_aim'] = _gpose(-8, _UA)
POSES['gun_lv_ua_kick'] = _gpose(-8, _UA, {'Spine2': [('X', 3)], 'Neck': [('Z', 18)]})
LIVE_AT.update({'gun_lv_ua_aim': [('Right', 'Hips', (.23, -.05, .93)), ('Left', 'Spine2', (.1, -.17, 1.15))],
                'gun_lv_ua_kick': [('Right', 'Hips', (.23, -.04, .94)), ('Left', 'Spine2', (.1, -.17, 1.15))]})
LIVE_GUN.update({'gun_lv_ua_aim': {'dir': (.28, 1, -.04)}, 'gun_lv_ua_kick': {'dir': (.28, 1, -.04), 'spin': 22}})
ANIMS['under_arm'] = _routine(_DRAW + [('gun_draw_hip', 60), ('~', .5, 50), ('gun_lv_ua_aim', 380), ('gun_lv_ua_kick', 70, 'shot'),
                                       ('gun_lv_ua_aim', 300), ('~', .5, 60), ('gun_draw_hip', 60)] + _HOME)

# ---- duelist: side-on (the stance turned 70 deg, feet in line), the gun raised muzzle-up by the cheek, lowered to arm's
# length on the target (wrists in his frame), the left fist on the small of the back; a shot, the salute
_DL_LEFT = ('Left', 'Hips', (.03, .25, .95))
POSES['gun_lv_dl_up'] = _gpose(70, {'Spine2': [('X', -3)], 'Neck': [('Z', -42), ('X', -4)], 'Head': [('Z', -28)],
                                    'RightArm': [('Y', -10), ('X', -40)], 'RightForeArm': [('X', -100)]})
POSES['gun_lv_dl_aim'] = _gpose(70, {'Spine2': [('X', -3)], 'Neck': [('Z', -42)], 'Head': [('Z', -28)],
                                     'RightArm': [('Y', -42), ('X', -80)], 'RightForeArm': [('X', -4)]})
POSES['gun_lv_dl_kick'] = _gpose(70, {'Spine2': [('X', -6)], 'Neck': [('Z', -42), ('X', -4)], 'Head': [('Z', -28)],
                                      'RightArm': [('Y', -42), ('X', -84)], 'RightForeArm': [('X', -8)]})
LIVE_AT.update({'gun_lv_dl_up': [('Right', None, (-.12, -.3, 1.36)), _DL_LEFT],
                'gun_lv_dl_aim': [('Right', None, (-.06, -.66, 1.3)), _DL_LEFT],
                'gun_lv_dl_kick': [('Right', None, (-.06, -.63, 1.35)), _DL_LEFT]})
LIVE_GUN.update({'gun_lv_dl_up': {'dir': (0, -.12, 1), 'up': (0, 1, 0)}, 'gun_lv_dl_aim': {'dir': (0, -1, .02)},
                 'gun_lv_dl_kick': {'dir': (0, -1, .02), 'spin': 22}})
ANIMS['duelist'] = _routine(_DRAW + [('~', .5, 60), ('gun_lv_dl_up', 600), ('~', .5, 50),
                                     ('gun_lv_dl_aim', 380), ('gun_lv_dl_kick', 70, 'shot'), ('gun_lv_dl_aim', 420),
                                     ('~', .5, 60), ('gun_lv_dl_up', 500), ('~', .5, 60), ('gun_draw_hip', 60)] + _HOME)

# ---- kneel: down on the right knee, two-handed (the left hand cupping the gun hand), two shots, up again
POSES['gun_lv_kn_down'] = _gpose(16, _arm(x=-30, fx=-60, sz=0), {'Spine': [('X', 10)]},
                                 legs={k: [(a, d * .55) for a, d in v] for k, v in _KNEEL.items()})
POSES['gun_lv_kn_aim'] = _gpose(-10, _AIM_ARM, _larm(x=-62, z=-30, fx=-30), {'Spine': [('X', 4)]}, legs=_KNEEL)
POSES['gun_lv_kn_kick'] = _gpose(-10, _arm(x=-78, fx=-8, sz=-8), _larm(x=-66, z=-30, fx=-30), {'Spine': [('X', 2)], 'Spine2': [('X', -4)]},
                                 legs=_KNEEL)
LIVE_AT.update({'gun_lv_kn_aim': [('Right', None, (-.09, -.47, 1.21))], 'gun_lv_kn_kick': [('Right', None, (-.09, -.45, 1.25))]})
LIVE_GUN.update({'gun_lv_kn_aim': {'dir': (0, -1, 0)}, 'gun_lv_kn_kick': {'dir': (0, -1, 0), 'spin': 20}})
LIVE_LEFT.update({'gun_lv_kn_aim': (-.04, -.09, -.03), 'gun_lv_kn_kick': (-.04, -.09, -.03)})
ANIMS['kneel'] = _routine(_DRAW + [('gun_draw_hip', 50), ('gun_lv_kn_down', 60), ('~', .5, 50), ('gun_lv_kn_aim', 360),
                                   ('gun_lv_kn_kick', 70, 'shot'), ('gun_lv_kn_aim', 380), ('gun_lv_kn_kick', 70, 'shot2'),
                                   ('gun_lv_kn_aim', 300), ('gun_lv_kn_down', 90), ('gun_draw_hip', 80)] + _HOME)

# ---- road_agent: drawn slowly, offered butt-first (hanging upside down off the trigger finger: spin 180), the left palm
# up ("easy now"), the head down; then rolled forward over the finger into the hand (270: muzzle down, 360: on him), a shot
_RA_LEFT = {'LeftShoulder': [('Z', 4)], 'LeftArm': [('Y', -6), ('X', -30)], 'LeftForeArm': [('X', -80)], 'LeftHand': [('X', 20)]}
POSES['gun_lv_ra_offer'] = _gpose(10, _arm(y=-40, x=-56, fx=-24, sz=-4), _RA_LEFT, {'Neck': [('Z', -6), ('X', 10)], 'Head': [('X', 6)]})
POSES['gun_lv_ra_flip'] = _gpose(16, _arm(y=-42, x=-64, fx=-14, sz=-6), _RA_LEFT, {'Neck': [('Z', -9), ('X', 2)]})
GUN_SPIN.update({'gun_lv_ra_offer': 180, 'gun_lv_ra_flip': 270})
ANIMS['road_agent'] = _routine([('idle_in', 90), ('gdraw_grab', 120, 'draw'), ('~', .5, 90), ('gun_draw_lift', 90),
                                ('~', .5, 90), ('gun_lv_ra_offer', 700), ('gun_lv_ra_flip', 40), ('~', .5, 30),
                                ('gun_aim', 70), ('gun_recoil_a', 60, 'shot'), ('gun_recoil_b', 60), ('gun_aim', 300),
                                ('~', .5, 60)] + _HOME)

# ---- toss: the revolver flipped up end over end off the hand (free in the air: LIVE_GUN air), the head following it,
# caught at chest height; a shot
_TOSS = {'RightArm': [('Y', -40), ('X', -46)], 'RightForeArm': [('X', -40)], 'Neck': [('X', -10)], 'Head': [('X', -8)]}
POSES['gun_lv_toss_up'] = _gpose(6, _arm(y=-40, x=-40, fx=-50, sz=-4))
POSES['gun_lv_toss_a'] = _gpose(6, _TOSS)
POSES['gun_lv_toss_b'] = _gpose(6, _TOSS, {'Neck': [('X', -16)], 'Head': [('X', -12)]})
POSES['gun_lv_toss_c'] = _gpose(6, _TOSS)
POSES['gun_lv_toss_catch'] = _gpose(10, _arm(y=-40, x=-58, fx=-30, sz=-4))
LIVE_GUN.update({'gun_lv_toss_up': {'spin': 50}, 'gun_lv_toss_a': {'air': (-.22, -.44, 1.5), 'dir': (0, -1, 0), 'spin': 150},
                 'gun_lv_toss_b': {'air': (-.21, -.43, 1.82), 'dir': (0, -1, 0), 'spin': 260},
                 'gun_lv_toss_c': {'air': (-.2, -.42, 1.5), 'dir': (0, -1, 0), 'spin': 350}, 'gun_lv_toss_catch': {}})
ANIMS['toss'] = _routine(_DRAW + [('gun_draw_hip', 60), ('gun_lv_toss_up', 60), ('gun_lv_toss_a', 60), ('gun_lv_toss_b', 80),
                                  ('gun_lv_toss_c', 60), ('gun_lv_toss_catch', 90), ('gun_aim', 90), ('gun_recoil_a', 60, 'shot'),
                                  ('gun_recoil_b', 60), ('gun_aim', 260), ('~', .5, 60)] + _HOME)

# ---- border_shift: the revolver tossed across in front of the chest into the LEFT hand, the stance turned the other way
# (left shoulder leading), a left-handed shot, tossed back, home
_L_AIM = {'LeftShoulder': [('Z', 6)], 'LeftArm': [('Y', 42), ('X', -72)], 'LeftForeArm': [('X', -4)]}
POSES['gun_lv_bs_pass'] = _gpose(0, _arm(y=-42, x=-40, fx=-60, sz=-2, z=20),
                                 {'LeftArm': [('Y', 40), ('X', -40), ('Z', -20)], 'LeftForeArm': [('X', -60)]})
POSES['gun_lv_bs_left'] = _gpose(-25, _L_AIM, _RIGHT_LOOSE, legs=mirrored(_GLEGS))
POSES['gun_lv_bs_kick'] = _gpose(-25, {'LeftShoulder': [('Z', 10)], 'LeftArm': [('Y', 42), ('X', -77)], 'LeftForeArm': [('X', -8)]},
                                 _RIGHT_LOOSE, {'Spine2': [('X', -6)]}, legs=mirrored(_GLEGS))
LIVE_GUN.update({'gun_lv_bs_pass': {'air': (0, -.4, 1.18), 'dir': (0, -1, 0), 'spin': 0},
                 'gun_lv_bs_left': {'hand': 'Left'}, 'gun_lv_bs_kick': {'hand': 'Left', 'spin': 26}})
ANIMS['border_shift'] = _routine(_DRAW + [('gun_draw_hip', 60), ('gun_lv_bs_pass', 70), ('~', .5, 50), ('gun_lv_bs_left', 330),
                                          ('gun_lv_bs_kick', 70, 'shot'), ('gun_lv_bs_left', 330), ('~', .5, 50),
                                          ('gun_lv_bs_pass', 70), ('gun_draw_hip', 70)] + _HOME)

# ---- pistol_whip: the gun raised high to the right (the chest turned away), brought down across the body in a lunge
# (mark hit), the follow-through low to the left; back to the hip
_PW_GUARD = {'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 30), ('X', -50)], 'LeftForeArm': [('X', -50)]}
POSES['gun_lv_pw_wind'] = _gpose(-25, {'RightShoulder': [('Z', -6), ('Y', 14)], 'RightArm': [('Y', 60), ('X', -10)],
                                       'RightForeArm': [('X', -100)], 'Spine': [('X', -4)]}, _PW_GUARD)
POSES['gun_lv_pw_hit'] = _gpose(22, {'Spine': [('X', 12)], 'RightArm': [('Y', -10), ('X', -80)], 'RightForeArm': [('X', -20)]},
                                _PW_GUARD, legs=_LUNGE)
POSES['gun_lv_pw_follow'] = _gpose(36, {'Spine': [('X', 18)], 'RightArm': [('Y', -40), ('X', -30), ('Z', 50)], 'RightForeArm': [('X', -30)],
                                        'LeftArm': [('Y', 40), ('X', 10)], 'LeftForeArm': [('X', -30)]}, legs=_LUNGE)
LIVE_AT.update({'gun_lv_pw_wind': [('Right', None, (-.27, .07, 1.62))], 'gun_lv_pw_hit': [('Right', None, (-.03, -.56, 1.3))],
                'gun_lv_pw_follow': [('Right', None, (.2, -.36, .86))]})
LIVE_GUN.update({'gun_lv_pw_wind': {'dir': (-.12, .4, 1)}, 'gun_lv_pw_hit': {'dir': (.15, -.55, -.8)},
                 'gun_lv_pw_follow': {'dir': (.55, -.2, -.85)}})
ANIMS['pistol_whip'] = _routine(_DRAW + [('gun_draw_hip', 60), ('~', .5, 60), ('gun_lv_pw_wind', 240), ('~', .5, 30),
                                         ('gun_lv_pw_hit', 50, 'hit'), ('~', .5, 40), ('gun_lv_pw_follow', 200), ('~', .5, 90),
                                         ('gun_draw_hip', 90)] + _HOME)

# ---- sky_shot: the gun straight up beside the hat brim, the left fist on the hip, two shots into the air
POSES['gun_lv_sky'] = _gpose(10, {'RightShoulder': [('Z', -14)], 'RightArm': [('Y', 80), ('X', -20)], 'RightForeArm': [('X', -10)],
                                  'Neck': [('X', -6)], **_HAND_ON_HIP})
POSES['gun_lv_sky_kick'] = _gpose(10, {'RightShoulder': [('Z', -14)], 'RightArm': [('Y', 80), ('X', -20)], 'RightForeArm': [('X', -10)],
                                       'Neck': [('X', -10)], **_HAND_ON_HIP})
LIVE_AT.update({'gun_lv_sky': [('Right', None, (-.36, -.1, 1.66)), _HIPS_L], 'gun_lv_sky_kick': [('Right', None, (-.36, -.07, 1.69)), _HIPS_L]})
LIVE_GUN.update({'gun_lv_sky': {'dir': (-.18, -.12, 1), 'up': (0, 1, 0)}, 'gun_lv_sky_kick': {'dir': (-.18, -.12, 1), 'up': (0, 1, 0), 'spin': 20}})
ANIMS['sky_shot'] = _routine(_DRAW + [('gun_draw_hip', 60), ('~', .5, 60), ('gun_lv_sky', 300), ('gun_lv_sky_kick', 70, 'shot'),
                                      ('gun_lv_sky', 320), ('gun_lv_sky_kick', 70, 'shot2'), ('gun_lv_sky', 300), ('~', .5, 70),
                                      ('gun_draw_hip', 70)] + _HOME)

# ---- point_blank: a step in, leaning over a foe on the ground, the gun pointed down at him; a shot
POSES['gun_lv_pb_aim'] = _gpose(16, _arm(y=-42, x=-40, fx=-6, sz=-4), {'Spine': [('X', 16)], 'Spine1': [('X', 6)], 'Neck': [('X', -8)],
                                                                         'Head': [('X', 14)]}, legs=_LUNGE)
POSES['gun_lv_pb_kick'] = _gpose(16, _arm(y=-42, x=-50, fx=-10, sz=-6), {'Spine': [('X', 13)], 'Spine1': [('X', 6)], 'Neck': [('X', -8)],
                                                                          'Head': [('X', 12)]}, legs=_LUNGE)
LIVE_GUN.update({'gun_lv_pb_aim': {'dir': (0, -.7, -1)}, 'gun_lv_pb_kick': {'dir': (0, -.7, -1), 'spin': 22}})
ANIMS['point_blank'] = _routine(_DRAW + [('gun_draw_hip', 60), ('~', .5, 70), ('gun_lv_pb_aim', 480), ('gun_lv_pb_kick', 70, 'shot'),
                                         ('gun_lv_pb_aim', 500), ('~', .5, 80), ('gun_draw_hip', 70)] + _HOME)

# ---- turn_shot: turned by _post on the hips (the specs' world-axis rotations stay as built facing forward), drawing on the
# turn: the grab at 70 deg, the gun out at the hip at 130, the aim at 180 (a shot), back round with the twirl
_turned = lambda key, deg, **kw: {**POSES[key], **kw, '_post': [('Hips', deg)] + POSES[key].get('_post', [])}
POSES['lv_ts_grab'] = _turned('gdraw_grab', -70)
REACH['lv_ts_grab'] = REACH['gdraw_grab']
POSES['gun_lv_ts_hip'] = _turned('gun_draw_hip', -130)
POSES['gun_lv_ts_aim'] = _turned('gun_aim', -180)
POSES['gun_lv_ts_kick'] = _turned('gun_recoil_a', -180)
POSES['gun_lv_ts_back'] = _turned('gun_spin_1', -90)
GUN_SPIN.update({'gun_lv_ts_kick': GUN_SPIN['gun_recoil_a'], 'gun_lv_ts_back': GUN_SPIN['gun_spin_1']})
ANIMS['turn_shot'] = _routine([('idle_in', 90), ('~', .5, 50), ('lv_ts_grab', 50, 'draw'), ('~', .5, 40), ('gun_lv_ts_hip', 40),
                               ('~', .5, 40), ('gun_lv_ts_aim', 60), ('gun_lv_ts_kick', 60, 'shot'), ('gun_lv_ts_aim', 380),
                               ('~', .5, 60), ('gun_lv_ts_back', 60)] + _HOME[2:])

# ---- the COMBAT versions, rendered into the gunslinger's atlas (the sim plays them: sim/player/gun.js; the routines above
# are the live demos). gun_turnshot: a draw at a target behind him while he stands: from the ready idle (the sim starts at
# frame 1, mid-turn), the spin over the right shoulder, the shot at the end of it (mark shot), ending on the aim turned
# 180 deg, i.e. gun_aim at the opposite facing, where the sim turns his facing round and the gun's ready state takes
# over. gun_whip: the pistol whip from the aim (V; the empty cylinder's click with a foe in reach): the wind-up, the blow
# (mark hit: the sim's melee lands), the follow-through, back to the aim.
ANIMS['gun_turnshot'] = _routine([('idle_in', 40), ('~', .5, 40), ('lv_ts_grab', 40, 'grab'), ('~', .5, 35), ('gun_lv_ts_hip', 35),
                                  ('~', .5, 35), ('gun_lv_ts_aim', 50), ('gun_lv_ts_kick', 60, 'shot'), ('~', .5, 50),
                                  ('gun_lv_ts_aim', 60)])
ANIMS['gun_whip'] = _routine([('gun_aim', 40), ('~', .5, 40), ('gun_lv_pw_wind', 70), ('~', .5, 30), ('gun_lv_pw_hit', 50, 'hit'),
                              ('~', .5, 50), ('gun_lv_pw_follow', 90), ('~', .5, 60), ('gun_aim', 70)])


# ================================================================ the live gunplay: stances and draws (live only) ======
# Combat for the LIVE hero (src/view/livehero.js COMBAT STYLE): the poses he shoots FROM, picked by the view each time the
# gun comes out (how far the target is, whether he is moving) and changed as the fight goes (he stops, he sets off, a few
# shots in), each aimed at the cursor by the live hero's spine twist; and the draws that bring the gun into them. Clips
# named cb_* (combat): the live hero keeps them out of the Shift+9 emotes. Exported with ragdoll_export.py --clips.
#   cb_st_aim     the standing aim (gun_aim), breathing
#   cb_st_hip     low and wide, the gun at the hip (the quickdraw's hip shot): up close, and his upper body on the run
#   cb_st_crouch  knees bent deep, leaning in, the arm out, the free hand toward the knee: steady
#   cb_st_duel    side-on, feet in line, at arm's length, the free fist on the small of the back (the duelist's)
#   cb_st_kneel   down on the right knee, two-handed (the kneel's)
#   cb_dr_*       a draw into a stance: hip (straight to the hip), sweep (out wide to his right, then onto him), spin
#                 (twirled out of the holster), high (up by the cheek, lowered at arm's length: the duel), kneel (dropping
#                 onto the knee), crouch
COMBAT_LIVE = ('cb_st_aim', 'cb_st_hip', 'cb_st_crouch', 'cb_st_duel', 'cb_st_kneel',
               'cb_dr_hip', 'cb_dr_sweep', 'cb_dr_spin', 'cb_dr_high', 'cb_dr_kneel', 'cb_dr_crouch')


def _like(new, src, extra=None):
    """POSES[new] = POSES[src] with `extra` rotations after its own, and src's way of holding (the hook tables)."""
    spec = {k: (list(v) if isinstance(v, list) else v) for k, v in POSES[src].items()}
    for k, v in (extra or {}).items():
        spec[k] = spec.get(k, []) + v
    POSES[new] = spec
    for T in (LIVE_AT, LIVE_GUN, LIVE_LEFT, GUN_SPIN, REACH, LEFT_TO_GUN):
        if src in T:
            T[new] = T[src]


# the stances: each a key and its breath (the chest 2 deg lower), looped slowly
_BREATH = {'Spine2': [('X', 2)]}
_DEEP = {'LeftUpLeg': [('X', -42), ('Y', -10)], 'LeftLeg': [('X', 64)], 'LeftFoot': [('X', -20)],
         'RightUpLeg': [('X', -24), ('Y', 10)], 'RightLeg': [('X', 58)], 'RightFoot': [('X', -28), ('Z', 10)]}
POSES['gun_cb_crouch_a'] = _gpose(_BLADE, _AIM_ARM, {'LeftArm': [('Y', 28), ('X', -38)], 'LeftForeArm': [('X', -36)]},
                                  legs=_DEEP, lean=16)
for _s, _src in (('aim', 'gun_aim'), ('hip', 'gun_lv_qd_hip'), ('crouch', 'gun_cb_crouch_a'), ('duel', 'gun_lv_dl_aim'),
                 ('kneel', 'gun_lv_kn_aim')):
    if _src != f'gun_cb_{_s}_a':
        _like(f'gun_cb_{_s}_a', _src)
    _like(f'gun_cb_{_s}_b', f'gun_cb_{_s}_a', _BREATH)
    ANIMS[f'cb_st_{_s}'] = _clip([f'gun_cb_{_s}_a', f'gun_cb_{_s}_b'], [0, 1], 2, loop=True)

# the draws (the view plays one over the sim's draw, by its progress: their fps is nominal)
POSES['gun_cb_sw_out'] = _gpose(12, {'RightShoulder': [('Y', 6)], 'RightArm': [('Y', 40), ('X', -20)], 'RightForeArm': [('X', -20)]},
                                lean=4)
LIVE_GUN['gun_cb_sw_out'] = {'dir': (-.8, -.3, .5)}   # (out to his right, the muzzle up)
ANIMS['cb_dr_hip'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_cb_hip_a'], [0, .5, 1, 1.5, 2], 32)
ANIMS['cb_dr_sweep'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_cb_sw_out', 'gun_cb_aim_a'], [0, 1, 1.5, 2, 2.5, 3], 32)
ANIMS['cb_dr_spin'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_spin_1', 'gun_spin_2', 'gun_spin_3', 'gun_cb_aim_a'],
                            [0, 1, 2, 3, 4, 4.5, 5], 32)
ANIMS['cb_dr_high'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_lv_dl_up', 'gun_cb_duel_a'], [0, 1, 1.5, 2, 2.5, 3], 32)
ANIMS['cb_dr_kneel'] = _clip(['gdraw_grab', 'gun_lv_kn_down', 'gun_cb_kneel_a'], [0, .5, 1, 1.5, 2], 32)
ANIMS['cb_dr_crouch'] = _clip(['gdraw_grab', 'gun_draw_lift', 'gun_cb_crouch_a'], [0, 1, 1.5, 2], 32)


# ================================================================ the gunplay's new angles (atlas + live) =============
# Aiming on the move where the bladed aim and its torso twists (-90..+45) can't reach without turning the legs: the gun
# back over the right shoulder (ob: a target behind him to his right), back past the left side under the arm (ub: behind
# him to his left), across the chest to his left (cx). Each is an upper body over every walk / run frame, named like the
# aim's twist families (gws_<fam>_<i> / grs_<fam>_<i>): the sim scores them by their rendered barrels and shoots from
# their muzzles (sim/player/gun.js movingAim, TWX), so they are rendered into the atlases (pixel_rig.py --append --poses);
# the live hero draws them too (its spine twist trims their aim a little).
ANGLE_FAMS = ('ob', 'ub', 'cx')
ANGLE_POSES = [f'{pre}_{fam}_{i}' for fam in ANGLE_FAMS for pre in ('gws', 'grs') for i in range(8)]
_ANGLES = {
    # over the shoulder: the gun hand by the right ear (carried by the chest), the barrel back and a little out, near
    # level; the head turned back over the shoulder; the free arm loose
    'ob': (6, {k: v for k, v in _OS.items() if not k.startswith('Left')}, [('Right', 'Spine2', (-.31, .03, 1.38))],
           {'dir': (-.35, 1, .1)}),
    # under the arm: the gun hand across to the left hip (carried by the hips), the barrel back past the left side, the
    # left forearm lifted clear (its wrist on the chest), the head turned a little after it
    'ub': (-8, _UA, [('Right', 'Hips', (.23, -.05, .93)), ('Left', 'Spine2', (.1, -.17, 1.15))], {'dir': (.3, 1, -.04)}),
    # across the body: square, the right arm across the chest, the gun out past the left shoulder (the wrist carried by
    # the chest), the head turned left onto the target
    'cx': (0, {'RightShoulder': [('Z', 14)], 'RightArm': [('Y', -20), ('X', -60), ('Z', 40)], 'RightForeArm': [('X', -30)],
               'Neck': [('Z', 40)], 'Head': [('Z', 24)]}, [('Right', 'Spine2', (.24, -.3, 1.24))], {'dir': (1, -.12, .02)}),
}
for _fam, (_blade, _spec, _at, _gun) in _ANGLES.items():
    POSES[f'gun_ang_{_fam}'] = _gpose(_blade, _spec)   # (standing, for looking at it)
    LIVE_AT[f'gun_ang_{_fam}'], LIVE_GUN[f'gun_ang_{_fam}'] = _at, _gun
    _up = _upper(POSES[f'gun_ang_{_fam}'], _blade)
    for _i in range(8):
        for _pre, _c in (('gws', 'walk'), ('grs', 'run')):
            POSES[f'{_pre}_{_fam}_{_i}'] = _on_legs(_i, _up, _c)
            LIVE_AT[f'{_pre}_{_fam}_{_i}'], LIVE_GUN[f'{_pre}_{_fam}_{_i}'] = _at, _gun


# ================================================================ live movement (the live hero only) =================
# The jumps redone for the live model: the leap over water, the fall, the landings, the vault over a wall's breach and the
# scramble up a ledge. The atlas's leap (4 keys), fall and land (one pose each) keep serving the sprites; these are
# exported with ragdoll_export.py --clips (MOVE_LIVE) and the live hero picks their frames from the sim's state and its
# progress (view/livehero.js MOTION), not by time. No root motion (the sim moves and lifts him): every key is snapped to
# the ground like the atlas's (_air 0), the sim's arc puts him in the air.
#   mv_leap     push off (the lead knee driven up, the back leg extended), rise (both legs fold), the top (a split stride in
#               the air, arms out), coming down (the front leg reaching, heel first), reaching for the ground
#   mv_fall     arms flailing loosely, legs paddling (a loop), then reaching for the ground (mv_fall_reach)
#   mv_land     a running landing (the front leg takes it, the back one already swinging through) -> mv_land_soft;
#               a big drop: deep into the knees, the chest over them, then coming up (mv_land_hard)
#   mv_vault    a tuck vault: both hands reach for the stones, plant on them as the knees tuck up to the chest, the legs
#               swing through and over, reaching down on the far side
#   mv_climb    up a ledge: both hands onto the lip, the chest over it and a knee up, the foot on, standing up
MOVE_LIVE = ('mv_leap', 'mv_fall', 'mv_land_soft', 'mv_land_hard', 'mv_vault', 'mv_climb')
def _mv_legs(lu, ll, lf, ru, rl, rf):
    """skeleton.py's _legs (its name is a loop's variable by the end of skeleton.py): thigh X- forward, shin X+ bent, foot X+ toe down."""
    return {'LeftUpLeg': [('X', lu)], 'LeftLeg': [('X', ll)], 'LeftFoot': [('X', lf)],
            'RightUpLeg': [('X', ru)], 'RightLeg': [('X', rl)], 'RightFoot': [('X', rf)]}


_MV_LEAN = lambda a, n=None: {'Spine': [('X', a)], 'Spine1': [('X', a * .45)], 'Neck': [('X', -a * .8 if n is None else n)]}
POSES['mv_lp_push'] = _merge(_mv_legs(-72, 96, 8, 26, 12, 40), _arms(32, -72, -30, -64, lower=28), _MV_LEAN(14))
POSES['mv_lp_rise'] = _merge(_mv_legs(-82, 104, 2, 12, 74, 34), _arms(-14, -96, -44, -56, lower=38), _MV_LEAN(8))
POSES['mv_lp_top'] = _merge(_mv_legs(-62, 54, -6, 30, 94, 22), _arms(-8, -42, -34, -40, lower=62), _MV_LEAN(4, 0))
POSES['mv_lp_down'] = _merge(_mv_legs(-48, 20, -16, 8, 66, 12), _arms(-28, 12, -32, -30, lower=52), _MV_LEAN(1, 6))
POSES['mv_lp_reach'] = _merge(_mv_legs(-34, 16, -12, -12, 36, -4), _arms(-40, -18, -36, -30, lower=42), _MV_LEAN(6, 8))
# landings: running (one leg takes it) and a big drop (both, deep)
POSES['mv_land_run'] = _merge(_mv_legs(-26, 46, -12, 22, 66, 8), _arms(26, -46, -30, -52, lower=34), _MV_LEAN(16))
POSES['mv_land_deep'] = _merge(_mv_legs(-84, 120, -36, -66, 108, -40), _arms(-48, -36, -40, -46, lower=26), _MV_LEAN(34),
                               {'LeftUpLeg': [('Y', -12)], 'RightUpLeg': [('Y', 12)]})
POSES['mv_land_up'] = _merge(_mv_legs(-38, 62, -22, -26, 52, -22), _arms(-16, -10, -32, -30, lower=34), _MV_LEAN(14))
# the fall: two loose keys looped, and the reach before the ground
POSES['mv_fall_a'] = _merge(_mv_legs(-34, 56, 14, 6, 44, 22), _MV_LEAN(-6, 18),
                            {'LeftArm': [('Y', -64), ('X', -40)], 'LeftForeArm': [('X', -30)], 'RightArm': [('Y', 58), ('X', 34)], 'RightForeArm': [('X', -36)]})
POSES['mv_fall_b'] = _merge(_mv_legs(-14, 40, 20, -26, 64, 10), _MV_LEAN(-3, 14),
                            {'LeftArm': [('Y', -40), ('X', 20)], 'LeftForeArm': [('X', -44)], 'RightArm': [('Y', 70), ('X', -36)], 'RightForeArm': [('X', -24)]})
POSES['mv_fall_reach'] = _merge(_mv_legs(-30, 30, -10, -14, 40, -8), _arms(-30, -30, -30, -30, lower=56), _MV_LEAN(6, 12))
# the vault: hands on the stones ahead at hip height (LIVE_AT, his frame before the snap: the hips at .76), knees tucked
POSES['mv_vt_reach'] = _merge(_mv_legs(-40, 44, -10, 28, 52, 24), _arms(-62, -62, -24, -24, lower=22), _MV_LEAN(24))
POSES['mv_vt_plant'] = _merge(_mv_legs(-104, 124, -10, -96, 120, -14), _arms(-50, -50, -14, -14, lower=20), _MV_LEAN(30))
POSES['mv_vt_over'] = _merge(_mv_legs(-74, 44, -12, -60, 60, -10), _arms(20, 20, -16, -16, lower=24), _MV_LEAN(8))
POSES['mv_vt_drop'] = _merge(_mv_legs(-32, 22, -12, -10, 40, -6), _arms(-30, -20, -30, -30, lower=46), _MV_LEAN(6, 8))
LIVE_AT['mv_vt_plant'] = [('Left', None, (.19, -.34, .66)), ('Right', None, (-.19, -.34, .66))]
LIVE_AT['mv_vt_over'] = [('Left', None, (.2, .1, .78)), ('Right', None, (-.2, .1, .78))]
# up a ledge: both hands up on the lip, then the chest over (the atlas's mantle_0), a knee onto it, standing up on it
POSES['mv_cl_reach'] = _merge(_mv_legs(-24, 36, -8, 10, 30, 14), _arms(-130, -130, -20, -20, lower=18), _MV_LEAN(8, -20))
POSES['mv_cl_knee'] = _merge(_mv_legs(-100, 124, -4, 6, 20, 30), _arms(-30, -30, -60, -60, lower=26), _MV_LEAN(34))
POSES['mv_cl_stand'] = _merge(_mv_legs(-42, 58, -16, 14, 40, 20), _arms(10, -20, -30, -34, lower=34), _MV_LEAN(14))
LIVE_AT['mv_cl_reach'] = [('Left', None, (.2, -.3, 1.62)), ('Right', None, (-.2, -.3, 1.62))]
ANIMS['mv_leap'] = _clip(['mv_lp_push', 'mv_lp_rise', 'mv_lp_top', 'mv_lp_down', 'mv_lp_reach'], [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4], 18)
ANIMS['mv_fall'] = _clip(['mv_fall_a', 'mv_fall_b', 'mv_fall_reach'], [0, .5, 1, 1.5, 2], 8, marks={'loop_end': 3})
ANIMS['mv_land_soft'] = _clip(['mv_lp_reach', 'mv_land_run', 'rn_down'], [1, 1.5, 2], 24)
ANIMS['mv_land_hard'] = _clip(['mv_fall_reach', 'mv_land_deep', 'mv_land_up', 'idle_in'], [1, 1.5, 2, 2.5, 3], 14)
ANIMS['mv_vault'] = _clip(['mv_vt_reach', 'mv_vt_plant', 'mv_vt_over', 'mv_vt_drop'], [0, .5, 1, 1.5, 2, 2.5, 3], 12)
ANIMS['mv_climb'] = _clip(['mv_cl_reach', 'mantle_0', 'mv_cl_knee', 'mv_cl_stand'], [0, 1, 1.5, 2, 2.5, 3], 12)


# ================================================================ adaptive jumps (the live hero only) =================
# The moves Space picks by the obstacle (sim/player/player.js JUMP; docs/exp/livereact.md), made for the live model only and
# exported with ragdoll_export.py --clips (JUMP_LIVE: tools/blender/live_export.mjs --add). The live hero picks their frames
# from the vault's or the leap's progress and puts the hands (and the feet) on the real top at run time: the heights here
# are a typical one. Their marks: plant / free (frames: the hands on the obstacle from plant until free; the hand the sim's
# `side` names, both for two-handed moves: hands 2), step (the frame the lead foot is planted on the top from)
#   mv_step     up a low ledge at a run, no hands: the lead foot up onto it, the push up over it, the back leg through
#   mv_knee     up a ledge to the hip: the left hand on the lip, the right knee onto it, up over the knee, standing
#               (mv_knee_r: the same on the other side, mirrored())
#   mv_hop      a speed vault over low stones: the left hand on them, the legs swung past on its right, landing running
#               (mv_hop_r: the other hand)
#   mv_over     over a high wall: both hands on top, a knee up onto it, crouched on top, down the far side
#   mv_long     a long jump: the push, two hitch-kicks in the air (the arms wheeling), the legs out in front, reaching
#   mv_catch    a short leap's end: hanging from the far bank's lip by both hands, pulling up, the chest over, a knee, up
JUMP_LIVE = ('mv_step', 'mv_knee', 'mv_knee_r', 'mv_hop', 'mv_hop_r', 'mv_over', 'mv_long', 'mv_catch')
# up a low ledge: the lead (left) foot lifted high and planted on the top, the body pushed up over it, the back leg through
POSES['mv_st_lift'] = _merge(_mv_legs(-78, 96, 6, 24, 22, 34), _arms(30, -50, -28, -70, lower=30), _MV_LEAN(12))
POSES['mv_st_plant'] = _merge(_mv_legs(-56, 64, -14, 18, 30, 24), _arms(20, -36, -26, -60, lower=30), _MV_LEAN(18))
POSES['mv_st_push'] = _merge(_mv_legs(-24, 30, -10, 26, 64, 10), _arms(-10, -10, -30, -40, lower=32), _MV_LEAN(16))
POSES['mv_st_through'] = _merge(_mv_legs(-8, 16, -6, -46, 80, -12), _arms(-30, 26, -50, -24, lower=32), _MV_LEAN(10))
ANIMS['mv_step'] = _clip(['mv_st_lift', 'mv_st_plant', 'mv_st_push', 'mv_st_through', 'rn_contact'], [0, 1, 2, 3, 4], 16, marks={'step': 1})
# up a ledge to the hip: the left hand reaching for the lip, the right knee driven up onto it, up over the knee, standing
POSES['mv_kn_reach'] = _merge(_mv_legs(-14, 30, -8, -70, 100, 10), _arms(-70, 30, -16, -40, lower=24), _MV_LEAN(22))
POSES['mv_kn_plant'] = _merge(_mv_legs(12, 34, 20, -92, 124, -6), _arms(-56, 36, -10, -50, lower=22), _MV_LEAN(34))
POSES['mv_kn_rise'] = _merge(_mv_legs(-62, 100, -10, -36, 60, -14), _arms(-30, 10, -40, -40, lower=28), _MV_LEAN(20))
ANIMS['mv_knee'] = _clip(['mv_kn_reach', 'mv_kn_plant', 'mv_kn_rise', 'mv_cl_stand'], [0, 1, 2, 3], 8, marks={'plant': 1, 'free': 3, 'step': 1})
for _k in ('mv_kn_reach', 'mv_kn_plant', 'mv_kn_rise'):
    POSES[_k + '_r'] = mirrored(POSES[_k])
ANIMS['mv_knee_r'] = _clip(['mv_kn_reach_r', 'mv_kn_plant_r', 'mv_kn_rise_r', 'mv_cl_stand'], [0, 1, 2, 3], 8, marks={'plant': 1, 'free': 3, 'step': 1})
# a speed vault: the left hand down on the stones, the pelvis turned to the right so the tucked legs pass on that side, the
# chest over the hand, the right arm out; the right leg reaching down for the ground beyond; running on
POSES['mv_hp_reach'] = _merge(_mv_legs(8, 20, 24, -56, 70, 10), _arms(-74, -20, -14, -60, lower=26), _MV_LEAN(20), {'Hips': [('Z', -15)]})
POSES['mv_hp_over'] = _merge(_mv_legs(-80, 96, 0, -70, 110, 4), _arms(-60, -40, -6, -30, lower=24), _MV_LEAN(14),
                             {'Hips': [('Z', -40)], 'Spine1': [('Z', 20), ('Y', 12)], 'RightArm': [('Y', -40)]})
POSES['mv_hp_down'] = _merge(_mv_legs(-40, 30, -12, -10, 60, -8), _arms(-30, 20, -30, -30, lower=40), _MV_LEAN(8), {'Hips': [('Z', -15)]})
ANIMS['mv_hop'] = _clip(['mv_hp_reach', 'mv_hp_over', 'mv_hp_down', 'rn_contact'], [0, 1, 2, 3], 10, marks={'plant': 0, 'free': 2})
for _k in ('mv_hp_reach', 'mv_hp_over', 'mv_hp_down'):
    POSES[_k + '_r'] = mirrored(POSES[_k])
ANIMS['mv_hop_r'] = _clip(['mv_hp_reach_r', 'mv_hp_over_r', 'mv_hp_down_r', 'rn_contact'], [0, 1, 2, 3], 10, marks={'plant': 0, 'free': 2})
# over a high wall: both hands up on its top, the chest over with a knee up (the climb's), crouched on the stones, down the
# far side reaching for the ground
POSES['mv_ov_reach'] = _merge(_mv_legs(-24, 36, -8, 10, 30, 14), _arms(-100, -100, -20, -20, lower=18), _MV_LEAN(12))
POSES['mv_ov_top'] = _merge(_mv_legs(-96, 130, -30, -80, 125, -26), _arms(-50, -50, -40, -40, lower=22), _MV_LEAN(30))
POSES['mv_ov_drop'] = _merge(_mv_legs(-40, 50, -10, -10, 70, 10), _arms(-30, -30, -40, -40, lower=50), _MV_LEAN(4))
LIVE_AT['mv_ov_reach'] = [('Left', None, (.2, -.3, 1.2)), ('Right', None, (-.2, -.3, 1.2))]
ANIMS['mv_over'] = _clip(['mv_ov_reach', 'mv_cl_knee', 'mv_ov_top', 'mv_ov_drop', 'mv_fall_reach'], [0, 1, 2, 3, 4], 8, marks={'plant': 0, 'free': 3, 'hands': 2})
# a long jump: the leap's push, two hitch-kicks (the legs cycling, the arms wheeling the other way), sailing with both legs
# coming forward and the arms up, the legs out in front and the chest over them, reaching
POSES['mv_lj_kick_a'] = _merge(_mv_legs(-70, 60, -4, 40, 80, 20), _arms(40, -120, -30, -20, lower=40), _MV_LEAN(2))
POSES['mv_lj_kick_b'] = _merge(_mv_legs(40, 80, 20, -70, 60, -4), _arms(-120, 40, -20, -30, lower=40), _MV_LEAN(0))
POSES['mv_lj_sail'] = _merge(_mv_legs(-70, 40, -10, -60, 60, -6), _arms(-150, -150, -20, -20, lower=40), _MV_LEAN(-6, 4))
POSES['mv_lj_reach'] = _merge(_mv_legs(-84, 14, -14, -78, 22, -10), _arms(-40, -40, -30, -30, lower=40), _MV_LEAN(32))
ANIMS['mv_long'] = _clip(['mv_lp_push', 'mv_lj_kick_a', 'mv_lj_kick_b', 'mv_lj_sail', 'mv_lj_reach'], [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4], 18)
# hanging from the far bank's lip (arms up, the legs hanging), pulling up (elbows down, a knee up), then the climb's own
POSES['mv_ca_hang'] = _merge(_mv_legs(6, 20, 30, -4, 30, 34), _arms(-160, -160, -14, -14, lower=20), _MV_LEAN(-4, -16))
POSES['mv_ca_pull'] = _merge(_mv_legs(-50, 80, 10, 4, 30, 30), _arms(-130, -130, -90, -90, lower=30), _MV_LEAN(10, -8))
LIVE_AT['mv_ca_hang'] = [('Left', None, (.2, -.22, 1.95)), ('Right', None, (-.2, -.22, 1.95))]
LIVE_AT['mv_ca_pull'] = [('Left', None, (.22, -.28, 1.45)), ('Right', None, (-.22, -.28, 1.45))]
ANIMS['mv_catch'] = _clip(['mv_ca_hang', 'mv_ca_pull', 'mantle_0', 'mv_cl_knee', 'mv_cl_stand'], [0, 1, 2, 3, 4], 8, marks={'plant': 0, 'free': 3, 'hands': 2})


# ================================================================ getting up (the live hero only) ====================
# Thrown by a blast (sim/player/launch.js; docs/exp/launch.md) he lies where his ragdoll left him (view/herorag.js) and gets
# up with these, made for the live model only (GETUP_LIVE: tools/blender/live_export.mjs --add). The view picks one by how he
# lies and plays it by the sim's get-up progress, turned to the way his body lies. Each starts lying with the pelvis over the
# pivot (Hips X -90: on his back, the head behind him; +90: on his front, the head before him), so the ragdoll's last pose
# blends into the first key in place, and ends standing (facing his feet from his back, his head from his front). By the
# kneel key (3 of 5: 60% in) the weight is over the front foot: a held direction runs him out of it from there.
#   mv_getup_b  on his back: sits up on both hands planted behind him, turns over his right hip onto his left knee with the
#               right hand on the ground, kneels (the right foot planted, the hand on the knee), pushes up, stands
#   mv_getup_f  face down: the hands by the shoulders, a push-up, the knees drawn under him (on all fours), the right foot
#               forward with the hands coming off the ground, pushes up, stands
# The hands' points are in his frame before the ground snap (LIVE_AT: hips at .76), each on the ground the pose snaps to.
GETUP_LIVE = ('mv_getup_b', 'mv_getup_f')
POSES['gu_b_lie'] = _merge({'Hips': [('X', -86)], 'Neck': [('X', 30)], 'Head': [('X', 22)]},   # (the head up: the hat off the ground)
                           _mv_legs(-14, 22, 12, -6, 12, 14), {'LeftArm': [('Z', -28)], 'RightArm': [('Z', 24)], 'LeftForeArm': [('X', -14)], 'RightForeArm': [('X', -18)]})
POSES['gu_b_sit'] = _merge({'Hips': [('X', -40)], 'Spine': [('X', 12)], 'Spine1': [('X', 6)], 'Neck': [('X', 10)]},
                           _mv_legs(-90, 84, 46, -80, 76, 44), _arms(46, 46, -18, -18, lower=30))
# (turned 38 deg to his right: the spine's bend about his own left axis, as world X and Y parts)
POSES['gu_b_tuck'] = _merge({'Hips': [('X', -6), ('Y', -30), ('Z', -38)], 'Spine': [('X', 36), ('Y', -30)], 'Spine1': [('X', 16), ('Y', -12)],
                             'Neck': [('X', -18), ('Y', 12)]},
                            _mv_legs(-30, 118, 60, -96, 100, 6), _arms(-34, -40, -40, -24, lower=30))
POSES['gu_b_kneel'] = _merge({'Hips': [('Z', -14)], 'Spine': [('X', 16)], 'Spine1': [('X', 6)], 'Neck': [('X', -10)]},
                             _mv_legs(-4, 94, 60, -88, 90, 0), _arms(-28, -40, -44, -60, lower=32))
LIVE_AT['gu_b_sit'] = [('Left', None, (.26, .2, .66)), ('Right', None, (-.26, .2, .66))]
LIVE_AT['gu_b_tuck'] = [('Right', None, (-.42, -.16, .4))]
LIVE_AT['gu_b_kneel'] = [('Right', None, (-.12, -.33, .8))]
POSES['gu_f_lie'] = _merge({'Hips': [('X', 86)], 'Neck': [('X', -40)], 'Head': [('X', -14), ('Z', 18)]},   # (the head up: the brim off the ground)
                           _mv_legs(4, 10, 20, 8, 14, 22))
POSES['gu_f_push'] = _merge({'Hips': [('X', 86)], 'Spine': [('X', -26)], 'Spine1': [('X', -18)], 'Neck': [('X', -12)]},   # (the hips stay down: the chest up on the arms)
                            _mv_legs(2, 8, 26, 4, 10, 26))
POSES['gu_f_fours'] = _merge({'Hips': [('X', 80)], 'Spine': [('X', 4)], 'Neck': [('X', -30)]},
                             _mv_legs(-80, 96, 70, -84, 100, 70), _arms(-70, -70, -16, -16, lower=34))
POSES['gu_f_kneel'] = _merge({'Hips': [('X', 34)], 'Spine': [('X', 10)], 'Neck': [('X', -36)]},
                             _mv_legs(-36, 104, 60, -118, 118, -30), _arms(-50, -60, -30, -50, lower=32))
LIVE_AT['gu_f_lie'] = [('Left', None, (.34, -.56, .68)), ('Right', None, (-.34, -.56, .68))]
LIVE_AT['gu_f_push'] = [('Left', None, (.24, -.46, .66)), ('Right', None, (-.24, -.46, .66))]
LIVE_AT['gu_f_fours'] = [('Left', None, (.22, -.58, .43)), ('Right', None, (-.22, -.58, .43))]
LIVE_AT['gu_f_kneel'] = [('Right', None, (-.16, -.4, .62))]
_GU_TW = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
ANIMS['mv_getup_b'] = _clip(['gu_b_lie', 'gu_b_sit', 'gu_b_tuck', 'gu_b_kneel', 'mv_land_up', 'idle_in'], _GU_TW, 14, marks={'run': 6})
ANIMS['mv_getup_f'] = _clip(['gu_f_lie', 'gu_f_push', 'gu_f_fours', 'gu_f_kneel', 'mv_land_up', 'idle_in'], _GU_TW, 14, marks={'run': 6})


# ================================================================ brawl (live only: docs/exp/brawl.md) ====
# The kick, the shoulder barge, lifting / carrying / throwing, the zip down a rope (the live cowboys: BRAWL_LIVE), and the
# called shots' reactions (the live gunmen: BRAWL_FOES), made for the live models only and exported with ragdoll_export.py
# --clips (the cowboys: tools/blender/live_export.mjs --add; the gunmen: ragdoll_export.py into pivot3d_chars/<type>). The
# game reads these names and marks; a model without a clip falls back to an atlas pose. Every key here holds the revolver
# in its holster unless its name starts with gun_ (the stagger's: the gun in the hand, as gun_aim holds it).
#   mv_kick        a front push-kick with the right leg: weight onto the left, the knee chambered, the leg driven out (hit:
#                  the sole forward at belt height, leaning back, arms out), the knee pulled back, the foot set down a short
#                  step ahead (plant), settling toward idle
#   mv_barge       a shoulder charge out of a sprint: turned to his right so the left shoulder leads, the left arm tucked
#                  across the chest, head down, a driving lunge (hit), back up into the run's lean (the last frame = run.0)
#   mv_lift        squat (the back fairly straight), both hands onto the sides of a box / barrel on the ground ahead (grab),
#                  rising into the carry hold
#   mv_carry       the hold standing: the load in both hands before the belly, elbows bent, a slight lean back; a breath
#   mv_carry_walk  walk.<i>'s legs under the hold (the walk's own ground data, copied from the atlas: BRAWL_GAIT)
#   mv_carry_run   run.<i>'s legs under the hold, a heavier jog (the run's ground data)
#   mv_throw       a two-handed heave from the hold: a dip, driving up, the release forward-up on his toes (release),
#                  the follow-through, settling toward idle
#   mv_zip         hanging by both fists from a line above (RopeHand0 at the lasso hang's grip height, LASSO_HANG), leaning
#                  back, the knees drawn forward; a small sway. The arms rise in front of the brim, so the hat stays on
#   fx_pickup      a gunman stoops (hips and knees, the left hand on the left knee) and picks a thing up off the ground ahead
#                  with the right hand (grab: the fingertips just over the ground), up again with it at the belt
#   fx_hat_on      the left hand lifts the hat back onto the head (on: the hat is shown from here) and lets go
#   fx_stagger     shot in the leg: the right knee buckles, the left hand clutches the right thigh, the gun arm flung out,
#                  a hop on the left foot, recovering (back)
#   fx_sting       the gun shot out of his hand: the right hand jerked back and up, shaken twice, the body flinching to his
#                  right, the left hand over to hold the right wrist (back)
#   fx_limp        a limping walk (the walk's ground data) favouring the right leg: short stiff steps on it, dipping on it
# The kit: BRAWL_AT puts a fist (or a wrist, or the fingertips) on a point after the spec (two-bone IK, two passes); a
# point in his frame (bone None) has its height over the GROUND the pose snaps to (measured before the snap, the arms left
# out), so a hand at .3 m is .3 m over the ground whatever the knees do; a bone's name carries a rest-space point with it.
# After it the revolver is put back where its hook put it (the holster on the posed thigh, or the hand), and again after a
# clip's in-between blend (the blend carried the holstered gun on the moving hand). _root (the foes' hook) keeps the feet
# where they stood while the hips go back in a squat. The bruiser's coach gun is not re-posed here: it hangs from his right
# fist as built (the game hides it in fx_pickup and fx_sting). Contact sheets and probes: tmp/brawl/.
import json
BRAWL_LIVE = ('mv_kick', 'mv_lift', 'mv_carry', 'mv_carry_walk', 'mv_carry_run', 'mv_throw', 'mv_barge', 'mv_zip')
BRAWL_FOES = ('fx_pickup', 'fx_hat_on', 'fx_stagger', 'fx_sting', 'fx_limp')
BRAWL_AT = {}     # pose key -> [(side, bone | None | '.', (x, y, z) m at 1.8 m, 'fist' | 'wrist' | 'tip')] ('.': his frame
                  # before the snap, as LIVE_AT's None: the hips at .76)
BRAWL_GAIT = {}   # clip -> the atlas clip whose ground data (fps, loop, planted, advance, stride, contacts) it takes
_ZIP_KEYS = ('bw_zip_a', 'bw_zip_b')
_ZIP_FIT = {}


def _bw_ground():
    """The ground the pose will snap to, before the snap: the lowest point of what the snap counts, the arms left out."""
    import numpy as np
    skip = set(_arm_parts())
    dg = bpy.context.evaluated_depsgraph_get()
    lo = 1e9
    for ob in bpy.data.collections[COL].objects:
        base = ob.name.split('.')[0]
        if ob.type != 'MESH' or ob.hide_render or base in SOFT_PARTS or base in skip:
            continue
        oe = ob.evaluated_get(dg)
        me = oe.to_mesh()
        if len(me.vertices):
            a = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get('co', a)
            Mw = np.array(oe.matrix_world)
            lo = min(lo, float((a.reshape(-1, 3) @ Mw[2, :3] + Mw[2, 3]).min()))
        oe.to_mesh_clear()
    return lo


def _bw_regun(pose_name):
    """The revolver where its hook puts it for this pose (the holster on the posed right thigh, or the hand)."""
    if any(g in LOADOUT for g in GUN_ITEMS) and 'GunHold0' in bpy.data.objects[ROOT].pose.bones:
        _gun_hold(pose_name)


def _bw_hold(pose_name):
    """HOLD hook (last): a brawl key's hands onto their points (BRAWL_AT), then the revolver put back."""
    at = BRAWL_AT.get(_key(pose_name))
    if not at:
        return
    pbs = bpy.data.objects[ROOT].pose.bones
    k = PROP['height'] / 1.8
    g = _bw_ground() if any(b is None for _, b, _, _ in at) else 0.0
    for _ in range(2):   # (a fist's point is set back along the hand, whose direction the reach changes: twice)
        for side, bone, p, mode in at:
            t = (Vector(p) * k + Vector((0, 0, g)) if bone is None else Vector(p) * k if bone == '.' else
                 _carried(bone, Vector(p) * k))
            hd = pbs[side + 'Hand']
            _reach(side, t - (hd.tail - hd.head) * {'wrist': 0.0, 'fist': .5, 'tip': 1.0}[mode])
    _bw_regun(pose_name)


def _zip_fit():
    """The zip's keys lifted (_air) so the right fist's grip (RopeHand0) is at the lasso hang's grip height above the
    pivot in both (the same rope height as the hang: LASSO_HANG['grip'])."""
    arm = bpy.data.objects[ROOT]
    if 'RopeHand0' not in arm.pose.bones:
        return
    if 'grip' not in LASSO_HANG:
        _hang_fit()
    for k in _ZIP_KEYS:
        POSES[k]['_air'] = 0.0
        _pose_key(k)
        _ZIP_FIT[k] = _grip_z()
    for k in _ZIP_KEYS:
        POSES[k]['_air'] = LASSO_HANG['grip'] - _ZIP_FIT[k]
    _ZIP_FIT['grip'] = LASSO_HANG['grip']
    print('ZIP grip (RopeHand0)', round(LASSO_HANG['grip'], 4), 'm above the pivot; snapped:',
          {k: round(_ZIP_FIT[k], 4) for k in _ZIP_KEYS})


_pose_brawl = pose


def pose(name):
    """The pose() above; a brawl clip's in-between (and the live movement's, the jumps' and the get-ups') gets its
    revolver put back (the blend carried it on the hand); the zip fits its grip height first."""
    clip, _, i = name.partition('.')
    if (name in _ZIP_KEYS or clip == 'mv_zip') and 'grip' not in _ZIP_FIT:
        _zip_fit()
    zmin = _pose_brawl(name)
    if i and clip in BRAWL_LIVE + BRAWL_FOES + MOVE_LIVE + JUMP_LIVE + GETUP_LIVE:
        _bw_regun(name)
    return zmin


_build_brawl = build


def build():
    """The builds above, then the brawl keys' hand hook after every other."""
    names = _build_brawl()
    if _bw_hold not in HOLD_HOOKS:
        HOLD_HOOKS.append(_bw_hold)
    return names


_clips_meta_brawl = clips_meta


def clips_meta():
    """The clips above; a gait clip (BRAWL_GAIT) takes its source's ground data from the atlas (--atlas: poses.json), so it
    plays exactly as the walk / run it walks on (without the atlas: as measured from its own frames)."""
    out = _clips_meta_brawl()
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    src = {}
    if '--atlas' in a:
        p = os.path.join(a[a.index('--atlas') + 1], 'poses.json')
        if os.path.exists(p):
            src = json.load(open(p)).get('clips', {})
    for c, s in BRAWL_GAIT.items():
        if c in out and s in src:
            out[c].update({k: src[s][k] for k in ('fps', 'loop', 'planted', 'advance', 'stride', 'contacts', 'contact_foot')
                           if k in src[s]})
    return out


def _bw_legs(hips, thighs, shins, feet):
    """Legs by their WORLD angles about X under a pelvis tipped `hips` (+ forward): thighs (L, R) from straight down (-
    forward), shins (L, R) (+ the foot behind the knee), feet (L, R) (+ toe down; 0 = flat). The spec's own angles are
    relative (each rotation lands on its parent's)."""
    out = {'Hips': [('X', hips)]}
    for i, s in enumerate(('Left', 'Right')):
        out[s + 'UpLeg'] = [('X', thighs[i] - hips)]
        out[s + 'Leg'] = [('X', shins[i] - thighs[i])]
        out[s + 'Foot'] = [('X', feet[i] - shins[i])]
    return out


def _bw_spine(spine, s1=0.0, neck=0.0, head=0.0, turn=None):
    """The back bent `spine` / `s1` (+ forward), the neck and head (relative), turn: (spine, spine1, spine2, neck, head)
    about Z (+ toward his left)."""
    out = {'Spine': [('X', spine)], 'Spine1': [('X', s1)], 'Neck': [('X', neck)], 'Head': [('X', head)]}
    if turn:
        for b, z in zip(('Spine', 'Spine1', 'Spine2', 'Neck', 'Head'), turn):
            if z:
                out[b] = [('Z', z)] + out.get(b, [])
    return out


def _bw_over(base, over, *bends):
    """`base` with the bones of `over` replaced, then `bends` added to it (_merge: after the bone's own rotations)."""
    spec = {k: (list(v) if isinstance(v, list) else v) for k, v in base.items()}
    spec.update({k: list(v) for k, v in over.items()})
    return _merge(spec, *bends)


# ---- the kick: the right leg; the left stands. Torso leaning back at the contact (pelvis -10, spine -12: ~20 deg)
_KK_ARMS = lambda la, ra, lfa, rfa, lower=22: _arms(la, ra, lfa, rfa, lower=lower)
POSES['bw_kk_load'] = _merge(_bw_legs(0, (-4, -34), (10, 6), (0, 14)), _bw_spine(-2, 0, 2), _KK_ARMS(-24, 18, -30, -24, 30),
                             {'Hips': [('Y', 4)]})
POSES['bw_kk_chamber'] = _merge(_bw_legs(-6, (-2, -100), (12, -8), (0, 10)), _bw_spine(-4, -2, 10),
                                _KK_ARMS(-50, 34, -36, -24))
POSES['bw_kk_extend'] = _merge(_bw_legs(-8, (-4, -98), (10, -60), (0, -56)), _bw_spine(-6, -2, 12),
                               _KK_ARMS(-62, 40, -30, -22), {'Hips': [('Z', 6)], 'Spine': [('Z', -4)]})
POSES['bw_kk_hit'] = _merge(_bw_legs(-10, (-4, -103), (10, -101), (0, -97)), _bw_spine(-8, -3, 18),
                            _KK_ARMS(-74, 46, -28, -20, 18), {'Hips': [('Z', 12)], 'Spine': [('Z', -8)]})
POSES['bw_kk_hold'] = _merge(_bw_legs(-9, (-4, -103), (10, -98), (0, -94)), _bw_spine(-7, -3, 16),
                             _KK_ARMS(-68, 42, -30, -22, 20), {'Hips': [('Z', 10)], 'Spine': [('Z', -6)]})
POSES['bw_kk_recoil'] = _merge(_bw_legs(-4, (-2, -84), (12, 4), (0, 6)), _bw_spine(-2, 0, 6), _KK_ARMS(-40, 26, -34, -26, 26))
POSES['bw_kk_plant'] = _merge(_bw_legs(2, (12, -24), (16, -6), (0, 0)), _bw_spine(4, 1, -4), _KK_ARMS(-6, 6, -30, -28, 34))
ANIMS['mv_kick'] = _clip(['bw_kk_load', 'bw_kk_chamber', 'bw_kk_extend', 'bw_kk_hit', 'bw_kk_hold', 'bw_kk_recoil', 'bw_kk_plant',
                          'idle_in'], [0, 1, 2, 3, 4, 5, 6, 6.6], 18, marks={'hit': 3, 'plant': 6})

# ---- the lift: a squat with the back fairly straight (the pelvis tipped forward), the feet kept under him (_root: the
# hips go back as the knees go forward), both fists onto the load's sides ahead; up into the carry hold
_CARRY_AT = [('Left', 'Spine2', (.24, -.40, 1.0), 'fist'), ('Right', 'Spine2', (-.24, -.40, 1.0), 'fist')]   # (-> +-.24, -.36, 1.05)
_CARRY_ARMS = _arms(-40, -40, -95, -95, lower=26)
POSES['bw_carry_a'] = _merge(_bw_legs(-2, (-6, -6), (4, 4), (0, 0)), _bw_spine(-4, -2, 4), _CARRY_ARMS)
POSES['bw_carry_b'] = _merge(_bw_legs(-2, (-6, -6), (4, 4), (0, 0)), _bw_spine(-4, -2, 4), _CARRY_ARMS, {'Spine2': [('X', -2)]})
BRAWL_AT['bw_carry_a'] = BRAWL_AT['bw_carry_b'] = _CARRY_AT
_LIFT_ARMS = _arms(-60, -60, -20, -20, lower=24)
POSES['bw_lf_bend'] = _merge(_bw_legs(18, (-40, -40), (24, 24), (0, 0)), _bw_spine(6, 2, -16), _arms(-30, -30, -30, -30, 28),
                             {'LeftUpLeg': [('Y', -6)], 'RightUpLeg': [('Y', 6)], '_root': (0, .08)})
POSES['bw_lf_squat'] = _merge(_bw_legs(34, (-80, -80), (32, 32), (0, 0)), _bw_spine(6, 2, -30), _LIFT_ARMS,
                              {'LeftUpLeg': [('Y', -10)], 'RightUpLeg': [('Y', 10)], '_root': (0, .16)})
POSES['bw_lf_grab'] = _merge(_bw_legs(38, (-86, -86), (34, 34), (0, 0)), _bw_spine(6, 2, -32), _LIFT_ARMS,
                             {'LeftUpLeg': [('Y', -10)], 'RightUpLeg': [('Y', 10)], '_root': (0, .17)})
POSES['bw_lf_rise'] = _merge(_bw_legs(26, (-56, -56), (28, 28), (0, 0)), _bw_spine(4, 1, -24), _LIFT_ARMS,
                             {'LeftUpLeg': [('Y', -8)], 'RightUpLeg': [('Y', 8)], '_root': (0, .11)})
POSES['bw_lf_up'] = _merge(_bw_legs(8, (-22, -22), (14, 14), (0, 0)), _bw_spine(0, 0, -8), _CARRY_ARMS, {'_root': (0, .04)})
BRAWL_AT.update({'bw_lf_squat': [('Left', None, (.25, -.43, .40), 'fist'), ('Right', None, (-.25, -.43, .40), 'fist')],
                 'bw_lf_grab': [('Left', None, (.22, -.45, .30), 'fist'), ('Right', None, (-.22, -.45, .30), 'fist')],
                 'bw_lf_rise': [('Left', None, (.22, -.43, .58), 'fist'), ('Right', None, (-.22, -.43, .58), 'fist')],
                 'bw_lf_up': [('Left', None, (.23, -.39, .88), 'fist'), ('Right', None, (-.23, -.39, .88), 'fist')]})
ANIMS['mv_lift'] = _clip(['idle_in', 'bw_lf_bend', 'bw_lf_squat', 'bw_lf_grab', 'bw_lf_rise', 'bw_lf_up', 'bw_carry_a'],
                         [0, 1, 2, 3, 4, 5, 6], 14, marks={'grab': 3})
ANIMS['mv_carry'] = _clip(['bw_carry_a', 'bw_carry_b'], [0, 1], 3, loop=True)

# ---- carrying on the move: the gait's legs (and its ground data) under the hold, the chest steady (_stable)
_CARRY_UP = {k: v for k, v in POSES['bw_carry_a'].items() if k not in LEG_BONES and not k.startswith('_')}
for _i in range(8):
    for _g, _c in (('bw_cw', 'walk'), ('bw_cr', 'run')):
        POSES[f'{_g}_{_i}'] = _on_legs(_i, _CARRY_UP, _c)
        BRAWL_AT[f'{_g}_{_i}'] = _CARRY_AT
ANIMS['mv_carry_walk'] = dict(_clip([f'bw_cw_{i}' for i in range(8)], list(range(8)), 10, loop=True), locomotion=True)
ANIMS['mv_carry_run'] = dict(_clip([f'bw_cr_{i}' for i in range(8)], list(range(8)), 13, loop=True), locomotion=True)
BRAWL_GAIT.update({'mv_carry_walk': 'walk', 'mv_carry_run': 'run'})

# ---- the throw: from the hold, a dip, driving up, the release forward-up on his toes, the follow-through
POSES['bw_th_dip'] = _merge(_bw_legs(10, (-34, -34), (24, 24), (0, 0)), _bw_spine(2, 0, -6), _CARRY_ARMS, {'_root': (0, .05)})
POSES['bw_th_drive'] = _merge(_bw_legs(2, (-10, -10), (8, 8), (10, 10)), _bw_spine(-2, -1, 0), _arms(-70, -70, -40, -40, 24))
POSES['bw_th_release'] = _merge(_bw_legs(4, (-2, -2), (2, 2), (34, 34)), _bw_spine(10, 3, -16), _arms(-100, -100, -14, -14, 22))
POSES['bw_th_follow'] = _merge(_bw_legs(6, (-6, 8), (8, 16), (14, 26)), _bw_spine(10, 4, -12), _arms(-80, -80, -16, -16, 24))
POSES['bw_th_settle'] = _merge(_bw_legs(4, (-6, 6), (8, 12), (0, 6)), _bw_spine(6, 2, -6), _arms(-30, -30, -24, -24, 30))
BRAWL_AT.update({'bw_th_dip': [('Left', None, (.23, -.30, .82), 'fist'), ('Right', None, (-.23, -.30, .82), 'fist')],
                 'bw_th_drive': [('Left', None, (.22, -.42, 1.12), 'fist'), ('Right', None, (-.22, -.42, 1.12), 'fist')],
                 'bw_th_release': [('Left', None, (.21, -.58, 1.47), 'fist'), ('Right', None, (-.21, -.58, 1.47), 'fist')]})
ANIMS['mv_throw'] = _clip(['bw_carry_a', 'bw_th_dip', 'bw_th_drive', 'bw_th_release', 'bw_th_follow', 'bw_th_settle', 'idle_in'],
                          [0, 1, 2, 3, 4, 5, 5.6], 16, marks={'release': 3})

# ---- the barge: turned 55 deg to his right (the pelvis 25, the back the rest: the chest at ~55 with the lean), the left
# shoulder leading, the left forearm across the chest, the head down and turned back to the way he runs; a lunge on the
# left leg, the right driving behind
_BG_TUCK = {'LeftShoulder': [('Z', -8)], 'LeftArm': [('Y', 24), ('X', -36), ('Z', -20)], 'LeftForeArm': [('X', -100)]}
_BG_BACK = {'RightShoulder': [('Z', 4)], 'RightArm': [('Y', -36), ('X', 34)], 'RightForeArm': [('X', -40)]}
POSES['bw_bg_low'] = _merge(_bw_legs(14, (-40, 24), (10, 50), (-10, 40)), _bw_spine(10, 4, -8, -4, turn=(-14, -10, -6, 18, 8)),
                            {'Hips': [('Z', -14)]}, _BG_TUCK, _BG_BACK)
POSES['bw_bg_drive'] = _merge(_bw_legs(20, (-56, 30), (6, 40), (-16, 50)), _bw_spine(12, 4, -6, 6, turn=(-12, -8, -5, 27, 14)),
                              {'Hips': [('Z', -25)]}, _BG_TUCK, _BG_BACK)
POSES['bw_bg_hit'] = _merge(_bw_legs(22, (-62, 34), (2, 44), (-18, 56)), _bw_spine(14, 4, -4, 10, turn=(-11, -7, -4, 26, 14)),
                            {'Hips': [('Z', -26)]}, _BG_TUCK, _BG_BACK, {'LeftArm': [('X', -10)]})
POSES['bw_bg_back'] = _merge(_bw_legs(16, (-40, 30), (20, 60), (-10, 30)), _bw_spine(10, 4, -10, 0, turn=(-8, -6, -2, 16, 6)),
                             {'Hips': [('Z', -12)]}, _arms(20, -20, -60, -70, lower=30))
BRAWL_AT.update({k: [('Left', 'Spine2', (-.04, -.25, 1.10), 'fist')] for k in ('bw_bg_low', 'bw_bg_drive', 'bw_bg_hit')})
ANIMS['mv_barge'] = _clip(['bw_bg_low', 'bw_bg_drive', 'bw_bg_hit', 'bw_bg_back', ANIMS['run']['keys'][0]], [0, 1, 2, 3, 3.5, 4], 16,
                          marks={'hit': 2})

# ---- the zip: hanging by both fists from a line over him, leaning back 25 deg (the legs forward of the pelvis, knees
# bent and drawn up), the arms rising in front of the face to the line (they pass before the brim: the hat stays on); the
# fists one before the other on the line; a sway between the keys
_ZIP_ARMS = {'LeftShoulder': [('Y', -30)], 'RightShoulder': [('Y', 30)],
             'LeftArm': [('Y', 30), ('X', -100)], 'RightArm': [('Y', -30), ('X', -100)],
             'LeftForeArm': [('X', -14)], 'RightForeArm': [('X', -14)]}
POSES['bw_zip_a'] = _merge(_bw_legs(-20, (-48, -38), (-8, 0), (24, 32)), _bw_spine(-2, 0, 4, 2), _ZIP_ARMS)
POSES['bw_zip_b'] = _merge(_bw_legs(-23, (-54, -46), (-12, -6), (26, 30)), _bw_spine(-1, 0, 5, 2), _ZIP_ARMS,
                           {'Hips': [('Y', 2)]})
# (the fists carried by the chest: before the brim's front edge and under it, the head in line with the back, the hat
# tipped back 10 deg on it: the sombrero's rolled front edge clears the fists)
BRAWL_AT.update({k: [('Right', 'Spine2', (-.04, -.42, 1.55), 'fist'), ('Left', 'Spine2', (.04, -.50, 1.48), 'fist')] for k in _ZIP_KEYS})
LASSO_HAT.update({k: 10 for k in _ZIP_KEYS})
ANIMS['mv_zip'] = _clip(list(_ZIP_KEYS), [0, 1], 4, loop=True)

# ---- the gunmen: picking up, the hat back on, the leg shot, the stung hand, the limp
_KNEE_L = ('Left', 'LeftUpLeg', (.11, -.10, .44), 'fist')       # the left palm on the left thigh above the knee
POSES['fx_pk_bend'] = _merge(_bw_legs(24, (-40, -40), (24, 24), (0, 0)), _bw_spine(6, 2, -14), _arms(-10, -40, -40, -20, 30),
                             {'_root': (0, .07)})
POSES['fx_pk_stoop'] = _merge(_bw_legs(44, (-70, -70), (30, 30), (0, 0)), _bw_spine(10, 4, -26), _arms(-10, -70, -40, -14, 30),
                              {'LeftUpLeg': [('Y', -6)], 'RightUpLeg': [('Y', 6)], '_root': (0, .13)})
POSES['fx_pk_reach'] = _merge(_bw_legs(54, (-82, -82), (32, 32), (0, 0)), _bw_spine(14, 5, -32), _arms(-10, -84, -40, -10, 30),
                              {'LeftUpLeg': [('Y', -8)], 'RightUpLeg': [('Y', 8)], '_root': (0, .15)}, {'RightHand': [('X', 50)]})
POSES['fx_pk_grab'] = _merge(_bw_legs(58, (-86, -86), (34, 34), (0, 0)), _bw_spine(16, 6, -34), _arms(-10, -88, -40, -10, 30),
                             {'LeftUpLeg': [('Y', -8)], 'RightUpLeg': [('Y', 8)], '_root': (0, .16)}, {'RightHand': [('X', 56)]})
POSES['fx_pk_lift'] = _merge(_bw_legs(36, (-60, -60), (28, 28), (0, 0)), _bw_spine(8, 3, -24), _arms(-10, -60, -40, -30, 30),
                             {'LeftUpLeg': [('Y', -6)], 'RightUpLeg': [('Y', 6)], '_root': (0, .11)})
POSES['fx_pk_rise'] = _merge(_bw_legs(14, (-26, -26), (14, 14), (0, 0)), _bw_spine(4, 1, -10), _arms(-4, -30, -30, -60, 32),
                             {'_root': (0, .04)})
POSES['fx_pk_up'] = _merge(_bw_legs(0, (-4, -4), (4, 4), (0, 0)), _bw_spine(0, 0, 2), _arms(4, -10, -24, -70, 34))
BRAWL_AT.update({'fx_pk_bend': [_KNEE_L, ('Right', None, (-.16, -.32, .45), 'tip')],
                 'fx_pk_stoop': [_KNEE_L, ('Right', None, (-.14, -.40, .22), 'tip')],
                 'fx_pk_reach': [_KNEE_L, ('Right', None, (-.14, -.46, .17), 'fist')],
                 'fx_pk_grab': [_KNEE_L, ('Right', None, (-.14, -.46, .12), 'fist')],
                 'fx_pk_lift': [_KNEE_L, ('Right', None, (-.15, -.38, .35), 'fist')],
                 'fx_pk_rise': [('Right', None, (-.19, -.27, .66), 'fist')],
                 'fx_pk_up': [('Right', None, (-.17, -.19, .82), 'fist')]})
ANIMS['fx_pickup'] = _clip(['idle_in', 'fx_pk_bend', 'fx_pk_stoop', 'fx_pk_reach', 'fx_pk_grab', 'fx_pk_lift', 'fx_pk_rise', 'fx_pk_up'],
                           [0, 1, 2, 3, 4, 5, 6, 7], 12, marks={'grab': 4})

POSES['fx_ho_low'] = _bw_over(POSES['idle_in'], {'LeftArm': [('Y', 30), ('X', -40)], 'LeftForeArm': [('X', -70)]}, _bw_spine(2, 0, 10, 6))
POSES['fx_ho_up'] = _bw_over(POSES['idle_in'], {'LeftArm': [('Y', -20), ('X', -70)], 'LeftForeArm': [('X', -60)]}, _bw_spine(0, 0, -4, -2))
POSES['fx_ho_on'] = _bw_over(POSES['idle_in'], {'LeftArm': [('Y', 0), ('X', -60)], 'LeftForeArm': [('X', -100)]}, _bw_spine(2, 0, 12, 8))
POSES['fx_ho_off'] = _bw_over(POSES['idle_in'], {'LeftArm': [('Y', 20), ('X', -50)], 'LeftForeArm': [('X', -60)]}, _bw_spine(0, 0, 4, 2))
BRAWL_AT.update({'fx_ho_low': [('Left', None, (.14, -.36, 1.02), 'fist')],
                 'fx_ho_up': [('Left', None, (.10, -.30, 1.62), 'fist')],
                 'fx_ho_on': [('Left', 'Head', (.07, -.31, 1.70), 'fist')],
                 'fx_ho_off': [('Left', None, (.26, -.36, 1.28), 'fist')]})
ANIMS['fx_hat_on'] = _clip(['fx_ho_low', 'fx_ho_up', 'fx_ho_on', 'fx_ho_off'], [0, 1, 2, 3], 10, marks={'on': 2})

_THIGH_R = ('Left', 'RightUpLeg', (-.08, -.11, .55), 'fist')    # the left hand clutching the front of the right thigh
_FLUNG = lambda y, x, fx: {'RightShoulder': [('Z', -4)], 'RightArm': [('Y', y), ('X', x)], 'RightForeArm': [('X', fx)]}
POSES['gun_fx_st_hit'] = _merge(_bw_legs(10, (-18, 2), (16, 62), (0, 40)), _bw_spine(14, 4, -12, 0), _FLUNG(0, -16, -20),
                                {'Hips': [('Y', -6)]})
POSES['gun_fx_st_drop'] = _merge(_bw_legs(16, (-36, -2), (28, 90), (0, 60)), _bw_spine(18, 6, -16, 4), _FLUNG(6, -10, -16),
                                 {'Hips': [('Y', -8)]})
POSES['gun_fx_st_lurch'] = _merge(_bw_legs(12, (-32, 8), (24, 84), (0, 60)), _bw_spine(14, 4, -12, 2), _FLUNG(10, -4, -14),
                                  {'Hips': [('Y', 4)], 'Spine': [('Y', 6)]})
POSES['gun_fx_st_hop'] = _merge(_bw_legs(8, (-14, 14), (8, 86), (22, 60)), _bw_spine(10, 3, -8, 0), _FLUNG(12, -4, -12),
                                {'Hips': [('Y', 6)], 'Spine': [('Y', 4)], '_air': .06})
POSES['gun_fx_st_land'] = _merge(_bw_legs(12, (-32, 4), (24, 70), (0, 50)), _bw_spine(12, 4, -10, 0), _FLUNG(8, -8, -16),
                                 {'Hips': [('Y', 4)]})
POSES['gun_fx_st_steady'] = _merge(_bw_legs(8, (-18, -6), (14, 46), (0, 24)), _bw_spine(8, 2, -6, 0), _FLUNG(-10, -30, -16))
POSES['gun_fx_st_back'] = _merge(_bw_legs(4, (-10, 2), (8, 10), (0, 2)), _bw_spine(4, 1, -4, 0), _arm(y=-30, x=-50, fx=-10, sz=-4),
                                 _LEFT_LOOSE)
BRAWL_AT.update({k: [_THIGH_R] for k in ('gun_fx_st_hit', 'gun_fx_st_drop', 'gun_fx_st_lurch', 'gun_fx_st_hop', 'gun_fx_st_land',
                                         'gun_fx_st_steady')})
ANIMS['fx_stagger'] = _clip(['gun_fx_st_hit', 'gun_fx_st_drop', 'gun_fx_st_lurch', 'gun_fx_st_hop', 'gun_fx_st_land',
                             'gun_fx_st_steady', 'gun_fx_st_back', 'gun_aim'], [0, 1, 2, 3, 4, 5, 6, 6.6], 14, marks={'back': 6})

_FLINCH = {'Spine': [('Y', -8), ('Z', -12)], 'Spine1': [('Y', -4), ('Z', -6)], 'Neck': [('Z', -10), ('X', 6)], 'Head': [('Z', -6)]}
_WRIST_R = ('Left', 'RightForeArm', (-.52, -.03, .87), 'fist')   # the left hand round the right wrist
_R_UP = {'RightShoulder': [('Z', -10), ('Y', 10)], 'RightArm': [('Y', -30), ('X', 20)], 'RightForeArm': [('X', -120)]}
_R_IN = {'RightShoulder': [('Z', -8)], 'RightArm': [('Y', -34), ('X', -10)], 'RightForeArm': [('X', -100)]}
_LEFT_IN = lambda y, x, fx, z=0: {'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', y), ('X', x)] + ([('Z', z)] if z else []),
                                   'LeftForeArm': [('X', fx)], 'LeftHand': []}
POSES['fx_sg_jerk'] = _bw_over(POSES['idle_in'], {**_R_UP, 'RightHand': [('X', -20)], **_LEFT_IN(14, -36, -40)}, _FLINCH)
POSES['fx_sg_shake_a'] = _bw_over(POSES['idle_in'], {**_R_UP, 'RightHand': [('X', 50)], **_LEFT_IN(12, -44, -56)}, _FLINCH)
POSES['fx_sg_shake_b'] = _bw_over(POSES['idle_in'], {**_R_UP, 'RightHand': [('X', -40)], **_LEFT_IN(10, -48, -70)}, _FLINCH)
POSES['fx_sg_take'] = _bw_over(POSES['idle_in'], {**_R_IN, 'RightHand': [('X', 40)], **_LEFT_IN(10, -40, -80, -20)},
                               {'Spine': [('X', 8), ('Y', -6), ('Z', -10)], 'Neck': [('X', 6), ('Z', -8)]})
POSES['fx_sg_hold'] = _bw_over(POSES['idle_in'], {**_R_IN, 'RightHand': [('X', 10)], **_LEFT_IN(10, -40, -80, -20)},
                               {'Spine': [('X', 14), ('Y', -4), ('Z', -8)], 'Spine1': [('X', 4)], 'Neck': [('X', 4), ('Z', -6)]})
POSES['fx_sg_back'] = _bw_over(POSES['idle_in'], {**_R_IN, 'RightHand': [('X', 10)], **_LEFT_IN(16, -30, -70, -20)},
                               {'Spine': [('X', 6), ('Z', -4)], 'Neck': [('Z', -2)]})
BRAWL_AT.update({'fx_sg_jerk': [('Right', None, (-.33, .07, 1.17), 'wrist')],
                 'fx_sg_shake_a': [('Right', None, (-.36, .03, 1.05), 'wrist')],
                 'fx_sg_shake_b': [('Right', None, (-.33, .07, 1.15), 'wrist')],
                 'fx_sg_take': [('Right', None, (-.20, -.25, 1.08), 'wrist'), _WRIST_R],
                 'fx_sg_hold': [('Right', None, (-.13, -.27, .97), 'wrist'), _WRIST_R],
                 'fx_sg_back': [('Right', None, (-.16, -.24, .91), 'wrist'), _WRIST_R]})
ANIMS['fx_sting'] = _clip(['fx_sg_jerk', 'fx_sg_shake_a', 'fx_sg_shake_b', 'fx_sg_take', 'fx_sg_hold', 'fx_sg_back'],
                          [0, 1, 2, 3, 4, 5], 14, marks={'back': 5})

# the limp: walk.<i> with the right leg stiff and short through its stance (frames 4-7: the right foot planted), the body
# dipping and leaning over it there, a quick step through on the left
for _i in range(8):
    _w = expand(POSES[ANIMS['walk']['keys'][_i]])
    _sp = {k: list(v) for k, v in _w.items() if not k.startswith('_')}
    if _i >= 4:   # on the bad leg (walk's planted foot: L in 0-3, R in 4-7): the knee gives, the hips and chest dip over it
        _sp['RightLeg'] = _sp.get('RightLeg', []) + [('X', 10)]
        _sp['RightFoot'] = _sp.get('RightFoot', []) + [('X', -10)]
        _sp['Hips'] = _sp.get('Hips', []) + [('Y', -6)]
        _sp['Spine'] = _sp.get('Spine', []) + [('Y', -6), ('X', 5)]
        _sp['Neck'] = _sp.get('Neck', []) + [('Y', 6), ('X', -3)]
    elif _i:      # swinging it through: stiff (the knee kept straight), short, the hip hitched and the leg swung out
        _sp['RightLeg'] = [(a, d * .45) for a, d in _sp.get('RightLeg', [])]
        _sp['RightUpLeg'] = [(a, d * .75) for a, d in _sp.get('RightUpLeg', [])] + [('Y', 6)]
        _sp['Hips'] = _sp.get('Hips', []) + [('Y', 4)]
        _sp['Spine'] = _sp.get('Spine', []) + [('X', 2), ('Y', -2)]
    else:         # (the heel strike on the good leg: the bad one still pushing off behind)
        _sp['Spine'] = _sp.get('Spine', []) + [('X', 2)]
    POSES[f'fx_lp_{_i}'] = _sp
ANIMS['fx_limp'] = dict(_clip([f'fx_lp_{i}' for i in range(8)], list(range(8)), 10, loop=True), locomotion=True)
BRAWL_GAIT['fx_limp'] = 'walk'


# ================================================================ idles and context moves (the live hero only) =========
# What he does standing still (docs/exp/livereact.md IDLES; exported with --clips IDLE_LIVE: live_export.mjs --add). The
# live hero picks them itself and plays them by their own timing (play / ms; marks.loop: the step a looping one goes back to),
# only while the sim says idle: any input ends one at once (the TRANSITIONS blend carries the change).
#   id_shift   the weight onto the left leg a while (the hip out), then onto the right: the base of a long idle
#   id_hat     the left hand to the brim, a nod (the gunslinger's atlas hat tip, live for both cowboys)
#   id_gun     a look down at the holstered revolver, the right hand over its grip, a tap
#   id_neck    the head rolled to one side, the other, up: loosening the neck
#   id_scuff   the right toe scuffing the dirt twice, the head down
#   cx_sit     down onto a seat at hip height (the hips over the body's origin, the feet .4 m ahead), seated with a breath,
#              then the elbows on the knees; looping from marks.loop
#   cx_lean    back against a wall: leaning on it, the arms crossed, a while, then one boot up against it; looping
#   cx_drink   down on the right knee at the water, the right hand down into it (marks.dip: that frame), up to the mouth;
#              looping
IDLE_LIVE = ('id_shift', 'id_hat', 'id_gun', 'id_neck', 'id_scuff', 'cx_sit', 'cx_lean', 'cx_drink')
_ID = POSES['idle_in']
# the weight shift: the standing leg straight, the other knee bent and turned in, the pelvis dropped on its side
POSES['id_sh_l'] = {**_ID, 'LeftUpLeg': [('X', 2), ('Y', 3)], 'LeftLeg': [('X', 2)], 'LeftFoot': [('X', -2)],
                    'RightUpLeg': [('X', -10), ('Y', -4)], 'RightLeg': [('X', 22)], 'RightFoot': [('X', -12)],
                    'Hips': [('Y', 6)], 'Spine': [('Y', -4)], 'Neck': [('Y', -2)]}
POSES['id_sh_r'] = {**_ID, 'RightUpLeg': [('X', 2), ('Y', -3)], 'RightLeg': [('X', 2)], 'RightFoot': [('X', -2)],
                    'LeftUpLeg': [('X', -10), ('Y', 4)], 'LeftLeg': [('X', 22)], 'LeftFoot': [('X', -12)],
                    'Hips': [('Y', -6)], 'Spine': [('Y', 4)], 'Neck': [('Y', 2)]}
ANIMS['id_shift'] = _clip(['id_sh_l', 'idle_in', 'id_sh_r'], [0, .5, 1, 1.5, 2, 1.5, 1, .5], 6, play=list(range(8)),
                          ms=[2200, 180, 180, 180, 2200, 180, 180, 180], marks={'loop': 0})
ANIMS['id_hat'] = _clip(['idle_in', 'hat_tip_0', 'hat_tip_1', 'hat_tip_2'], [.5, 1, 1.5, 2, 2.5, 3], 12,
                        play=[0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0], ms=[70, 70, 80, 80, 90, 650, 90, 80, 80, 70, 70])
# the revolver: the head turned down to the right hip, the right hand hovering over the grip, then on it (a tap)
POSES['id_gn_0'] = {**_ID, 'Neck': [('X', 16), ('Z', -12)], 'Head': [('X', 10), ('Z', -6)], 'Spine2': [('Z', -4)]}
POSES['id_gn_1'] = {**POSES['id_gn_0'], 'Head': [('X', 14), ('Z', -8)]}
REACH.update({'id_gn_0': [_over_grip(-.02, .0, .14)], 'id_gn_1': [_over_grip(-.01, .01, .08)]})
ANIMS['id_gun'] = _clip(['idle_in', 'id_gn_0', 'id_gn_1', 'idle_in'], [0, .5, 1, 2, 1, 2, 1, 2.5, 3], 8, play=list(range(9)),
                        ms=[110, 120, 500, 140, 160, 140, 650, 140, 120])
# the neck: rolled to the left, to the right, back (the shoulders down and back)
POSES['id_nk_l'] = {**_ID, 'Neck': [('Y', 12), ('X', 4)], 'Head': [('Y', 8)]}
POSES['id_nk_r'] = {**_ID, 'Neck': [('Y', -12), ('X', 4)], 'Head': [('Y', -8)]}
POSES['id_nk_up'] = {**_ID, 'Neck': [('X', -14)], 'Head': [('X', -8)], 'Spine2': [('X', -4)]}
ANIMS['id_neck'] = _clip(['idle_in', 'id_nk_l', 'id_nk_r', 'id_nk_up', 'idle_in'], [0, .5, 1, 1.5, 2, 2.5, 3, 3.5, 4], 8, play=list(range(9)),
                         ms=[140, 150, 500, 200, 500, 200, 700, 200, 150])
# the scuff: the right toe forward onto the dirt, dragged back, twice; the head down watching it
_SC = {'Neck': [('X', 18)], 'Head': [('X', 6)]}
POSES['id_sc_0'] = {**_ID, **_SC, 'RightUpLeg': [('X', -16)], 'RightLeg': [('X', 14)], 'RightFoot': [('X', 26)]}
POSES['id_sc_1'] = {**_ID, **_SC, 'RightUpLeg': [('X', 8)], 'RightLeg': [('X', 24)], 'RightFoot': [('X', 36)]}
ANIMS['id_scuff'] = _clip(['idle_in', 'id_sc_0', 'id_sc_1', 'idle_in'], [0, .5, 1, 2, 1, 2, 2.5, 3], 8, play=list(range(8)),
                          ms=[130, 130, 260, 300, 260, 300, 160, 130])
# sitting: down (half), seated (the hands on the knees), a breath, the elbows on the knees and the hands together
POSES['cx_si_down'] = _merge(_mv_legs(-60, 82, -14, -60, 82, -14), _arms(-24, -24, -40, -40, lower=26), _MV_LEAN(22))
POSES['cx_si_seat'] = _merge(_mv_legs(-90, 88, -2, -86, 92, 0), _arms(-30, -26, -60, -56, lower=18), _MV_LEAN(6))
POSES['cx_si_breath'] = _merge(POSES['cx_si_seat'], {'Spine2': [('X', -3)], 'Neck': [('X', -4)]})
POSES['cx_si_rest'] = _merge(_mv_legs(-90, 96, 4, -84, 88, -4), _arms(-50, -50, -90, -90, lower=20), _MV_LEAN(26))
LIVE_AT.update({'cx_si_seat': [('Left', None, (.16, -.38, .8)), ('Right', None, (-.16, -.38, .8))],
                'cx_si_breath': [('Left', None, (.16, -.38, .8)), ('Right', None, (-.16, -.38, .8))],
                'cx_si_rest': [('Left', None, (.04, -.44, .74)), ('Right', None, (-.04, -.44, .74))]})
ANIMS['cx_sit'] = _clip(['idle_in', 'cx_si_down', 'cx_si_seat', 'cx_si_breath', 'cx_si_rest'], [0, .5, 1, 1.5, 2, 3, 3.5, 4], 8,
                        play=[0, 1, 2, 3, 4, 5, 4, 5, 4, 6, 7, 7, 6], ms=[90, 90, 110, 140, 1500, 1300, 1500, 1300, 1500, 200, 2500, 2500, 200],
                        marks={'loop': 4})
# leaning back on a wall: the feet a little ahead, the body back, the arms crossed; then the right boot up against it
_LE = {'Spine': [('X', -6)], 'Spine1': [('X', -3)], 'Neck': [('X', 6)]}
POSES['cx_le_rest'] = _merge(_mv_legs(-14, 4, 6, -10, 6, 4), _LE, _arms(-20, -20, -110, -110, lower=14))
POSES['cx_le_breath'] = _merge(POSES['cx_le_rest'], {'Spine2': [('X', -3)]})
POSES['cx_le_foot'] = _merge(_mv_legs(-14, 4, 6, -40, 110, -10), _LE, _arms(-20, -20, -110, -110, lower=14))
_CROSS = [('Left', None, (-.15, -.17, 1.03)), ('Right', None, (.15, -.15, 1.07))]
LIVE_AT.update({'cx_le_rest': _CROSS, 'cx_le_breath': _CROSS, 'cx_le_foot': _CROSS})
ANIMS['cx_lean'] = _clip(['idle_in', 'cx_le_rest', 'cx_le_breath', 'cx_le_foot'], [0, .5, 1, 2, 2.5, 3], 8,
                         play=[0, 1, 2, 3, 2, 3, 2, 4, 5, 5, 4], ms=[100, 120, 1600, 1300, 1600, 1300, 1600, 150, 2600, 2600, 150], marks={'loop': 2})
# drinking: down on the right knee, the right hand down into the water ahead, up to the mouth (the head back a little)
POSES['cx_dr_kneel'] = _merge(_KNEEL, _arms(-20, -30, -60, -40, lower=24), _MV_LEAN(22))
POSES['cx_dr_dip'] = _merge(_KNEEL, _arms(-10, -84, -70, -12, lower=24), _MV_LEAN(32))
POSES['cx_dr_sip'] = _merge(_KNEEL, _arms(-30, -60, -60, -120, lower=24), _MV_LEAN(14), {'Neck': [('X', -10)]})
LIVE_AT.update({'cx_dr_dip': [('Right', None, (-.12, -.5, .32))], 'cx_dr_sip': [('Right', None, (-.04, -.18, 1.12))]})
ANIMS['cx_drink'] = _clip(['idle_in', 'cx_dr_kneel', 'cx_dr_dip', 'cx_dr_sip'], [0, .5, 1, 1.5, 2, 2.5, 3], 8,
                          play=[0, 1, 2, 3, 4, 5, 6, 6, 5, 3, 2], ms=[100, 120, 300, 150, 700, 150, 900, 400, 150, 150, 1600],
                          marks={'loop': 3, 'dip': 4})


# ================================================================ the lasso, live (the live hero only) ================
# The rope work redone for the LIVE cowboys (view/livehero.js; docs/exp/lasso.md), made for the live models only and
# exported with ragdoll_export.py --clips (LASSO_LIVE: tools/blender/live_export.mjs --add). The atlas's lasso poses above
# (lasso_spin, lws_ / lrs_, lasso_throw, lasso_haul_*, ...) keep serving the sprites. The game reads these names and marks.
# Every key holds the revolver in its holster and the coil plumb in the left fist (LASSO_KEYS), the hat on the head.
#   ls_spin       the standing spin (loop): the right wrist round LS_SPIN (a circle carried by the chest) beside the head,
#                 just under the brim's edge (the outlaw's sombrero is ~1 m across: an arm up over the head would go through
#                 it, and over its edge is out of reach), the fist out along the spoke, the wrist rolling over behind; the
#                 chest turning with the hand (+-6 deg), the weight shifting under it; the coil hand before the left hip
#   ls_throw      the overhand throw: the last turn swung back (the chest turned away, the weight on the back foot), the
#                 step (the left foot forward, the hips opening while the chest stays back), the whip (the elbow leading,
#                 the chest squaring), the release (the arm out at the target, the right shoulder through, on the front
#                 foot, the right heel up: mark `release`), the follow-through (the left hand feeding rope), the settle
#   ls_throw_up   the same at a high anchor: the release arm up at ~45 deg, up on the front foot's toes, looking up
#   ls_take       the rope goes taut: the right fist back to the chest, the left hand grabbing the rope out front, a step
#                 back, into ls_hold
#   ls_hold       the taut hold (loop, a breath): the right fist forward at chest height, the left at the hip, leaning back
#   ls_strain     a hard strain (loop, a tremble): leaning far back on a braced front leg, both arms out on the rope
#   ls_dragged    pulled in by something stronger (loop): leaning back hard, the front foot skidding on its heel, the
#                 back foot hopping up to catch up (the game slides him)
#   ls_jerk       the catch jolt: yanked forward (the arms out, a stumble step), catching himself: into ls_dragged
#   ls_haul_walk  ls_hold's upper body over the walk's legs (the walk's ground data: BRAWL_GAIT)
#   ls_yank       the two-handed heave: a dip, the heave back past the right hip (mark `pull`), back into ls_hold
#   ls_snare      tying a heavy target's legs: the rope lifted high, snapped down in a crouch (mark `cinch`), a tug, the
#                 right hand lets go (mark `free`), standing into the idle with the coil
# The kit (a key's hands and feet are put on points after its spec, in this order): LS_FEET plants the feet (two-bone IK
# on the legs, the knee over the toes; the hips sink as far as the stance needs), LS_AT puts a fist or a wrist on a point
# (BRAWL_AT's rules: bone None = his frame, the height over the ground the pose snaps to; '.' = his frame before the
# snap; a bone's name carries a rest-space point; an elbow's way given or the spec's bend), LS_HAND turns a hand (fingers
# F, palm P), then the revolver goes back in its holster and the coil is hung plumb again; a clip's in-betweens get the
# revolver and the coil put back too (pose() below). No arm goes into a hat's brim, both feet stand on the ground (or one
# is lifted on purpose: a step, a hop). Sheets and checks: tmp/lasso-live/.
LASSO_LIVE = ('ls_spin', 'ls_throw', 'ls_throw_up', 'ls_take', 'ls_hold', 'ls_strain', 'ls_dragged', 'ls_jerk',
              'ls_haul_walk', 'ls_yank', 'ls_snare')
LS_AT = {}      # pose key -> [(side, bone | None | '.', (x, y, z) m at 1.8 m, 'fist' | 'wrist'[, pole])]; pole: the
                # elbow's way from the shoulder (x, y, z in his frame; else the spec's bend)
LS_HAND = {}    # pose key -> {side: (F, P)}: the fingers along F, the palm facing P (his frame)
LS_FEET = {}    # pose key -> {'L' / 'R': (x, y, yaw, pitch[, lift]), 'drop': m}: each ankle over (x, y) m, the foot turned
                # yaw deg (+ toward his left) and pitched (+ toe down about the ball: the heel up; - toe up about the heel),
                # lifted off the ground `lift` m; the hips sunk at least `drop` m (more when a foot is out of reach)
LS_SPIN = ((-.45, -.12, 1.55), .12)   # the spin's wrist circle: centre (rest space, carried by Spine2), radius (m at 1.8 m);
                                    # key i of ls_spin at th = -90 + 45 i deg (_spin_point's angle: 0 his left of the centre)


def _ls_ik(lower, target):
    """Two-bone IK baked into the pose (as _reach): the tail of `lower` (a ForeArm or a Leg) onto `target`."""
    arm = bpy.data.objects[ROOT]
    lo = arm.pose.bones[lower]
    up = lo.parent
    emp = bpy.data.objects.new('_reach', None)
    bpy.context.scene.collection.objects.link(emp)
    emp.location = arm.matrix_world @ target
    c = lo.constraints.new('IK')
    c.target, c.chain_count = emp, 2
    bpy.context.view_layer.update()
    mu, ml = up.matrix.copy(), lo.matrix.copy()
    lo.constraints.remove(c)
    bpy.data.objects.remove(emp)
    bpy.context.view_layer.update()
    up.matrix = mu
    bpy.context.view_layer.update()
    lo.matrix = ml
    bpy.context.view_layer.update()


def _ls_ik_pole(lower, target, pole):
    """Two-bone IK with the elbow (knee) on the side of `pole` (a direction in his frame from the joint): each bone
    swung the least way onto its new line (its twist kept), the reach clamped short of straight."""
    arm = bpy.data.objects[ROOT]
    lo = arm.pose.bones[lower]
    up = lo.parent
    a, b = arm.data.bones[up.name].length, arm.data.bones[lower].length
    S = up.head.copy()
    d = target - S
    L = max(abs(a - b) + 1e-3, min(d.length, (a + b) * .999))
    dn = d.normalized()
    n = Vector(pole) - dn * Vector(pole).dot(dn)
    n = n.normalized() if n.length > 1e-6 else (up.tail - S - dn * (up.tail - S).dot(dn)).normalized()
    x = (a * a - b * b + L * L) / (2 * L)
    E = S + dn * x + n * math.sqrt(max(a * a - x * x, 0.0))
    for pb, p0, p1 in ((up, S, E), (lo, E, S + dn * L)):
        h = pb.head.copy()
        R = (pb.tail - h).normalized().rotation_difference((p1 - p0).normalized()).to_matrix().to_4x4()
        pb.matrix = Matrix.Translation(p0) @ R @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()


def _ls_feet(spec):
    """LS_FEET: the feet planted (or lifted) where the spec says, the knees turned over the toes; returns the drop (m)."""
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    k = PROP['height'] / 1.8
    J = landmarks()
    plan = {}
    for s, side in (('L', 'Left'), ('R', 'Right')):
        if s not in spec:
            continue
        x, y, yaw, pitch = spec[s][:4]
        lift = spec[s][4] if len(spec[s]) > 4 else 0.0
        an, ba = J['ankle' + s], J['ball' + s]
        A0 = Vector((x * k, y * k, an.z + lift * k))
        Rz = Matrix.Rotation(math.radians(yaw), 3, 'Z')
        ball = A0 + Rz @ (ba - an)
        heel = A0 + Rz @ Vector((0, .05 * k, -an.z + .01 * k))
        Rp = Matrix.Rotation(math.radians(pitch), 3, Rz @ Vector((1, 0, 0)))
        piv = ball if pitch >= 0 else heel
        plan[side] = (piv + Rp @ (A0 - piv), Rz, Rp, pitch, yaw)
    drop = spec.get('drop', 0.0) * k
    for side, (A, Rz, Rp, pitch, yaw) in plan.items():
        hip = pbs[side + 'UpLeg'].head
        L = (bones[side + 'UpLeg'].length + bones[side + 'Leg'].length) * .975
        h = (A - hip).xy.length
        drop = max(drop, hip.z - math.sqrt(max(L * L - h * h, 0.0)) - A.z)
    for side, (A, Rz, Rp, pitch, yaw) in plan.items():
        # the knee over the toes: the thigh turned about the vertical through the hip so the bend faces the foot's way
        up, lo = pbs[side + 'UpLeg'], pbs[side + 'Leg']
        bend = (lo.head - (up.head + lo.tail) * .5).xy
        if bend.length > 1e-4:
            d = math.radians(yaw) - math.atan2(bend.x, -bend.y)
            d = (d + math.pi) % (2 * math.pi) - math.pi
            h = up.head.copy()
            up.matrix = Matrix.Translation(h) @ Matrix.Rotation(d, 4, 'Z') @ Matrix.Translation(-h) @ up.matrix
            bpy.context.view_layer.update()
        _ls_ik(side + 'Leg', A + Vector((0, 0, drop)))
        ft, to = pbs[side + 'Foot'], pbs[side + 'ToeBase']
        ft.matrix = Matrix.Translation(lo.tail) @ (Rp @ Rz @ bones[side + 'Foot'].matrix_local.to_3x3()).to_4x4()
        bpy.context.view_layer.update()
        to.matrix = Matrix.Translation(ft.tail) @ ((Rz if pitch >= 0 else Rp @ Rz) @ bones[side + 'ToeBase'].matrix_local.to_3x3()).to_4x4()
        bpy.context.view_layer.update()
    return drop


def _ls_turn_hand(side, F, P):
    """The hand turned so its fingers point along F and its palm faces P (his frame), at its wrist."""
    arm = bpy.data.objects[ROOT]
    hd, Mr = arm.pose.bones[side + 'Hand'], arm.data.bones[side + 'Hand'].matrix_local.to_3x3()
    f0 = (Mr @ Vector((0, 1, 0))).normalized()
    u0 = Vector((0, -1, 0))
    u0 = (u0 - f0 * u0.dot(f0)).normalized()
    F = Vector(F).normalized()
    P = Vector(P)
    P = (P - F * P.dot(F)).normalized()
    U = F.cross(P) if side == 'Right' else P.cross(F)           # (the thumb side: the palm is U x F right, F x U left)
    hd.matrix = Matrix.Translation(hd.head) @ (_frame_rot(f0, u0, F, U) @ Mr).to_4x4()
    bpy.context.view_layer.update()


def _ls_hold(pose_name):
    """HOLD hook (last): a live lasso key's feet (LS_FEET), hands (LS_AT, LS_HAND), then the revolver back in its holster
    and the coil hung plumb from the left fist again."""
    key = _key(pose_name)
    feet, at, turn = LS_FEET.get(key), LS_AT.get(key, ()), LS_HAND.get(key, {})
    if not (feet or at or turn):
        return
    arm = bpy.data.objects[ROOT]
    pbs = arm.pose.bones
    k = PROP['height'] / 1.8
    if feet:
        _ls_feet(feet)
    g = _bw_ground() if any(e[1] is None for e in at) else 0.0
    for _ in range(2):   # (a fist's point is set back along the hand, whose direction the reach changes: twice)
        for side, bone, p, mode, *pole in at:
            t = (Vector(p) * k + Vector((0, 0, g)) if bone is None else Vector(p) * k if bone == '.' else
                 _carried(bone, Vector(p) * k))
            if side in turn:
                _ls_turn_hand(side, *turn[side])
            hd = pbs[side + 'Hand']
            t = t - (hd.tail - hd.head) * {'wrist': 0.0, 'fist': .5}[mode]
            if pole:
                _ls_ik_pole(side + 'ForeArm', t, pole[0])
            else:
                _ls_ik(side + 'ForeArm', t)
    for side, (F, P) in turn.items():
        _ls_turn_hand(side, F, P)
    _holster_now()
    _lasso_hold(pose_name, hat=False)


_pose_lslive = pose


def pose(name):
    """The pose() above; a live lasso clip's in-between gets its revolver put back in the holster and its coil hung plumb
    (the blend carried both on the hands)."""
    zmin = _pose_lslive(name)
    clip, _, i = name.partition('.')
    if i and clip in LASSO_LIVE:
        _holster_now()
        _lasso_hold(name, hat=False)
    return zmin


_build_lslive = build


def build():
    """The builds above, then the live lasso keys' hook after every other."""
    names = _build_lslive()
    if _ls_hold not in HOLD_HOOKS:
        HOLD_HOOKS.append(_ls_hold)
    return names


def _ls_legs(lt=-6, rt=-6, ls=18, rs=18):
    """The legs pre-bent (thighs X- forward, shins X+): the knees' way for LS_FEET's IK."""
    return {'LeftUpLeg': [('X', lt)], 'LeftLeg': [('X', ls)], 'RightUpLeg': [('X', rt)], 'RightLeg': [('X', rs)]}


def _ls_trunk(tilt=0.0, turn=0.0, roll=0.0, spine=0.0, s1=0.0, s2=0.0, cturn=(0.0, 0.0, 0.0), neck=(0.0, 0.0, 0.0),
              head=(0.0, 0.0, 0.0)):
    """The pelvis (tilt X + forward, turn Z + to his left, roll Y + his top to his left), the back (bends X + forward;
    cturn: Spine, Spine1, Spine2 turns Z), the neck and the head (X + down, Z + to his left, Y + tilted to his left)."""
    out = {'Hips': [('Z', turn), ('X', tilt), ('Y', roll)],
           'Spine': [('Z', cturn[0]), ('X', spine)], 'Spine1': [('Z', cturn[1]), ('X', s1)], 'Spine2': [('Z', cturn[2]), ('X', s2)],
           'Neck': [('Z', neck[1]), ('X', neck[0]), ('Y', neck[2])], 'Head': [('Z', head[1]), ('X', head[0]), ('Y', head[2])]}
    return {b: [r for r in v if r[1]] for b, v in out.items()}


# the arms' specs under the IK (their elbow planes and twists; the keys of one move share one, so the in-betweens blend
# cleanly): the right arm up at the side (the spin, the wind-up), out forward (the release), in (the hold); the left arm
_LS_ARM_UP = {'RightShoulder': [('Y', 26)], 'RightArm': [('Y', 80), ('X', -6)], 'RightForeArm': [('Y', 66)]}
_LS_ARM_OUT = {'RightShoulder': [('Z', -12)], 'RightArm': [('Y', -36), ('X', -80)], 'RightForeArm': [('X', -10)]}
_LS_ARM_IN = {'RightShoulder': [('Z', -8)], 'RightArm': [('Y', -40), ('X', -50)], 'RightForeArm': [('X', -40)]}
_LS_LEFT_COIL = {'LeftShoulder': [('Z', -4)], 'LeftArm': [('Y', 32)], 'LeftForeArm': [('X', -44)], 'LeftHand': [('Y', 6)]}
_LS_LEFT_OUT = {'LeftShoulder': [('Z', -8)], 'LeftArm': [('Y', 30), ('X', -40)], 'LeftForeArm': [('X', -30)]}
_LS_LEFT_HIP = {'LeftShoulder': [('Z', 4)], 'LeftArm': [('Y', 34), ('X', 10)], 'LeftForeArm': [('X', -40)]}
_LS_LEFT_AT = lambda p: ('Left', None, p, 'fist')
_LS_RIGHT_AT = lambda p, pole=None: ('Right', None, p, 'fist') + ((pole,) if pole else ())

# ---- the spin: 8 keys round the circle (the hand: front, his left, behind, his right); the chest turns with the hand
# (+-6 deg), the hips shift under it, the head forward and a little up, tilted away from the rope arm
for _i in range(8):
    _th = math.radians(-90 + 45 * _i)
    _c, _s = math.cos(_th), math.sin(_th)
    _k = f'ls_sp_{_i}'
    POSES[_k] = _merge(_ls_legs(-6, -4, 16, 14),
                       _ls_trunk(turn=-6 - 1.5 * _s, roll=1.5 * _c, spine=-2, s1=-1, cturn=(-2.5 * _s, -2 * _s, 0),
                                 neck=(-6, 5 * _s, 5), head=(-3, 0, 2)),
                       _LS_ARM_UP, _LS_LEFT_COIL, {'_root': (.012 * _c, 0)})
    LS_FEET[_k] = {'L': (.13, -.1, 8, 0), 'R': (-.13, .05, -12, 0), 'drop': .03}
    _cx, _cy, _cz = LS_SPIN[0]
    LS_AT[_k] = [('Right', 'Spine2', (_cx + LS_SPIN[1] * _c, _cy + LS_SPIN[1] * _s, _cz), 'wrist'),
                 _LS_LEFT_AT((.19, -.2, .88))]
    # the hand: the fingers out along the circle's radius (the spoke), the palm down in front turning over behind
    _ph = math.radians(70 * (1 - math.cos(_th + math.pi / 2)))
    _F = (_c, _s, .25)
    _down, _out = Vector((0, 0, -1)), Vector((-_s, _c, 0))       # (palm down; palm turned to the way the hand goes)
    LS_HAND[_k] = {'Right': (_F, tuple(_down * math.cos(_ph) + _out * math.sin(_ph)))}
ANIMS['ls_spin'] = _clip([f'ls_sp_{i}' for i in range(8)], list(range(8)), 16, loop=True)

# ---- the throw: coil (the last turn swung back) -> step -> whip -> release -> follow-through -> settle
POSES['ls_th_coil'] = _merge(_ls_legs(-4, -10, 20, 24),
                             _ls_trunk(turn=-20, spine=0, s1=0, cturn=(-6, -4, 0), neck=(-4, 18, 2), head=(-2, 10, 0)),
                             _LS_ARM_UP, _LS_LEFT_COIL, {'_root': (-.02, .04)})
LS_FEET['ls_th_coil'] = {'L': (.12, -.13, 10, 18, .02), 'R': (-.13, .04, -15, 0), 'drop': .04}
LS_AT['ls_th_coil'] = [_LS_RIGHT_AT((-.5, .18, 1.44), (-1, -.5, -.2)), _LS_LEFT_AT((.12, -.25, .95))]
POSES['ls_th_step'] = _merge(_ls_legs(-14, 0, 20, 22),
                             _ls_trunk(turn=-12, spine=0, s1=0, cturn=(-10, -6, 0), neck=(-4, 18, 0), head=(-2, 8, 0)),
                             _LS_ARM_UP, _LS_LEFT_COIL, {'_root': (-.01, -.02)})
LS_FEET['ls_th_step'] = {'L': (.1, -.36, 8, -6), 'R': (-.13, .04, -15, 0), 'drop': .05}
LS_AT['ls_th_step'] = [_LS_RIGHT_AT((-.5, .13, 1.46), (-1, -.6, -.2)), _LS_LEFT_AT((.13, -.24, .96))]
POSES['ls_th_whip'] = _merge(_ls_legs(-14, 4, 20, 20),
                             _ls_trunk(turn=4, tilt=2, spine=3, s1=1, cturn=(2, 2, 0), neck=(-8, -4, 0), head=(-2, -2, 0)),
                             _LS_ARM_UP, _LS_LEFT_COIL, {'_root': (0, -.07)})
LS_FEET['ls_th_whip'] = {'L': (.1, -.36, 8, 0), 'R': (-.13, .04, -15, 18), 'drop': .06}
LS_AT['ls_th_whip'] = [_LS_RIGHT_AT((-.37, -.1, 1.46), (-.4, -1, -.3)), _LS_LEFT_AT((.14, -.26, .98))]
POSES['ls_th_release'] = _merge(_ls_legs(-14, 6, 20, 20),
                                _ls_trunk(turn=12, tilt=4, spine=6, s1=3, cturn=(2, 2, 0), neck=(-10, -10, 0), head=(-2, -4, 0)),
                                _LS_ARM_OUT, _LS_LEFT_OUT, {'_root': (.02, -.12)})
LS_FEET['ls_th_release'] = {'L': (.1, -.36, 8, 0), 'R': (-.13, .04, -15, 34), 'drop': .07}
LS_AT['ls_th_release'] = [_LS_RIGHT_AT((-.1, -.62, 1.5), (-.3, 0, -1)), _LS_LEFT_AT((.12, -.32, 1.0))]
LS_HAND['ls_th_release'] = {'Right': ((.02, -1, .05), (0, 0, -1))}
POSES['ls_th_follow'] = _merge(_ls_legs(-14, 6, 20, 20),
                               _ls_trunk(turn=14, tilt=5, spine=7, s1=3, cturn=(3, 2, 0), neck=(-10, -12, 0), head=(-2, -4, 0)),
                               _LS_ARM_OUT, _LS_LEFT_OUT, {'_root': (.03, -.15)})
LS_FEET['ls_th_follow'] = {'L': (.1, -.36, 8, 0), 'R': (-.13, .04, -15, 38), 'drop': .08}
LS_AT['ls_th_follow'] = [_LS_RIGHT_AT((-.05, -.8, 1.26), (-.5, 0, -1)), _LS_LEFT_AT((.06, -.48, 1.12))]
POSES['ls_th_settle'] = _merge(_ls_legs(-10, 0, 20, 20),
                               _ls_trunk(turn=8, tilt=1, spine=2, s1=1, cturn=(1, 1, 0), neck=(-2, -6, 0), head=(0, -2, 0)),
                               _LS_ARM_IN, _LS_LEFT_HIP, {'_root': (.01, -.09)})
LS_FEET['ls_th_settle'] = {'L': (.12, -.34, 8, 0), 'R': (-.14, .04, -18, 0), 'drop': .05}
LS_AT['ls_th_settle'] = [_LS_RIGHT_AT((-.1, -.4, 1.2), (-1, .3, -1)), _LS_LEFT_AT((.12, -.14, .95))]
_TH_TW, _TH_MS = [0, .5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5], [90, 50, 45, 40, 35, 60, 60, 80, 90, 150]
ANIMS['ls_throw'] = _clip(['ls_th_coil', 'ls_th_step', 'ls_th_whip', 'ls_th_release', 'ls_th_follow', 'ls_th_settle'],
                          _TH_TW, 14, ms=_TH_MS, marks={'release': 5})

# ---- the throw up at a high anchor: the same, the arm released up at ~45 deg, up on the front foot's toes, looking up
POSES['ls_tu_step'] = _merge(POSES['ls_th_step'], {'Neck': [('X', -8)], 'Head': [('X', -4)]})
LS_FEET['ls_tu_step'], LS_AT['ls_tu_step'] = LS_FEET['ls_th_step'], LS_AT['ls_th_step']
POSES['ls_tu_whip'] = _merge(_ls_legs(-14, 4, 20, 20),
                             _ls_trunk(turn=4, tilt=0, spine=0, s1=0, cturn=(2, 2, 0), neck=(-16, -4, 0), head=(-8, -2, 0)),
                             _LS_ARM_UP, _LS_LEFT_COIL, {'_root': (0, -.07)})
LS_FEET['ls_tu_whip'] = {'L': (.1, -.36, 8, 10), 'R': (-.13, .04, -15, 22), 'drop': .04}
LS_AT['ls_tu_whip'] = [_LS_RIGHT_AT((-.36, -.1, 1.52), (-.4, -1, -.3)), _LS_LEFT_AT((.14, -.26, .98))]
POSES['ls_tu_release'] = _merge(_ls_legs(-14, 6, 20, 20),
                                _ls_trunk(turn=12, tilt=0, spine=-2, s1=-2, cturn=(2, 2, 0), neck=(-22, -10, 0), head=(-10, -4, 0)),
                                {'RightShoulder': [('Z', -6), ('Y', 30)], 'RightArm': [('Y', -10), ('X', -120)], 'RightForeArm': [('X', -10)]},
                                _LS_LEFT_OUT, {'_root': (.02, -.12)})
LS_FEET['ls_tu_release'] = {'L': (.1, -.36, 8, 26), 'R': (-.13, .04, -15, 40), 'drop': .02}
LS_AT['ls_tu_release'] = [_LS_RIGHT_AT((-.14, -.46, 1.78), (-.6, .2, -1)), _LS_LEFT_AT((.12, -.32, 1.02))]
LS_HAND['ls_tu_release'] = {'Right': ((.02, -.7, .7), (0, -.7, -.7))}
POSES['ls_tu_follow'] = _merge(_ls_legs(-14, 6, 20, 20),
                               _ls_trunk(turn=14, tilt=2, spine=0, s1=0, cturn=(3, 2, 0), neck=(-18, -12, 0), head=(-8, -4, 0)),
                               {'RightShoulder': [('Z', -8), ('Y', 10)], 'RightArm': [('Y', -20), ('X', -110)], 'RightForeArm': [('X', -10)]},
                               _LS_LEFT_OUT, {'_root': (.03, -.14)})
LS_FEET['ls_tu_follow'] = {'L': (.1, -.36, 8, 14), 'R': (-.13, .04, -15, 36), 'drop': .04}
LS_AT['ls_tu_follow'] = [_LS_RIGHT_AT((-.08, -.54, 1.58), (-.6, 0, -1)), _LS_LEFT_AT((.06, -.46, 1.2))]
POSES['ls_tu_settle'] = _merge(POSES['ls_th_settle'], {'Neck': [('X', -8)]})
LS_FEET['ls_tu_settle'] = LS_FEET['ls_th_settle']
LS_AT['ls_tu_settle'] = [_LS_RIGHT_AT((-.1, -.42, 1.3), (-1, .3, -1)), _LS_LEFT_AT((.12, -.14, .95))]
ANIMS['ls_throw_up'] = _clip(['ls_th_coil', 'ls_tu_step', 'ls_tu_whip', 'ls_tu_release', 'ls_tu_follow', 'ls_tu_settle'],
                             _TH_TW, 14, ms=_TH_MS, marks={'release': 5})

# ---- the hold: the right fist forward at chest height, the left at the hip (the rope between them along the facing),
# leaning back on a wide stance, the right foot back; a breath (loop)
_HOLD_UP = lambda sp=0.0: _ls_trunk(turn=-14, tilt=-4, spine=-4 + sp, s1=-2, cturn=(6, 4, 2), neck=(6, 4, 0), head=(2, 2, 0))
POSES['ls_hold_a'] = _merge(_ls_legs(-10, 4, 24, 24), _HOLD_UP(), _LS_ARM_IN, _LS_LEFT_HIP, {'_root': (0, .02)})
POSES['ls_hold_b'] = _merge(_ls_legs(-10, 4, 24, 24), _HOLD_UP(-1.5), {'Spine2': [('X', -2)]}, _LS_ARM_IN, _LS_LEFT_HIP,
                            {'_root': (0, .025)})
LS_FEET['ls_hold_a'] = {'L': (.14, -.2, 8, 0), 'R': (-.15, .2, -24, 0), 'drop': .06}
LS_FEET['ls_hold_b'] = {'L': (.14, -.2, 8, 0), 'R': (-.15, .2, -24, 0), 'drop': .07}
LS_AT['ls_hold_a'] = [_LS_RIGHT_AT((-.06, -.36, 1.05)), _LS_LEFT_AT((.2, .02, .85))]
LS_AT['ls_hold_b'] = [_LS_RIGHT_AT((-.06, -.355, 1.04)), _LS_LEFT_AT((.2, .025, .845))]
ANIMS['ls_hold'] = _clip(['ls_hold_a', 'ls_hold_b'], [0, 1], 3, loop=True)

# ---- the take: from the throw's settle, the right fist snapped back to the chest, the left hand grabbing the rope out
# front, a short step back with the right foot, into the hold
POSES['ls_tk_snap'] = _merge(_ls_legs(-10, 4, 24, 24),
                             _ls_trunk(turn=-6, tilt=-4, spine=-4, s1=-2, cturn=(4, 2, 0), neck=(6, 2, 0), head=(2, 0, 0)),
                             _LS_ARM_IN, _LS_LEFT_OUT, {'_root': (0, .02)})
LS_FEET['ls_tk_snap'] = {'L': (.13, -.26, 8, 0), 'R': (-.15, .16, -20, 10, .03), 'drop': .06}
LS_AT['ls_tk_snap'] = [_LS_RIGHT_AT((-.06, -.2, 1.12)), _LS_LEFT_AT((.04, -.42, 1.02))]
ANIMS['ls_take'] = _clip(['ls_th_settle', 'ls_tk_snap', 'ls_hold_a'], [0, .5, 1, 1.5, 2], 14, ms=[50, 50, 60, 60, 80])

# ---- the strain: leaning far back (~25 deg), the left leg braced straight forward on its heel, the right bent behind,
# both arms out on the rope, the head forward; a tremble between the keys (the arms tugged, the lean +-3)
for _i, (_d, _l) in enumerate(((0, 0), (.03, 2.5), (-.01, -1), (.02, 3))):
    _k = f'ls_st_{_i}'
    POSES[_k] = _merge(_ls_legs(-30, 10, 10, 50),
                       _ls_trunk(turn=-10, tilt=-15 - _l * .5, spine=-10 - _l * .5, s1=-5, cturn=(4, 3, 2), neck=(22, 4, 0), head=(8, 0, 0)),
                       _LS_ARM_OUT, _LS_LEFT_OUT, {'_root': (0, .08)})
    LS_FEET[_k] = {'L': (.12, -.32, 10, -16), 'R': (-.14, .22, -22, 0), 'drop': .14}
    LS_AT[_k] = [_LS_RIGHT_AT((-.04, -.44 + _d, 1.0)), _LS_LEFT_AT((.08, -.22 + _d, .92))]
ANIMS['ls_strain'] = _clip([f'ls_st_{i}' for i in range(4)], [0, 1, 2, 3], 10, loop=True)

# ---- dragged in: leaning back hard (~30 deg), the hips over the front foot; the left foot skids on its heel (toe up)
# while the right hops up behind it to catch up; both arms straight out on the rope
_DR = [  # (the left foot, the right foot (LS_FEET's), the hips forward of the pivot, more lean)
    ((.12, -.24, 10, -20), (-.14, .26, -20, 20), .0, 0),
    ((.12, -.22, 10, -22), (-.14, .08, -16, 10, .08), .02, 2),
    ((.12, -.2, 10, -14), (-.14, -.06, -14, -6), .0, -1),
    ((.12, -.3, 10, -18, .05), (-.14, .02, -14, 16), -.02, 1)]
for _i, (_lf, _rf, _ry, _l) in enumerate(_DR):
    _k = f'ls_dr_{_i}'
    POSES[_k] = _merge(_ls_legs(-24, -10 if _i != 1 else -40, 14, 40 if _i != 1 else 70),
                       _ls_trunk(turn=-8, tilt=-19 - _l, spine=-9, s1=-5, cturn=(3, 2, 2), neck=(20, 2, 0), head=(8, 0, 0)),
                       _LS_ARM_OUT, _LS_LEFT_OUT, {'_root': (0, _ry - .1)})
    LS_FEET[_k] = {'L': _lf, 'R': _rf, 'drop': .12}
    LS_AT[_k] = [_LS_RIGHT_AT((-.04, -.58, 1.15)), _LS_LEFT_AT((.06, -.4, 1.05))]
ANIMS['ls_dragged'] = _clip([f'ls_dr_{i}' for i in range(4)], [0, 1, 2, 3], 8, loop=True)

# ---- the jerk: from the settle, yanked forward (the arms out straight, the chest thrown forward ~20 deg, the left foot
# off the ground), the stumble step (the left foot down ahead), catching himself back into ls_dragged
POSES['ls_jk_yank'] = _merge(_ls_legs(-30, 4, 30, 20),
                             _ls_trunk(turn=2, tilt=8, spine=10, s1=4, cturn=(0, 0, 0), neck=(-12, 0, 0), head=(-4, 0, 0)),
                             _LS_ARM_OUT, _LS_LEFT_OUT, {'_root': (0, -.14)})
LS_FEET['ls_jk_yank'] = {'L': (.12, -.42, 8, 10, .07), 'R': (-.14, .05, -18, 30), 'drop': .06}
LS_AT['ls_jk_yank'] = [_LS_RIGHT_AT((-.04, -.7, 1.1)), _LS_LEFT_AT((.06, -.54, 1.02))]
POSES['ls_jk_stumble'] = _merge(_ls_legs(-30, 6, 30, 20),
                                _ls_trunk(turn=-2, tilt=2, spine=2, s1=1, cturn=(0, 0, 0), neck=(-2, 0, 0), head=(0, 0, 0)),
                                _LS_ARM_OUT, _LS_LEFT_OUT, {'_root': (0, -.16)})
LS_FEET['ls_jk_stumble'] = {'L': (.12, -.5, 10, -10), 'R': (-.14, .05, -18, 26), 'drop': .12}
LS_AT['ls_jk_stumble'] = [_LS_RIGHT_AT((-.04, -.66, 1.12)), _LS_LEFT_AT((.06, -.48, 1.04))]
ANIMS['ls_jerk'] = _clip(['ls_th_settle', 'ls_jk_yank', 'ls_jk_stumble', 'ls_dr_0'], [0, 1, 2, 2.5, 3], 14,
                         ms=[40, 80, 80, 70, 80])

# ---- hauling on the move: ls_hold's upper body over the walk's legs (the walk's ground data: BRAWL_GAIT)
_LS_HOLD_UP = {k: list(v) for k, v in POSES['ls_hold_a'].items() if k not in LEG_BONES and not k.startswith('_')}
_LS_HOLD_UP['Spine'] = [('Z', -8)] + _LS_HOLD_UP.get('Spine', []) + [('X', -4)]   # (the pelvis's turn and tilt, carried
                                                                                  # by the back)
for _i in range(8):
    POSES[f'ls_hw_{_i}'] = _on_legs(_i, _LS_HOLD_UP, 'walk')
    LS_AT[f'ls_hw_{_i}'] = [('Right', 'Spine2', (-.06, -.4, 1.06), 'fist'), ('Left', 'Spine2', (.2, -.02, .86), 'fist')]
ANIMS['ls_haul_walk'] = dict(_clip([f'ls_hw_{i}' for i in range(8)], list(range(8)), 10, loop=True), locomotion=True)
BRAWL_GAIT['ls_haul_walk'] = 'walk'

# ---- the yank: from the hold a quick dip, the heave (the right foot back, hips and chest turned to his right ~25 deg,
# both hands pulled back past the right hip, leaning back ~20 deg), held, easing back into the hold
POSES['ls_yk_dip'] = _merge(_ls_legs(-14, 0, 34, 34), _HOLD_UP(4), _LS_ARM_IN, _LS_LEFT_OUT, {'_root': (0, 0)})
LS_FEET['ls_yk_dip'] = {'L': (.14, -.2, 8, 0), 'R': (-.15, .2, -24, 0), 'drop': .12}
LS_AT['ls_yk_dip'] = [_LS_RIGHT_AT((-.05, -.42, .98)), _LS_LEFT_AT((.1, -.22, .92))]
_YK_ARMS = {'RightShoulder': [('Z', 6)], 'RightArm': [('Y', -36), ('X', 30)], 'RightForeArm': [('X', -30)],
            'LeftShoulder': [('Z', -10)], 'LeftArm': [('Y', 20), ('X', -30), ('Z', -30)], 'LeftForeArm': [('X', -50)]}
POSES['ls_yk_heave'] = _merge(_ls_legs(-24, 10, 20, 30),
                              _ls_trunk(turn=-26, tilt=-10, spine=-8, s1=-4, cturn=(-4, -3, 0), neck=(10, 20, 0), head=(4, 10, 0)),
                              _YK_ARMS, {'_root': (-.02, .1)})
LS_FEET['ls_yk_heave'] = {'L': (.14, -.2, 8, -8), 'R': (-.16, .34, -30, 0), 'drop': .1}
LS_AT['ls_yk_heave'] = [_LS_RIGHT_AT((-.3, .15, .95)), _LS_LEFT_AT((-.05, -.1, 1.0))]
POSES['ls_yk_hold'] = _merge(_ls_legs(-24, 10, 20, 30),
                             _ls_trunk(turn=-24, tilt=-9, spine=-7, s1=-4, cturn=(-3, -2, 0), neck=(10, 18, 0), head=(4, 9, 0)),
                             _YK_ARMS, {'_root': (-.02, .1)})
LS_FEET['ls_yk_hold'] = LS_FEET['ls_yk_heave']
LS_AT['ls_yk_hold'] = [_LS_RIGHT_AT((-.28, .12, .97)), _LS_LEFT_AT((-.04, -.12, 1.01))]
ANIMS['ls_yank'] = _clip(['ls_hold_a', 'ls_yk_dip', 'ls_yk_heave', 'ls_yk_hold', 'ls_hold_a'], [.5, 1, 2, 3, 3.5, 4], 14,
                         ms=[30, 40, 90, 110, 70, 80], marks={'pull': 2})

# ---- the snare: the rope lifted high in both hands, snapped down in a crouch (the hands at the knees: `cinch`), a tug
# back, the right hand letting go (`free`), standing up into the idle with the coil still in the left fist
POSES['ls_sn_lift'] = _merge(_ls_legs(-8, 4, 20, 20),
                             _ls_trunk(turn=-8, tilt=-2, spine=-4, s1=-2, cturn=(4, 2, 0), neck=(-4, 2, 0), head=(-2, 0, 0)),
                             {'RightShoulder': [('Z', -10), ('Y', 10)], 'RightArm': [('Y', -20), ('X', -100)], 'RightForeArm': [('X', -20)],
                              'LeftShoulder': [('Z', -10), ('Y', -10)], 'LeftArm': [('Y', 20), ('X', -100)], 'LeftForeArm': [('X', -20)]},
                             {'_root': (0, .02)})
LS_FEET['ls_sn_lift'] = {'L': (.14, -.22, 8, 0), 'R': (-.15, .16, -20, 0), 'drop': .04}
LS_AT['ls_sn_lift'] = [_LS_RIGHT_AT((-.05, -.4, 1.45)), _LS_LEFT_AT((.06, -.3, 1.38))]
POSES['ls_sn_snap'] = _merge(_ls_legs(-60, -40, 80, 80),
                             _ls_trunk(turn=-6, tilt=14, spine=16, s1=6, cturn=(2, 2, 0), neck=(-20, 0, 0), head=(-6, 0, 0)),
                             {'RightShoulder': [('Z', -10)], 'RightArm': [('Y', -36), ('X', -60)], 'RightForeArm': [('X', -14)],
                              'LeftShoulder': [('Z', -10)], 'LeftArm': [('Y', 30), ('X', -60)], 'LeftForeArm': [('X', -14)]},
                             {'_root': (0, .06)})
LS_FEET['ls_sn_snap'] = {'L': (.15, -.22, 10, 0), 'R': (-.15, .16, -20, 0), 'drop': .26}
LS_AT['ls_sn_snap'] = [_LS_RIGHT_AT((-.04, -.42, .55)), _LS_LEFT_AT((.08, -.34, .6))]
POSES['ls_sn_tug'] = _merge(_ls_legs(-40, -20, 60, 60),
                            _ls_trunk(turn=-10, tilt=-2, spine=-4, s1=-2, cturn=(2, 2, 0), neck=(6, 0, 0), head=(2, 0, 0)),
                            _LS_ARM_IN, _LS_LEFT_HIP, {'_root': (0, .08)})
LS_FEET['ls_sn_tug'] = {'L': (.15, -.22, 10, 0), 'R': (-.15, .16, -20, 0), 'drop': .16}
LS_AT['ls_sn_tug'] = [_LS_RIGHT_AT((-.06, -.3, .82)), _LS_LEFT_AT((.18, -.04, .8))]
POSES['ls_sn_free'] = _merge(_ls_legs(-14, -6, 30, 30),
                             _ls_trunk(turn=-6, tilt=0, spine=0, s1=0, cturn=(2, 2, 0), neck=(4, 0, 0), head=(0, 0, 0)),
                             {'RightShoulder': [('Z', 4)], 'RightArm': [('Y', -40), ('X', 6)], 'RightForeArm': [('X', -30)]},
                             _LS_LEFT_HIP, {'_root': (0, .04)})
LS_FEET['ls_sn_free'] = {'L': (.14, -.16, 8, 0), 'R': (-.14, .1, -14, 0), 'drop': .06}
LS_AT['ls_sn_free'] = [_LS_LEFT_AT((.2, -.1, .86))]
POSES['ls_sn_idle'] = dict(POSES['idle_in'])          # (the ready idle with the coil in the left fist: a lasso key)
ANIMS['ls_snare'] = _clip(['ls_hold_a', 'ls_sn_lift', 'ls_sn_snap', 'ls_sn_tug', 'ls_sn_free', 'ls_sn_idle'],
                          [.5, 1, 2, 3, 4, 4.5, 5], 14, ms=[50, 80, 70, 110, 90, 70, 80], marks={'cinch': 2, 'free': 4})
LASSO_KEYS.update(k for k in POSES if k.startswith(('ls_sp_', 'ls_th_', 'ls_tu_', 'ls_tk_', 'ls_hold_', 'ls_st_', 'ls_dr_',
                                                    'ls_jk_', 'ls_hw_', 'ls_yk_', 'ls_sn_')))


# ================================================================ fists (the cowboy, live only: docs/exp/fists.md) =====
# The cowboy's unarmed fight (FISTS_LIVE: the gunslinger's live model, the outlaw's later), made for the live model only
# and exported with ragdoll_export.py --clips (tools/blender/live_export.mjs --add). The game (view/livehero.js
# fistsMotion) time-warps each clip by the sim (src/content/fists.js MOVES: the timing truth): its `hit` mark shown at the
# contact, its last frame at the move's end; `ms` here follows the MOVES table (previews). Frame 0 of a quick move is its
# WIND (shown, held, while the button is held), the throw starts at frame 1; a heavy (fs_body, fs_hay) trembles on frames
# loop / loop+1 while it charges, `throw` = the first frame after the release; a loop's marks.loop = 0. Every punch and
# the clinch's exits end on fs_guard.0 exactly (strings flow); the clinch's own moves start and end on fs_clinch.0. The
# revolver stays holstered (no key starts with gun_), the hat stays on.
# The stance is orthodox: the left foot forward, the hips bladed ~32 deg to his right, the head square to the target, the
# fists up at the chin forward of the brim; the left hand jabs and hooks from the front, the right crosses from the back.
# A right-hand move is authored on its own (a mirrored clip would swap the feet mid-string), the slips and the side steps
# too; only the clinch's short punches mirror their hands.
# The kit (FS_AT, a HOLD hook after every other): per key the planted feet (the ball of the foot on a ground spot, its yaw
# + toward his left, the heel lifted about the ball; the leg solved onto it, the knee over the toes), free legs (the ankle
# on a point, the knee toward a pole, the foot turned), and the fists (the knuckles on a point, the elbow bent toward a
# pole: an elbow down for the guard, out for a hook), all in his frame AFTER the ground snap (he faces -Y, +X his left; z
# over the ground; the origin is his middle = the sim's position; '_root' moves the pelvis over the planted feet: the
# weight shifts). `drop`: how far the knees lower him. The contact: the knuckles on the target's face at the move's
# dist - .12 m ahead and FS_FACE m up (a man's nose: the head is a third of this body's height, so 1.46 m, not the doc's
# 1.55: the eyes are at 1.51), body blows at FS_BELLY. Sheets and probes: tmp/fists/cowboy/.
#   fs_guard     4, loop: up on the balls of the feet, settling into the knees, a sway of the shoulders
#   fs_step_*    4 each, loop: the guard shuffling forward / back / to his left / to his right (lead foot then trail foot:
#                the foot on the side he goes first), a cycle = .9 m
#   fs_block     3: the forearms up before the face take it (pushed back, chin tucked), held, back to the guard
#   fs_jab       5: wind, extend, contact (hit 2), retract, guard;  fs_jab2: 4: wind, contact (hit 1), retract, guard
#   fs_cross     5: wind (the right hip back), the turn, contact (hit 2: the right heel up, the left fist home), retract, guard
#   fs_hook_l/r  5: wind (the elbow out), the arc, contact (hit 2: across the cheek), follow-through, guard
#   fs_upper_r/l 6: dip, drive, contact (hit 2: under the chin, up on the toes), follow-through up, settle, guard
#   fs_body      8: dip left, loaded, tremble a/b (loop 2), drive (throw 4), contact (hit 5: the liver), recover, guard
#   fs_hay       9: load a, load b (cocked behind the ear), tremble a/b (loop 2), the swing (throw 4), contact (hit 5),
#                over-extended, recover, guard
#   fs_head      5: wind (head back, hands to his shoulders), drive, contact (hit 2: the forehead), recoil, guard
#   fs_round     6: wind, chamber (the right knee across), contact (hit 2: the shin at the ribs), follow, foot down, guard
#   fs_grab      4: wind, reach, grip (hit 2: both fists on the collar), into the clinch (= fs_clinch.0)
#   fs_clinch    2, loop: both fists on his collar, elbows down, leaning in; a breath
#   fs_cl_l/r    4: a hand lets go, a short uppercut (hit 1), back onto the collar
#   fs_knee      5: pulling him down, the right knee up (hit 2: his belly), down, the clinch
#   fs_cl_head   5: head back, driving in, the forehead (hit 2), recoil, the clinch
#   fs_toss      6: the hips turned in under his, loading him on the right hip, over, release (hit 3), follow, guard
#   fs_shove     4: the palms at his chest (hit 1), extended, recover, guard
#   fs_slip_l/r  4: from the guard a dip and weave to his left / right (the head .35 m off the line), the lowest point,
#                coming up, guard;  fs_slip_b: 4: a lean back and a step back, guard
FISTS_LIVE = ('fs_guard', 'fs_step_f', 'fs_step_b', 'fs_step_l', 'fs_step_r', 'fs_block', 'fs_jab', 'fs_jab2', 'fs_cross',
              'fs_hook_l', 'fs_hook_r', 'fs_upper_r', 'fs_upper_l', 'fs_body', 'fs_hay', 'fs_head', 'fs_round', 'fs_grab',
              'fs_clinch', 'fs_cl_l', 'fs_cl_r', 'fs_knee', 'fs_cl_head', 'fs_toss', 'fs_shove', 'fs_slip_l', 'fs_slip_r',
              'fs_slip_b')
FS_AT = {}        # pose key -> {'drop': m, 'feet': {side: ('plant', bx, by, yaw, heel[, lift]) | ('free', (x, y, z), pole[, foot])},
                  #              'fists': {side: ((x, y, z) the knuckles, pole)}} (side 'Left' | 'Right'; m at 1.8 m)
FS_FACE, FS_BELLY = 1.46, 1.1
_FS_SOLE = []


def _fs_sole():
    """The boot sole's lowest point at rest (m, armature space): the ground under a flat foot whose ball is at rest height."""
    if not _FS_SOLE:
        lo = 1e9
        for ob in bpy.data.collections[COL].objects:
            if ob.type == 'MESH' and not ob.hide_render and ob.name.split('.')[0] not in SOFT_PARTS and len(ob.data.vertices) \
                    and {g.name for g in ob.vertex_groups} & {'LeftFoot', 'LeftToeBase'}:
                lo = min(lo, min(v.co.z for v in ob.data.vertices))
        _FS_SOLE.append(lo)
    return _FS_SOLE[0]


def _fs_two(up, lo, target, pole, end=None):
    """Two connected bones (up -> lo) turned so the tail of `end` (lo, or a bone rigid on it: the hand) is on `target`
    (armature space), the joint between them bent toward `pole` (a direction); returns how far it was out of reach (m)."""
    pbs = bpy.data.objects[ROOT].pose.bones
    a, b, e = pbs[up], pbs[lo], pbs[end or lo]
    L1, L2 = a.length, (e.tail - b.head).length
    S = a.head.copy()
    d = target - S
    n = d.length
    m = min(max(n, abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4)
    dn = d.normalized()
    p = pole - dn * pole.dot(dn)
    if p.length < 1e-6:
        p = Vector((0, 0, -1)) + dn * dn.z
    p.normalize()
    x = (L1 * L1 - L2 * L2 + m * m) / (2 * m)
    E = S + dn * x + p * math.sqrt(max(0.0, L1 * L1 - x * x))
    for pb, aim in ((a, E), (b, S + dn * m)):
        h = pb.head.copy()
        q = ((pb.tail if pb is a else e.tail) - h).rotation_difference(aim - h)
        pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()
    return max(0.0, n - m)


def _fs_foot_rot(side, R, Rt):
    """The foot (R) and its toe (Rt) turned from their rest orientation (world rotations), each at its posed joint."""
    arm = bpy.data.objects[ROOT]
    for bn, M in ((side + 'Foot', R), (side + 'ToeBase', Rt)):
        pb = arm.pose.bones[bn]
        pb.matrix = Matrix.Translation(pb.head.copy()) @ (M @ arm.data.bones[bn].matrix_local.to_3x3()).to_4x4()
        bpy.context.view_layer.update()


def _fs_plant(side, f, drop):
    """A planted foot: the ball of the foot on (bx, by) on the ground (pre-snap: the ball `drop` m over its rest height),
    turned `yaw` deg (+ toward his left), the heel lifted `heel` deg about the ball, the toe flat (`lift` m: the ball off
    the ground, a foot in the air mid-step); the knee over the toes."""
    bx, by, yaw, heel, lift = (tuple(f) + (0, 0, 0))[:5]
    k = PROP['height'] / 1.8
    J, sd = landmarks(), side[0]
    Rz = Matrix.Rotation(math.radians(yaw), 3, 'Z')
    R = Rz @ Matrix.Rotation(math.radians(heel), 3, 'X')
    B = Vector((bx * k, by * k, drop + J['ball' + sd].z + lift * k))
    short = _fs_two(side + 'UpLeg', side + 'Leg', B + R @ (J['ankle' + sd] - J['ball' + sd]),
                    Rz @ Vector((0, -1, 0)) + Vector((.3 if sd == 'L' else -.3, 0, 0)))
    _fs_foot_rot(side, R, Rz)
    return short


def _fs_free(side, f, g):
    """A free leg: the ankle on (x, y, z) (post-snap), the knee bent toward `pole`, the foot turned by `foot` (world
    rotations [(axis, deg)] from its rest: toe down = X-) or as the shin carries it."""
    k = PROP['height'] / 1.8
    short = _fs_two(side + 'UpLeg', side + 'Leg', Vector(f[0]) * k + Vector((0, 0, g)), Vector(f[1]))
    if len(f) > 2 and f[2] is not None:
        R = Matrix.Identity(3)
        for ax, deg in f[2]:
            R = Matrix.Rotation(math.radians(deg), 3, ax) @ R
        _fs_foot_rot(side, R, R)
    return short


def _fs_hold(pose_name):
    """HOLD hook (last): a fists key's feet, legs and fists onto their spots (FS_AT), then the revolver back in its holster
    on the posed thigh."""
    S = FS_AT.get(_key(pose_name))
    if not S:
        return
    pbs = bpy.data.objects[ROOT].pose.bones
    k = PROP['height'] / 1.8
    drop = S.get('drop', 0.0) * k
    g = drop + _fs_sole()
    short = {}
    for side, f in S.get('feet', {}).items():
        short[side + 'Leg'] = _fs_plant(side, f[1:], drop) if f[0] == 'plant' else _fs_free(side, f[1:], g)
    for side, (p, pole) in S.get('fists', {}).items():   # (the knuckles: the hand's tail, the hand rigid on the forearm)
        short[side + 'Arm'] = _fs_two(side + 'Arm', side + 'ForeArm', Vector(p) * k + Vector((0, 0, g)), Vector(pole),
                                      side + 'Hand')
    for n, s in short.items():
        if s > .01:
            print('FISTS out of reach', pose_name, n, round(s, 3))
    _bw_regun(pose_name)


_pose_fists = pose


def pose(name):
    """The pose() above; a fists clip's in-between (a blend of finished keys) gets its holstered revolver put back."""
    zmin = _pose_fists(name)
    clip, _, i = name.partition('.')
    if i and clip in FISTS_LIVE:
        _bw_regun(name)
    return zmin


_build_fists = build


def build():
    """The builds above, then the fists keys' hook after every other."""
    names = _build_fists()
    if _fs_hold not in HOLD_HOOKS:
        HOLD_HOOKS.append(_fs_hold)
    return names


_FS_ARMS = {'LeftArm': [('Y', 30), ('X', -30)], 'LeftForeArm': [('X', -70)],      # (the arms' start before the solve: bent
            'RightArm': [('Y', -30), ('X', -30)], 'RightForeArm': [('X', -70)]}   # forward, so every key's roll is alike)


def _fs_key(name, hips=(0, 0, 0), turn=(0, 0, 0, 0, 0), lean=(0, 0, 0, 0, 0), bend=(0, 0, 0, 0, 0), sh=((0, 0), (0, 0)),
            root=None, drop=.08, feet=None, fists=None, extra=None):
    """A fists key. hips: (turn Z + toward his left, tip X + forward, roll Y + his left side down); turn / lean / bend: Z / X /
    Y for (Spine, Spine1, Spine2, Neck, Head), about world axes (each after its parent: a turn then a lean toward the
    target); sh: the shoulders' (raise, forward) deg, (left, right); root: (dx, dy) the pelvis over the feet; then FS_AT."""
    spec = {'Hips': [('Z', hips[0]), ('X', hips[1]), ('Y', hips[2])]}
    for b, z, x, y in zip(('Spine', 'Spine1', 'Spine2', 'Neck', 'Head'), turn, lean, bend):
        spec[b] = [('Z', z), ('X', x), ('Y', y)]
    (lr, lf), (rr, rf) = sh
    spec['LeftShoulder'] = [('Y', -lr), ('Z', -lf)]
    spec['RightShoulder'] = [('Y', rr), ('Z', rf)]
    spec.update({b: list(v) for b, v in _FS_ARMS.items()})
    if root:
        spec['_root'] = tuple(root)
    POSES[name] = _merge(spec, extra) if extra else spec
    FS_AT[name] = {'drop': drop, 'feet': dict(feet or {}), 'fists': dict(fists or {})}
    return name


def _fs_clip(keys, tween, ms, loop=False, marks=None):
    return _clip(keys, tween, 12, loop=loop, play=None, ms=ms, marks=marks)


# ---- the stance: the feet (ball spots, yaw, heel) and the fists' home
_FS_L = ('plant', .13, -.28, -18, 4)     # the front foot, pointing a little to his right
_FS_R = ('plant', -.13, .17, -50, 14)    # the back foot turned out, up on its ball
_P_GL, _P_GR = (.6, .3, -1), (-.6, .3, -1)   # guard elbows: down, a little out and back
_FS_GD = dict(hips=(-32, 4, 0), turn=(4, 4, 2, 12, 10), lean=(5, 4, 2, 0, -2), sh=((6, 8), (6, 6)))
_fs_key('fs_gd_up', drop=.05, feet={'Left': _FS_L, 'Right': _FS_R},
        fists={'Left': ((.07, -.50, 1.27), _P_GL), 'Right': ((-.11, -.41, 1.25), _P_GR)}, **_FS_GD)
_fs_key('fs_gd_down', drop=.10, feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (8,)},
        fists={'Left': ((.07, -.49, 1.22), _P_GL), 'Right': ((-.11, -.40, 1.20), _P_GR)},
        **{**_FS_GD, 'hips': (-34, 5, 0), 'turn': (4, 4, 2, 13, 11)})
ANIMS['fs_guard'] = _fs_clip(['fs_gd_up', 'fs_gd_down'], [0, .5, 1, 1.5], [150, 150, 150, 150], loop=True, marks={'loop': 0})
_GD = 'fs_gd_up'

# ---- the jab: the left fist cocks back a little with the weight onto the front foot, then shoots out along the line with
# the chest turning right and the left shoulder up to the chin; the right fist stays home
_fs_key('fs_jb_wind', drop=.11, hips=(-29, 5, 0), turn=(4, 4, 2, 11, 8), lean=(5, 4, 2, 0, -2), sh=((3, 3), (6, 6)),
        root=(0, -.02), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (16,)},
        fists={'Left': ((.10, -.42, 1.19), (.7, .2, -1)), 'Right': ((-.11, -.40, 1.22), _P_GR)})
_fs_key('fs_jb_ext', drop=.07, hips=(-38, 6, 0), turn=(-1, -1, 0, 20, 18), lean=(6, 4, 2, 0, -3), sh=((12, 12), (6, 6)),
        root=(0, -.04), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (20,)},
        fists={'Left': ((.05, -.62, 1.36), (.5, .1, -1)), 'Right': ((-.10, -.37, 1.24), _P_GR)})
_fs_key('fs_jb_hit', drop=.04, hips=(-42, 6, 0), turn=(-2, -2, -1, 22, 21), lean=(6, 4, 2, 0, -4), sh=((16, 16), (4, 8)),
        root=(0, -.06), feet={'Left': ('plant', .13, -.31, -20, 0), 'Right': _FS_R[:4] + (26,)},
        fists={'Left': ((.02, -.73, FS_FACE), (.4, .2, -1)), 'Right': ((-.09, -.36, 1.27), _P_GR)})
_fs_key('fs_jb_back', drop=.07, hips=(-36, 5, 0), turn=(1, 1, 1, 17, 15), lean=(5, 4, 2, 0, -3), sh=((10, 10), (6, 6)),
        root=(0, -.03), feet={'Left': ('plant', .13, -.30, -19, 0), 'Right': _FS_R[:4] + (20,)},
        fists={'Left': ((.06, -.58, 1.33), (.6, .2, -1)), 'Right': ((-.10, -.39, 1.25), _P_GR)})
ANIMS['fs_jab'] = _fs_clip(['fs_jb_wind', 'fs_jb_ext', 'fs_jb_hit', 'fs_jb_back', _GD], [0, 1, 2, 3, 4], [50, 60, 70, 55, 55],
                           marks={'hit': 2})
# the double: from the retracted jab, no wind back (frame 0 = the retract), straight out again
ANIMS['fs_jab2'] = _fs_clip(['fs_jb_back', 'fs_jb_hit', _GD], [0, 1, 1.5, 2], [40, 50, 85, 85], marks={'hit': 1})

# ---- the cross: the right hip back (the weight on the back foot), then the hips and shoulders turn in hard, the right
# heel up and turned out, the right arm straight down the line; the left fist comes home to the chin
_fs_key('fs_cr_wind', drop=.10, hips=(-38, 4, 0), turn=(2, 2, 1, 15, 13), lean=(4, 3, 2, 0, -2), sh=((6, 8), (8, 2)),
        root=(0, .02), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (10,)},
        fists={'Left': ((.07, -.48, 1.23), _P_GL), 'Right': ((-.13, -.33, 1.21), (-.7, .4, -1))})
_fs_key('fs_cr_turn', drop=.07, hips=(-12, 5, 0), turn=(4, 3, 2, 2, 1), lean=(5, 4, 2, 0, -3), sh=((4, 0), (10, 12)),
        root=(0, -.03), feet={'Left': _FS_L[:4] + (0,), 'Right': ('plant', -.13, .17, -40, 28)},
        fists={'Left': ((.10, -.40, 1.25), _P_GL), 'Right': ((-.07, -.58, 1.35), (-.6, .1, -1))})
_fs_key('fs_cr_hit', drop=.04, hips=(14, 6, 0), turn=(8, 6, 4, -14, -14), lean=(6, 4, 2, 0, -4), sh=((2, 0), (16, 16)),
        root=(0, -.07), feet={'Left': ('plant', .13, -.30, -16, 0), 'Right': ('plant', -.12, .17, -25, 40)},
        fists={'Left': ((.10, -.36, 1.27), (.7, .2, -1)), 'Right': ((-.02, -.76, FS_FACE), (-.4, .2, -1))})
_fs_key('fs_cr_back', drop=.07, hips=(0, 5, 0), turn=(5, 4, 3, -6, -6), lean=(5, 4, 2, 0, -3), sh=((4, 4), (10, 10)),
        root=(0, -.04), feet={'Left': ('plant', .13, -.29, -17, 0), 'Right': ('plant', -.13, .17, -34, 30)},
        fists={'Left': ((.09, -.40, 1.26), _P_GL), 'Right': ((-.06, -.60, 1.36), (-.6, .2, -1))})
ANIMS['fs_cross'] = _fs_clip(['fs_cr_wind', 'fs_cr_turn', 'fs_cr_hit', 'fs_cr_back', _GD], [0, 1, 2, 3, 4], [70, 80, 80, 80, 80],
                             marks={'hit': 2})

# ---- the hooks: the lead (left) hook loads onto the left leg with the elbow out, then the hips and shoulders whip round to
# his right over the pivoting front foot, the arm bent square at shoulder height; the fist crosses in front of the target's
# cheek and carries on a little past the line. The rear (right) hook: the same off the back foot, the hips turning in.
_P_HL, _P_HR = (1, .3, .5), (-1, .3, .5)     # hook elbows: out to the side and up (the arm square, level)
_fs_key('fs_hl_wind', drop=.12, hips=(-24, 4, 0), turn=(2, 2, 2, 8, 10), lean=(4, 3, 2, 0, -2), bend=(5, 4, 1, -4, -4),
        sh=((2, 6), (6, 6)), root=(.04, -.03), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (18,)},
        fists={'Left': ((.33, -.36, 1.22), (1, .5, -.2)), 'Right': ((-.10, -.38, 1.24), _P_GR)})
_fs_key('fs_hl_arc', drop=.08, hips=(-46, 5, 0), turn=(-6, -6, -4, 30, 30), lean=(5, 4, 2, 0, -3), bend=(2, 1, 0, -2, -2),
        sh=((10, 10), (4, 6)), root=(.02, -.04), feet={'Left': ('plant', .13, -.28, -40, 10), 'Right': _FS_R[:4] + (20,)},
        fists={'Left': ((.40, -.56, 1.40), _P_HL), 'Right': ((-.10, -.36, 1.26), _P_GR)})
_fs_key('fs_hl_hit', drop=.06, hips=(-56, 5, 0), turn=(-8, -7, -5, 38, 36), lean=(6, 4, 2, 0, -3), bend=(-2, -2, 0, 2, 2),
        sh=((12, 14), (4, 6)), root=(0, -.05), feet={'Left': ('plant', .13, -.28, -62, 18), 'Right': _FS_R[:4] + (24,)},
        fists={'Left': ((.06, -.62, FS_FACE), _P_HL), 'Right': ((-.09, -.34, 1.27), _P_GR)})
_fs_key('fs_hl_follow', drop=.07, hips=(-62, 5, 0), turn=(-10, -8, -6, 40, 38), lean=(6, 4, 2, 0, -3), bend=(-3, -2, 0, 2, 2),
        sh=((10, 14), (4, 6)), root=(-.01, -.04), feet={'Left': ('plant', .13, -.28, -66, 18), 'Right': _FS_R[:4] + (24,)},
        fists={'Left': ((-.14, -.52, 1.40), (.8, .4, .5)), 'Right': ((-.09, -.34, 1.27), _P_GR)})
ANIMS['fs_hook_l'] = _fs_clip(['fs_hl_wind', 'fs_hl_arc', 'fs_hl_hit', 'fs_hl_follow', _GD], [0, 1, 2, 3, 4], [80, 90, 90, 90, 90],
                              marks={'hit': 2})
_fs_key('fs_hr_wind', drop=.12, hips=(-40, 4, 0), turn=(0, 0, 0, 20, 18), lean=(4, 3, 2, 0, -2), bend=(-5, -4, -1, 4, 4),
        sh=((6, 8), (4, -2)), root=(-.04, .02), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (8,)},
        fists={'Left': ((.08, -.47, 1.25), _P_GL), 'Right': ((-.34, -.28, 1.22), (-1, .5, -.2))})
_fs_key('fs_hr_arc', drop=.08, hips=(-6, 5, 0), turn=(6, 6, 4, -6, -6), lean=(5, 4, 2, 0, -3), bend=(-2, -1, 0, 2, 2),
        sh=((4, 4), (10, 10)), root=(-.02, -.03), feet={'Left': _FS_L[:4] + (0,), 'Right': ('plant', -.13, .17, -36, 28)},
        fists={'Left': ((.10, -.40, 1.26), _P_GL), 'Right': ((-.41, -.53, 1.40), _P_HR)})
_fs_key('fs_hr_hit', drop=.05, hips=(18, 5, 0), turn=(8, 8, 6, -18, -18), lean=(6, 4, 2, 0, -3), bend=(2, 2, 0, -2, -2),
        sh=((4, 4), (12, 14)), root=(-.02, -.06), feet={'Left': ('plant', .13, -.29, -14, 0), 'Right': ('plant', -.12, .17, -24, 38)},
        fists={'Left': ((.10, -.36, 1.27), _P_GL), 'Right': ((-.06, -.62, FS_FACE), _P_HR)})
_fs_key('fs_hr_follow', drop=.06, hips=(24, 5, 0), turn=(10, 9, 6, -22, -20), lean=(6, 4, 2, 0, -3), bend=(3, 2, 0, -2, -2),
        sh=((4, 4), (10, 14)), root=(-.01, -.05), feet={'Left': ('plant', .13, -.29, -12, 0), 'Right': ('plant', -.12, .17, -20, 40)},
        fists={'Left': ((.10, -.36, 1.27), _P_GL), 'Right': ((.14, -.52, 1.40), (-.8, .4, .5))})
ANIMS['fs_hook_r'] = _fs_clip(['fs_hr_wind', 'fs_hr_arc', 'fs_hr_hit', 'fs_hr_follow', _GD], [0, 1, 2, 3, 4], [80, 90, 90, 90, 90],
                              marks={'hit': 2})

# ---- the uppercuts: a dip into the knees with the punching shoulder dropped and the fist low by the ribs, the legs drive
# up and the hips turn, the fist rises under the chin (the forearm upright, the elbow under it) with the body up onto the
# toes, carries on up past the face (over the brim: it reads from behind too), settles back down into the guard
_P_UP = (0, .4, -1)    # the elbow under the fist
_fs_key('fs_ur_dip', drop=.18, hips=(-36, 7, 0), turn=(0, 0, 0, 18, 18), lean=(6, 4, 2, 0, -2), bend=(-7, -5, -2, 6, 6),
        sh=((4, 6), (-8, 2)), root=(-.02, 0), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (8,)},
        fists={'Left': ((.08, -.46, 1.20), _P_GL), 'Right': ((-.17, -.34, 1.00), (-.5, .4, -1))})
_fs_key('fs_ur_drive', drop=.10, hips=(-6, 6, 0), turn=(4, 4, 3, -2, -3), lean=(5, 3, 2, 0, -2), bend=(-2, -1, 0, 2, 2),
        sh=((4, 4), (2, 8)), root=(-.01, -.03), feet={'Left': _FS_L[:4] + (0,), 'Right': ('plant', -.13, .17, -38, 30)},
        fists={'Left': ((.10, -.40, 1.24), _P_GL), 'Right': ((-.10, -.50, 1.14), (-.2, .4, -1))})
_fs_key('fs_ur_hit', drop=.01, hips=(22, 4, 0), turn=(8, 6, 4, -20, -18), lean=(2, 0, -1, 2, -2), bend=(2, 1, 0, -2, -2),
        sh=((4, 4), (12, 12)), root=(0, -.05), feet={'Left': ('plant', .13, -.29, -14, 14), 'Right': ('plant', -.12, .17, -24, 40)},
        fists={'Left': ((.10, -.36, 1.30), _P_GL), 'Right': ((-.03, -.58, 1.38), _P_UP)})
_fs_key('fs_ur_follow', drop=0, hips=(26, 2, 0), turn=(8, 6, 4, -22, -18), lean=(0, -2, -3, 2, -6), bend=(3, 2, 0, -2, -2),
        sh=((4, 4), (16, 10)), root=(0, -.04), feet={'Left': ('plant', .13, -.29, -14, 16), 'Right': ('plant', -.12, .17, -24, 42)},
        fists={'Left': ((.10, -.36, 1.30), _P_GL), 'Right': ((-.05, -.50, 1.64), (-.4, .3, -1))})
_fs_key('fs_ur_settle', drop=.09, hips=(-12, 5, 0), turn=(4, 4, 2, 2, 2), lean=(5, 4, 2, 0, -3), sh=((6, 6), (8, 6)),
        root=(0, -.02), feet={'Left': _FS_L[:4] + (0,), 'Right': ('plant', -.13, .17, -40, 24)},
        fists={'Left': ((.08, -.44, 1.26), _P_GL), 'Right': ((-.10, -.44, 1.34), _P_GR)})
ANIMS['fs_upper_r'] = _fs_clip(['fs_ur_dip', 'fs_ur_drive', 'fs_ur_hit', 'fs_ur_follow', 'fs_ur_settle', _GD], [0, 1, 2, 3, 4, 5],
                               [90, 100, 90, 100, 95, 95], marks={'hit': 2})
_fs_key('fs_ul_dip', drop=.17, hips=(-18, 7, 0), turn=(4, 3, 2, 4, 5), lean=(6, 4, 2, 0, -2), bend=(7, 5, 2, -6, -6),
        sh=((-8, 0), (6, 6)), root=(.03, -.02), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (14,)},
        fists={'Left': ((.19, -.40, 1.00), (.5, .4, -1)), 'Right': ((-.11, -.38, 1.20), _P_GR)})
_fs_key('fs_ul_drive', drop=.09, hips=(-36, 6, 0), turn=(-2, -2, -1, 20, 21), lean=(5, 3, 2, 0, -2), bend=(2, 1, 0, -2, -2),
        sh=((2, 8), (6, 6)), root=(.01, -.03), feet={'Left': ('plant', .13, -.28, -30, 6), 'Right': _FS_R[:4] + (18,)},
        fists={'Left': ((.11, -.52, 1.14), (.2, .4, -1)), 'Right': ((-.10, -.36, 1.25), _P_GR)})
_fs_key('fs_ul_hit', drop=.01, hips=(-50, 4, 0), turn=(-8, -6, -4, 36, 32), lean=(2, 0, -1, 2, -2), bend=(-2, -1, 0, 2, 2),
        sh=((12, 12), (4, 6)), root=(0, -.05), feet={'Left': ('plant', .13, -.28, -48, 20), 'Right': _FS_R[:4] + (26,)},
        fists={'Left': ((.03, -.58, 1.38), _P_UP), 'Right': ((-.09, -.34, 1.28), _P_GR)})
_fs_key('fs_ul_follow', drop=0, hips=(-54, 2, 0), turn=(-8, -6, -4, 38, 34), lean=(0, -2, -3, 2, -6), bend=(-3, -2, 0, 2, 2),
        sh=((16, 10), (4, 6)), root=(0, -.04), feet={'Left': ('plant', .13, -.28, -50, 22), 'Right': _FS_R[:4] + (28,)},
        fists={'Left': ((.05, -.50, 1.64), (.4, .3, -1)), 'Right': ((-.09, -.34, 1.28), _P_GR)})
_fs_key('fs_ul_settle', drop=.09, hips=(-38, 5, 0), turn=(2, 2, 1, 16, 16), lean=(5, 4, 2, 0, -3), sh=((8, 6), (6, 6)),
        root=(0, -.02), feet={'Left': ('plant', .13, -.28, -26, 4), 'Right': _FS_R[:4] + (16,)},
        fists={'Left': ((.09, -.46, 1.34), _P_GL), 'Right': ((-.11, -.40, 1.25), _P_GR)})
ANIMS['fs_upper_l'] = _fs_clip(['fs_ul_dip', 'fs_ul_drive', 'fs_ul_hit', 'fs_ul_follow', 'fs_ul_settle', _GD], [0, 1, 2, 3, 4, 5],
                               [90, 100, 90, 100, 95, 95], marks={'hit': 2})

# ---- the body blow (the left heavy): a level change down to the left (the left shoulder dropped, the weight over the
# left leg), the left fist loaded low and back by the hip, trembling while it charges; then the hips snap round to his
# right and the fist digs up into the target's right side (his liver) at belt height, the elbow out; up into the guard
_fs_key('fs_bd_dip', drop=.15, hips=(-26, 8, 0), turn=(2, 2, 2, 10, 10), lean=(7, 5, 3, -2, -4), bend=(8, 6, 2, -6, -6),
        sh=((-6, 2), (6, 6)), root=(.05, -.02), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (16,)},
        fists={'Left': ((.23, -.38, 1.08), (.8, .4, -1)), 'Right': ((-.10, -.37, 1.20), _P_GR)})
_fs_key('fs_bd_load', drop=.19, hips=(-14, 9, 0), turn=(4, 4, 2, 2, 2), lean=(8, 6, 3, -2, -4), bend=(10, 7, 2, -8, -8),
        sh=((-10, -4), (6, 6)), root=(.08, -.01), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (14,)},
        fists={'Left': ((.30, -.22, .97), (.6, .5, -1)), 'Right': ((-.08, -.36, 1.17), _P_GR)})
_fs_key('fs_bd_hold_a', drop=.20, hips=(-13, 9, 0), turn=(4, 4, 2, 2, 2), lean=(8, 6, 3, -2, -4), bend=(11, 8, 2, -9, -9),
        sh=((-11, -4), (7, 6)), root=(.085, -.01), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (14,)},
        fists={'Left': ((.31, -.20, .96), (.6, .5, -1)), 'Right': ((-.08, -.36, 1.16), _P_GR)})
_fs_key('fs_bd_hold_b', drop=.185, hips=(-16, 9, 0), turn=(3, 3, 2, 3, 3), lean=(8, 6, 3, -2, -4), bend=(9, 7, 2, -7, -7),
        sh=((-9, -3), (6, 6)), root=(.075, -.015), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (15,)},
        fists={'Left': ((.29, -.23, .98), (.6, .5, -1)), 'Right': ((-.09, -.37, 1.18), _P_GR)})
_fs_key('fs_bd_drive', drop=.16, hips=(-44, 8, 0), turn=(-4, -4, -2, 26, 26), lean=(7, 5, 3, -2, -4), bend=(5, 4, 1, -4, -4),
        sh=((-2, 6), (6, 6)), root=(.05, -.05), feet={'Left': ('plant', .13, -.28, -40, 10), 'Right': _FS_R[:4] + (22,)},
        fists={'Left': ((.27, -.52, 1.02), (1, .3, -.3)), 'Right': ((-.09, -.36, 1.19), _P_GR)})
_fs_key('fs_bd_hit', drop=.14, hips=(-60, 8, 0), turn=(-8, -7, -5, 40, 38), lean=(7, 5, 3, -2, -4), bend=(2, 2, 0, -2, -2),
        sh=((4, 12), (6, 6)), root=(.02, -.07), feet={'Left': ('plant', .13, -.28, -62, 18), 'Right': _FS_R[:4] + (26,)},
        fists={'Left': ((.08, -.66, FS_BELLY), (1, .2, -.1)), 'Right': ((-.09, -.34, 1.20), _P_GR)})
_fs_key('fs_bd_recover', drop=.10, hips=(-44, 6, 0), turn=(-2, -2, -1, 24, 24), lean=(5, 4, 2, 0, -3), bend=(1, 1, 0, -1, -1),
        sh=((6, 8), (6, 6)), root=(.01, -.04), feet={'Left': ('plant', .13, -.28, -40, 10), 'Right': _FS_R[:4] + (20,)},
        fists={'Left': ((.18, -.52, 1.22), (1, .3, -.5)), 'Right': ((-.10, -.38, 1.23), _P_GR)})
ANIMS['fs_body'] = _fs_clip(['fs_bd_dip', 'fs_bd_load', 'fs_bd_hold_a', 'fs_bd_hold_b', 'fs_bd_drive', 'fs_bd_hit', 'fs_bd_recover', _GD],
                            list(range(8)), [70, 100, 80, 80, 90, 110, 110, 110], marks={'loop': 2, 'throw': 4, 'hit': 5})

# ---- the haymaker (the right heavy): the hips turn away and the right fist winds up behind the right ear, the left arm
# out ahead for balance, trembling while it charges; then a wide overhand arc (the elbow out, the fist over the top) down
# onto the target's face with everything behind it, carrying on past (over-extended, turned past the line), back up
_fs_key('fs_hy_load_a', drop=.10, hips=(-52, 2, 0), turn=(-4, -3, -2, 30, 29), lean=(2, 1, 0, 0, -3), bend=(-4, -3, 0, 3, 3),
        sh=((2, 6), (10, -8)), root=(-.02, .04), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (4,)},
        fists={'Left': ((.20, -.55, 1.30), (.6, .2, -1)), 'Right': ((-.27, -.04, 1.42), (-.7, .6, -.4))})
_fs_key('fs_hy_load_b', drop=.12, hips=(-62, 1, 0), turn=(-5, -4, -3, 36, 36), lean=(1, 0, -1, 0, -3), bend=(-6, -4, 0, 5, 5),
        sh=((0, 8), (14, -12)), root=(-.03, .06), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (0,)},
        fists={'Left': ((.29, -.52, 1.27), (.8, 0, -.6)), 'Right': ((-.25, .08, 1.50), (-.6, .8, .2))})
_fs_key('fs_hy_hold_a', drop=.125, hips=(-63, 1, 0), turn=(-5, -4, -3, 37, 36), lean=(1, 0, -1, 0, -3), bend=(-7, -5, 0, 6, 6),
        sh=((0, 8), (15, -12)), root=(-.035, .06), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (0,)},
        fists={'Left': ((.30, -.53, 1.26), (.8, 0, -.6)), 'Right': ((-.26, .10, 1.51), (-.6, .8, .2))})
_fs_key('fs_hy_hold_b', drop=.115, hips=(-60, 1, 0), turn=(-5, -4, -3, 35, 35), lean=(1, 0, -1, 0, -3), bend=(-5, -4, 0, 4, 4),
        sh=((0, 8), (13, -11)), root=(-.025, .055), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (2,)},
        fists={'Left': ((.28, -.51, 1.28), (.8, 0, -.6)), 'Right': ((-.24, .06, 1.49), (-.6, .8, .2))})
_fs_key('fs_hy_swing', drop=.08, hips=(-10, 5, 0), turn=(4, 4, 2, 0, 0), lean=(5, 4, 2, 0, -3), bend=(2, 2, 0, -2, -2),
        sh=((4, 0), (16, 8)), root=(-.01, -.02), feet={'Left': _FS_L[:4] + (0,), 'Right': ('plant', -.13, .17, -38, 26)},
        fists={'Left': ((.18, -.38, 1.20), _P_GL), 'Right': ((-.32, -.42, 1.62), (-1, .3, .3))})
_fs_key('fs_hy_hit', drop=.06, hips=(24, 8, 0), turn=(8, 7, 5, -22, -22), lean=(8, 6, 4, 0, -4), bend=(4, 3, 1, -4, -4),
        sh=((2, 0), (14, 16)), root=(0, -.09), feet={'Left': ('plant', .13, -.30, -14, 0), 'Right': ('plant', -.12, .17, -18, 44)},
        fists={'Left': ((.10, -.30, 1.18), _P_GL), 'Right': ((-.02, -.78, FS_FACE), (-.8, .3, .4))})
_fs_key('fs_hy_over', drop=.09, hips=(36, 10, 0), turn=(10, 9, 6, -30, -28), lean=(10, 8, 5, 0, -6), bend=(6, 4, 1, -5, -5),
        sh=((0, 0), (10, 18)), root=(.02, -.09), feet={'Left': ('plant', .13, -.30, -12, 0), 'Right': ('plant', -.12, .17, -14, 46)},
        fists={'Left': ((.12, -.28, 1.15), _P_GL), 'Right': ((.20, -.64, 1.16), (-.6, .2, .3))})
_fs_key('fs_hy_recover', drop=.10, hips=(0, 6, 0), turn=(4, 4, 2, -5, -5), lean=(6, 4, 2, 0, -3), sh=((4, 4), (8, 8)),
        root=(0, -.04), feet={'Left': ('plant', .13, -.29, -16, 0), 'Right': ('plant', -.13, .17, -34, 26)},
        fists={'Left': ((.08, -.44, 1.24), _P_GL), 'Right': ((-.12, -.46, 1.28), _P_GR)})
ANIMS['fs_hay'] = _fs_clip(['fs_hy_load_a', 'fs_hy_load_b', 'fs_hy_hold_a', 'fs_hy_hold_b', 'fs_hy_swing', 'fs_hy_hit', 'fs_hy_over',
                            'fs_hy_recover', _GD], list(range(9)), [80, 120, 80, 80, 130, 120, 110, 100, 100],
                           marks={'loop': 2, 'throw': 4, 'hit': 5})

# ---- the headbutt: the head and chest pulled back, both hands reaching for his shoulders; the hands pull him in as the
# head and chest drive forward, the forehead (the brim tilted down) into his face; the recoil, the guard
_fs_key('fs_hd_wind', drop=.08, hips=(-28, 0, 0), turn=(3, 3, 2, 10, 10), lean=(-6, -6, -4, 0, -8), sh=((8, 10), (8, 10)),
        root=(0, .04), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (8,)},
        fists={'Left': ((.20, -.44, 1.31), (.8, .2, -1)), 'Right': ((-.18, -.42, 1.31), (-.8, .2, -1))})
_fs_key('fs_hd_drive', drop=.08, hips=(-24, 5, 0), turn=(3, 3, 2, 8, 8), lean=(4, 3, 2, 2, 2), sh=((6, 12), (6, 12)),
        root=(0, -.02), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (18,)},
        fists={'Left': ((.24, -.46, 1.20), (.8, .2, -1)), 'Right': ((-.22, -.44, 1.20), (-.8, .2, -1))})
_fs_key('fs_hd_hit', drop=.06, hips=(-22, 6, 0), turn=(3, 3, 2, 7, 7), lean=(5, 3, 2, 2, 4), sh=((4, 14), (4, 14)),
        root=(0, -.02), feet={'Left': ('plant', .13, -.30, -18, 0), 'Right': _FS_R[:4] + (28,)},
        fists={'Left': ((.23, -.40, 1.16), (.8, .3, -1)), 'Right': ((-.21, -.38, 1.16), (-.8, .3, -1))})
_fs_key('fs_hd_recoil', drop=.09, hips=(-28, 2, 0), turn=(3, 3, 2, 10, 10), lean=(0, 0, 0, -4, -6), sh=((6, 6), (6, 6)),
        root=(0, .01), feet={'Left': ('plant', .13, -.29, -18, 0), 'Right': _FS_R[:4] + (16,)},
        fists={'Left': ((.14, -.47, 1.28), _P_GL), 'Right': ((-.13, -.43, 1.26), _P_GR)})
ANIMS['fs_head'] = _fs_clip(['fs_hd_wind', 'fs_hd_drive', 'fs_hd_hit', 'fs_hd_recoil', _GD], [0, 1, 2, 3, 4], [60, 100, 110, 110, 100],
                            marks={'hit': 2})

# ---- the roundhouse (V in a string): the weight onto the left foot with a skip in, the arms up; the right knee chambered
# up and across as the left foot pivots; the hips turn over and the body leans away as the right leg whips round, the
# shin across the target's ribs; the leg carries on across, is pulled back in and set down behind; the guard
_fs_key('fs_rd_wind', drop=.10, hips=(-20, 3, 0), turn=(4, 3, 2, 6, 5), lean=(4, 3, 2, 0, -3), sh=((8, 6), (8, 6)),
        root=(.05, -.08), feet={'Left': ('plant', .12, -.36, -36, 0), 'Right': ('plant', -.13, .17, -50, 30)},
        fists={'Left': ((.10, -.44, 1.34), _P_GL), 'Right': ((-.10, -.38, 1.32), _P_GR)})
_fs_key('fs_rd_chamber', drop=.05, hips=(36, -6, 8), turn=(6, 4, 2, -24, -24), lean=(-4, -3, -2, 4, 2), bend=(4, 3, 2, -4, -4),
        sh=((6, 6), (2, -6)), root=(.10, -.20), feet={'Left': ('plant', .10, -.38, -90, 0),
                                                     'Right': ('free', (-.36, -.42, .80), (0, -1, .6), [('X', -40), ('Z', 40)])},
        fists={'Left': ((.18, -.40, 1.30), (.8, .2, -1)), 'Right': ((-.24, -.12, 1.08), (-.6, .4, -1))})
_fs_key('fs_rd_hit', drop=.04, hips=(72, -10, 14), turn=(6, 4, 2, -42, -40), lean=(-8, -6, -4, 6, 4), bend=(8, 6, 4, -8, -8),
        sh=((6, 4), (0, -10)), root=(.10, -.26), feet={'Left': ('plant', .10, -.38, -130, 0),
                                                      'Right': ('free', (.10, -.88, 1.10), (-.3, 0, 1), [('X', -55), ('Z', 85)])},
        fists={'Left': ((.24, -.36, 1.28), (.8, .2, -1)), 'Right': ((-.30, .02, 1.02), (-.6, .4, -1))})
_fs_key('fs_rd_follow', drop=.05, hips=(92, -6, 10), turn=(6, 4, 2, -52, -50), lean=(-6, -4, -3, 6, 4), bend=(6, 4, 3, -6, -6),
        sh=((6, 4), (2, -6)), root=(.10, -.24), feet={'Left': ('plant', .10, -.38, -140, 0),
                                                     'Right': ('free', (.40, -.62, .78), (-.6, -.4, 1), [('X', -50), ('Z', 110)])},
        fists={'Left': ((.22, -.30, 1.28), (.8, .2, -1)), 'Right': ((-.22, -.06, 1.10), (-.6, .4, -1))})
_fs_key('fs_rd_down', drop=.09, hips=(10, 4, 0), turn=(4, 3, 2, -8, -8), lean=(3, 2, 1, 0, -3), sh=((6, 6), (6, 6)),
        root=(.04, -.10), feet={'Left': ('plant', .11, -.34, -50, 0),
                                'Right': ('free', (-.18, .10, .16), (0, -1, .3), [('X', -10), ('Z', -30)])},
        fists={'Left': ((.10, -.44, 1.30), _P_GL), 'Right': ((-.12, -.38, 1.28), _P_GR)})
ANIMS['fs_round'] = _fs_clip(['fs_rd_wind', 'fs_rd_chamber', 'fs_rd_hit', 'fs_rd_follow', 'fs_rd_down', _GD], [0, 1, 2, 3, 4, 5],
                             [40, 170, 90, 80, 80, 80], marks={'hit': 2})

# ---- footwork: a step-drag shuffle in the guard, 4 frames a cycle (.9 m: the game plays it by the distance moved). The
# foot on the side he goes steps first (forward: the left; back: the right; to his left: the left; to his right: the
# right), the other is dragged after it, the feet never cross; each foot travels `e` against his middle per half cycle
# (the stance narrows to a drag and widens to a step: e < the .45 m a half cycle covers, the rest is the sim's glide), a
# bounce on the frames a foot is in the air, a lean into the way he goes
def _fs_shuffle(clip, lead, t, e, ms, lean=0, bend=0):
    trail = 'Right' if lead == 'Left' else 'Left'
    base = {'Left': _FS_L[1:3] + (-18, 2), 'Right': _FS_R[1:3] + (-50, 12)}
    keys = []
    for i, (ol, ot, up) in enumerate(((-.5, .5, None), (0, 0, lead), (.5, -.5, None), (0, 0, trail))):
        feet = {}
        for side, o in ((lead, ol), (trail, ot)):
            bx, by, yaw, heel = base[side]
            lift, h = (.05, heel + 14) if up == side else (0, heel + (16 if (i == 0 and side == lead) or (i == 2 and side == trail) else 0))
            feet[side] = ('plant', bx + t[0] * o * e, by + t[1] * o * e, yaw, h, lift)
        bob = (0, .02, -.01, .02)[i]
        k = _fs_key(f'{clip}_{i}', drop=(.09, .05, .10, .05)[i], hips=(-32, 4, 0), turn=(4, 4, 2, 12, 10),
                    lean=(5 + lean, 4, 2, 0, -2), bend=(bend, bend * .6, 0, -bend, 0), sh=((6, 8), (6, 6)),
                    root=(t[0] * .02, t[1] * .02), feet=feet,
                    fists={'Left': ((.07 + t[0] * .01, -.50, 1.25 + bob), _P_GL), 'Right': ((-.11 + t[0] * .01, -.41, 1.23 + bob), _P_GR)})
        keys.append(k)
    ANIMS[clip] = _fs_clip(keys, [0, 1, 2, 3], [ms] * 4, loop=True, marks={'loop': 0})


_fs_shuffle('fs_step_f', 'Left', (0, -1), .30, 78, lean=3)
_fs_shuffle('fs_step_b', 'Right', (0, 1), .28, 102, lean=-3)
_fs_shuffle('fs_step_l', 'Left', (1, 0), .22, 90, bend=3)
_fs_shuffle('fs_step_r', 'Right', (-1, 0), .22, 90, bend=-3)

# ---- the block (the passive guard takes a punch): the forearms up before the face, the chin tucked behind them, pushed
# back half a step (the front foot slides back), held, back to the guard
_P_BL, _P_BR = (.3, -.2, -1), (-.3, -.2, -1)   # the elbows down in front of the chest
_fs_key('fs_bk_hit', drop=.12, hips=(-30, 2, 0), turn=(4, 4, 2, 11, 9), lean=(2, 2, 2, 6, 6), sh=((10, 10), (10, 10)),
        root=(0, .09), feet={'Left': ('plant', .13, -.20, -18, 0), 'Right': ('plant', -.13, .21, -50, 6)},
        fists={'Left': ((.07, -.36, 1.44), _P_BL), 'Right': ((-.09, -.33, 1.42), _P_BR)})
_fs_key('fs_bk_hold', drop=.11, hips=(-31, 3, 0), turn=(4, 4, 2, 11, 10), lean=(3, 3, 2, 5, 4), sh=((9, 9), (9, 9)),
        root=(0, .07), feet={'Left': ('plant', .13, -.20, -18, 0), 'Right': ('plant', -.13, .21, -50, 8)},
        fists={'Left': ((.07, -.38, 1.42), _P_BL), 'Right': ((-.09, -.35, 1.40), _P_BR)})
ANIMS['fs_block'] = _fs_clip(['fs_bk_hit', 'fs_bk_hold', _GD], [0, 1, 2], [70, 80, 70])

# ---- the slips (Space in the stance; the sim moves him .8 m the way he holds): from the guard a dip into the knees and
# a weave of the head and shoulders off the line (~.35 m to the side at the lowest), the guard kept up by the face, back
# up into the guard. Back: a lean back with the feet drawn back, the head out of reach
_fs_key('fs_sll_dip', drop=.14, hips=(-28, 6, 5), turn=(4, 4, 2, 10, 8), lean=(6, 4, 2, 0, -2), bend=(8, 6, 3, -6, -6),
        sh=((6, 8), (6, 6)), root=(.06, -.02), feet={'Left': ('plant', .16, -.28, -18, 0), 'Right': ('plant', -.11, .17, -50, 18)},
        fists={'Left': ((.13, -.46, 1.15), _P_GL), 'Right': ((-.04, -.38, 1.13), _P_GR)})
_fs_key('fs_sll_low', drop=.22, hips=(-26, 8, 9), turn=(4, 4, 2, 9, 7), lean=(8, 5, 2, 0, -2), bend=(14, 10, 5, -10, -10),
        sh=((6, 8), (6, 6)), root=(.12, -.03), feet={'Left': ('plant', .18, -.28, -18, 0), 'Right': ('plant', -.10, .17, -50, 20)},
        fists={'Left': ((.20, -.44, 1.04), _P_GL), 'Right': ((.02, -.36, 1.02), _P_GR)})
_fs_key('fs_sll_up', drop=.12, hips=(-30, 5, 3), turn=(4, 4, 2, 11, 9), lean=(5, 4, 2, 0, -2), bend=(5, 4, 2, -4, -4),
        sh=((6, 8), (6, 6)), root=(.05, -.01), feet={'Left': ('plant', .15, -.28, -18, 0), 'Right': ('plant', -.12, .17, -50, 16)},
        fists={'Left': ((.11, -.48, 1.18), _P_GL), 'Right': ((-.06, -.40, 1.16), _P_GR)})
ANIMS['fs_slip_l'] = _fs_clip(['fs_sll_dip', 'fs_sll_low', 'fs_sll_up', _GD], [0, 1, 2, 3], [80, 80, 80, 80])
_fs_key('fs_slr_dip', drop=.14, hips=(-36, 6, -5), turn=(4, 4, 2, 14, 12), lean=(6, 4, 2, 0, -2), bend=(-8, -6, -3, 6, 6),
        sh=((6, 8), (6, 6)), root=(-.06, -.02), feet={'Left': ('plant', .11, -.28, -18, 0), 'Right': ('plant', -.15, .17, -50, 14)},
        fists={'Left': ((.02, -.48, 1.14), _P_GL), 'Right': ((-.15, -.39, 1.15), _P_GR)})
_fs_key('fs_slr_low', drop=.22, hips=(-38, 8, -9), turn=(4, 4, 2, 15, 13), lean=(8, 5, 2, 0, -2), bend=(-14, -10, -5, 10, 10),
        sh=((6, 8), (6, 6)), root=(-.12, -.02), feet={'Left': ('plant', .10, -.28, -18, 0), 'Right': ('plant', -.16, .17, -50, 12)},
        fists={'Left': ((-.03, -.46, 1.02), _P_GL), 'Right': ((-.21, -.37, 1.03), _P_GR)})
_fs_key('fs_slr_up', drop=.12, hips=(-34, 5, -3), turn=(4, 4, 2, 13, 11), lean=(5, 4, 2, 0, -2), bend=(-5, -4, -2, 4, 4),
        sh=((6, 8), (6, 6)), root=(-.05, -.01), feet={'Left': ('plant', .12, -.28, -18, 0), 'Right': ('plant', -.14, .17, -50, 14)},
        fists={'Left': ((.03, -.49, 1.18), _P_GL), 'Right': ((-.14, -.40, 1.17), _P_GR)})
ANIMS['fs_slip_r'] = _fs_clip(['fs_slr_dip', 'fs_slr_low', 'fs_slr_up', _GD], [0, 1, 2, 3], [80, 80, 80, 80])
_fs_key('fs_slb_a', drop=.08, hips=(-30, -2, 0), turn=(4, 4, 2, 12, 10), lean=(-6, -5, -3, 2, 0), sh=((8, 8), (8, 8)),
        root=(0, .06), feet={'Left': ('plant', .13, -.22, -18, 4), 'Right': _FS_R[:4] + (8,)},
        fists={'Left': ((.07, -.40, 1.30), _P_GL), 'Right': ((-.10, -.34, 1.28), _P_GR)})
_fs_key('fs_slb_b', drop=.10, hips=(-30, -6, 0), turn=(4, 4, 2, 12, 10), lean=(-10, -8, -5, 4, 2), sh=((10, 8), (10, 8)),
        root=(0, .14), feet={'Left': ('plant', .13, -.14, -18, 12), 'Right': ('plant', -.13, .25, -50, 4)},
        fists={'Left': ((.07, -.30, 1.31), _P_GL), 'Right': ((-.10, -.25, 1.29), _P_GR)})
_fs_key('fs_slb_c', drop=.09, hips=(-31, 1, 0), turn=(4, 4, 2, 12, 10), lean=(1, 1, 0, 0, -1), sh=((7, 8), (7, 7)),
        root=(0, .06), feet={'Left': ('plant', .13, -.22, -18, 4), 'Right': ('plant', -.13, .21, -50, 10)},
        fists={'Left': ((.07, -.46, 1.28), _P_GL), 'Right': ((-.11, -.38, 1.26), _P_GR)})
ANIMS['fs_slip_b'] = _fs_clip(['fs_slb_a', 'fs_slb_b', 'fs_slb_c', _GD], [0, 1, 2, 3], [80, 80, 80, 80])

# ---- the clinch (E at a foe in reach; he's held .52 m before him): squared up, both fists on his collar, the elbows down,
# leaning in. The grab reaches both hands for the collar from the guard; the clinch's moves start and end on its first
# key; the toss and the shove end in the guard. The stance is square (the feet side by side), so the short punches mirror.
def _fs_mirror(src, dst):
    """A fists key on the other side: the spec mirrored (skeleton.py mirrored()), '_root', the feet and the fists swapped
    and turned over (x, yaw, the poles)."""
    sp = mirrored(POSES[src])
    if '_root' in sp:
        sp['_root'] = (-sp['_root'][0], sp['_root'][1])
    POSES[dst] = sp
    other = {'Left': 'Right', 'Right': 'Left'}
    S = FS_AT[src]
    feet = {}
    for side, f in S['feet'].items():
        if f[0] == 'plant':
            feet[other[side]] = ('plant', -f[1], f[2], -f[3]) + tuple(f[4:])
        else:
            feet[other[side]] = ('free', (-f[1][0],) + tuple(f[1][1:]), (-f[2][0],) + tuple(f[2][1:])) + \
                ((([(a, d if a == 'X' else -d) for a, d in f[3]],) if len(f) > 3 and f[3] is not None else ()))
    fists = {other[side]: ((-p[0], p[1], p[2]), (-q[0], q[1], q[2])) for side, (p, q) in S['fists'].items()}
    FS_AT[dst] = {'drop': S['drop'], 'feet': feet, 'fists': fists}
    return dst


_CL_FEET = {'Left': ('plant', .15, -.10, 10, 6), 'Right': ('plant', -.15, -.10, -10, 6)}   # square, toes a little out
_P_CL, _P_CR = (.5, .4, -1), (-.5, .4, -1)    # the elbows down and in
_FS_CL = dict(hips=(0, 5, 0), turn=(0, 0, 0, -8, -6), lean=(2, 1, 0, -2, -4), bend=(2, 2, 0, 4, 4), sh=((6, 6), (6, 6)),
              root=(0, .01))   # (the head tipped to his left, beside the held man's: at .52 m two heads this big overlap)
_fs_key('fs_cl_a', drop=.09, feet=_CL_FEET, fists={'Left': ((.07, -.40, 1.28), _P_CL), 'Right': ((-.07, -.40, 1.28), _P_CR)}, **_FS_CL)
_fs_key('fs_cl_b', drop=.11, feet=_CL_FEET, fists={'Left': ((.07, -.40, 1.26), _P_CL), 'Right': ((-.07, -.40, 1.26), _P_CR)},
        **{**_FS_CL, 'lean': (3, 2, 1, -3, -4), 'sh': ((4, 6), (4, 6))})
ANIMS['fs_clinch'] = _fs_clip(['fs_cl_a', 'fs_cl_b'], [0, 1], [450, 450], loop=True, marks={'loop': 0})
_CL = 'fs_cl_a'

# the grab: a small crouch with the hands drawn in, both hands shooting out to his collar (1.35 m, ~.45 m ahead), the
# fists close on it pulling in, settled into the clinch
_fs_key('fs_gb_wind', drop=.11, hips=(-28, 5, 0), turn=(4, 4, 2, 10, 8), lean=(6, 4, 2, 0, -2), sh=((4, 6), (4, 6)),
        root=(0, .01), feet={'Left': _FS_L[:4] + (0,), 'Right': _FS_R[:4] + (14,)},
        fists={'Left': ((.13, -.40, 1.19), (.7, .3, -1)), 'Right': ((-.13, -.35, 1.17), (-.7, .3, -1))})
_fs_key('fs_gb_reach', drop=.08, hips=(-14, 7, 0), turn=(2, 2, 1, 5, 4), lean=(8, 5, 3, -2, -3), sh=((8, 14), (8, 14)),
        root=(0, -.06), feet={'Left': ('plant', .14, -.24, -6, 0), 'Right': ('plant', -.14, .06, -30, 16)},
        fists={'Left': ((.11, -.52, 1.31), (.6, .2, -1)), 'Right': ((-.11, -.52, 1.31), (-.6, .2, -1))})
_fs_key('fs_gb_grip', drop=.09, hips=(-6, 8, 0), turn=(1, 1, 0, 2, 2), lean=(6, 4, 2, -3, -4), sh=((6, 10), (6, 10)),
        root=(0, -.06), feet={'Left': ('plant', .15, -.16, 4, 4), 'Right': ('plant', -.15, -.04, -18, 10)},
        fists={'Left': ((.07, -.45, 1.29), _P_CL), 'Right': ((-.07, -.45, 1.29), _P_CR)})
ANIMS['fs_grab'] = _fs_clip(['fs_gb_wind', 'fs_gb_reach', 'fs_gb_grip', _CL], [0, 1, 2, 3], [20, 120, 110, 110], marks={'hit': 2})

# the short punches: a hand lets go and drops (the body dips and turns that way), a short uppercut into the held man's
# face (~.38 m ahead, 1.5 m: the forearm upright, inside, the other fist still on the collar), back onto the collar
_fs_key('fs_cll_wind', drop=.15, hips=(14, 8, 0), turn=(4, 3, 1, -9, -9), lean=(6, 4, 2, -4, -4), bend=(7, 5, 2, -5, -5),
        sh=((-8, -2), (6, 6)), root=(.03, -.04), feet=_CL_FEET,
        fists={'Left': ((.17, -.24, 1.02), (.7, .5, -1)), 'Right': ((-.07, -.41, 1.27), _P_CR)})
_fs_key('fs_cll_hit', drop=.04, hips=(-20, 5, 0), turn=(-4, -3, -1, 14, 13), lean=(2, 0, -1, -2, -4), bend=(-3, -2, 0, 3, 3),
        sh=((14, 10), (6, 6)), root=(0, -.05), feet={'Left': ('plant', .15, -.10, 0, 16), 'Right': _CL_FEET['Right']},
        fists={'Left': ((.03, -.38, 1.52), _P_UP), 'Right': ((-.07, -.40, 1.25), _P_CR)})
_fs_key('fs_cll_back', drop=.09, hips=(-4, 7, 0), turn=(-1, -1, 0, 3, 3), lean=(5, 3, 1, -4, -4), sh=((8, 7), (6, 6)),
        root=(0, -.04), feet=_CL_FEET, fists={'Left': ((.06, -.39, 1.37), _P_CL), 'Right': ((-.07, -.40, 1.27), _P_CR)})
ANIMS['fs_cl_l'] = _fs_clip(['fs_cll_wind', 'fs_cll_hit', 'fs_cll_back', _CL], [0, 1, 2, 3], [20, 70, 95, 95], marks={'hit': 1})
for _k in ('fs_cll_wind', 'fs_cll_hit', 'fs_cll_back'):
    _fs_mirror(_k, _k.replace('fs_cll', 'fs_clr'))
ANIMS['fs_cl_r'] = _fs_clip(['fs_clr_wind', 'fs_clr_hit', 'fs_clr_back', _CL], [0, 1, 2, 3], [20, 70, 95, 95], marks={'hit': 1})

# the knee: both hands haul his collar down, the weight onto the left leg, the right knee driven up into his belly
# (~.35 m ahead, 1.0 m), the foot set back down, the clinch
_fs_key('fs_kn_pull', drop=.11, hips=(4, -2, -3), turn=(0, 0, 0, -2, -2), lean=(-4, -3, -1, 0, -3), sh=((-2, 2), (-2, 2)),
        root=(.03, .01), feet={'Left': _CL_FEET['Left'], 'Right': ('plant', -.15, -.08, -10, 24)},
        fists={'Left': ((.08, -.33, 1.12), _P_CL), 'Right': ((-.08, -.33, 1.12), _P_CR)})
_fs_key('fs_kn_up', drop=.06, hips=(6, -6, -4), turn=(0, 0, 0, -3, -3), lean=(4, 3, 1, -3, -3), sh=((0, 2), (0, 2)),
        root=(.03, -.07), feet={'Left': _CL_FEET['Left'], 'Right': ('free', (-.10, -.12, .44), (0, -.6, .8), [('X', -30)])},
        fists={'Left': ((.07, -.36, 1.14), _P_CL), 'Right': ((-.07, -.36, 1.14), _P_CR)})
_fs_key('fs_kn_hit', drop=.01, hips=(6, -12, -4), turn=(0, 0, 0, -3, -3), lean=(10, 7, 3, -4, -4), sh=((-2, 0), (-2, 0)),
        root=(.03, -.10), feet={'Left': ('plant', .15, -.10, 10, 20), 'Right': ('free', (-.07, -.25, .70), (0, -.3, 1), [('X', -45)])},
        fists={'Left': ((.07, -.34, 1.08), _P_CL), 'Right': ((-.07, -.34, 1.08), _P_CR)})
_fs_key('fs_kn_down', drop=.08, hips=(4, 2, -2), turn=(0, 0, 0, -1, -1), lean=(5, 3, 1, -4, -4), sh=((4, 4), (4, 4)),
        root=(.02, -.05), feet={'Left': _CL_FEET['Left'], 'Right': ('free', (-.14, -.02, .18), (0, -1, .4), [('X', -10)])},
        fists={'Left': ((.07, -.38, 1.28), _P_CL), 'Right': ((-.07, -.38, 1.28), _P_CR)})
ANIMS['fs_knee'] = _fs_clip(['fs_kn_pull', 'fs_kn_up', 'fs_kn_hit', 'fs_kn_down', _CL], [0, 1, 2, 3, 4], [20, 120, 80, 80, 80],
                            marks={'hit': 2})

# the clinch headbutt: the head and chest back (the fists pulling the collar), then the forehead into his face, the
# recoil, the clinch
_fs_key('fs_ch_back', drop=.09, hips=(0, -2, 0), turn=(0, 0, 0, 0, 0), lean=(-5, -5, -3, 0, -8), sh=((6, 2), (6, 2)),
        root=(0, .05), feet=_CL_FEET, fists={'Left': ((.07, -.38, 1.26), _P_CL), 'Right': ((-.07, -.38, 1.26), _P_CR)})
_fs_key('fs_ch_drive', drop=.09, hips=(0, 5, 0), turn=(0, 0, 0, 0, 0), lean=(3, 2, 1, 0, 2), sh=((4, 6), (4, 6)),
        root=(0, .02), feet=_CL_FEET, fists={'Left': ((.07, -.36, 1.23), _P_CL), 'Right': ((-.07, -.36, 1.23), _P_CR)})
_fs_key('fs_ch_hit', drop=.08, hips=(0, 6, 0), turn=(0, 0, 0, 0, 0), lean=(4, 3, 2, 1, 5), sh=((2, 8), (2, 8)),
        root=(0, .02), feet={'Left': ('plant', .15, -.12, 10, 10), 'Right': ('plant', -.15, -.12, -10, 10)},
        fists={'Left': ((.07, -.33, 1.21), _P_CL), 'Right': ((-.07, -.33, 1.21), _P_CR)})
_fs_key('fs_ch_recoil', drop=.10, hips=(0, 2, 0), turn=(0, 0, 0, 0, 0), lean=(0, 0, 0, -3, -7), sh=((6, 4), (6, 4)),
        root=(0, -.01), feet=_CL_FEET, fists={'Left': ((.07, -.39, 1.27), _P_CL), 'Right': ((-.07, -.39, 1.27), _P_CR)})
ANIMS['fs_cl_head'] = _fs_clip(['fs_ch_back', 'fs_ch_drive', 'fs_ch_hit', 'fs_ch_recoil', _CL], [0, 1, 2, 3, 4],
                               [30, 110, 100, 100, 110], marks={'hit': 2})

# the hip toss: a quarter turn to his right with the hips stepped in under the held man's (his left hip loads him: the
# side the turn puts there), bent over to load him onto the hip and back, both arms sweeping him across to the right and
# down (the release), the follow-through, back to the guard
_fs_key('fs_ts_in', drop=.14, hips=(-40, 8, 0), turn=(-4, -3, -2, 20, 16), lean=(6, 4, 2, -2, -4), sh=((6, 8), (6, 8)),
        root=(.06, -.12), feet={'Left': ('plant', .16, -.18, -20, 4), 'Right': ('plant', -.04, -.04, -60, 20)},
        fists={'Left': ((.12, -.40, 1.32), _P_CL), 'Right': ((-.02, -.42, 1.28), _P_CR)})
_fs_key('fs_ts_load', drop=.20, hips=(-88, 4, -12), turn=(-6, -4, -2, 40, 30), lean=(4, 2, 1, -6, -6), bend=(-14, -8, -4, 6, 6), sh=((8, 10), (6, 8)),
        root=(.10, -.20), feet={'Left': ('plant', .14, -.34, -88, 4), 'Right': ('plant', .10, -.02, -96, 8)},
        fists={'Left': ((.20, -.34, 1.28), (.6, .5, -1)), 'Right': ((.02, -.50, 1.14), (-.4, .2, -1))})
_fs_key('fs_ts_over', drop=.16, hips=(-104, 6, -18), turn=(-8, -6, -3, 44, 36), lean=(4, 3, 1, -8, -8), bend=(-22, -12, -6, 8, 8), sh=((10, 10), (8, 8)),
        root=(.10, -.20), feet={'Left': ('plant', .14, -.34, -92, 6), 'Right': ('plant', .10, -.02, -100, 12)},
        fists={'Left': ((-.04, -.42, 1.14), (.6, .3, -1)), 'Right': ((-.24, -.40, 1.00), (-.4, .3, -1))})
_fs_key('fs_ts_release', drop=.13, hips=(-116, 6, -22), turn=(-8, -6, -3, 46, 40), lean=(5, 3, 2, -10, -10), bend=(-26, -14, -8, 10, 10), sh=((12, 12), (8, 10)),
        root=(.08, -.18), feet={'Left': ('plant', .14, -.34, -96, 10), 'Right': ('plant', .10, -.02, -104, 14)},
        fists={'Left': ((-.30, -.46, .96), (.6, .3, -1)), 'Right': ((-.44, -.26, .88), (-.3, .3, -1))})
_fs_key('fs_ts_follow', drop=.10, hips=(-100, 4, -12), turn=(-6, -4, -2, 40, 34), lean=(3, 2, 1, -6, -6), bend=(-14, -8, -4, 6, 6), sh=((6, 8), (6, 8)),
        root=(.06, -.14), feet={'Left': ('plant', .14, -.34, -90, 4), 'Right': ('plant', .08, -.02, -96, 10)},
        fists={'Left': ((-.14, -.48, 1.12), (.6, .3, -1)), 'Right': ((-.30, -.32, 1.06), (-.4, .3, -1))})
ANIMS['fs_toss'] = _fs_clip(['fs_ts_in', 'fs_ts_load', 'fs_ts_over', 'fs_ts_release', 'fs_ts_follow', _GD], [0, 1, 2, 3, 4, 5],
                            [20, 120, 140, 100, 100, 90], marks={'hit': 3})

# the shove: the palms drawn in to the chest (a crouch), driven out at his chest with the weight behind them (extended),
# back up, the guard
_fs_key('fs_sv_load', drop=.13, hips=(-6, 4, 0), turn=(1, 1, 0, 2, 2), lean=(2, 1, 0, -2, -3), sh=((2, -4), (2, -4)),
        root=(0, .02), feet=_CL_FEET, fists={'Left': ((.12, -.30, 1.24), (.8, .4, -1)), 'Right': ((-.12, -.30, 1.24), (-.8, .4, -1))})
_fs_key('fs_sv_hit', drop=.06, hips=(-10, 10, 0), turn=(1, 1, 0, 3, 3), lean=(10, 6, 3, -4, -6), sh=((6, 16), (6, 16)),
        root=(0, -.10), feet={'Left': ('plant', .15, -.20, 4, 4), 'Right': ('plant', -.15, .04, -24, 30)},
        fists={'Left': ((.13, -.62, 1.30), (.6, .2, -1)), 'Right': ((-.13, -.62, 1.30), (-.6, .2, -1))})
_fs_key('fs_sv_back', drop=.08, hips=(-22, 6, 0), turn=(3, 3, 1, 8, 7), lean=(6, 4, 2, -1, -3), sh=((6, 8), (6, 8)),
        root=(0, -.05), feet={'Left': ('plant', .14, -.25, -10, 2), 'Right': ('plant', -.14, .10, -40, 18)},
        fists={'Left': ((.10, -.50, 1.28), _P_GL), 'Right': ((-.11, -.46, 1.27), _P_GR)})
ANIMS['fs_shove'] = _fs_clip(['fs_sv_load', 'fs_sv_hit', 'fs_sv_back', _GD], [0, 1, 2, 3], [20, 100, 110, 110], marks={'hit': 1})


# ================================================================ fists (the gunmen, live only: docs/exp/fists.md) ====
# The unarmed gunmen's fist fight (features/foes/brawler.js plays these by the sim's state: content/fists.js FOE / REACT),
# made for the live models only and exported with ragdoll_export.py --clips into pivot3d_chars/<type> (keeping the brawl
# clips: --clips fx_pickup,fx_hat_on,fx_stagger,fx_sting,fx_limp,<these>). The revolver stays in its holster in every key
# (no key here starts with gun_); the bruiser's coach gun hangs from his right fist as built (the game hides it while he
# boxes). He faces -Y, +X is his left, 1.8 m; the pivot (his middle, the sim's spot) is under the Hips: no key moves it.
# Read from the game camera (orthographic, 55 deg down, ~30 px a metre, the wide brims hide what's right before the face):
# the guard's fists sit at the chin but well forward of the brim's edge, the telegraphs are whole-body (a turn away, the
# elbow out, the weight back), the hits big (the head snapped so the brim tips, the body folded).
#   fx_guard    a brawler's guard: low and wide, left foot forward, shoulders hunched, the fists up forward of the brim,
#               the head down; a heavy bob (loop 0)
#   fx_gstep    the guard shuffling forward: the lead foot steps, the trail foot drags up, never crossing; the ground data
#               measured from the soles (locomotion: stride ~.44 m a cycle); played backwards to back off (loop 0)
#   fx_jab      the left: the telegraph (the left fist cocked back by the ear, the shoulder dropped and pulled back, the
#               elbow out behind, crouched: wind 0), held, extend, contact (the arm straight up at the target's face: hit
#               3), retract, guard
#   fx_hay      the right haymaker: wound up (the right fist cocked behind the head, the body turned away, the left arm out:
#               wind 0), held tighter, the swing (a wide arc), contact (hit 3), overextended, recover, guard
#   fx_block    the forearms up before the face take it, pushed back, hold, guard
#   fx_gbreak   the guard knocked open: the arms flung wide, a stumble back, recover, guard
#   fx_hit_jab  the head snapped back (the chin up, the brim tipping up), held, guard
#   fx_hit_l    the head and shoulders turned hard to his left (struck on the right cheek), a stagger step left, guard
#   fx_hit_r    the same to his right
#   fx_hit_gut  folded over the belly (both hands in, the knees bent, the head down), held, straightening, guard
#   fx_daze     the arms low, the head lolling, swaying, a stumble step (loop 0)
#   fx_held     grabbed by the collar: his hands on the player's forearms, leaning back (loop 0)
#   fx_taunt    "come on": the chin up, the right hand beckons twice, back to the guard
# The kit: _fxf_legs places the feet (ankles on ground points in his frame, the pelvis at a height: a two-bone solve in the
# leg's plane), so planted feet stay put from key to key; the fists go on points through BRAWL_AT (None: height over the
# ground), the elbows turned toward points after (FXF_POLE), the hat knocked askew on the head (FXF_HAT). Keys are
# fx_fs_*; helpers _fxf_* (the cowboy's fists section has its own). Review sheets: tmp/fists/foes/sheets.
FISTS_FOES = ('fx_guard', 'fx_gstep', 'fx_jab', 'fx_hay', 'fx_block', 'fx_gbreak', 'fx_hit_jab', 'fx_hit_l', 'fx_hit_r',
              'fx_hit_gut', 'fx_daze', 'fx_held', 'fx_taunt')
_FXF_L1, _FXF_L2 = math.hypot(.005, .342), math.hypot(.015, .297)                     # thigh, shin (m at 1.8: skeleton.py)
_FXF_T0, _FXF_S0 = math.degrees(math.atan2(.005, .342)), math.degrees(math.atan2(.015, .297))   # their rest leans (fwd, back)
FXF_HAT = {}   # key -> (tip, roll): the hat knocked on the head (deg: tipped back, its front brim up; rolled to his left, its
              # left brim down), about the back / the low side of its band (_fxf_hat)


def _fxf_hat(pose_name):
    """HOLD hook: a fists key's hat knocked askew on the head (FXF_HAT); other keys untouched."""
    v = FXF_HAT.get(_key(pose_name))
    arm = bpy.data.objects[ROOT]
    pbs, bones = arm.pose.bones, arm.data.bones
    if not v or 'HatHold0' not in pbs:
        return
    J, k = landmarks(), PROP['height'] / 1.8
    zb = J['head'].z + .69 * (J['top'].z - J['head'].z)             # the band's height (the brim's root)
    R3 = pbs['Head'].matrix.to_3x3() @ bones['Head'].matrix_local.to_3x3().inverted()
    hb = pbs['HatHold0']
    for deg, piv, ax in ((-v[0], Vector((0, .2, zb / k)), Vector((1, 0, 0))),
                         (v[1], Vector((math.copysign(.2, v[1] or 1), .012, zb / k)), Vector((0, 1, 0)))):
        if deg:
            p = _carried('Head', piv * k)
            hb.matrix = (Matrix.Translation(p) @ Matrix.Rotation(math.radians(deg), 4, (R3 @ ax).normalized()) @
                         Matrix.Translation(-p) @ hb.matrix)
            bpy.context.view_layer.update()


FXF_POLE = {}  # key -> [(side, (x, y, z))]: that elbow turned toward the point (his frame, z over the ground) about the
              # shoulder-wrist line after the fists' IK (which keeps the plane the spec gives), then the fists set again


def _fxf_after(pose_name):
    """HOLD hook (after _bw_hold): a fists key's elbows turned toward their poles (FXF_POLE) and the fists put back on
    their points, then the hat (FXF_HAT)."""
    key = _key(pose_name)
    if FXF_POLE.get(key):
        pbs, k, g = bpy.data.objects[ROOT].pose.bones, PROP['height'] / 1.8, _bw_ground()
        for side, p in FXF_POLE[key]:
            up, fa = pbs[side + 'Arm'], pbs[side + 'ForeArm']
            sh = up.head.copy()
            ax = (fa.tail - sh).normalized()
            a, b = fa.head - sh, Vector(p) * k + Vector((0, 0, g)) - sh
            a, b = a - ax * a.dot(ax), b - ax * b.dot(ax)
            if a.length > 1e-4 and b.length > 1e-4:
                ang = a.angle(b) * (1 if a.cross(b).dot(ax) > 0 else -1)
                up.matrix = Matrix.Translation(sh) @ Matrix.Rotation(ang, 4, ax) @ Matrix.Translation(-sh) @ up.matrix
                bpy.context.view_layer.update()
        _bw_hold(pose_name)
    _fxf_hat(pose_name)


def _fxf_hip(sx, blade, tilt):
    """The hip joint (m from the Hips head; sx 1 left, -1 right) under the pelvis turned `blade` (+ his left), tipped
    `tilt` (+ forward)."""
    x, y, z = sx * .095, 0.0, -.04
    b, h = math.radians(blade), math.radians(tilt)
    x, y = x * math.cos(b) - y * math.sin(b), x * math.sin(b) + y * math.cos(b)
    return x, y * math.cos(h) - z * math.sin(h), y * math.sin(h) + z * math.cos(h)


def _fxf_leg(sx, P, blade, tilt, foot):
    """One leg for _fxf_legs: foot = (x, y, pitch, yaw, lift): the ankle over the ground point (x, y) (his frame, y back),
    pitched (+ toe down: the heel up, on the toe; - toe up, on the heel), yawed (+ his left, from the pelvis' turn), lifted
    (m, off the ground). Returns the thigh / shin world angles (_bw_legs' signs), the leg plane's roll, pitch, yaw."""
    x, y, pitch, yaw, lift = (tuple(foot) + (0, 0, 0))[:5]
    hx, hy, hz = _fxf_hip(sx, blade, tilt)
    hz += P
    p = math.radians(pitch)
    # (heel up: the foot pivots on its boot toe, ~.16 m ahead of the ankle; toe up: on the back of the heel, .08 behind)
    az = (.16 * math.sin(p) + .081 * math.cos(p) if p >= 0 else .081 * math.cos(p) - .08 * math.sin(p)) + lift
    dx, dy, dz = x - hx, y - hy, az - hz
    a = math.atan(dx / dz)                                    # the leg's plane rolled about the forward axis
    down, fwd = -dx * math.sin(a) - dz * math.cos(a), -dy
    D = min(math.hypot(fwd, down), .999 * (_FXF_L1 + _FXF_L2))
    phi = math.atan2(fwd, down)
    al = math.acos(max(-1, min(1, (_FXF_L1 ** 2 + D * D - _FXF_L2 ** 2) / (2 * _FXF_L1 * D))))
    be = math.acos(max(-1, min(1, (_FXF_L2 ** 2 + D * D - _FXF_L1 ** 2) / (2 * _FXF_L2 * D))))
    th, sh = math.degrees(phi + al), math.degrees(phi - be)   # forward angles of the thigh and the shin
    return -(th - _FXF_T0), -(sh + _FXF_S0), math.degrees(a), pitch, yaw


def _fxf_legs(P, blade, tilt, L, R):
    """The pelvis (its Hips head P m over the ground, turned `blade`, tipped `tilt`) and both legs onto their feet (L, R:
    _fxf_leg's foot tuples). World-axis composition: the thigh Rx(t) in the rolled plane, the shin likewise, the foot flat
    (pitched) and yawed after."""
    out = {'Hips': [('Z', blade), ('X', tilt)]}
    for sx, nm, foot in ((1, 'Left', L), (-1, 'Right', R)):
        t, s, a, f, yaw = _fxf_leg(sx, P, blade, tilt, foot)
        out[nm + 'UpLeg'] = [('X', t - tilt), ('Y', a)]
        out[nm + 'Leg'] = [('Y', -a), ('X', s - t), ('Y', a)]
        out[nm + 'Foot'] = [('Y', -a), ('X', f - s)] + ([('Z', yaw)] if yaw else [])
    return out


def _fxf_spine(lean=(0, 0, 0), turn=(0, 0, 0), side=(0, 0, 0), neck=(0, 0, 0), head=(0, 0, 0)):
    """The back: lean (Spine, Spine1, Spine2: + forward), turn (+ his left), side (+ bent to his left); neck / head: (X
    + down, Z + his left, Y + rolled to his left). Each bone: turn, then side, then lean."""
    out = {}
    for b, l, t, s in zip(('Spine', 'Spine1', 'Spine2'), lean, turn, side):
        out[b] = [r for r in (('Z', t), ('Y', s), ('X', l)) if r[1]]
    for b, (x, z, y) in (('Neck', neck), ('Head', head)):
        out[b] = [r for r in (('Z', z), ('Y', y), ('X', x)) if r[1]]
    return out


def _fxf_arms(l=(40, -50, 0, -110), r=(-40, -45, 0, -120), lsh=(0, 0), rsh=(0, 0)):
    """Rough arm specs giving the elbows their plane before the fists' IK (BRAWL_AT): (Y lower, X forward, Z turn,
    forearm bend) per arm (the right's Y is mirrored: - lowers it); lsh / rsh: the collarbone (Y: - raises the left,
    + raises the right; Z: - forward for the left, + for the right)."""
    out = {}
    for nm, (y, x, z, fx), (sy, sz) in (('Left', l, lsh), ('Right', r, rsh)):
        out[nm + 'Shoulder'] = [q for q in (('Y', sy), ('Z', sz)) if q[1]]
        out[nm + 'Arm'] = [q for q in (('Y', y), ('X', x), ('Z', z)) if q[1]]
        out[nm + 'ForeArm'] = [('X', fx)]
        out[nm + 'Hand'] = []
    return out


def _fxf_key(name, P, blade, tilt, L, R, spine, arms, fists, extra=None):
    """A key: legs (_fxf_legs), back (_fxf_spine kwargs), arms (_fxf_arms kwargs), the fists' points [(side, bone, xyz,
    mode)] (BRAWL_AT; a bare (x, y, z) = height over the ground, 'fist'), extra rotations merged after."""
    spec = _merge(_fxf_legs(P, blade, tilt, L, R), _fxf_spine(**spine), _fxf_arms(**arms), extra or {})
    POSES[name] = spec
    BRAWL_AT[name] = [(f[0], None, f[1], 'fist') if len(f) == 2 else tuple(f) for f in fists]
    return spec


def _fxk(name, P, blade, tilt, L, R, sp, ar, fl, fr, extra=None, hat=None, pole=None):
    """_fxf_key with the two fists: each (x, y, z) over the ground, or a whole BRAWL_AT entry after the side; hat: FXF_HAT;
    pole: (left elbow point | None, right elbow point | None) for FXF_POLE."""
    pt = lambda f: (f,) if not isinstance(f[0], str) else tuple(f)
    if hat:
        FXF_HAT[name] = hat
    if pole:
        FXF_POLE[name] = [(sd, q) for sd, q in zip(('Left', 'Right'), pole) if q]
    return _fxf_key(name, P, blade, tilt, L, R, sp, ar, [('Left',) + pt(fl), ('Right',) + pt(fr)], extra)


def _fxsp(base, **kw):
    return dict(base, **kw)


# ---- the guard: low and wide, left foot forward (the pelvis turned 24 deg right, the chest squarer), the knees bent, the
# shoulders hunched, the head forward and down; the left fist forward at the chin, the right a little back and higher,
# the elbows down and out. The bob: down (the knees give), back up with a roll of the shoulders, up on the back toes
_FXG_L, _FXG_R = (.13, -.24, 0, 12), (-.15, .22, 8, -18)
_FXG_SP = dict(lean=(6, 5, 3), turn=(6, 5, 4), neck=(-12, 5, 0), head=(5, 4, 0))
_FXG_ARM = dict(l=(30, -40, 16, -115), r=(-30, -36, -16, -125), lsh=(-12, -8), rsh=(12, 8))
_FXG_POLE = ((.30, -.16, .98), (-.34, -.10, .98))
_FXG_FL, _FXG_FR = (.08, -.44, 1.24), (-.14, -.32, 1.28)
_fxk('fx_fs_guard_a', .69, -24, 6, _FXG_L, _FXG_R, _FXG_SP, _FXG_ARM, _FXG_FL, _FXG_FR, pole=_FXG_POLE)
_fxk('fx_fs_guard_b', .655, -24, 8, _FXG_L, (-.15, .22, 10, -18), _fxsp(_FXG_SP, lean=(7, 6, 4)), _FXG_ARM, (.09, -.43, 1.19),
     (-.14, -.31, 1.235), pole=_FXG_POLE)
_fxk('fx_fs_guard_c', .685, -22, 6, _FXG_L, _FXG_R, _fxsp(_FXG_SP, side=(-2, -1, 0)), _FXG_ARM, (.07, -.46, 1.235), (-.13, -.33, 1.275),
     pole=_FXG_POLE)
_fxk('fx_fs_guard_d', .705, -25, 5, _FXG_L, (-.15, .22, 18, -18), _fxsp(_FXG_SP, lean=(5, 5, 3)), _FXG_ARM, (.08, -.43, 1.27),
     (-.145, -.31, 1.305), pole=_FXG_POLE)
ANIMS['fx_guard'] = _clip(['fx_fs_guard_a', 'fx_fs_guard_b', 'fx_fs_guard_c', 'fx_fs_guard_d'], [0, 1, 2, 3], 7, loop=True,
                          ms=[150, 170, 150, 150], marks={'loop': 0})

# ---- the shuffle: the lead foot lifts, steps, lands .22 ahead; the trail foot drags up behind it, never crossing. The
# pivot moves .11 m a frame (stride .44): a planted foot (flat) slides back that much from key to key; the stance opens
# .24 -> .68 and closes. (The game plays it backwards to back off.)
_FXGS = [(.70, (.13, -.13, 0, 12, .004), (-.15, .11, 0, -18)), (.69, (.13, -.29, 8, 12, .09), (-.15, .22, 0, -18)),
       (.67, (.13, -.35, 0, 12), (-.15, .33, 0, -18, .004)), (.685, (.13, -.24, 0, 12), (-.15, .20, 8, -18, .09))]
for _fxi, (_fxP, _fxl, _fxr) in enumerate(_FXGS):
    _fxd = _fxP - .69
    _fxk(f'fx_fs_gstep_{_fxi}', _fxP, -24, 6 + (2 if _fxi == 2 else 0), _fxl, _fxr, _FXG_SP, _FXG_ARM,
         (_FXG_FL[0], _FXG_FL[1], _FXG_FL[2] + _fxd), (_FXG_FR[0], _FXG_FR[1], _FXG_FR[2] + _fxd), pole=_FXG_POLE)
ANIMS['fx_gstep'] = dict(_clip([f'fx_fs_gstep_{i}' for i in range(4)], [0, 1, 2, 3], 12, loop=True, marks={'loop': 0}),
                         locomotion=True)

# ---- the jab (the left). The telegraph: crouched lower and coiled, the left shoulder dropped and pulled back (the chest
# turned to his left), the left fist cocked back up beside the ear with the elbow out behind, the head down; held, wound a
# little more. The extend: turning in, the lead foot stepping. The contact: up on the back toes, leaning 35 deg, the chest
# turned 48 deg right, the left shoulder up to the chin, the arm straight up toward the target's face (.85 m, 1.5 m)
_FXJ_ARM = lambda l, lsh: dict(l=l, r=(-30, -36, -16, -125), lsh=lsh, rsh=(12, 8))
_fxk('fx_fs_jab_wind', .655, -14, 8, (.13, -.24, -4, 12), (-.15, .22, 0, -18),
     dict(lean=(4, 3, 2), turn=(10, 10, 8), neck=(-14, -8, 0), head=(8, -6, 0)),
     _FXJ_ARM((-40, 0, 50, -140), (10, 14)), (.25, .04, 1.30), (-.11, -.32, 1.26), pole=((.44, .18, 1.10), _FXG_POLE[1]))
_fxk('fx_fs_jab_hold', .65, -12, 9, (.13, -.24, -6, 12), (-.15, .22, 0, -18),
     dict(lean=(5, 3, 2), turn=(12, 12, 9), neck=(-16, -10, 0), head=(8, -8, 0)),
     _FXJ_ARM((-42, 0, 56, -145), (12, 16)), (.26, .08, 1.31), (-.10, -.32, 1.26), pole=((.46, .22, 1.10), _FXG_POLE[1]))
_fxk('fx_fs_jab_ext', .69, -30, 10, (.13, -.28, 0, 12), (-.15, .24, 16, -18),
     dict(lean=(9, 6, 4), turn=(-2, -2, -2), neck=(-18, 14, 0), head=(2, 10, 0)),
     _FXJ_ARM((20, -60, 0, -60), (-10, -12)), (.10, -.58, 1.40), (-.10, -.31, 1.30), pole=((.30, -.30, 1.05), _FXG_POLE[1]))
_fxk('fx_fs_jab_hit', .71, -40, 14, (.13, -.27, 0, 12), (-.15, .25, 40, -18),
     dict(lean=(11, 6, 4), turn=(-3, -3, -2), neck=(-28, 26, 0), head=(-6, 20, 0)),
     _FXJ_ARM((10, -80, 0, -10), (-34, -30)), (.04, -.85, 1.50), (-.08, -.31, 1.30), pole=(None, _FXG_POLE[1]))
_fxk('fx_fs_jab_back', .69, -30, 9, (.13, -.28, 0, 12), (-.15, .23, 14, -18),
     dict(lean=(7, 5, 3), turn=(2, 2, 2), neck=(-14, 8, 0), head=(4, 6, 0)),
     _FXJ_ARM((20, -60, 0, -70), (-10, -10)), (.09, -.58, 1.32), (-.12, -.32, 1.28), pole=((.30, -.30, 1.0), _FXG_POLE[1]))
ANIMS['fx_jab'] = _clip(['fx_fs_jab_wind', 'fx_fs_jab_hold', 'fx_fs_jab_ext', 'fx_fs_jab_hit', 'fx_fs_jab_back', 'fx_fs_guard_a'],
                        [0, 1, 2, 3, 4, 5], 12, ms=[110, 190, 70, 70, 140, 140], marks={'wind': 0, 'hit': 3})

# ---- the haymaker (the right). Wound up: the chest turned 70 deg away to his right, leaning back, the weight on the back
# foot (the lead toe up), the right fist cocked behind the head and out past the brim (from above it shows beside the
# hat), the elbow up and out, the left fist low ahead, the head turned back to the target over the left shoulder; held,
# wound tighter. The swing: unwinding, the fist out wide in an arc at head height; the contact: the chest turned 38 deg
# left, leaning 40, up on the back toes, the right arm across to the face (.9 m, 1.5 m); overextended past it, down to his
# left; recovering; the guard
_fxk('fx_fs_hay_wind', .685, -42, -6, (.13, -.24, -14, 12), (-.15, .22, 0, -18),
     dict(lean=(-3, -2, -2), turn=(-12, -9, -7), neck=(-2, 36, 0), head=(6, 26, 0)),
     dict(l=(10, -70, 10, -30), r=(90, 10, -40, -70), lsh=(-6, -10), rsh=(28, -14)), (.24, -.46, 1.10), (-.46, .22, 1.48),
     pole=((.34, -.20, 1.0), (-.54, -.02, 1.30)))
_fxk('fx_fs_hay_hold', .68, -44, -8, (.13, -.24, -16, 12), (-.15, .22, 0, -18),
     dict(lean=(-4, -3, -2), turn=(-14, -11, -8), neck=(-2, 40, 0), head=(6, 28, 0)),
     dict(l=(10, -72, 10, -28), r=(94, 14, -40, -66), lsh=(-6, -12), rsh=(30, -16)), (.25, -.48, 1.10), (-.47, .25, 1.50),
     pole=((.34, -.20, 1.0), (-.56, .0, 1.32)))
_fxk('fx_fs_hay_swing', .67, -10, 6, (.13, -.26, 0, 12), (-.15, .23, 18, -18),
     dict(lean=(5, 4, 2), turn=(6, 6, 4), neck=(-12, -2, 0), head=(4, -2, 0)),
     dict(l=(30, -30, 20, -120), r=(70, -40, 0, -60), lsh=(4, 10), rsh=(12, 8)), (.18, -.12, 1.15), (-.55, -.30, 1.55),
     pole=((.30, -.05, .95), (-.45, -.05, 1.45)))
_fxk('fx_fs_hay_hit', .685, 10, 14, (.13, -.27, 0, 12), (-.15, .24, 40, 10),
     dict(lean=(12, 8, 5), turn=(10, 10, 8), neck=(-30, -18, 0), head=(-6, -14, 0)),
     dict(l=(30, -40, 20, -120), r=(10, -80, 0, -15), lsh=(4, 10), rsh=(30, 30)), (.14, -.18, 1.16), (-.02, -.90, 1.50),
     pole=((.30, -.05, .95), None))
_fxk('fx_fs_hay_over', .665, 25, 18, (.13, -.26, 0, 12), (-.15, .24, 50, 14),
     dict(lean=(12, 9, 6), turn=(12, 10, 8), neck=(-14, -20, 0), head=(6, -14, 0)),
     dict(l=(30, -20, 20, -100), r=(-10, -80, 20, -20), lsh=(6, 10), rsh=(6, 24)), (.20, -.10, .98), (.35, -.62, 1.10))
_fxk('fx_fs_hay_rec', .69, -10, 8, (.13, -.26, 0, 12), (-.15, .23, 14, -18),
     dict(lean=(6, 5, 3), turn=(6, 4, 4), neck=(-10, 0, 0), head=(4, 0, 0)), _FXG_ARM, (.12, -.38, 1.18), (-.10, -.32, 1.20),
     pole=_FXG_POLE)
ANIMS['fx_hay'] = _clip(['fx_fs_hay_wind', 'fx_fs_hay_hold', 'fx_fs_hay_swing', 'fx_fs_hay_hit', 'fx_fs_hay_over', 'fx_fs_hay_rec',
                         'fx_fs_guard_a'], [0, 1, 2, 3, 4, 5, 6], 12, ms=[200, 420, 120, 70, 160, 160, 170], marks={'wind': 0, 'hit': 3})

# ---- the block: both forearms up before the face (a shell, the elbows down in front, the chin tucked behind them),
# pushed back onto the back foot (the lead toe up); held; the guard
_FXB_ARM = dict(l=(40, -60, -10, -140), r=(-40, -60, 10, -140), lsh=(-8, -10), rsh=(8, 10))
_FXB_POLE = ((.14, -.24, 1.0), (-.16, -.24, 1.0))
_fxk('fx_fs_blk_hit', .665, -24, -8, (.13, -.24, -18, 12), (-.15, .22, 0, -18),
     dict(lean=(-10, -6, -4), turn=(6, 5, 4), neck=(10, 5, 0), head=(12, 4, 0)), _FXB_ARM, (.08, -.38, 1.42), (-.10, -.36, 1.44),
     hat=(4, 0), pole=_FXB_POLE)
_fxk('fx_fs_blk_hold', .675, -24, -2, (.13, -.24, -8, 12), (-.15, .22, 0, -18),
     dict(lean=(-5, -3, -2), turn=(6, 5, 4), neck=(4, 5, 0), head=(8, 4, 0)), _FXB_ARM, (.08, -.39, 1.40), (-.10, -.37, 1.42),
     pole=_FXB_POLE)
ANIMS['fx_block'] = _clip(['fx_fs_blk_hit', 'fx_fs_blk_hold', 'fx_fs_guard_a'], [0, 1, 2], 12, ms=[50, 100, 120])

# ---- the guard broken: the arms flung wide, the chest and head thrown back (the hat tipped up), a stumble (the back foot
# steps back, the lead toe up); the arms coming back in; the guard
_fxk('fx_fs_gb_open', .69, -20, -8, (.13, -.20, -16, 12), (-.17, .40, 0, -18),
     dict(lean=(-8, -6, -4), turn=(6, 5, 4), neck=(-10, 0, 0), head=(-6, 0, 0)),
     dict(l=(-30, -10, 40, -40), r=(30, -10, -40, -40), lsh=(-10, 12), rsh=(10, -12)), (.55, -.12, 1.30), (-.55, -.05, 1.24),
     hat=(10, 0))
_fxk('fx_fs_gb_rec', .67, -22, 4, (.13, -.22, 0, 12), (-.15, .30, 6, -18),
     dict(lean=(2, 1, 0), turn=(6, 5, 4), neck=(-6, 4, 0), head=(4, 4, 0)), _FXG_ARM, (.30, -.32, 1.15), (-.32, -.25, 1.12),
     pole=((.40, -.05, .95), (-.42, -.02, .95)))
ANIMS['fx_gbreak'] = _clip(['fx_fs_gb_open', 'fx_fs_gb_rec', 'fx_fs_guard_a'], [0, 1, 2], 12, ms=[60, 200, 180])

# ---- hit in the face: the head snapped back (the chin up, the hat knocked up off the brow), the chest back, the fists
# flung apart, the lead toe up; held, coming back; the guard
_fxk('fx_fs_hj_snap', .68, -24, -6, (.13, -.24, -12, 12), _FXG_R,
     dict(lean=(-6, -5, -4), turn=(6, 5, 4), neck=(-16, 5, 0), head=(-14, 4, 0)),
     dict(_FXG_ARM, l=(20, -20, 30, -60), r=(-20, -20, -30, -60)), (.26, -.20, 1.02), (-.28, -.14, 1.04), hat=(12, 0),
     pole=((.36, -.02, .95), (-.38, .02, .95)))
_fxk('fx_fs_hj_hold', .68, -24, -1, (.13, -.24, -4, 12), _FXG_R,
     dict(lean=(-4, -3, -2), turn=(6, 5, 4), neck=(-8, 5, 0), head=(-4, 4, 0)), _FXG_ARM, (.12, -.36, 1.15), (-.16, -.28, 1.19),
     hat=(6, 0), pole=_FXG_POLE)
ANIMS['fx_hit_jab'] = _clip(['fx_fs_hj_snap', 'fx_fs_hj_hold', 'fx_fs_guard_a'], [0, 1, 2], 12, ms=[50, 110, 120])


# ---- hit on the cheek: the head and shoulders wrenched round to his left (fx_hit_l: struck on the right cheek) or right,
# the back bent that way, the hat knocked askew that way, a stagger step out with that foot, the far fist flung across;
# held on the new foot; the guard
def _fxf_hit_side(name, sg):
    foot = (.30, -.20, 0, 24) if sg > 0 else (-.32, .16, 0, -34)
    L, R = (foot, (-.13, .20, 14, -18)) if sg > 0 else ((.13, -.24, 0, 12), foot)
    _fxk(f'fx_fs_{name}_snap', .665, -24 + 10 * sg, 4, L, R,
         dict(lean=(2, 2, 2), turn=(6 + 14 * sg, 5 + 12 * sg, 4 + 10 * sg), side=(6 * sg, 5 * sg, 3 * sg),
              neck=(-6, 5 + 28 * sg, 16 * sg), head=(-4, 4 + 20 * sg, 12 * sg)), _FXG_ARM,
         (.36, -.16, 1.00) if sg > 0 else (.02, -.32, 1.08), (-.02, -.30, 1.08) if sg > 0 else (-.36, -.10, 1.00),
         hat=(4, 12 * sg), pole=((.40, -.02, .92), (-.30, -.02, .92)) if sg > 0 else ((.30, -.02, .92), (-.40, -.02, .92)))
    _fxk(f'fx_fs_{name}_hold', .68, -24 + 5 * sg, 5, L, R,
         dict(lean=(4, 3, 2), turn=(6 + 5 * sg, 5 + 5 * sg, 4 + 4 * sg), side=(3 * sg, 2 * sg, 0),
              neck=(-8, 5 + 14 * sg, 8 * sg), head=(2, 4 + 10 * sg, 5 * sg)), _FXG_ARM, (.14, -.36, 1.15), (-.11, -.30, 1.18),
         hat=(2, 6 * sg), pole=_FXG_POLE)
    ANIMS[f'fx_{name}'] = _clip([f'fx_fs_{name}_snap', f'fx_fs_{name}_hold', 'fx_fs_guard_a'], [0, 1, 2], 12, ms=[50, 140, 150])


_fxf_hit_side('hit_l', 1)
_fxf_hit_side('hit_r', -1)

# ---- hit in the gut: folded over it (the pelvis tipped, the back rounded, the head down), both hands clutching the
# belly with the elbows out, the knees bent; held, deeper; straightening, the fists coming up; the guard
_FXGUT_L, _FXGUT_R = ('Spine', (.06, -.17, .92), 'fist'), ('Spine', (-.07, -.16, .88), 'fist')
_FXGUT_ARM = dict(l=(30, -40, -20, -110), r=(-30, -40, 20, -110), lsh=(-6, -10), rsh=(6, 10))
_FXGUT_POLE = ((.30, .0, .95), (-.30, .0, .92))
_fxk('fx_fs_hg_fold', .60, -18, 8, (.12, -.16, 0, 12), (-.15, .26, 6, -18),
     dict(lean=(2, 14, 16), turn=(6, 5, 4), neck=(14, 4, 0), head=(16, 4, 0)), _FXGUT_ARM, _FXGUT_L, _FXGUT_R, pole=_FXGUT_POLE)
_fxk('fx_fs_hg_hold', .59, -18, 10, (.12, -.16, 0, 12), (-.15, .26, 6, -18),
     dict(lean=(3, 15, 18), turn=(6, 5, 4), neck=(16, 4, 0), head=(18, 4, 0)), _FXGUT_ARM, _FXGUT_L, _FXGUT_R, pole=_FXGUT_POLE)
_fxk('fx_fs_hg_up', .66, -22, 8, (.13, -.22, 0, 12), (-.15, .23, 6, -18),
     dict(lean=(6, 4, 3), turn=(6, 5, 4), neck=(-6, 4, 0), head=(6, 4, 0)), _FXG_ARM, (.12, -.34, 1.08), (-.12, -.28, 1.12),
     pole=_FXG_POLE)
ANIMS['fx_hit_gut'] = _clip(['fx_fs_hg_fold', 'fx_fs_hg_hold', 'fx_fs_hg_up', 'fx_fs_guard_a'], [0, 1, 2, 3], 12, ms=[50, 260, 140, 100])

# ---- dazed: the stance narrow and square, the arms hanging, the hat askew, the upper body swaying side to side over the
# feet, the head lolling, the knees buckling; a stumble step forward with the right foot and back (loop)
_FXDZ_L, _FXDZ_R = (.12, -.12, 0, 6), (-.13, .12, 0, -10)
_FXDZ_ARM = dict(l=(36, 10, 0, -30), r=(-36, 10, 0, -30))
_FXDZ = [(.70, _FXDZ_R, (5, 4, 2), (4, 6, 8), (6, 4, 6), (.24, -.12, .86), (-.18, -.14, .84)),
       (.68, _FXDZ_R, (3, 2, 1), (10, 3, 4), (8, 2, 3), (.20, -.16, .80), (-.17, -.16, .80)),
       (.685, (-.20, -.04, 0, -14), (-2, -2, -1), (6, -3, -4), (6, -2, -3), (.19, -.15, .82), (-.21, -.13, .84)),
       (.695, (-.20, -.04, 0, -14), (-5, -4, -2), (4, -6, -8), (6, -4, -6), (.18, -.14, .84), (-.24, -.12, .86)),
       (.68, (-.16, .06, 10, -12, .04), (-3, -2, -1), (10, -3, -4), (8, -2, -3), (.17, -.16, .80), (-.20, -.16, .80)),
       (.69, _FXDZ_R, (1, 1, 0), (8, 3, 4), (8, 2, 3), (.20, -.15, .82), (-.18, -.15, .82))]
for _fxi, (_fxP, _fxr, _fxsd, _fxnk, _fxhd, _fxfl, _fxfr) in enumerate(_FXDZ):
    _fxk(f'fx_fs_dz_{_fxi}', _fxP, -10, 6, _FXDZ_L, _fxr, dict(lean=(6, 4, 2), side=_fxsd, neck=_fxnk, head=_fxhd), _FXDZ_ARM, _fxfl, _fxfr,
         hat=(6, 9))
ANIMS['fx_daze'] = _clip([f'fx_fs_dz_{i}' for i in range(6)], list(range(6)), 6, loop=True, ms=[180, 160, 150, 180, 160, 150],
                         marks={'loop': 0})

# ---- held by the collar: leaning back on his heels, his fists on the player's forearms before his chest (the player's
# fists on his collar, .52 m apart: TUNE.clinch.d), the elbows down and out, the head turned away; a struggle (loop)
_FXHELD_ARM = dict(l=(30, -50, 10, -90), r=(-30, -50, -10, -90))
_FXHELD_POLE = ((.30, -.02, .98), (-.30, -.02, .98))
_fxk('fx_fs_held_a', .71, -10, -10, (.12, -.16, -10, 6), (-.13, .18, 0, -10),
     dict(lean=(-8, -5, -3), turn=(4, 2, 2), neck=(8, 0, 0), head=(-4, 8, 0)), _FXHELD_ARM, (.12, -.26, 1.18), (-.12, -.25, 1.20),
     pole=_FXHELD_POLE)
_fxk('fx_fs_held_b', .705, -10, -11, (.12, -.16, -12, 6), (-.13, .18, 0, -10),
     dict(lean=(-10, -6, -3), turn=(2, 2, 2), neck=(10, -4, 0), head=(-2, -8, 0)), _FXHELD_ARM, (.13, -.22, 1.16), (-.11, -.23, 1.15),
     pole=_FXHELD_POLE)
ANIMS['fx_held'] = _clip(['fx_fs_held_a', 'fx_fs_held_b'], [0, 1], 4, loop=True, ms=[300, 300], marks={'loop': 0})

# ---- the taunt: standing taller, the chin up and the hat tipped back off the face, the left fist kept up; the right hand
# out ahead and beckoning back to his chest, twice; the chin back down, the guard
_FXTT_SP = dict(lean=(-4, -3, -2), turn=(6, 5, 4), neck=(-14, 5, 0), head=(-8, 4, 0))
_FXTT_ARM = dict(l=(30, -40, 16, -115), r=(-20, -60, -10, -40), lsh=(-12, -8), rsh=(6, 6))
_FXTT_CURL = dict(_FXTT_ARM, r=(-30, -40, -10, -130))
_FXTT_POLE = (_FXG_POLE[0], (-.34, -.14, 1.0))
_fxk('fx_fs_tt_out', .72, -24, 2, _FXG_L, _FXG_R, _FXTT_SP, _FXTT_ARM, (.08, -.42, 1.24), (-.20, -.56, 1.10), hat=(8, 0), pole=_FXTT_POLE)
_fxk('fx_fs_tt_curl', .72, -24, 2, _FXG_L, _FXG_R, _fxsp(_FXTT_SP, neck=(-16, 5, 0)), _FXTT_CURL, (.08, -.42, 1.24), (-.16, -.22, 1.40),
     hat=(8, 0), pole=_FXTT_POLE)
_fxk('fx_fs_tt_out2', .72, -24, 2, _FXG_L, _FXG_R, _FXTT_SP, _FXTT_ARM, (.08, -.42, 1.24), (-.20, -.54, 1.12), hat=(8, 0), pole=_FXTT_POLE)
_fxk('fx_fs_tt_curl2', .72, -24, 2, _FXG_L, _FXG_R, _fxsp(_FXTT_SP, neck=(-16, 5, 0)), _FXTT_CURL, (.08, -.42, 1.24), (-.16, -.21, 1.42),
     hat=(8, 0), pole=_FXTT_POLE)
_fxk('fx_fs_tt_back', .70, -24, 4, _FXG_L, _FXG_R, _fxsp(_FXG_SP, neck=(-10, 5, 0)), _FXG_ARM, (.08, -.43, 1.24), (-.14, -.33, 1.25),
     hat=(3, 0), pole=_FXG_POLE)
ANIMS['fx_taunt'] = _clip(['fx_fs_tt_out', 'fx_fs_tt_curl', 'fx_fs_tt_out2', 'fx_fs_tt_curl2', 'fx_fs_tt_back', 'fx_fs_guard_a'],
                          list(range(6)), 8, ms=[200, 130, 110, 130, 180, 160])


# ---- the gunmen's in-betweens keep the holstered revolver (the blend carried it on the moving hand)
_pose_fists_foes = pose


def pose(name):
    """The pose() above; a fists clip's frame gets its revolver put back in the holster (_bw_regun)."""
    zmin = _pose_fists_foes(name)
    clip, _, i = name.partition('.')
    if i and clip in FISTS_FOES:
        _bw_regun(name)
    return zmin


_build_fists_foes = build


def build():
    """The builds above, then the fists keys' elbow and hat hook (_fxf_after) after every other."""
    names = _build_fists_foes()
    if _fxf_after not in HOLD_HOOKS:
        HOLD_HOOKS.append(_fxf_after)
    return names

# ================================================================ the rope wall (the live hero only: docs/exp/ropeclimb.md) =====
# The controllable rope climb (sim/player/ropewall.js) and the ladder (sim/player/ladder.js), live. Keys posed in the wall's frame:
# he faces -Y with the face in front of him at his soles (Hips X- leans him back AND swings the legs forward by as much), the
# wrists on the rope (LIVE_AT, fitted with the props in tmp/ropeclimb/tools/ropeposes.py: the approved pose sheet, 2026-10-08).
# The view puts the soles on the face, turns him to it and plays a clip by the climb's technique and how far he moved
# (view/livehero.js ROPEWALL). Exported with --clips RW_LIVE (tools/blender/live_export.mjs --add).
#   rw_stand / rw_up     the wall-walk: the lean back; hand over hand, a boot up the face by turns (by distance climbed)
#   rw_side / rw_side_r  the side-step along the face (the tension traverse), toward his left / right
#   rw_bound             pushed off the face, legs straightening, back onto it; rw_run the running pendulum (a stride by turns)
#   rw_rest              sat back on the rope, the boots on a ledge; rw_top over the lip (then the climb's knee and stand)
#   rope_lock            the foot lock on a free rope: knees up, the boots pinching it; the stand-up of the inchworm
#   hand_line            up a slope on the rope, upright; ladder_up / ladder_slide the ladder (hands and boots on the rungs)
RW_LIVE = ('rw_stand', 'rw_up', 'rw_side', 'rw_side_r', 'rw_bound', 'rw_run', 'rw_rest', 'rope_lock', 'rw_top', 'hand_line', 'ladder_up',
           'ladder_slide')
POSES['rwk_stand'] = {'Hips': [('X', -40)], 'LeftUpLeg': [('X', -52), ('Y', -9)], 'LeftLeg': [('X', 18)], 'LeftFoot': [('X', -20)], 'RightUpLeg': [('X', -48), ('Y', 9)], 'RightLeg': [('X', 22)], 'RightFoot': [('X', -18)], 'Spine': [('X', 6)], 'Spine1': [('X', 4)], 'Neck': [('X', -10)], 'Head': [('X', -6)]}
LIVE_AT['rwk_stand'] = [('Left', None, (0.0, -0.162, 1.34)), ('Right', None, (-0.22, -0.12, 0.82))]
POSES['rwk_step'] = {'Hips': [('X', -36)], 'LeftUpLeg': [('X', -86), ('Y', -8)], 'LeftLeg': [('X', 64)], 'LeftFoot': [('X', -10)], 'RightUpLeg': [('X', -46), ('Y', 9)], 'RightLeg': [('X', 16)], 'RightFoot': [('X', -18)], 'Spine': [('X', 12)], 'Spine1': [('X', 6)], 'Neck': [('X', -18)], 'Head': [('X', -10)]}
LIVE_AT['rwk_step'] = [('Left', None, (0.0, -0.219, 1.373)), ('Right', None, (-0.22, -0.12, 0.82))]
POSES['rwk_side'] = {'Hips': [('X', -34), ('Y', 12)], 'LeftUpLeg': [('X', -58), ('Y', -22)], 'LeftLeg': [('X', 30)], 'LeftFoot': [('X', -16)], 'RightUpLeg': [('X', -50), ('Y', 2)], 'RightLeg': [('X', 22)], 'RightFoot': [('X', -16)], 'Spine': [('X', 10), ('Y', -6)], 'Spine1': [('X', 4)], 'Neck': [('X', -6), ('Z', 24)], 'Head': [('Z', 12)]}
LIVE_AT['rwk_side'] = [('Left', None, (-0.162, -0.214, 1.369)), ('Right', None, (-0.22, -0.12, 0.82))]
POSES['rwk_bound'] = {'Hips': [('X', -30)], 'LeftUpLeg': [('X', -50), ('Y', -8)], 'LeftLeg': [('X', 4)], 'LeftFoot': [('X', -26)], 'RightUpLeg': [('X', -44), ('Y', 8)], 'RightLeg': [('X', 4)], 'RightFoot': [('X', -24)], 'Spine': [('X', 4)], 'Neck': [('X', 14)], 'Head': [('X', 10)]}
LIVE_AT['rwk_bound'] = [('Left', None, (0.0, -0.291, 1.364)), ('Right', None, (-0.22, -0.12, 0.82))]
POSES['rwk_run'] = {'Hips': [('X', -32), ('Y', 30)], 'LeftUpLeg': [('X', -100), ('Y', -34)], 'LeftLeg': [('X', 96)], 'LeftFoot': [('X', -6)], 'RightUpLeg': [('X', -18), ('Y', 26)], 'RightLeg': [('X', 4)], 'RightFoot': [('X', -24)], 'Spine': [('X', 12), ('Y', -10)], 'Spine1': [('Y', -6)], 'Neck': [('Z', 34), ('X', -4)], 'Head': [('Z', 14)]}
LIVE_AT['rwk_run'] = [('Left', None, (-0.21, -0.2, 1.356)), ('Right', None, (-0.22, -0.12, 0.82))]
POSES['rwk_rest'] = {'Hips': [('X', -32)], 'LeftUpLeg': [('X', -78), ('Y', -12)], 'LeftLeg': [('X', 124)], 'LeftFoot': [('X', -24)], 'RightUpLeg': [('X', -70), ('Y', 10)], 'RightLeg': [('X', 118)], 'RightFoot': [('X', -20)], 'Spine': [('X', 18)], 'Spine1': [('X', 8)], 'Neck': [('X', -12), ('Z', -18)]}
LIVE_AT['rwk_rest'] = [('Left', None, (0.0, -0.243, 1.393)), ('Right', None, (-0.22, -0.12, 0.82))]
POSES['rwk_lock'] = {'LeftUpLeg': [('X', -58), ('Y', 4)], 'LeftLeg': [('X', 74)], 'LeftFoot': [('X', 12)], 'RightUpLeg': [('X', -50), ('Y', -4)], 'RightLeg': [('X', 70)], 'RightFoot': [('X', 14)], 'Spine': [('X', 6)], 'Neck': [('X', -16)], 'Head': [('X', -10)]}
LIVE_AT['rwk_lock'] = [('Left', None, (0.03, -0.237, 1.738)), ('Right', None, (-0.03, -0.237, 1.488))]
POSES['rwk_top'] = {'Hips': [('X', 34)], 'LeftUpLeg': [('X', -118)], 'LeftLeg': [('X', 110)], 'LeftFoot': [('X', -10)], 'RightUpLeg': [('X', 30)], 'RightLeg': [('X', 18)], 'RightFoot': [('X', 16)], 'Spine': [('X', 16)], 'Spine1': [('X', 8)], 'Neck': [('X', -30)], 'Head': [('X', -10)]}
LIVE_AT['rwk_top'] = [('Left', None, (0.2, -0.475, 0.806)), ('Right', None, (-0.22, -0.425, 0.806))]
POSES['rwk_line'] = {'LeftUpLeg': [('X', -58)], 'LeftLeg': [('X', 64)], 'LeftFoot': [('X', -24)], 'RightUpLeg': [('X', 10)], 'RightLeg': [('X', 26)], 'RightFoot': [('X', 6)], 'Spine': [('X', 18)], 'Spine1': [('X', 6)], 'Neck': [('X', -18)]}
LIVE_AT['rwk_line'] = [('Left', None, (-0.1, -0.552, 1.114)), ('Right', None, (-0.12, -0.332, 0.844))]
POSES['rwk_ladder'] = {'LeftUpLeg': [('X', -70)], 'LeftLeg': [('X', 96)], 'LeftFoot': [('X', -6)], 'RightUpLeg': [('X', -10)], 'RightLeg': [('X', 24)], 'RightFoot': [('X', 4)], 'Spine': [('X', 6)], 'Neck': [('X', -14)], 'Head': [('X', -6)]}
LIVE_AT['rwk_ladder'] = [('Left', None, (0.2, -0.413, 2.365)), ('Right', None, (-0.2, -0.413, 2.965))]
POSES['rwk_slide'] = {'LeftUpLeg': [('X', -30), ('Y', -14)], 'LeftLeg': [('X', 40)], 'LeftFoot': [('X', -10)], 'RightUpLeg': [('X', -24), ('Y', 14)], 'RightLeg': [('X', 34)], 'RightFoot': [('X', -8)], 'Spine': [('X', 10)], 'Neck': [('X', 14)], 'Head': [('X', 10)]}
LIVE_AT['rwk_slide'] = [('Left', None, (0.25, -0.361, 1.085)), ('Right', None, (-0.25, -0.361, 1.085))]
POSES['rwk_step_r'] = mirrored(POSES['rwk_step'])
LIVE_AT['rwk_step_r'] = [('Right', None, (-0.0, -0.219, 1.373)), ('Left', None, (0.22, -0.12, 0.82))]
POSES['rwk_side_r'] = mirrored(POSES['rwk_side'])
LIVE_AT['rwk_side_r'] = [('Right', None, (0.162, -0.214, 1.369)), ('Left', None, (0.22, -0.12, 0.82))]
POSES['rwk_run_r'] = mirrored(POSES['rwk_run'])
LIVE_AT['rwk_run_r'] = [('Right', None, (0.21, -0.2, 1.356)), ('Left', None, (0.22, -0.12, 0.82))]
POSES['rwk_line_r'] = {'Spine': [('X', 18)], 'Spine1': [('X', 6)], 'Neck': [('X', -18)], 'RightUpLeg': [('X', -58)], 'RightLeg': [('X', 64)], 'RightFoot': [('X', -24)], 'LeftUpLeg': [('X', 10)], 'LeftLeg': [('X', 26)], 'LeftFoot': [('X', 6)]}
LIVE_AT['rwk_line_r'] = [('Left', None, (-0.1, -0.552, 1.114)), ('Right', None, (-0.12, -0.332, 0.844))]
POSES['rwk_ladder_r'] = mirrored(POSES['rwk_ladder'])
LIVE_AT['rwk_ladder_r'] = [('Right', None, (-0.2, -0.413, 2.365)), ('Left', None, (0.2, -0.413, 2.965))]
POSES['rwk_lock_up'] = _merge(_mv_legs(-10, 12, 4, -8, 10, 6), {'Spine': [('X', 2)], 'Neck': [('X', -18)], 'Head': [('X', -10)]})
LIVE_AT['rwk_lock_up'] = [('Left', None, (0.03, -0.237, 2.038)), ('Right', None, (-0.03, -0.237, 1.788))]
ANIMS['rw_stand'] = _clip(['rwk_stand'], [0], 2, loop=True)
ANIMS['rw_up'] = _clip(['rwk_step', 'rwk_stand', 'rwk_step_r', 'rwk_stand'], [0, .5, 1, 1.5, 2, 2.5, 3, 3.5], 8, loop=True)
ANIMS['rw_side'] = _clip(['rwk_side', 'rwk_stand'], [0, .5, 1, 1.5], 6, loop=True)
ANIMS['rw_side_r'] = _clip(['rwk_side_r', 'rwk_stand'], [0, .5, 1, 1.5], 6, loop=True)
ANIMS['rw_bound'] = _clip(['rwk_stand', 'rwk_bound', 'rwk_stand'], [0, .5, 1, 1.5, 2], 8)
ANIMS['rw_run'] = _clip(['rwk_run', 'rwk_run_r'], [0, .5, 1, 1.5], 8, loop=True)
ANIMS['rw_rest'] = _clip(['rwk_rest'], [0], 2, loop=True)
ANIMS['rope_lock'] = _clip(['rwk_lock', 'rwk_lock_up'], [0, .5, 1, 1.5], 6, loop=True)
ANIMS['rw_top'] = _clip(['rwk_top', 'mv_cl_knee', 'mv_cl_stand'], [0, .5, 1, 1.5, 2], 10)
ANIMS['hand_line'] = _clip(['rwk_line', 'rwk_line_r'], [0, .5, 1, 1.5], 6, loop=True)
ANIMS['ladder_up'] = _clip(['rwk_ladder', 'rwk_ladder_r'], [0, .5, 1, 1.5], 6, loop=True)
ANIMS['ladder_slide'] = _clip(['rwk_slide'], [0], 2, loop=True)

_pose_rw = pose


def pose(name):
    """The pose() above; a rope wall clip's in-between gets its holstered revolver put back (the blend carried it on the hand)."""
    clip, _, i = name.partition('.')
    zmin = _pose_rw(name)
    if i and clip in RW_LIVE:
        _bw_regun(name)
    return zmin

# ================================================================ tools (the live hero only: docs/GATHERING.md) ===========
# A tool swung in both hands (sim/player/tool.js; features/woodcut.js). The tool itself is not in the model: the game draws it
# as a runtime mesh on the right fist (view/heldtool.js HOLDS.swing): its haft runs out of the grip (RopeHand0) along
# A = U cos(TL_CANT) + F sin(TL_CANT) (F the hand's way, U the thumb: _hand_frame), the head TL_HEAD m up it, the bit toward
# B = F cos - U sin. So each key here gives the right fist's point, the haft's way D and the bit's way B (his frame), turns the
# right hand so its A is D and its B is B (LS_HAND), and closes the left fist on the haft TL_LEFT m above the right (the left
# thumb up the haft, its knuckles to the bit). Right hand at the knob, left above: the swing comes from over his left
# shoulder, down and across to his right, into a trunk ahead of him at waist height (the sim stands him ~.7 m from its
# middle). Every frame is a key (the game plays them stepped): no in-between lets the hands slip off the haft.
#   tl_chop    ready (both hands on, the axe across him) -> wind (up over the left shoulder) -> swing -> hit (mark `hit`:
#              the head in the wood) -> pull (wrenched out) -> ready. ms timing; the game warps it onto TUNE.swing (hit .26 s
#              of .62 s: content/woodcut.js), so only the proportions matter
TL_LIVE = ('tl_chop',)
TL_CANT, TL_LEFT, TL_HEAD = 42.0, .30, .56   # (view/heldtool.js HOLDS.swing.cant; the left hand's place on the haft; the head's)


def _tl_key(name, trunk, feet, R, D, S, pole_r=(-1, .3, -1), pole_l=(1, .3, -1), arms=None):
    """A two-handed tool key: `trunk` (_ls_trunk's), `feet` (LS_FEET's), the right fist at R (his frame, m at 1.8 over the
    ground), the haft along D, the bit turned to the way S the head moves (made square to D); the elbows toward the poles."""
    D = Vector(D).normalized()
    B = Vector(S) - D * Vector(S).dot(D)
    B = B.normalized() if B.length > 1e-6 else Vector((0, -1, 0))
    c, s = math.cos(math.radians(TL_CANT)), math.sin(math.radians(TL_CANT))
    F, U = D * s + B * c, D * c - B * s                         # (the right hand's own axes that put A on D, B on B)
    POSES[name] = _merge(_ls_legs(-8, -4, 22, 20), trunk, arms or {
        'RightShoulder': [('Z', -8)], 'RightArm': [('Y', -30), ('X', -60)], 'RightForeArm': [('X', -40)],
        'LeftShoulder': [('Z', -8)], 'LeftArm': [('Y', 30), ('X', -60)], 'LeftForeArm': [('X', -40)]})
    LS_FEET[name] = feet
    L = Vector(R) + D * TL_LEFT
    LS_AT[name] = [('Right', None, tuple(R), 'fist', pole_r), ('Left', None, tuple(L), 'fist', pole_l)]
    LS_HAND[name] = {'Right': (tuple(F), tuple(U.cross(F))), 'Left': (tuple(B), tuple(B.cross(D)))}


_TL_STANCE = lambda drop=.05, heel=0: {'L': (.17, -.1, 12, 0), 'R': (-.17, .13, -20, heel), 'drop': drop}
_tl_key('tl_ch_ready', _ls_trunk(turn=-4, tilt=4, spine=4, s1=2, neck=(8, 2, 0), head=(4, 0, 0)), _TL_STANCE(.05),
        (-.1, -.24, .95), (.35, -.45, .82), (0, -1, 0))
_tl_key('tl_ch_wind', _ls_trunk(turn=22, tilt=-2, spine=-4, s1=-2, cturn=(8, 6, 4), neck=(4, -20, 0), head=(2, -8, 0)),
        _TL_STANCE(.04, 14), (.17, -.02, 1.42), (.35, .7, .62), (-.3, -.6, -.6), pole_r=(-.4, .2, -.4), pole_l=(1, .6, -.2))
_tl_key('tl_ch_swing', _ls_trunk(turn=4, tilt=7, spine=8, s1=2, cturn=(1, 1, 0), neck=(8, -4, 0), head=(4, -2, 0)),
        _TL_STANCE(.09, 14), (.03, -.32, 1.18), (.18, -.66, .73), (-.4, -.6, -.7))
_tl_key('tl_ch_hit', _ls_trunk(turn=-16, tilt=10, spine=12, s1=4, cturn=(-6, -4, -2), neck=(12, 12, 0), head=(6, 4, 0)),
        _TL_STANCE(.12, 22), (-.12, -.18, 1.0), (.2, -.75, -.05), (-1, -.2, -.3))
_tl_key('tl_ch_pull', _ls_trunk(turn=-10, tilt=6, spine=8, s1=2, cturn=(-3, -2, 0), neck=(10, 8, 0), head=(4, 2, 0)),
        _TL_STANCE(.08, 10), (-.14, -.12, .98), (.3, -.72, .22), (.2, -.6, -.6))
ANIMS['tl_chop'] = _clip(['tl_ch_ready', 'tl_ch_wind', 'tl_ch_swing', 'tl_ch_hit', 'tl_ch_pull', 'tl_ch_ready'], [0, 1, 2, 3, 4, 5], 12,
                         ms=[60, 130, 50, 110, 120, 150], marks={'hit': 3})
