# RAGDOLL EXPORT: a loadout as rigid per-bone segments for the game's live ragdoll (src/view/ragdoll.js draws and
# throws it at a gunman's death, src/render/rigmesh.js tones it with the pixelizer's rules). The sprites stay the
# truth of the look: this is the same Blender model the atlas is rendered from (pixel_rig.py load_model), cut the way
# the wardrobe already cuts it (every part bound 100% to one bone: skeleton.py, wardrobe.py), so each bone's parts are
# one rigid piece in that bone's rest frame; the gun (GunHold0) and the hat (HatHold0) are pieces of their own.
#
#   D:\Blender\blender.exe -b --factory-startup --python tools/blender/ragdoll_export.py -- \
#       --model tools/blender/loadouts/bandit.py --out D:/Game/concepts/sprites/out/ragdoll/bandit [--poses a,b,...]
#       [--atlas D:/Game/concepts/sprites/out/outfits/outlaw]   (every pose of that atlas, unless --poses, and its clips' timing)
#       [--clips cheer,wave]   (more clips of the model's own, every frame + its timing: clips no atlas has rendered, for the
#                               live hero only; western.py OUTLAW_EMOTES)
# (run from the repo root: a loadout execs tools/blender/western.py by a relative path)
#
# Writes <out>/model.json + <out>/model.bin:
#   model.bin   one record per triangle corner (20 bytes, little-endian): position float32 x3 (m, the segment's bone
#               frame, Blender axes: x his left, y back, z up at rest), normal int8 x3 (x 127, same frame), bias int8
#               (the part's lambert bias x 100), seg uint8 (index into json.segs), part uint8 (1.. json.parts),
#               family uint8 (index into json.families), flags uint8 (bits 0-2 fixed tone + 1, 0 = shaded; bit 3 no
#               exterior outline; bit 4 no interior lines; bit 5 thin)
#   model.json  segs [{bone, kind (body | gun | hat), first, count (corners), min, max (its box in the bone's frame)}], parts [names, 1-based in the bin],
#               families [{name, ramp: 6 x [r, g, b] (pixelize.py's harmonized ramp: hi, base, shade, line,
#               outline_shadow, outline_lit)}], bones {name: {parent, head, tail, rest: 4x4 row-major (world, the
#               armature at the origin facing -Y)}}, joints {landmark: [x, y, z]} (skeleton.py landmarks at rest),
#               poses {name: {bone: [qx, qy, qz, qw, tx, ty, tz]}} (each bone's WORLD matrix in that pose, posed by
#               the model's own pose() exactly as pixel_rig.py renders it: ground snap, gun in the hand or the
#               holster), hide {pose: [bone]} (a piece collapsed in that pose: scaled to nothing, as the outlaw's lasso
#               coil outside the lasso's keys; the poses carry no scale), meta (units_per_px, pivot, proportions, the
#               source loadout), clips (with --atlas: the atlas's poses.json clips as the game plays them: frames,
#               fps, loop, play, ms, marks, stride; with --clips, those clips' too; the live hero, view/livehero.js),
#               live [clip] (with --clips: the clips only the live model has; the live hero's emote demos)
import bpy, json, math, os, struct, sys
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, 'concepts', 'sprites'))
import palette_harm  # noqa: E402  (the pixelizer's ramps: the sprites' colours)

# the poses a death can start from (what the gunmen show: features/foes/look.js poseOf); a name the model lacks is skipped
POSES = (['gun_aim'] + [f'gun_aim_{t}' for t in ('m45', 'm34', 'm22', 'm11', 'p11', 'p22', 'p34', 'p45')]
         + ['idle.0', 'idle.4'] + [f'walk.{i}' for i in range(8)] + [f'run.{i}' for i in range(8)]
         + [f'gws_{t}_{i}' for t in ('m90', 'm45', '0', 'p45') for i in range(8)]
         + [f'gun_fire.{i}' for i in range(4)] + [f'gun_draw.{i}' for i in range(8)] + [f'gun_reload.{i}' for i in range(13)]
         + [f'gun_holster.{i}' for i in range(0, 13, 2)] + [f'hit_f.{i}' for i in range(5)] + [f'hit_b.{i}' for i in range(5)])
PIECE_BONE = {'GunHold0': 'gun', 'HatHold0': 'hat',   # bones whose parts fly loose, with every bone below them (the
              'CoilHold0': 'coil'}                    # coach gun's GunBreak0 + muzzle + breech fold in, barrels closed);
                                                      # the lasso's coil: its own piece, so a pose can hide it (hide)
SKIP_BONES = {'GunMuzzle0', 'GunShell0'}             # no parts, or dropped (the coach gun's fresh shell in the left fist)
STANDARD = {'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'} | {m + b for m in ('Left', 'Right') for b in
            ('Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase')}   # skeleton.py's bones


def piece_of(arm, bone):
    # the segment a bone's parts belong to: a skeleton bone or a loose piece's root itself, else its nearest such ancestor
    # (a garment's own chain rides its standard bone as at rest); None for a skipped bone
    b = arm.data.bones.get(bone)
    while b and b.name not in STANDARD and b.name not in PIECE_BONE:
        if b.name in SKIP_BONES:
            return None
        b = b.parent
    return b.name if b else None


def load_model(path):
    ns = {'__name__': 'ragdoll_model'}
    exec(open(path, encoding='utf-8').read(), ns)
    ns['build']()
    return bpy.data.objects[ns['ROOT']], ns


def mat_rows(M):
    return [round(M[i][j], 6) for i in range(4) for j in range(4)]


def run(model, out, poses, clips=None, more=()):
    os.makedirs(out, exist_ok=True)
    arm, ns = load_model(os.path.abspath(model))
    poses = list(poses) + [f'{c}.{i}' for c in more for i in range(ns['ANIMS'][c]['frames'])]
    W = arm.matrix_world.copy()
    table = ns['PIXEL']
    fams_src = dict(json.load(open(os.path.join(REPO, 'concepts', 'sprites', 'out', 'ranger_master_layers.json')))['families']) \
        if os.path.exists(os.path.join(REPO, 'concepts', 'sprites', 'out', 'ranger_master_layers.json')) else {}
    if not fams_src:   # (the master's families live in the main checkout's git-ignored out/)
        fams_src = json.load(open(r'D:\Game\concepts\sprites\out\ranger_master_layers.json'))['families']
    fams_src.update(ns.get('PIXEL_FAMILIES', {}))

    # ---- the rest pose: every visible part's triangles in its bone's rest frame
    arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    segs, seg_ix = [], {}
    parts, part_ix, fams, fam_ix = [], {}, [], {}
    recs = {}   # seg index -> bytearray
    for ob in sorted(bpy.data.collections[ns['COL']].objects, key=lambda o: o.name):
        if ob.type != 'MESH' or ob.hide_render:
            continue
        base, side = ob.name.split('.')[0], (ob.name.split('.')[1] if '.' in ob.name else '')
        if base not in table:
            print('RAGDOLL skip (no pixel entry)', ob.name)
            continue
        groups = {g.index: g.name for g in ob.vertex_groups}
        bone = None
        for v in ob.data.vertices:
            for g in v.groups:
                if g.weight > .5:
                    bone = groups[g.group]
                    break
            if bone:
                break
        owner = piece_of(arm, bone) if bone else None
        if not owner:
            print('RAGDOLL skip (no bone)', ob.name, bone)
            continue
        if owner != bone:
            print('RAGDOLL fold', ob.name, bone, '->', owner)
        bone = owner
        if bone not in seg_ix:
            seg_ix[bone] = len(segs)
            segs.append({'bone': bone, 'kind': PIECE_BONE.get(bone, 'body')})
            recs[seg_ix[bone]] = bytearray()
        si = seg_ix[bone]
        pname, fam, opt = table[base]
        pname = pname + ('.' + side if side else '')   # (pixelize.py with the model's own table: each side its own part)
        if pname not in part_ix:
            parts.append(pname)
            part_ix[pname] = len(parts)   # 1-based (0 = empty in the game's buffers)
        if fam not in fam_ix:
            fam_ix[fam] = len(fams)
            fams.append(fam)
        flags = (opt['fixed'] + 1 if 'fixed' in opt else 0) | (8 if opt.get('outline', True) is False else 0) \
            | (16 if opt.get('lines', True) is False else 0) | (32 if opt.get('thin') else 0)
        bias = max(-127, min(127, round(opt.get('bias', 0) * 100)))
        B = W @ arm.data.bones[bone].matrix_local
        Bi = B.inverted()
        R = Bi.to_3x3()
        oe = ob.evaluated_get(dg)
        me = oe.to_mesh()
        me.calc_loop_triangles()
        Mw = oe.matrix_world
        Nw = Mw.to_3x3().inverted().transposed()
        cn = me.corner_normals
        for tri in me.loop_triangles:
            for li, vi in zip(tri.loops, tri.vertices):
                p = Bi @ (Mw @ me.vertices[vi].co)
                n = (R @ (Nw @ cn[li].vector)).normalized()
                recs[si] += struct.pack('<3f4b4B', p.x, p.y, p.z, *(max(-127, min(127, round(c * 127))) for c in n), bias,
                                        si, part_ix[pname], fam_ix[fam], flags)
        oe.to_mesh_clear()
    arm.data.pose_position = 'POSE'
    bpy.context.view_layer.update()

    blob, first = bytearray(), 0
    for si, s in enumerate(segs):
        s['first'] = first // 20
        s['count'] = len(recs[si]) // 20
        xyz = [struct.unpack_from('<3f', recs[si], k * 20) for k in range(s['count'])]
        s['min'] = [round(min(v[i] for v in xyz), 4) for i in range(3)]
        s['max'] = [round(max(v[i] for v in xyz), 4) for i in range(3)]
        blob += recs[si]
        first = len(blob)
    open(os.path.join(out, 'model.bin'), 'wb').write(bytes(blob))
    # the runtime cloths' families (and their stripes'), so the live hero can draw them with the model's own ramps even
    # when no rigid part shares them (the outlaw's poncho skirt: its dark and green hem bands)
    for c in ns.get('SIM', ()):
        for f in [c['fam']] + [b[2] for b in c.get('bands', ())]:
            if f not in fam_ix and f in fams_src:
                fam_ix[f] = len(fams)
                fams.append(f)

    bones = {}
    for b in arm.data.bones:
        M = W @ b.matrix_local
        bones[b.name] = {'parent': b.parent.name if b.parent else None, 'head': [round(c, 5) for c in W @ b.head_local],
                         'tail': [round(c, 5) for c in W @ b.tail_local], 'rest': mat_rows(M)}
    joints = {k: [round(c, 5) for c in v] for k, v in ns['landmarks']().items()} if 'landmarks' in ns else {}

    # ---- the poses, through the model's own pose() (pixel_rig.py's call), the armature at the origin facing -Y
    out_poses, hide = {}, {}
    for pz in poses:
        clip, _, i = pz.partition('.')
        if pz not in ns['POSES'] and not (i and clip in ns['ANIMS']):
            print('RAGDOLL pose missing', pz)
            continue
        arm.rotation_euler = (0, 0, 0)
        try:
            ns['pose'](pz)
        except Exception as e:   # (a pose this loadout can't take)
            print('RAGDOLL pose failed', pz, e)
            continue
        arm.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        Wm = arm.matrix_world
        P = {}
        for pb in arm.pose.bones:
            if pb.name in SKIP_BONES:
                continue
            M = Wm @ pb.matrix
            q, t = M.to_quaternion(), M.translation
            P[pb.name] = [round(q.x, 5), round(q.y, 5), round(q.z, 5), round(q.w, 5), round(t.x, 5), round(t.y, 5), round(t.z, 5)]
            if pb.name in PIECE_BONE and min(M.to_scale()) < .01:
                hide.setdefault(pz, []).append(pb.name)
        out_poses[pz] = P
    if more:   # their timing as pixel_rig.py writes an atlas's (clips_meta: every frame posed above)
        cm = ns['clips_meta']()
        clips = {**(clips or {}), **{c: cm[c] for c in more if c in cm}}
    meta = {'loadout': os.path.basename(model), 'proportions': ns.get('PROP'), 'units_per_px': .0327883818891779,
            'stride': 20, 'corners': len(blob) // 20}
    extra = {**({'clips': clips} if clips else {}), **({'hide': hide} if hide else {}), **({'live': list(more)} if more else {})}
    json.dump({'meta': meta, 'segs': segs, 'parts': parts, **extra,
               'families': [{'name': f, 'ramp': [list(c) for c in palette_harm.ramp(f, fams_src[f])]} for f in fams],
               'bones': bones, 'joints': joints, 'poses': out_poses}, open(os.path.join(out, 'model.json'), 'w'))
    print('RAGDOLL_OK', json.dumps({'segs': len(segs), 'parts': len(parts), 'families': fams, 'corners': len(blob) // 20,
                                    'poses': len(out_poses), 'bytes': len(blob)}))


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    a = dict(zip(argv[::2], argv[1::2]))
    atlas = json.load(open(os.path.join(a['--atlas'], 'poses.json'))) if '--atlas' in a else None
    run(a.get('--model', 'tools/blender/loadouts/bandit.py'), a.get('--out', r'D:\Game\concepts\sprites\out\ragdoll\bandit'),
        a['--poses'].split(',') if '--poses' in a else atlas['poses'] if atlas else POSES,
        atlas['clips'] if atlas else None, a['--clips'].split(',') if '--clips' in a else ())
