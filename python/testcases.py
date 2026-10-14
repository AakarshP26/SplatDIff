"""Synthetic test cases that mimic re-training a 3DGS scene at time t+1.

All functions take and return raw PLY field dicts (log scales, logit opacity),
so outputs can be written straight back to PLY and loaded by the viewer.

Cases:
  reparam  - split every Gaussian along its major axis, jitter, rescale opacity, prune.
             Geometry is unchanged, parameters are completely different.
  color    - global colour/lighting shift only. Geometry unchanged.
  move     - reparam + translate one solid object cluster.
  delete   - reparam + remove one object cluster.
  copy     - reparam + duplicate one object cluster at an offset.
"""
import numpy as np
from splatio import decode, sigmoid, logit, scene_bbox

CASES = ["reparam", "color", "move", "delete", "copy"]


def _take(g, idx):
    return {k: v[idx] for k, v in g.items()}


def _concat(a, b):
    return {k: np.concatenate([a[k], b[k]]) for k in a}


def reparam(g, rng):
    d = decode(g)
    n = len(d["alpha"])
    major = np.argmax(d["scale"], axis=1)
    s_major = d["scale"][np.arange(n), major]
    axis = d["rot"][np.arange(n), :, major]          # column `major` of R = major axis direction
    off = (0.5 * s_major)[:, None] * axis
    s_min = d["scale"].min(axis=1)

    out = []
    for sign in (+1.0, -1.0):
        h = {k: v.copy() for k, v in g.items()}
        p = d["pos"] + sign * off + rng.normal(0, 1, (n, 3)) * (0.15 * s_min)[:, None]
        h["x"], h["y"], h["z"] = (p[:, i].astype(np.float32) for i in range(3))
        sc = np.stack([g["scale_0"], g["scale_1"], g["scale_2"]], 1).copy()
        sc[np.arange(n), major] += np.log(0.5)
        for i in range(3):
            h[f"scale_{i}"] = sc[:, i].astype(np.float32)
        a = np.clip(d["alpha"] * rng.uniform(0.85, 1.15, n), 0, 0.999)
        h["opacity"] = logit(a).astype(np.float32)
        out.append(h)
    h = _concat(*out)
    keep = sigmoid(h["opacity"]) >= 0.03
    perm = rng.permutation(int(keep.sum()))      # order is meaningless in 3DGS
    return _take(_take(h, keep), perm)


def color(g, rng):
    h = {k: v.copy() for k, v in g.items()}
    # SH DC shift: warmer and brighter (simulates lighting / exposure change)
    for i, (gain, bias) in enumerate([(1.15, 0.25), (1.05, 0.10), (0.85, -0.15)]):
        h[f"f_dc_{i}"] = (g[f"f_dc_{i}"] * gain + bias).astype(np.float32)
    return h


def object_mask(g):
    """Gaussians within 0.08 * bbox diagonal of the most central solid Gaussian."""
    d = decode(g)
    lo, hi = scene_bbox(d["pos"])
    center = 0.5 * (lo + hi)
    solid = np.where(d["alpha"] > 0.3)[0]
    seed = solid[np.argmin(np.linalg.norm(d["pos"][solid] - center, axis=1))]
    r = 0.08 * np.linalg.norm(hi - lo)
    return np.linalg.norm(d["pos"] - d["pos"][seed], axis=1) < r, (lo, hi)


def _shift(g, mask, dx):
    h = {k: v.copy() for k, v in g.items()}
    h["x"][mask] += np.float32(dx)
    return h


def edit(g, name):
    """Apply only the geometric edit (no re-parameterisation). Used as ground truth."""
    m, (lo, hi) = object_mask(g)
    dx = 0.18 * (hi - lo)[0]
    if name == "move":
        return _shift(g, m, dx)
    if name == "delete":
        return _take(g, ~m)
    if name == "copy":
        return _concat(g, _shift(_take(g, m), np.ones(int(m.sum()), bool), dx))
    return g


EDIT_CASES = ["move", "delete", "copy"]


def make_case(g, name, seed=0):
    rng = np.random.default_rng(seed)
    if name == "color":
        return color(g, rng)
    return reparam(edit(g, name), rng)
