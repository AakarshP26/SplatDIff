// SplatDiff CUDA kernels. Same algorithm and CLI as kernels/serial/splatdiff.c.
//
//   nvcc -O3 -arch=sm_75 -o splatdiff_cuda splatdiff.cu
//   ./splatdiff_cuda A.bin B.bin N lox loy loz hix hiy hiz [out_prefix] [repeats]
//
// K1 splat_kernel   : one thread per Gaussian, two passes over its search box,
//                     atomicAdd(float) into Phi.
// K2 compare_kernel : one thread per voxel, 3x3x3 dilation test, writes label byte.
// K3 reduce_kernel  : block-level shared-memory tree reduction of the 4 counters,
//                     one atomicAdd per block (unsigned long long).
// Timings use cudaEvents and exclude host<->device copies of the scenes
// (reported separately as t_h2d).
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <cstring>
#include <cuda_runtime.h>

#define Q_CUT 9.0f
#define RMAX 8
#define S_CLAMP_FRAC 0.05f
#define OCC_T 0.15f
#define CK(x) do { cudaError_t e = (x); if (e != cudaSuccess) { \
    fprintf(stderr, "CUDA %s at %s:%d\n", cudaGetErrorString(e), __FILE__, __LINE__); exit(1); } } while (0)

struct Gauss { float x, y, z, sx, sy, sz, qw, qx, qy, qz, a, p0, p1, p2; };
struct Grid { float lo[3], h[3]; int n; };

extern "C" __global__ void splat_kernel(const Gauss *__restrict__ g, int count, Grid G, float *phi) {
    int i = blockIdx.x * blockDim.x + threadIdx.x;
    if (i >= count) return;
    const int n = G.n;
    Gauss q = g[i];
    float p[3] = {q.x, q.y, q.z};
    int c[3];
    for (int k = 0; k < 3; k++) {
        c[k] = (int)floorf((p[k] - G.lo[k]) / G.h[k]);
        if (c[k] < 0 || c[k] >= n) return;
    }
    float vvol = G.h[0] * G.h[1] * G.h[2];
    float smax = S_CLAMP_FRAC * n * sqrtf(G.h[0] * G.h[0] + G.h[1] * G.h[1] + G.h[2] * G.h[2]);
    float s[3] = {fminf(q.sx, smax), fminf(q.sy, smax), fminf(q.sz, smax)};
    float mass = q.a * (4.0f / 3.0f) * 3.14159265358979f * s[0] * s[1] * s[2] / vvol;
    float w = q.qw, x = q.qx, y = q.qy, z = q.qz;
    float R[3][3] = {{1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)},
                     {2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)},
                     {2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)}};
    float is2[3] = {1.0f / (s[0] * s[0]), 1.0f / (s[1] * s[1]), 1.0f / (s[2] * s[2])};
    float A[3][3];
    for (int a = 0; a < 3; a++)
        for (int b = 0; b < 3; b++)
            A[a][b] = R[a][0] * is2[0] * R[b][0] + R[a][1] * is2[1] * R[b][1] + R[a][2] * is2[2] * R[b][2];
    int rk[3];
    for (int k = 0; k < 3; k++) {
        float skk = R[k][0] * R[k][0] * s[0] * s[0] + R[k][1] * R[k][1] * s[1] * s[1] + R[k][2] * R[k][2] * s[2] * s[2];
        rk[k] = min((int)ceilf(3.0f * sqrtf(skk) / G.h[k]), RMAX);
    }
    float wsum = 0.0f;
    for (int pass = 0; pass < 2; pass++) {
        float scale = pass ? mass / wsum : 0.0f;
        for (int dx = -rk[0]; dx <= rk[0]; dx++) {
            int vx = c[0] + dx; if (vx < 0 || vx >= n) continue;
            float ex = G.lo[0] + (vx + 0.5f) * G.h[0] - p[0];
            for (int dy = -rk[1]; dy <= rk[1]; dy++) {
                int vy = c[1] + dy; if (vy < 0 || vy >= n) continue;
                float ey = G.lo[1] + (vy + 0.5f) * G.h[1] - p[1];
                for (int dz = -rk[2]; dz <= rk[2]; dz++) {
                    int vz = c[2] + dz; if (vz < 0 || vz >= n) continue;
                    float ez = G.lo[2] + (vz + 0.5f) * G.h[2] - p[2];
                    float qq = ex * (A[0][0] * ex + A[0][1] * ey + A[0][2] * ez) +
                               ey * (A[1][0] * ex + A[1][1] * ey + A[1][2] * ez) +
                               ez * (A[2][0] * ex + A[2][1] * ey + A[2][2] * ez);
                    qq = fmaxf(qq, 0.0f);
                    if (qq > Q_CUT) continue;
                    float wt = __expf(-0.5f * qq);
                    if (!pass) wsum += wt;
                    else atomicAdd(&phi[((size_t)vx * n + vy) * n + vz], wt * scale);
                }
            }
        }
        if (!pass && wsum <= 0.0f) {
            atomicAdd(&phi[((size_t)c[0] * n + c[1]) * n + c[2]], mass);
            return;
        }
    }
}

extern "C" __global__ void compare_kernel(const float *__restrict__ pa, const float *__restrict__ pb, int n, uint8_t *lab) {
    size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x;
    size_t nv = (size_t)n * n * n;
    if (i >= nv) return;
    int z = i % n, y = (i / n) % n, x = i / ((size_t)n * n);
    int oa = pa[i] > OCC_T, ob = pb[i] > OCC_T;
    int da = 0, db = 0;
    for (int dx = -1; dx <= 1; dx++) {
        int u = x + dx; if (u < 0 || u >= n) continue;
        for (int dy = -1; dy <= 1; dy++) {
            int v = y + dy; if (v < 0 || v >= n) continue;
            for (int dz = -1; dz <= 1; dz++) {
                int ww = z + dz; if (ww < 0 || ww >= n) continue;
                size_t j = ((size_t)u * n + v) * n + ww;
                da |= pa[j] > OCC_T; db |= pb[j] > OCC_T;
            }
        }
    }
    lab[i] = (uint8_t)(oa | (ob << 1) | ((ob && !da) << 2) | ((oa && !db) << 3));
}

// out[0]=occupied out[1]=added out[2]=removed out[3]=occupied in both
extern "C" __global__ void reduce_kernel(const uint8_t *__restrict__ lab, size_t nv, unsigned long long *out) {
    __shared__ unsigned int sh[4][256];
    unsigned int c0 = 0, c1 = 0, c2 = 0, c3 = 0;
    for (size_t i = (size_t)blockIdx.x * blockDim.x + threadIdx.x; i < nv; i += (size_t)gridDim.x * blockDim.x) {
        uint8_t l = lab[i];
        c0 += (l & 3) != 0; c3 += (l & 3) == 3; c1 += (l >> 2) & 1; c2 += (l >> 3) & 1;
    }
    int t = threadIdx.x;
    sh[0][t] = c0; sh[1][t] = c1; sh[2][t] = c2; sh[3][t] = c3;
    __syncthreads();
    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (t < s) for (int k = 0; k < 4; k++) sh[k][t] += sh[k][t + s];
        __syncthreads();
    }
    if (t == 0) for (int k = 0; k < 4; k++) atomicAdd(&out[k], (unsigned long long)sh[k][0]);
}

#ifndef SPLATDIFF_KERNELS_ONLY
static Gauss *load_bin(const char *path, int *count) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    char magic[4]; uint32_t ver, n;
    if (fread(magic, 1, 4, f) != 4 || memcmp(magic, "SPLD", 4) || fread(&ver, 4, 1, f) != 1 || fread(&n, 4, 1, f) != 1) {
        fprintf(stderr, "%s: bad header\n", path); exit(1);
    }
    Gauss *g = (Gauss *)malloc(sizeof(Gauss) * n);
    if (fread(g, sizeof(Gauss), n, f) != n) { fprintf(stderr, "%s: short read\n", path); exit(1); }
    fclose(f);
    *count = (int)n;
    return g;
}

static void dump(const char *prefix, const char *suffix, const void *buf, size_t bytes) {
    char path[1024];
    snprintf(path, sizeof path, "%s%s", prefix, suffix);
    FILE *f = fopen(path, "wb");
    if (!f) { perror(path); exit(1); }
    fwrite(buf, 1, bytes, f);
    fclose(f);
}

int main(int argc, char **argv) {
    if (argc < 10) {
        fprintf(stderr, "usage: %s A.bin B.bin N lox loy loz hix hiy hiz [out_prefix] [repeats]\n", argv[0]);
        return 1;
    }
    int na, nb;
    Gauss *ga = load_bin(argv[1], &na), *gb = load_bin(argv[2], &nb);
    Grid G; G.n = atoi(argv[3]);
    for (int k = 0; k < 3; k++) {
        G.lo[k] = (float)atof(argv[4 + k]);
        G.h[k] = ((float)atof(argv[7 + k]) - G.lo[k]) / G.n;
    }
    const char *prefix = (argc > 10 && argv[10][0]) ? argv[10] : NULL;
    int reps = argc > 11 ? atoi(argv[11]) : 1;
    if (reps < 1) reps = 1;
    size_t nv = (size_t)G.n * G.n * G.n;

    cudaEvent_t e0, e1, e2, e3, e4;
    for (cudaEvent_t *e : {&e0, &e1, &e2, &e3, &e4}) CK(cudaEventCreate(e));
    Gauss *dga, *dgb; float *dpa, *dpb; uint8_t *dlab; unsigned long long *dcnt;
    CK(cudaMalloc(&dga, sizeof(Gauss) * na)); CK(cudaMalloc(&dgb, sizeof(Gauss) * nb));
    CK(cudaMalloc(&dpa, nv * 4)); CK(cudaMalloc(&dpb, nv * 4));
    CK(cudaMalloc(&dlab, nv)); CK(cudaMalloc(&dcnt, 4 * sizeof(unsigned long long)));
    CK(cudaEventRecord(e0));
    CK(cudaMemcpy(dga, ga, sizeof(Gauss) * na, cudaMemcpyHostToDevice));
    CK(cudaMemcpy(dgb, gb, sizeof(Gauss) * nb, cudaMemcpyHostToDevice));
    CK(cudaEventRecord(e1)); CK(cudaEventSynchronize(e1));
    float th2d; CK(cudaEventElapsedTime(&th2d, e0, e1));

    float t1 = 1e30f, t2 = 1e30f, t3 = 1e30f;
    unsigned long long cnt[4] = {0, 0, 0, 0};
    for (int r = 0; r < reps + 1; r++) {          // first iteration is a warm-up
        CK(cudaMemset(dpa, 0, nv * 4)); CK(cudaMemset(dpb, 0, nv * 4));
        CK(cudaMemset(dcnt, 0, 4 * sizeof(unsigned long long)));
        CK(cudaEventRecord(e1));
        splat_kernel<<<(na + 255) / 256, 256>>>(dga, na, G, dpa);
        splat_kernel<<<(nb + 255) / 256, 256>>>(dgb, nb, G, dpb);
        CK(cudaEventRecord(e2));
        compare_kernel<<<(unsigned)((nv + 255) / 256), 256>>>(dpa, dpb, G.n, dlab);
        CK(cudaEventRecord(e3));
        reduce_kernel<<<256, 256>>>(dlab, nv, dcnt);
        CK(cudaEventRecord(e4)); CK(cudaEventSynchronize(e4));
        CK(cudaGetLastError());
        if (r == 0) continue;
        float a, b, c;
        CK(cudaEventElapsedTime(&a, e1, e2)); CK(cudaEventElapsedTime(&b, e2, e3)); CK(cudaEventElapsedTime(&c, e3, e4));
        if (a < t1) t1 = a; if (b < t2) t2 = b; if (c < t3) t3 = c;
    }
    CK(cudaMemcpy(cnt, dcnt, sizeof cnt, cudaMemcpyDeviceToHost));
    cudaDeviceProp prop; CK(cudaGetDeviceProperties(&prop, 0));
    printf("{\"impl\": \"cuda\", \"device\": \"%s\", \"n\": %d, \"gaussians_a\": %d, \"gaussians_b\": %d, "
           "\"occupied\": %llu, \"added\": %llu, \"removed\": %llu, "
           "\"t_splat\": %.6f, \"t_compare\": %.6f, \"t_reduce\": %.6f, \"t_h2d\": %.6f}\n",
           prop.name, G.n, na, nb, cnt[0], cnt[1], cnt[2], t1 / 1e3, t2 / 1e3, t3 / 1e3, th2d / 1e3);
    if (prefix) {
        float *h = (float *)malloc(nv * 4); uint8_t *l = (uint8_t *)malloc(nv);
        CK(cudaMemcpy(h, dpa, nv * 4, cudaMemcpyDeviceToHost)); dump(prefix, "_phiA.f32", h, nv * 4);
        CK(cudaMemcpy(h, dpb, nv * 4, cudaMemcpyDeviceToHost)); dump(prefix, "_phiB.f32", h, nv * 4);
        CK(cudaMemcpy(l, dlab, nv, cudaMemcpyDeviceToHost)); dump(prefix, "_labels.u8", l, nv);
        free(h); free(l);
    }
    cudaFree(dga); cudaFree(dgb); cudaFree(dpa); cudaFree(dpb); cudaFree(dlab); cudaFree(dcnt);
    free(ga); free(gb);
    return 0;
}
#endif
