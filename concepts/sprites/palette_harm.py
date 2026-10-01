# Harmonized palette (integration step 1, approved 2026-09-30): the character's ramps made to sit in the
# environment (calmer saturation, lifted darks, no near-black outlines). ONE rule shared by pixelize.py (sprite
# sheets) and wardrobe.sim_static (runtime cloth colours); harmonize.js holds the same numbers for the browser.
# A ramp in:  [hi, base, shade, dark] (hex strings or rgb tuples)
# A ramp out: [hi, base, shade, line, outline_shadow, outline_lit]
#   line            interior lines, eyes (the old darkest tone, lifted a little toward the shade)
#   outline_shadow  exterior outline on the shadow side (lifted further)
#   outline_lit     exterior outline where the empty side is up or left (the light is top-left): the shade tone
import colorsys

HARM = {
    'SAT': {'default': .8, 'red': .92, 'hair': .72, 'skin': .9},
    'HI_V': .94, 'SHADE_LIFT': .15, 'CHAR_V': 1.14, 'LINE_LIFT': .2, 'OUTLINE_LIFT': .42,
}


def _rgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) if isinstance(c, str) else tuple(c)


def _r(v):  # JS Math.round (half up), so the bake matches harmonize.js exactly
    return int(v + .5) if v >= 0 else -int(-v + .5)


def _mix(a, b, k):
    return tuple(x + (y - x) * k for x, y in zip(a, b))


def _adjust(c, sat, val):
    h, s, v = colorsys.rgb_to_hsv(*(x / 255 for x in c))
    r, g, b = colorsys.hsv_to_rgb(h, s * sat, min(1, v * val))
    return tuple(_r(x * 255) for x in (r, g, b))


def ramp(fam, tones):
    o = [_rgb(t) for t in tones]
    sat = HARM['SAT'].get(fam, HARM['SAT']['default'])
    cv = HARM['CHAR_V'] if fam == 'char' else 1
    hi = _adjust(o[0], sat, HARM['HI_V'] * cv)
    base = _adjust(o[1], sat, cv)
    shade = _adjust(_mix(o[2], o[1], HARM['SHADE_LIFT']), sat, cv)
    dark = _adjust(o[3], sat, 1)
    line = tuple(_r(x) for x in _mix(dark, shade, HARM['LINE_LIFT']))
    out_sh = tuple(_r(x) for x in _mix(dark, shade, HARM['OUTLINE_LIFT']))
    return [hi, base, shade, line, out_sh, shade]


def hex4(fam, tones):
    """The 4-tone ramp the runtime cloth uses (hi, base, shade, outline): its folds and outline share tone 3."""
    r = ramp(fam, tones)
    return ['%02x%02x%02x' % c for c in (r[0], r[1], r[2], r[4])]
