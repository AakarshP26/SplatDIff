"""PLY loading/saving and Gaussian parameter decoding for SplatDiff.

Reads the float PLY written by `npx splat-transform in.compressed.ply out.ply`.
Fields: x,y,z, rot_0..3 (quaternion, rot_0 = w), scale_0..2 (log scale),
opacity (logit), f_dc_0..2 and optionally f_rest_*.
"""
import struct
import numpy as np

_PLY_TYPES = {"float": "<f4", "float32": "<f4", "double": "<f8", "uchar": "u1",
              "uint8": "u1", "int": "<i4", "int32": "<i4", "uint": "<u4", "uint32": "<u4",
              "short": "<i2", "ushort": "<u2", "char": "i1"}


def load_ply(path):
    """Return a dict of field name -> 1D numpy array (vertex element only)."""
    with open(path, "rb") as f:
        if f.readline().strip() != b"ply":
            raise ValueError(f"{path}: not a PLY file")
        fields, n, fmt = [], None, None
        in_vertex = False
        while True:
            line = f.readline().decode("ascii").strip()
            if line == "end_header":
                break
            tok = line.split()
            if tok[0] == "format":
                fmt = tok[1]
            elif tok[0] == "element":
                in_vertex = tok[1] == "vertex"
                if in_vertex:
                    n = int(tok[2])
            elif tok[0] == "property" and in_vertex:
                fields.append((tok[2], _PLY_TYPES[tok[1]]))
        if fmt != "binary_little_endian":
            raise ValueError(f"{path}: unsupported format {fmt}")
        data = np.frombuffer(f.read(np.dtype(fields).itemsize * n), dtype=np.dtype(fields), count=n)
    return {name: np.array(data[name], dtype=np.float32) for name, _ in fields}


def save_ply(path, g):
    """Write a dict of float arrays as a binary little-endian PLY (all float32)."""
    names = list(g.keys())
    n = len(g[names[0]])
    arr = np.empty(n, dtype=[(k, "<f4") for k in names])
    for k in names:
        arr[k] = g[k]
    header = ["ply", "format binary_little_endian 1.0", f"element vertex {n}"]
    header += [f"property float {k}" for k in names] + ["end_header"]
    with open(path, "wb") as f:
        f.write(("\n".join(header) + "\n").encode("ascii"))
        f.write(arr.tobytes())


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def decode(g, max_scale=None):
    """Decode raw fields into geometric parameters.

    Returns dict with pos (N,3), scale (N,3) linear, alpha (N,), quat (N,4) normalised wxyz,
    rot (N,3,3) rotation matrices. Extreme scales are clamped (guitar has a few
    huge background Gaussians that otherwise produce NaN/overflow).
    """
    pos = np.stack([g["x"], g["y"], g["z"]], 1).astype(np.float64)
    s = np.exp(np.clip(np.stack([g["scale_0"], g["scale_1"], g["scale_2"]], 1).astype(np.float64), -12, 4))
    if max_scale is not None:
        s = np.minimum(s, max_scale)
    s = np.maximum(s, 1e-7)
    q = np.stack([g["rot_0"], g["rot_1"], g["rot_2"], g["rot_3"]], 1).astype(np.float64)
    q /= np.maximum(np.linalg.norm(q, axis=1, keepdims=True), 1e-12)
    alpha = sigmoid(g["opacity"].astype(np.float64))
    return {"pos": pos, "scale": s, "alpha": alpha, "quat": q, "rot": quat_to_rot(q)}


def quat_to_rot(q):
    w, x, y, z = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    R = np.empty((len(q), 3, 3))
    R[:, 0, 0] = 1 - 2 * (y * y + z * z); R[:, 0, 1] = 2 * (x * y - w * z); R[:, 0, 2] = 2 * (x * z + w * y)
    R[:, 1, 0] = 2 * (x * y + w * z); R[:, 1, 1] = 1 - 2 * (x * x + z * z); R[:, 1, 2] = 2 * (y * z - w * x)
    R[:, 2, 0] = 2 * (x * z - w * y); R[:, 2, 1] = 2 * (y * z + w * x); R[:, 2, 2] = 1 - 2 * (x * x + y * y)
    return R


def scene_bbox(pos, lo_pct=1.0, hi_pct=99.0, pad=0.05):
    """Robust bounding box: 1st..99th percentile of positions plus 5% padding."""
    lo = np.percentile(pos, lo_pct, axis=0)
    hi = np.percentile(pos, hi_pct, axis=0)
    ext = hi - lo
    return lo - pad * ext, hi + pad * ext


MAGIC = b"SPLD"


def export_binary(path, d):
    """Binary export for the C/CUDA kernels.

    Layout (little endian): magic 'SPLD', uint32 version=1, uint32 N, then N records of
    14 float32: x y z, sx sy sz (linear), qw qx qy qz, alpha, pad0 pad1 pad2.
    Fixed 56-byte stride keeps C parsing trivial.
    """
    n = len(d["alpha"])
    rec = np.zeros((n, 14), dtype="<f4")
    rec[:, 0:3] = d["pos"]
    rec[:, 3:6] = d["scale"]
    rec[:, 6:10] = d["quat"]
    rec[:, 10] = d["alpha"]
    with open(path, "wb") as f:
        f.write(MAGIC + struct.pack("<II", 1, n))
        f.write(rec.tobytes())


def import_binary(path):
    with open(path, "rb") as f:
        assert f.read(4) == MAGIC
        _ver, n = struct.unpack("<II", f.read(8))
        rec = np.frombuffer(f.read(56 * n), dtype="<f4").reshape(n, 14).astype(np.float64)
    q = rec[:, 6:10]
    return {"pos": rec[:, 0:3], "scale": rec[:, 3:6], "quat": q, "alpha": rec[:, 10], "rot": quat_to_rot(q)}
