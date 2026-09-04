#!/usr/bin/env bash
set -euo pipefail

# Configure library path for linuxbrew on immutable OS (Bazzite/Silverblue)
if [ -d "/var/home/linuxbrew/.linuxbrew/lib" ]; then
  export LD_LIBRARY_PATH="/var/home/linuxbrew/.linuxbrew/lib:${LD_LIBRARY_PATH:-}"
elif [ -d "/home/linuxbrew/.linuxbrew/lib" ]; then
  export LD_LIBRARY_PATH="/home/linuxbrew/.linuxbrew/lib:${LD_LIBRARY_PATH:-}"
fi

# Locate node binary
if [ -x "/var/home/brug/.local/bin/node-patched" ]; then
  NODE_BIN="/var/home/brug/.local/bin/node-patched"
elif [ -x "/var/home/brug/.local/bin/node" ]; then
  NODE_BIN="/var/home/brug/.local/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x "/home/linuxbrew/.linuxbrew/bin/node" ]; then
  NODE_BIN="/home/linuxbrew/.linuxbrew/bin/node"
elif [ -x "/var/home/linuxbrew/.linuxbrew/bin/node" ]; then
  NODE_BIN="/var/home/linuxbrew/.linuxbrew/bin/node"
else
  echo "Error: Node.js binary not found." >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==============================================================="
echo "FatSecret MCP Server - Running E2E Test Suite"
echo "Repository: $REPO_ROOT"
echo "Node Binary: $NODE_BIN"
echo "==============================================================="

exec "$NODE_BIN" --import tsx test/e2e/runner.ts "$@"
