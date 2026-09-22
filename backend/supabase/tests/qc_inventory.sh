#!/usr/bin/env bash
# QC gate inventory + 7055 + recompute — RPC kiểm kê (Bảng 3) có audit,
# công tắc 7055 (restore_tag_7055 on/off) và recompute_scanned_statuses.
# Chạy trên Supabase local (cùng DB_CONTAINER với qc_phase3.sh).
# Checks: migration mới apply idempotent; submit/update/delete kiểm kê ghi
# đúng audit kind (inventory_add/inventory_update/inventory_delete) + actor_name;
# validation (batch/qty/bin/id_required, not_found); 7055 bật/tắt + missing +
# audit; recompute chữa status stale + cưỡng chế duplicate; dọn sạch test.
# Exit 0 = PASS (in RESULT: QC_INVENTORY PASS), != 0 = FAIL.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_BACKEND="$(cd "$SCRIPT_DIR/../.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_backend}"

fail() { echo "FAIL: $1"; cleanup_test_rows; echo 'RESULT: QC_INVENTORY FAIL'; exit 1; }
pass() { echo "PASS: $1"; }
psql() { docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A "$@"; }

cleanup_test_rows() {
  psql -c "delete from scan_audit_log where coalesce(new_value->>'batch_id','') like 'QCTEST%' or coalesce(old_value->>'batch_id','') like 'QCTEST%'; delete from inventory_counts where batch_id like 'QCTEST%'; delete from scanned_data where batch_id like 'QCTEST%'; delete from reference_stock where batch_id like 'QCTEST%';" > /dev/null 2>&1 || true
}

echo "--- CHECK 1/7: migration audit kiểm kê apply idempotent ---"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$REPO_BACKEND/supabase/migrations/20260925090000_inventory_counts_audit.sql" > /dev/null || fail "migration apply failed"
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < "$REPO_BACKEND/supabase/migrations/20260925090000_inventory_counts_audit.sql" > /dev/null || fail "migration not idempotent"
pass "migration"

echo "--- CHECK 2/7: submit kiểm kê ok + audit inventory_add + validation ---"
IID="$(psql -c "select (submit_inventory_count('QCTEST8001','ST-A',5,'BIN-KK',false,'QC Kiểm Kê')->>'id');")"
[ -n "$IID" ] && [ "$IID" != "" ] || fail "submit did not return id"
[ "$(psql -c "select count(*) from inventory_counts where batch_id='QCTEST8001' and qty=5;")" = "1" ] || fail "submit row missing"
AUD="$(psql -c "select action||'|'||(new_value->>'kind')||'|'||coalesce(actor_name,'') from scan_audit_log where new_value->>'batch_id'='QCTEST8001' order by id desc limit 1;")"
[ "$AUD" = "insert|inventory_add|QC Kiểm Kê" ] || fail "submit audit wrong: $AUD"
[ "$(psql -c "select submit_inventory_count('','S',1,'B')->>'ok';")" = "false" ] || fail "submit empty batch not rejected"
[ "$(psql -c "select submit_inventory_count('QCTEST8002','S',0,'B')->>'error';")" = "qty_invalid" ] || fail "submit qty 0 not rejected"
[ "$(psql -c "select submit_inventory_count('QCTEST8002','S',1,'')->>'error';")" = "bin_required" ] || fail "submit empty bin not rejected"
pass "submit + audit + validation"

echo "--- CHECK 3/7: sửa SL+Bin kiểm kê ok + audit edit old->new + validation ---"
[ "$(psql -c "select (update_inventory_row('$IID'::uuid,9,'BIN-NEW','QC Sửa')->>'ok');")" = "true" ] || fail "update failed"
[ "$(psql -c "select qty||'|'||bin from inventory_counts where id='$IID';")" = "9|BIN-NEW" ] || fail "update qty/bin not applied"
AUD="$(psql -c "select action||'|'||(new_value->>'kind')||'|'||(old_value->>'qty')||'->'||(new_value->>'qty')||'|'||(old_value->>'bin')||'->'||(new_value->>'bin')||'|'||coalesce(actor_name,'') from scan_audit_log where action='edit' and new_value->>'kind'='inventory_update' and new_value->>'batch_id'='QCTEST8001' order by id desc limit 1;")"
[ "$AUD" = "edit|inventory_update|5->9|BIN-KK->BIN-NEW|QC Sửa" ] || fail "update audit wrong: $AUD"
[ "$(psql -c "select update_inventory_row('$IID'::uuid,0)->>'error';")" = "qty_invalid" ] || fail "update qty 0 not rejected"
[ "$(psql -c "select update_inventory_row('$IID'::uuid,null,'')->>'error';")" = "bin_required" ] || fail "update empty bin not rejected"
[ "$(psql -c "select update_inventory_row('00000000-0000-0000-0000-000000000000',5)->>'error';")" = "not_found" ] || fail "update not_found missing"
pass "update + audit + validation"

echo "--- CHECK 4/7: xóa kiểm kê ok + audit delete + not_found ---"
[ "$(psql -c "select (delete_inventory_row('$IID'::uuid,'QC Xóa')->>'ok');")" = "true" ] || fail "delete failed"
[ "$(psql -c "select count(*) from inventory_counts where id='$IID';")" = "0" ] || fail "delete row remains"
AUD="$(psql -c "select action||'|'||(old_value->>'kind')||'|'||(old_value->>'batch_id')||'|'||coalesce(actor_name,'') from scan_audit_log where action='delete' and old_value->>'kind'='inventory_delete' order by id desc limit 1;")"
[ "$AUD" = "delete|inventory_delete|QCTEST8001|QC Xóa" ] || fail "delete audit wrong: $AUD"
[ "$(psql -c "select delete_inventory_row('00000000-0000-0000-0000-000000000000')->>'error';")" = "not_found" ] || fail "delete not_found missing"
pass "delete + audit + validation"

echo "--- CHECK 5/7: công tắc 7055 bật/tắt + missing + audit ---"
psql -c "insert into reference_stock (batch_id, stock_code, warehouse, bin, qty) values ('QCTEST8101','S1','01','BIN-A',10),('QCTEST8102','S1','01','BIN-B',20);" > /dev/null || fail "seed reference"
[ "$(psql -c "select (restore_tag_7055(array['QCTEST8101','QCTEST8102'], true, 'QC 7055')->>'applied');")" = "2" ] || fail "7055 on applied != 2"
[ "$(psql -c "select count(*) from reference_stock where tag_7055=true and batch_id like 'QCTEST81%';")" = "2" ] || fail "7055 flags not set"
[ "$(psql -c "select (restore_tag_7055(array['QCTEST8101'], false)->>'applied');")" = "1" ] || fail "7055 off failed"
[ "$(psql -c "select tag_7055 from reference_stock where batch_id='QCTEST8101';")" = "f" ] || fail "7055 flag not cleared"
[ "$(psql -c "select tag_7055 from reference_stock where batch_id='QCTEST8102';")" = "t" ] || fail "7055 sibling flag disturbed"
MISS="$(psql -c "select restore_tag_7055(array['QCTEST8XXX'], true)->>'missing_count';")"
[ "$MISS" = "1" ] || fail "7055 missing_count wrong: $MISS"
[ "$(psql -c "select restore_tag_7055(array[]::text[], true)->>'ok';")" = "false" ] || fail "7055 empty input not rejected"
[ "$(psql -c "select count(*) from scan_audit_log where new_value->>'kind'='tag_7055_restore';")" -ge "3" ] || fail "7055 audit missing"
pass "7055 toggle + missing + audit"

echo "--- CHECK 6/7: recompute chữa stale + cưỡng chế duplicate ---"
psql -c "insert into reference_stock (batch_id, stock_code, warehouse, bin, qty) values ('QCTEST8201','S1','01','BIN-NEW',10);" > /dev/null || fail "seed recompute ref"
psql -c "insert into scanned_data (batch_id, qty, bin, status) values ('QCTEST8201',10,'BIN-OLD','ok'),('QCTEST8202',1,'B1','pending'),('QCTEST8202',1,'B2','pending');" > /dev/null || fail "seed recompute scans"
[ "$(psql -c "select (recompute_scanned_statuses()->>'ok');")" = "true" ] || fail "recompute failed"
[ "$(psql -c "select status from scanned_data where batch_id='QCTEST8201';")" = "bin_mismatch" ] || fail "recompute did not fix stale ok"
[ "$(psql -c "select count(*) from scanned_data where batch_id='QCTEST8202' and status='duplicate';")" = "2" ] || fail "recompute did not force duplicate"
pass "recompute"

echo "--- CHECK 7/7: dọn sạch dữ liệu test ---"
cleanup_test_rows
LEFT="$(psql -c "select (select count(*) from inventory_counts where batch_id like 'QCTEST%') + (select count(*) from scanned_data where batch_id like 'QCTEST%') + (select count(*) from reference_stock where batch_id like 'QCTEST%') + (select count(*) from scan_audit_log where coalesce(new_value->>'batch_id','') like 'QCTEST%' or coalesce(old_value->>'batch_id','') like 'QCTEST%');")"
[ "$LEFT" = "0" ] || fail "leftover test rows: $LEFT"
pass "cleanup"

echo 'RESULT: QC_INVENTORY PASS'
