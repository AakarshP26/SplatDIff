"""Speedup study: serial vs OpenMP (1..P threads) vs CUDA.

Usage: python3 python/benchmark.py [--sizes 64 128 256] [--scene biker] [--case move] [--reps 3]
Writes results/benchmark.json (read by the web UI Benchmark tab and by make_figures).
Missing executables are skipped, so it runs on a CPU-only machine too.
"""
import os
import sys
import json
import argparse
import platform
import subprocess

sys.path.insert(0, os.path.dirname(__file__))
from splatio import import_binary, scene_bbox

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
EXE = {"serial": "kernels/serial/splatdiff_serial", "openmp": "kernels/serial/splatdiff_omp",
       "cuda": "kernels/cuda/splatdiff_cuda"}


def run(exe, a, b, n, lo, hi, reps, threads=None):
    env = dict(os.environ)
    if threads:
        env["OMP_NUM_THREADS"] = str(threads)
    args = [exe, a, b, str(n), *map(repr, map(float, lo)), *map(repr, map(float, hi)), "", str(reps)]
    return json.loads(subprocess.run(args, capture_output=True, text=True, env=env, check=True).stdout)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", type=int, nargs="+", default=[64, 128, 256])
    ap.add_argument("--scene", default="biker")
    ap.add_argument("--case", default="move")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--threads", type=int, nargs="+", default=None)
    a = ap.parse_args()
    bdir = os.path.join(ROOT, "data/bin", a.scene)
    fa, fb = os.path.join(bdir, "base.bin"), os.path.join(bdir, f"{a.case}.bin")
    lo, hi = scene_bbox(import_binary(fa)["pos"])
    ncpu = os.cpu_count() or 1
    threads = a.threads or sorted({1, 2, 4, 8, ncpu} & set(range(1, ncpu + 1)))
    out = {"scene": a.scene, "case": a.case, "cpu": platform.processor() or platform.machine(),
           "cpu_count": ncpu, "runs": []}
    for n in a.sizes:
        for impl, rel in EXE.items():
            exe = os.path.join(ROOT, rel)
            if not os.path.exists(exe):
                continue
            for t in (threads if impl == "openmp" else [None]):
                r = run(exe, fa, fb, n, lo, hi, a.reps, t)
                r["total"] = r["t_splat"] + r["t_compare"] + r["t_reduce"]
                out["runs"].append(r)
                print(f"N={n:4d} {impl:7s} thr={str(t or '-'):3s} splat {r['t_splat']*1e3:9.2f} ms  "
                      f"compare {r['t_compare']*1e3:8.2f} ms  reduce {r['t_reduce']*1e3:7.3f} ms")
    for r in out["runs"]:
        base = next(x for x in out["runs"] if x["impl"] == "serial" and x["n"] == r["n"])
        r["speedup"] = base["total"] / r["total"]
    os.makedirs(os.path.join(ROOT, "results"), exist_ok=True)
    with open(os.path.join(ROOT, "results", "benchmark.json"), "w") as f:
        json.dump(out, f, indent=2)
    print("wrote results/benchmark.json")


if __name__ == "__main__":
    main()
