#!/usr/bin/env bash
# QC gate Phase 3 runner — RPC scan_submit/resolve_duplicate + Edge Functions
# scan-submit / resolve-duplicate trên Supabase local.
# Checks: migration apply sạch; invalid_input; ok/qty_mismatch/bin_mismatch/
# not_in_reference; duplicate conflict không tự ghi; append/relocate + audit;
# race 2 request cùng batch (1 dòng + 1 conflict, không mất dữ liệu);
# race khác batch (cả 2 ok); dọn sạch dữ liệu test.
# Exit 0 = PASS (in RESULT: QC_PHASE3 PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_BACKEND="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCAN_URL="${SCAN_URL:-http://127.0.0.1:54321/functions/v1/scan-submit}"
RESOLVE_URL="${RESOLVE_URL:-http://127.0.0.1:54321/functions/v1/resolve-duplicate}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_backend}"

fail() { echo "FAIL: $1"; cleanup_test_rows; echo 'RESULT: QC_PHASE3 FAIL'; exit 1; }
pass() { echo "PASS: $1"; }
psql() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A "$@"; }
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo "__PARSE_ERR__"; }

cleanup_test_rows() {
  psql -c "delete from scan_audit_log where scanned_id in (select id from scanned_data where batch_id like 'QCTEST%'); delete from scanned_data where batch_id like 'QCTEST%'; delete from reference_stock where batch_id like 'QCTEST%';" > /dev/null 2>&1 || true
}

# Đảm bảo functions đang serve; nếu chưa, tự start nền và dọn khi xong.
STARTED_BY_ME=0
if ! curl -s -o /dev/null -X POST "$SCAN_URL" --max-time 10 2>/dev/null; then
  cd "$REPO_BACKEND" || fail "no backend dir"
  setsid nohup supabase functions serve --no-verify-jwt > /tmp/qc3_serve.log 2>&1 < /dev/null & disown
  SERVE_PID=$!
  STARTED_BY_ME=1
  for _ in $(seq 1 24); do
    sleep 5
    curl -s -o /dev/null -X POST "$SCAN_URL" --max-time 10 2>/dev/null && break
  done
fi
cleanup_serve() { if [ "$STARTED_BY_ME" = "1" ]; then kill "$SERVE_PID" 2>/dev/null || true; fi }
trap cleanup_serve EXIT

echo "--- CHECK 1/7: migration apply sạch (idempotent) ---"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$REPO_BACKEND/supabase/migrations/20260904070945_scan_submit_rpc.sql" > /dev/null || fail "migration apply failed"
pass "migration"

echo "--- CHECK 2/7: invalid input -> invalid_input ---"
R="$(curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"","qty":"x"}' --max-time 30)"
[ "$(echo "$R" | jget "d.get(\"ok\")")" = "False" ] && [ "$(echo "$R" | jget "d['error']['code']")" = "invalid_input" ] || fail "scan invalid_input: $R"
R="$(curl -s -X POST "$RESOLVE_URL" -H 'Content-Type: application/json' -d '{"action":"bogus"}' --max-time 30)"
[ "$(echo "$R" | jget "d['error']['code']")" = "invalid_input" ] || fail "resolve invalid_input: $R"
R="$(curl -s -X POST "$RESOLVE_URL" -H 'Content-Type: application/json' -d '{"action":"append","scanned_id":"00000000-0000-0000-0000-000000000000","batch_id":"QCTEST000099","qty":1,"bin":"Z"}' --max-time 30)"
[ "$(echo "$R" | jget "d['error']['code']")" = "not_found" ] || fail "resolve not_found: $R"
pass "invalid_input + not_found"

echo "--- CHECK 3/7: ok / qty_mismatch / bin_mismatch / not_in_reference ---"
psql -c "insert into reference_stock (batch_id, stock_code, warehouse, bin, qty) values ('QCTEST000010','S1','01','BIN-A',10),('QCTEST000011','S2','01','BIN-B',20);" > /dev/null || fail "seed temp reference"
REAL="$(psql -F'|' -c "select batch_id, qty, bin from reference_stock where bin <> '' and batch_id not like 'QCTEST%' limit 1;")"
RBID="$(echo "$REAL" | cut -d'|' -f1)"; RQ="$(echo "$REAL" | cut -d'|' -f2)"; RBN="$(echo "$REAL" | cut -d'|' -f3)"
R="$(curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d "{\"batch_id\":\"$RBID\",\"qty\":$RQ,\"bin\":\"$RBN\"}" --max-time 30)"
[ "$(echo "$R" | jget "d['data']['status']")" = "ok" ] || fail "ok case: $R"
REAL_SCAN_ID="$(echo "$R" | jget "d['data']['id']")"
R="$(curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000010","qty":10,"bin":"WRONG"}' --max-time 30)"
[ "$(echo "$R" | jget "d['data']['status']")" = "bin_mismatch" ] || fail "bin_mismatch: $R"
R="$(curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000011","qty":999,"bin":"BIN-B"}' --max-time 30)"
[ "$(echo "$R" | jget "d['data']['status']")" = "qty_mismatch" ] || fail "qty_mismatch: $R"
R="$(curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000012","qty":1,"bin":"NB"}' --max-time 30)"
[ "$(echo "$R" | jget "d['data']['status']")" = "not_in_reference" ] || fail "not_in_reference: $R"
pass "4 statuses"

echo "--- CHECK 4/7: duplicate -> conflict, không tự ghi ---"
BEFORE="$(psql -c "select count(*) from scanned_data where batch_id='QCTEST000010';")"
R="$(curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000010","qty":10,"bin":"BIN-A"}' --max-time 30)"
[ "$(echo "$R" | jget "d.get(\"ok\")")" = "False" ] && [ "$(echo "$R" | jget "d['error']['code']")" = "duplicate" ] || fail "duplicate conflict: $R"
AFTER="$(psql -c "select count(*) from scanned_data where batch_id='QCTEST000010';")"
[ "$BEFORE" = "$AFTER" ] || fail "duplicate auto-inserted: $BEFORE -> $AFTER"
EID10="$(psql -c "select id from scanned_data where batch_id='QCTEST000010' order by scanned_at desc limit 1;")"
pass "duplicate conflict"

echo "--- CHECK 5/7: append + relocate + audit ---"
R="$(curl -s -X POST "$RESOLVE_URL" -H 'Content-Type: application/json' -d "{\"action\":\"append\",\"scanned_id\":\"$EID10\",\"batch_id\":\"QCTEST000010\",\"qty\":10,\"bin\":\"BIN-A\"}" --max-time 30)"
[ "$(echo "$R" | jget "d['data']['status']")" = "duplicate" ] && [ "$(echo "$R" | jget "d['data']['resolution']")" = "appended" ] || fail "append: $R"
EID11="$(psql -c "select id from scanned_data where batch_id='QCTEST000011' order by scanned_at desc limit 1;")"
R="$(curl -s -X POST "$RESOLVE_URL" -H 'Content-Type: application/json' -d "{\"action\":\"relocate\",\"scanned_id\":\"$EID11\",\"batch_id\":\"QCTEST000011\",\"qty\":20,\"bin\":\"BIN-B\"}" --max-time 30)"
[ "$(echo "$R" | jget "d['data']['status']")" = "ok" ] && [ "$(echo "$R" | jget "d['data']['resolution']")" = "relocated" ] || fail "relocate: $R"
[ "$(psql -c "select bin from scanned_data where id='$EID11';")" = "BIN-B" ] || fail "relocate did not overwrite bin"
AUD="$(psql -c "select action, count(*) from scan_audit_log where action in ('append','relocate') group by 1 order by 1;")"
echo "$AUD" | grep -q append || fail "missing append audit"
echo "$AUD" | grep -q relocate || fail "missing relocate audit"
pass "append + relocate + audit"

echo "--- CHECK 6/7: race 2 request cùng batch + khác batch ---"
curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000020","qty":7,"bin":"R1"}' --max-time 30 > /tmp/qc3_race1.json &
curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000020","qty":7,"bin":"R1"}' --max-time 30 > /tmp/qc3_race2.json &
wait
OKS=0; DUPS=0
for f in /tmp/qc3_race1.json /tmp/qc3_race2.json; do
  if [ "$(cat "$f" | jget "d.get(\"ok\")")" = "True" ]; then OKS=$((OKS+1)); fi
  if [ "$(cat "$f" | jget "d['error']['code']")" = "duplicate" ]; then DUPS=$((DUPS+1)); fi
done
[ "$OKS" = "1" ] && [ "$DUPS" = "1" ] || fail "same-batch race: oks=$OKS dups=$DUPS $(cat /tmp/qc3_race*.json)"
[ "$(psql -c "select count(*) from scanned_data where batch_id='QCTEST000020';")" = "1" ] || fail "same-batch race row count != 1"
curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000021","qty":1,"bin":"R2"}' --max-time 30 > /tmp/qc3_race3.json &
curl -s -X POST "$SCAN_URL" -H 'Content-Type: application/json' -d '{"batch_id":"QCTEST000022","qty":2,"bin":"R3"}' --max-time 30 > /tmp/qc3_race4.json &
wait
[ "$(cat /tmp/qc3_race3.json | jget "d.get(\"ok\")")" = "True" ] && [ "$(cat /tmp/qc3_race4.json | jget "d.get(\"ok\")")" = "True" ] || fail "diff-batch race failed"
pass "race conditions"

echo "--- CHECK 7/7: dọn sạch dữ liệu test ---"
psql -c "delete from scan_audit_log where scanned_id='$REAL_SCAN_ID'; delete from scanned_data where id='$REAL_SCAN_ID';" > /dev/null || fail "cleanup real-batch row"
cleanup_test_rows
LEFT="$(psql -c "select (select count(*) from scanned_data where batch_id like 'QCTEST%') + (select count(*) from reference_stock where batch_id like 'QCTEST%');")"
[ "$LEFT" = "0" ] || fail "leftover test rows: $LEFT"
pass "cleanup"

echo 'RESULT: QC_PHASE3 PASS'
