# 3D PROP KIT -> glTF: the props3d.py builders exported as live meshes for the Three.js world test (free camera).
# One .glb per prop state, true geometry (no project() shear), metres, origin = the prop's ground point.
# Every Blender object (plank, stave, block, drum, ...) stays its own mesh node (node name = object name) so the
# renderer keeps part boundaries for seam lines. Faces stay flat (split per-face normals). Each part's material is
# named "<family>|<PartBase>|<bias>|<flags>" from props3d.PARTS (flags: thin, noseam, fixedN).
# glTF is +Y up: x = east, y = up, z = south (Blender -Y, toward the old camera).
#
# Headless:  D:\Blender\blender.exe -b --factory-startup --python tools/blender/props3d_glb.py -- \
#              [--only crate,wall_ew_0] [--out concepts/sprites/out/render3d/glb]
# Writes <out>/<state>.glb + <out>/index.json.
import bpy, json, os, sys
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
P3 = {'__name__': 'props3d_glb_lib', '__file__': os.path.join(HERE, 'props3d.py')}
exec(open(os.path.join(HERE, 'props3d.py'), encoding='utf-8').read(), P3)
PARTS, COL = P3['PARTS'], P3['COL']

# every state of the kit except the barrel tilt / roll frames (the 3D world tips and rolls the barrel mesh itself):
# intact / damaged / broken stages, the chest's 5 lid angles, the debris chunks
STATES = [s for st in P3['groups']().values() for s, _ in st if '_tilt_' not in s and '_roll_' not in s]


def mat_name(base):
    fam, o = PARTS[base]
    flags = (['thin'] if o.get('thin') else []) + (['noseam'] if o.get('seam') is False else []) + \
            ([f"fixed{o['fixed']}"] if 'fixed' in o else [])
    return f"{fam}|{base}|{o.get('bias', 0):g}|{','.join(flags)}"


def material(base):
    name = mat_name(base)
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.diffuse_color = (.5, .5, .5, 1)
    try:
        m.use_nodes = True
    except Exception:
        pass
    if m.node_tree:
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                n.inputs['Base Color'].default_value = (.5, .5, .5, 1)
                n.inputs['Roughness'].default_value = 1.0
    return m


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    col = bpy.data.collections.get(COL) or bpy.data.collections.new(COL)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)


def bake(obs):
    """Apply object transforms into the mesh data (pillar drums carry a rotation, barrels a squat scale)."""
    bpy.context.view_layer.update()
    for ob in obs:
        ob.data.transform(ob.matrix_world)
        ob.matrix_world = Matrix.Identity(4)
        ob.data.update()
        for f in ob.data.polygons:
            f.use_smooth = False
    bpy.context.view_layer.update()


def export(state, build, out):
    reset()
    obs = [o for o in build() if o]
    bake(obs)
    for ob in obs:
        base = ob.name.split('.')[0]
        ob.data.materials.clear()
        ob.data.materials.append(material(base))
    xs, ys, zs = [], [], []
    for ob in obs:
        for v in ob.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    # Blender (x, y, z) -> glTF (x, z, -y)
    bnd = [min(xs), min(zs), -max(ys), max(xs), max(zs), -min(ys)]
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    fn = os.path.join(out, f'{state}.glb')
    bpy.ops.export_scene.gltf(filepath=fn, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_normals=True, export_texcoords=False, export_tangents=False, export_materials='EXPORT',
                              export_vertex_color='NONE', export_attributes=False, export_animations=False, export_skins=False,
                              export_morph=False, export_cameras=False, export_lights=False, export_extras=False)
    print('GLB', state, len(obs), [round(b, 3) for b in bnd], flush=True)
    return {'file': f'{state}.glb', 'parts': len(obs), 'bounds': [round(b, 5) for b in bnd]}


def main(out, only=None):
    os.makedirs(out, exist_ok=True)
    builders = {s: b for st in P3['groups']().values() for s, b in st}
    idx_path = os.path.join(out, 'index.json')
    states = {}
    if only and os.path.exists(idx_path):
        states = json.load(open(idx_path)).get('states', {})
    for s in STATES:
        if only and s not in only:
            continue
        states[s] = export(s, builders[s], out)
    json.dump({'states': {s: states[s] for s in STATES if s in states}, 'parts': PARTS,
               'materials': 'name = family|PartBase|bias|flags (flags: thin, noseam, fixedN)',
               'axes': 'x east, y up, z south, metres; origin = ground point'}, open(idx_path, 'w'), indent=1)
    return states


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(zip(argv[::2], argv[1::2]))
    out = os.path.abspath(a.get('--out', os.path.join(HERE, '..', '..', 'concepts', 'sprites', 'out', 'render3d', 'glb')))
    st = main(out, a['--only'].split(',') if '--only' in a else None)
    print('PROPS3D_GLB_OK', len(st))
