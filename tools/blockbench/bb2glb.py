# Convert a Blockbench .bbmodel (free format: cubes + groups, one texture) to a .glb for the game.
# Groups become nodes (pivot = group origin, so they can be animated later); cubes become meshes under them.
# Units: 16 Blockbench units = 1 game unit. The texture keeps nearest filtering (pixel art).
#   python tools/blockbench/bb2glb.py assets/src/ranger.bbmodel assets/chars/ranger_bb.glb
import base64, json, math, struct, sys

S = 1 / 16
# face -> (corners [top-left, top-right, bottom-right, bottom-left] as seen from outside, normal)
FACES = {
    'north': (lambda a, b: [(b[0], b[1], a[2]), (a[0], b[1], a[2]), (a[0], a[1], a[2]), (b[0], a[1], a[2])], (0, 0, -1)),
    'south': (lambda a, b: [(a[0], b[1], b[2]), (b[0], b[1], b[2]), (b[0], a[1], b[2]), (a[0], a[1], b[2])], (0, 0, 1)),
    'east': (lambda a, b: [(b[0], b[1], b[2]), (b[0], b[1], a[2]), (b[0], a[1], a[2]), (b[0], a[1], b[2])], (1, 0, 0)),
    'west': (lambda a, b: [(a[0], b[1], a[2]), (a[0], b[1], b[2]), (a[0], a[1], b[2]), (a[0], a[1], a[2])], (-1, 0, 0)),
    'up': (lambda a, b: [(a[0], b[1], a[2]), (b[0], b[1], a[2]), (b[0], b[1], b[2]), (a[0], b[1], b[2])], (0, 1, 0)),
    'down': (lambda a, b: [(a[0], a[1], b[2]), (b[0], a[1], b[2]), (b[0], a[1], a[2]), (a[0], a[1], a[2])], (0, -1, 0)),
}


def rot(p, r, o):
    """Rotate point p about o by Blockbench euler degrees r (X, then Y, then Z)."""
    x, y, z = (p[i] - o[i] for i in range(3))
    ax, ay, az = (math.radians(v) for v in r)
    y, z = y * math.cos(ax) - z * math.sin(ax), y * math.sin(ax) + z * math.cos(ax)
    x, z = x * math.cos(ay) + z * math.sin(ay), -x * math.sin(ay) + z * math.cos(ay)
    x, y = x * math.cos(az) - y * math.sin(az), x * math.sin(az) + y * math.cos(az)
    return (x + o[0], y + o[1], z + o[2])


def convert(src, dst):
    m = json.load(open(src, encoding='utf-8'))
    W, H = m['resolution']['width'], m['resolution']['height']
    els = {e['uuid']: e for e in m['elements'] if e.get('type', 'cube') == 'cube'}
    png = base64.b64decode(m['textures'][0]['source'].split(',', 1)[1])
    nodes, meshes, views, accs = [], [], [], []
    blob = bytearray()

    def pad():
        while len(blob) % 4:
            blob.append(0)

    def add(data, fmt, typ, target, mm=None):
        pad()
        off = len(blob)
        blob.extend(struct.pack('<' + fmt * len(data), *data))
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(blob) - off, 'target': target})
        a = {'bufferView': len(views) - 1, 'componentType': 5126 if fmt == 'f' else 5125,
             'count': len(data) // {'VEC3': 3, 'VEC2': 2, 'SCALAR': 1}[typ], 'type': typ}
        if mm:
            a['min'], a['max'] = mm
        accs.append(a)
        return len(accs) - 1

    def cube_mesh(e, pivot):
        P, N, U, I = [], [], [], []
        r, o = e.get('rotation', [0, 0, 0]), e.get('origin', [0, 0, 0])
        for f, (pick, n) in FACES.items():
            fc = e['faces'].get(f)
            if not fc or fc.get('texture') is None:
                continue
            u0, v0, u1, v1 = fc['uv']
            base = len(P) // 3
            nn = rot(n, r, (0, 0, 0))
            for c, (u, v) in zip(pick(e['from'], e['to']), ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                q = rot(c, r, o)
                P += [(q[i] - pivot[i]) * S for i in range(3)]
                N += list(nn)
                U += [u / W, v / H]
            I += [base, base + 2, base + 1, base, base + 3, base + 2]
        mm = ([min(P[i::3]) for i in range(3)], [max(P[i::3]) for i in range(3)])
        prim = {'attributes': {'POSITION': add(P, 'f', 'VEC3', 34962, mm), 'NORMAL': add(N, 'f', 'VEC3', 34962),
                               'TEXCOORD_0': add(U, 'f', 'VEC2', 34962)},
                'indices': add(I, 'I', 'SCALAR', 34963), 'material': 0}
        meshes.append({'name': e['name'], 'primitives': [prim]})
        return len(meshes) - 1

    def leaf(uid, pivot):
        nodes.append({'name': els[uid]['name'], 'mesh': cube_mesh(els[uid], pivot)})
        return len(nodes) - 1

    def group(g, parent_origin):
        o = g['origin']
        node = {'name': g['name'], 'translation': [(o[i] - parent_origin[i]) * S for i in range(3)], 'children': []}
        nodes.append(node)
        idx = len(nodes) - 1
        for c in g['children']:
            if isinstance(c, str):
                if c in els and els[c].get('visibility', True) is not False:
                    node['children'].append(leaf(c, o))
            else:
                node['children'].append(group(c, o))
        if not node['children']:
            del node['children']
        return idx

    roots = [group(c, [0, 0, 0]) if isinstance(c, dict) else leaf(c, [0, 0, 0]) for c in m['outliner'] if isinstance(c, dict) or c in els]
    pad()
    off = len(blob)
    blob.extend(png)
    views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(png)})
    pad()
    gltf = {'asset': {'version': '2.0', 'generator': 'riftbound bb2glb'}, 'scene': 0, 'scenes': [{'nodes': roots}],
            'nodes': nodes, 'meshes': meshes,
            'materials': [{'name': m['textures'][0]['name'], 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1}}],
            'textures': [{'sampler': 0, 'source': 0}], 'samplers': [{'magFilter': 9728, 'minFilter': 9728}],
            'images': [{'bufferView': len(views) - 1, 'mimeType': 'image/png'}],
            'buffers': [{'byteLength': len(blob)}], 'bufferViews': views, 'accessors': accs}
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    with open(dst, 'wb') as fh:
        fh.write(out)
    return dst, len(meshes)


if __name__ == '__main__':
    print(convert(sys.argv[1], sys.argv[2]))
