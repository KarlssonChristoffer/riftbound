# 3D PROP KIT for the arena: environment props built as low-poly, flat-shaded meshes and rendered through the same
# data passes as the Ranger (pixel_rig.py: exact ID / camera-space normal / depth, EEVEE 1 sample, no filter, 4x
# supersampling), with the SAME camera (ortho, pitch 20 deg, looking north) and the SAME scale (upp 0.03279 m/px =
# 30.5 px/m). concepts/sprites/props_pixelize.py then paints them per biome and packs the atlases.
#
# Every plank, stave, hoop and drum is its own object, so the pixelizer gets real seams between them (the painted
# props fake these). Front = -Y (toward the camera), origin = the prop's ground point, Z up, metres.
#
# Headless:  D:\Blender\blender.exe -b --factory-startup --python tools/blender/props3d.py -- \
#              [--only crate,barrel] [--out concepts/sprites/out/props3d]
# Writes out/<group>/<state>/{id,nrm,dep}.png + meta.json, and out/<group>/group.json (canvas + pivot shared by
# every state of the group, so animation frames line up).
import bpy, bmesh, math, json, os, sys, random
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
_rig = {'__name__': 'props3d_rig'}
exec(open(os.path.join(HERE, 'pixel_rig.py'), encoding='utf-8').read(), _rig)
pass_materials, render_setup, camera, world_verts = _rig['pass_materials'], _rig['render_setup'], _rig['camera'], _rig['world_verts']

UPP, PITCH, SS, PAD = 0.0327883818891779, 20, 4, 3
COL = 'Props'
# PROJECTION. 'world' (default) = the arena's own oblique projection: ground depth x sin 55 (PPMY / PPM), heights
# x cos 20 (PPMH / PPM), so a prop's footprint sits exactly on the ground grid and its top shows like the flagstones.
# Done as a shear of the geometry seen by a level camera. 'sprite' = the character's true 20 deg camera.
# Either way the NORMAL pass holds the TRUE normals in the 20 deg camera frame (per-face attribute written before the
# shear), which is what the game's lighting expects (it lights the character in that frame).
PROJ = os.environ.get('PROPS3D_PROJ', 'world')
GROUND_K = math.sin(math.radians(55))

# object base name -> (family, options) for the pixelizer. Families resolve per biome in props_pixelize.py.
# bias shifts the light term; fixed = a set tone; seam False = no seam lines against neighbours of the same family
PARTS = {
    'Plank': ('wood', {}), 'Beam': ('wood', {'bias': .08}), 'Board': ('wood', {'bias': -.05}),
    'Stave': ('wood', {}), 'Lid': ('wood', {'bias': .05}),
    'Iron': ('metal', {'bias': .05}), 'Rivet': ('metal', {'bias': .2, 'thin': True}),
    'Clay': ('clay', {}), 'Band': ('clay', {'bias': -.22}), 'Rim': ('clay', {'bias': .1}),
    'Stone': ('stone', {}), 'Drum': ('stone', {}), 'Cap': ('stone', {'bias': -.06}),
    'Rock': ('rock', {}), 'Pebble': ('rock', {'bias': -.05}),
    'Paint': ('red', {}), 'Hazard': ('haz', {}), 'HazDark': ('haz', {'fixed': 3}),
    'Gold': ('gold', {'bias': .1}), 'Coin': ('gold', {'bias': .15}),
    'Hole': ('void', {'fixed': 2, 'seam': False}), 'Fuse': ('rope', {'thin': True}),
    'Block': ('stone', {}), 'Coping': ('stone', {'bias': -.1}), 'Merlon': ('stone', {'bias': .03}),
    # biome glow: 'rune' = emissive in the rift, 'crack' = emissive in the ember wastes; carved stone elsewhere
    'Rune': ('rune', {'seam': False}), 'Crack': ('crack', {'seam': False, 'thin': True}),
}
# group -> pixelizer options (tile: segments that join edge to edge along x / y get no outline on those sides)
GROUP_OPTS = {'wall_ew': {'tile': 'x'}, 'wall_low': {'tile': 'x'}, 'wall_ns': {'tile': 'y'}}


# ------------------------------------------------------------------ mesh helpers
def _obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for f in me.polygons:
        f.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.data.collections[COL].objects.link(ob)
    return ob


def box(name, c, s, bevel=0.0, rot=(0, 0, 0), jitter=0.0, seed=0):
    """Box centred at c with size s (metres), optional chamfer (flat bevel: catches a highlight like a real edge)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES', clamp_overlap=True)
    if jitter:
        r = random.Random(seed)
        for v in bm.verts:
            v.co += Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1))) * jitter
    M = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return _obj(name, bm)


def lathe(name, prof, n=12, a0=0.0, a1=None, caps=(True, True), M=None, phase=0.5):
    """Revolve [(r, z), ...] around Z. a0..a1 = an angular slice (radians) for staves; phase offsets the facets."""
    full = a1 is None
    a1 = a0 + 2 * math.pi if full else a1
    cols = n if full else n + 1
    bm = bmesh.new()
    rings = []
    for r, z in prof:
        rings.append([bm.verts.new((r * math.cos(a0 + (a1 - a0) * (i + (phase if full else 0)) / n),
                                    r * math.sin(a0 + (a1 - a0) * (i + (phase if full else 0)) / n), z)) for i in range(cols)])
    for A, B in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % cols
            if A[i] is not A[j]:
                bm.faces.new((A[i], A[j], B[j], B[i]))
    if full:
        if caps[0] and prof[0][0] > 1e-4:
            bm.faces.new(list(reversed(rings[0])))
        if caps[1] and prof[-1][0] > 1e-4:
            bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return _obj(name, bm)


def stave_shell(name, prof, a0, a1, depth, n=2, M=None):
    """A thick stave: outer lathe slice + inner offset, closed, so its ends and edges catch light."""
    bm = bmesh.new()
    def ring(off):
        return [[bm.verts.new(((r - off) * math.cos(a0 + (a1 - a0) * i / n), (r - off) * math.sin(a0 + (a1 - a0) * i / n), z))
                 for i in range(n + 1)] for r, z in prof]
    O, I = ring(0), ring(depth)
    for A, B in zip(O, O[1:]):
        for i in range(n):
            bm.faces.new((A[i], A[i + 1], B[i + 1], B[i]))
    for A, B in zip(I, I[1:]):
        for i in range(n):
            bm.faces.new((B[i], B[i + 1], A[i + 1], A[i]))
    for k in range(len(prof) - 1):   # side walls
        bm.faces.new((O[k][0], O[k + 1][0], I[k + 1][0], I[k][0]))
        bm.faces.new((I[k][n], I[k + 1][n], O[k + 1][n], O[k][n]))
    for i in range(n):              # ends
        bm.faces.new((O[0][i + 1], O[0][i], I[0][i], I[0][i + 1]))
        bm.faces.new((O[-1][i], O[-1][i + 1], I[-1][i + 1], I[-1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if M is not None:
        bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return _obj(name, bm)


def lump(name, c, s, seed, sub=1, flat=0.0, rot=(0, 0, 0)):
    """A faceted boulder: an icosphere, jittered, scaled; flat > 0 cuts the bottom off at z = c.z - s.z * (1 - flat)."""
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1)
    for v in bm.verts:
        v.co *= 1 + r.uniform(-.18, .18)
    bmesh.ops.transform(bm, matrix=Euler((r.uniform(0, 6), r.uniform(0, 6), r.uniform(0, 6))).to_matrix().to_4x4(), verts=bm.verts)
    for v in bm.verts:
        v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
        if flat and v.co.z < -s[2] * (1 - flat):
            v.co.z = -s[2] * (1 - flat)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4(), verts=bm.verts)
    return _obj(name, bm)


def ground_all(obs):
    """Drop a group so its lowest vertex touches z = 0."""
    bpy.context.view_layer.update()
    lo = min(w.z for ob in obs for w in world_verts(ob))
    for ob in obs:
        ob.location.z -= lo


def xform(obs, M):
    for ob in obs:
        ob.matrix_world = M @ ob.matrix_world


# ------------------------------------------------------------------ the props
def crate(dmg=0, s=.72):
    """Frame of chamfered beams, plank panels set in, a diagonal brace on the front and the east side."""
    h, b, t = s / 2, .085, .03   # half size, beam section, plank thickness
    obs = []
    for sx in (-1, 1):   # 12 frame beams
        for sy in (-1, 1):
            obs.append(box('Beam', (sx * (h - b / 2), sy * (h - b / 2), h), (b, b, s), .012))
            obs.append(box('Beam', (0, sy * (h - b / 2), h + sx * (h - b / 2)), (s - 2 * b + .002, b, b), .012))
            obs.append(box('Beam', (sx * (h - b / 2), 0, h + sy * (h - b / 2)), (b, s - 2 * b + .002, b), .012))
    inner, n = s - 2 * b, 4
    pw = inner / n
    miss = {1, 2} if dmg else set()
    for i in range(n):   # side panels: horizontal planks, set in by 1.5 cm
        z = b + pw * (i + .5)
        for face, (c, sz) in {'S': ((0, -h + t / 2 + .015, z), (inner, t, pw - .004)), 'N': ((0, h - t / 2 - .015, z), (inner, t, pw - .004)),
                              'E': ((h - t / 2 - .015, 0, z), (t, inner, pw - .004)), 'W': ((-h + t / 2 + .015, 0, z), (t, inner, pw - .004))}.items():
            if face == 'S' and i in miss:
                for side in (-1, 1):   # broken plank: splintered stubs left at each end
                    L = inner * (.18 + .1 * (side > 0))
                    obs.append(box('Plank', (side * (inner / 2 - L / 2), c[1], z), (L, t, pw - .004), jitter=.006, seed=i * 7 + side))
                continue
            obs.append(box('Plank', c, sz))
        x = -inner / 2 + pw * (i + .5)   # top: planks running north-south
        obs.append(box('Board', (x, 0, s - t / 2 - .012), (pw - .004, inner, t)))
    L = math.hypot(inner, inner)   # braces
    if not dmg:
        obs.append(box('Beam', (0, -h + .012, h), (L - .05, .03, .075), .01, rot=(0, math.atan2(inner, inner), 0)))
    obs.append(box('Beam', (h - .012, 0, h), (.03, L - .05, .075), .01, rot=(-math.atan2(inner, inner), 0, 0)))
    for sx in (-1, 1):   # iron corner caps on the top corners
        for sy in (-1, 1):
            obs.append(box('Iron', (sx * (h - .045), sy * (h - .045), s - .03), (.1, .1, .07), .008))
    if dmg:
        obs.append(box('Hole', (0, 0, s / 2), (inner - .02, inner - .02, inner - .04)))
    return obs


def crate_broken(s=.72):
    """What is left: the bottom frame and planks strewn around it."""
    r = random.Random(4)
    h, b = s / 2, .085
    obs = []
    for sy in (-1, 1):
        obs.append(box('Beam', (0, sy * (h - b / 2), b / 2), (s, b, b), .012, rot=(0, 0, r.uniform(-.1, .1))))
    obs.append(box('Beam', (-(h - b / 2), 0, b / 2 + b), (b, s, b), .012, rot=(r.uniform(-.2, .2), 0, .15)))
    for k in range(7):
        a, d = r.uniform(0, 6.28), r.uniform(.1, .45)
        obs.append(box('Plank', (math.cos(a) * d, math.sin(a) * d * .8, .02 + k * .012), (r.uniform(.3, .55), .15, .03),
                       rot=(r.uniform(-.25, .25), r.uniform(-.25, .25), r.uniform(0, 3.14)), jitter=.008, seed=k))
    obs.append(box('Beam', (.2, .15, .06), (b, .55, b), .012, rot=(.3, .1, .9)))
    return obs


BARREL_SQUAT = (1.1, .86)   # (radius, height) scale: the world's oblique top makes a true barrel read as a capsule
BARREL_PROF = [(.215, 0), (.24, .1), (.262, .26), (.27, .41), (.262, .56), (.24, .72), (.215, .82)]


def barrel(kind='wood', dmg=0, broken=False):
    obs = _barrel(kind, dmg, broken)
    xform(obs, Matrix.Diagonal((BARREL_SQUAT[0], BARREL_SQUAT[0], BARREL_SQUAT[1], 1)))
    return obs


def _barrel(kind='wood', dmg=0, broken=False):
    """14 staves on a bulged profile, 4 iron hoops, a planked lid. kind 'boom': red paint, a hazard band, a fuse."""
    obs, n = [], 14
    boom = kind == 'boom'
    if broken:
        r = random.Random(9)
        st = 'Paint' if boom else 'Stave'
        for i in range(n):   # the bottom ring: staves snapped off at uneven heights
            if i in (9, 10, 11, 3):
                continue
            hgt = r.uniform(.08, .26)
            prof = [(q[0], q[1]) for q in BARREL_PROF if q[1] <= hgt] + [(.24, hgt)]
            obs.append(stave_shell(st, prof, i / n * 6.28 + .004, (i + 1) / n * 6.28 - .004, .028))
        obs.append(lathe('Iron', [(.228, .05), (.234, .05), (.24, .11), (.234, .11)], 20))
        obs.append(box('Hole', (0, 0, .03), (.36, .36, .02)))
        for k in range(3):   # the lid, fallen off, and loose staves on the ground
            w = .4 / 3
            obs.append(box('Lid', (-.42 + w * k, -.25 + k * .02, .03 + k * .004), (w - .004, .38 - abs(k - 1) * .1, .03), rot=(0, .06, .3)))
        for k in range(4):
            a = r.uniform(-.6, 2.4)
            ob = stave_shell(st, BARREL_PROF, 0, 6.28 / n, .028)
            ob.matrix_world = Matrix.Translation((math.cos(a) * .42, math.sin(a) * .3 - .1, .03)) @ Matrix.Rotation(a + r.uniform(-.5, .5), 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'Y') @ Matrix.Translation((-.25, 0, -.41))
            obs.append(ob)
        return obs
    for i in range(n):
        if dmg and i in (10, 11):   # a stave kicked in on the front (-Y side: angles ~ 3pi/2)
            continue
        a0, a1 = i / n * 2 * math.pi + .004, (i + 1) / n * 2 * math.pi - .004
        obs.append(stave_shell('Paint' if boom else 'Stave', BARREL_PROF, a0, a1, .028))
    for z in ((.07, .17, .65, .75) if not boom else (.07, .75)):   # hoops
        rr = min(r for r, zz in BARREL_PROF if abs(zz - z) < .2) + .004
        rz = lambda zz: (.215 + (.27 - .215) * math.sin(math.pi * zz / .82)) + .01
        obs.append(lathe('Iron', [(rz(z - .03), z - .03), (rz(z - .03) + .004, z - .03), (rz(z + .03) + .004, z + .03), (rz(z + .03), z + .03)], 20))
    if boom:   # hazard band: alternating stripes around the belly
        m = 12
        for i in range(m):
            a0, a1 = i / m * 2 * math.pi, (i + 1) / m * 2 * math.pi
            obs.append(stave_shell('Hazard' if i % 2 else 'HazDark', [(.274, .33), (.282, .41), (.274, .49)], a0, a1, .01, n=2))
    lid = .78
    for k in range(3):   # lid planks, set a little into the staves
        w = .4 / 3
        obs.append(box('Lid', (-.2 + w * (k + .5), 0, lid), (w - .004, .4 - abs(k - 1) * .1, .03)))
    obs.append(box('Hole', (0, 0, lid - .03), (.4, .4, .02)))
    if boom:
        obs.append(lathe('Iron', [(0, lid + .015), (.04, lid + .015), (.04, lid + .05), (0, lid + .05)], 8, M=Matrix.Translation((.08, .05, 0))))
        obs.append(box('Fuse', (.08, .05, lid + .1), (.018, .018, .1), rot=(.3, .2, 0)))
    else:   # the bung: an iron plate on the belly, facing the camera (it shows the barrel's roll when it tips over)
        obs.append(box('Iron', (0, -.272, .41), (.07, .03, .07), .006))
    if dmg:
        obs.append(lathe('Hole', [(.0, .03), (.23, .03), (.25, .41), (.23, .79), (0, .79)], 14))
    return obs


def tilted(obs, axis_deg, deg=45):
    """Mid-fall: tipped deg about its bottom rim, toward the side the lying frames roll away to (axis_deg as tipped())."""
    a = math.radians(axis_deg)
    u, d = Vector((math.cos(a), math.sin(a), 0)), Vector((math.sin(a), -math.cos(a), 0))
    p0 = d * .215 * BARREL_SQUAT[0]
    xform(obs, Matrix.Translation(p0) @ Matrix.Rotation(math.radians(deg), 4, u) @ Matrix.Translation(-p0))
    return obs


def tipped(obs, axis_deg, roll_deg):
    """Lay a barrel on its side: its axis along axis_deg on the ground (0 = east-west), rolled roll_deg about it."""
    xform(obs, Matrix.Translation((0, 0, -.41 * BARREL_SQUAT[1])))                 # centre the barrel on its axis
    xform(obs, Matrix.Rotation(math.radians(roll_deg), 4, 'Z'))                    # roll = spin about its own axis
    xform(obs, Matrix.Rotation(math.radians(90), 4, 'Y'))                          # axis -> world X
    xform(obs, Matrix.Rotation(math.radians(axis_deg), 4, 'Z'))
    xform(obs, Matrix.Translation((0, 0, .27 * BARREL_SQUAT[0])))                  # belly on the ground
    return obs


POT_PROF = [(0, 0), (.09, 0), (.15, .06), (.195, .17), (.2, .23), (.18, .31), (.13, .37), (.095, .41), (.1, .44), (.125, .47), (.12, .49)]


def pot(dmg=0, broken=False, v=0):
    obs = []
    prof = POT_PROF if v == 0 else [(r * 1.12, z * .82) for r, z in POT_PROF]
    top = prof[-1][1]
    if broken:
        r = random.Random(3)
        obs.append(lathe('Clay', [(0, 0), (.09, 0), (.15, .06), (.19, .14)], 10, caps=(True, False)))
        obs.append(lathe('Hole', [(0, .03), (.15, .03), (.17, .1)], 10))
        for k in range(6):
            a = r.uniform(0, 6.28)
            obs.append(stave_shell('Clay', [(q[0], q[1] - .17) for q in prof[3:7]], 0, .9, .018,
                                   M=Matrix.Translation((math.cos(a) * .28, math.sin(a) * .22, .03)) @ Matrix.Rotation(a, 4, 'Z') @ Matrix.Rotation(1.3 + r.uniform(-.3, .3), 4, 'X') @ Matrix.Translation((0, -.12, 0))))
        return obs
    body = prof[:8]
    obs.append(lathe('Clay', body, 10))
    if dmg:   # chipped: the neck and rim broken away on one side
        obs.append(stave_shell('Rim', prof[7:], .8, 5.2, .02, n=7))
    else:
        obs.append(lathe('Rim', prof[7:], 10, caps=(False, False)))
    band = [(prof[4][0] + .006, prof[4][1] - .02), (prof[4][0] + .009, prof[4][1] + .02), (prof[5][0] + .008, prof[5][1])]
    obs.append(lathe('Band', band, 10, caps=(False, False)))
    obs.append(lathe('Hole', [(0, top - .015), (prof[-1][0] - .01, top - .015)], 10, caps=(False, False)))
    return obs


def chest(lid_deg=0.0):
    """Planked body, iron corners and straps, a gold lock; a barrel-vault lid hinged at the back, opened lid_deg."""
    W, D, H = .82, .52, .4
    obs = []
    for k in range(3):   # front / back planks
        z = .02 + (H - .02) / 3 * (k + .5)
        for sy in (-1, 1):
            obs.append(box('Plank', (0, sy * (D / 2 - .02), z), (W - .06, .04, (H - .02) / 3 - .005)))
        for sx in (-1, 1):
            obs.append(box('Plank', (sx * (W / 2 - .02), 0, z), (.04, D - .06, (H - .02) / 3 - .005)))
    obs.append(box('Board', (0, 0, .03), (W - .04, D - .04, .04)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            obs.append(box('Iron', (sx * (W / 2 - .03), sy * (D / 2 - .03), H / 2), (.07, .07, H + .01), .01))
    for sx in (-.22, .22):
        obs.append(box('Iron', (sx, -D / 2 - .004, H / 2), (.06, .02, H), .005))
    obs.append(box('Gold', (0, -D / 2 - .01, H - .07), (.1, .03, .12), .012))
    obs.append(box('Hole', (0, 0, H - .06), (W - .1, D - .1, .02)))
    if lid_deg > 10:   # treasure inside
        r = random.Random(5)
        for k in range(10):
            obs.append(lathe('Coin', [(0, 0), (.045, 0), (.045, .014), (0, .014)], 8,
                             M=Matrix.Translation((r.uniform(-.28, .28), r.uniform(-.14, .14), H - .1 + r.uniform(0, .05))) @ Euler((r.uniform(-.5, .5), r.uniform(-.5, .5), 0)).to_matrix().to_4x4()))
    lid = []   # the vault: 5 boards on an arc, iron straps over it
    R, n = D / 2, 5
    for k in range(n):
        a = math.pi * (k + .5) / n
        lid.append(box('Lid', (0, -math.cos(a) * R * .92, math.sin(a) * R * .55), (W - .02, R * math.pi / n * .98, .05), rot=(-(a - math.pi / 2) * .9, 0, 0)))
        for sx in (-.22, .22):   # iron straps following the vault
            lid.append(box('Iron', (sx, -math.cos(a) * R * .96, math.sin(a) * R * .55 + .02), (.06, R * math.pi / n * .98, .02), .003, rot=(-(a - math.pi / 2) * .9, 0, 0)))
    for sx in (-1, 1):   # the lid's end caps
        lid.append(lathe('Lid', [(0, 0), (R, 0), (R, .03), (0, .03)], 6, a0=0, a1=math.pi,
                         # (x, y, z) -> (z, x, .55 y): a half disc standing across the chest, squashed like the vault
                         M=Matrix.Translation((sx * (W / 2 - .015) - .015, 0, 0)) @ Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, .55, 0, 0), (0, 0, 0, 1)))))
    lid.append(box('Iron', (0, -D / 2 - .01, .05), (.08, .025, .1), .004))   # hasp
    hinge = Matrix.Translation((0, D / 2, H))
    xform(lid, hinge @ Matrix.Rotation(-math.radians(lid_deg), 4, 'X') @ Matrix.Translation((0, -D / 2, 0)))
    return obs + lid


def pillar(broken=False, seed=1):
    """Square plinth, a torus base, a 12-sided shaft in drums (the facets read as flutes), echinus + abacus."""
    r = random.Random(seed)
    obs = [box('Stone', (0, 0, .08), (.62, .62, .16), .025, jitter=.008, seed=seed),
           lathe('Cap', [(.27, .16), (.29, .2), (.28, .24), (.24, .27)], 12)]
    R, z, drums = .21, .27, ([.62, .62, .62] if not broken else [.55, .38])
    for i, hgt in enumerate(drums):
        prof = [(R + .01, z), (R, z + .02), (R - .012 * i, z + hgt - .02), (R - .012 * i - .01, z + hgt)]
        ob = lathe('Drum', prof, 12, phase=.5)
        ob.rotation_euler = (r.uniform(-.012, .012), r.uniform(-.012, .012), r.uniform(-.05, .05))
        obs.append(ob)
        z += hgt
    if broken:   # a jagged snapped top + the fallen drum beside it
        bm_top = lathe('Drum', [(R - .03, z), (R - .05, z + .06), (.12, z + .16), (0, z + .1)], 7)
        for v in bm_top.data.vertices:
            v.co.z += r.uniform(-.06, .06)
        obs.append(bm_top)
        fall = lathe('Drum', [(R, 0), (R, .55)], 12, M=Matrix.Translation((.45, -.05, R - .02)) @ Matrix.Rotation(1.57, 4, 'Y') @ Matrix.Rotation(.4, 4, 'X'))
        obs.append(fall)
        obs.append(lump('Pebble', (-.45, -.2, .06), (.1, .08, .07), seed + 3))
        obs.append(lump('Pebble', (.3, .45, .05), (.08, .07, .06), seed + 4))
        return obs
    obs.append(lathe('Cap', [(R - .02, z), (R + .05, z + .09), (R + .07, z + .13)], 12))
    obs.append(box('Cap', (0, 0, z + .18), (.56, .56, .1), .02, jitter=.006, seed=seed + 1))
    return obs


def rubble(seed=2):
    r = random.Random(seed)
    obs = []
    for k in range(6):
        a, d = r.uniform(0, 6.28), r.uniform(0, .45)
        sz = (r.uniform(.22, .4), r.uniform(.18, .3), r.uniform(.14, .22))
        obs.append(box('Stone', (math.cos(a) * d, math.sin(a) * d * .7, sz[2] / 2 + (k > 3) * .12), sz, .02,
                       rot=(r.uniform(-.3, .3), r.uniform(-.3, .3), r.uniform(0, 3)), jitter=.015, seed=k))
    for k in range(4):
        obs.append(lump('Pebble', (r.uniform(-.6, .6), r.uniform(-.4, .4), .05), (.07, .06, .05), seed * 10 + k))
    return obs


def rock(v=0, big=False):
    r = random.Random(20 + v + big * 7)
    s = (1.0, .78, .7) if big else (.3, .25, .2)
    obs = [lump('Rock', (0, 0, s[2] * .7), s, 30 + v + big * 7, sub=2 if big else 1, flat=.3)]
    if big:   # a second, leaning slab and a few stones at the foot
        obs.append(lump('Rock', (r.uniform(.45, .65), r.uniform(-.3, .2), .3), (.45, .38, .34), 40 + v, flat=.2))
        for k in range(3):
            obs.append(lump('Pebble', (r.uniform(-1.1, 1.1), r.uniform(-.7, -.3), .06), (.12, .1, .07), 50 + v * 3 + k))
    else:
        obs.append(lump('Pebble', (r.uniform(.2, .3), r.uniform(-.15, 0), .04), (.08, .07, .05), 60 + v))
    return obs


def courses(obs, x0, x1, z0, z1, depth, rows, seed, along='x', face=-1, deco=True):
    """Coursed masonry between x0..x1 (or y0..y1 when along='y'), z0..z1: staggered chamfered blocks, 1 cm joints.
    face: which side shows (-1 = south). A few blocks carry a rune plate or an ember crack on that face."""
    r = random.Random(seed)
    ch = (z1 - z0) / rows
    for k in range(rows):
        a = x0 - r.uniform(0, .25) if k % 2 else x0
        while a < x1 - .02:
            L = r.uniform(.28, .5)
            b = min(x1, a + L)
            if x1 - b < .12:
                b = x1
            a2 = max(a, x0)
            c, ln = (a2 + b) / 2, b - a2 - .012
            zc = z0 + ch * (k + .5)
            inset = r.uniform(-.008, .012)
            if along == 'x':
                obs.append(box('Block', (c, inset, zc), (ln, depth, ch - .012), .018, jitter=.006, seed=r.randint(0, 9999)))
                fy = face * (depth / 2 + inset)
                if deco and r.random() < .16:
                    obs.append(box('Rune', (c, fy + face * .004, zc), (min(.13, ln * .5), .012, ch * .5)))
                elif deco and r.random() < .14:
                    obs.append(box('Crack', (c + r.uniform(-.05, .05), fy + face * .003, zc), (.02, .01, ch * .8), rot=(0, r.uniform(-.5, .5), 0)))
            else:
                obs.append(box('Block', (inset, c, zc), (depth, ln, ch - .012), .018, jitter=.006, seed=r.randint(0, 9999)))
            a = b
    return obs


# masonry heights (m). These are the arena's; the 3D world's exporter (props3d_glb.py) raises them: a 1.2 m wall reads
# as a garden wall once the camera turns and comes close. Block courses keep their size (the row count follows height)
SIZES = {'wall': 1.2, 'low': .45, 'tower': 2.3, 'post': 1.62}


def wall(v=0, low=False, along='x'):
    """A 1 m wall segment (1.04 m: neighbours overlap by a pixel), 0.5 m thick, coursed blocks + coping stones."""
    H, D, L = (SIZES['low'] if low else SIZES['wall']), .5, .52
    obs = []
    top = H - .1
    courses(obs, -L, L, 0, top, D - .04, max(2, round(top / .275)), 300 + v * 17 + low * 5, along)
    r = random.Random(400 + v)
    a = -L
    while a < L - .02:   # coping: long slabs, a little proud of both faces (one per segment along y: seen from above)
        b = min(L, a + (r.uniform(.4, .6) if along == 'x' else 2 * L))
        if L - b < .15:
            b = L
        c, ln = (a + b) / 2, b - a - .012
        if along == 'x':
            obs.append(box('Coping', (c, 0, top + .05), (ln, D + .02, .1), .02, jitter=.006, seed=r.randint(0, 999)))
        else:
            obs.append(box('Coping', (0, c, top + .05), (D + .02, ln, .1), .02, jitter=.006, seed=r.randint(0, 999)))
        a = b
    return obs


def tower(v=0):
    """1.5 m square, SIZES['tower'] (2.3 m) to the roof, a parapet of merlons round the edge, an arrow slit on the front."""
    S, Hh = 1.5, SIZES['tower']
    obs = []
    courses(obs, -S / 2, S / 2, 0, Hh, S, round(Hh / .33), 500 + v)
    obs.append(box('Hole', (0, -S / 2 - .002, Hh * .63), (.09, .02, .45)))
    obs.append(box('Coping', (0, 0, Hh + .06), (S + .06, S + .06, .12), .02))
    for side in range(4):
        for k in range(4):
            t = -S / 2 + .16 + k * (S - .32) / 3
            pos = [(t, -S / 2 + .12), (t, S / 2 - .12), (-S / 2 + .12, t), (S / 2 - .12, t)][side]
            obs.append(box('Merlon', (pos[0], pos[1], Hh + .12 + .18), (.26, .24, .36), .02, jitter=.01, seed=side * 10 + k))
    return obs


def gatepost(v=0):
    W, Hh = .72, SIZES['post']
    obs = []
    courses(obs, -W / 2, W / 2, 0, Hh, W, round(Hh / .324), 600 + v)
    obs.append(box('Coping', (0, 0, Hh + .07), (W + .16, W + .16, .14), .025))
    obs.append(box('Coping', (0, 0, Hh + .19), (W - .1, W - .1, .1), .02))
    return obs


def chunk(kind, k):
    """Debris pieces at 8 tumbling orientations (runtime debris flips through them as it spins)."""
    r = random.Random(100 + k)
    rot = Euler((k * .79, k * 1.3 + .4, k * .5)).to_matrix().to_4x4()
    if kind == 'plank':
        obs = [box('Plank', (0, 0, 0), (.32, .1, .03), jitter=.006, seed=k)]
    elif kind == 'stave':
        obs = [stave_shell('Stave', [(q[0], q[1] * .45) for q in BARREL_PROF[:5]], 0, .45, .028, M=Matrix.Translation((-.25, 0, -.1)))]
    elif kind == 'shard':
        obs = [stave_shell('Clay', [(q[0], q[1] - .2) for q in POT_PROF[3:7]], 0, .8, .018, M=Matrix.Translation((-.17, 0, 0)))]
    elif kind == 'stone':
        obs = [lump('Stone', (0, 0, 0), (.1, .08, .07), 200 + k)]
    else:
        obs = [box('Iron', (0, 0, 0), (.12, .04, .02))]
    xform(obs, rot)
    ground_all(obs)
    return obs


# group -> ordered list of (state name, builder); every state of a group shares one canvas and pivot
def groups():
    G = {
        'crate': [('crate', lambda: crate()), ('crate_dmg', lambda: crate(1)), ('crate_broken', crate_broken)],
        'barrel': [('barrel', lambda: barrel()), ('barrel_dmg', lambda: barrel(dmg=1)), ('barrel_broken', lambda: barrel(broken=True))],
        'barrel_x': [('barrel_x', lambda: barrel('boom')), ('barrel_x_dmg', lambda: barrel('boom', dmg=1)), ('barrel_x_broken', lambda: barrel('boom', broken=True))],
        'pot': [('pot', lambda: pot()), ('pot_dmg', lambda: pot(1)), ('pot_broken', lambda: pot(broken=True)),
                ('pot_b', lambda: pot(v=1)), ('pot_b_dmg', lambda: pot(1, v=1))],
        'chest': [(f'chest_{i}', (lambda a: lambda: chest(a))(a)) for i, a in enumerate((0, 22, 48, 78, 104))],
        'pillar': [('pillar', lambda: pillar()), ('pillar_broken', lambda: pillar(True, 3))],
        'rubble': [('rubble', lambda: rubble())],
        'rock': [(f'rock_{v}', (lambda v: lambda: rock(v))(v)) for v in range(3)],
        'rock_big': [(f'rock_big_{v}', (lambda v: lambda: rock(v, True))(v)) for v in range(3)],
    }
    for kind in ('barrel', 'barrel_x'):
        G[kind + '_tilt'] = [(f'{kind}_tilt_{a}', (lambda a, kind: lambda: tilted(barrel('boom' if kind == 'barrel_x' else 'wood'), a * 45))(a, kind)) for a in range(8)]
    G['wall_ew'] = [(f'wall_ew_{v}', (lambda v: lambda: wall(v))(v)) for v in range(4)]
    G['wall_low'] = [(f'wall_low_{v}', (lambda v: lambda: wall(v, low=True))(v)) for v in range(4)]
    G['wall_ns'] = [(f'wall_ns_{v}', (lambda v: lambda: wall(v, along='y'))(v)) for v in range(4)]
    G['tower'] = [('tower', lambda: tower())]
    G['gatepost'] = [('gatepost', lambda: gatepost())]
    for kind in ('barrel', 'barrel_x'):   # tipped over and rolling: 8 axis angles x 8 roll phases
        G[kind + '_roll'] = [(f'{kind}_roll_{a}_{p}', (lambda a, p, kind: lambda: tipped(barrel('boom' if kind == 'barrel_x' else 'wood'), a * 22.5, p * 45))(a, p, kind))
                             for a in range(8) for p in range(8)]
    for kind in ('plank', 'stave', 'shard', 'stone', 'iron'):
        G['chunk_' + kind] = [(f'chunk_{kind}_{k}', (lambda k, kind: lambda: chunk(kind, k))(k, kind)) for k in range(8)]
    return G


# ------------------------------------------------------------------ rendering
def project(obs):
    """Bake transforms, store each face's true normal in the 20 deg camera frame (attribute 'tn', encoded * .5 + .5),
    then (world projection) shear: screen-up Z' = z cos20 + north * sin55."""
    c20, s20 = math.cos(math.radians(PITCH)), math.sin(math.radians(PITCH))
    bpy.context.view_layer.update()
    for ob in obs:
        me = ob.data
        me.transform(ob.matrix_world)
        ob.matrix_world = Matrix.Identity(4)
        me.update()
        at = me.color_attributes.new('tn', 'FLOAT_COLOR', 'CORNER')
        for p in me.polygons:
            n = p.normal
            c = (n.x, n.y * s20 + n.z * c20, -n.y * c20 + n.z * s20)
            for li in p.loop_indices:
                at.data[li].color = (c[0] * .5 + .5, c[1] * .5 + .5, c[2] * .5 + .5, 1)
        if PROJ == 'world':
            for v in me.vertices:
                v.co.z = v.co.z * c20 + v.co.y * GROUND_K
        me.update()
    bpy.context.view_layer.update()
    return obs


def nrm_material():
    def build(nt, col):
        a = nt.nodes.new('ShaderNodeAttribute')
        a.attribute_type, a.attribute_name = 'GEOMETRY', 'tn'
        nt.links.new(a.outputs['Color'], col)
    return _rig['_mat']('PxTrueNrm', build)


def clear():
    for ob in list(bpy.data.collections[COL].objects):
        me = ob.data
        bpy.data.objects.remove(ob)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)


def bounds(cam, off, obs):
    M = cam.rotation_euler.to_matrix()
    right, up = M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0))
    xs, ys, ds = [], [], []
    for ob in obs:
        for w in world_verts(ob):
            xs.append(w.dot(right) / UPP); ys.append(-w.dot(up) / UPP); ds.append(-w.dot(off))
    return min(xs), max(xs), min(ys), max(ys), min(ds), max(ds)


def run(out, only=None):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    col = bpy.data.collections.get(COL) or bpy.data.collections.new(COL)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    cam, off = camera(0, 0 if PROJ == 'world' else PITCH)   # yaw 0: looking north, the prop's front (-Y) faces the camera
    M = cam.rotation_euler.to_matrix()
    right, up = M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0))
    index = {}
    for gname, states in groups().items():
        if only and gname not in only:
            continue
        B = [1e9, -1e9, 1e9, -1e9, 1e9, -1e9]
        for sname, build in states:   # pass 1: the group's shared canvas
            obs = project([o for o in build() if o])
            b = bounds(cam, off, obs)
            B = [min(B[0], b[0]), max(B[1], b[1]), min(B[2], b[2]), max(B[3], b[3]), min(B[4], b[4]), max(B[5], b[5])]
            clear()
        x0, y0 = math.floor(B[0]) - PAD, math.floor(B[2]) - PAD
        W, H = math.ceil(B[1]) + PAD - x0, math.ceil(B[3]) + PAD - y0
        pivot = (-x0, -y0)                # the world origin (the prop's ground point) sits in this pixel
        near, far = 50 + B[4] - .05, 50 + B[5] + .05
        cam.data.ortho_scale = UPP * max(W, H)
        cx, cy = pivot[0] + .5 - W / 2, H / 2 - (pivot[1] + .5)
        cam.location = -(right * cx + up * cy) * UPP + off * 50
        cam.data.clip_start, cam.data.clip_end = 1, 100
        render_setup(W, H, SS)
        mats = pass_materials(near, far)
        mats['nrm'] = nrm_material()
        gdir = os.path.join(out, gname)
        for sname, build in states:
            obs = project([o for o in build() if o])
            for i, ob in enumerate(obs):
                ob.pass_index = i + 1
            d = os.path.join(gdir, sname)
            os.makedirs(d, exist_ok=True)
            sc, vl = bpy.context.scene, bpy.context.view_layer
            for tag, m in mats.items():
                vl.material_override = m
                sc.render.filepath = os.path.join(d, f'{tag}.png')
                bpy.ops.render.render(write_still=True)
            vl.material_override = None
            json.dump({'w': W, 'h': H, 'ss': SS, 'pivot': list(pivot), 'units_per_px': UPP, 'pitch': PITCH, 'proj': PROJ, 'near': near, 'far': far,
                       'objects': {str(i + 1): ob.name for i, ob in enumerate(obs)}}, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
            clear()
        index[gname] = {'w': W, 'h': H, 'pivot': list(pivot), 'states': [s for s, _ in states], **GROUP_OPTS.get(gname, {})}
        json.dump(index[gname], open(os.path.join(gdir, 'group.json'), 'w'))
        print('PROP', gname, W, H, pivot, len(states), flush=True)
    json.dump(PARTS, open(os.path.join(out, 'parts.json'), 'w'), indent=1)
    return index


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(zip(argv[::2], argv[1::2]))
    out = os.path.abspath(a.get('--out', os.path.join(HERE, '..', '..', 'concepts', 'sprites', 'out', 'props3d' if PROJ == 'world' else 'props3d_20')))
    idx = run(out, a['--only'].split(',') if '--only' in a else None)
    print('PROPS3D_OK', len(idx))
