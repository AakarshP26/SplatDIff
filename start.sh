#!/usr/bin/env bash
# SplatDiff one-click launcher (Linux, macOS, WSL).
# First run builds the viewer data (a few minutes). Later runs start at once.
#   bash start.sh            build if needed, serve, open the browser
#   bash start.sh --rebuild  rebuild all generated data first
#   PORT=9000 bash start.sh  use another port
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8765}"
PYTHON="${PYTHON:-python3}"

fail() { echo "ERROR: $*" >&2; exit 1; }

check_build_tools() {
  command -v "$PYTHON" >/dev/null || fail "Python 3 not found."
  command -v node >/dev/null || fail "Node.js 18 or newer not found."
  command -v npm >/dev/null || fail "npm not found."
  command -v gcc >/dev/null || fail "gcc not found (needed for the C/OpenMP kernels)."
  command -v make >/dev/null || fail "make not found."
  "$PYTHON" -c "import numpy, scipy" 2>/dev/null \
    || fail "numpy and scipy are required: $PYTHON -m pip install numpy scipy"
}

build() {
  check_build_tools
  echo "[1/6] Installing Node packages"
  npm install --no-audit --no-fund
  echo "[2/6] Converting scenes"
  bash scripts/convert.sh
  echo "[3/6] Generating test cases"
  "$PYTHON" python/prepare.py
  echo "[4/6] Compiling kernels"
  make -C kernels
  echo "[5/6] Running the pipeline"
  "$PYTHON" python/pipeline.py
  echo "[6/6] Exporting viewer data"
  "$PYTHON" python/export_web.py
}

if [ "${1:-}" = "--rebuild" ] || [ ! -f web/data/manifest.json ]; then
  build
fi

command -v "$PYTHON" >/dev/null || fail "Python 3 not found."
URL="http://localhost:$PORT/"

open_browser() {
  sleep 1
  if command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 || true
  elif command -v open >/dev/null; then open "$URL" || true
  fi
}

echo "SplatDiff is running at $URL (Ctrl+C to stop)"
open_browser &
exec "$PYTHON" -m http.server "$PORT" --bind 127.0.0.1 --directory web
