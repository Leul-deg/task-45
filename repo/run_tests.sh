#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0
FAIL=0
TOTAL=0

echo "============================================"
echo " SentinelSafe EHS — Full Test Suite"
echo "============================================"
echo ""

# --- Install backend dependencies if needed ---
cd "$SCRIPT_DIR/backend"
if [ ! -d "node_modules" ]; then
  echo "Installing backend dependencies..."
  npm install --no-audit --no-fund 2>&1
  echo ""
fi

# --- Install frontend dependencies if needed ---
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install --no-audit --no-fund 2>&1
  echo ""
fi

# --- Backend Unit Tests ---
echo "--- Backend Unit Tests ---"
cd "$SCRIPT_DIR/backend"
if npx jest --testPathPatterns='tests/unit/' --forceExit --no-cache 2>&1; then
  echo "[PASS] Backend unit tests"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Backend unit tests"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))
echo ""

# --- Backend API / Integration Tests ---
echo "--- Backend API Tests ---"
if npx jest --testPathPatterns='tests/(api|integration)/' --forceExit --no-cache 2>&1; then
  echo "[PASS] Backend API tests"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Backend API tests"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))
echo ""

# --- Frontend Tests ---
echo "--- Frontend Tests ---"
cd "$SCRIPT_DIR/frontend"
if npx vitest run 2>&1; then
  echo "[PASS] Frontend tests"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Frontend tests"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))
echo ""

# --- Summary ---
echo "============================================"
echo " Test Summary: $PASS passed, $FAIL failed, $TOTAL total"
echo "============================================"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
