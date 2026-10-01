# Grey Ranger blockout: a controlled low-poly mesh made of a few deliberate volumes
# (head/hair, torso/mantle/cape, arms, legs/boots, bow/quiver). No rig, no colour yet.
# Every volume is lofted through hand-placed cross-sections, like box-modelling by numbers.
# Blender units = game units: Z up, the character faces -Y (glTF +Z), its left hand is +X, top of the hair at 1.85.
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_grey.py').read(), ns); ns['build']()
import bpy, bmesh, math
from mathutils import Vector

COL, ROOT = 'Ranger', 'Ranger'
GREY = (0.2, 0.2, 0.2, 1)  # linear; about the value of the game's stone palettes


def ring(n, rx, ry, p):
    """n points on a superellipse (p=2 ellipse, higher = boxier), flat faces toward front/back/sides."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n + math.pi / n
        c, s = math.cos(a), math.sin(a)
        out.append((rx * math.copysign(abs(c) ** (2 / p), c), ry * math.copysign(abs(s) ** (2 / p), s)))
    return out


def sweep(name, pts, radii, n=12, p=2.6, side=(1, 0, 0), warp=None, caps=True):
    """Loft rings along a path. radii[k] = (rx along the side axis, ry across it[, p]).
    warp(k, x, y) -> (du, dv, dt) nudges single ring vertices in the ring's own frame."""
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
            d = warp(k, x, y) if warp else (0, 0, 0)
            vs.append(bm.verts.new(c + u * (x + d[0]) + v * (y + d[1]) + t * d[2]))
        rings.append(vs)
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return put(name, me)


def put(name, me):
    ob = bpy.data.objects.new(name, me)
    bpy.data.collections[COL].objects.link(ob)
    ob.parent = bpy.data.objects[ROOT]
    try:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(48))
    except AttributeError:
        for f in me.polygons:
            f.use_smooth = True
    me.materials.append(bpy.data.materials['RangerGrey'])
    return ob


def vertical(name, x, rows, **kw):
    """rows = (z, y_center, rx, ry[, p]) from bottom to top."""
    return sweep(name, [(x, r[1], r[0]) for r in rows], [r[2:] for r in rows], **kw)


def mirror(pts):
    return [(-x, y, z) for x, y, z in pts]


def setup():
    # builds into the open scene (switching the window's scene from the add-on's socket callback crashed Blender)
    sc = bpy.context.scene
    for ob in sc.objects:  # keep the startup cube out of the way without deleting anything of yours
        if ob.name == 'Cube' and ob.type == 'MESH':
            ob.hide_set(True)
            ob.hide_render = True
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
    mat = bpy.data.materials.get('RangerGrey') or bpy.data.materials.new('RangerGrey')
    mat.use_nodes = True
    bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = GREY
    bsdf.inputs['Roughness'].default_value = 0.9
    mat.diffuse_color = GREY
    return sc, root


def build():
    sc, root = setup()

    # ---- head and hair: the biggest shape. Head+hair ~39% of the height, hair clearly wider than the shoulders ----
    vertical('Head', 0, [(1.13, -.01, .15, .14), (1.16, -.01, .23, .21), (1.23, 0, .29, .265), (1.34, 0, .315, .285),
                         (1.48, 0, .32, .29), (1.60, 0, .305, .28), (1.68, 0, .26, .24), (1.73, 0, .16, .15)], p=3.0)
    # mushroom cap: sits back on the lower rings so the face shows below z~1.51, sides and back bulge out
    vertical('Hair', 0, [(1.20, .12, .33, .21), (1.26, .10, .375, .255), (1.34, .075, .385, .28), (1.44, .045, .39, .305),
                         (1.54, .02, .385, .325), (1.66, .01, .36, .33), (1.76, .015, .30, .29), (1.83, .02, .19, .19), (1.85, .02, .08, .08)], p=2.6)
    lock = [(.285, -.14, 1.52), (.295, -.155, 1.34), (.285, -.14, 1.16)]
    lr = [(.075, .095), (.07, .09), (.035, .04)]
    sweep('HairLock.L', lock, lr, n=8, p=2.0)
    sweep('HairLock.R', mirror(lock), lr, n=8, p=2.0)
    # fringe: one thick band hugging the forehead, swept down toward the character's right (-X)
    fx = [.30, .20, .08, -.05, -.17, -.27, -.33]
    fr = [(.04, .05), (.06, .065), (.075, .07), (.09, .07), (.105, .07), (.10, .065), (.05, .05)]
    fz = [1.60, 1.60, 1.585, 1.565, 1.545, 1.535, 1.53]
    fpts = [(x, -.285 * math.sqrt(max(0, 1 - (x / .40) ** 2)) + .01, z) for x, z in zip(fx, fz)]
    sweep('Fringe', fpts, fr, n=8, p=2.4, side=(0, 0, 1))

    # ---- torso: short block with a flared tunic, a belt, the bunched hood and mantle, a short cape ----
    vertical('Neck', 0, [(.98, .02, .085, .085), (1.20, .02, .085, .085)], n=8, p=2.2)
    vertical('Torso', 0, [(.40, 0, .23, .15), (.42, 0, .265, .18), (.52, 0, .255, .175), (.64, 0, .23, .16),
                          (.78, .005, .225, .155), (.94, .01, .245, .165), (1.04, .015, .225, .15), (1.075, .02, .14, .11)], p=2.8)
    vertical('Belt', 0, [(.60, 0, .242, .17), (.67, .002, .238, .166)], p=2.8)
    # mantle (the hood lying down around the shoulders), its front dipping into a point
    dip = lambda k, x, y: (0, 0, -.06 * max(0, -y / .225) ** 2) if k == 0 else (0, 0, 0)
    vertical('Mantle', 0, [(.90, .02, .31, .225), (.96, .02, .32, .235), (1.06, .02, .30, .23), (1.13, .02, .21, .19),
                           (1.18, .02, .13, .13)], p=2.4, warp=dip)
    sweep('Hood', [(-.18, .225, 1.07), (-.10, .255, 1.10), (0, .265, 1.11), (.10, .255, 1.10), (.18, .225, 1.07)],
          [(.04, .05), (.09, .09), (.105, .10), (.09, .09), (.04, .05)], n=8, p=2.2, side=(0, 0, 1))
    # cape: a curved slab behind the back, edges wrapping forward, V-shaped hem
    wrap = lambda k, x, y: (0, -.08 * (x / .33) ** 2, (-.07 * (1 - abs(x) / .33)) if k == 0 else 0)
    vertical('Cape', 0, [(.44, .30, .33, .03), (.68, .265, .31, .03), (.88, .235, .27, .035), (1.03, .205, .21, .035)], p=2.0, warp=wrap)
    # quiver across the back, bottom at the left hip, fletchings up past the right shoulder
    qa, qb = Vector((.12, .36, .60)), Vector((-.15, .36, 1.10))
    ax = (qb - qa).normalized()
    sweep('Quiver', [qa - ax * .03, qa, qb, qb + ax * .015, qb + ax * .02], [(.03, .03), (.06, .06), (.065, .065), (.072, .072), (.05, .05)], n=8, p=2.2)
    across = ax.cross(Vector((0, 1, 0))).normalized()
    for i, off in enumerate((Vector((0, 0, 0)), across * .045 + Vector((0, .02, 0)), -across * .045 + Vector((0, -.015, 0)))):
        b0 = qb + off + ax * (.01 + .03 * (i == 0))
        sweep(f'Fletch.{i}', [b0, b0 + ax * .08, b0 + ax * .15], [(.035, .01), (.035, .01), (.008, .006)], n=6, p=2.0, side=across)

    # ---- arms: short and thick, mitten hands; the left hand holds the bow ----
    for sfx, sx in (('L', 1), ('R', -1)):
        spl = math.radians(15 if sx > 0 else 10)
        d = Vector((sx * math.sin(spl), -math.sin(math.radians(5)), -math.cos(spl))).normalized()
        S = Vector((sx * .245, .01, 1.00))
        sweep(f'Arm.{sfx}', [S + d * s for s in (-.04, 0, .16, .29, .30)], [(.05, .05), (.08, .085), (.07, .075), (.062, .066), (.03, .03)], n=8, p=2.4)
        sweep(f'Hand.{sfx}', [S + d * s for s in (.27, .33, .38, .41)], [(.055, .06), (.075, .08), (.07, .075), (.04, .045)], n=8, p=2.4)
        if sx > 0:
            hand = S + d * .345

    # ---- legs: short, slightly apart, oversized boots ----
    for sfx, sx in (('L', 1), ('R', -1)):
        x = sx * .10
        sweep(f'Leg.{sfx}', [(x, 0, .50), (x + sx * .01, 0, .34), (x + sx * .025, .005, .20)], [(.095, .10), (.085, .09), (.08, .085)], n=8, p=2.4)
        bx = sx * .127
        vertical(f'Boot.{sfx}', bx, [(.06, .005, .095, .105), (.21, .005, .092, .10), (.24, .005, .103, .11), (.27, .005, .10, .105), (.275, .005, .075, .075)], n=8, p=2.6)
        sweep(f'Foot.{sfx}', [(bx, .10, .06), (bx, 0, .065), (bx, -.13, .055), (bx, -.18, .04), (bx, -.195, .025)],
              [(.085, .06), (.095, .065), (.095, .055), (.075, .04), (.045, .025)], n=8, p=2.6)

    # ---- bow: vertical at the left side, grip in the hand, top tilted out, small recurve at the tips ----
    L, tilt = 1.0, math.radians(8)
    pts, rad = [], []
    for i in range(17):
        s = -1 + 2 * i / 16
        y = .15 * s * s - .35 * max(0, abs(s) - .82)
        z = s * L / 2
        pts.append(hand + Vector((z * math.sin(tilt), y, z * math.cos(tilt))))
        g = abs(s) < .1
        rad.append((.05, .06) if g else (.035 - .012 * abs(s), .045 - .02 * abs(s)))
    sweep('Bow', pts, rad, n=6, p=2.0)
    sweep('BowString', [pts[1], pts[-2]], [(.012, .012), (.012, .012)], n=4, p=2.0)

    root.select_set(False)
    return sorted(o.name for o in bpy.data.collections[COL].objects)


def preview(out_dir, small=72, big=288, scale=2.63, yaw=45, pitch=30):
    """Renders 8 facings through a game-like ortho camera: `small` px frames give ~48 px tall figures."""
    sc = bpy.context.scene
    cam = bpy.data.objects.get('PreviewCam')
    if not cam:
        cam = bpy.data.objects.new('PreviewCam', bpy.data.cameras.new('PreviewCam'))
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    y, p = math.radians(yaw), math.radians(pitch)
    # three.js camera offset (sin(yaw)cos(p), sin(p), cos(yaw)cos(p)) -> Blender (x, -z, y)
    off = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    target = Vector((0, 0, .9))
    cam.location = target + off * 20
    cam.rotation_euler = (-off).to_track_quat('-Z', 'Y').to_euler()
    cam.data.clip_end = 100
    sc.camera = cam
    try:
        sc.render.engine = 'BLENDER_WORKBENCH'
    except TypeError:
        pass
    sh = sc.display.shading
    sh.light, sh.color_type, sh.single_color = 'STUDIO', 'SINGLE', (.6, .6, .6)
    sh.show_object_outline, sh.object_outline_color = True, (0, 0, 0)
    sc.display.render_aa = 'OFF'
    sc.render.film_transparent = True
    sc.render.resolution_percentage = 100
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
    sc = bpy.context.scene
    for ob in sc.objects:
        ob.select_set(ob.name in bpy.data.collections[COL].objects)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    return path
