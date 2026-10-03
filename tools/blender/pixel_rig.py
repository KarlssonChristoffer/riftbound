# Pixel render rig (after KitagawaGameDev's "How To Make Pixel Art In Blender"): Blender is the pose/shape oracle,
# not the painter. For each of 8 facings it renders three exact, unlit, un-antialiased data passes through an ortho
# camera whose pixel grid matches the sprite canvas:
#   <dir>_id.png   object index per pixel (R = pass_index / 255)
#   <dir>_nrm.png  camera-space normal * 0.5 + 0.5 (x right, y up, z toward the viewer) -> also the game's normal map
#   <dir>_dep.png  view depth, 0 = near plane of the fit box, 1 = far
# concepts/sprites/pixelize.py then turns these into palette sprites with the master's lighting/outline language.
# The character turns (the video's approach), the camera and light stay fixed, so shading is screen-consistent.
#
# Headless:  D:\Blender\blender.exe -b --factory-startup --python tools/blender/pixel_rig.py -- \
#              --model tools/blender/ranger_v4.py --out concepts/sprites/out/render [--w 48 --h 64 --ss 4 --fig 58]
#            [--poses a,b,c] [--clips idle,walk]  (armature models: out/<pose>/ or out/<clip>.<i>/, 2D bones in meta.json,
#            clip metadata (stride, contacts, planted foot) in poses.json)
#            [--upp 0.03279]  fixed metres per pixel (one scale for the body and every outfit)
#            [--dirs 16]  16 facings (22.5 deg) instead of 8
#            [--append 1]  render only these poses/clips into an existing atlas (in its own depth box) and merge poses.json
import bpy, json, math, os, sys
from mathutils import Vector

DIRS8 = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW']  # screen facing; character forward is -Y at yaw 0
DIRS16 = ['S', 'SSE', 'SE', 'ESE', 'E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW', 'W', 'WSW', 'SW', 'SSW']
DIRS = DIRS8  # index +1 = the character turned 360/len(DIRS) deg counter-clockwise (to its left)
yaw_of = lambda k: 45 + 360 / len(DIRS) * k


def load_model(path):
    ns = {'__name__': 'pixel_rig_model'}
    exec(open(path, encoding='utf-8').read(), ns)
    ns['build']()
    root = bpy.data.objects[ns['ROOT']]
    meshes = sorted((o for o in bpy.data.collections[ns['COL']].objects if o.type == 'MESH' and not o.hide_render),
                    key=lambda o: o.name)
    return root, meshes, ns


def world_verts(ob):
    """Vertex positions after modifiers (armature deformation), in world space."""
    oe = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = oe.to_mesh()
    out = [oe.matrix_world @ v.co for v in me.vertices]
    oe.to_mesh_clear()
    return out


def camera(yaw=45, pitch=30):
    sc = bpy.context.scene
    cam = bpy.data.objects.get('PixelCam') or bpy.data.objects.new('PixelCam', bpy.data.cameras.new('PixelCam'))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    y, p = math.radians(yaw), math.radians(pitch)
    off = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.rotation_euler = (-off).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    return cam, off


def fit(cam, off, root, meshes, W, H, fig, pivot, depth_margin=.05, upp=None):
    """Scale so the tallest facing is `fig` px, and put world origin (the feet) on the pivot pixel."""
    M = cam.rotation_euler.to_matrix()
    right, up = M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0))
    top, bot, dmin, dmax = -1e9, 1e9, 1e9, -1e9
    for k in range(len(DIRS)):
        root.rotation_euler = (0, 0, math.radians(yaw_of(k)))
        bpy.context.view_layer.update()
        for ob in meshes:
            for w in world_verts(ob):
                s = w.dot(up)
                top, bot = max(top, s), min(bot, s)
                d = -w.dot(off)
                dmin, dmax = min(dmin, d), max(dmax, d)
    root.rotation_euler = (0, 0, 0)
    px = upp or (top - bot) / fig               # world units per pixel (fixed with upp: every loadout at one scale)
    cam.data.ortho_scale = px * max(W, H)
    # pixel (pivot) is the origin; the camera centre sits at (W/2, H/2)
    cx, cy = pivot[0] + .5 - W / 2, H / 2 - (pivot[1] + .5)
    cam.location = -(right * cx + up * cy) * px + off * 50
    cam.data.clip_start, cam.data.clip_end = 1, 100
    near, far = 50 + dmin - depth_margin, 50 + dmax + depth_margin  # camera-to-point distance along the view axis
    return px, near, far


def _mat(name, build):
    m = bpy.data.materials.get(name)
    if m:
        bpy.data.materials.remove(m)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    build(nt, em.inputs['Color'])
    return m


def pass_materials(near, far):
    def idm(nt, col):
        oi = nt.nodes.new('ShaderNodeObjectInfo')
        mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'DIVIDE'; mul.inputs[1].default_value = 255
        comb = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(oi.outputs['Object Index'], mul.inputs[0]); nt.links.new(mul.outputs[0], comb.inputs[0])
        nt.links.new(comb.outputs[0], col)

    def nrm(nt, col):
        geo = nt.nodes.new('ShaderNodeNewGeometry')
        vt = nt.nodes.new('ShaderNodeVectorTransform')
        vt.vector_type, vt.convert_from, vt.convert_to = 'NORMAL', 'WORLD', 'CAMERA'
        # Blender's shader camera space is x right, y up, z into the screen; flip z so +z faces the viewer
        flip = nt.nodes.new('ShaderNodeVectorMath'); flip.operation = 'MULTIPLY'; flip.inputs[1].default_value = (1, 1, -1)
        ma = nt.nodes.new('ShaderNodeVectorMath'); ma.operation = 'MULTIPLY_ADD'
        ma.inputs[1].default_value = (.5, .5, .5); ma.inputs[2].default_value = (.5, .5, .5)
        nt.links.new(geo.outputs['Normal'], vt.inputs[0]); nt.links.new(vt.outputs[0], flip.inputs[0])
        nt.links.new(flip.outputs[0], ma.inputs[0]); nt.links.new(ma.outputs[0], col)

    def dep(nt, col):
        cd = nt.nodes.new('ShaderNodeCameraData')
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = near, far
        nt.links.new(cd.outputs['View Z Depth'], mr.inputs['Value'])
        comb = nt.nodes.new('ShaderNodeCombineXYZ')
        for i in range(3):
            nt.links.new(mr.outputs['Result'], comb.inputs[i])
        nt.links.new(comb.outputs[0], col)

    return {'id': _mat('PxID', idm), 'nrm': _mat('PxNrm', nrm), 'dep': _mat('PxDep', dep)}


def render_setup(W, H, ss):
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.eevee.taa_render_samples = 1
    sc.render.filter_size = 0                   # no pixel filter: every pixel is one exact sample
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W * ss, H * ss, 100
    vt = [i.identifier for i in sc.view_settings.bl_rna.properties['view_transform'].enum_items]
    sc.view_settings.view_transform = 'Raw' if 'Raw' in vt else 'Standard'
    sc.view_settings.look, sc.view_settings.exposure, sc.view_settings.gamma = 'None', 0, 1
    s = sc.render.image_settings
    s.file_format, s.color_mode, s.color_depth = 'PNG', 'RGBA', '16'
    for attr in ('use_compositing', 'use_sequencer'):
        if hasattr(sc.render, attr):
            setattr(sc.render, attr, False)
    return sc.view_settings.view_transform


def bones2d(arm, cam, px, W, H, ky=1.0):
    """Pose bone head/tail in sprite pixel coordinates (for the bone overlay on the review page). ky: the vertical
    pixel scale of a render view (a pixel row covers px / ky m along the camera's up)."""
    M = cam.rotation_euler.to_matrix()
    right, up = M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0))
    to = lambda p: [round((p - cam.location).dot(right) / px + W / 2, 2), round(H / 2 - (p - cam.location).dot(up) * ky / px, 2)]
    return {pb.name: to(arm.matrix_world @ pb.head) + to(arm.matrix_world @ pb.tail) for pb in arm.pose.bones}


# A RENDER VIEW (optional, per pose): the model's render_view(pose) -> {'pitch': deg, 'lift': px} or None. That pose is
# rendered through an ortho camera at that pitch whose pixel rows are scaled (pixel aspect) so heights keep the atlas
# pitch's px per metre (cos(atlas pitch) / units_per_px): only the ground's foreshortening changes. At pitch
# atan(sin 55 / cos 20) = 41.08 deg the image IS the game's oblique projection (src/main.js: PPMH = PPM cos 20, PPMY =
# PPM sin 55), so a body lying on the ground covers the ground it lies on in the game. The normal pass stays in the
# ATLAS camera's basis (the game converts normals with the 20 deg frame), the depth pass gets its own box (meta near /
# far of that pose), `lift` moves the image up by whole px (the camera down: depth unchanged). Bones in meta follow the
# view. Poses without a view render exactly as before.
def view_setup(cam, base, view, W, H, pivot, px):
    """Point the camera for a render view; returns (ky, near, far). base = (rotation, location, off, pitch, yaw)."""
    p, y = math.radians(view['pitch']), math.radians(base[4])
    ky = math.cos(math.radians(base[3])) / math.cos(p)
    off = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.rotation_euler = (-off).to_track_quat('-Z', 'Y').to_euler()
    M = cam.rotation_euler.to_matrix()
    right, up = M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0))
    cx, cy = pivot[0] + .5 - W / 2, H / 2 - (pivot[1] + .5) + view.get('lift', 0)
    cam.location = -(right * cx * px + up * cy * px / ky) + off * 50
    bpy.context.scene.render.pixel_aspect_x, bpy.context.scene.render.pixel_aspect_y = ky, 1
    half = view.get('depth', 2.2)
    return ky, 50 - half, 50 + half


def view_reset(cam, base):
    cam.rotation_euler, cam.location = base[0].copy(), base[1].copy()
    bpy.context.scene.render.pixel_aspect_x = bpy.context.scene.render.pixel_aspect_y = 1


def view_materials(mats, base, near, far):
    """The pass materials for a render view: the normal in the atlas camera's basis (x right, y up, z toward the
    viewer of the atlas camera, from the world normal: independent of the camera rendering it), the depth mapped onto
    this view's box (the shared depth material's range, set per pose)."""
    if 'nrm_atlas' not in mats:
        M = base[0].to_matrix()
        axes = (M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0)), M @ Vector((0, 0, 1)))   # right, up, back (toward the viewer)

        def nrm(nt, col):
            geo = nt.nodes.new('ShaderNodeNewGeometry')
            comb = nt.nodes.new('ShaderNodeCombineXYZ')
            for i, a in enumerate(axes):
                dp = nt.nodes.new('ShaderNodeVectorMath'); dp.operation = 'DOT_PRODUCT'; dp.inputs[1].default_value = tuple(a)
                nt.links.new(geo.outputs['Normal'], dp.inputs[0]); nt.links.new(dp.outputs['Value'], comb.inputs[i])
            ma = nt.nodes.new('ShaderNodeVectorMath'); ma.operation = 'MULTIPLY_ADD'
            ma.inputs[1].default_value = (.5, .5, .5); ma.inputs[2].default_value = (.5, .5, .5)
            nt.links.new(comb.outputs[0], ma.inputs[0]); nt.links.new(ma.outputs[0], col)
        mats['nrm_atlas'] = _mat('PxNrmAtlas', nrm)
    mr = next(n for n in mats['dep'].node_tree.nodes if n.type == 'MAP_RANGE')
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = near, far
    return {'id': mats['id'], 'nrm': mats['nrm_atlas'], 'dep': mats['dep']}


def render_dirs(root, mats, out, cam=None, px=None, W=0, H=0, ky=1.0):
    sc, vl = bpy.context.scene, bpy.context.view_layer
    bones = {}
    for k, d in enumerate(DIRS):
        root.rotation_euler = (0, 0, math.radians(yaw_of(k)))
        bpy.context.view_layer.update()
        if root.type == 'ARMATURE':
            bones[d] = bones2d(root, cam, px, W, H, ky)
        for tag, m in mats.items():
            vl.material_override = m
            sc.render.filepath = os.path.join(out, f'{d}_{tag}.png')
            bpy.ops.render.render(write_still=True)
    vl.material_override = None
    root.rotation_euler = (0, 0, 0)
    return bones


def atlas_depth_box(out, near, far):
    """--append: the depth box (near, far) the atlas's frames already use, the most common one over their meta.json,
    so the appended frames' depth pass is encoded alike and poses.json's atlas-wide cam (the runtime cloth reads it for
    every frame) stays right. A run fitted on its own first pose would write a box that differs by up to ~0.3 m."""
    from collections import Counter
    pj = os.path.join(out, 'poses.json')
    if not os.path.exists(pj):
        return near, far
    box = Counter()
    for p in json.load(open(pj))['poses']:
        f = os.path.join(out, p, 'meta.json')
        if os.path.exists(f):
            m = json.load(open(f))
            if 'view' not in m:              # (a render view's frame has its own box)
                box[(m['near'], m['far'])] += 1
    if not box:
        return near, far
    (n, f), cnt = box.most_common(1)[0]
    print(f'append: depth box of {cnt}/{sum(box.values())} atlas frames {n:.4f}..{f:.4f} (this run fitted {near:.4f}..{far:.4f})')
    return n, f


def run(model, out, W=48, H=64, ss=4, fig=58, pivot=None, yaw=45, pitch=20, poses=None, clips=None, upp=None, append=False):
    """Without poses: renders the model as built into `out`. With poses (the model defines pose(name)): the scale
    is fitted once on the first pose, then every pose renders into out/<pose>/ at that same scale."""
    model, out = os.path.abspath(model), os.path.abspath(out)
    pivot = tuple(pivot) if pivot else (W // 2, H - 2)   # feet at the bottom centre of the canvas
    os.makedirs(out, exist_ok=True)
    root, meshes, ns = load_model(model)
    if clips:  # animation clips defined by the model -> one pose per frame ('walk.0', 'walk.1', ...)
        poses = (poses or []) + ns['clip_frames'](*clips)
    for i, ob in enumerate(meshes):
        ob.pass_index = i + 1
    cam, off = camera(yaw, pitch)
    if poses:
        ns['pose'](poses[0])
    px, near, far = fit(cam, off, root, meshes, W, H, fig, pivot, depth_margin=.6 if poses else .05, upp=upp)
    if append and poses:
        near, far = atlas_depth_box(out, near, far)
    vt = render_setup(W, H, ss)
    mats = pass_materials(near, far)
    meta = {'w': W, 'h': H, 'ss': ss, 'pivot': list(pivot), 'fig': fig, 'yaw': yaw, 'pitch': pitch,
            'units_per_px': px, 'near': near, 'far': far, 'view_transform': vt, 'dirs': DIRS,
            'model': os.path.basename(model), 'objects': {str(i + 1): ob.name for i, ob in enumerate(meshes)}}
    if 'PIXEL' in ns:
        meta['parts'] = ns['PIXEL']
    if 'PROP' in ns:
        meta['proportions'] = ns['PROP']
    if ns.get('PIXEL_FAMILIES'):
        meta['families'] = ns['PIXEL_FAMILIES']
    base = (cam.rotation_euler.copy(), cam.location.copy(), off.copy(), pitch, yaw)
    for pz in poses or [None]:
        d = os.path.join(out, pz) if pz else out
        os.makedirs(d, exist_ok=True)
        if pz:
            ns['pose'](pz)
        sim = ns['sim_frame']() if 'sim_frame' in ns else None   # runtime cloth: pins + colliders at facing yaw 0
        view = ns['render_view'](pz) if pz and 'render_view' in ns else None
        if view:
            ky, vnear, vfar = view_setup(cam, base, view, W, H, pivot, px)
            bones = render_dirs(root, view_materials(mats, base, vnear, vfar), d, cam, px, W, H, ky)
            view_materials(mats, base, near, far)          # (the shared depth material back to the atlas box)
            view_reset(cam, base)
        else:
            bones = render_dirs(root, mats, d, cam, px, W, H)
        m = dict(meta, pose=pz, bones=bones) if bones else dict(meta)
        if view:
            m.update(near=vnear, far=vfar, view={'pitch': round(view['pitch'], 3), 'lift': view.get('lift', 0), 'ky': round(ky, 5)})
        if sim:
            m['sim'] = sim
        if pz and pz in ns.get('POSE_INFO', {}):
            m['contact'] = ns['POSE_INFO'][pz]
        json.dump(m, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
    if poses:
        old = json.load(open(os.path.join(out, 'poses.json'))) if append and os.path.exists(os.path.join(out, 'poses.json')) else None
        # screen pixels per metre of ground travel along each facing: x right, y down (y is foreshortened by the pitch)
        M = cam.rotation_euler.to_matrix()
        right, up = M @ Vector((1, 0, 0)), M @ Vector((0, 1, 0))
        fwd = {}
        for k, d in enumerate(DIRS):
            a = math.radians(yaw_of(k))
            f = Vector((math.sin(a), -math.cos(a), 0))  # the character's -Y forward after the facing turn
            fwd[d] = [round(f.dot(right) / px, 3), round(-f.dot(up) / px, 3)]
        clips_new = ns['clips_meta']() if 'clips_meta' in ns else {}
        if old:  # --append: merge into the existing atlas (same scale / canvas / facings expected)
            poses = old['poses'] + [p for p in poses if p not in old['poses']]
            clips_new = {**old.get('clips', {}), **clips_new}
        json.dump({'poses': poses, **{k: meta[k] for k in ('w', 'h', 'pivot', 'units_per_px', 'model', 'pitch')},
                   'proportions': meta.get('proportions'), 'fwd_px': fwd, 'dirs': DIRS,
                   'cam': {'yaw': yaw, 'yaw0': yaw_of(0), 'near': near, 'far': far},   # to project runtime cloth like the render
                   'sim': ns['sim_rest']() if 'sim_rest' in ns else None,
                   'clips': clips_new},
                  open(os.path.join(out, 'poses.json'), 'w'), indent=1)
    return meta


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(zip(argv[::2], argv[1::2]))
    if a.get('--dirs') == '16':
        DIRS = DIRS16
    m = run(a.get('--model', 'tools/blender/ranger_v4.py'), a.get('--out', 'concepts/sprites/out/render'),
            W=int(a.get('--w', 48)), H=int(a.get('--h', 64)), ss=int(a.get('--ss', 4)), fig=float(a.get('--fig', 58)),
            yaw=float(a.get('--yaw', 45)), pitch=float(a.get('--pitch', 20)),  # 20° locked 2026-09-30
            poses=a['--poses'].split(',') if '--poses' in a else None,
            clips=a['--clips'].split(',') if '--clips' in a else None, upp=float(a['--upp']) if '--upp' in a else None,
            pivot=[int(v) for v in a['--pivot'].split(',')] if '--pivot' in a else None, append=a.get('--append') == '1')
    print('PIXEL_RIG_OK', json.dumps({k: m[k] for k in ('units_per_px', 'view_transform')}))
