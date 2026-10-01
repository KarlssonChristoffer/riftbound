# Loadout: ranger_basic with RUNTIME cloth. The cloak and scarf tail are left out of the sprites; the game simulates
# them (see SIM_CLOTH in wardrobe.py and the cloth section of concepts/sprites/demo.html). Render:
#   D:\Blender\blender.exe -b --factory-startup --python tools/blender/pixel_rig.py -- \
#     --model tools/blender/loadouts/ranger_sim.py --out concepts/sprites/out/outfits/ranger_sim --poses ... --clips ...
exec(open(r'D:\Game\tools\blender\wardrobe.py', encoding='utf-8').read())
SIM_CLOTH = True
LOADOUT = ['linen_shirt', 'green_tunic', 'brown_pants', 'leather_boots', 'red_scarf', 'quiver', 'short_bow',
           'hair_mop', 'travel_cloak']
