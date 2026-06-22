#!/usr/bin/env bash
# Launches the AMAdocs (AnythingLLM fork) dev stack: server, collector, frontend.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null

# Self-locating: derive the project root from this script's own path, so the stack
# works regardless of where the repo is checked out (no hardcoded absolute paths).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ROOT="$PROJECT_ROOT/anythingllm-upstream"
LOG="$PROJECT_ROOT/tooling/logs"
mkdir -p "$LOG"

# Ensure userspace Ollama vars are visible to the server process too.
# Override OLLAMA_MODELS if you keep models outside the repo.
export OLLAMA_MODELS="${OLLAMA_MODELS:-$PROJECT_ROOT/tooling/ollama-models}"
export OLLAMA_HOST=127.0.0.1:11434
# AMAdocs: let the collector reach Ollama for image captioning (VisionCaption)
export OLLAMA_BASE_PATH=http://127.0.0.1:11434
export VISION_MODEL_PREF=moondream
# AMAdocs: catalog every dropped file with a bounded ~120-word AI summary at ingest
# (the "AI librarian" default). Only the summary is embedded for search; full-text
# "Deep search" is opt-in per file (right-click). Set =false to turn cataloging off.
export DOC_SUMMARY_ENABLED=true
# AMAdocs: scanned-PDF OCR rasterization DPI (default 150; clamped 72-300)
export OCR_PDF_DPI=150
# AMAdocs: min mean OCR confidence to keep an image's text (default 50; 0 disables).
# Rejects the glyph noise text-less photos produce (~28-40 vs ~85-95 for real text).
export OCR_MIN_CONFIDENCE=50

# AMAdocs: INTERNAL hot-box safety bound — NOT a user-facing knob (the only surfaced
# throttle is the Homepage "Indexing pace" slider, which rests between files and cools
# BOTH heat sources). This caps the *peak* intensity of the CPU work, which on this stack
# is the native ONNX embedder (Xenova/all-MiniLM-L6-v2 via onnxruntime-node) — it pins all
# cores per chunk and is the heat behind a "GPU idle, CPU hot" embed-only pass (see
# DEV-NOTES "FINDING — GPU idle, CPU hot"). Set EMBED_CPU_CORES to a core list/count to pin
# the server (and thus the embedder) to fewer cores via taskset. Default: unset = off, so
# other machines are unaffected. Example: EMBED_CPU_CORES=0-1 (first 2 cores). Falls back to
# a plain launch if taskset is missing. SERVER_NICE (default 10) lowers scheduling priority.
EMBED_CPU_CORES="${EMBED_CPU_CORES:-}"
SERVER_NICE="${SERVER_NICE:-10}"
SERVER_PREFIX=""   # default: empty = launch exactly as before (other machines unaffected)
if [ -n "$EMBED_CPU_CORES" ]; then
  SERVER_PREFIX="nice -n $SERVER_NICE"
  if command -v taskset >/dev/null 2>&1; then
    SERVER_PREFIX="taskset -c $EMBED_CPU_CORES $SERVER_PREFIX"
    echo "Hot-box cap: server pinned to cores $EMBED_CPU_CORES (nice $SERVER_NICE)"
  else
    echo "EMBED_CPU_CORES set but 'taskset' not found — running un-pinned (nice $SERVER_NICE)"
  fi
fi

echo "Starting server (3001)..."
( cd "$ROOT/server" && NODE_ENV=development $SERVER_PREFIX yarn dev > "$LOG/server.log" 2>&1 ) &
echo $! > "$LOG/server.pid"

echo "Starting collector (8888)..."
( cd "$ROOT/collector" && NODE_ENV=development yarn dev > "$LOG/collector.log" 2>&1 ) &
echo $! > "$LOG/collector.pid"

echo "Starting frontend (3000)..."
( cd "$ROOT/frontend" && yarn dev > "$LOG/frontend.log" 2>&1 ) &
echo $! > "$LOG/frontend.pid"

echo "All three launched. Logs in $LOG"
wait
