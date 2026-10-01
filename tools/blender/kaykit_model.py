# Model module for pixel_rig.py / pixel_rig_tex.py: a KayKit character (CC0, Kay Lousberg, assets/kaykit) imported
# from its glTF and posed from its own animation clips. Pose names: '<clip>.<i>' (see CLIPS), sampled evenly over
# the clip. Env: KAYKIT_GLB (model), KAYKIT_SHOW (comma list of extra meshes to show, e.g. 2H_Crossbow).
import bpy, os

KK = r'D:/Game/assets/kaykit/addons/kaykit_character_pack_adventures'
GLB = os.environ.get('KAYKIT_GLB', KK + '/Characters/gltf/Rogue_Hooded.glb')
TEXTURE = KK + '/Characters/gltf/rogue_texture.png'
COL, ROOT = 'KayKit', 'Rig'
WEAPONS = ('1H_Crossbow', '2H_Crossbow', 'Knife', 'Knife_Offhand', 'Throwable', 'Icosphere')
SHOW = [s for s in os.environ.get('KAYKIT_SHOW', '').split(',') if s]
WIELD = {'shoot': '2H_Crossbow'}   # clip -> weapon mesh shown only while that clip renders
# clip -> (KayKit action, frames rendered, loop)
CLIPS = {'idle': ('Idle', 8, True), 'walk': ('Walking_A', 8, True), 'run': ('Running_A', 8, True),
         'shoot': ('2H_Ranged_Shoot', 6, False), 'dodge': ('Dodge_Forward', 6, False)}


def build():
    for o in list(bpy.data.objects):          # factory startup scene: cube, camera, light
        bpy.data.objects.remove(o)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=GLB)
    col = bpy.data.collections.new(COL)
    bpy.context.scene.collection.children.link(col)
    for o in set(bpy.data.objects) - before:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        col.objects.link(o)
        if o.type == 'MESH' and o.name.split('.')[0] in WEAPONS and o.name.split('.')[0] not in SHOW + list(WIELD.values()):
            o.hide_render = True
    rig = bpy.data.objects[ROOT]
    rig.location = (0, 0, 0)
    rig.rotation_mode = 'XYZ'


def pose(name):
    clip, i = name.rsplit('.', 1)
    act_name, n, loop = CLIPS[clip]
    rig = bpy.data.objects[ROOT]
    for w in set(WIELD.values()) - set(SHOW):
        bpy.data.objects[w].hide_render = WIELD.get(clip) != w
    act = bpy.data.actions[act_name]
    rig.animation_data_create()
    rig.animation_data.action = act
    if getattr(act, 'slots', None) and len(act.slots) and hasattr(rig.animation_data, 'action_slot'):
        rig.animation_data.action_slot = act.slots[0]
    a, b = act.frame_range
    t = int(i) / (n if loop else max(1, n - 1))           # loops skip the last frame (it equals the first)
    bpy.context.scene.frame_set(int(round(a + (b - a) * t)))
    bpy.context.view_layer.update()


def clip_frames(*clips):
    return [f'{c}.{i}' for c in clips for i in range(CLIPS[c][1])]


def clips_meta():
    return {c: {'frames': CLIPS[c][1], 'fps': {'idle': 6, 'walk': 10, 'run': 13}.get(c, 12), 'loop': CLIPS[c][2]}
            for c in CLIPS}
