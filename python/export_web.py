"""Export scenes and change voxels for the web viewer.

Usage: python3 python/export_web.py [--n 128] [scene ...]
Writes (generated, not committed):
  web/data/<scene>/base.ply, web/data/<scene>/<case>.ply   float PLY copies for the viewer
  web/data/<scene>/<case>.changes.json                     changed voxels
  web/data/manifest.json                                   scenes, cases, metrics

changes.json: {"grid": {"lo": [3], "h": [3], "n": N},
               "added": [[i, j, k], ...], "removed": [[i, j, k], ...]}
Voxel centre in scene coordinates = lo + (idx + 0.5) * h.
"""
import os
import sys
import json
import shutil
import argparse
import tempfile
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from splatio import import_binary, scene_bbox
from testcases import CASES
from pipeline import run_kernels

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=128)
    ap.add_argument("--exe", default=os.path.join(ROOT, "kernels/serial/splatdiff_omp"))
    ap.add_argument("scenes", nargs="*", default=["guitar", "biker"])
    a = ap.parse_args()
    summary_path = os.path.join(ROOT, "results", "summary.json")
    summary = json.load(open(summary_path)) if os.path.exists(summary_path) else {}
    manifest = {"scenes": []}
    with tempfile.TemporaryDirectory() as tmp:
        for s in a.scenes:
            out = os.path.join(ROOT, "web/data", s)
            os.makedirs(out, exist_ok=True)
            shutil.copyfile(os.path.join(ROOT, "data/converted", f"{s}.ply"), os.path.join(out, "base.ply"))
            base = os.path.join(ROOT, "data/bin", s, "base.bin")
            lo, hi = scene_bbox(import_binary(base)["pos"])
            h = (hi - lo) / a.n
            entry = {"id": s, "cases": []}
            for c in CASES:
                shutil.copyfile(os.path.join(ROOT, "data/cases", s, f"{c}.ply"), os.path.join(out, f"{c}.ply"))
                _, lab = run_kernels(a.exe, base, os.path.join(ROOT, "data/bin", s, f"{c}.bin"),
                                     lo, hi, a.n, os.path.join(tmp, f"{s}_{c}"))
                ch = {"grid": {"lo": lo.tolist(), "h": h.tolist(), "n": a.n},
                      "added": np.argwhere(lab & 4).tolist(),
                      "removed": np.argwhere(lab & 8).tolist()}
                with open(os.path.join(out, f"{c}.changes.json"), "w") as f:
                    json.dump(ch, f, separators=(",", ":"))
                entry["cases"].append({"id": c, "added": len(ch["added"]), "removed": len(ch["removed"]),
                                       "metrics": summary.get(s, {}).get(c, {})})
                print(f"{s:7s} {c:8s} added {len(ch['added']):6d} removed {len(ch['removed']):6d}")
            manifest["scenes"].append(entry)
    with open(os.path.join(ROOT, "web/data/manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)


if __name__ == "__main__":
    main()
