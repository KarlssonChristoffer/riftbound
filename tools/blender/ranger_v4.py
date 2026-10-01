# Ranger v4: the v1 chibi proportions (big head and hair mass, short body), now designed in colour from the start:
# a small flat palette with one warm saturated accent (red scarf and cape), a skin face with dark eye blocks,
# muted olive tunic, brown leather. Colour carries the read at 25-50 px; geometry only gives the chunky masses.
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_v4.py').read(), ns); ns['build']()
import bpy

exec(open(r'D:\Game\tools\blender\ranger_grey.py', encoding='utf-8').read())
COL = ROOT = 'RangerV4'
_build_v1 = build

PAL = {  # sRGB hex, converted to linear for Blender
    'Skin': 'e8b48a', 'Hair': '6b4630', 'Eye': '1c1410', 'Cape': '9b3228', 'Tunic': '6b7a4a', 'Belt': '3b2a1e',
    'Pants': '3a3430', 'Boots': '5a3a24', 'Wood': 'a0703c', 'String': 'd8d0c0', 'Leather': '6a4a30',
}
PARTS = [  # object name prefix -> palette colour
    ('HairLock', 'Hair'), ('Hair', 'Hair'), ('Fringe', 'Hair'), ('Head', 'Skin'), ('Neck', 'Skin'), ('Hand', 'Skin'), ('Eye', 'Eye'),
    ('Mantle', 'Cape'), ('Hood', 'Cape'), ('Cape', 'Cape'), ('Torso', 'Tunic'), ('Arm', 'Tunic'), ('Belt', 'Belt'),
    ('Leg', 'Pants'), ('Boot', 'Boots'), ('Foot', 'Boots'), ('BowString', 'String'), ('Bow', 'Wood'), ('Quiver', 'Leather'), ('Fletch', 'String'),
]


def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) for v in c) + (1,)


def build():
    for c in bpy.data.collections:  # show only this character
        if c.name != COL:
            for ob in c.objects:
                ob.hide_set(True)
                ob.hide_render = True
    names = _build_v1()
    # eyes: two dark blocks standing slightly proud of the face, tall enough to land as 1x2 pixels at game size
    for sfx, x in (('L', .10), ('R', -.10)):
        vertical(f'Eye.{sfx}', x, [(1.35, -.268, .036, .022), (1.47, -.268, .036, .022)], n=4, p=12)
    for k, h in PAL.items():
        m = bpy.data.materials.get('Pal' + k) or bpy.data.materials.new('Pal' + k)
        m.use_nodes = True
        bsdf = next(nd for nd in m.node_tree.nodes if nd.type == 'BSDF_PRINCIPLED')
        bsdf.inputs['Base Color'].default_value = lin(h)
        bsdf.inputs['Roughness'].default_value = .9
        m.diffuse_color = lin(h)
    for ob in bpy.data.collections[COL].objects:
        if ob.type != 'MESH':
            continue
        key = next((c for p, c in PARTS if ob.name.startswith(p)), None)
        if key:
            ob.data.materials.clear()
            ob.data.materials.append(bpy.data.materials['Pal' + key])
    return sorted(o.name for o in bpy.data.collections[COL].objects)
