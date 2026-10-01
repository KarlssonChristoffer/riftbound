# Ranger blockout v2: an authored low-poly mesh of a few controlled, planar volumes (flat shaded, no smoothing):
# a peaked hood with the face set inside it, an asymmetric mantle over the left shoulder with a cape tail,
# a trapezoid torso, separated box legs and boots, and a thick bow. Three clay values:
# head/hood (light), mantle/body (mid), legs/boots (dark). No rig, no colour, no weights yet.
# Blender units = game units: Z up, the character faces -Y (glTF +Z), its left hand is +X, hood tip at ~1.86.
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_block.py').read(), ns); ns['build']()
import bpy, bmesh, math
from mathutils import Vector

COL, ROOT = 'RangerBlock', 'RangerBlock'
CLAY = {'Head': .30, 'Body': .085, 'Legs': .006}  # linear greys, far enough apart to read as three masses in game light


def ring(n, rx, ry, p):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n + math.pi / n
        c, s = math.cos(a), math.sin(a)
        out.append((rx * math.copysign(abs(c) ** (2 / p), c), ry * math.copysign(abs(s) ** (2 / p), s)))
    return out


def sweep(name, clay, pts, radii, n=6, p=2.0, side=(1, 0, 0), warp=None, caps=(True, True), cut=None, shell=0):
    """Loft rings along a path. radii[k] = (rx along the side axis, ry across it).
    warp(k, x, y) -> (du, dv, dt) moves single ring vertices; cut(face_center) -> True deletes that face;
    shell > 0 adds a Solidify of that thickness (for open shells like the hood)."""
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
        r = radii[k]
        vs = []
        for x, y in ring(n, r[0], r[1], r[2] if len(r) > 2 else p):
            d = warp(k, x / r[0], y / r[1]) if warp else (0, 0, 0)
            vs.append(bm.verts.new(c + u * (x + d[0]) + v * (y + d[1]) + t * d[2]))
        rings.append(vs)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps[0]:
        bm.faces.new(list(reversed(rings[0])))
    if caps[1]:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if cut:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if cut(f.calc_center_median())], context='FACES')
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.data.collections[COL].objects.link(ob)
    ob.parent = bpy.data.objects[ROOT]
    for f in me.polygons:
        f.use_smooth = False
    me.materials.append(bpy.data.materials['Clay' + clay])
    if shell:
        m = ob.modifiers.new('Shell', 'SOLIDIFY')
        m.thickness, m.offset, m.use_even_offset = shell, -1, True
    return ob


def setup():
    sc = bpy.context.scene
    for name in ('Ranger', 'PreviewCam'):  # hide the first blockout instead of deleting it
        ob = bpy.data.objects.get(name)
        if ob and name == 'Ranger':
            for o in [ob] + list(ob.children):
                o.hide_set(True)
                o.hide_render = True
    col = bpy.data.collections.get(COL)
    if col:
        for ob in list(col.objects):
            me = ob.data
            bpy.data.objects.remove(ob)
            if me is not None and me.users == 0:
                bpy.data.meshes.remove(me)
    else:
        col = bpy.data.collections.new(COL)
        sc.collection.children.link(col)
    root = bpy.data.objects.new(ROOT, None)
    col.objects.link(root)
    for k, g in CLAY.items():
        mat = bpy.data.materials.get('Clay' + k) or bpy.data.materials.new('Clay' + k)
        mat.use_nodes = True
        bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (g, g, g, 1)
        bsdf.inputs['Roughness'].default_value = 0.9
        mat.diffuse_color = (g, g, g, 1)
    return sc, root


def up(x, rows):
    """Vertical path helper: rows = (z, y, rx, ry) bottom to top -> (pts, radii)."""
    return [(x, r[1], r[0]) for r in rows], [r[2:] for r in rows]


def build():
    sc, root = setup()

    # ---- HEAD (light): a peaked hood with a flat-fronted face block set back inside the opening ----
    sweep('Face', 'Head', *up(0, [(1.20, -.03, .15, .14), (1.25, -.035, .19, .17), (1.58, -.03, .20, .18)]), n=8, p=4)
    # hood: faceted 12-sided shell, opening cut out of the front, peak folded back
    opening = lambda c: c.y < -.05 and abs(c.x) < .19 and c.z < 1.60
    sweep('Hood', 'Head', *up(0, [(1.10, .05, .335, .28), (1.30, .035, .335, .295), (1.48, .03, .32, .30), (1.61, .05, .28, .28),
                                  (1.71, .10, .19, .21), (1.77, .19, .085, .10), (1.785, .29, .02, .02)]),
          n=12, p=2.0, caps=(False, True), cut=opening, shell=.035)

    # ---- BODY (mid): trapezoid torso, asymmetric mantle over the left shoulder, cape tail down the back-left ----
    sweep('Torso', 'Body', *up(0, [(.38, 0, .25, .17), (.50, 0, .21, .15), (.64, 0, .19, .13), (.95, .005, .24, .15),
                                   (1.08, .01, .25, .14), (1.13, .015, .14, .10)]), n=8, p=5)
    # mantle hem runs diagonally: low at the left hip, up at the right chest (right shoulder stays bare)
    hem = lambda k, x, y: (0, 0, .24 * max(0, -x) + .03 * max(0, x)) if k == 0 else (0, 0, 0)
    sweep('Mantle', 'Body', *up(.03, [(.78, .02, .30, .21), (1.04, .02, .33, .235), (1.14, .02, .29, .22), (1.21, .03, .16, .15)]),
          n=8, p=3, warp=hem)
    tail = lambda k, x, y: (0, -.05 * x * x, -.14 * max(0, x) - .02 if k == 0 else 0)
    sweep('Cape', 'Body', *up(.07, [(.40, .29, .22, .03), (.72, .25, .20, .03), (1.06, .20, .16, .035)]), n=4, p=12, warp=tail)
    # quiver behind the bare right shoulder, fletchings above it
    qa, qb = Vector((.02, .30, .62)), Vector((-.17, .30, 1.16))
    ax = (qb - qa).normalized()
    sweep('Quiver', 'Body', [qa, qb], [(.065, .06), (.075, .07)], n=4, p=12)
    sweep('Fletch', 'Head', [qb, qb + ax * .16], [(.07, .03), (.03, .015)], n=4, p=12)
    # arms: right hangs bare, left comes forward out of the mantle to hold the bow; box hands
    for sfx, sx, spl, fwd in (('L', 1, 20, 18), ('R', -1, 11, 4)):
        d = Vector((sx * math.sin(math.radians(spl)), -math.sin(math.radians(fwd)), -math.cos(math.radians(spl)))).normalized()
        S = Vector((sx * .25, .01, 1.03))
        sweep(f'Arm.{sfx}', 'Body', [S + d * s for s in (-.03, .30)], [(.075, .075), (.062, .062)], n=6, p=2.0)
        sweep(f'Hand.{sfx}', 'Body', [S + d * s for s in (.29, .41)], [(.07, .075), (.06, .065)], n=4, p=8)
        if sx > 0:
            hand = S + d * .35

    # ---- LEGS (dark): two separate box legs with a clear gap, blocky boots with a cuff and a toe ----
    for sfx, sx in (('L', 1), ('R', -1)):
        sweep(f'Leg.{sfx}', 'Legs', [(sx * .105, 0, .46), (sx * .13, 0, .22)], [(.075, .08), (.07, .075)], n=6, p=2.0)
        bx = sx * .135
        sweep(f'Boot.{sfx}', 'Legs', *up(bx, [(.02, .01, .095, .10), (.23, .01, .09, .095), (.24, .01, .11, .115), (.29, .01, .11, .115)]), n=4, p=12)
        sweep(f'Toe.{sfx}', 'Legs', [(bx, .02, .06), (bx, -.21, .05)], [(.09, .06), (.08, .045)], n=4, p=12)

    # ---- WEAPON (light): a thick recurve bow held out from the left hand, tilted away from the body ----
    L, out, lean = 1.15, math.radians(14), math.radians(10)
    pts, rad = [], []
    for i in range(9):
        s = -1 + 2 * i / 8
        y = .15 * s * s - .30 * max(0, abs(s) - .75)
        z = s * L / 2
        pts.append(hand + Vector((z * math.sin(out), y - z * math.sin(lean), z * math.cos(out))))
        rad.append((.06, .055) if abs(s) < .01 else (.045, .04 - .012 * abs(s)))
    sweep('Bow', 'Head', pts, rad, n=4, p=12)

    return sorted(o.name for o in bpy.data.collections[COL].objects)


def preview(out_dir, small=72, big=288, scale=2.63, yaw=45, pitch=30):
    sc = bpy.context.scene
    cam = bpy.data.objects.get('PreviewCam')
    if not cam:
        cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
        sc.collection.objects.link(cam)
    cam.data.type, cam.data.ortho_scale, cam.data.clip_end = 'ORTHO', scale, 100
    y, p = math.radians(yaw), math.radians(pitch)
    off = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.location = Vector((0, 0, .9)) + off * 20
    cam.rotation_euler = (-off).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    try:
        sc.render.engine = 'BLENDER_WORKBENCH'
    except TypeError:
        pass
    sh = sc.display.shading
    sh.light, sh.color_type = 'STUDIO', 'MATERIAL'
    sh.show_object_outline, sh.object_outline_color = True, (0, 0, 0)
    sc.display.render_aa = 'OFF'
    sc.render.film_transparent = True
    root = bpy.data.objects[ROOT]
    out = []
    for size, tag in ((small, 's'), (big, 'b')):
        sc.render.resolution_x = sc.render.resolution_y = size
        for k in range(8):
            root.rotation_euler = (0, 0, y + math.radians(45 * k))
            sc.render.filepath = f'{out_dir}/{tag}{k}.png'
            bpy.ops.render.render(write_still=True, scene=sc.name)
            out.append(sc.render.filepath)
    root.rotation_euler = (0, 0, 0)
    return out


def export(path):
    names = set(o.name for o in bpy.data.collections[COL].objects)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob.name in names)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    return path
