# SplatDiff build progress

STATUS: IN PROGRESS

## Next task

Task 7 (finish) then Task 8: UI polish to presentation quality (at least two runs). See "Notes for task 8" below.

## Task checklist

- [x] 1. Repo scaffold
- [x] 2. Python loader, conversion, test cases, binary export
- [x] 3. Serial C + OpenMP kernels with correctness test
- [x] 4. End-to-end pipeline, results/*.json
- [x] 5. CUDA kernels, NVRTC check, notebooks/colab_benchmark.ipynb (Colab run pending, see below)
- [x] 6. Export change voxels and scenes for the viewer
- [~] 7. Web viewer basics (working: stacked before/after viewers, wipe slider, shared camera, red/amber voxel overlay, case keys 1-5, O toggles overlay, loading screen)
- [ ] 8. UI polish (presentation quality, at least two runs)
- [ ] 9. One-click launcher (start.sh / start.bat) and README instructions
- [ ] 10. Results figures for report and slides
- [ ] 11. Final QA pass, set STATUS: COMPLETE

## How to rebuild everything (generated files are gitignored)

```bash
npm install                        # splat-transform, three, gaussian-splats-3d
bash scripts/convert.sh            # data/raw/*.compressed.ply -> data/converted/*.ply
python3 python/prepare.py          # data/cases/*, data/bin/*
make -C kernels                    # serial + OpenMP binaries
python3 python/test_kernels.py guitar move 48
python3 python/pipeline.py         # results/<scene>.json, results/summary.json
python3 python/export_web.py       # web/data/*
cd web && python3 -m http.server 8765
```

## Log

### 2026-10-14 (run 1)

Push to GitHub was denied (repo not in the scheduled task's authorised sources). The stored task
prompt says to keep building without pushing, so all work is committed locally and delivered as a
git bundle (splatdiff.bundle) in the session. Aanand must push it (see "Action for Aanand").

Done:
- Scaffold, .gitignore, README, data/README with PlayCanvas MIT credit, source scenes committed (4 MB).
- python/splatio.py (PLY read/write, decode, SPLD binary format), testcases.py (reparam, color,
  move, delete, copy, plus ground-truth edits without reparam), canon.py (NumPy reference),
  prepare.py, quickcheck.py.
- Design change vs prototype: grid is N^3 over the percentile box (anisotropic voxels). Search box
  per axis is ceil(3 sqrt(Sigma_kk)/h_k) capped at 8 voxels; weights normalised over visited voxels,
  so mass is conserved; only scales above 5% of the grid diagonal are clamped. The first version
  (clamping scales to 2 voxels) gave 10.7% false change on biker; this version gives 0.39%.
- kernels/serial/splatdiff.c: serial and OpenMP from one source (K1 splat with atomics, K2 compare
  with dilation, K3 reduction). kernels/Makefile.
- kernels/cuda/splatdiff.cu: same three kernels in CUDA (shared-memory reduction). nvrtc_check.py
  compiles them with NVRTC (compute_75) and ptxas sm_75: OK, no spills (splat 65 regs, compare 35,
  reduce 20).
- python/pipeline.py, benchmark.py, export_web.py; notebooks/colab_benchmark.ipynb.
- web/: basic viewer (index.html, css/app.css, js/app.js), three.js r160 and
  gaussian-splats-3d 0.4.7 vendored in web/vendor with licences.

Tests:
- test_kernels.py guitar move 48: serial and OpenMP PASS (rel L2 3.2e-4, occupancy agreement 1.0,
  added/removed counts identical to reference). biker reparam 48: PASS (rel L2 6.2e-5).
- pipeline.py at 128^3 (OpenMP, 2 threads):

| scene | case | change rate | raw baseline | precision | recall |
|-------|------|-------------|--------------|-----------|--------|
| guitar | reparam | 0.85% | 2.26% | | |
| guitar | color | 0.00% | 0.00% | | |
| guitar | move | 10.58% | 13.25% | 0.93 | 0.99 |
| guitar | delete | 5.36% | 6.77% | 0.85 | 1.00 |
| guitar | copy | 6.40% | 9.13% | 0.87 | 0.99 |
| biker | reparam | 0.39% | 2.84% | | |
| biker | color | 0.00% | 0.00% | | |
| biker | move | 12.18% | 7.30% | 0.98 | 0.99 |
| biker | delete | 10.15% | 4.76% | 0.96 | 0.99 |
| biker | copy | 6.89% | 5.54% | 0.96 | 0.99 |

  Raw baseline = point histogram of Gaussian centres (alpha sum per voxel) with the same rule; raw
  precision on edits is only 0.16 to 0.57. The prototype's raw L1 baseline (15 to 20%) is not yet
  reproduced; consider adding a colour-weighted raw L1 baseline so the colour case shows the
  advantage too (raw colour change is 0% now because the point baseline ignores colour).
- benchmark.py on this 2-core sandbox, biker move, 128^3: serial 1.57 s total, OpenMP 2 threads
  0.71 s (2.2x). results/benchmark.json currently holds these CPU-only numbers; CUDA comes from Colab.
- Viewer screenshot at 1920x1080 works (results/screenshots/viewer_basic_guitar_move_1920.png):
  splats render, wipe slider and overlay correct.

Notes for task 8:
- Camera framing is poor: scene sits small in the lower middle. Compute framing from the occupied
  voxels (or a per-scene preset) and look at the occupied centre; add front/top/orbit presets.
- 404 in console is favicon; add one.
- Implement the full design system and tabs (Viewer, Results, Benchmark, How it works) per spec.
- Playwright screenshot helper used: playwright-core + chromium at
  /opt/pw-browsers/chromium-1194/chrome-linux/chrome with swiftshader flags; wait for
  window.__splatdiffReady then 6 s. Consider adding it to scripts/screenshot.mjs.

Action for Aanand:
1. Add AakarshP26/SplatDIff to the scheduled task's GitHub sources (Aakarsh may need to grant
   the Claude GitHub app access), otherwise every run starts from the empty repo again.
2. Push this run's work: `git clone https://github.com/AakarshP26/SplatDIff.git && cd SplatDIff &&
   git pull /path/to/splatdiff.bundle main && git push origin main`.
3. After pushing, run notebooks/colab_benchmark.ipynb on a Colab T4 and commit results/benchmark.json.
