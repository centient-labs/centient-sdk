#!/usr/bin/env bash
#
# Run the sdk-python core unit suite for the `make python-test` gate.
#
# Self-contained: creates packages/sdk-python/.venv on first run (gitignored)
# and installs the package in editable mode with its dev extras. Runs only the
# core unit suite — mocked transport, no live server — excluding:
#   * integration-marked tests (require a live engram server)
#   * the framework-example adapter tests (langchain/crewai/autogen), which
#     exercise optional examples/ code, are not part of the SDK contract, and
#     are red on a clean checkout regardless of this gate.
#
# Mirrors the TS resource-test discipline: the suite asserts request
# path/method/body and response parsing for enveloped AND bare shapes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$REPO_ROOT/packages/sdk-python"
VENV="$PKG_DIR/.venv"
PY="$VENV/bin/python"

PYTHON_BIN="${PYTHON_BIN:-python3}"

if [ ! -x "$PY" ]; then
  echo "→ creating sdk-python venv at $VENV"
  "$PYTHON_BIN" -m venv "$VENV"
  "$PY" -m pip install --quiet --upgrade pip
fi

# Install (idempotent — pip is a no-op when already satisfied).
"$PY" -m pip install --quiet -e "$PKG_DIR[dev]"

cd "$PKG_DIR"
exec "$PY" -m pytest \
  -m "not integration" \
  --ignore=tests/test_integration_crewai.py \
  --ignore=tests/test_integration_langchain.py \
  --ignore=tests/test_integration_autogen.py \
  "$@"
