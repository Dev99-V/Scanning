#!/usr/bin/env bash
# QC gate Phase 2 runner — Edge Function import-reference trên Supabase local.
# Checks: upload file mẫu thật -> ok:true; số dòng import == số dòng dữ liệu
# trong file (đếm ĐỘNG, không hardcode); đối chiếu full từng dòng + TRIM sạch;
# import lại lần 2 không tạo trùng (upsert).
# Exit 0 = PASS (in RESULT: QC_PHASE2 PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
XLSX="$REPO_ROOT/Stock Balance With Batch.xlsx"
FUNC_URL="${FUNC_URL:-http://127.0.0.1:54321/functions/v1/import-reference}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

fail() { echo "FAIL: $1"; echo 'RESULT: QC_PHASE2 FAIL'; exit 1; }

[ -f "$XLSX" ] || fail "missing sample xlsx"
python3 -c "import openpyxl, psycopg2" 2>/dev/null || pip install -q openpyxl psycopg2-binary 2>&1 | tail -1

# Đảm bảo function đang serve; nếu chưa, tự start nền và dọn khi xong.
STARTED_BY_ME=0
if ! curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNC_URL" --max-time 10 | grep -q .; then
  fail "cannot reach $FUNC_URL"
fi
HTTP_CHECK="$(curl -s -o /dev/null -w "%{http_code}" -X POST "$FUNC_URL" --max-time 30 || echo 000)"
if [ "$HTTP_CHECK" = "000" ]; then
  cd "$REPO_ROOT/backend" || fail "no backend dir"
  nohup supabase functions serve import-reference --no-verify-jwt > /tmp/qc2_serve.log 2>&1 &
  SERVE_PID=$!
  STARTED_BY_ME=1
  for _ in $(seq 1 24); do
    sleep 5
    curl -s -o /dev/null -X POST "$FUNC_URL" --max-time 10 && break
  done
fi
cleanup() { if [ "$STARTED_BY_ME" = "1" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi }
trap cleanup EXIT

# Dọn sạch reference_stock trước khi test để đảm bảo hermetic
python3 -c "import psycopg2; con=psycopg2.connect('$DB_URL'); cur=con.cursor(); cur.execute('truncate reference_stock cascade'); con.commit(); con.close()"

echo "--- CHECK 1/3: upload file mẫu ---"
RESP="$(curl -s -X POST "$FUNC_URL" -F "file=@$XLSX" --max-time 300)" || fail "curl upload failed"
echo "$RESP" | head -c 500; echo
echo "$RESP" | grep -q '"ok":true' || fail "import not ok: $RESP"

echo "--- CHECK 2/3: đối chiếu full với file (đếm động) ---"
python3 "$SCRIPT_DIR/qc_phase2_compare.py" "$XLSX" "$DB_URL" || fail "full compare failed"

echo "--- CHECK 3/3: import lại không trùng ---"
COUNT_BEFORE="$(python3 -c "import psycopg2; c=psycopg2.connect('$DB_URL').cursor(); c.execute('select count(*) from reference_stock'); print(c.fetchone()[0])")"
curl -s -X POST "$FUNC_URL" -F "file=@$XLSX" --max-time 300 | grep -q '"ok":true' || fail "2nd import not ok"
COUNT_AFTER="$(python3 -c "import psycopg2; c=psycopg2.connect('$DB_URL').cursor(); c.execute('select count(*) from reference_stock'); print(c.fetchone()[0])")"
[ "$COUNT_BEFORE" = "$COUNT_AFTER" ] || fail "count changed after re-import: $COUNT_BEFORE -> $COUNT_AFTER"
echo "count stable at $COUNT_AFTER after re-import: PASS"

echo 'RESULT: QC_PHASE2 PASS'
