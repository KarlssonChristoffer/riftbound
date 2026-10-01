# Ranger v5 = v4 plus face-read fixes found by comparing the pixel-rig render with the hand-made master
# (concepts/sprites/out/ranger_idle_master.png): at 48x64 the fringe hid the forehead and the mantle rode up over the
# mouth, so the face read as a masked bandit. The master keeps a wide open face with a scarf under the chin.
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_v5.py').read(), ns); ns['build']()
import bpy

exec(open(r'D:\Game\tools\blender\ranger_v4.py', encoding='utf-8').read())
COL = ROOT = 'RangerV5'
_build_v4 = build


def squash(name, pivot_z, k, dz=0.0):
    """Scale an object's vertices in z about pivot_z, then shift them."""
    for v in bpy.data.objects[name].data.vertices:
        v.co.z = pivot_z + (v.co.z - pivot_z) * k + dz


def build():
    names = _build_v4()
    squash('Mantle', .92, .45)          # mantle -> scarf: top 1.18 -> 1.04, ~5 px tall like the master's, chin free
    squash('Hood', 1.01, 1.0, -.13)     # rolled hood follows it down
    squash('Fringe', 1.66, .55)         # fringe bottom 1.44 -> 1.54: 2-3 px of forehead above the eyes
    return names
