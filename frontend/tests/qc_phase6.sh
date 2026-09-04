#!/usr/bin/env bash
# QC gate Phase 6 runner — bảng hệ thống + export Excel (frontend).
# Checks: lint; typecheck strict + build; Vitest;
# static: Bảng 2 read-only + lọc kho/bin (không cột BATCH), export SheetJS
# ép text (z='@' + nháy đầu) + cột trạng thái, không localStorage.
# Exit 0 = PASS (in RESULT: QC_PHASE6 PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $1"; echo 'RESULT: QC_PHASE6 FAIL'; exit 1; }
pass() { echo "PASS: $1"; }
cd "$FRONTEND_DIR" || fail "no frontend dir"

echo "--- CHECK 1/5: lint ---"
npm run lint --silent || fail "lint"
pass "lint"

echo "--- CHECK 2/5: typecheck strict + build ---"
npm run build --silent > /tmp/qc6_build.log 2>&1 || { tail -20 /tmp/qc6_build.log; fail "build"; }
pass "typecheck + build"

echo "--- CHECK 3/5: vitest ---"
npx vitest run > /tmp/qc6_test.log 2>&1 || fail "vitest"
tail -4 /tmp/qc6_test.log | grep -E "Test Files|Tests"
grep -qE "Tests +[1-9][0-9]* passed" /tmp/qc6_test.log || fail "no passing tests"
pass "vitest"

echo "--- CHECK 4/5: Bảng 2 read-only + lọc (không BATCH) ---"
grep -rq "reference_stock" src/components/ReferenceDataTable.tsx || fail "not reading reference_stock"
grep -rq "Lọc theo kho" src/components/ReferenceDataTable.tsx || fail "missing warehouse filter"
grep -rq "Lọc theo vị trí" src/components/ReferenceDataTable.tsx || fail "missing bin filter"
grep -q "batch_id" src/components/ReferenceDataTable.tsx && fail "BATCH column leaked into Table 2"
pass "reference table"

echo "--- CHECK 5/5: export text-format + cột trạng thái ---"
grep -rq "z = '@'" src/lib/exportExcel.ts || fail "missing text format @"
grep -rq "Trạng thái" src/lib/exportExcel.ts || fail "missing status column"
grep -rq "writeFile" src/lib/exportExcel.ts || fail "missing writeFile"
grep -rn "localStorage" src --include='*.ts' --include='*.tsx' | grep -vE ":[0-9]+:\s*//" && fail "localStorage in src"
pass "export excel"

echo 'RESULT: QC_PHASE6 PASS'
