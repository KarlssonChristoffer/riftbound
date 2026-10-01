# Ranger sprite study 01

Three transparent, screen-right character poses made from one generated source character. The PNGs are all 96×96 with a shared foot pivot at (48, 80). `sheet.png` is a horizontal atlas ordered idle, run, aim. Use nearest-neighbour sampling and keep the displayed character around 60 pixels high.

These are **prototype poses**, not a complete animation set or a rig. In particular, `run.png` is one stride, not a loop. Only one view direction exists; mirroring it is a quick test, not a final eight-direction solution. Source images are preserved in `source/`; `package.py` documents the reproducible mechanical crop, alpha cleanup, and alignment step.

The source images were generated with the built-in ImageGen workflow, using the approved game-scene examples as style references. They were not integrated into the game runtime and do not replace Opus's existing assets.
