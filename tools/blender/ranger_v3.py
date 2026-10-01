# Ranger blockout v3: three separate readable masses, judged first as a pure black silhouette at ~50 px.
#   1. HEAD: hood block with a brim jutting forward (the front reads even in silhouette) over a visible neck notch
#   2. UPPER BODY: wide, short and asymmetric: a mantle-cape over the left shoulder, thick arms held clear of the torso,
#      the bow arm reaching forward
#   3. LEGS: two legs in an A-stance with a gap from the crotch down, boots with toes pointing forward
# Clay: head light, body mid, legs dark. No rig, colour or detail yet.
# Run inside Blender:  ns = {}; exec(open(r'D:\Game\tools\blender\ranger_v3.py').read(), ns); ns['build']()
import math
from mathutils import Vector

COL = 'RangerV3'
CLAY = {'Head': .30, 'Body': .085, 'Legs': .006}
exec(open(r'D:\Game\tools\blender\blocklib.py', encoding='utf-8').read())


def arm(name, S, dirs, lens, radii, n=6):
    """Chain of segments from shoulder S along unit directions; returns the joint positions."""
    pts = [Vector(S)]
    for d, l in zip(dirs, lens):
        pts.append(pts[-1] + Vector(d).normalized() * l)
    sweep(name, 'Body', pts, radii, n=n, p=2.0)
    return pts


def build():
    sc, root = setup()

    # ---- 1. HEAD: narrow jaw ring makes the neck notch; flat face side, rounded back; brim over the face ----
    sweep('Neck', 'Head', *up(0, [(1.16, .02, .075, .075), (1.34, .02, .075, .075)]), n=6)
    sweep('Hood', 'Head', *up(0, [(1.31, .03, .15, .14), (1.37, .03, .245, .225), (1.52, .035, .275, .255), (1.68, .05, .255, .25),
                                  (1.78, .09, .19, .20), (1.84, .14, .10, .12), (1.855, .17, .03, .03)]), n=8, p=2.6)
    sweep('Brim', 'Head', [(0, -.05, 1.72), (0, -.25, 1.69), (0, -.36, 1.64)], [(.21, .06), (.19, .05), (.12, .03)], n=4, p=12)

    # ---- 2. UPPER BODY: trapezoid torso, short skirt, mantle-cape over the left shoulder ----
    sweep('Torso', 'Body', *up(0, [(.60, 0, .20, .14), (.78, 0, .19, .13), (1.06, .005, .25, .15), (1.15, .01, .24, .14),
                                   (1.20, .015, .13, .10)]), n=8, p=5)
    sweep('Skirt', 'Body', *up(0, [(.56, 0, .23, .16), (.68, 0, .20, .145)]), n=8, p=5)
    hem = lambda k, xn, yn: (0, 0, .14 * max(0, -yn) + .10 * max(0, -xn)) if k == 0 else (0, 0, 0)
    sweep('Mantle', 'Body', *up(.12, [(.70, .08, .30, .22), (.98, .05, .32, .235), (1.15, .03, .28, .21), (1.215, .03, .17, .15)]),
          n=8, p=3, warp=hem)
    # right arm hangs clear of the torso with a bent elbow; left (bow) arm reaches forward out from under the mantle
    sp = math.radians(28)
    ra = arm('Arm.R', (-.27, .01, 1.13), [(-math.sin(sp), -.12, -math.cos(sp)), (-.25, -.45, -.86)], [.21, .19],
             [(.085, .085), (.075, .075), (.068, .068)])
    fd = (ra[-1] - ra[-2]).normalized()
    sweep('Hand.R', 'Body', [ra[-1] - fd * .02, ra[-1] + fd * .10], [(.078, .08), (.07, .075)], n=4, p=8)
    la = arm('Arm.L', (.27, 0, 1.13), [(.35, -.40, -.85), (.20, -.75, -.60)], [.20, .18], [(.085, .085), (.078, .078), (.07, .07)])
    hand = la[-1] + Vector((.20, -.75, -.60)).normalized() * .05
    sweep('Hand.L', 'Body', [la[-1], hand + Vector((.20, -.75, -.60)).normalized() * .06], [(.08, .08), (.07, .075)], n=4, p=8)
    # quiver on the back, below head height so it doesn't compete with the head
    qa, qb = Vector((.0, .27, .74)), Vector((-.20, .26, 1.20))
    sweep('Quiver', 'Body', [qa, qb], [(.07, .065), (.08, .07)], n=4, p=12)

    # ---- bow: thick, held out in front of the left side, top leaning forward ----
    L = 1.2
    axis = Vector((.12, -.30, 1)).normalized()
    belly = axis.cross(Vector((1, 0, 0))).normalized()
    if belly.y > 0:
        belly = -belly
    pts, rad = [], []
    for i in range(9):
        s = -1 + 2 * i / 8
        bend = .16 * (1 - s * s) + .25 * max(0, abs(s) - .75)
        pts.append(hand + axis * (s * L / 2) + belly * (bend - .16))
        rad.append((.055, .05) if abs(s) < .01 else (.05, .045 - .012 * abs(s)))
    sweep('Bow', 'Head', pts, rad, n=4, p=12)

    # ---- 3. LEGS: A-stance with a gap from the crotch down; boots with forward toes ----
    # staggered: the left foot a step forward, the right a little back, so the side views show two legs too
    for sfx, sx, fy in (('L', 1, -.10), ('R', -1, .08)):
        sweep(f'Leg.{sfx}', 'Legs', [(sx * .11, 0, .66), (sx * .19, fy, .22)], [(.085, .09), (.075, .08)], n=6)
        bx = sx * .20
        sweep(f'Boot.{sfx}', 'Legs', *up(bx, [(.02, fy, .095, .10), (.22, fy, .09, .095), (.25, fy, .105, .11)]), n=4, p=12)
        sweep(f'Toe.{sfx}', 'Legs', [(bx, fy + .02, .06), (bx + sx * .01, fy - .23, .05)], [(.09, .06), (.08, .045)], n=4, p=12)

    return sorted(o.name for o in bpy.data.collections[COL].objects)
