# Loadout: the gunslinger (western branch): dark brown cattleman hat over the mop, bandana, linen shirt, wool vest,
# a long duster (shoulder cape, right front swept back behind the holster), dark trousers in tall boots with spurs,
# gun belt + tied-down holster, revolver (right hand / holster). The duster's long panel is RUNTIME cloth in the game
# (SIM_CLOTH, as ranger_sim's cloak); CLOTH_BAKED=1 in the environment bakes it into the sprites (review stills).
# Run from the repo root (western.py is loaded relative to it):
#   D:\Blender\blender.exe -b --factory-startup --python tools/blender/pixel_rig.py -- \
#     --model tools/blender/loadouts/gunslinger.py --out concepts/sprites/out/outfits/gunslinger --w 96 --h 80 \
#     --pivot 48,78 --dirs 16 --upp 0.0327883818891779 --poses ... --clips ...
import os
exec(open(r'D:\Game\tools\blender\wardrobe.py', encoding='utf-8').read())
exec(open(r'tools/blender/western.py', encoding='utf-8').read())
SIM_CLOTH = os.environ.get('CLOTH_BAKED') != '1'
LOADOUT = ['linen_shirt', 'wool_vest', 'dark_trousers', 'cowboy_boots', 'bandana', 'gun_belt', 'peacemaker', 'hair_mop',
           'gunslinger_hat', 'duster']
