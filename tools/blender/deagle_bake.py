# blender -b -P tools/blender/deagle_bake.py -- <src.glb> <dst.glb> <length m> <decimate ratio> <texture px>
# The golden Desert Eagle as a held prop: one decimated mesh in the live hero's gun-bone frame (Blender axes, Z up,
# exported Z-up): the muzzle toward -Y, the top of the slide +Z, the grip's palm point at the origin, `length` m long.
# golden_deagle.glb: <the Tripo export pistol_higgsfield_tripo.glb> assets/deagle/golden_deagle.glb 0.30 0.012 1024
import bpy, sys
from mathutils import Vector, Matrix

src, dst, length, ratio, tpx = sys.argv[sys.argv.index('--') + 1:]
length, ratio, tpx = float(length), float(ratio), int(tpx)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in obs:
    o.select_set(True)
bpy.context.view_layer.objects.active = obs[0]
if len(obs) > 1:
    bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o is not ob:
        bpy.data.objects.remove(o, do_unlink=True)

dec = ob.modifiers.new('dec', 'DECIMATE')
dec.decimate_type = 'COLLAPSE'
dec.ratio = ratio
bpy.ops.object.modifier_apply(modifier='dec')

V = [ob.matrix_world @ v.co for v in ob.data.vertices]
lo = Vector((min(v.x for v in V), min(v.y for v in V), min(v.z for v in V)))
hi = Vector((max(v.x for v in V), max(v.y for v in V), max(v.z for v in V)))
size = hi - lo
print('bounds', tuple(round(c, 3) for c in lo), tuple(round(c, 3) for c in hi))
# the long axis must be Y (the barrel), up Z: the importer turns glTF's +Z muzzle / +Y up into Blender's -Y / +Z
assert size.y >= size.z >= size.x, size
# the grip is the low part: whichever end of Y holds the low vertices is the rear; the muzzle goes to -Y
low = [v for v in V if v.z < lo.z + .3 * size.z]
gy = sum(v.y for v in low) / len(low)
if gy < (lo.y + hi.y) / 2:   # the grip sits at -Y: turn the gun half round about Z
    R = Matrix.Rotation(3.141592653589793, 4, 'Z')
    ob.data.transform(R)
    V = [R @ v for v in V]
    lo = Vector((min(v.x for v in V), min(v.y for v in V), min(v.z for v in V)))
    hi = Vector((max(v.x for v in V), max(v.y for v in V), max(v.z for v in V)))
    print('turned: the muzzle was at +Y')
# the palm point: the middle of the grip (the rear third), half way up the gun's height
band = [v for v in V if lo.z + .3 * size.z < v.z < lo.z + .55 * size.z and v.y > hi.y - .38 * size.y]
grip = Vector((sum(v.x for v in band) / len(band), sum(v.y for v in band) / len(band), lo.z + .45 * size.z))
print('grip', tuple(round(c, 3) for c in grip), 'band', len(band))
s = length / size.y
ob.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-grip))
ob.data.update()

for img in bpy.data.images:
    if img.size[0] > tpx:
        img.scale(tpx, tpx)
        print('image', img.name, '->', tpx)

print('tris', sum(len(p.vertices) - 2 for p in ob.data.polygons))
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=False, export_image_format='JPEG',
                          export_jpeg_quality=88, export_apply=True, export_animations=False, export_cameras=False,
                          export_lights=False, export_tangents=False)
print('wrote', dst)
