"""Reference (NumPy) canonical voxel field and change detection.

This is the ground truth the C / OpenMP / CUDA kernels are tested against.

Canonical field Phi (mass-conserving deposit):
  m_i = alpha_i * (4/3) pi s1 s2 s3 / voxel_volume
  m_i is spread over voxels whose centre lies within Mahalanobis q <= 9 (3 sigma),
  with weights exp(-q/2) / sum. If no voxel centre is inside, all mass goes to the
  voxel containing the mean. Gaussians whose mean is outside the grid are skipped.
Voxels are anisotropic (N per axis). The search box per axis is r_k = ceil(3 sqrt(Sigma_kk)/h_k),
capped at RMAX_VOX; weights are normalised over the voxels actually visited, so mass is conserved
even when the box is truncated. Only extreme scales (> 5% of the grid diagonal) are clamped.
"""
import numpy as np

Q_CUT = 9.0
RMAX_VOX = 8
S_CLAMP_FRAC = 0.05
OCC_T = 0.15


def make_grid(lo, hi, n=128):
    lo = np.asarray(lo, float)
    hi = np.asarray(hi, float)
    dims = np.array([n, n, n])
    h = (hi - lo) / n                       # per-axis voxel size (N^3 grid over the bbox)
    return {"lo": lo, "h": h, "dims": dims}


def canonical_field(d, grid, chunk=20000):
    lo, h, dims = grid["lo"], grid["h"], grid["dims"]
    phi = np.zeros(int(np.prod(dims)), dtype=np.float64)
    s = np.minimum(d["scale"], S_CLAMP_FRAC * float(np.linalg.norm(h * dims)))
    mass = d["alpha"] * (4.0 / 3.0) * np.pi * s.prod(1) / float(np.prod(h))
    cell = np.floor((d["pos"] - lo) / h).astype(int)
    inside = np.all((cell >= 0) & (cell < dims), axis=1)
    # inverse covariance R diag(1/s^2) R^T; per-axis 3-sigma extent sqrt(Sigma_kk)
    R = d["rot"]
    inv = np.einsum("nij,nj,nkj->nik", R, 1.0 / s ** 2, R)
    sig_kk = np.einsum("nkj,nj->nk", R ** 2, s ** 2)
    rk = np.minimum(np.ceil(3.0 * np.sqrt(sig_kk) / h).astype(int), RMAX_VOX)   # (n,3)
    rad = rk.max(1)
    strides = np.array([dims[1] * dims[2], dims[2], 1])

    for r in range(0, RMAX_VOX + 1):
        sel = np.where(inside & (rad == r))[0]
        if len(sel) == 0:
            continue
        o = np.arange(-r, r + 1)
        off = np.stack(np.meshgrid(o, o, o, indexing="ij"), -1).reshape(-1, 3)
        for a in range(0, len(sel), max(1, chunk // len(off))):
            idx = sel[a:a + max(1, chunk // len(off))]
            vox = cell[idx, None, :] + off[None]                      # (b,k,3)
            ctr = lo + (vox + 0.5) * h
            dlt = ctr - d["pos"][idx, None, :]
            q = np.maximum(np.einsum("bki,bij,bkj->bk", dlt, inv[idx], dlt), 0.0)
            valid = np.all((vox >= 0) & (vox < dims), -1) & (q <= Q_CUT) & np.all(np.abs(off)[None] <= rk[idx, None, :], -1)
            w = np.where(valid, np.exp(-0.5 * q), 0.0)
            wsum = w.sum(1)
            lin = (vox * strides).sum(-1)
            ok = wsum > 0
            np.add.at(phi, lin[ok][valid[ok]], (w[ok] * (mass[idx][ok] / wsum[ok])[:, None])[valid[ok]])
            # fallback: no voxel centre inside the cutoff
            fb = ~ok
            np.add.at(phi, (cell[idx][fb] * strides).sum(-1), mass[idx][fb])
    return phi.reshape(dims)


def dilate(o, it=1):
    from scipy.ndimage import binary_dilation
    return binary_dilation(o, structure=np.ones((3, 3, 3), bool), iterations=it)


def compare(phi_a, phi_b, t=OCC_T):
    oa, ob = phi_a > t, phi_b > t
    added = ob & ~dilate(oa)
    removed = oa & ~dilate(ob)
    return oa, ob, added, removed
