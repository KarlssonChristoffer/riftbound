# python tools/standin/standin_gun.py <dir> <repo root>   (dir: gen_standins.py's gunslinger model.json, poses.json, packed.json,
#   e.g. from `git show 6d2c1e2:<path>`)
# Makes the gunslinger's STAND-IN a working gun: from the pristine copies in <dir> (model.json, poses.json,
# packed.json) it writes the repo's stand-in files with
#   - the right arm raised straight out (shoulder height, the gun level in the fist) in every aiming pose: the bow's
#     draw / release / aim_* and the gun's own frames
#   - the gun's frames (gun_aim + twists, gun_draw / fire / fan / reload / holster, gws_ / grs_ / gwr_ / grr_ on the move)
#     added to the live model and to the sprite atlas (aliases of the A-pose's sprite; their 2D bones projected from the
#     raised pose through a camera fitted to the A-pose's own 3D -> 2D bones, per direction), so sim/player/gun.js turns on
#   - GunMuzzle0 moved to the golden deagle's muzzle (features/deagle.js: SIZE 1.5 x a 30 cm model)
# Poses: body space, Blender axes (Z up, facing -Y, his right -X), [qx, qy, qz, qw, x, y, z] per bone.
import hashlib, json, math, os, sys

bak, repo = sys.argv[1], sys.argv[2]
OUT = os.path.join(repo, 'assets/standin/concepts/sprites/out')
MODEL = os.path.join(OUT, 'live/gunslinger/model.json')
IDX = os.path.join(OUT, 'outfits/gunslinger/poses.json')
PACK = os.path.join(OUT, 'outfits/gunslinger/packed/packed.json')
MUZZLE = (0.0, -0.342, 0.110)   # the deagle's bore at its tip, from the palm point (m, the gun's frame)

m = json.load(open(os.path.join(bak, 'model.json')))
idx = json.load(open(os.path.join(bak, 'poses.json')))
pack = json.load(open(os.path.join(bak, 'packed.json')))
bones = m['bones']

# ---- the muzzle at the deagle's tip (the live hero reads it from the rest: GunMuzzle0 - GunHold0)
g = bones['GunHold0']['head']
mh = [round(g[k] + MUZZLE[k], 4) for k in range(3)]
mz = bones['GunMuzzle0']
mz['head'] = mh
mz['tail'] = [mh[0], mh[1] - .02, mh[2]]
mz['rest'] = [1, 0, 0, mh[0], 0, 1, 0, mh[1], 0, 0, 1, mh[2], 0, 0, 0, 1]

# ---- the raised pose
apose = m['poses']['apose']
apose['GunMuzzle0'] = [0, 0, 0, 1] + mh
s = math.sqrt(.5)
Q = [-s, 0.0, 0.0, s]   # -90 deg about X: the arm's "down" turns "forward"
rot = lambda v: [v[0], v[2], -v[1]]   # R_x(-90)
S = apose['RightArm'][4:7]
hand = apose['RightHand'][4:7]
dh = rot([hand[k] - S[k] for k in range(3)])
aim = {b: list(v) for b, v in apose.items()}
for b in ('RightArm', 'RightForeArm', 'RightHand'):
    d = rot([apose[b][4 + k] - S[k] for k in range(3)])
    aim[b] = Q + [S[k] + d[k] for k in range(3)]
gun = [S[0] + dh[0] + (g[0] - hand[0]), S[1] + dh[1] + (g[1] - hand[1]) - .06, S[2] + dh[2] + .02 + (g[2] - hand[2]) + .06]
aim['GunHold0'] = [0, 0, 0, 1] + gun                   # level: the barrel along -Y
aim['GunMuzzle0'] = [0, 0, 0, 1] + [gun[k] + MUZZLE[k] for k in range(3)]

def rq(q, v):   # rotate v by the unit quaternion q (x, y, z, w)
    x, y, z, w = q
    tx, ty, tz = 2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx]

def ends(pose):   # each bone's head and tail in body space
    out = {}
    for b, B in bones.items():
        p = pose.get(b)
        if not p:
            continue
        off = [B['tail'][k] - B['head'][k] for k in range(3)]
        t = rq(p[:4], off)
        out[b] = (p[4:7], [p[4 + k] + t[k] for k in range(3)])
    return out

# ---- the sprite camera per direction, fitted to the A-pose's own bones (u, v = A . [x, y, z, 1])
def solve(M, r):   # 4x4 Gauss-Jordan
    a = [row[:] + [r[i]] for i, row in enumerate(M)]
    for c in range(4):
        p = max(range(c, 4), key=lambda i: abs(a[i][c]))
        a[c], a[p] = a[p], a[c]
        for i in range(4):
            if i != c:
                f = a[i][c] / a[c][c]
                a[i] = [a[i][k] - f * a[c][k] for k in range(5)]
    return [a[i][4] / a[i][i] for i in range(4)]

E0 = ends(apose)
meta0 = pack['meta']['apose']['bones']
CAM = {}
worst = 0
for d, B2 in meta0.items():
    X, U, V = [], [], []
    for b, (h, t) in E0.items():
        if b not in B2 or b == 'GunMuzzle0':   # (the muzzle moved: its rendered spot is the old one)
            continue
        q = B2[b]
        X += [h + [1], t + [1]]
        U += [q[0], q[2]]
        V += [q[1], q[3]]
    XtX = [[sum(x[i] * x[j] for x in X) for j in range(4)] for i in range(4)]
    cu = solve(XtX, [sum(x[i] * u for x, u in zip(X, U)) for i in range(4)])
    cv = solve(XtX, [sum(x[i] * v for x, v in zip(X, V)) for i in range(4)])
    CAM[d] = (cu, cv)
    for x, u, v in zip(X, U, V):
        worst = max(worst, abs(sum(a * b for a, b in zip(cu, x)) - u), abs(sum(a * b for a, b in zip(cv, x)) - v))
print('camera fit: worst error %.2f px over %d directions' % (worst, len(CAM)))

def project(pose):
    E = ends(pose)
    out = {}
    for d, (cu, cv) in CAM.items():
        pr = lambda p: [sum(a * b for a, b in zip(cu, p + [1])), sum(a * b for a, b in zip(cv, p + [1]))]
        out[d] = {b: [round(c, 1) for c in pr(h) + pr(t)] for b, (h, t) in E.items()}
    return out

aim2d, rest2d = project(aim), project(apose)

# ---- the frames
TWS = ['gun_aim'] + ['gun_aim_' + t for t in ('m45', 'm34', 'm22', 'm11', 'p11', 'p22', 'p34', 'p45')]
TWM = ['m90', 'm67', 'm45', 'm22', '0', 'p22', 'p45']
NW = idx['clips']['walk']['frames']
NR = idx['clips']['run']['frames']
AIMED = TWS + ['gun_draw.%d' % i for i in range(4)] + ['gun_fire.%d' % i for i in range(3)] + ['gun_fan.%d' % i for i in range(2)] \
    + ['gun_reload.%d' % i for i in range(6)] \
    + ['%s_%s_%d' % (p, t, f) for p, n in (('gws', NW), ('grs', NR)) for t in TWM for f in range(n)] \
    + ['%s_%s_%d' % (p, k, f) for p, n in (('gwr', NW), ('grr', NR)) for k in ('up', 'fetch', 'load') for f in range(n)]
LOWERED = ['gun_holster.%d' % i for i in range(5)]
BOW = [n for n in m['poses'] if n.startswith(('draw.', 'draw_', 'release.', 'aim_'))]

for n in m['poses']:
    m['poses'][n]['GunMuzzle0'] = list(apose['GunMuzzle0'])
for n in BOW + AIMED:
    m['poses'][n] = {b: list(v) for b, v in aim.items()}
for n in LOWERED:
    m['poses'][n] = {b: list(v) for b, v in apose.items()}

row = pack['poses']['apose']
sim0 = pack['meta']['apose'].get('sim')
for n in AIMED + LOWERED:
    if n not in idx['poses']:
        idx['poses'].append(n)
    pack['poses'][n] = list(row)
    pack['meta'][n] = {'bones': aim2d if n in AIMED else rest2d, 'sim': sim0}

# (each file in its own format as the stand-in generator wrote it: the diff shows only what changed)
text = json.dumps(idx, indent=1)
pack['sig'] = hashlib.sha1(text.encode()).hexdigest()[:16]
open(IDX, 'w', newline='').write(text)
open(PACK, 'w', newline='').write(json.dumps(pack))
open(MODEL, 'w', newline='').write(json.dumps(m))
print('aimed', len(AIMED), 'lowered', len(LOWERED), 'bow re-aimed', len(BOW), 'sig', pack['sig'])
print('gun', [round(c, 3) for c in gun], 'muzzle rest', [round(c, 3) for c in mh])
