// SplatDiff web app.
// Viewer: two Gaussian splat viewers stacked: A = scene at t (base), B = scene at t+1 (selected case).
// B is clipped by the wipe slider and shares A's camera. Removed voxels are drawn on A, added on B.
// Results, Benchmark and How it works pages are built from web/data/manifest.json and benchmark.json.
import * as THREE from 'three';
import * as GS from '../vendor/gaussian-splats-3d.module.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const COL = { added: 0xff5a5f, removed: 0xffb547, accent: '#6e8bff', added_s: '#ff5a5f', removed_s: '#ffb547', raw: '#4a515c' };
const CASE_INFO = {
  reparam: 'Same geometry, different Gaussians: every Gaussian split in two along its major axis, jittered and pruned, as re-training would. Nothing should be reported.',
  color: 'Same Gaussians with shifted colour, as with a lighting change. Colour is ignored, so nothing should be reported.',
  move: 'A solid object is translated by 18% of the scene extent, combined with re-parameterisation. Expect removed voxels at the old place and added at the new.',
  delete: 'Gaussians around a central object are deleted, combined with re-parameterisation. Expect removed voxels only.',
  copy: 'An object is duplicated to a new place, combined with re-parameterisation. Expect added voxels only.',
};
// Per-scene framing: default preset, vertical offset (fraction of focus radius, +y is down) and distance factor.
const SCENE_CAM = { guitar: { cam: 'orbit', dy: 0.2, dist: 0.85 }, biker: { cam: 'front', dy: 0.22, dist: 1.2 } };
const CAM_DIRS = { front: [0.25, -0.35, -1], top: [0.02, -1, -0.12], orbit: [1, -0.55, -0.9] };

const state = { manifest: null, bench: null, scene: null, caseId: 'move', wipe: 0.5, overlay: true, style: 'solid',
  opacity: 0.45, only: false, cam: 'front', rotate: false, page: 'viewer', loading: false };
let viewerA = null, viewerB = null, boxesA = null, boxesB = null, focus = null, loadToken = 0;

// ---------- small helpers ----------
const pct = (x, d = 1) => (x == null ? 'n/a' : `${(x * 100).toFixed(d)}%`);
const fmt = (x) => x.toLocaleString('en-US');
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 1600); }
function countUp(el, to, { dec = 0, suffix = '', dur = 900 } = {}) {
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = `${(to * e).toFixed(dec)}${suffix ? `<small>${suffix}</small>` : ''}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function setLoading(on, frac = 0, msg = '', soft = false) {
  const l = $('loading');
  l.classList.toggle('hide', !on); l.classList.toggle('soft', soft);
  $('bar').style.width = `${Math.round(frac * 100)}%`;
  if (msg) $('loadmsg').textContent = msg;
}
const currentScene = () => state.manifest.scenes.find((s) => s.id === state.scene);
const currentCase = () => currentScene().cases.find((c) => c.id === state.caseId);

// ---------- overlay ----------
function heatColors(voxels) {
  const key = (i, j, k) => (i * 1024 + j) * 1024 + k;
  const set = new Set(voxels.map((v) => key(v[0], v[1], v[2])));
  const lo = new THREE.Color(0xffe066), hi = new THREE.Color(0xff2d55);
  return voxels.map(([i, j, k]) => {
    let n = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (set.has(key(i + a, j + b, k + c))) n++;
    return lo.clone().lerp(hi, Math.min(1, (n - 1) / 20));
  });
}
function surfaceVoxels(voxels) {
  const key = (i, j, k) => (i * 1024 + j) * 1024 + k;
  const set = new Set(voxels.map((v) => key(v[0], v[1], v[2])));
  const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return voxels.filter(([i, j, k]) => nb.some(([a, b, c]) => !set.has(key(i + a, j + b, k + c))));
}
function makeBoxes(voxels, g, color) {
  voxels = surfaceVoxels(voxels);
  const geo = new THREE.BoxGeometry(g.h[0] * 0.92, g.h[1] * 0.92, g.h[2] * 0.92);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: state.opacity, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(voxels.length, 1));
  const m = new THREE.Matrix4();
  voxels.forEach((v, i) => {
    m.makeTranslation(g.lo[0] + (v[0] + 0.5) * g.h[0], g.lo[1] + (v[1] + 0.5) * g.h[1], g.lo[2] + (v[2] + 0.5) * g.h[2]);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = voxels.length;
  mesh.renderOrder = 10;
  mesh.userData = { base: new THREE.Color(color), heat: voxels.length ? heatColors(voxels) : [] };
  return mesh;
}
function applyOverlay() {
  for (const b of [boxesA, boxesB]) {
    if (!b) continue;
    b.visible = state.overlay;
    const m = b.material;
    m.opacity = state.style === 'glow' ? Math.min(1, state.opacity * 0.35) : state.opacity;
    m.blending = state.style === 'glow' ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (state.style === 'heat') { m.color.set(0xffffff); b.userData.heat.forEach((c, i) => b.setColorAt(i, c)); }
    else { m.color.copy(b.userData.base); if (b.instanceColor) b.userData.heat.forEach((_, i) => b.setColorAt(i, new THREE.Color(0xffffff))); }
    if (b.instanceColor) b.instanceColor.needsUpdate = true;
    m.needsUpdate = true;
  }
  for (const v of [viewerA, viewerB]) if (v && v.splatMesh) v.splatMesh.visible = !state.only;
  $('overlay').checked = state.overlay; $('onlyChanges').checked = state.only;
  $$('#ovStyle button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === state.style)));
  $('legend').style.opacity = state.overlay ? 1 : 0;
}

// ---------- camera ----------
function camPose(name) {
  const o = SCENE_CAM[state.scene] || { dy: 0, dist: 1 }, r = focus.radius;
  const c = [focus.center[0], focus.center[1] + (name === 'top' ? 0 : o.dy * r), focus.center[2]];
  const d = o.dist * (1.3 * r / Math.tan((24 * Math.PI) / 180)) * (name === 'top' ? 1.1 : 1);
  const dir = CAM_DIRS[name], len = Math.hypot(...dir);
  return { lookAt: c, pos: c.map((v, k) => v + (dir[k] / len) * d) };
}
function setCamera(name, announce = false) {
  state.cam = name;
  $$('#camSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cam === name)));
  if (!viewerA || !focus) return;
  const p = camPose(name), cam = viewerA.camera, ctl = viewerA.controls;
  cam.up.set(0, -1, 0);
  cam.position.set(...p.pos);
  if (ctl) { ctl.target.set(...p.lookAt); ctl.update(); } else cam.lookAt(...p.lookAt);
  if (announce) toast(`Camera: ${name === 'orbit' ? 'three-quarter' : name}`);
}
function setRotate(on) {
  state.rotate = on;
  $('autoRotate').checked = on; $('btnRotate').setAttribute('aria-pressed', String(on));
  if (viewerA && viewerA.controls) { viewerA.controls.autoRotate = on; viewerA.controls.autoRotateSpeed = 1.2; }
}

// ---------- viewer lifecycle ----------
function makeViewer(root, cam, sharedCamera) {
  const opts = { rootElement: root, cameraUp: [0, -1, 0], initialCameraPosition: cam.pos, initialCameraLookAt: cam.lookAt,
    sharedMemoryForWorkers: false, gpuAcceleratedSort: false, useBuiltInControls: !sharedCamera };
  if (sharedCamera) opts.camera = sharedCamera;
  return new GS.Viewer(opts);
}
async function disposeViewers() {
  for (const v of [viewerB, viewerA]) if (v) { try { await v.dispose(); } catch (e) { /* ignore */ } }
  $('viewA').innerHTML = ''; $('viewB').innerHTML = '';
  viewerA = viewerB = boxesA = boxesB = null;
}
function updateCaseInfo() {
  const sc = currentScene(), c = currentCase(), m = c.metrics || {};
  const idx = sc.cases.indexOf(c) + 1;
  $('caseKey').textContent = `key ${idx}`;
  $('caseDesc').textContent = CASE_INFO[c.id] || '';
  $('tagCase').textContent = c.id;
  $('stAdded').textContent = fmt(c.added); $('stRemoved').textContent = fmt(c.removed);
  $('stRate').textContent = pct(m.change_rate, 2); $('stRaw').textContent = pct(m.raw_change_rate, 2);
  $('stPrec').textContent = m.precision != null ? m.precision.toFixed(2) : 'n/a';
  $('stRec').textContent = m.recall != null ? m.recall.toFixed(2) : 'n/a';
}
async function load() {
  const token = ++loadToken, first = !viewerA;
  state.loading = true;
  updateCaseInfo();
  const url = new URL(location); url.searchParams.set('scene', state.scene); url.searchParams.set('case', state.caseId); history.replaceState(null, '', url);
  $('stage').classList.add('fading');
  setLoading(true, 0, `Loading ${state.scene}, ${state.caseId}`, !first);
  if (!first) await new Promise((r) => setTimeout(r, 250));
  await disposeViewers();
  if (token !== loadToken) return;
  const base = `data/${state.scene}`;
  const ch = await (await fetch(`${base}/${state.caseId}.changes.json`)).json();
  focus = ch.focus;
  const cam = camPose(state.cam);
  viewerA = makeViewer($('viewA'), cam, null);
  await viewerA.addSplatScene(`${base}/base.ply`, { format: GS.SceneFormat.Ply, showLoadingUI: false,
    onProgress: (p) => setLoading(true, p / 200, 'Loading scene at t', !first) });
  if (token !== loadToken) return;
  viewerB = makeViewer($('viewB'), cam, viewerA.camera);
  await viewerB.addSplatScene(`${base}/${state.caseId}.ply`, { format: GS.SceneFormat.Ply, showLoadingUI: false,
    onProgress: (p) => setLoading(true, 0.5 + p / 200, 'Loading scene at t+1', !first) });
  if (token !== loadToken) return;
  boxesA = makeBoxes(ch.removed, ch.grid, COL.removed);
  boxesB = makeBoxes(ch.added, ch.grid, COL.added);
  viewerA.threeScene.add(boxesA); viewerB.threeScene.add(boxesB);
  applyOverlay();
  if (state.page === 'viewer') { viewerA.start(); viewerB.start(); }
  setCamera(state.cam); setRotate(state.rotate);
  setLoading(false, 1);
  $('stage').classList.remove('fading');
  state.loading = false;
}

// ---------- wipe ----------
function applyWipe() {
  const p = (state.wipe * 100).toFixed(2);
  $('viewB').style.clipPath = `inset(0 0 0 ${p}%)`;
  $('wipe').style.left = `${p}%`;
  $('wipe').setAttribute('aria-valuenow', Math.round(state.wipe * 100));
  $('wipeRange').value = state.wipe;
}
function initWipe() {
  const w = $('wipe');
  let drag = false;
  const move = (e) => {
    if (!drag) return;
    const r = $('stage').getBoundingClientRect();
    state.wipe = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    applyWipe();
  };
  w.addEventListener('pointerdown', (e) => { drag = true; w.classList.add('drag'); w.setPointerCapture(e.pointerId); });
  w.addEventListener('pointermove', move);
  w.addEventListener('pointerup', () => { drag = false; w.classList.remove('drag'); });
  w.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') state.wipe = Math.max(0, state.wipe - 0.05);
    else if (e.key === 'ArrowRight') state.wipe = Math.min(1, state.wipe + 0.05); else return;
    e.preventDefault(); applyWipe();
  });
  $('wipeRange').oninput = (e) => { state.wipe = parseFloat(e.target.value); applyWipe(); };
  applyWipe();
}

// ---------- top bar ----------
function selectCase(id) {
  if (id === state.caseId && viewerA) return;
  state.caseId = id; renderCases(); load();
}
function renderCases() {
  const sc = currentScene();
  $('cases').innerHTML = '';
  sc.cases.forEach((c, i) => {
    const b = document.createElement('button');
    b.textContent = { reparam: 'Re-param', color: 'Colour' }[c.id] || c.id[0].toUpperCase() + c.id.slice(1);
    b.dataset.tip = `${c.id}: ${c.added} added, ${c.removed} removed (key ${i + 1})`;
    b.setAttribute('aria-pressed', String(c.id === state.caseId));
    b.onclick = () => selectCase(c.id);
    $('cases').appendChild(b);
  });
}
function showPage(name) {
  state.page = name;
  $$('#nav button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === name)));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
  // pause splat rendering while a content page covers the stage
  for (const v of [viewerA, viewerB]) if (v && !state.loading) { try { if (name !== 'viewer') v.stop(); else if (!v.selfDrivenModeRunning) v.start(); } catch (e) { /* ignore */ } }
  if (name === 'results') buildResults();
  if (name === 'benchmark') buildBenchmark();
}
function togglePresent() {
  const on = !$('app').classList.contains('present');
  $('app').classList.toggle('present', on);
  if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (on) { showPage('viewer'); toast('Presentation mode. Press P to exit'); }
  setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
}
function toggleSidebar() {
  const closed = $('app').classList.toggle('sidebar-closed');
  $('btnSidebar').setAttribute('aria-pressed', String(!closed));
  setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
}

// ---------- charts ----------
const charts = {};
function chartDefaults() {
  if (!window.Chart) return;
  Chart.defaults.color = '#a4abb5';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.borderColor = '#22262d';
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.legend.labels.boxHeight = 10;
  Chart.defaults.plugins.legend.labels.useBorderRadius = true;
  Chart.defaults.plugins.legend.labels.borderRadius = 3;
  Chart.defaults.plugins.tooltip.backgroundColor = '#000';
  Chart.defaults.plugins.tooltip.borderColor = '#2e333b';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.animation.duration = 700;
}
// Draws each bar's value above it, so small bars (CPU speedups, SplatDiff false-change) stay readable.
const valueLabels = {
  id: 'valueLabels',
  afterDatasetsDraw(chart, _a, opts) {
    if (!opts || !opts.fmt) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = '500 11px Inter, sans-serif'; ctx.fillStyle = '#9aa3b2'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    chart.data.datasets.forEach((d, i) => chart.getDatasetMeta(i).data.forEach((bar, j) => {
      const v = d.data[j]; if (v == null || Number.isNaN(v)) return;
      ctx.fillText(opts.fmt(v), bar.x, bar.y - 4);
    }));
    ctx.restore();
  },
};
function barChart(id, labels, datasets, { yFmt = (v) => v, max, log = false, labelFmt = null } = {}) {
  if (!window.Chart) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($(id), {
    type: 'bar',
    plugins: [valueLabels],
    data: { labels, datasets: datasets.map((d) => ({ borderRadius: 4, maxBarThickness: 36, categoryPercentage: 0.7, barPercentage: 0.85, ...d })) },
    options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
      plugins: { valueLabels: { fmt: labelFmt }, legend: { display: datasets.length > 1, position: 'bottom', align: 'center', labels: { padding: 16 } }, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${yFmt(c.parsed.y)}` } } },
      scales: { x: { grid: { display: false } }, y: log ? { type: 'logarithmic', ticks: { callback: (v) => ([1, 10, 100, 1000, 10000].includes(+v) ? yFmt(v) : '') }, grid: { color: '#1a1d22' } }
        : { beginAtZero: true, max, ticks: { callback: yFmt }, grid: { color: '#1a1d22' } } } },
  });
}

function buildResults() {
  const S = state.manifest.scenes;
  const m = (s, c) => (S.find((x) => x.id === s)?.cases.find((x) => x.id === c)?.metrics) || {};
  const ids = S.map((s) => s.id);
  const avg = (f) => { const v = []; S.forEach((s) => s.cases.forEach((c) => { const x = f(c); if (x != null) v.push(x); })); return v.reduce((a, b) => a + b, 0) / Math.max(v.length, 1); };
  const edits = ['move', 'delete', 'copy'];
  const fcr = avg((c) => (c.id === 'reparam' ? c.metrics.change_rate : null));
  const fcrRaw = avg((c) => (c.id === 'reparam' ? c.metrics.raw_change_rate : null));
  const prec = avg((c) => (edits.includes(c.id) ? c.metrics.precision : null));
  const precRaw = avg((c) => (edits.includes(c.id) ? c.metrics.raw_precision : null));
  const rec = avg((c) => (edits.includes(c.id) ? c.metrics.recall : null));
  const recRaw = avg((c) => (edits.includes(c.id) ? c.metrics.raw_recall : null));
  $('cards').innerHTML = `
    <div class="card good"><div class="k">False-change rate</div><div class="big" id="cd0"></div><div class="cap">Re-parameterised scene. Raw baseline <b>${pct(fcrRaw, 2)}</b></div></div>
    <div class="card"><div class="k">Colour change ignored</div><div class="big" id="cd1"></div><div class="cap">Voxels flagged after a colour shift</div></div>
    <div class="card accent"><div class="k">Precision on edits</div><div class="big" id="cd2"></div><div class="cap">Mean of move, delete, copy. Raw <b>${precRaw.toFixed(2)}</b></div></div>
    <div class="card accent"><div class="k">Recall on edits</div><div class="big" id="cd3"></div><div class="cap">Mean of move, delete, copy. Raw <b>${recRaw.toFixed(2)}</b></div></div>`;
  countUp($('cd0'), fcr * 100, { dec: 2, suffix: '%' });
  countUp($('cd1'), avg((c) => (c.id === 'color' ? c.metrics.change_rate : null)) * 100, { dec: 2, suffix: '%' });
  countUp($('cd2'), prec, { dec: 2 });
  countUp($('cd3'), rec, { dec: 2 });
  const lbl = [];
  const ours = [], raw = [];
  ids.forEach((s) => ['reparam', 'color'].forEach((c) => { lbl.push([s, c === 'reparam' ? 're-param' : 'colour']); ours.push(m(s, c).change_rate * 100); raw.push(m(s, c).raw_change_rate * 100); }));
  barChart('chFalse', lbl, [{ label: 'SplatDiff', data: ours, backgroundColor: COL.accent }, { label: 'Raw centres', data: raw, backgroundColor: COL.raw }], { yFmt: (v) => `${(+v).toFixed(1)}%`, labelFmt: (v) => `${v.toFixed(2)}%` });
  const l2 = [], p1 = [], p2 = [];
  ids.forEach((s) => edits.forEach((c) => { l2.push([s, c]); p1.push(m(s, c).precision); p2.push(m(s, c).raw_precision); }));
  barChart('chPrec', l2, [{ label: 'SplatDiff', data: p1, backgroundColor: COL.accent }, { label: 'Raw centres', data: p2, backgroundColor: COL.raw }], { yFmt: (v) => (+v).toFixed(1), max: 1, labelFmt: (v) => v.toFixed(2) });
  const rows = [];
  S.forEach((s) => s.cases.forEach((c) => { const x = c.metrics; rows.push(`<tr><td>${s.id}</td><td>${c.id}</td><td>${fmt(c.added)}</td><td>${fmt(c.removed)}</td><td>${pct(x.change_rate, 2)}</td><td>${pct(x.raw_change_rate, 2)}</td><td>${x.precision != null ? x.precision.toFixed(2) : '-'}</td><td>${x.recall != null ? x.recall.toFixed(2) : '-'}</td></tr>`); }));
  $('resTable').innerHTML = `<thead><tr><th>Scene</th><th>Case</th><th>Added</th><th>Removed</th><th>Change rate</th><th>Raw baseline</th><th>Precision</th><th>Recall</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

function buildBenchmark() {
  const b = state.bench;
  const info = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6.5"/><path d="M8 7v4"/><circle cx="8" cy="4.8" r=".6" fill="currentColor"/></svg>';
  if (!b || !b.runs || !b.runs.length) {
    $('benchNotice').innerHTML = `<div class="notice">${info}<div>No benchmark results yet. Run <code>python3 python/benchmark.py</code> or the Colab notebook, then re-run <code>python/export_web.py</code>.</div></div>`;
    return;
  }
  const hasCuda = b.runs.some((r) => r.impl === 'cuda');
  $('benchNotice').innerHTML = hasCuda ? '' : `<div class="notice">${info}<div>CPU numbers from a ${b.cpu_count}-core machine. CUDA timings are pending: run <code>notebooks/colab_benchmark.ipynb</code> on a Colab GPU and commit <code>results/benchmark.json</code>.</div></div>`;
  const n = Math.max(...b.runs.map((r) => r.n));
  const runs = b.runs.filter((r) => r.n === n);
  const name = (r) => (r.impl === 'serial' ? 'Serial' : r.impl === 'openmp' ? `OpenMP ${r.threads}T` : 'CUDA');
  const color = (r) => (r.impl === 'serial' ? '#5a6270' : r.impl === 'openmp' ? COL.accent : '#3ecf8e');
  $('benchSub').textContent = `${b.scene}, ${b.case}, ${n}³ grid, ${fmt(runs[0].gaussians_a + runs[0].gaussians_b)} Gaussians. Lower is better.`;
  const best = runs.reduce((a, r) => (r.speedup > a.speedup ? r : a), runs[0]);
  const serial = runs.find((r) => r.impl === 'serial');
  $('benchCards').innerHTML = `
    <div class="card"><div class="k">Serial total</div><div class="big" id="bc0"></div><div class="cap">${n}³ grid, one core</div></div>
    <div class="card accent"><div class="k">Best time</div><div class="big" id="bc1"></div><div class="cap">${name(best)}</div></div>
    <div class="card good"><div class="k">Best speedup</div><div class="big" id="bc2"></div><div class="cap">over serial C</div></div>
    <div class="card"><div class="k">Splat kernel share</div><div class="big" id="bc3"></div><div class="cap">of serial time, the atomic-add hot spot</div></div>`;
  countUp($('bc0'), serial.total * 1000, { dec: 0, suffix: 'ms' });
  countUp($('bc1'), best.total * 1000, { dec: 0, suffix: 'ms' });
  countUp($('bc2'), best.speedup, { dec: 1, suffix: '×' });
  countUp($('bc3'), (serial.t_splat / serial.total) * 100, { dec: 0, suffix: '%' });
  const labels = runs.map(name);
  barChart('chTime', labels, [{ label: 'Total (ms)', data: runs.map((r) => r.total * 1000), backgroundColor: runs.map(color) }], { yFmt: (v) => `${Math.round(v)} ms`, log: true, labelFmt: (v) => (v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`) });
  barChart('chSpeed', labels, [{ label: 'Speedup', data: runs.map((r) => r.speedup), backgroundColor: runs.map(color) }], { yFmt: (v) => `${(+v).toFixed(0)}×`, labelFmt: (v) => `${v.toFixed(1)}×` });
  const ms = (x) => (x * 1000).toFixed(1);
  $('benchTable').innerHTML = `<thead><tr><th>Implementation</th><th>Grid</th><th>Splat (ms)</th><th>Compare (ms)</th><th>Reduce (ms)</th><th>Total (ms)</th><th>Speedup</th></tr></thead><tbody>${
    b.runs.map((r) => `<tr><td>${name(r)}</td><td>${r.n}³</td><td>${ms(r.t_splat)}</td><td>${ms(r.t_compare)}</td><td>${ms(r.t_reduce)}</td><td>${ms(r.total)}</td><td>${r.speedup.toFixed(2)}×</td></tr>`).join('')}</tbody>`;
}

function buildDiagram() {
  const box = (x, y, w, t, s, c = '#2e333b') => `<g><rect x="${x}" y="${y}" width="${w}" height="72" rx="12" fill="#14171b" stroke="${c}"/>
    <text x="${x + w / 2}" y="${y + 32}" text-anchor="middle" fill="#eceef1" font-size="15" font-weight="600">${t}</text>
    <text x="${x + w / 2}" y="${y + 52}" text-anchor="middle" fill="#6b727c" font-size="12">${s}</text></g>`;
  const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2 - 6} ${y2}" fill="none" stroke="#3a404a" stroke-width="1.5" marker-end="url(#ah)"/>`;
  const dots = (cx, cy, col) => [[-14, -6, 7], [4, -10, 5], [12, 6, 8], [-4, 10, 6], [-20, 8, 4]].map(([dx, dy, r]) => `<circle cx="${cx + dx}" cy="${cy + dy}" r="${r}" fill="${col}" fill-opacity=".55"/>`).join('');
  $('diagram').innerHTML = `<svg viewBox="0 0 1040 250" font-family="Inter, sans-serif" role="img" aria-label="SplatDiff pipeline">
    <defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8z" fill="#3a404a"/></marker></defs>
    ${box(20, 30, 180, 'Scene A (t)', '3DGS, 90k to 250k Gaussians')}${box(20, 148, 180, 'Scene B (t+1)', 'different Gaussians')}
    ${dots(232, 66, '#ffb547')}${dots(232, 184, '#ff5a5f')}
    ${arrow(256, 66, 330, 66)}${arrow(256, 184, 330, 184)}
    ${box(330, 30, 220, 'Canonical field Φ_A', 'K1: splat-to-grid, atomics', '#6e8bff')}${box(330, 148, 220, 'Canonical field Φ_B', '128³ voxels, colour-free', '#6e8bff')}
    ${arrow(550, 66, 620, 125)}${arrow(550, 184, 620, 125)}
    ${box(620, 89, 180, 'Compare', 'K2: Φ > 0.15, dilate 1', '#6e8bff')}
    ${arrow(800, 125, 850, 125)}
    ${box(850, 89, 170, 'Changes', 'K3: reduce counts', '#ff5a5f')}
    <text x="20" y="246" fill="#6b727c" font-size="12">Kernels K1 to K3 run in serial C, OpenMP and CUDA.</text>
  </svg>`;
}

// ---------- boot ----------
function bind() {
  $$('#nav button').forEach((b) => (b.onclick = () => showPage(b.dataset.page)));
  $('scene').onchange = (e) => { state.scene = e.target.value; state.cam = SCENE_CAM[state.scene]?.cam || 'front'; if (!currentCase()) state.caseId = currentScene().cases[0].id; renderCases(); load(); };
  $('overlay').onchange = (e) => { state.overlay = e.target.checked; applyOverlay(); };
  $('onlyChanges').onchange = (e) => { state.only = e.target.checked; applyOverlay(); };
  $('ovOpacity').oninput = (e) => { state.opacity = parseFloat(e.target.value); applyOverlay(); };
  $$('#ovStyle button').forEach((b) => (b.onclick = () => { state.style = b.dataset.style; applyOverlay(); }));
  $$('[data-cam]').forEach((b) => (b.onclick = () => setCamera(b.dataset.cam, true)));
  $('autoRotate').onchange = (e) => setRotate(e.target.checked);
  $('btnRotate').onclick = () => setRotate(!state.rotate);
  $('btnReset').onclick = () => { setCamera('front', true); };
  $('btnSidebar').onclick = toggleSidebar;
  $('btnPresent').onclick = togglePresent;
  $('btnHelp').onclick = (e) => { e.stopPropagation(); $('help').classList.toggle('open'); };
  document.addEventListener('click', (e) => { if (!$('help').contains(e.target)) $('help').classList.remove('open'); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && $('app').classList.contains('present')) togglePresent(); });
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range')) return;
    const sc = currentScene(), k = parseInt(e.key, 10);
    if (k >= 1 && k <= sc.cases.length) { selectCase(sc.cases[k - 1].id); toast(`Case ${k}: ${sc.cases[k - 1].id}`); }
    else if (e.key === 'o' || e.key === 'O') { state.overlay = !state.overlay; applyOverlay(); toast(`Overlay ${state.overlay ? 'on' : 'off'}`); }
    else if (e.key === 'r' || e.key === 'R') setCamera('front', true);
    else if (e.key === ' ') { e.preventDefault(); setRotate(!state.rotate); toast(`Auto-rotate ${state.rotate ? 'on' : 'off'}`); }
    else if (e.key === 'p' || e.key === 'P') togglePresent();
    else if (e.key === '?') $('help').classList.toggle('open');
    else if (e.key === 'Escape') $('help').classList.remove('open');
  });
}

async function main() {
  chartDefaults();
  bind();
  buildDiagram();
  state.manifest = await (await fetch('data/manifest.json')).json();
  try { const r = await fetch('data/benchmark.json'); if (r.ok) state.bench = await r.json(); } catch (e) { /* placeholder state */ }
  const q = new URLSearchParams(location.search);
  state.scene = state.manifest.scenes.some((s) => s.id === q.get('scene')) ? q.get('scene') : state.manifest.scenes[0].id;
  if (currentScene().cases.some((c) => c.id === q.get('case'))) state.caseId = q.get('case');
  state.cam = CAM_DIRS[q.get('cam')] ? q.get('cam') : SCENE_CAM[state.scene]?.cam || 'front';
  if (q.get('style')) state.style = q.get('style');
  if (q.get('page')) showPage(q.get('page'));
  $('scene').innerHTML = state.manifest.scenes.map((s) => `<option value="${s.id}">${s.id}</option>`).join('');
  $('scene').value = state.scene;
  initWipe();
  renderCases();
  await load();
  window.__splatdiffReady = true;
}

main().catch((e) => { console.error(e); setLoading(true, 0, `Error: ${e.message}`); });
