# Shared blockout helpers for character scripts (exec'd into the caller's namespace, which sets COL and CLAY).
# Blender units = game units: Z up, characters face -Y (glTF +Z), their left hand is +X.
import bpy, bmesh, math
from mathutils import Vector


def ring(n, rx, ry, p):
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n + math.pi / n
        c, s = math.cos(a), math.sin(a)
        out.append((rx * math.copysign(abs(c) ** (2 / p), c), ry * math.copysign(abs(s) ** (2 / p), s)))
    return out


def sweep(name, clay, pts, radii, n=6, p=2.0, side=(1, 0, 0), warp=None, caps=(True, True), cut=None, shell=0):
    """Loft rings along a path; radii[k] = (rx along the side axis, ry across it). Flat shaded, planar faces.
    warp(k, xn, yn) -> (du, dv, dt) moves ring vertices (xn, yn in -1..1); cut(face_center) deletes faces;
    shell > 0 adds a Solidify for open shells."""
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
    ob.parent = bpy.data.objects[COL]
    for f in me.polygons:
        f.use_smooth = False
    me.materials.append(bpy.data.materials['Clay' + clay])
    if shell:
        m = ob.modifiers.new('Shell', 'SOLIDIFY')
        m.thickness, m.offset, m.use_even_offset = shell, -1, True
    return ob


def up(x, rows):
    """Vertical path: rows = (z, y, rx, ry) bottom to top -> (pts, radii)."""
    return [(x, r[1], r[0]) for r in rows], [r[2:] for r in rows]


def setup():
    """Fresh collection COL with a root empty of the same name; other character collections are hidden."""
    sc = bpy.context.scene
    for c in bpy.data.collections:
        if c.name != COL:
            for ob in c.objects:
                ob.hide_set(True)
                ob.hide_render = True
    for ob in sc.collection.objects:
        if ob.type == 'MESH':
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
    root = bpy.data.objects.new(COL, None)
    col.objects.link(root)
    for k, g in CLAY.items():
        mat = bpy.data.materials.get('Clay' + k) or bpy.data.materials.new('Clay' + k)
        mat.use_nodes = True
        bsdf = next(nd for nd in mat.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = (g, g, g, 1)
        bsdf.inputs['Roughness'].default_value = 0.9
        mat.diffuse_color = (g, g, g, 1)
    return sc, col.objects[COL]


def preview(out_dir, mode='clay', sizes=((72, 's'), (288, 'b')), scale=2.63, yaw=45, pitch=30):
    """8 facings through a game-like ortho camera; 72 px frames make a ~50 px tall figure.
    mode 'sil' renders a flat black silhouette on transparent."""
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
    if mode == 'sil':
        sh.light, sh.color_type, sh.single_color, sh.show_object_outline = 'FLAT', 'SINGLE', (0, 0, 0), False
    else:
        sh.light, sh.color_type, sh.show_object_outline, sh.object_outline_color = 'STUDIO', 'MATERIAL', True, (0, 0, 0)
    sc.display.render_aa = 'OFF'
    sc.render.film_transparent = True
    root = bpy.data.objects[COL]
    out = []
    for size, tag in sizes:
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
