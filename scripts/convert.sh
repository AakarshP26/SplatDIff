#!/usr/bin/env bash
# Download (if missing) and convert the source scenes to float PLY.
# Source scenes: PlayCanvas engine examples (MIT licence), see data/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw data/converted
[ -d node_modules/@playcanvas/splat-transform ] || npm install --no-audit --no-fund @playcanvas/splat-transform
for s in "${@:-guitar biker}"; do
  for name in $s; do
    raw=data/raw/$name.compressed.ply
    [ -f "$raw" ] || curl -sSfL -o "$raw" "https://raw.githubusercontent.com/playcanvas/engine/main/examples/assets/splats/$name.compressed.ply"
    npx splat-transform "$raw" "data/converted/$name.ply"
  done
done
