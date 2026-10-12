# Loadout: the Mexican outlaw (western branch): black sombrero with a silver band over the mop, bandana, linen shirt
# under a striped serape poncho, a bandolier across it, charro trousers (silver side seams) in tall boots with big
# spurs, gun belt + tied-down holster, revolver (right hand / holster). Render as gunslinger.py, with
# --model tools/blender/loadouts/outlaw.py. The poncho's skirt is RUNTIME cloth in the game (SIM_CLOTH, as the gunslinger's
# duster); CLOTH_BAKED=1 in the environment keeps the whole poncho rigid (review stills).
import os
exec(open(r'D:\Game\tools\blender\wardrobe.py', encoding='utf-8').read())
exec(open(r'tools/blender/western.py', encoding='utf-8').read())
SIM_CLOTH = os.environ.get('CLOTH_BAKED') != '1'
SPUR_SIZE = 1.8
LOADOUT = ['linen_shirt', 'charro_trousers', 'cowboy_boots', 'bandana', 'serape_poncho', 'bandolier', 'gun_belt',
           'brass_navy', 'hair_bandido', 'sombrero', 'lasso_coil']
