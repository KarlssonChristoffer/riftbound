# 3D PROP KIT at 16 yaws: the props3d.py renders (same camera, scale, 'world' projection, passes) of a few props turned
# about the vertical axis through their ground point, for the free-camera world test. Yaw k = the prop turned
# k * 22.5 deg counter-clockwise seen from above (= the camera orbited clockwise); k = 0 is the current render.
# Each yaw is its own group (own canvas + pivot) and its own state, both named "<state>_y<k>", so props_pixelize.py
# packs them as frames crate_y0..crate_y15 etc.
#
# Headless:  D:\Blender\blender.exe -b --factory-startup --python tools/blender/props3d_yaw.py -- \
#              [--states crate,barrel] [--yaws 16] [--out concepts/sprites/out/render3d/props_yaw]
# then:      python concepts/sprites/props_pixelize.py concepts/sprites/out/render3d/props_yaw
import bpy, math, os, sys
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
P3 = {'__name__': 'props3d_yaw_lib', '__file__': os.path.join(HERE, 'props3d.py')}
exec(open(os.path.join(HERE, 'props3d.py'), encoding='utf-8').read(), P3)

STATES = ['crate', 'barrel', 'pillar', 'tower', 'wall_ew_0', 'rock_big_0']
_orig_groups = P3['groups']


def turned(build, deg):
    """Build, then bake a yaw about world Z (through the ground point) into the meshes; project() follows in run()."""
    def b():
        obs = [o for o in build() if o]
        bpy.context.view_layer.update()   # pick up rotation_euler set inside builders (pillar drums)
        R = Matrix.Rotation(math.radians(deg), 4, 'Z')
        for ob in obs:
            ob.data.transform(R @ ob.matrix_world)
            ob.matrix_world = Matrix.Identity(4)
            ob.data.update()
        bpy.context.view_layer.update()
        return obs
    return b


def yaw_groups(states, n):
    builders = {s: b for st in _orig_groups().values() for s, b in st}
    G = {}
    for s in states:
        for k in range(n):
            G[f'{s}_y{k}'] = [(f'{s}_y{k}', turned(builders[s], 360 / n * k))]
    return G


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(zip(argv[::2], argv[1::2]))
    states = a['--states'].split(',') if '--states' in a else STATES
    n = int(a.get('--yaws', 16))
    out = os.path.abspath(a.get('--out', os.path.join(HERE, '..', '..', 'concepts', 'sprites', 'out', 'render3d', 'props_yaw')))
    P3['groups'] = lambda: yaw_groups(states, n)   # run() looks groups() up in the exec'd namespace
    idx = P3['run'](out)
    print('PROPS3D_YAW_OK', len(idx))
