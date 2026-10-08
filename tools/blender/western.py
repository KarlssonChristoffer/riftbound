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
@garment('duster', 'cloak', ['human_small'], soft=['Duster'], hides=['ShirtSleeveUp', 'ShirtSleeveLo'],
         pixel={'Duster': ['duster', 'oilskin', {'bias': -.06}], 'DusterCape': ['cape', 'oilskin', {'bias': .04}],
                'DusterCollar': ['collar', 'oilskin', {}],
                'DusterSleeveUp': ['dsleeve', 'oilskin', {}], 'DusterSleeveLo': ['dsleeve', 'oilskin', {}]})
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
    # shoulder cape: a short open sheet round the shoulders, its edges reaching the front of the chest
    n = z('neck')
    cape = [(Vector((0, .1 * s, n - .005 * s)), (.17 * s, .17 * s), (.2 * s, .2 * s)),
            (Vector((0, .16 * s, n - .08 * s)), (.29 * s, .29 * s), (.33 * s, .33 * s)),
            (Vector((0, .2 * s, n - .2 * s)), (.34 * s, .34 * s), (.4 * s, .4 * s))]
    _sheet('DusterCape', 'Spine2', cape, .014 * s)
    loft('DusterCollar', 'Spine2', [(0, .03 * s, n - .03 * s), (0, .04 * s, n + .06 * s)],
         [(.17 * s, .15 * s), (.15 * s, .14 * s)], p=2.4)     # turned up round the back of the neck
    for sd in 'LR':
        _sleeve('DusterSleeve', sd, J, s, .032 * s, upper=(0, 1), lower=(0, .98), cuff=.012 * s)


# ---------------------------------------------------------------- poncho + bandolier (outlaw) ---------------------------
PONCHO = []   # the poncho's profile (z, yc, rx, ry), for the bandolier lying on it
PONCHO_P = 3.0   # its section's superellipse power (flat front and back)


@garment('serape_poncho', 'cloak', ['human_small'],
         pixel={'Poncho': ['poncho', 'serape', {}], 'PonchoStripe': ['stripe', 'linen', {}],
                'PonchoBand': ['band', 'vest', {}], 'PonchoGreen': ['band', 'green', {}]})
def _serape_poncho():
    """A wool poncho hanging from the shoulders to the hips: wide across (the upper arms under it, the forearms out at
    its sides) but flat front and back (cloth hangs close to the body; a deep section reads as a barrel), the hem
    dipping at the front and back centres. Serape stripes: cream across the chest; dark, green and cream near the hem
    (each >= 1 px tall at the 20 deg camera)."""
    P, s, J, z = _ctx()
    n = z('neck')
    rows = [(n + .005 * s, .005 * s, .095 * s, .09 * s), (n - .035 * s, 0, .2 * s, .15 * s), (n - .075 * s, 0, .3 * s, .168 * s),
            (n - .2 * s, 0, .33 * s, .172 * s), (n - .32 * s, 0, .34 * s, .175 * s), (n - .4 * s, 0, .345 * s, .178 * s)]
    PONCHO[:] = rows
    def dip(ob):   # the hem's front and back centres hang lower
        for v in ob.data.vertices:
            if v.co.z < n - .1 * s:
                v.co.z -= .06 * s * max(0.0, 1 - abs(v.co.x) / (.3 * s)) ** 1.5
    ob = loft('Poncho', 'Spine2', [(0, yc, zz) for zz, yc, rx, ry in rows], [(rx, ry) for zz, yc, rx, ry in rows], n=12, p=PONCHO_P)
    dip(ob)
    for name, zz, h in (('PonchoStripe', n - .13 * s, .035 * s), ('PonchoBand', n - .3 * s, .03 * s),
                        ('PonchoGreen', n - .338 * s, .03 * s), ('PonchoStripe', n - .372 * s, .03 * s)):
        yc, rx, ry = _ring_at(rows, zz)
        ob = loft(name, 'Spine2', [(0, yc, zz + h / 2), (0, yc, zz - h / 2)], [(rx + .006 * s, ry + .006 * s)] * 2, n=12, p=PONCHO_P)
        if zz < n - .1 * s:
            dip(ob)


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
    loft('Holster', 'RightUpLeg', [g + Uh * .03 * s - Fh * .005 * s, g + Uh * .035 * s + Fh * .07 * s, g + Uh * .04 * s + Fh * .25 * s],
         [(.026 * s, .04 * s), (.024 * s, .03 * s), (.018 * s, .02 * s)], side=Fh.cross(Uh), n=6, p=2.2)
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
    hold = add_chain('GunHold', 'RightHand', [g, g + F * .05 * s])[0]
    loft('GunGrip', hold, [g + U * .015 * s - F * .012 * s, g - U * .045 * s - F * .028 * s, g - U * .085 * s - F * .042 * s],
         [(.013 * s, .018 * s), (.014 * s, .019 * s), (.014 * s, .017 * s)], side=S, n=6, p=2.2)
    loft('GunFrame', hold, [g + U * .028 * s - F * .045 * s, g + U * .03 * s - F * .01 * s, g + U * .028 * s + F * .055 * s],
         [(.011 * frame * s, .016 * frame * s), (.012 * frame * s, .02 * frame * s), (.01 * frame * s, .014 * frame * s)],
         side=S, n=6, p=2.2)
    loft('GunGuard', hold, [g + U * .004 * s + F * .002 * s, g - U * .022 * s + F * .012 * s, g - U * .016 * s + F * .038 * s],
         [(.006 * s, .007 * s)] * 3, side=S, n=4, p=2.0)
    loft('GunCylinder', hold, [g + U * .032 * s, g + U * .032 * s + F * cyl * s], [(.02 * s, .02 * s)] * 2, side=S, n=6, p=2.0)
    b0, mz = g + U * .04 * s + F * (cyl - .003) * s, g + U * .04 * s + F * (cyl + barrel) * s
    loft('GunBarrel', hold, [b0, mz], [(bore * s, bore * s)] * 2, side=S, n=bore_n, p=2.0)
    loft('GunRod', hold, [b0 - U * .018 * s, b0 - U * .018 * s + F * barrel * rod * s], [(.006 * s, .006 * s)] * 2, side=S, n=4, p=2.0)
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
            hammer = fist + U * .05 - F * .03
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
REACH['gun_blow'] = [_head_point('Right', -.02, -.27, -.36)]     # the muzzle just in front of the lips
REACH['gun_blow_b'] = [_head_point('Right', -.02, -.26, -.38)]
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


@garment('bandit_mask', 'neck', ['human_small'],
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
