#!/usr/bin/env bash
# QC gate Phase 1 runner — chạy kiểm chuẩn schema/RLS/realtime trên Supabase local.
# Dùng cho cả agent chính và subagent QC. Exit 0 = PASS, != 0 = FAIL.
# Yêu cầu: `supabase db start` đang chạy; container DB mặc định supabase_db_backend.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_FILE="$SCRIPT_DIR/qc_phase1.sql"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_backend}"

OUT="$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$SQL_FILE" 2>&1)"
STATUS=$?
echo "$OUT" | grep -E 'CHECK|QC_PHASE1|ERROR|FAIL' || echo "$OUT"

if [ $STATUS -eq 0 ] && echo "$OUT" | grep -q 'QC_PHASE1_PASS'; then
  echo 'RESULT: QC_PHASE1 PASS'
  exit 0
else
  echo 'RESULT: QC_PHASE1 FAIL'
  exit 1
fi
