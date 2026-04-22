#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required but was not found in PATH."
  exit 1
fi

if [ ! -f ".env" ]; then
  cp env.template .env
  echo "Created backend/.env from env.template. Fill in your API keys before first run."
fi

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

VENV_PY=".venv/bin/python"

if [ ! -x "$VENV_PY" ]; then
  echo "Virtual environment Python was not found at $VENV_PY"
  exit 1
fi

"$VENV_PY" -m pip install -r requirements.txt
exec "$VENV_PY" api_server.py