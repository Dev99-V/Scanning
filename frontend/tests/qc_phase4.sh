#!/usr/bin/env bash
# QC gate Phase 4 runner — khu vực quét PDA (frontend).
# Checks: lint sạch; typecheck strict + build; Vitest pass;
# static: không localStorage trong src, không debounce ở input quét,
# gọi API thật scan-submit, xử lý Enter, tsconfig strict:true.
# Exit 0 = PASS (in RESULT: QC_PHASE4 PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $1"; echo 'RESULT: QC_PHASE4 FAIL'; exit 1; }
pass() { echo "PASS: $1"; }
cd "$FRONTEND_DIR" || fail "no frontend dir"

echo "--- CHECK 1/5: lint ---"
npm run lint --silent || fail "lint"
pass "lint"

echo "--- CHECK 2/5: typecheck strict + build ---"
grep -q '"strict": *true' tsconfig.app.json || fail "tsconfig strict:true missing"
npm run build --silent > /tmp/qc4_build.log 2>&1 || { tail -20 /tmp/qc4_build.log; fail "build"; }
pass "typecheck + build"

echo "--- CHECK 3/5: vitest ---"
npx vitest run 2>&1 | tail -6
npx vitest run > /tmp/qc4_test.log 2>&1 || fail "vitest"
grep -qE "Tests +[1-9][0-9]* passed" /tmp/qc4_test.log || fail "no passing tests"
pass "vitest"

echo "--- CHECK 4/5: không localStorage / debounce trong src ---"
grep -rn "localStorage" src --include='*.ts' --include='*.tsx' | grep -vE ":[0-9]+:\s*//" && fail "localStorage found in src (business data cấm)"
grep -rni "debounce" src --include='*.ts' --include='*.tsx' | grep -vE ":[0-9]+:\s*//" && fail "debounce found in src (PDA wedge cấm)"
pass "no localStorage, no debounce"

echo "--- CHECK 5/5: gọi API thật + Enter + WAITING guard ---"
grep -rq "functions.invoke" src --include='*.ts' || fail "missing functions.invoke"
grep -rq "scan-submit" src --include='*.ts' || fail "missing scan-submit call"
grep -rq "onKeyDown" src/components/PdaScanPanel.tsx || fail "missing Enter handler"
grep -rq "WAITING" src/components/PdaScanPanel.tsx || fail "missing WAITING guard"
pass "real API + Enter + guard"

echo 'RESULT: QC_PHASE4 PASS'
