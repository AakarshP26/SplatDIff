// SplatDiff web viewer (basic version, task 7).
// Two Gaussian splat viewers stacked on top of each other: A = scene at t (base),
// B = scene at t+1 (selected case). B is clipped by the wipe slider and shares A's camera.
import * as THREE from 'three';
import * as GS from '../vendor/gaussian-splats-3d.module.js';

const $ = (id) => document.getElementById(id);
const state = { manifest: null, scene: null, caseId: 'move', wipe: 0.5, overlay: true };
let viewerA = null, viewerB = null, boxesA = null, boxesB = null, grid = null;

function setLoading(on, frac = 0, msg = '') {
  $('loading').classList.toggle('hide', !on);
  $('bar').style.width = `${Math.round(frac * 100)}%`;
  if (msg) $('loadmsg').textContent = msg;
}

function makeBoxes(voxels, g, color) {
  const geo = new THREE.BoxGeometry(g.h[0], g.h[1], g.h[2]);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(voxels.length, 1));
  const m = new THREE.Matrix4();
  voxels.forEach((v, i) => {
    m.makeTranslation(g.lo[0] + (v[0] + 0.5) * g.h[0], g.lo[1] + (v[1] + 0.5) * g.h[1], g.lo[2] + (v[2] + 0.5) * g.h[2]);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = voxels.length;
  mesh.renderOrder = 10;
  return mesh;
}

// Default framing: look at the centre of the occupied region (5th-95th percentile box from
// export_web.py) from the front, slightly above (scenes are -y up), at a distance that fits it.
function cameraFor(focus) {
  const c = focus.center, r = focus.radius;
  const d = r / Math.tan((25 * Math.PI) / 180);
  const dir = [0.25, -0.35, -1];
  const len = Math.hypot(...dir);
  return { lookAt: c, pos: c.map((v, k) => v + (dir[k] / len) * d) };
}

function makeViewer(root, cam, sharedCamera) {
  const opts = {
    rootElement: root, cameraUp: [0, -1, 0], initialCameraPosition: cam.pos, initialCameraLookAt: cam.lookAt,
    sharedMemoryForWorkers: false, gpuAcceleratedSort: false, useBuiltInControls: !sharedCamera,
  };
  if (sharedCamera) opts.camera = sharedCamera;
  return new GS.Viewer(opts);
}

async function disposeViewers() {
  for (const v of [viewerB, viewerA]) if (v) { try { await v.dispose(); } catch (e) { /* ignore */ } }
  $('viewA').innerHTML = ''; $('viewB').innerHTML = '';
  viewerA = viewerB = null;
}

async function load() {
  setLoading(true, 0, `Loading ${state.scene} / ${state.caseId}`);
  await disposeViewers();
  const base = `data/${state.scene}`;
  const ch = await (await fetch(`${base}/${state.caseId}.changes.json`)).json();
  grid = ch.grid;
  const cam = cameraFor(ch.focus);
  viewerA = makeViewer($('viewA'), cam, null);
  await viewerA.addSplatScene(`${base}/base.ply`, { format: GS.SceneFormat.Ply, showLoadingUI: false,
    onProgress: (p) => setLoading(true, p / 200, 'Loading scene at t') });
  viewerB = makeViewer($('viewB'), cam, viewerA.camera);
  await viewerB.addSplatScene(`${base}/${state.caseId}.ply`, { format: GS.SceneFormat.Ply, showLoadingUI: false,
    onProgress: (p) => setLoading(true, 0.5 + p / 200, 'Loading scene at t+1') });
  boxesA = makeBoxes(ch.removed, grid, 0xffb020);
  boxesB = makeBoxes(ch.added, grid, 0xff4d4f);
  viewerA.threeScene.add(boxesA);
  viewerB.threeScene.add(boxesB);
  applyOverlay();
  viewerA.start(); viewerB.start();
  $('stats').innerHTML = `<b class="add">${ch.added.length}</b> added &middot; <b class="rem">${ch.removed.length}</b> removed voxels`;
  setLoading(false, 1);
}

function applyOverlay() {
  if (boxesA) boxesA.visible = state.overlay;
  if (boxesB) boxesB.visible = state.overlay;
}

function applyWipe() {
  const pct = (state.wipe * 100).toFixed(2);
  $('viewB').style.clipPath = `inset(0 0 0 ${pct}%)`;
  $('wipe').style.left = `${pct}%`;
}

function initWipe() {
  let drag = false;
  const move = (e) => {
    if (!drag) return;
    const r = $('stage').getBoundingClientRect();
    state.wipe = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    applyWipe();
  };
  $('wipe').addEventListener('pointerdown', (e) => { drag = true; $('wipe').setPointerCapture(e.pointerId); });
  $('wipe').addEventListener('pointermove', move);
  $('wipe').addEventListener('pointerup', () => { drag = false; });
  applyWipe();
}

function renderCases() {
  const sc = state.manifest.scenes.find((s) => s.id === state.scene);
  $('cases').innerHTML = '';
  sc.cases.forEach((c, i) => {
    const b = document.createElement('button');
    b.textContent = c.id;
    b.title = `${c.id} (key ${i + 1})`;
    b.className = c.id === state.caseId ? 'on' : '';
    b.onclick = () => { state.caseId = c.id; renderCases(); load(); };
    $('cases').appendChild(b);
  });
}

async function main() {
  state.manifest = await (await fetch('data/manifest.json')).json();
  state.scene = state.manifest.scenes[0].id;
  $('scene').innerHTML = state.manifest.scenes.map((s) => `<option>${s.id}</option>`).join('');
  $('scene').onchange = (e) => { state.scene = e.target.value; renderCases(); load(); };
  $('overlay').onchange = (e) => { state.overlay = e.target.checked; applyOverlay(); };
  window.addEventListener('keydown', (e) => {
    const sc = state.manifest.scenes.find((s) => s.id === state.scene);
    const k = parseInt(e.key, 10);
    if (k >= 1 && k <= sc.cases.length) { state.caseId = sc.cases[k - 1].id; renderCases(); load(); }
    if (e.key === 'o' || e.key === 'O') { $('overlay').checked = state.overlay = !state.overlay; applyOverlay(); }
  });
  initWipe();
  renderCases();
  await load();
  window.__splatdiffReady = true;
}

main().catch((e) => { console.error(e); setLoading(true, 0, `Error: ${e.message}`); });
