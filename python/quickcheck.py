"""Quick end-to-end check of the reference pipeline on one scene.

Usage: python3 python/quickcheck.py [scene] [N]
Prints false-change rate (reparam, color) against a raw L1 baseline, and
precision/recall for the move case against the ground-truth moved region.
"""
import os
import sys
import time
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from splatio import load_ply, decode, scene_bbox
from canon import make_grid, canonical_field, compare, dilate
from testcases import make_case, object_mask

ROOT = os.path.join(os.path.dirname(__file__), "..")


def raw_l1_rate(da, db, grid):
    """Baseline: per-voxel opacity sum (no mass model) compared with relative L1."""
    def hist(d):
        c = np.floor((d["pos"] - grid["lo"]) / grid["h"]).astype(int)
        ok = np.all((c >= 0) & (c < grid["dims"]), 1)
        f = np.zeros(grid["dims"])
        np.add.at(f, tuple(c[ok].T), d["alpha"][ok])
        return f
    a, b = hist(da), hist(db)
    occ = (a > 0) | (b > 0)
    diff = np.abs(a - b) > 0.5 * np.maximum(a, b)
    return float((diff & occ).sum() / max(occ.sum(), 1))


def main(scene="biker", n=128):
    g = load_ply(os.path.join(ROOT, "data/converted", f"{scene}.ply"))
    da = decode(g)
    grid = make_grid(*scene_bbox(da["pos"]), n=n)
    t = time.time()
    pa = canonical_field(da, grid)
    print(f"{scene}: grid {grid['dims']}  base field {time.time() - t:.1f}s  occupied {int((pa > 0.15).sum())}")
    for c in ["reparam", "color", "move"]:
        h = make_case(g, c, seed=0)
        db = decode(h)
        pb = canonical_field(db, grid)
        oa, ob, add, rem = compare(pa, pb)
        occ = (oa | ob).sum()
        rate = (add.sum() + rem.sum()) / occ
        line = f"  {c:8s} changed {100 * rate:5.2f}%  raw L1 {100 * raw_l1_rate(da, db, grid):5.1f}%"
        if c == "move":
            m, _ = object_mask(g)
            lo, hi = scene_bbox(da["pos"])
            # ground truth: compare ideal fields (base vs base with object moved, no reparam)
            moved = {k: v.copy() for k, v in da.items()}
            moved["pos"][m] += np.array([0.18 * (hi - lo)[0], 0, 0])
            _, _, ga, gr = compare(pa, canonical_field(moved, grid))
            gt = ga | gr
            det = add | rem
            prec = (det & dilate(gt)).sum() / max(det.sum(), 1)
            rec = (gt & dilate(det)).sum() / max(gt.sum(), 1)
            line += f"  precision {prec:.2f}  recall {rec:.2f}"
        print(line)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "biker", int(sys.argv[2]) if len(sys.argv) > 2 else 128)
