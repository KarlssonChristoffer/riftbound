# Ranger as a Blockbench model (.bbmodel, "free" format): chunky cubes, 1 unit = 1 texel, ~30 units tall,
# with a hand-placed pixel texture (colour ramps, eyes, fringe, hair strands, cape folds) painted in code.
# Open the output in Blockbench (web.blockbench.net) to view or edit it; export glTF from there.
#   python tools/blockbench/ranger_bb.py  ->  assets/src/ranger.bbmodel (+ ranger_tex.png for inspection)
# Axes: Y up, the character faces south (+Z, the game's forward), its right hand is -X.
import base64, io, json, os, uuid
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'src', 'ranger.bbmodel')
TEX = 64

# colour ramps: highlight, base, shadow, dark (hue-shifted: warmer lights, cooler/redder darks)
R = {
    'skin': ['f4cfa4', 'e3a97c', 'bd7c5a', '7c4a3c'],
    'hair': ['a06e46', '744a2e', '51321f', '301d15'],
    'cape': ['c9503c', '9e3229', '712226', '46151c'],
    'tunic': ['93a262', '6d7c4b', '4d5937', '313a27'],
    'pants': ['5a5250', '423c3a', '2e2a2a', '1e1b1c'],
    'leather': ['93603a', '6a432b', '4a2d1f', '2b1a13'],
    'wood': ['cf9a5e', 'a5733f', '744e2a', '4a311d'],
    'bone': ['f0e8d6', 'd6cbb4', 'a89c86', '6e6456'],
    'eye': ['1c1410'] * 4, 'gold': ['f0cf78', 'c8a04e', '8e6c30', '5a4220'],
}
hx = lambda h: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


# ---------------- painters: (img, x, y, w, h, face) -> paints one face region ----------------
def fill(img, x, y, w, h, c):
    for i in range(w):
        for j in range(h):
            img.putpixel((x + i, y + j), hx(c))


def px(img, x, y, c):
    img.putpixel((x, y), hx(c))


def shaded(ramp, top_hi=True, bottom=1):
    """Generic: top face highlight, side faces base with a shadow band at the bottom, bottom face dark."""
    def p(img, x, y, w, h, f):
        r = R[ramp]
        if f == 'up':
            fill(img, x, y, w, h, r[0]); return
        if f == 'down':
            fill(img, x, y, w, h, r[3]); return
        fill(img, x, y, w, h, r[1])
        if top_hi:
            fill(img, x, y, w, 1, r[0])
        fill(img, x, y + h - bottom, w, bottom, r[2])
    return p


def head(img, x, y, w, h, f):
    s, hr = R['skin'], R['hair']
    if f == 'south':  # the face: fringe with a jagged edge, sideburns, 1x2 eyes, a cheek shade
        fill(img, x, y, w, h, s[1])
        fill(img, x, y + h - 1, w, 1, s[2])
        jag = [4, 3, 4, 5, 4, 3, 3, 4, 5, 4]
        for i in range(w):
            fill(img, x + i, y, 1, jag[i % len(jag)], hr[1])
            px(img, x + i, y + jag[i % len(jag)] - 1, hr[2])
        for i in (0, w - 1):
            fill(img, x + i, y, 1, 8, hr[1]); px(img, x + i, y + 8, hr[2])
        fill(img, x + 1, y, w - 2, 1, hr[0])
        for ex in (3, w - 4):
            fill(img, x + ex, y + 5, 1, 2, R['eye'][0])
        px(img, x + 2, y + 7, s[2]); px(img, x + w - 3, y + 7, s[2])
    elif f == 'up':
        fill(img, x, y, w, h, hr[0])
    elif f == 'down':
        fill(img, x, y, w, h, s[2])
    else:  # sides and back: all hair, strands, skin only at the jaw on the sides
        fill(img, x, y, w, h, hr[1])
        fill(img, x, y, w, 2, hr[0])
        for i in range(0, w, 3):
            fill(img, x + i, y + 3 + (i % 2), 1, h - 5, hr[2])
        fill(img, x, y + h - 1, w, 1, hr[3])
        if f in ('east', 'west'):
            fill(img, x + (w - 3 if f == 'west' else 0), y + h - 3, 3, 2, s[2])


def hair_cap(img, x, y, w, h, f):
    hr = R['hair']
    if f == 'south':  # the overhanging fringe: light top edge, darker tips
        fill(img, x, y, w, h, hr[1]); fill(img, x, y, w, 1, hr[0])
        for i in range(0, w, 3):
            px(img, x + i, y + h - 1, hr[2])
        return
    if f == 'up':
        fill(img, x, y, w, h, hr[0])
        for i in range(1, w - 1, 3):
            px(img, x + i, y + 1 + (i % 3), hr[1])
        return
    if f == 'down':
        fill(img, x, y, w, h, hr[3]); return
    fill(img, x, y, w, h, hr[1])
    fill(img, x, y, w, 2, hr[0])
    for i in range(1, w, 3):
        fill(img, x + i, y + 2, 1, h - 3, hr[2])
    fill(img, x, y + h - 1, w, 1, hr[2])
    for i in range(0, w, 2):
        px(img, x + i, y + h - 1, hr[3])


def torso(img, x, y, w, h, f):
    t = R['tunic']
    shaded('tunic')(img, x, y, w, h, f)
    if f in ('north', 'south', 'east', 'west'):
        fill(img, x, y + h - 3, w, 2, R['leather'][2])  # belt
        fill(img, x, y + h - 3, w, 1, R['leather'][1])
        if f == 'south':
            fill(img, x + w // 2 - 1, y + h - 3, 2, 2, R['gold'][1]); px(img, x + w // 2 - 1, y + h - 3, R['gold'][0])
            fill(img, x + w // 2, y + 1, 1, h - 5, t[2])  # lacing seam


def skirt(img, x, y, w, h, f):
    shaded('tunic', top_hi=False, bottom=1)(img, x, y, w, h, f)
    if f in ('north', 'south', 'east', 'west'):
        for i in range(1, w, 3):
            fill(img, x + i, y, 1, h - 1, R['tunic'][2])


def scarf(img, x, y, w, h, f):
    c = R['cape']
    shaded('cape')(img, x, y, w, h, f)
    if f in ('north', 'south', 'east', 'west'):
        for i in range(2, w, 3):
            fill(img, x + i, y + 1, 1, h - 2, c[2])
        if f == 'south':  # the knot hanging at the front
            fill(img, x + 2, y + h - 1, 2, 1, c[3])


def cape(img, x, y, w, h, f):
    c = R['cape']
    fill(img, x, y, w, h, c[1])
    if f in ('north', 'south'):
        fill(img, x, y, w, 1, c[2])
        for i in range(1, w, 2):
            fill(img, x + i, y + 2 + (i % 4 == 1), 1, h - 3, c[2] if i % 4 == 1 else c[1])
        for i in range(0, w, 2):
            fill(img, x + i, y + h - 1, 1, 1, c[3])
        fill(img, x, y + 1, w, 1, c[0] if f == 'north' else c[2])
    elif f == 'down':
        fill(img, x, y, w, h, c[3])


def arm(img, x, y, w, h, f):
    t, s = R['tunic'], R['skin']
    if f == 'down':
        fill(img, x, y, w, h, s[2]); return
    if f == 'up':
        fill(img, x, y, w, h, t[0]); return
    fill(img, x, y, w, h, t[1])
    fill(img, x, y, w, 1, t[0])
    fill(img, x, y + h - 4, w, 1, t[2])  # cuff shadow
    fill(img, x, y + h - 3, w, 3, s[1])  # hand
    fill(img, x, y + h - 1, w, 1, s[2])


def leg(img, x, y, w, h, f):
    shaded('pants', top_hi=False)(img, x, y, w, h, f)


def boot(img, x, y, w, h, f):
    l = R['leather']
    shaded('leather')(img, x, y, w, h, f)
    if f in ('north', 'south', 'east', 'west'):
        fill(img, x, y + 1, w, 1, l[2])  # cuff fold
        fill(img, x, y + h - 1, w, 1, l[3])  # sole


def quiver(img, x, y, w, h, f):
    l = R['leather']
    if f == 'up':
        fill(img, x, y, w, h, l[3]); return
    shaded('leather')(img, x, y, w, h, f)
    if f not in ('down',):
        fill(img, x, y + 2, w, 1, l[2]); fill(img, x, y + h - 3, w, 1, l[2])


def fletch(img, x, y, w, h, f):
    b = R['bone']
    fill(img, x, y, w, h, b[1])
    if f == 'up':
        fill(img, x, y, w, h, b[0]); px(img, x + w // 2, y + h // 2, R['cape'][1])
    else:
        fill(img, x, y + h - 1, w, 1, R['cape'][2])
        for i in range(0, w, 2):
            px(img, x + i, y, b[0])


def wood(img, x, y, w, h, f):
    shaded('wood', bottom=0)(img, x, y, w, h, f)
    if f in ('south', 'east'):
        fill(img, x, y, 1, h, R['wood'][0])


def grip(img, x, y, w, h, f):
    fill(img, x, y, w, h, R['leather'][2]); fill(img, x, y, w, 1, R['leather'][1])


# ---------------- model ----------------
# cube: (name, from, to, painter, group[, rotation, origin])
CUBES = [
    ('Head', (-5, 19, -4), (5, 29, 5), head, 'Head'),
    ('HairCap', (-6, 26, -5), (6, 30, 6), hair_cap, 'Head'),  # overhangs the face by 1 as the fringe
    ('Torso', (-4, 10, -2), (4, 19, 3), torso, 'Spine'),
    ('Skirt', (-5, 8, -3), (5, 11, 4), skirt, 'Spine'),
    ('Scarf', (-5, 16, -3), (5, 20, 4), scarf, 'Spine'),
    ('Cape', (-5, 7, -5), (5, 17, -4), cape, 'Spine', (12, 0, 0), (0, 17, -4)),
    ('Quiver', (-2, 9, -8), (1, 20, -5), quiver, 'Spine', (0, 0, -28), (0, 14, -6)),
    ('Fletch', (-2, 20, -8), (1, 23, -5), fletch, 'Spine', (0, 0, -28), (0, 14, -6)),
    ('Arm.R', (-7, 10, -1), (-4, 18, 2), arm, 'RightArm', (0, 0, -8), (-5.5, 18, 0.5)),
    ('Arm.L', (4, 10, -1), (7, 18, 2), arm, 'LeftArm', (0, 0, 8), (5.5, 18, 0.5)),
    ('Leg.R', (-4, 3, -1), (-1, 9, 2), leg, 'RightUpLeg'),
    ('Leg.L', (1, 3, -1), (4, 9, 2), leg, 'LeftUpLeg'),
    ('Boot.R', (-5, 0, -2), (-1, 4, 3), boot, 'RightUpLeg'),
    ('Boot.L', (1, 0, -2), (5, 4, 3), boot, 'LeftUpLeg'),
    # bow in the left hand: grip plus two limbs tilted back toward the string side
    ('BowGrip', (8, 9, 0), (9, 13, 1), grip, 'LeftArm'),
    ('BowUpper', (8, 13, 0), (9, 21, 1), wood, 'LeftArm', (-14, 0, 0), (8.5, 13, 0.5)),
    ('BowLower', (8, 1, 0), (9, 9, 1), wood, 'LeftArm', (14, 0, 0), (8.5, 9, 0.5)),
]
# bones: name -> (parent, pivot). Mixamo names so a rig can follow later
GROUPS = {'Hips': (None, (0, 9, 0)), 'Spine': ('Hips', (0, 10, 0)), 'Head': ('Spine', (0, 19, 0)),
          'LeftArm': ('Spine', (5.5, 18, 0.5)), 'RightArm': ('Spine', (-5.5, 18, 0.5)),
          'LeftUpLeg': ('Hips', (2.5, 9, 0.5)), 'RightUpLeg': ('Hips', (-2.5, 9, 0.5))}


def face_sizes(a, b):
    sx, sy, sz = (b[i] - a[i] for i in range(3))
    return {'north': (sx, sy), 'south': (sx, sy), 'east': (sz, sy), 'west': (sz, sy), 'up': (sx, sz), 'down': (sx, sz)}


def build():
    img = Image.new('RGBA', (TEX, TEX), (0, 0, 0, 0))
    # shelf-pack every face, tallest first
    rects = [(c[0], f, w, h) for c in CUBES for f, (w, h) in face_sizes(c[1], c[2]).items()]
    rects.sort(key=lambda r: -r[3])
    pos, x, y, row = {}, 0, 0, 0
    for name, f, w, h in rects:
        if x + w > TEX:
            x, y, row = 0, y + row, 0
        assert y + h <= TEX, 'texture full'
        pos[(name, f)] = (x, y, w, h)
        x += w; row = max(row, h)
    elements, members = [], {g: [] for g in GROUPS}
    for c in CUBES:
        name, a, b, painter, group = c[:5]
        rot, org = (c[5], c[6]) if len(c) > 5 else ((0, 0, 0), tuple((a[i] + b[i]) / 2 for i in range(3)))
        faces = {}
        for f in ('north', 'east', 'south', 'west', 'up', 'down'):
            fx, fy, w, h = pos[(name, f)]
            painter(img, fx, fy, w, h, f)
            faces[f] = {'uv': [fx, fy, fx + w, fy + h], 'texture': 0}
        u = str(uuid.uuid4())
        elements.append({'name': name, 'box_uv': False, 'rescale': False, 'locked': False, 'render_order': 'default',
                         'allow_mirror_modeling': True, 'from': list(a), 'to': list(b), 'autouv': 0, 'color': 0,
                         'origin': list(org), 'rotation': list(rot), 'faces': faces, 'type': 'cube', 'uuid': u})
        members[group].append(u)

    def node(g):
        kids = members[g] + [node(k) for k, (p, _) in GROUPS.items() if p == g]
        return {'name': g, 'origin': list(GROUPS[g][1]), 'rotation': [0, 0, 0], 'color': 0, 'uuid': str(uuid.uuid4()),
                'export': True, 'mirror_uv': False, 'isOpen': True, 'locked': False, 'visibility': True, 'autouv': 0, 'children': kids}

    buf = io.BytesIO(); img.save(buf, 'PNG')
    img.resize((TEX * 8, TEX * 8), Image.NEAREST).save(os.path.join(ROOT, 'assets', 'src', 'ranger_tex.png'))
    model = {
        'meta': {'format_version': '4.10', 'model_format': 'free', 'box_uv': False},
        'name': 'ranger', 'model_identifier': '', 'visible_box': [1, 1, 0], 'variable_placeholders': '',
        'variable_placeholder_buttons': [], 'timeline_setups': [], 'unhandled_root_fields': {},
        'resolution': {'width': TEX, 'height': TEX},
        'elements': elements, 'outliner': [node('Hips')],
        'textures': [{'path': '', 'name': 'ranger.png', 'folder': '', 'namespace': '', 'id': '0', 'width': TEX, 'height': TEX,
                      'uv_width': TEX, 'uv_height': TEX, 'particle': False, 'use_as_default': False, 'layers_enabled': False,
                      'sync_to_project': '', 'render_mode': 'default', 'render_sides': 'auto', 'frame_time': 1,
                      'frame_order_type': 'loop', 'frame_order': '', 'frame_interpolate': False, 'visible': True,
                      'internal': True, 'saved': False, 'uuid': str(uuid.uuid4()), 'relative_path': '',
                      'source': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}],
        'animations': [],
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(model, fh)
    return OUT, len(elements), y + row


if __name__ == '__main__':
    print(build())
