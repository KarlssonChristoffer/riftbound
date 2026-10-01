# pixel_rig.py plus one extra pass for textured models (the KayKit test): <dir>_sw.png = the texture-atlas swatch
# under each pixel (R = (col + row * 8 + 1) / 255 on an 8x4 swatch grid, Blender UV space). Everything else
# (camera, fit, ID/normal/depth passes, poses.json) is pixel_rig.py unchanged.
#   D:\Blender\blender.exe -b --factory-startup --python tools/blender/pixel_rig_tex.py -- \
#     --model tools/blender/kaykit_model.py --out concepts/sprites/out/pro_test/kaykit --clips idle,walk,run --w 96 --h 80 --fig 55
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ns = {'__name__': 'pixel_rig_lib'}
exec(open(os.path.join(HERE, 'pixel_rig.py'), encoding='utf-8').read(), ns)
_orig = ns['pass_materials']
GRID = (8, 4)


def _sw(nt, col):
    uv = nt.nodes.new('ShaderNodeUVMap')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(uv.outputs['UV'], sep.inputs[0])
    def cell(sock, n):  # floor(clamp(v) * n)
        m = nt.nodes.new('ShaderNodeMath'); m.operation = 'MULTIPLY'; m.inputs[1].default_value = n * .99999
        c = nt.nodes.new('ShaderNodeMath'); c.operation = 'FRACT'
        nt.links.new(sock, c.inputs[0]); nt.links.new(c.outputs[0], m.inputs[0])
        f = nt.nodes.new('ShaderNodeMath'); f.operation = 'FLOOR'
        nt.links.new(m.outputs[0], f.inputs[0])
        return f.outputs[0]
    cx, cy = cell(sep.outputs['X'], GRID[0]), cell(sep.outputs['Y'], GRID[1])
    row = nt.nodes.new('ShaderNodeMath'); row.operation = 'MULTIPLY_ADD'
    row.inputs[1].default_value = GRID[0]
    nt.links.new(cy, row.inputs[0]); nt.links.new(cx, row.inputs[2])
    one = nt.nodes.new('ShaderNodeMath'); one.operation = 'ADD'; one.inputs[1].default_value = 1
    nt.links.new(row.outputs[0], one.inputs[0])
    div = nt.nodes.new('ShaderNodeMath'); div.operation = 'DIVIDE'; div.inputs[1].default_value = 255
    nt.links.new(one.outputs[0], div.inputs[0])
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(div.outputs[0], comb.inputs[0])
    nt.links.new(comb.outputs[0], col)


def pass_materials(near, far):
    m = _orig(near, far)
    m['sw'] = ns['_mat']('PxSw', _sw)
    return m


ns['pass_materials'] = pass_materials

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(zip(argv[::2], argv[1::2]))
    if a.get('--dirs') == '16':
        ns['DIRS'] = ns['DIRS16']
    out = a['--out']
    ns['run'](a['--model'], out, W=int(a.get('--w', 96)), H=int(a.get('--h', 80)), ss=int(a.get('--ss', 4)),
              fig=float(a.get('--fig', 55)), pitch=float(a.get('--pitch', 20)),
              poses=a['--poses'].split(',') if '--poses' in a else None,
              clips=a['--clips'].split(',') if '--clips' in a else None, upp=float(a['--upp']) if '--upp' in a else None,
              pivot=[int(v) for v in a['--pivot'].split(',')] if '--pivot' in a else None)
    model_ns = {'__name__': 'x'}
    exec(open(a['--model'], encoding='utf-8').read(), model_ns)
    pj = os.path.join(os.path.abspath(out), 'poses.json')
    j = json.load(open(pj)); j['texture'] = model_ns['TEXTURE']; json.dump(j, open(pj, 'w'), indent=1)
    print('PIXEL_RIG_TEX_OK')
