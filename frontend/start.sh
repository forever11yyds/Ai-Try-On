#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH."
  exit 1
fi

if [ ! -f ".env.local" ]; then
  cp .env.example .env.local
  echo "Created frontend/.env.local from .env.example."
fi

if [ ! -d "node_modules" ]; then
  npm install
fi

LOG_FILE="$(mktemp)"

install_dependencies() {
  npm install
}

run_frontend() {
  npm run dev 2>&1 | tee "$LOG_FILE"
}

if run_frontend; then
  rm -f "$LOG_FILE"
  exit 0
fi

if grep -Eq 'Cannot find module|Module not found|npm ERR!|missing' "$LOG_FILE"; then
  echo "Dependency issue detected in frontend. Installing missing packages and retrying..."
  install_dependencies
  rm -f "$LOG_FILE"
  exec npm run dev
fi

cat "$LOG_FILE"
rm -f "$LOG_FILE"
exit 1