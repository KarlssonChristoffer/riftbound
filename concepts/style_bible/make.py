# Style bible: pure 2D pixel sprites (no 3D, no game renderer). Each figure is authored as material spans per row;
# this script applies one consistent lighting language and writes sprite sheets + frames.json for index.html.
#   python concepts/style_bible/make.py
# Lighting language: light from the top-left. A pixel whose top or left neighbour is empty gets the highlight,
# bottom/right edges get the shadow, a pixel touching a material that sits in front of it gets the shadow
# (hair over face, scarf over tunic, arm over body), and the outline is the darkest tone of the adjacent material.
import json, os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
hx = lambda h: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# material -> (ramp hi, base, shadow, dark), draw priority (higher = in front), shaded?
MAT = {}


def mat(ch, ramp, prio, shaded=True):
    MAT[ch] = ([hx(c) for c in ramp.split()], prio, shaded)


# shared
mat('s', 'f6d2a6 e4a67c bd7a5c 6e3e36', 3)          # skin
mat('k', 'f6d2a6 e4a67c bd7a5c 6e3e36', 8)          # hand / skin in front
mat('e', '1e1418 1e1418 1e1418 1e1418', 4, False)   # eye
mat('z', 'fff6d6 fff6d6 fff6d6 c8a060', 9, False)   # smear core
mat('Z', 'f4c86a f4c86a f4c86a 9a6a2a', 9, False)   # smear edge
# ranger
mat('h', 'a8744a 7a4e30 553421 2e1c16', 5)          # hair
mat('r', 'd65a40 a8352b 74232a 431523', 6)          # scarf
mat('c', 'b8423a 8e2c28 5e1d24 36121c', 1)          # cape (behind)
mat('g', '9aa866 6f7f4b 4c5837 2e3626', 2)          # tunic
mat('a', '9aa866 6f7f4b 4c5837 2e3626', 7)          # sleeve (in front of the body)
mat('l', '9a6a42 6c462c 48301f 2a1b14', 4)          # leather
mat('p', '5a5254 423c40 2e2a30 1c1a1e', 2)          # trousers
mat('b', '8a5a38 64402a 44291d 26170f', 3)          # boots
mat('q', '8a5a38 64402a 44291d 26170f', 0)          # quiver (behind)
mat('f', 'f2ece0 d8ccb6 a89a82 5e5446', 0)          # fletching
mat('w', 'd49c5e a8733f 74502c 3e2a18', 9)          # bow wood
mat('t', 'b8ae98 b8ae98 b8ae98 5a5246', 9, False)   # string (dim, so it reads as a thin line)
mat('x', 'e8d2a8 c8a878 947a52 4e3e2a', 9)          # arrow shaft
mat('m', 'eef4f6 b4c0c8 7a8690 3a4048', 9)          # metal


def sprite(W, H, spans):
    """spans: {y: [(x0, x1, ch), ...]} -> grid of material chars (later spans win)."""
    g = [['.'] * W for _ in range(H)]
    for y, row in spans.items():
        for x0, x1, ch in row:
            for x in range(x0, x1 + 1):
                if 0 <= x < W and 0 <= y < H:
                    g[y][x] = ch
    return g


def overlay(g, spans, erase=''):
    g = [r[:] for r in g]
    if erase:
        g = [[('.' if c in erase else c) for c in r] for r in g]
    for y, row in spans.items():
        for x0, x1, ch in row:
            for x in range(x0, x1 + 1):
                if 0 <= x < len(g[0]) and 0 <= y < len(g):
                    g[y][x] = ch
    return g


def shift(g, rows, dy=0, dx=0, only=None):
    """Move the pixels in rows (range) by dy/dx (optionally only some materials), leaving the rest."""
    H, W = len(g), len(g[0])
    out = [r[:] for r in g]
    moved = [(y, x, g[y][x]) for y in rows for x in range(W) if g[y][x] != '.' and (only is None or g[y][x] in only)]
    for y, x, c in moved:
        out[y][x] = '.'
    for y, x, c in moved:
        if 0 <= y + dy < H and 0 <= x + dx < W:
            out[y + dy][x + dx] = c
    return out


def line(x0, y0, x1, y1, ch):
    """Bresenham line as spans."""
    sp = {}
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        sp.setdefault(y0, []).append((x0, x0, ch))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy; x0 += sx
        if e2 <= dx:
            err += dx; y0 += sy
    return sp


def merge(*sps):
    out = {}
    for sp in sps:
        for y, row in sp.items():
            out.setdefault(y, []).extend(row)
    return out


def render(g):
    """Material grid -> RGBA image (1 px border added for the outline)."""
    H, W = len(g), len(g[0])
    G = [['.'] * (W + 2)] + [['.'] + r + ['.'] for r in g] + [['.'] * (W + 2)]
    H, W = H + 2, W + 2
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    at = lambda x, y: G[y][x] if 0 <= x < W and 0 <= y < H else '.'
    for y in range(H):
        for x in range(W):
            c = G[y][x]
            if c == '.':
                for nx, ny in ((x + 1, y), (x, y + 1), (x - 1, y), (x, y - 1)):
                    n = at(nx, ny)
                    if n != '.':
                        img.putpixel((x, y), MAT[n][0][3] + (255,)); break
                continue
            ramp, prio, shaded = MAT[c]
            if not shaded:
                img.putpixel((x, y), ramp[1] + (255,)); continue
            up, left, down, right = at(x, y - 1), at(x - 1, y), at(x, y + 1), at(x + 1, y)
            tone = 0 if (up == '.' or left == '.') else 2 if (down == '.' or right == '.') else 1
            if any(n != '.' and n != c and MAT[n][1] > prio for n in (up, left, right)):
                tone = 2
            img.putpixel((x, y), ramp[tone] + (255,))
    return img


# ------------------------------------------------------------------ RANGER ------------------------------------------------------------------
W, H = 40, 34
RANGER_IDLE = sprite(W, H, {
    5: [(12, 18, 'h')], 6: [(10, 20, 'h')], 7: [(9, 21, 'h')], 8: [(8, 22, 'h')], 9: [(8, 22, 'h')],
    10: [(8, 16, 'h'), (17, 17, 's'), (18, 19, 'h'), (20, 21, 's'), (22, 22, 'h')],
    11: [(8, 15, 'h'), (16, 21, 's'), (22, 22, 'h')],
    12: [(8, 14, 'h'), (15, 16, 's'), (17, 17, 'e'), (18, 19, 's'), (20, 20, 'e'), (21, 22, 's')],
    13: [(8, 14, 'h'), (15, 16, 's'), (17, 17, 'e'), (18, 19, 's'), (20, 20, 'e'), (21, 22, 's')],
    14: [(6, 6, 'f'), (8, 13, 'h'), (14, 22, 's')], 15: [(6, 7, 'f'), (9, 13, 'h'), (14, 21, 's')],
    16: [(6, 8, 'q'), (10, 13, 'h'), (14, 19, 's')],
    17: [(7, 8, 'q'), (9, 21, 'r')], 18: [(8, 21, 'r')],
    19: [(7, 9, 'c'), (10, 18, 'g'), (17, 17, 'l'), (19, 21, 'a')],
    20: [(7, 9, 'c'), (10, 18, 'g'), (16, 16, 'l'), (19, 21, 'a')],
    21: [(6, 9, 'c'), (10, 18, 'g'), (15, 15, 'l'), (19, 21, 'a')],
    22: [(6, 9, 'c'), (10, 18, 'g'), (14, 14, 'l'), (19, 21, 'a')],
    23: [(6, 9, 'c'), (10, 18, 'g'), (13, 13, 'l'), (19, 21, 'a')],
    24: [(6, 9, 'c'), (10, 18, 'l'), (19, 21, 'k')],
    25: [(5, 9, 'c'), (10, 18, 'g'), (19, 21, 'k')],
    26: [(5, 9, 'c'), (9, 19, 'g')],
    27: [(5, 8, 'c'), (11, 13, 'p'), (15, 17, 'p')], 28: [(11, 13, 'p'), (15, 17, 'p')], 29: [(11, 13, 'p'), (15, 17, 'p')],
    30: [(10, 13, 'b'), (15, 18, 'b')], 31: [(10, 13, 'b'), (15, 19, 'b')], 32: [(10, 14, 'b'), (15, 19, 'b')],
})
# bow held down at the side: "(" with the string on the right
BOW_IDLE = merge({14: [(24, 24, 'w')], 15: [(23, 23, 'w')], 16: [(23, 23, 'w')]},
                 {y: [(22, 22, 'w')] for y in range(17, 23)}, {y: [(22, 22, 'l')] for y in range(23, 26)},
                 {y: [(22, 22, 'w')] for y in range(26, 31)}, {31: [(23, 23, 'w')], 32: [(24, 24, 'w')]},
                 {y: [(24, 24, 't')] for y in range(15, 32)})
R_IDLE1 = overlay(RANGER_IDLE, BOW_IDLE)
R_IDLE2 = shift(R_IDLE1, range(5, 27), dy=1)  # breathe: everything above the legs sinks one pixel

# attack: draw (anticipation), release (smear), follow-through
ARMLESS = overlay(RANGER_IDLE, {24: [(10, 18, 'l')]}, erase='akwt')
DRAW = merge({19: [(19, 25, 'a')], 20: [(19, 25, 'a')]},
             {19: [(26, 27, 'k')], 20: [(26, 27, 'k')]},
             {12: [(26, 26, 'w')], 13: [(27, 27, 'w')], 14: [(28, 28, 'w')], 15: [(28, 28, 'w')], 16: [(28, 28, 'w')], 17: [(28, 28, 'w')],
              18: [(28, 28, 'l')], 21: [(28, 28, 'l')], 22: [(28, 28, 'w')], 23: [(28, 28, 'w')], 24: [(28, 28, 'w')], 25: [(28, 28, 'w')],
              26: [(27, 27, 'w')], 27: [(26, 26, 'w')]},
             {19: [(28, 28, 'l')], 20: [(28, 28, 'l')]},
             line(26, 12, 20, 18, 't'), line(26, 27, 20, 18, 't'),
             {18: [(20, 31, 'x')]}, {18: [(31, 32, 'm')], 17: [(31, 31, 'm')]},
             {17: [(18, 19, 'k')], 18: [(18, 19, 'k')]}, {18: [(13, 17, 'a')], 19: [(12, 14, 'a')]})
R_DRAW = shift(overlay(ARMLESS, DRAW), range(5, 27), dy=1, only=None)
RELEASE = merge({19: [(19, 25, 'a')], 20: [(19, 25, 'a')]}, {19: [(26, 27, 'k')], 20: [(26, 27, 'k')]},
                {12: [(26, 26, 'w')], 13: [(27, 27, 'w')]}, {y: [(28, 28, 'w')] for y in range(14, 26)},
                {19: [(28, 28, 'l')], 20: [(28, 28, 'l')]}, {26: [(27, 27, 'w')], 27: [(26, 26, 'w')]},
                {y: [(27, 27, 't')] for y in range(13, 27)},
                {17: [(15, 16, 'k')], 16: [(15, 16, 'k')]}, {18: [(12, 15, 'a')], 17: [(12, 14, 'a')]},
                {18: [(29, 39, 'z')], 17: [(33, 39, 'Z')], 19: [(33, 39, 'Z')], 16: [(37, 39, 'Z')], 20: [(37, 39, 'Z')]})
R_RELEASE = overlay(ARMLESS, RELEASE)
FOLLOW = merge({19: [(19, 25, 'a')], 20: [(19, 25, 'a')]}, {19: [(26, 27, 'k')], 20: [(26, 27, 'k')]},
               {12: [(26, 26, 'w')], 13: [(27, 27, 'w')]}, {y: [(28, 28, 'w')] for y in range(14, 26)},
               {19: [(28, 28, 'l')], 20: [(28, 28, 'l')]}, {26: [(27, 27, 'w')], 27: [(26, 26, 'w')]},
               {y: [(27, 27, 't')] for y in range(13, 27)},
               {19: [(15, 16, 'k')], 20: [(15, 16, 'k')]}, {19: [(12, 14, 'a')], 18: [(12, 14, 'a')]})
R_FOLLOW = overlay(ARMLESS, FOLLOW)

def arc(cx, cy, r0, r1, a0, a1, core='z', edge='Z'):
    """Crescent smear: pixels between radius r0 and a thickness that peaks mid-arc (degrees, 0 = right, 90 = down)."""
    import math
    sp = {}
    for y in range(int(cy - r1 - 2), int(cy + r1 + 3)):
        for x in range(int(cx - r1 - 2), int(cx + r1 + 3)):
            d = math.hypot(x - cx, y - cy)
            a = math.degrees(math.atan2(y - cy, x - cx))
            if not (a0 <= a <= a1):
                continue
            k = math.sin(math.pi * (a - a0) / (a1 - a0))  # 0 at the ends, 1 mid-arc
            th = (r1 - r0) * k
            if r0 <= d <= r0 + th:
                sp.setdefault(y, []).append((x, x, core if d > r0 + th * .45 else edge))
    return sp


# ------------------------------------------------------------------ WARDEN ------------------------------------------------------------------
mat('S', 'e8eef2 a9b4bc 6c7882 353c44', 5)          # helmet steel
mat('u', 'e8eef2 a9b4bc 6c7882 353c44', 7)          # pauldrons
mat('U', 'e8eef2 a9b4bc 6c7882 353c44', 8)          # gauntlet
mat('n', 'd2dade 949fa8 5e6870 30363c', 2)          # greaves
mat('y', 'e8eef2 a9b4bc 6c7882 353c44', 1)          # shield rim and boss
mat('T', '62c4b2 2f8b85 1d5b5d 113638', 3)          # tabard teal
mat('G', 'f2d27a c49a44 8a6a2c 4a3818', 4)          # gold trim
mat('j', 'f2d27a c49a44 8a6a2c 4a3818', 9)          # hilt
mat('C', '9aa0a6 6a7076 474d53 26292e', 2)          # chainmail
mat('o', '9aa0a6 6a7076 474d53 26292e', 8)          # chain sleeve in front
mat('v', '1a1418 1a1418 1a1418 1a1418', 6, False)   # visor slit
mat('W', 'b27c48 82562f 58371f 301e12', 0)          # shield wood (far arm, behind)
mat('B', 'f4f8fa cad4dc 8a96a0 3e4650', 9)          # blade
mat('d', 'e8664c b63c30 7c2628 441520', 6)          # plume

WARDEN = sprite(W, H, {
    2: [(14, 17, 'd')], 3: [(12, 18, 'd')], 4: [(11, 17, 'd')], 5: [(10, 15, 'd')], 6: [(10, 13, 'd'), (15, 22, 'S')],
    7: [(13, 24, 'S')], 8: [(12, 25, 'S')], 9: [(12, 25, 'S')], 10: [(12, 25, 'S')], 11: [(12, 25, 'S')],
    12: [(12, 17, 'S'), (18, 24, 'v'), (25, 25, 'S')], 13: [(12, 25, 'S')], 14: [(12, 25, 'S'), (20, 20, 'v'), (22, 22, 'v')],
    15: [(13, 24, 'S')], 16: [(14, 23, 'G')],
    17: [(10, 27, 'u')], 18: [(9, 28, 'u')], 19: [(9, 12, 'u'), (13, 25, 'T'), (26, 28, 'u')],
    20: [(12, 13, 'C'), (14, 24, 'T'), (25, 27, 'o')], 21: [(12, 13, 'C'), (14, 24, 'T'), (25, 27, 'o')],
    22: [(12, 13, 'C'), (14, 24, 'T'), (25, 27, 'o')], 23: [(12, 13, 'C'), (14, 24, 'T'), (25, 27, 'o')],
    24: [(12, 24, 'l'), (18, 19, 'G'), (25, 27, 'U')], 25: [(12, 25, 'C'), (14, 23, 'T'), (25, 27, 'U')],
    26: [(12, 25, 'C'), (15, 22, 'T')], 27: [(13, 24, 'C'), (16, 21, 'T')],
    28: [(13, 16, 'n'), (20, 23, 'n')], 29: [(13, 16, 'n'), (20, 23, 'n')], 30: [(13, 16, 'n'), (20, 23, 'n')],
    31: [(12, 17, 'n'), (20, 25, 'n')], 32: [(12, 17, 'n'), (20, 25, 'n')],
})
# gold trim down the tabard and a gold chevron on the chest
WARDEN = overlay(WARDEN, {20: [(19, 19, 'G')], 21: [(18, 20, 'G')], 22: [(17, 17, 'G'), (21, 21, 'G')],
                          25: [(19, 19, 'G')], 26: [(19, 19, 'G')], 27: [(19, 19, 'G')]})
SHIELD = merge({18: [(6, 9, 'y')], 19: [(4, 11, 'y')], 20: [(3, 12, 'y')], 21: [(3, 12, 'y')], 22: [(2, 12, 'y')], 23: [(2, 12, 'y')],
                24: [(2, 12, 'y')], 25: [(2, 12, 'y')], 26: [(3, 12, 'y')], 27: [(3, 12, 'y')], 28: [(4, 11, 'y')], 29: [(6, 9, 'y')]},
               {19: [(6, 9, 'W')], 20: [(4, 11, 'W')], 21: [(4, 11, 'W')], 22: [(3, 11, 'W')], 23: [(3, 11, 'W')], 24: [(3, 11, 'W')],
                25: [(3, 11, 'W')], 26: [(4, 11, 'W')], 27: [(4, 11, 'W')], 28: [(6, 9, 'W')]},
               {y: [(7, 8, 'T')] for y in range(19, 29)}, {23: [(3, 11, 'T')], 24: [(3, 11, 'T')]}, {23: [(7, 8, 'y')], 24: [(7, 8, 'y')]})
W_BASE = overlay(WARDEN, SHIELD)
SWORD_IDLE = merge({23: [(26, 26, 'j')], 26: [(24, 28, 'j')]}, {y: [(26, 27, 'B')] for y in range(27, 33)}, {33: [(26, 26, 'B')]})
W_IDLE1 = overlay(W_BASE, SWORD_IDLE)
W_IDLE2 = shift(W_IDLE1, range(2, 28), dy=1)
W_ARMLESS = overlay(W_BASE, {}, erase='oU')
# windup: sword straight up above the right shoulder
W_UP = overlay(W_ARMLESS, merge({17: [(25, 27, 'o')], 18: [(25, 27, 'o')], 16: [(25, 27, 'U')], 15: [(25, 27, 'U')],
                                 14: [(24, 28, 'j')]}, {y: [(26, 27, 'B')] for y in range(3, 14)}, {2: [(26, 26, 'B')]}, {16: [(26, 26, 'j')]}))
W_UP = shift(W_UP, range(2, 28), dy=1)
# strike: arm thrown forward-down, blade diagonal, a big crescent smear sweeping over the front
W_STRIKE = overlay(W_ARMLESS, merge(arc(24, 17, 10, 16, -85, 55),
                                    {20: [(25, 29, 'o')], 21: [(25, 29, 'o')], 22: [(29, 30, 'U')], 23: [(29, 30, 'U')]},
                                    {21: [(31, 31, 'j')], 22: [(31, 31, 'j')], 23: [(31, 31, 'j')], 24: [(31, 31, 'j')]},
                                    line(32, 23, 38, 29, 'B'), line(32, 24, 37, 29, 'B')))
W_FOLLOW = overlay(W_ARMLESS, merge({20: [(25, 28, 'o')], 21: [(25, 28, 'o')], 22: [(26, 28, 'o')], 23: [(27, 28, 'U')], 24: [(27, 28, 'U')]},
                                    {25: [(26, 30, 'j')]}, line(28, 26, 34, 32, 'B'), line(29, 26, 35, 32, 'B')))
W_FOLLOW = shift(W_FOLLOW, range(2, 28), dy=1)

# ------------------------------------------------------------------ PYROMANCER ------------------------------------------------------------------
mat('H', '9a68a4 6c4078 482a54 26152e', 5)          # hood
mat('R', '8a5a94 60386c 40244a 22132a', 2)          # robe
mat('Q', '9a68a4 6c4078 482a54 26152e', 8)          # bell sleeve in front
mat('N', '2a1a26 2a1a26 2a1a26 160c14', 4, False)   # face in shadow
mat('E', 'ffd070 ffd070 ffd070 8a4a1a', 6, False)   # glowing eyes
mat('O', 'f4b44c d27c2e 96521e 4e2812', 4)          # sash and trim
mat('F', 'c4905a 946438 66422a 38241a', 9)          # staff
mat('1', 'fff4c0 fff4c0 fff4c0 d86a2a', 9, False)   # fire core
mat('2', 'ffb848 ffb848 ffb848 b0461e', 9, False)   # fire
mat('3', 'e8642c e8642c e8642c 7a2418', 9, False)   # fire edge

PYRO = sprite(W, H, {
    2: [(11, 12, 'H')], 3: [(10, 14, 'H')], 4: [(11, 16, 'H')], 5: [(13, 19, 'H')], 6: [(13, 21, 'H')], 7: [(12, 22, 'H')],
    8: [(11, 23, 'H')], 9: [(11, 24, 'H')], 10: [(11, 24, 'H')],
    11: [(11, 18, 'H'), (19, 23, 'N'), (24, 24, 'H')], 12: [(11, 17, 'H'), (18, 23, 'N'), (24, 24, 'H')],
    13: [(11, 17, 'H'), (18, 19, 'N'), (20, 20, 'E'), (21, 21, 'N'), (22, 22, 'E'), (23, 23, 'N'), (24, 24, 'H')],
    14: [(11, 17, 'H'), (18, 23, 'N'), (24, 24, 'H')], 15: [(12, 18, 'H'), (19, 23, 'N'), (24, 24, 'H')],
    16: [(12, 24, 'H')], 17: [(12, 23, 'H')],
    18: [(12, 23, 'R')], 19: [(12, 23, 'R')], 20: [(12, 23, 'R')], 21: [(11, 23, 'R')],
    22: [(11, 23, 'O')], 23: [(11, 24, 'R')], 24: [(10, 24, 'R')], 25: [(10, 24, 'R')], 26: [(10, 25, 'R')],
    27: [(9, 25, 'R')], 28: [(9, 25, 'R')], 29: [(9, 26, 'R')], 30: [(8, 26, 'R')], 31: [(8, 26, 'R')],
    32: [(10, 12, 'b'), (18, 21, 'b')],
})
PYRO = overlay(PYRO, merge({y: [(21, 21, 'O')] for y in range(23, 32)}, {31: [(8, 26, 'O')]}, {16: [(14, 22, 'O')]}))
P_SLEEVE = {18: [(22, 25, 'Q')], 19: [(22, 26, 'Q')], 20: [(22, 26, 'Q')], 21: [(23, 27, 'Q')], 22: [(24, 27, 'Q')], 23: [(26, 27, 'k')]}
FLAME_A = {2: [(28, 28, '3')], 3: [(27, 29, '3'), (28, 28, '2')], 4: [(26, 30, '3'), (27, 29, '2'), (28, 28, '1')],
           5: [(26, 30, '3'), (27, 29, '2'), (28, 28, '1')], 6: [(27, 29, '2')]}
FLAME_B = {1: [(27, 27, '3')], 2: [(27, 28, '3')], 3: [(27, 29, '3'), (28, 28, '2')], 4: [(26, 30, '3'), (27, 29, '2'), (28, 28, '1')],
           5: [(26, 29, '3'), (27, 29, '2'), (27, 28, '1')], 6: [(27, 29, '2')]}
STAFF = merge({y: [(28, 28, 'F')] for y in range(7, 34)}, {7: [(27, 29, 'O')]})
P_IDLE1 = overlay(PYRO, merge(P_SLEEVE, STAFF, FLAME_A))
P_IDLE2 = overlay(shift(overlay(PYRO, P_SLEEVE), range(2, 31), dy=1), merge(STAFF, FLAME_B))
# charge: staff pulled back and tilted, the flame swells
P_CHARGE = overlay(shift(PYRO, range(2, 31), dy=1),
                   merge({19: [(21, 24, 'Q')], 20: [(21, 24, 'Q')], 21: [(22, 24, 'Q')], 22: [(23, 24, 'k')]},
                         line(20, 30, 26, 6, 'F'), {5: [(26, 28, 'O')]},
                         {0: [(26, 26, '3')], 1: [(25, 28, '3')], 2: [(24, 29, '3'), (25, 28, '2')], 3: [(24, 29, '2'), (25, 28, '1')],
                          4: [(25, 28, '1')], 5: [(25, 25, '2')]}))
# cast: staff thrust forward, a fire blast bursting in front
P_CAST = overlay(PYRO, merge({19: [(22, 28, 'Q')], 20: [(22, 29, 'Q')], 21: [(24, 29, 'Q')]},
                             {20: [(29, 30, 'k')]}, line(24, 21, 33, 17, 'F'),
                             {13: [(35, 37, '3')], 14: [(33, 39, '3')], 15: [(32, 39, '2'), (33, 33, '3')], 16: [(32, 39, '2'), (34, 38, '1')],
                              17: [(34, 39, '1'), (33, 33, '2')], 18: [(32, 39, '2'), (34, 38, '1')], 19: [(33, 39, '3'), (34, 37, '2')],
                              20: [(35, 38, '3')], 12: [(37, 37, '3')], 21: [(36, 36, '3')]}))
P_AFTER = overlay(PYRO, merge({19: [(22, 27, 'Q')], 20: [(22, 28, 'Q')], 21: [(24, 28, 'Q')]}, {20: [(28, 29, 'k')]},
                              line(24, 22, 32, 18, 'F'), {14: [(35, 35, '3')], 12: [(37, 37, '2')], 16: [(38, 38, '3')], 18: [(36, 36, '2')]}))

FIGURES = [
    {'name': 'Ranger', 'note': 'light and quick: hair mass and red scarf carry the read; draw, release streak, follow-through',
     'anims': {'idle': [(R_IDLE1, 500), (R_IDLE2, 500)],
               'attack': [(R_IDLE1, 250), (R_DRAW, 350), (R_RELEASE, 80), (R_FOLLOW, 250), (R_IDLE1, 400)]}},
    {'name': 'Warden', 'note': 'heavy: wide steel shoulders, round shield, teal tabard, red plume; overhead windup, crescent smear',
     'anims': {'idle': [(W_IDLE1, 600), (W_IDLE2, 600)],
               'attack': [(W_IDLE1, 200), (W_UP, 350), (W_STRIKE, 90), (W_FOLLOW, 300), (W_IDLE1, 400)]}},
    {'name': 'Pyromancer', 'note': 'caster: hood with glowing eyes in shadow, bell sleeve, flame staff; charge, fire blast',
     'anims': {'idle': [(P_IDLE1, 350), (P_IDLE2, 350)],
               'attack': [(P_IDLE1, 200), (P_CHARGE, 400), (P_CAST, 120), (P_AFTER, 250), (P_IDLE1, 400)]}},
]


def build():
    meta = []
    for fig in FIGURES:
        frames = [(a, render(g), ms) for a, seq in fig['anims'].items() for g, ms in seq]
        fw, fh = frames[0][1].size
        sheet = Image.new('RGBA', (fw * len(frames), fh), (0, 0, 0, 0))
        info = {'name': fig['name'], 'note': fig['note'], 'w': fw, 'h': fh, 'sheet': fig['name'].lower() + '.png', 'anims': {}}
        for i, (a, img, ms) in enumerate(frames):
            sheet.paste(img, (i * fw, 0))
            info['anims'].setdefault(a, []).append([i, ms])
        sheet.save(os.path.join(HERE, info['sheet']))
        meta.append(info)
    with open(os.path.join(HERE, 'frames.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    return [m['name'] for m in meta]


if __name__ == '__main__':
    print(build())
