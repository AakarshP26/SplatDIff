# SplatDiff

Geometry-aware change detection between two 3D Gaussian Splatting scenes.

Theory Experiential Learning project, RV College of Engineering.
Courses: Computer Graphics and VR (CGVR), Parallel Architectures and GPU Programming (PAGP).
Team: Aakarsh Prabhu (1RV23CS004), Aditi R (1RV23CS016).

## Idea

Two 3DGS scenes of the same place at times t and t+1 contain completely different Gaussians even
when nothing changed, because training is driven by image loss (densification and pruning).
Comparing Gaussians directly therefore reports changes everywhere. SplatDiff converts each scene
into a colour-independent canonical voxel field Phi (a mass-conserving deposit of every Gaussian's
opacity-weighted volume), compares the two fields, and reports real geometric changes (added,
removed, moved) while ignoring re-parameterisation and colour or lighting changes.

Related work: 3DGS-CD (Lu, Ye, Leonard, arXiv:2411.03706, 2024) and CL-Splats (Ackermann et al.,
ICCV 2025) detect changes from rendered images. SplatDiff works directly on the 3D representation.

## Layout

| path | contents |
|------|----------|
| `python/splatio.py` | PLY loader/writer, parameter decoding, binary export for kernels |
| `python/testcases.py` | synthetic t+1 scenes: reparam, color, move, delete, copy |
| `python/canon.py` | NumPy reference: canonical field Phi and change rule |
| `python/prepare.py` | generate test cases and binaries |
| `python/pipeline.py` | run kernels on all cases, write `results/*.json` |
| `python/test_kernels.py` | correctness test of C / OpenMP / CUDA against the reference |
| `python/benchmark.py` | speedup study, writes `results/benchmark.json` |
| `kernels/serial/splatdiff.c` | serial and OpenMP kernels (one source) |
| `kernels/cuda/splatdiff.cu` | CUDA kernels; `nvrtc_check.py` compile-checks without a GPU |
| `notebooks/colab_benchmark.ipynb` | GPU benchmark on Google Colab |

## Run the demo

Linux, macOS or WSL: `bash start.sh`. Windows: double-click `start.bat`.

The first run downloads nothing extra beyond the npm packages, builds the viewer data (a few
minutes) and opens http://localhost:8765/. Later runs start at once. `bash start.sh --rebuild`
regenerates everything, and `PORT=9000 bash start.sh` selects another port.

Requirements for the first run: Node 18+, Python 3 with numpy and scipy, gcc, make. On Windows the
first run uses WSL for these. Once `web/data` exists, only Python is needed.

Tested 2026-11-08 from a fresh clone on Linux: the first run builds everything in about 100 s.

## Manual steps (Linux / macOS, needs Node 18+, Python 3 with numpy and scipy, gcc)

```bash
bash scripts/convert.sh            # download if needed, convert scenes
python3 python/prepare.py          # test cases + binaries
make -C kernels                    # serial + OpenMP
python3 python/test_kernels.py     # correctness vs NumPy reference
python3 python/pipeline.py         # results/*.json
python3 python/export_web.py       # web/data/*
python3 python/figures.py          # results/figures/*.png (needs matplotlib)
cd web && python3 -m http.server 8765   # open http://localhost:8765/
```

UI checks (headless Chromium via playwright-core, server running on :8765):
`node scripts/key_check.mjs <outdir> guitar 1280 720` tests the shortcuts 1-5, O, R, space, P, ?
and saves a screenshot per case; `node scripts/ui_check.mjs <outdir>` tests the wipe drag and
overlay styles.

Report and slide figures: results/figures/ (see its README) and results/screenshots/.

## Method

1. Decode each Gaussian: scale s = exp(scale), alpha = sigmoid(opacity), rotation from quaternion.
2. Grid: 1st to 99th percentile box of scene A positions plus 5% padding, N = 128 per axis.
3. Deposit: mass m = alpha * (4/3) pi s1 s2 s3 / voxel volume, spread over voxels with
   Mahalanobis distance q <= 9 using weights exp(-q/2) normalised to sum 1 (mass conserving).
4. Compare: occupancy O = Phi > 0.15; added = O_B and not dilate(O_A); removed = O_A and not dilate(O_B).

## Kernels (PAGP)

| kernel | parallel pattern | OpenMP | CUDA |
|--------|------------------|--------|------|
| K1 splat | scatter, one work item per Gaussian | `parallel for` + `atomic` | thread per Gaussian + `atomicAdd` |
| K2 compare | stencil, one work item per voxel | `parallel for collapse(2)` | thread per voxel |
| K3 reduce | reduction of 4 counters | `reduction(+)` | shared-memory tree + one atomic per block |
