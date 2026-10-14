"""Generate test-case scenes and binary exports.

Usage: python3 python/prepare.py [scene ...]   (default: guitar biker)
Reads  data/converted/<scene>.ply   (run scripts/convert.sh first)
Writes data/cases/<scene>/<case>.ply and data/bin/<scene>/{base,<case>,<case>_gt}.bin
(<case>_gt = geometric edit without re-parameterisation, used as ground truth)
"""
import os
import sys
import json
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from splatio import load_ply, save_ply, decode, export_binary
from testcases import CASES, EDIT_CASES, make_case, edit

ROOT = os.path.join(os.path.dirname(__file__), "..")


def main(scenes):
    for s in scenes:
        g = load_ply(os.path.join(ROOT, "data/converted", f"{s}.ply"))
        cdir = os.path.join(ROOT, "data/cases", s)
        bdir = os.path.join(ROOT, "data/bin", s)
        os.makedirs(cdir, exist_ok=True)
        os.makedirs(bdir, exist_ok=True)
        export_binary(os.path.join(bdir, "base.bin"), decode(g))
        info = {"scene": s, "base_count": int(len(g["x"])), "cases": {}}
        for c in CASES:
            h = make_case(g, c, seed=0)
            save_ply(os.path.join(cdir, f"{c}.ply"), h)
            export_binary(os.path.join(bdir, f"{c}.bin"), decode(h))
            info["cases"][c] = int(len(h["x"]))
            if c in EDIT_CASES:
                export_binary(os.path.join(bdir, f"{c}_gt.bin"), decode(edit(g, c)))
            print(f"{s:8s} {c:8s} {len(h['x']):8d} Gaussians")
        with open(os.path.join(bdir, "info.json"), "w") as f:
            json.dump(info, f, indent=2)


if __name__ == "__main__":
    main(sys.argv[1:] or ["guitar", "biker"])
