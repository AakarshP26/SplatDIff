"""Compile-check the CUDA kernels without a GPU, using NVRTC + ptxas.

pip install nvidia-cuda-nvrtc-cu12 nvidia-cuda-nvcc-cu12
python3 kernels/cuda/nvrtc_check.py [arch]      (default compute_75 / sm_75, the Colab T4)

Only the three __global__ kernels are compiled (host code is excluded via
SPLATDIFF_KERNELS_ONLY and host #includes are stripped, since NVRTC has no libc headers).
Writes kernels/cuda/build/splatdiff.ptx and prints ptxas register/spill info.
"""
import ctypes
import glob
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def find(pattern):
    import nvidia
    for base in nvidia.__path__:
        hits = glob.glob(os.path.join(base, pattern))
        if hits:
            return sorted(hits)[-1]
    sys.exit(f"not found: {pattern} (pip install nvidia-cuda-nvrtc-cu12 nvidia-cuda-nvcc-cu12)")


def main(arch="75"):
    src = open(os.path.join(HERE, "splatdiff.cu")).read()
    src = re.sub(r"^#include.*$", "", src, flags=re.M)
    src = "typedef unsigned char uint8_t;\n#define SPLATDIFF_KERNELS_ONLY\n" + src
    lib = ctypes.CDLL(find("cuda_nvrtc/lib/libnvrtc.so*"))
    prog = ctypes.c_void_p()
    rc = lib.nvrtcCreateProgram(ctypes.byref(prog), src.encode(), b"splatdiff.cu", 0, None, None)
    assert rc == 0, rc
    opts = [f"--gpu-architecture=compute_{arch}".encode(), b"-default-device", b"--use_fast_math"]
    rc = lib.nvrtcCompileProgram(prog, len(opts), (ctypes.c_char_p * len(opts))(*opts))
    size = ctypes.c_size_t()
    lib.nvrtcGetProgramLogSize(prog, ctypes.byref(size))
    log = ctypes.create_string_buffer(size.value)
    lib.nvrtcGetProgramLog(prog, log)
    if log.value.strip():
        print(log.value.decode())
    if rc != 0:
        sys.exit(f"NVRTC compile FAILED (rc={rc})")
    lib.nvrtcGetPTXSize(prog, ctypes.byref(size))
    ptx = ctypes.create_string_buffer(size.value)
    lib.nvrtcGetPTX(prog, ptx)
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    ptx_path = os.path.join(HERE, "build", "splatdiff.ptx")
    open(ptx_path, "wb").write(ptx.value)
    print(f"NVRTC OK: {ptx_path} ({len(ptx.value)} bytes)")
    ptxas = find("cuda_nvcc/bin/ptxas")
    out = subprocess.run([ptxas, f"-arch=sm_{arch}", "-v", ptx_path, "-o", os.path.join(HERE, "build", "splatdiff.cubin")],
                         capture_output=True, text=True)
    print(out.stdout + out.stderr)
    if out.returncode != 0:
        sys.exit("ptxas FAILED")
    print(f"ptxas OK for sm_{arch}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "75")
