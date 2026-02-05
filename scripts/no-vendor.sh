#!/usr/bin/env bash
set -euo pipefail

if [ -d "vendor" ]; then
  echo "ERROR: vendor/ exists"
  exit 1
fi

if [ -f ".gitmodules" ] && grep -q "vendor/" .gitmodules; then
  echo "ERROR: .gitmodules references vendor/"
  exit 1
fi

if git ls-files -z | xargs -0 grep -n --fixed-strings "vendor/" >/dev/null 2>&1; then
  echo "ERROR: vendor/ referenced in tracked files"
  git ls-files -z | xargs -0 grep -n --fixed-strings "vendor/" || true
  exit 1
fi

echo "OK: no vendor"
