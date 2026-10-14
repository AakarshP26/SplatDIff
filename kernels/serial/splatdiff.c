/* SplatDiff CPU kernels: serial and OpenMP from one source.
 *
 *   gcc -O3 -o splatdiff_serial splatdiff.c -lm
 *   gcc -O3 -fopenmp -o splatdiff_omp splatdiff.c -lm
 *
 * Usage:
 *   splatdiff A.bin B.bin N lox loy loz hix hiy hiz [out_prefix] [repeats]
 *
 * Kernels (timed separately):
 *   K1 splat   : mass-conserving deposit of each Gaussian into Phi (atomic adds)
 *   K2 compare : occupancy threshold, 1-voxel dilation, added/removed masks
 *   K3 reduce  : count occupied/added/removed voxels
 * Matches python/canon.py (the NumPy reference). See docs in that file.
 */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _OPENMP
#include <omp.h>
#define NOW() omp_get_wtime()
#else
#include <time.h>
static double NOW(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + 1e-9 * t.tv_nsec; }
#endif

#define Q_CUT 9.0f
#define RMAX 8
#define S_CLAMP_FRAC 0.05f
#define OCC_T 0.15f

typedef struct { float x, y, z, sx, sy, sz, qw, qx, qy, qz, a, p0, p1, p2; } Gauss;
typedef struct { float lo[3], h[3]; int n; } Grid;

static Gauss *load_bin(const char *path, int *count) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    char magic[4]; uint32_t ver, n;
    if (fread(magic, 1, 4, f) != 4 || memcmp(magic, "SPLD", 4) || fread(&ver, 4, 1, f) != 1 || fread(&n, 4, 1, f) != 1) {
        fprintf(stderr, "%s: bad header\n", path); exit(1);
    }
    Gauss *g = malloc(sizeof(Gauss) * n);
    if (fread(g, sizeof(Gauss), n, f) != n) { fprintf(stderr, "%s: short read\n", path); exit(1); }
    fclose(f);
    *count = (int)n;
    return g;
}

static inline void atomic_addf(float *p, float v) {
#ifdef _OPENMP
#pragma omp atomic
#endif
    *p += v;
}

/* K1: splat-to-grid */
static void splat(const Gauss *g, int count, const Grid *G, float *phi) {
    const int n = G->n;
    float vvol = G->h[0] * G->h[1] * G->h[2];
    float smax = S_CLAMP_FRAC * n * sqrtf(G->h[0] * G->h[0] + G->h[1] * G->h[1] + G->h[2] * G->h[2]);
#ifdef _OPENMP
#pragma omp parallel for schedule(dynamic, 256)
#endif
    for (int i = 0; i < count; i++) {
        const Gauss *q = &g[i];
        float p[3] = {q->x, q->y, q->z};
        int c[3];
        for (int k = 0; k < 3; k++) {
            c[k] = (int)floorf((p[k] - G->lo[k]) / G->h[k]);
            if (c[k] < 0 || c[k] >= n) goto next;
        }
        {
            float s[3] = {fminf(q->sx, smax), fminf(q->sy, smax), fminf(q->sz, smax)};
            float mass = q->a * (4.0f / 3.0f) * (float)M_PI * s[0] * s[1] * s[2] / vvol;
            /* rotation from quaternion (w,x,y,z), already normalised */
            float w = q->qw, x = q->qx, y = q->qy, z = q->qz;
            float R[3][3] = {{1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)},
                             {2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)},
                             {2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)}};
            float is2[3] = {1.0f / (s[0] * s[0]), 1.0f / (s[1] * s[1]), 1.0f / (s[2] * s[2])};
            float A[3][3];
            for (int a = 0; a < 3; a++)
                for (int b = 0; b < 3; b++)
                    A[a][b] = R[a][0] * is2[0] * R[b][0] + R[a][1] * is2[1] * R[b][1] + R[a][2] * is2[2] * R[b][2];
            /* per-axis search radius from the 3-sigma extent sqrt(Sigma_kk) */
            int rk[3];
            for (int k = 0; k < 3; k++) {
                float skk = R[k][0] * R[k][0] * s[0] * s[0] + R[k][1] * R[k][1] * s[1] * s[1] + R[k][2] * R[k][2] * s[2] * s[2];
                rk[k] = (int)ceilf(3.0f * sqrtf(skk) / G->h[k]);
                if (rk[k] > RMAX) rk[k] = RMAX;
            }
            /* pass 1: weight sum; pass 2: deposit */
            float wsum = 0.0f;
            for (int pass = 0; pass < 2; pass++) {
                float scale = pass ? mass / wsum : 0.0f;
                for (int dx = -rk[0]; dx <= rk[0]; dx++) {
                    int vx = c[0] + dx; if (vx < 0 || vx >= n) continue;
                    float ex = G->lo[0] + (vx + 0.5f) * G->h[0] - p[0];
                    for (int dy = -rk[1]; dy <= rk[1]; dy++) {
                        int vy = c[1] + dy; if (vy < 0 || vy >= n) continue;
                        float ey = G->lo[1] + (vy + 0.5f) * G->h[1] - p[1];
                        for (int dz = -rk[2]; dz <= rk[2]; dz++) {
                            int vz = c[2] + dz; if (vz < 0 || vz >= n) continue;
                            float ez = G->lo[2] + (vz + 0.5f) * G->h[2] - p[2];
                            float qq = ex * (A[0][0] * ex + A[0][1] * ey + A[0][2] * ez) +
                                       ey * (A[1][0] * ex + A[1][1] * ey + A[1][2] * ez) +
                                       ez * (A[2][0] * ex + A[2][1] * ey + A[2][2] * ez);
                            if (qq < 0) qq = 0;
                            if (qq > Q_CUT) continue;
                            float wt = expf(-0.5f * qq);
                            if (!pass) wsum += wt;
                            else atomic_addf(&phi[((size_t)vx * n + vy) * n + vz], wt * scale);
                        }
                    }
                }
                if (!pass && wsum <= 0.0f) {   /* fallback: whole mass to containing voxel */
                    atomic_addf(&phi[((size_t)c[0] * n + c[1]) * n + c[2]], mass);
                    break;
                }
            }
        }
    next:;
    }
}

/* K2: compare. Writes label per voxel: bit0 occA, bit1 occB, bit2 added, bit3 removed */
static void compare(const float *pa, const float *pb, int n, uint8_t *lab) {
#ifdef _OPENMP
#pragma omp parallel for collapse(2)
#endif
    for (int x = 0; x < n; x++)
        for (int y = 0; y < n; y++)
            for (int z = 0; z < n; z++) {
                size_t i = ((size_t)x * n + y) * n + z;
                int oa = pa[i] > OCC_T, ob = pb[i] > OCC_T;
                int da = 0, db = 0;          /* dilated occupancy (3x3x3) */
                for (int dx = -1; dx <= 1 && !(da && db); dx++) {
                    int u = x + dx; if (u < 0 || u >= n) continue;
                    for (int dy = -1; dy <= 1; dy++) {
                        int v = y + dy; if (v < 0 || v >= n) continue;
                        for (int dz = -1; dz <= 1; dz++) {
                            int w = z + dz; if (w < 0 || w >= n) continue;
                            size_t j = ((size_t)u * n + v) * n + w;
                            da |= pa[j] > OCC_T; db |= pb[j] > OCC_T;
                        }
                    }
                }
                lab[i] = (uint8_t)(oa | (ob << 1) | ((ob && !da) << 2) | ((oa && !db) << 3));
            }
}

/* K3: reduction */
static void reduce(const uint8_t *lab, size_t nv, long long out[4]) {
    long long occ = 0, add = 0, rem = 0, both = 0;
#ifdef _OPENMP
#pragma omp parallel for reduction(+ : occ, add, rem, both)
#endif
    for (size_t i = 0; i < nv; i++) {
        uint8_t l = lab[i];
        occ += (l & 3) != 0; both += (l & 3) == 3;
        add += (l >> 2) & 1; rem += (l >> 3) & 1;
    }
    out[0] = occ; out[1] = add; out[2] = rem; out[3] = both;
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
    float *pa = malloc(nv * sizeof(float)), *pb = malloc(nv * sizeof(float));
    uint8_t *lab = malloc(nv);
    long long cnt[4] = {0, 0, 0, 0};
    double t1 = 1e30, t2 = 1e30, t3 = 1e30;
    for (int r = 0; r < reps; r++) {
        memset(pa, 0, nv * sizeof(float)); memset(pb, 0, nv * sizeof(float));
        double t0 = NOW();
        splat(ga, na, &G, pa); splat(gb, nb, &G, pb);
        double ta = NOW();
        compare(pa, pb, G.n, lab);
        double tb = NOW();
        reduce(lab, nv, cnt);
        double tc = NOW();
        if (ta - t0 < t1) t1 = ta - t0;
        if (tb - ta < t2) t2 = tb - ta;
        if (tc - tb < t3) t3 = tc - tb;
    }
    int threads = 1;
#ifdef _OPENMP
    threads = omp_get_max_threads();
#endif
    printf("{\"impl\": \"%s\", \"threads\": %d, \"n\": %d, \"gaussians_a\": %d, \"gaussians_b\": %d, "
           "\"occupied\": %lld, \"added\": %lld, \"removed\": %lld, "
           "\"t_splat\": %.6f, \"t_compare\": %.6f, \"t_reduce\": %.6f}\n",
#ifdef _OPENMP
           "openmp",
#else
           "serial",
#endif
           threads, G.n, na, nb, cnt[0], cnt[1], cnt[2], t1, t2, t3);
    if (prefix) {
        dump(prefix, "_phiA.f32", pa, nv * sizeof(float));
        dump(prefix, "_phiB.f32", pb, nv * sizeof(float));
        dump(prefix, "_labels.u8", lab, nv);
    }
    free(ga); free(gb); free(pa); free(pb); free(lab);
    return 0;
}
