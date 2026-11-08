"""Report and slide figures from results/*.json.

Usage: python3 python/figures.py [outdir]   (default results/figures)
Writes PNG charts at 200 dpi with a light theme (prints well in the report).
"""
import json
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "results", "figures")

ACCENT = "#5b6cff"   # SplatDiff
GREY = "#9aa1ad"     # raw baseline
CUDA = "#76b900"
OMP = "#f2a33a"
CASE_NAME = {"reparam": "Re-param", "color": "Colour", "move": "Move", "delete": "Delete", "copy": "Copy"}
CASES = ["reparam", "color", "move", "delete", "copy"]
EDITS = ["move", "delete", "copy"]

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False,
    "axes.spines.right": False, "axes.edgecolor": "#888", "axes.titleweight": "bold",
    "axes.titlesize": 11, "legend.frameon": False, "savefig.dpi": 200,
    "savefig.bbox": "tight", "axes.grid": True, "grid.color": "#e5e7eb", "axes.axisbelow": True,
})


def load(name):
    with open(os.path.join(ROOT, "results", name)) as f:
        return json.load(f)


def label_bars(ax, bars, fmt):
    for b in bars:
        h = b.get_height()
        ax.annotate(fmt(h), (b.get_x() + b.get_width() / 2, h), xytext=(0, 2),
                    textcoords="offset points", ha="center", va="bottom", fontsize=7)


def bottom_legend(fig, ax, ncol=2):
    h, lab = ax.get_legend_handles_labels()
    fig.legend(h, lab, loc="lower center", ncol=ncol, bbox_to_anchor=(0.5, -0.1))


def grouped(ax, groups, series, colors, names, fmt, width=0.38):
    xs = range(len(groups))
    for i, (vals, c, n) in enumerate(zip(series, colors, names)):
        off = (i - (len(series) - 1) / 2) * width
        bars = ax.bar([x + off for x in xs], vals, width, color=c, label=n)
        label_bars(ax, bars, fmt)
    ax.set_xticks(list(xs))
    ax.set_xticklabels(groups)


def fig_change_rate(summary):
    fig, axes = plt.subplots(1, len(summary), figsize=(10, 3.4), sharey=True)
    for ax, (scene, res) in zip(axes, summary.items()):
        sd = [100 * res[c]["change_rate"] for c in CASES]
        raw = [100 * res[c]["raw_change_rate"] for c in CASES]
        grouped(ax, [CASE_NAME[c] for c in CASES], [sd, raw], [ACCENT, GREY],
                ["SplatDiff", "Raw baseline"], lambda v: f"{v:.1f}")
        ax.set_title(scene.capitalize())
    axes[0].set_ylabel("Voxels flagged as changed (%)")
    bottom_legend(fig, axes[0])
    fig.suptitle("Change rate per test case (re-param and colour should be near 0)", fontsize=11, y=1.04)
    return fig


def fig_precision_recall(summary):
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.4), sharey=True)
    groups = [f"{s}\n{CASE_NAME[c]}" for s in summary for c in EDITS]
    for ax, key in zip(axes, ["precision", "recall"]):
        sd = [summary[s][c][key] for s in summary for c in EDITS]
        raw = [summary[s][c]["raw_" + key] for s in summary for c in EDITS]
        grouped(ax, groups, [sd, raw], [ACCENT, GREY], ["SplatDiff", "Raw baseline"],
                lambda v: f"{v:.2f}")
        ax.set_title(key.capitalize())
        ax.set_ylim(0, 1.12)
    bottom_legend(fig, axes[0])
    fig.suptitle("Edit cases against ground truth (128^3 grid)", fontsize=11, y=1.04)
    return fig


def fig_benchmark(bench):
    runs = bench["runs"]
    ns = sorted({r["n"] for r in runs})

    def pick(impl, n, threads=None):
        for r in runs:
            if r["impl"] == impl and r["n"] == n and (threads is None or r.get("threads") == threads):
                return r
        return None

    impls = [("serial", 1, "Serial C", GREY), ("openmp", 2, "OpenMP (2 vCPU)", OMP),
             ("cuda", None, "CUDA (T4)", CUDA)]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.4))
    groups = [f"{n}^3" for n in ns]
    times, speed, names, cols = [], [], [], []
    for impl, th, name, col in impls:
        rs = [pick(impl, n, th) for n in ns]
        if any(r is None for r in rs):
            continue
        times.append([1000 * r["total"] for r in rs])
        speed.append([r["speedup"] for r in rs])
        names.append(name)
        cols.append(col)
    w = 0.8 / len(times)
    grouped(a1, groups, times, cols, names, lambda v: f"{v:.0f}" if v >= 10 else f"{v:.1f}", w)
    a1.set_yscale("log")
    a1.set_ylabel("Total kernel time (ms, log)")
    a1.set_title("Time per grid size")
    bottom_legend(fig, a1, 3)
    grouped(a2, groups, speed, cols, names, lambda v: f"{v:.1f}x", w)
    a2.set_ylabel("Speedup over serial")
    a2.set_title("Speedup")
    fig.suptitle(f"{bench['scene']} / {bench['case']}: splat + compare + reduce "
                 "(CUDA excludes host-to-device copy)", fontsize=11, y=1.04)
    return fig


def fig_breakdown(bench):
    n = max(r["n"] for r in bench["runs"])
    rows = [("Serial", "serial", 1), ("OpenMP x2", "openmp", 2), ("CUDA", "cuda", None)]
    fig, ax = plt.subplots(figsize=(6, 3))
    labels, parts = [], {"t_splat": [], "t_compare": [], "t_reduce": []}
    for name, impl, th in rows:
        r = next((r for r in bench["runs"] if r["impl"] == impl and r["n"] == n
                  and (th is None or r.get("threads") == th)), None)
        if r is None:
            continue
        labels.append(name)
        tot = r["t_splat"] + r["t_compare"] + r["t_reduce"]
        for k in parts:
            parts[k].append(100 * r[k] / tot)
    left = [0] * len(labels)
    for k, c, nm in [("t_splat", ACCENT, "K1 splat"), ("t_compare", OMP, "K2 compare"),
                     ("t_reduce", "#e5484d", "K3 reduce")]:
        ax.barh(labels, parts[k], left=left, color=c, label=nm)
        left = [a + b for a, b in zip(left, parts[k])]
    ax.set_xlabel("Share of kernel time (%)")
    ax.set_xlim(0, 100)
    ax.invert_yaxis()
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=3)
    ax.set_title(f"Kernel breakdown at {n}^3", pad=24)
    return fig


def main():
    os.makedirs(OUT, exist_ok=True)
    summary = load("summary.json")
    bench = load("benchmark.json")
    figs = {"change_rate.png": fig_change_rate(summary),
            "precision_recall.png": fig_precision_recall(summary),
            "benchmark_speedup.png": fig_benchmark(bench),
            "kernel_breakdown.png": fig_breakdown(bench)}
    for name, fig in figs.items():
        fig.savefig(os.path.join(OUT, name))
        plt.close(fig)
        print("wrote", os.path.join(OUT, name))


if __name__ == "__main__":
    main()
