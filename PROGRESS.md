# SplatDiff build progress

STATUS: COMPLETE

## Next task

None. All 11 tasks are done (2026-11-11). Only human checks remain: start.bat on a Windows laptop.

## Task checklist

- [x] 1. Repo scaffold
- [x] 2. Python loader, conversion, test cases, binary export
- [x] 3. Serial C + OpenMP kernels with correctness test
- [x] 4. End-to-end pipeline, results/*.json
- [x] 5. CUDA kernels, NVRTC check, notebooks/colab_benchmark.ipynb (Colab run pending, see below)
- [x] 6. Export change voxels and scenes for the viewer
- [x] 7. Web viewer basics
- [x] 8. UI polish (presentation quality): runs on 2026-10-31, 11-01, 11-04, open checks closed 2026-11-08
- [x] 9. One-click launcher and README: start.sh passes from a fresh clone (2026-11-08); start.bat untested (no Windows here)
- [x] 10. Results figures for report and slides: python/figures.py, 4 PNGs (2026-11-08), pipeline_diagram.png (2026-11-10)
- [x] 11. Final QA pass (2026-11-10, 2026-11-11)

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
python3 python/figures.py          # results/figures/*.png
node scripts/export_diagram.mjs        # results/figures/pipeline_diagram.png (server running)
node scripts/screenshot.mjs out.png 1920 1080 "?scene=biker&case=move" [results|benchmark|how|help|present]
```

## Log

### 2026-11-11 (run 8, task 11 finish)

Push was denied again (403 from the git proxy: AakarshP26/SplatDIff is not in this scheduled task's
authorised sources). Work is committed locally and delivered as splatdiff_2026-11-11.bundle.

Done:
- `bash start.sh` from a fresh clone: built and served on :8765 (PASS).
- New scripts/key_check.mjs: checks shortcuts 1-5, O, R, space, ?, Escape, P in one browser session
  and saves a screenshot per case. Fullscreen is stubbed because it blocks headless screenshots.
- Guitar at 1280x720: all 16 checks PASS, no console errors. All five cases look correct.
- Biker at 1280x720: keys 1-5, O, R, space, ? PASS; the run hit the 580 s shell timeout before the
  P check (biker renders slowly under SwiftShader). P was verified on guitar. Biker frames match the
  committed screenshots (scene is the lower body only, as before).
- Presentation mode at 1920x1080 (guitar move): sidebar hidden, stage full width, OK.
- README read-through: commands match the scripts. Added the serve command to the manual steps and a
  short UI checks section.
- Screenshots added: ui_present_guitar_move_1920.png, ui_viewer_guitar_copy_1280.png.

Tests: start.sh PASS, key_check guitar 16/16 PASS, key_check biker 13/13 run PASS.

Action for Aanand:
1. Push the bundle: inside a clone, `git pull /path/to/splatdiff_2026-11-11.bundle main && git push origin main`.
2. Double-click start.bat once on a Windows laptop and report whether it works.
3. STATUS is COMPLETE, so this scheduled task can be disabled.

### 2026-11-10 (run 7, task 10 finish, task 11 start)

Push was denied again (403 from the git proxy: AakarshP26/SplatDIff is not in this scheduled task's
authorised sources). Work is committed locally and delivered as splatdiff_2026-11-10.bundle.

Done:
- QA from a fresh clone: `bash start.sh` built everything and served on 127.0.0.1:8765. Rebuilt
  results identical to committed ones except timings (committed timings kept).
- python/test_kernels.py guitar move 48: serial and OpenMP PASS (relL2 3.19e-04, counts match).
- python/figures.py PASS, figures unchanged.
- New scripts/export_diagram.mjs writes results/figures/pipeline_diagram.png (How it works diagram
  plus step cards, 2x scale) for the report and slides.
- Scene A box subtitle shortened to "3DGS, 90k to 250k splats" (text touched the box edges).
- Screenshots checked: Viewer guitar move 1920, Results 1280, Benchmark 1920, How it works 1280.
  No console errors, nothing misaligned. results/screenshots/ui_how_1280.png added.

Tests: start.sh PASS, test_kernels PASS, figures.py PASS, 4 screenshots OK.

Action for Aanand:
1. Push the bundle: inside a clone, `git pull /path/to/splatdiff_2026-11-10.bundle main && git push origin main`.
2. Add AakarshP26/SplatDIff to this scheduled task's GitHub sources so runs can push directly.
3. Double-click start.bat once on a Windows laptop and report whether it works.

### 2026-11-08 (run 6, launcher test, UI checks, figures)

Push was denied again (403 from the git proxy: AakarshP26/SplatDIff is not in this scheduled task's
authorised sources). Work is committed locally and delivered as splatdiff_2026-11-08.bundle.

Done:
- Ran `bash start.sh` from a fresh clone: all six build steps passed in about 100 s, server answered
  on 127.0.0.1:8765, data/manifest.json served. Rebuilt metrics identical to the committed
  results (only timings differ, committed timings kept). xdg-open is absent here, so the browser
  open step was a no-op as designed.
- Closed the open UI checks from 2026-11-04 with headless screenshots: heat style (guitar copy,
  1920), only-changes (biker move, 1280x720), copy case, presentation layout (sidebar hidden). All OK.
- Sidebar at 1280x720 overflowed by about 100 px with the longer move description: tighter rows,
  headings and button in the max-height 800px block. Whole sidebar now fits.
- "Hide isolated voxels" now drops 26-connected clusters under 8 voxels (was: single voxels with no
  neighbour). Removes the speckle streaks above the biker in move/delete. Display only.
- Task 10: python/figures.py writes results/figures/change_rate.png, precision_recall.png,
  benchmark_speedup.png, kernel_breakdown.png (light theme, 200 dpi) plus a README with key numbers.
- Screenshots refreshed: ui_viewer_guitar_move_1920, ui_viewer_guitar_copy_heat_1920,
  ui_viewer_biker_move_1280, ui_viewer_biker_delete_1280, ui_present_biker_delete_1280.

Tests: start.sh fresh-clone build PASS; 5 screenshots, no console errors printed; figures.py PASS.

Action for Aanand:
1. Push the bundle: inside a clone, `git pull /path/to/splatdiff_2026-11-08.bundle main && git push origin main`.
2. Add AakarshP26/SplatDIff to this scheduled task's GitHub sources so runs can push directly.
3. Double-click start.bat once on a Windows laptop and report whether it works.

### 2026-11-05 (run 5, launcher)

Push was denied again (403 from the git proxy: AakarshP26/SplatDIff is not in this scheduled task's
authorised sources). Cloning works, and origin already holds the 2026-11-04 work. This run is
delivered as splatdiff_2026-11-05.bundle.

Blocked: the session's automatic permission check refused the data rebuild ("Code from External":
npm install, convert, prepare, make, pipeline, export_web, all run from the clone). The refusal was
respected, not retried in pieces. Without that rebuild there is no web/data, so no screenshots ran.

Done (written, not run):
- start.sh: checks tools, builds on first run or with --rebuild, serves web/ on 127.0.0.1:8765,
  opens the browser.
- start.bat: serves web/ if web/data exists, otherwise runs start.sh inside WSL.
- .gitattributes keeps start.bat CRLF and start.sh LF. README "Run the demo" section.

Tests: `bash -n start.sh` only. start.sh and start.bat have NOT been executed. The pipeline numbers
were not regenerated. Task 9 stays open until start.sh passes from a fresh clone.

Still unverified from 2026-11-04: heat style, only-changes, copy case, presentation layout.

Next: run start.sh from a fresh clone, then the open UI checks, one screenshot per process.
If the permission check blocks execution again, Aanand needs to allow it (see below).

Action for Aanand:
1. Push the bundle: inside a clone, `git pull /path/to/splatdiff_2026-11-05.bundle main && git push origin main`.
2. Add AakarshP26/SplatDIff to this scheduled task's GitHub sources.
3. Allow scheduled runs to execute npm and the repo's own scripts, otherwise tasks 9 to 11 cannot be
   verified here. Alternatively run `bash start.sh` once on a laptop and report the result.

### 2026-11-04 (run 4, UI polish run 3)

Push was denied again (403 from the git proxy: AakarshP26/SplatDIff is not in this scheduled task's
authorised sources). Work is committed locally and delivered as splatdiff_2026-11-04.bundle.

Done:
- Results table: readable case names (Re-param, Colour), scene shown once per group. CASE_NAME
  table in app.js used everywhere (segmented control, tags, toasts, loading text).
- Benchmark: 64/128/256 grid selector, new scaling line chart (log axis), kernel table grouped by
  grid size, note stating that CUDA times exclude the GPU upload (t_h2d) and that OpenMP is limited
  by 2 vCPUs. The quoted CUDA speedups (up to 108.9x) are kernel time only.
- Reset camera (R and button) now returns to the scene's default view, not always front.
- Wipe: focus ring moved to the knob (it drew two full-height blue lines after dragging). Legend,
  tags and tools now sit above the wipe line.
- Overlay: default opacity 0.3, new "Hide isolated voxels" toggle, on by default. Display only:
  counts and metrics are unchanged.
- Sidebar at 720p height: compact 3-column stats, whole sidebar now fits at 1280x720.
- Tab highlight: animations were stuck at time 0 in headless, so the change of selected tab now
  skips the transition (.nav.instant).
- scripts/ui_check.mjs: one-session interaction check. ?only=1 URL param.

Tests: benchmark page at 1280x720 OK. Viewer at 1280x720 OK for biker delete, help popover, focus
ring, legend. Wipe drag PASS, auto-rotate PASS and presentation class PASS on the run before the last
edits. No console errors logged by that run's earlier steps, but the script was killed before printing.

Not verified with the final code: heat style, only-changes, copy case, presentation layout. ui_check.mjs
timed out at 200 s (the shot after heat is very slow under swiftshader), and the heat screenshot was
stale (still showed help and Solid). Press p for real fullscreen hangs headless screenshots.
Not checked in a real browser: all interactions. Please try them once on a laptop.

Next: re-run those checks one screenshot per process, then task 9. Note web/data is gitignored, so
the launcher must build it on first run.

Action for Aanand: same as before. Push the bundle: inside a clone of the repo,
`git pull /path/to/splatdiff_2026-11-04.bundle main && git push origin main`. To stop needing this,
add AakarshP26/SplatDIff to this scheduled task's GitHub sources.

### 2026-11-01 (run 3, UI polish run 2)

Push was denied again (403 from the git proxy: AakarshP26/SplatDIff is not in this scheduled
task's authorised sources). Work is committed locally and delivered as splatdiff_2026-11-01.bundle.

Done:
- Rebuilt all generated data from a fresh clone (convert, prepare, kernels, pipeline, export_web);
  numbers identical to earlier runs.
- Camera framing: per-scene table SCENE_CAM in web/js/app.js (default preset, vertical offset
  as a fraction of the focus radius, distance factor). Guitar now opens in the 3/4 view
  (front view showed the guitar edge-on), biker in front view pulled back so the boots are inside
  the frame. Both objects are centred vertically.
- Overlay: only surface voxels are drawn (voxels with at least one empty 6-neighbour), so the
  solid style no longer stacks dozens of transparent boxes into a blob. Glow opacity halved
  (it saturated to white).
- URL params ?cam=front|top|orbit and ?style=solid|glow|heat (for screenshots and demos).
- Charts: value labels above every bar (inline Chart.js plugin), log y axis on the benchmark time
  chart (CUDA bar was invisible on a linear axis), two-line category labels instead of rotated
  ones, legends moved below the plot so they never collide with labels.

Tests: screenshots at 1920x1080 and 1280x720 of viewer (guitar, biker, 3/4, glow), results and
benchmark pages, no console errors. Saved: results/screenshots/ui_viewer_guitar_move_1920.png,
ui_results_1920.png, ui_benchmark_1280.png.

Observation: in some headless screenshots the previous nav tab still shows its background
because the 150 ms CSS transition had not run when the frame was captured (computed style
was still transparent on the new tab). Not seen in other shots; probably a swiftshader timing
artefact, but check in a real browser.

UI polish run 3 to-do:
- Check in a real browser: tab highlight after switching, wipe drag, presets, auto-rotate.
- Presentation mode and help popover screenshots at 1280x720; heat style; only-changes mode.
- Delete and copy cases visually for both scenes (overlay readability, colours).
- Results table: show "colour" not "color" in the case column; consider a scene grouping row.
- Benchmark: add a 64/128/256 grid-size selector or a scaling line chart (data already in
  results/benchmark.json for all three sizes).
- Then move on to task 9 (start.sh / start.bat launcher).

Action for Aanand: same as before. Add AakarshP26/SplatDIff to this scheduled task's GitHub
sources, then push this run's bundle: `git pull /path/to/splatdiff_2026-11-01.bundle main &&
git push origin main` inside a clone of the repo.

### 2026-11-01 (fix, interactive session)

- First Colab T4 run: nvcc failed on host code (`for (cudaEvent_t *e : {&e0, ...}) cudaEventCreate(e)`,
  argument type mismatch with the cudaEventCreate overloads). Replaced with five explicit
  cudaEventCreate calls. NVRTC only checks device code, so this was not caught here.
- Serial and OpenMP passed the correctness test on Colab. Colab has 2 vCPUs, so OpenMP 2T is
  only 1.1x to 1.2x there; the CPU scaling story should use a machine with more cores if possible.
- Fix pushed by Aanand; Colab T4 re-run succeeded. results/benchmark.json now holds the T4 numbers
  (biker move): CUDA total 12.2 ms / 17.8 ms / 51.2 ms at 64^3 / 128^3 / 256^3, speedup over serial
  34.8x / 84.6x / 108.9x; splat kernel dominates (47 of 51 ms at 256^3). CUDA occupied counts differ
  from CPU by 2 voxels out of 1.29M (float atomic summation order), added/removed within 1.
- Benchmark page verified with these numbers (results/screenshots/ui_benchmark_cuda_1920.png).
  UI run 2 to-do: the CUDA bar is invisible on the linear time chart; use a log y axis there.
- Optional for the report: run OpenMP on an 8-core laptop for a real thread-scaling curve
  (Colab has 2 vCPUs, so OpenMP 2T is only 1.2x).

### 2026-10-31 (run 2, UI polish run 1)

Push was denied again (403 from the git proxy: repo not in this scheduled task's authorised
sources). The stored prompt says to keep building without pushing, so this run's work is
committed locally and delivered as a git bundle (splatdiff_2026-10-31.bundle).

Done:
- Rebuilt all generated data (convert, prepare, kernels, pipeline, export_web); numbers match run 1.
- web/css/app.css rewritten as a design system: tokens for colour, 8px spacing scale, radii,
  shadows, type scale, motion; dark theme, accent #6e8bff, red added, amber removed.
- Inter (OFL, latin 400/500/600/700) vendored in web/vendor/fonts; Chart.js 4 UMD vendored in
  web/vendor (MIT licences included).
- web/index.html: top bar (logo wordmark, tabs Viewer/Results/Benchmark/How it works, scene
  picker, case segmented control, sidebar toggle, presentation button, help popover), full-bleed
  stage, collapsible right sidebar (case description, change stats, overlay controls, camera).
- web/js/app.js: wipe slider with round knob (drag, arrow keys, sidebar range); Before/After
  tags; legend; camera presets front/top/three-quarter (stage toolbar and sidebar); auto-rotate
  (OrbitControls); overlay styles solid/glow (additive)/heat (per-instance colour by 26-neighbour
  density); opacity slider; only-changes (hides splat meshes); loading screen with logo, title,
  progress bar; soft fade when switching scene or case; URL params ?scene=&case=&page=;
  keyboard 1-5, O, R, Space, P, ?, Esc; toasts; presentation mode (fullscreen, sidebar hidden).
- Results page: four metric cards with count-up (false-change rate, colour, precision, recall
  vs raw baseline), two Chart.js bar charts (false-change on reparam/colour; precision on edits,
  SplatDiff vs raw centres), full table. Benchmark page: notice about pending CUDA numbers,
  metric cards, time and speedup charts, kernel table. How it works: inline SVG pipeline,
  four steps, team, courses, related work.
- Splat rendering is paused (viewer.stop) while a content page covers the stage.
- export_web.py now also copies results/benchmark.json to web/data/benchmark.json.
- scripts/screenshot.mjs (playwright-core, devDependency) for headless screenshots; finds
  chromium in /opt/pw-browsers (path changed to chromium-1243/chrome-linux64 in this sandbox).
- Screenshots: results/screenshots/ui_*.png (1920x1080 and 1280x720).

Tests: all pages render without console errors at 1920x1080 and 1280x720; help popover,
case switching and charts checked visually. Headless swiftshader is slow (about 40 s per shot);
run screenshots one at a time, parallel runs time out.

UI polish run 2 to-do:
- Camera framing per scene: objects sit low and large (guitar body cut at bottom at 1920, biker
  boots at bottom). Add per-scene preset overrides (offset, distance) in export_web.py or app.js.
- Overlay still reads as a solid blob even at opacity 0.45 because many boxes stack; try
  depthTest on, drawing only surface voxels (voxels with an empty 6-neighbour), or glow as default.
- Check presentation mode screenshot, glow and heat styles, only-changes mode, top/3-4 presets.
- Topbar at 1280: scene/case labels are hidden by design; verify nothing wraps at 1280x720
  on the Results page (cards go 2 columns there).
- Results charts: consider a log or broken axis if raw bars dominate; add per-case short captions.

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
- Camera framing: now looks at the centre of the occupied region (focus in changes.json, 5th-95th
  percentile box of occupied voxels). Better, but the guitar still sits low and the overlay covers
  the moved neck; tune per-scene presets (front/top/orbit) and use outline/lower-opacity overlay.
- Biker scene not yet checked visually in the browser (no URL parameter for scene yet; add ?scene=).
- Favicon added (web/favicon.svg).
- Implement the full design system and tabs (Viewer, Results, Benchmark, How it works) per spec.
- Playwright screenshot helper used: playwright-core + chromium at
  /opt/pw-browsers/chromium-1194/chrome-linux/chrome with swiftshader flags; wait for
  window.__splatdiffReady then 6 s. Consider adding it to scripts/screenshot.mjs.

Action for Aanand (still valid on 2026-10-31):
1. Add AakarshP26/SplatDIff to the scheduled task's GitHub sources (Aakarsh may need to grant
   the Claude GitHub app access), otherwise every run starts from the empty repo again.
2. Push this run's work: `git clone https://github.com/AakarshP26/SplatDIff.git && cd SplatDIff &&
   git pull /path/to/splatdiff_2026-10-31.bundle main && git push origin main` (this bundle contains run 1 and run 2).
3. After pushing, run notebooks/colab_benchmark.ipynb on a Colab T4 and commit results/benchmark.json.
