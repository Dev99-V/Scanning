#!/usr/bin/env bash
# QC gate Phase 8 runner — kiểm thử tổng end-to-end LIVE trên local stack.
# Checks: auth user + đăng nhập; RLS (authenticated đọc được, anon không);
# mẫu đối chiếu thật (ok/qty_mismatch/bin_mismatch/not_in_reference +
# duplicate→append/relocate + audit actor); realtime INSERT live tới client;
# dọn sạch dữ liệu test.
# Exit 0 = PASS (in RESULT: QC_PHASE8 PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
API="${E2E_API:-http://127.0.0.1:54321}"
SCAN_URL="$API/functions/v1/scan-submit"
RESOLVE_URL="$API/functions/v1/resolve-duplicate"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_backend}"
E2E_EMAIL="${E2E_EMAIL:-qc.e2e@local.test}"
E2E_PASS="${E2E_PASS:-E2e-local-123}"

fail() { echo "FAIL: $1"; cleanup_e2e; echo 'RESULT: QC_PHASE8 FAIL'; exit 1; }
pass() { echo "PASS: $1"; }
psql() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A "$@"; }
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo "__PARSE_ERR__"; }

KEYS="$(cd "$REPO_ROOT/backend" && supabase status -o env 2>/dev/null)"
ANON="$(echo "$KEYS" | grep '^ANON_KEY=' | cut -d'"' -f2)"
SRV="$(echo "$KEYS" | grep '^SERVICE_ROLE_KEY=' | cut -d'"' -f2)"
[ -n "$ANON" ] && [ -n "$SRV" ] || fail "local stack not running"

cleanup_e2e() {
  psql -c "delete from scan_audit_log where scanned_id in (select id from scanned_data where batch_id like 'E2E%' or batch_id like 'RTBIN%'); delete from scanned_data where batch_id like 'E2E%' or batch_id like 'RTBIN%';" > /dev/null 2>&1 || true
}

pre_clean() {
  # Hermetic: gate luôn bắt đầu với scanned_data/audit trống (chỉ đụng dữ
  # liệu test — reference_stock không bao giờ bị xóa ở đây).
  psql -c "delete from scan_audit_log; delete from scanned_data;" > /dev/null 2>&1 || true
}
pre_clean

echo "--- CHECK 1/5: auth user + sign-in ---"
TOKEN="$(curl -s --max-time 30 "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASS\"}" | jget "d.get('access_token','')")"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "__PARSE_ERR__" ]; then
  curl -s --max-time 30 "$API/auth/v1/admin/users" -H "apikey: $SRV" -H "Authorization: Bearer $SRV" -H 'Content-Type: application/json' -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASS\",\"email_confirm\":true}" > /dev/null || fail "admin create user"
  TOKEN="$(curl -s --max-time 30 "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "{\"email\":\"$E2E_EMAIL\",\"password\":\"$E2E_PASS\"}" | jget "d.get('access_token','')")"
fi
[ -n "$TOKEN" ] && [ "$TOKEN" != "__PARSE_ERR__" ] || fail "sign-in failed"
E2E_UID="$(psql -c "select id from auth.users where email='$E2E_EMAIL';")"
[ -n "$E2E_UID" ] || fail "user not in auth.users"
pass "auth ($E2E_UID)"

echo "--- CHECK 2/5: RLS authenticated & anon đọc được / anon không insert trực tiếp ---"
AUTH_COUNT="$(curl -s --max-time 30 "$API/rest/v1/reference_stock?select=batch_id&limit=5" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" | jget "len(d)")"
[ "$AUTH_COUNT" = "5" ] || fail "authenticated read: $AUTH_COUNT"
ANON_REF="$(curl -s --max-time 30 "$API/rest/v1/reference_stock?select=batch_id&limit=5" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" | jget "len(d)")"
[ "$ANON_REF" = "5" ] || fail "anon cannot read reference: $ANON_REF"
ANON_INSERT_CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 -X POST "$API/rest/v1/scanned_data" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{"batch_id":"TEST","qty":1,"bin":"A"}')"
[ "$ANON_INSERT_CODE" = "401" ] || [ "$ANON_INSERT_CODE" = "403" ] || [ "$ANON_INSERT_CODE" = "42501" ] || fail "anon insert not blocked: $ANON_INSERT_CODE"
pass "RLS"

echo "--- CHECK 3/5: mẫu đối chiếu thật (user đã đăng nhập) ---"
SAMPLE="$(psql -F'|' -c "select batch_id, qty, bin from reference_stock where bin <> '' and batch_id not like 'E2E%' limit 4;")"
B1="$(echo "$SAMPLE" | sed -n '1p' | cut -d'|' -f1)"; Q1="$(echo "$SAMPLE" | sed -n '1p' | cut -d'|' -f2)"; N1="$(echo "$SAMPLE" | sed -n '1p' | cut -d'|' -f3)"
B2="$(echo "$SAMPLE" | sed -n '2p' | cut -d'|' -f1)"; Q2="$(echo "$SAMPLE" | sed -n '2p' | cut -d'|' -f2)"; N2="$(echo "$SAMPLE" | sed -n '2p' | cut -d'|' -f3)"
B3="$(echo "$SAMPLE" | sed -n '3p' | cut -d'|' -f1)"; Q3="$(echo "$SAMPLE" | sed -n '3p' | cut -d'|' -f2)"
B4="$(echo "$SAMPLE" | sed -n '4p' | cut -d'|' -f1)"; Q4="$(echo "$SAMPLE" | sed -n '4p' | cut -d'|' -f2)"; N4="$(echo "$SAMPLE" | sed -n '4p' | cut -d'|' -f3)"
scan() { curl -s --max-time 30 -X POST "$SCAN_URL" -H 'Content-Type: application/json' -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -d "$1"; }
R="$(scan "{\"batch_id\":\"$B1\",\"qty\":$Q1,\"bin\":\"$N1\"}")"; [ "$(echo "$R" | jget "d['data']['status']")" = "ok" ] || fail "sample ok: $R"
R="$(scan "{\"batch_id\":\"$B2\",\"qty\":$((Q2 + 1)),\"bin\":\"$N2\"}")"; [ "$(echo "$R" | jget "d['data']['status']")" = "qty_mismatch" ] || fail "sample qty: $R"
R="$(scan "{\"batch_id\":\"$B3\",\"qty\":$Q3,\"bin\":\"E2E-WRONG\"}")"; [ "$(echo "$R" | jget "d['data']['status']")" = "bin_mismatch" ] || fail "sample bin: $R"
R="$(scan "{\"batch_id\":\"E2E999999991\",\"qty\":1,\"bin\":\"E2E-B\"}")"; [ "$(echo "$R" | jget "d['data']['status']")" = "not_in_reference" ] || fail "sample unknown: $R"
R="$(scan "{\"batch_id\":\"$B4\",\"qty\":$Q4,\"bin\":\"$N4\"}")"; [ "$(echo "$R" | jget "d['data']['status']")" = "ok" ] || fail "sample B4 ok: $R"
R="$(scan "{\"batch_id\":\"$B4\",\"qty\":$Q4,\"bin\":\"$N4\"}")"; [ "$(echo "$R" | jget "d['error']['code']")" = "duplicate" ] || fail "sample duplicate: $R"
EID="$(echo "$R" | jget "d['data']['existing_id']")"
R="$(curl -s --max-time 30 -X POST "$RESOLVE_URL" -H 'Content-Type: application/json' -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -d "{\"action\":\"append\",\"scanned_id\":\"$EID\",\"batch_id\":\"$B4\",\"qty\":$Q4,\"bin\":\"$N4\"}")"
[ "$(echo "$R" | jget "d['data']['resolution']")" = "appended" ] || fail "sample append: $R"
R="$(curl -s --max-time 30 -X POST "$RESOLVE_URL" -H 'Content-Type: application/json' -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -d "{\"action\":\"relocate\",\"scanned_id\":\"$EID\",\"batch_id\":\"$B4\",\"qty\":$Q4,\"bin\":\"$N4\"}")"
[ "$(echo "$R" | jget "d['data']['resolution']")" = "relocated" ] || fail "sample relocate: $R"
SBY="$(psql -c "select count(*) from scanned_data where batch_id in ('$B1','$B2','$B3','$B4','E2E999999991') and scanned_by='$E2E_UID';")"
[ "$SBY" = "6" ] || fail "scanned_by not recorded: $SBY/6"
AUD="$(psql -c "select count(*) from scan_audit_log where actor='$E2E_UID';")"
[ "$AUD" -ge 7 ] || fail "audit missing: $AUD"
pass "sample reconcile + resolve + audit"

echo "--- CHECK 4/5: realtime INSERT live tới client ---"
export E2E_URL="$API" E2E_ANON="$ANON" E2E_EMAIL E2E_PASS E2E_BATCH="RTBIN000001" E2E_BIN="RT-BIN" E2E_FUNC="$SCAN_URL"
cd "$REPO_ROOT/frontend" || fail "no frontend"
node ../tests/qc_phase8_realtime.mjs || fail "realtime live"
pass "realtime live"

echo "--- CHECK 5/5: counts + dọn sạch ---"
REFC="$(psql -c 'select count(*) from reference_stock;')"
echo "reference_stock rows: $REFC (nguồn không bị đụng)"
cleanup_e2e
psql -c "delete from scan_audit_log where scanned_id in (select id from scanned_data where batch_id in ('$B1','$B2','$B3','$B4')); delete from scanned_data where batch_id in ('$B1','$B2','$B3','$B4');" > /dev/null || fail "cleanup sample"
LEFT="$(psql -c "select (select count(*) from scanned_data) + (select count(*) from scan_audit_log where scanned_id is not null and scanned_id not in (select id from scanned_data));")"
[ "$LEFT" = "0" ] || fail "leftover: $LEFT"
pass "cleanup"

echo 'RESULT: QC_PHASE8 PASS'
