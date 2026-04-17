#!/usr/bin/env bash
# Runs the full SentinelSafe EHS test suite inside Docker containers.
# Requires: docker, docker compose v2.
# No local Node or Python install is needed — all test execution happens in containers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE="docker compose -f ${SCRIPT_DIR}/docker-compose.test.yml"

echo "============================================"
echo " SentinelSafe EHS — Full Test Suite (Docker)"
echo "============================================"
echo ""

PASS=0
FAIL=0
TOTAL=0

cleanup() {
  echo ""
  echo "--- Tearing down test containers ---"
  ${COMPOSE} down --volumes --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# --- Backend unit + API/integration tests (mocked DB — no MySQL needed) ---
echo "--- Backend Unit & API Tests ---"
if ${COMPOSE} run --rm backend-test; then
  echo "[PASS] Backend unit + API tests"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Backend unit + API tests"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))
echo ""

# --- Backend real-DB integration tests (requires MySQL — started automatically via depends_on) ---
echo "--- Backend Real-DB Integration Tests ---"
if ${COMPOSE} run --rm backend-realdb-test; then
  echo "[PASS] Backend real-DB integration tests"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Backend real-DB integration tests"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))
echo ""

# --- Frontend tests ---
echo "--- Frontend Tests ---"
if ${COMPOSE} run --rm frontend-test; then
  echo "[PASS] Frontend tests"
  PASS=$((PASS + 1))
else
  echo "[FAIL] Frontend tests"
  FAIL=$((FAIL + 1))
fi
TOTAL=$((TOTAL + 1))
echo ""

echo "============================================"
echo " Test Summary: ${PASS} passed, ${FAIL} failed, ${TOTAL} total"
echo "============================================"
if [ "${FAIL}" -gt 0 ]; then
  exit 1
fi
exit 0
