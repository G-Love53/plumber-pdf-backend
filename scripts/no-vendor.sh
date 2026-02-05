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

if grep -R --line-number --fixed-strings "vendor/" . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=scripts/no-vendor.sh \
  --exclude=.github/workflows/no-vendor.yml \
  >/dev/null; then
  echo "ERROR: vendor/ referenced in repo (outside guardrails)"
  exit 1
fi

echo "OK: no vendor"
