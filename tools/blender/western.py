# Western wardrobe: garments for the gunslinger and the Mexican outlaw, the revolver and its poses, on the standard
# skeleton (skeleton.py) and the wardrobe rules (wardrobe.py): parts split at the joints, each bound 100% to one named
# bone; garment-owned bone chains for held and slung things. Loaded by a loadout AFTER wardrobe.py, from the repo root:
#   exec(open(r'D:\Game\tools\blender\wardrobe.py').read()); exec(open('tools/blender/western.py').read())
# Adds two slots to wardrobe.SLOTS' list: 'hat' (over the hair, which keeps its cap, locks and nape tufts) and 'belt'
# (the gun belt + holster). The revolver is a 'hands' item in the RIGHT hand; outside gun poses it sits in the holster
# on the right thigh (_gun_hold), the way the bow is slung for climbing (_bow_stow).
# A loadout may set SPUR_SIZE (1 = a working cowboy's spur, the outlaw's are ~1.8) before build().
import os

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
    loft('HatCrown', 'Head', [(0, yc * s, c + f * hh) for f, yc, rx, ry in crown], [(rx * s, ry * s) for f, yc, rx, ry in crown], p=2.3)
    if crease:   # the top dips along the front-back centre line
        ob = bpy.data.objects['HatCrown']
        top = c + (crown[-3][0] + .04) * hh
        for v in ob.data.vertices:
            if v.co.z > top:
                v.co.z -= crease * s * max(0.0, 1 - abs(v.co.x) / (.12 * s))
    r0 = crown[1]
    loft('HatBand', 'Head', [(0, .012 * s, zb + .005 * s), (0, .012 * s, zb + .035 * s)],
         [((r0[2] + .007) * s, (r0[3] + .007) * s)] * 2, p=2.3)
    _brim('HatBrim', 'Head', (0, .012 * s, zb), ((r0[2] - .03) * s, (r0[3] - .03) * s), (brim_out[0] * s, brim_out[1] * s),
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
    In the hand (gun poses): level the gun along the forearm with its top up (a wrist does this without thinking; at
    1-2 px the fist's own angle doesn't show), spun about the trigger finger (twirl, muzzle up to blow), then the left
    hand onto the gun (LEFT_TO_GUN). Otherwise: in the holster, following the right thigh."""
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
ANIMS['gun_draw'] = dict(keys=['gdraw_grab', 'gun_draw_lift', 'gun_draw_hip', 'gun_aim'], frames=4, loop=False, fps=16)
# a shot: the muzzle kicks up and the shoulder rocks back, then settles
POSES['gun_recoil_a'] = _gpose(_BLADE, _arm(x=-80, fx=-17, sz=-10), {'Spine2': [('X', -7)], 'Head': [('Z', -10), ('X', -4)]})
POSES['gun_recoil_b'] = _gpose(_BLADE, _arm(x=-76, fx=-9, sz=-8), {'Spine2': [('X', -4)]})
ANIMS['gun_fire'] = dict(keys=['gun_recoil_a', 'gun_recoil_b', 'gun_aim'], frames=3, loop=False, fps=20)
# fanning the hammer: the gun at the hip, the left palm sweeping back over the hammer for every shot
POSES['gun_fan_a'] = _gpose(-6, _arm(x=-12, fx=-88, sz=-2, z=14), _larm(x=-50, z=-34, fx=-70, hx=20), legs=_GCROUCH, lean=8)
POSES['gun_fan_b'] = _gpose(-6, _arm(x=-12, fx=-78, sz=-2, z=14), _larm(x=-40, z=-40, fx=-40), legs=_GCROUCH, lean=8)
LEFT_TO_GUN.update({'gun_fan_a': (-.02, .1, .02), 'gun_fan_b': (.08, .02, .05)})   # palm up over the hammer / swept past it
ANIMS['gun_fan'] = dict(keys=['gun_fan_a', 'gun_fan_b'], frames=2, loop=True, fps=14)
# reload: the muzzle tipped up to drop the cases, then down to thumb in rounds one by one (the left hand fetching each
# from the belt), back to the hip
POSES['gun_rl_up'] = _gpose(10, _arm(x=-28, fx=-118, sz=2, z=14), _larm(x=-46, z=-30, fx=-80), legs=_RL_LEGS, lean=4)
POSES['gun_rl_eject'] = _gpose(10, _arm(x=-30, fx=-134, sz=2, z=14), _larm(x=-50, z=-28, fx=-96), legs=_RL_LEGS, lean=4)
POSES['gun_rl_load'] = _gpose(10, _arm(x=-26, fx=-42, sz=2, z=18), _larm(x=-40, z=-40, fx=-62), legs=_RL_LEGS, lean=10)
POSES['gun_rl_fetch'] = _gpose(10, _arm(x=-26, fx=-42, sz=2, z=18),
                               {'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 38), ('X', -8)], 'LeftForeArm': [('X', -42)]},
                               legs=_RL_LEGS, lean=10)
LEFT_TO_GUN.update({'gun_rl_up': (.02, -.01, .07), 'gun_rl_eject': (.06, -.02, .06), 'gun_rl_load': (.0, .01, .07)})
ANIMS['gun_reload'] = dict(keys=['gun_rl_up', 'gun_rl_eject', 'gun_rl_load', 'gun_rl_fetch', 'gun_rl_load', 'gun_draw_hip'],
                           frames=6, loop=False, fps=6)
# twirl: the gun spun backward round the trigger finger at the hip, then dropped into the holster
for _i in range(4):
    POSES[f'gun_spin_{_i}'] = _gpose(4, _arm(x=-6, fx=-74, sz=0))
    GUN_SPIN[f'gun_spin_{_i}'] = 90 * _i
POSES['gholster'] = _gpose(0, _arm(y=-46, x=30, fx=-50, sz=4), {'RightHand': [('X', -10)]}, lean=2)
REACH['gholster'] = [_over_grip(0, .01, .07)]
ANIMS['gun_twirl'] = dict(keys=[f'gun_spin_{i}' for i in range(4)], frames=4, loop=True, fps=16)
ANIMS['gun_holster'] = dict(keys=[f'gun_spin_{i}' for i in range(4)] + ['gholster'], frames=5, loop=False, fps=16)


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
ANIMS['gun_hipfire'] = dict(keys=['gun_hip_kick', 'gun_hip_mid', 'gun_hip_lean'], frames=3, loop=False, fps=18)
# blowing the smoke off the barrel: the gun comes up muzzle-high in front of the face, a blow, back down to the hip
POSES['gun_blow_up'] = _gpose(10, _arm(x=-40, fx=-100, sz=0, z=24), legs=_RL_LEGS)
POSES['gun_blow'] = _gpose(10, _arm(x=-30, fx=-120, sz=0, z=30), {'Neck': [('Z', -6), ('X', 8)], 'Head': [('Z', -4), ('X', 6)]},
                           legs=_RL_LEGS)
POSES['gun_blow_b'] = _gpose(10, _arm(x=-30, fx=-120, sz=0, z=30), {'Neck': [('Z', -6), ('X', 10)], 'Head': [('Z', -4), ('X', 10)]},
                             legs=_RL_LEGS)
GUN_SPIN.update({'gun_blow_up': 35, 'gun_blow': 65, 'gun_blow_b': 65})
REACH['gun_blow'] = [_head_point('Right', -.02, -.27, -.36)]     # the muzzle just in front of the lips
REACH['gun_blow_b'] = [_head_point('Right', -.02, -.26, -.38)]
ANIMS['gun_blow'] = dict(keys=['gun_blow_up', 'gun_blow', 'gun_blow_b', 'gun_blow', 'gun_draw_hip'], frames=5, loop=False, fps=6)
# showdown: wide crouched stance, the gun hand hovering over the holstered grip, twitching; the left hand out
_DUEL = {'Spine': [('X', 8)], 'Neck': [('X', -8)], 'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 24), ('X', 6)],
         'LeftForeArm': [('X', -16)]}
POSES['duel_a'] = _gpose(14, _arm(y=-40, x=16, fx=-40, sz=4), _DUEL, legs=_GWIDE)
POSES['duel_b'] = _gpose(14, _arm(y=-40, x=16, fx=-40, sz=4), _DUEL, legs=_GWIDE)
POSES['duel_c'] = _gpose(14, _arm(y=-40, x=16, fx=-40, sz=4), _DUEL, legs=_GWIDE)
REACH.update({'duel_a': [_over_grip(-.02, .0, .17)], 'duel_b': [_over_grip(-.01, .02, .13)], 'duel_c': [_over_grip(-.03, -.01, .18)]})
ANIMS['duel_ready'] = dict(keys=['duel_a', 'duel_b', 'duel_a', 'duel_c'], frames=4, loop=True, fps=5)
# hat tip: the left hand up to the front of the brim, a small nod (the hat tips with the head). Built on the ready idle,
# whose right arm is explicit: expand() would otherwise mirror the raised left arm onto the right
POSES['hat_tip_0'] = {**POSES['idle_in'], 'LeftArm': [('Y', 20), ('X', -40)], 'LeftForeArm': [('X', -70)]}
POSES['hat_tip_1'] = {**POSES['idle_in'], 'LeftArm': [('Y', 10), ('X', -55)], 'LeftForeArm': [('X', -110)]}
POSES['hat_tip_2'] = {**POSES['hat_tip_1'], 'Neck': [('X', 14)], 'Head': [('X', 8)]}
REACH.update({'hat_tip_1': [_head_point('Left', .06, -.27, .6)], 'hat_tip_2': [_head_point('Left', .06, -.27, .6)]})
ANIMS['hat_tip'] = dict(keys=['hat_tip_0', 'hat_tip_1', 'hat_tip_2', 'hat_tip_1', 'hat_tip_0'], frames=5, loop=False, fps=6)
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
    # up so the spent shells slide out, fetch a shell from the belt / thumb it in (twice), snap the barrels up shut.
    RL = -20
    look = {'Neck': [('Z', -.6 * RL), ('X', 12)], 'Head': [('Z', -.4 * RL), ('X', 8)]}
    fetch_arm = {'LeftShoulder': [('Z', -2)], 'LeftArm': [('Y', 30), ('X', -14), ('Z', -10)], 'LeftForeArm': [('X', -60)]}
    POSES['gun_rl_up'] = _gpose(RL, HIP, look, legs=LEGS, lean=6)
    POSES['gun_rl_eject'] = _gpose(RL, HIP, look, {'RightForeArm': [('X', -96)]}, legs=LEGS, lean=4)
    POSES['gun_rl_fetch'] = _gpose(RL, HIP, look, fetch_arm, legs=LEGS, lean=8)
    POSES['gun_rl_load'] = _gpose(RL, HIP, look, legs=LEGS, lean=8)
    POSES['gun_rl_shut'] = _gpose(RL, HIP, legs=LEGS, lean=2)
    LG_HOLD.update({'gun_rl_up': _lg_frame('hip', RL, -12) + (True,), 'gun_rl_eject': _lg_frame('hip', RL, 60) + (True,),
                    'gun_rl_fetch': _lg_frame('hip', RL, -6) + (True,), 'gun_rl_load': _lg_frame('hip', RL, -6) + (True,),
                    'gun_rl_shut': _lg_frame('hip', RL, 6) + (True,)})
    LG_BREAK.clear(); LG_LEFT.clear(); LG_SHELL.clear()
    LG_BREAK.update({'gun_rl_up': 38, 'gun_rl_eject': 44, 'gun_rl_fetch': 40, 'gun_rl_load': 40})
    LG_LEFT.update({'gun_rl_fetch': 'belt', 'gun_rl_load': 'breech'})
    LG_SHELL.update({'gun_rl_fetch', 'gun_rl_load'})
    ANIMS['gun_reload'] = dict(keys=['gun_rl_up', 'gun_rl_eject', 'gun_rl_fetch', 'gun_rl_load', 'gun_rl_fetch',
                                     'gun_rl_load', 'gun_rl_shut'], frames=7, loop=False, fps=6)
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


_build_wardrobe = build


def build():
    """wardrobe.build (body + dress), then the gun's hold hook for every pose: the revolver's (holster or hand) or the
    coach gun's (on the chest, both hands)."""
    names = _build_wardrobe()
    if any(g in LOADOUT for g in GUN_ITEMS) and _gun_hold not in HOLD_HOOKS:
        HOLD_HOOKS.append(_gun_hold)
    if 'coach_gun' in LOADOUT and _long_gun_hold not in HOLD_HOOKS:
        HOLD_HOOKS.append(_long_gun_hold)
    return names
