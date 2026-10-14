# Data

`raw/guitar.compressed.ply` and `raw/biker.compressed.ply` are real 3D Gaussian Splatting scenes
from the PlayCanvas engine examples (https://github.com/playcanvas/engine, examples/assets/splats),
MIT licence, Copyright (c) 2011-2024 PlayCanvas Ltd. They are included unmodified so the project
runs offline.

| scene  | Gaussians |
|--------|-----------|
| guitar | 90,854    |
| biker  | 152,746   |

Generated (not committed):
- `converted/<scene>.ply`: float PLY from `scripts/convert.sh` (splat-transform)
- `cases/<scene>/<case>.ply`: synthetic t+1 scenes from `python/prepare.py`
- `bin/<scene>/*.bin`: packed Gaussians for the C/CUDA kernels (format in `python/splatio.py`)
