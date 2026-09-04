#!/usr/bin/env bash
# QC gate Phase 5 runner — bảng đối chiếu + toast trùng (frontend).
# Checks: lint; typecheck strict + build; Vitest;
# static: realtime postgres_changes bảng scanned_data, toast đủ 2 nút
# Ghi thêm/Đổi vị trí, bảng đối chiếu có SL/Bin hệ thống, không localStorage.
# Exit 0 = PASS (in RESULT: QC_PHASE5 PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $1"; echo 'RESULT: QC_PHASE5 FAIL'; exit 1; }
pass() { echo "PASS: $1"; }
cd "$FRONTEND_DIR" || fail "no frontend dir"

echo "--- CHECK 1/5: lint ---"
npm run lint --silent || fail "lint"
pass "lint"

echo "--- CHECK 2/5: typecheck strict + build ---"
grep -q '"strict": *true' tsconfig.app.json || fail "tsconfig strict:true missing"
npm run build --silent > /tmp/qc5_build.log 2>&1 || { tail -20 /tmp/qc5_build.log; fail "build"; }
pass "typecheck + build"

echo "--- CHECK 3/5: vitest ---"
npx vitest run > /tmp/qc5_test.log 2>&1 || fail "vitest"
tail -4 /tmp/qc5_test.log | grep -E "Test Files|Tests"
grep -qE "Tests +[1-9][0-9]* passed" /tmp/qc5_test.log || fail "no passing tests"
pass "vitest"

echo "--- CHECK 4/5: realtime + toast 2 lựa chọn ---"
grep -rq "postgres_changes" src --include='*.ts' --include='*.tsx' || fail "missing realtime subscription"
grep -rq "table: 'scanned_data'" src --include='*.ts' || fail "realtime not on scanned_data"
grep -rq "Ghi thêm" src/components/DuplicateAlertToast.tsx || fail "missing Ghi thêm"
grep -rq "Đổi vị trí" src/components/DuplicateAlertToast.tsx || fail "missing Đổi vị trí"
grep -rq "resolve-duplicate" src --include='*.ts' || fail "toast not wired to resolve-duplicate"
pass "realtime + toast"

echo "--- CHECK 5/5: bảng đối chiếu + không localStorage ---"
grep -rq "HỆ THỐNG" src/components/ReconciliationTable.tsx || fail "missing system columns"
grep -rq "qty_mismatch" src/components/ReconciliationTable.tsx || fail "missing warning flags"
grep -rn "localStorage" src --include='*.ts' --include='*.tsx' | grep -vE ":[0-9]+:\s*//" && fail "localStorage in src"
pass "recon table + no localStorage"

echo 'RESULT: QC_PHASE5 PASS'
