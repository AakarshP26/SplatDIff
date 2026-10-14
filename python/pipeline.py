"""End-to-end SplatDiff pipeline: run the OpenMP kernels on every scene/case and score them.

Usage: python3 python/pipeline.py [--n 128] [--exe kernels/serial/splatdiff_omp] [scene ...]
Requires: make -C kernels; python3 python/prepare.py
Writes results/<scene>.json and results/summary.json

Metrics (all on the N^3 grid, occupancy threshold 0.15):
  false_change  = (added + removed) / occupied, for cases with no geometric change (reparam, color)
  precision     = detected voxels within 1 voxel of a ground-truth change / detected voxels
  recall        = ground-truth change voxels within 1 voxel of a detection / ground-truth voxels
  Ground truth  = SplatDiff applied to (base, edit without re-parameterisation).
Raw baseline: point histogram of Gaussian centres (sum of alpha per voxel, no extent, no mass model)
compared with the same occupancy/dilation rule. It shows what naive per-Gaussian comparison does.
"""
import os
import sys
import json
import argparse
import subprocess
import tempfile
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from splatio import import_binary, scene_bbox
from canon import compare, dilate
from testcases import CASES, EDIT_CASES

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run_kernels(exe, a, b, lo, hi, n, prefix):
    args = [exe, a, b, str(n), *map(repr, map(float, lo)), *map(repr, map(float, hi)), prefix, "1"]
    res = json.loads(subprocess.run(args, capture_output=True, text=True, check=True).stdout)
    lab = np.fromfile(prefix + "_labels.u8", np.uint8).reshape(n, n, n)
    return res, lab


def raw_labels(da, db, lo, hi, n):
    def hist(d):
        h = (hi - lo) / n
        c = np.floor((d["pos"] - lo) / h).astype(int)
        ok = np.all((c >= 0) & (c < n), 1)
        f = np.zeros((n, n, n))
        np.add.at(f, tuple(c[ok].T), d["alpha"][ok])
        return f
    oa, ob, add, rem = compare(hist(da), hist(db))
    return oa, ob, add, rem


def score(det, gt):
    if gt.sum() == 0:
        return None, None
    prec = float((det & dilate(gt)).sum() / max(det.sum(), 1))
    rec = float((gt & dilate(det)).sum() / gt.sum())
    return prec, rec


def run_scene(scene, exe, n, tmp):
    bdir = os.path.join(ROOT, "data/bin", scene)
    base = os.path.join(bdir, "base.bin")
    da = import_binary(base)
    lo, hi = scene_bbox(da["pos"])
    out = {"scene": scene, "n": n, "bbox": [lo.tolist(), hi.tolist()], "cases": {}}
    for c in CASES:
        cb = os.path.join(bdir, f"{c}.bin")
        res, lab = run_kernels(exe, base, cb, lo, hi, n, os.path.join(tmp, f"{scene}_{c}"))
        det = (lab & 12) > 0
        occ = int(((lab & 3) > 0).sum())
        db = import_binary(cb)
        roa, rob, radd, rrem = raw_labels(da, db, lo, hi, n)
        rdet = radd | rrem
        r = {"gaussians_a": res["gaussians_a"], "gaussians_b": res["gaussians_b"],
             "occupied": occ, "added": res["added"], "removed": res["removed"],
             "change_rate": (res["added"] + res["removed"]) / max(occ, 1),
             "raw_change_rate": float(rdet.sum() / max((roa | rob).sum(), 1)),
             "timing": {k: res[k] for k in ("t_splat", "t_compare", "t_reduce")}}
        if c in EDIT_CASES:
            _, glab = run_kernels(exe, base, os.path.join(bdir, f"{c}_gt.bin"), lo, hi, n,
                                  os.path.join(tmp, f"{scene}_{c}_gt"))
            gt = (glab & 12) > 0
            r["gt_voxels"] = int(gt.sum())
            r["precision"], r["recall"] = score(det, gt)
            r["raw_precision"], r["raw_recall"] = score(rdet, gt)
        out["cases"][c] = r
        extra = f" P={r['precision']:.2f} R={r['recall']:.2f} (raw P={r['raw_precision']:.2f})" if c in EDIT_CASES else ""
        print(f"{scene:7s} {c:8s} change {100 * r['change_rate']:6.2f}%  raw {100 * r['raw_change_rate']:6.2f}%{extra}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=128)
    ap.add_argument("--exe", default=os.path.join(ROOT, "kernels/serial/splatdiff_omp"))
    ap.add_argument("scenes", nargs="*", default=["guitar", "biker"])
    a = ap.parse_args()
    os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
    summary = {}
    with tempfile.TemporaryDirectory() as tmp:
        for s in a.scenes:
            r = run_scene(s, a.exe, a.n, tmp)
            with open(os.path.join(ROOT, "results", f"{s}.json"), "w") as f:
                json.dump(r, f, indent=2)
            summary[s] = {c: {k: v for k, v in r["cases"][c].items() if k != "timing"} for c in r["cases"]}
    with open(os.path.join(ROOT, "results", "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)


if __name__ == "__main__":
    main()
