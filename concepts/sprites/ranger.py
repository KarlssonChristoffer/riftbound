# Ranger master sprite (gate 1): one idle frame, 48x64, transparent, three-quarter top-down, facing south-east.
#   python concepts/sprites/ranger.py
# Writes out/ranger_idle_master.png (1x), out/ranger_idle_master_6x.png and out/ranger_master_layers.json
# (every part's own pixels, so animation frames can later be derived from this exact master).
import json, os
from spritekit import Sprite, spans, ellipse, poly, rect, capsule, line, n_sphere, n_cyl, n_flat, zoom, palette_count

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
os.makedirs(OUT, exist_ok=True)

# 6 colour families: hi, base, shade, local outline
FAMS = {
    'skin':    'f4cfa0 e0a47a b8755a 6a3a34',
    'hair':    'b0703e 84502e 5c3522 2e1a16',
    'red':     'd8573e a8342b 72222a 3e1420',
    'green':   '9aaa62 6c7e48 4a5836 283222',
    'leather': '9a6c44 6e4a2e 4a3020 261814',
    'char':    '5e5860 423e48 2e2b34 18161c',
}

S = Sprite(48, 64, FAMS)
DY = 2  # whole figure shifted down so the feet sit on row 61


# ---------------- back to front ----------------
cape = S.part('cape', 'red', 2)
cape.add(poly((14, 26), (22, 26), (23, 48), (26, 55), (21, 56.5), (15, 57), (8, 56), (4.5, 50), (6, 42), (10, 32)))
cape.shade(n_cyl(16, 26, 11, 56, 9, tilt=.1), hi=.8, lo=.3)
cape.paint(poly((10.5, 38), (12.5, 38), (13, 57), (10, 57)), 2)            # fold shadow
cape.paint(poly((17, 45), (19, 45), (20, 57), (17.5, 57)), 2)              # fold shadow

quiver = S.part('quiver', 'leather', 4)
quiver.add(capsule(17, 40, 9.5, 22, 2.6))
quiver.shade(n_cyl(17, 40, 9.5, 22, 2.6, tilt=.2), hi=.8, lo=.35)
fletch = S.part('fletching', 'red', 4.5)
fletch.add(poly((5, 13), (7.5, 14), (8.5, 20.5), (6.5, 20.5)))            # two feathers fanning out of the quiver
fletch.add(poly((9, 11), (11.5, 12), (11.5, 19.5), (9.5, 19.5)))
fletch.shade(n_flat(-.5, -.5), hi=.6, lo=.2)
fletch.paint({(x, y) for (x, y) in fletch.px if (x - 1, y) in fletch.px}, 1)
fletch.paint({(x, y) for (x, y) in fletch.px if y >= 18}, 2)

leg_b = S.part('leg_back', 'char', 6)
leg_b.add(capsule(20, 44, 19, 53, 2.4))
leg_b.shade(n_cyl(20, 44, 19, 53, 2.4), hi=.9, lo=.35)
boot_b = S.part('boot_back', 'leather', 6.5)
boot_b.add(poly((16.5, 52.5), (21.5, 52.5), (22, 57), (23.5, 58), (23.5, 60), (15.5, 60), (15.5, 55)))
boot_b.shade(n_sphere(18.5, 55, 6, 6), hi=.8, lo=.3)

leg_f = S.part('leg_front', 'char', 7)
leg_f.add(capsule(28, 44, 28.5, 53, 2.5))
leg_f.shade(n_cyl(28, 44, 28.5, 53, 2.5), hi=.9, lo=.35)
boot_f = S.part('boot_front', 'leather', 7.5)
boot_f.add(poly((25.5, 52.5), (31.5, 52.5), (32, 56), (34.5, 57), (35, 60), (25.5, 60)))
boot_f.shade(n_sphere(28, 55, 6, 6), hi=.8, lo=.3)

arm_b = S.part('arm_back', 'green', 8)
arm_b.add(capsule(15.5, 30, 13.5, 38, 2.5))
arm_b.shade(n_cyl(15.5, 30, 13.5, 38, 2.5, tilt=.2), hi=.78, lo=.3)
hand_b = S.part('hand_back', 'skin', 8.5)
hand_b.add(ellipse(13.5, 40.5, 2.1, 2.1))
hand_b.shade(n_sphere(13.5, 40.5, 2.1, 2.1), hi=.8, lo=.3)

torso = S.part('torso', 'green', 10)
torso.add(poly((17, 27), (31, 27), (33.5, 31), (33.5, 38), (15, 38), (14.5, 31)))
torso.add(poly((15, 38), (33.5, 38), (35, 45.5), (29, 46.5), (24, 46), (13.5, 46.5)))
torso.cut(poly((26.5, 47), (29.5, 47), (28, 41.5)))                      # front slit of the tunic
torso.shade(n_cyl(24, 20, 24, 50, 11, tilt=.25), hi=.78, lo=.32)

belt = S.part('belt', 'leather', 11)
belt.add({(x, y) for (x, y) in rect(14, 38, 35, 39) if (x, y) in torso.px})
belt.shade(n_cyl(24, 30, 24, 45, 11), hi=.7, lo=.3)
strap = S.part('strap', 'leather', 12)
strap.add({p for p in capsule(17.5, 28, 30.5, 37.5, 1.0) if p in torso.px})
strap.shade(n_flat(-.3, -.5), hi=.9, lo=.2)

scarf = S.part('scarf', 'red', 19)
scarf.add(ellipse(24.5, 25.5, 9.2, 3.1))
scarf.add(poly((27, 26), (32, 26), (31.5, 35), (28, 34)))                  # knot tail hanging down the chest
scarf.shade(n_cyl(15, 25, 34, 25, 3.1, tilt=.35), hi=.72, lo=.3)
scarf.paint(poly((27, 28), (28.5, 28), (29, 35), (27.5, 34)), 2)

# head: hand-authored pixel by pixel (H/h/d/D hair hi/base/shade/dark, S/s/k skin hi/base/shade, E eye)
HEAD = {
    2: [(17, 22, 'H'), (23, 27, 'h')],
    3: [(15, 23, 'H'), (24, 29, 'h'), (30, 30, 'd')],
    4: [(14, 14, 'h'), (15, 23, 'H'), (24, 29, 'h'), (30, 31, 'd')],
    5: [(13, 14, 'h'), (15, 22, 'H'), (23, 29, 'h'), (30, 32, 'd')],
    6: [(12, 15, 'h'), (16, 21, 'H'), (22, 30, 'h'), (31, 33, 'd')],
    7: [(12, 16, 'h'), (17, 20, 'H'), (21, 30, 'h'), (31, 33, 'd')],
    8: [(11, 30, 'h'), (31, 34, 'd')],
    9: [(11, 31, 'h'), (32, 34, 'd')],
    10: [(11, 31, 'h'), (32, 34, 'd')],
    11: [(11, 22, 'h'), (23, 23, 'd'), (24, 27, 'h'), (28, 28, 'd'), (29, 31, 'h'), (32, 34, 'd')],
    12: [(11, 20, 'h'), (21, 22, 'd'), (23, 24, 'k'), (25, 26, 'h'), (27, 28, 'd'), (29, 31, 'k'), (32, 34, 'd')],
    13: [(11, 19, 'h'), (20, 22, 'd'), (23, 24, 'S'), (25, 25, 'k'), (26, 27, 'd'), (28, 28, 'k'), (29, 31, 's'), (32, 33, 'k')],
    14: [(11, 18, 'h'), (19, 21, 'd'), (22, 22, 'k'), (23, 25, 'S'), (26, 27, 'k'), (28, 31, 's'), (32, 33, 'k')],
    15: [(11, 17, 'h'), (18, 21, 'd'), (22, 22, 'k'), (23, 25, 'S'), (26, 31, 's'), (32, 33, 'k')],
    16: [(11, 16, 'h'), (17, 19, 'd'), (20, 21, 'k'), (22, 24, 'S'), (25, 31, 's'), (32, 33, 'k')],
    17: [(11, 15, 'h'), (16, 19, 'd'), (20, 20, 'k'), (21, 23, 'S'), (24, 24, 's'), (25, 25, 'E'), (26, 29, 's'), (30, 30, 'E'), (31, 31, 's'), (32, 33, 'k')],
    18: [(12, 15, 'h'), (16, 19, 'd'), (20, 20, 'k'), (21, 23, 'S'), (24, 24, 's'), (25, 25, 'E'), (26, 29, 's'), (30, 30, 'E'), (31, 31, 's'), (32, 33, 'k')],
    19: [(12, 14, 'h'), (15, 19, 'd'), (20, 20, 'k'), (21, 22, 'S'), (23, 31, 's'), (32, 33, 'k')],
    20: [(13, 14, 'h'), (15, 19, 'd'), (20, 20, 'k'), (21, 31, 's'), (32, 32, 'k')],
    21: [(15, 18, 'd'), (19, 20, 'k'), (21, 28, 's'), (29, 30, 'k'), (31, 31, 's'), (32, 32, 'k')],
    22: [(19, 21, 'k'), (22, 30, 's'), (31, 31, 'k')],
    23: [(21, 22, 'k'), (23, 30, 's'), (31, 31, 'k')],
    24: [(23, 30, 'k')],
}
hs = spans(HEAD, 'HhdDSskE')
hair = S.part('hair', 'hair', 22, lines=False, clean=False)
for sym, tone in (('H', 0), ('h', 1), ('d', 2), ('D', 3)):
    hair.add(hs.get(sym, ()), tone)
head = S.part('face', 'skin', 21, lines=False, clean=False)
for sym, tone in (('S', 0), ('s', 1), ('k', 2), ('E', 1)):
    head.add(hs.get(sym, ()), tone)
EYES = hs['E']

arm_f = S.part('arm_front', 'green', 24)
arm_f.add(capsule(32, 30, 34.5, 37, 2.6))
arm_f.shade(n_cyl(32, 30, 34.5, 37, 2.6, tilt=.2), hi=.78, lo=.3)
bracer = S.part('bracer', 'leather', 25)
bracer.add(capsule(34.5, 37.5, 35.5, 40, 2.4))
bracer.shade(n_cyl(34.5, 37.5, 35.5, 40, 2.4), hi=.7, lo=.3)

import math
bow = S.part('bow', 'leather', 26)
for y in range(21, 58):
    t = (y - 21) / 36
    xc = 41.5 - 3.4 * math.sin(math.pi * t)
    w = 2 if .12 < t < .88 else 1
    for k in range(w):
        bow.add({(int(round(xc)) - k + (1 if w == 2 else 0), y)})
bow.add({(42, 20), (43, 19), (42, 58), (43, 59)})                         # recurve tips
bow.shade(n_flat(-.5, -.3), hi=.55, lo=.2)
bow.paint({(x, y) for (x, y) in bow.px if (x + 1, y) not in bow.px and 24 < y < 55}, 1)
string = S.part('string', 'skin', 26.5, outline=False, lines=False)
string.add({(43, y) for y in range(20, 59)})
string.paint(string.px, 0)

hand_f = S.part('hand_front', 'skin', 27)
hand_f.add(ellipse(37.5, 41.5, 2.3, 2.2))
hand_f.shade(n_sphere(37, 41, 2.4, 2.4), hi=.75, lo=.3)

# shift the whole figure down
for p in S.parts:
    p.px = {(x, y + DY): t for (x, y), t in p.px.items()}
S.pivot = (24, 62)  # ground contact in pixel-edge coords: canvas x centre, bottom edge of the boot soles (row 61)

# ---------------- hand-placed details (protected) ----------------
S.decal({(x, y + DY) for x, y in EYES}, 'char', 3)                                   # eyes
S.decal({(25, 40 + DY), (26, 40 + DY)}, 'leather', 0)                                  # buckle

img = S.composite()
img.save(os.path.join(OUT, 'ranger_idle_master.png'))
zoom(img, 6).save(os.path.join(OUT, 'ranger_idle_master_6x.png'))
with open(os.path.join(OUT, 'ranger_master_layers.json'), 'w') as f:
    json.dump(S.layers_json(), f, separators=(',', ':'))
print('colours used:', palette_count(img))
