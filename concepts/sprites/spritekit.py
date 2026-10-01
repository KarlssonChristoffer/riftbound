# Sprite kit: builds a pixel sprite from layered parts, then applies one lighting/outline language.
# A part = pixel mask + colour family + depth + a tone (0 hi, 1 base, 2 shade, 3 dark) per pixel.
# Pipeline: shapes -> tone per pixel (fake normals, top-left light, quantised into large bands)
#   -> composite by depth -> interior lines/occlusion -> exterior local outline -> orphan clean-up -> decals.
# Parts are kept (layers JSON) so animation frames can be derived by moving the master's own pixels.
import json, math
from PIL import Image

hx = lambda h: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
LIGHT = (-0.55, -0.62, 0.56)
_l = math.sqrt(sum(c * c for c in LIGHT)); LIGHT = tuple(c / _l for c in LIGHT)


class Part:
    def __init__(self, name, fam, depth, outline=True, lines=True, clean=True):
        self.name, self.fam, self.depth, self.outline, self.lines, self.clean = name, fam, depth, outline, lines, clean
        self.px = {}  # (x, y) -> tone

    # ---- shapes (pixel centre inside test) ----
    def add(self, pts, tone=1):
        for p in pts:
            self.px[p] = tone
        return self

    def cut(self, pts):
        for p in pts:
            self.px.pop(p, None)
        return self

    def paint(self, pts, tone, only_existing=True):
        for p in pts:
            if not only_existing or p in self.px:
                self.px[p] = tone
        return self

    def shade(self, normal_fn, hi=.78, lo=.36, bias=0.0):
        """Lambert with the global light, quantised to 3 tones (large clusters, no dither)."""
        for (x, y) in self.px:
            n = normal_fn(x + .5, y + .5)
            d = sum(a * b for a, b in zip(n, LIGHT)) + bias
            self.px[(x, y)] = 0 if d > hi else 1 if d > lo else 2
        return self


def spans(rows, key):
    """Hand-authored rows {y: [(x0, x1, sym), ...]} -> {sym: set of pixels} for the syms in key."""
    out = {}
    for y, row in rows.items():
        for x0, x1, sym in row:
            if sym in key:
                out.setdefault(sym, set()).update((x, y) for x in range(x0, x1 + 1))
    return out


def ellipse(cx, cy, rx, ry):
    return {(x, y) for y in range(int(cy - ry) - 1, int(cy + ry) + 2) for x in range(int(cx - rx) - 1, int(cx + rx) + 2)
            if ((x + .5 - cx) / rx) ** 2 + ((y + .5 - cy) / ry) ** 2 <= 1}


def poly(*pts):
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    out = set()
    for y in range(int(min(ys)) - 1, int(max(ys)) + 2):
        for x in range(int(min(xs)) - 1, int(max(xs)) + 2):
            px, py, inside = x + .5, y + .5, False
            j = len(pts) - 1
            for i in range(len(pts)):
                (xi, yi), (xj, yj) = pts[i], pts[j]
                if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                    inside = not inside
                j = i
            if inside:
                out.add((x, y))
    return out


def rect(x0, y0, x1, y1):
    return {(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)}


def capsule(x0, y0, x1, y1, r):
    out = set()
    for y in range(int(min(y0, y1) - r) - 1, int(max(y0, y1) + r) + 2):
        for x in range(int(min(x0, x1) - r) - 1, int(max(x0, x1) + r) + 2):
            if _segd(x + .5, y + .5, x0, y0, x1, y1)[0] <= r:
                out.add((x, y))
    return out


def line(x0, y0, x1, y1):
    out, dx, dy = set(), abs(x1 - x0), -abs(y1 - y0)
    sx, sy, err = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1), abs(x1 - x0) - abs(y1 - y0)
    while True:
        out.add((x0, y0))
        if x0 == x1 and y0 == y1:
            return out
        e2 = 2 * err
        if e2 >= dy: err += dy; x0 += sx
        if e2 <= dx: err += dx; y0 += sy


def _segd(px, py, x0, y0, x1, y1):
    vx, vy = x1 - x0, y1 - y0
    L2 = vx * vx + vy * vy or 1e-9
    t = max(0, min(1, ((px - x0) * vx + (py - y0) * vy) / L2))
    qx, qy = x0 + t * vx, y0 + t * vy
    return math.hypot(px - qx, py - qy), px - qx, py - qy, t


# ---- fake normals ----
def n_sphere(cx, cy, rx, ry):
    def f(x, y):
        nx, ny = (x - cx) / rx, (y - cy) / ry
        s = nx * nx + ny * ny
        if s > 1: k = 1 / math.sqrt(s); nx, ny, s = nx * k, ny * k, 1
        return nx, ny, math.sqrt(max(0, 1 - s))
    return f


def n_cyl(x0, y0, x1, y1, r, tilt=0.0):
    """Cylinder along a screen segment; tilt > 0 turns the surface up toward the light (top-down camera)."""
    def f(x, y):
        d, ox, oy, _ = _segd(x, y, x0, y0, x1, y1)
        vx, vy = x1 - x0, y1 - y0
        L = math.hypot(vx, vy) or 1
        px_, py_ = -vy / L, vx / L                      # in-screen perpendicular
        s = max(-1, min(1, (ox * px_ + oy * py_) / r))
        nz = math.sqrt(1 - s * s)
        n = (px_ * s, py_ * s - tilt, nz)
        m = math.sqrt(sum(c * c for c in n))
        return tuple(c / m for c in n)
    return f


def n_flat(nx, ny, nz=1.0):
    m = math.sqrt(nx * nx + ny * ny + nz * nz)
    return lambda x, y: (nx / m, ny / m, nz / m)


class Sprite:
    def __init__(self, W, H, fams):
        self.W, self.H, self.fams = W, H, {k: [hx(c) for c in v.split()] for k, v in fams.items()}
        self.parts, self.decals, self.pivot = [], {}, (W // 2, H - 1)

    def part(self, *a, **k):
        p = Part(*a, **k); self.parts.append(p); return p

    def decal(self, pts, rgb_or_fam, tone=None):
        """Hand-placed pixels applied last, protected from clean-up. rgb hex or (family, tone)."""
        c = hx(rgb_or_fam) if tone is None else self.fams[rgb_or_fam][tone]
        for p in pts:
            self.decals[p] = c

    def composite(self, parts=None):
        parts = sorted(parts or self.parts, key=lambda p: p.depth)
        top = {}
        for p in parts:
            for xy, t in p.px.items():
                x, y = xy
                if 0 <= x < self.W and 0 <= y < self.H:
                    top[xy] = [p, t]
        # interior lines / occlusion: a pixel whose neighbour belongs to a part in front of it
        edits = {}
        for (x, y), (p, t) in top.items():
            if not p.lines:
                continue
            for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                q = top.get((x + dx, y + dy))
                if not q or q[0] is p or q[0].depth <= p.depth or not q[0].outline:
                    continue
                if q[0].fam == p.fam:
                    edits[(x, y)] = 3                     # same colour family: dark separating line
                elif dy == -1 or dx == -1:
                    edits[(x, y)] = max(edits.get((x, y), t), 2)  # front part casts shade down/right
        for xy, t in edits.items():
            top[xy][1] = t
        # orphan clean-up: a single pixel whose tone matches none of its same-part neighbours
        for _ in range(2):
            fix = {}
            for (x, y), (p, t) in top.items():
                if not p.clean:
                    continue
                nb = [top[(x + dx, y + dy)][1] for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1))
                      if (x + dx, y + dy) in top and top[(x + dx, y + dy)][0] is p]
                if len(nb) >= 3 and t not in nb and t != 3:
                    fix[(x, y)] = max(set(nb), key=nb.count)
            for xy, t in fix.items():
                top[xy][1] = t
        img = Image.new('RGBA', (self.W, self.H), (0, 0, 0, 0))
        for (x, y), (p, t) in top.items():
            img.putpixel((x, y), self.fams[p.fam][t] + (255,))
        # exterior local outline: darkest tone of the front-most neighbouring part
        for y in range(self.H):
            for x in range(self.W):
                if (x, y) in top:
                    continue
                best = None
                for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
                    q = top.get((x + dx, y + dy))
                    if q and q[0].outline and (best is None or q[0].depth > best.depth):
                        best = q[0]
                if best:
                    img.putpixel((x, y), self.fams[best.fam][3] + (255,))
        for (x, y), c in self.decals.items():
            img.putpixel((x, y), c + (255,))
        return img

    def layers_json(self):
        return {'w': self.W, 'h': self.H, 'pivot': self.pivot, 'families': {k: ['%02x%02x%02x' % c for c in v] for k, v in self.fams.items()},
                'parts': [{'name': p.name, 'fam': p.fam, 'depth': p.depth, 'outline': p.outline,
                           'px': sorted([x, y, t] for (x, y), t in p.px.items())} for p in self.parts],
                'decals': sorted([x, y, '%02x%02x%02x' % c] for (x, y), c in self.decals.items())}


def zoom(img, k, bg=None):
    big = img.resize((img.width * k, img.height * k), Image.NEAREST)
    if bg:
        base = Image.new('RGBA', big.size, hx(bg) + (255,)); base.alpha_composite(big); return base
    return big


def palette_count(img):
    return len({c for c in img.getdata() if c[3]})
