"""Correctness test: C serial and OpenMP kernels vs the NumPy reference (python/canon.py).

Usage: python3 python/test_kernels.py [scene] [case] [N]   (defaults: guitar reparam 48)
Requires: make -C kernels, python3 python/prepare.py
Also tests kernels/cuda/splatdiff_cuda if it has been built (Colab).
Pass criteria: relative L2 error of Phi < 1e-3, occupancy masks agree on > 99.9% of voxels,
added/removed counts within 0.5% of reference occupied voxels.
"""
import os
import sys
import json
import subprocess
import tempfile
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from splatio import import_binary, scene_bbox
from canon import make_grid, canonical_field, compare

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run(exe, a, b, grid, n, prefix, threads=None):
    env = dict(os.environ)
    if threads:
        env["OMP_NUM_THREADS"] = str(threads)
    hi = grid["lo"] + grid["h"] * n
    args = [exe, a, b, str(n), *map(repr, map(float, grid["lo"])), *map(repr, map(float, hi)), prefix]
    out = subprocess.run(args, capture_output=True, text=True, env=env, check=True).stdout
    return json.loads(out)


def main(scene="guitar", case="reparam", n=48):
    bdir = os.path.join(ROOT, "data/bin", scene)
    a, b = os.path.join(bdir, "base.bin"), os.path.join(bdir, f"{case}.bin")
    da, db = import_binary(a), import_binary(b)
    grid = make_grid(*scene_bbox(da["pos"]), n=n)
    ref_a, ref_b = canonical_field(da, grid), canonical_field(db, grid)
    oa, ob, add, rem = compare(ref_a, ref_b)
    ok = True
    with tempfile.TemporaryDirectory() as tmp:
        exes = [os.path.join(ROOT, "kernels/serial", e) for e in ["splatdiff_serial", "splatdiff_omp"]]
        cu = os.path.join(ROOT, "kernels/cuda/splatdiff_cuda")
        if os.path.exists(cu):
            exes.append(cu)
        for exe in exes:
            name = os.path.basename(exe)
            res = run(exe, a, b, grid, n, os.path.join(tmp, name))
            pa = np.fromfile(os.path.join(tmp, name + "_phiA.f32"), np.float32).reshape(n, n, n)
            lab = np.fromfile(os.path.join(tmp, name + "_labels.u8"), np.uint8).reshape(n, n, n)
            err = np.linalg.norm(pa - ref_a) / np.linalg.norm(ref_a)
            agree = np.mean(((lab & 1) > 0) == oa)
            dadd = abs(res["added"] - int(add.sum())) / max(int((oa | ob).sum()), 1)
            drem = abs(res["removed"] - int(rem.sum())) / max(int((oa | ob).sum()), 1)
            passed = err < 1e-3 and agree > 0.999 and dadd < 0.005 and drem < 0.005
            ok &= passed
            print(f"{name:18s} relL2={err:.2e} occAgree={agree:.5f} added {res['added']} (ref {int(add.sum())}) "
                  f"removed {res['removed']} (ref {int(rem.sum())})  {'PASS' if passed else 'FAIL'}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0] if a else "guitar", a[1] if len(a) > 1 else "reparam", int(a[2]) if len(a) > 2 else 48)
