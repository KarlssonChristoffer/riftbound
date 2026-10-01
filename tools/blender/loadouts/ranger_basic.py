# Loadout: the first modular set on the standard skeleton. Render:
#   D:\Blender\blender.exe -b --factory-startup --python tools/blender/pixel_rig.py -- \
#     --model tools/blender/loadouts/ranger_basic.py --out concepts/sprites/out/outfits/ranger_basic --poses apose,... --clips ...
exec(open(r'D:\Game\tools\blender\wardrobe.py', encoding='utf-8').read())
LOADOUT = ['linen_shirt', 'green_tunic', 'brown_pants', 'leather_boots', 'red_scarf', 'quiver', 'short_bow',
           'hair_mop', 'travel_cloak']
