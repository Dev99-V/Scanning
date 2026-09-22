# PIPELINE.md — Kiến trúc vận hành & luồng dữ liệu (nền tìm bug ẩn)

> Ngày dựng: 2026-09-22. Mục đích: phác thảo lại toàn bộ đường đi của 1 lượt quét
> để định vị bug "Bảng 1 lệch BIN nhưng vẫn báo Khớp hoàn toàn (chữ đỏ)".
> Nguồn chuẩn: `Plan.md` §2–§6, `Skills.md` A/B/C, `state.json`, code hiện tại.
> Quy ước: `status` = trạng thái LƯU trong DB (`scanned_data.status`);
> `live-compare` = so sánh trực tiếp trên frontend (`sys.qty/bin` vs `r.qty/bin`).

## 1. Tổng quan hệ thống

```
PDA (wedge = bàn phím nhanh + Enter)
  │  (a) Quét BIN → Active Bin (state UI, PdaScanModal / PdaScanPanel)
  │  (b) Quét TAG → { batch_id, qty (gõ tay), bin, is_manual, stock_code? }
  ▼
Edge Functions (Deno/TS, passthrough — KHÔNG compare ở JS, Skills A)
  │  scan-submit / resolve-duplicate / import-reference
  │  Contract: { ok, data?, error?: { code, message } } (Skills C)
  ▼
Postgres RPC (plpgsql, 1 transaction duy nhất — quyết định db_row_lock_rpc)
  │  scan_submit / resolve_duplicate / update_scanned_tag_id /
  │  update_reference_qty / update_reference_bin / add_reference_stock /
  │  delete_scanned_row / delete_reference_stock
  │  Khóa: pg_advisory_xact_lock('scan_submit:'||batch) + SELECT ... FOR UPDATE
  ▼
Bảng DB: reference_stock (PK batch_id) ──lookup──▶ scanned_data ──ghi──▶ scan_audit_log
  │  RLS: anon SELECT mở (kiosk kho), ghi chỉ qua RPC SECURITY DEFINER
  ▼
Supabase Realtime (publication supabase_realtime: scanned_data + reference_stock + scan_audit_log)
  │  resilientSubscribe (tự nối lại backoff 1s→15s + refetch bù + health)
  ▼
Frontend (React 18 strict, Vite, Tailwind, Supabase JS — KHÔNG cache nghiệp vụ)
  │  useScannedData (Bảng 1) + useReferenceMap (byBatch tra cứu) +
  │  ReferenceDataTable (Bảng 2) + InventoryScanModal/Bảng 3 + usePresence (khóa mềm)
  ▼
Bảng 1 đối chiếu: cột SL/BIN quét vs SL/BIN hệ thống + badge TRẠNG THÁI (từ status)
  + cột GHI CHÚ (từ live-compare + status) + KPI header (App.tsx đếm theo status)
```

## 2. Luồng quét chuẩn (Plan.md §4.2–§4.3)

```
1. UI giữ Active Bin → user quét Tag → submitScan({ batch_id, qty, bin })
2. Edge scan-submit → rpc scan_submit(p_batch_id, p_qty, p_bin, ...)
3. RPC trong 1 transaction:
   a. advisory lock theo batch
   b. SELECT reference WHERE batch_id FOR UPDATE
      - không thấy → status = 'not_in_reference' (vẫn lưu, cho thêm tay)
      - thấy → so bin trước, qty sau (tie-break: lệch cả 2 → 'bin_mismatch')
   c. SELECT scanned WHERE batch_id FOR UPDATE → thấy → KHÔNG ghi, trả conflict
      → frontend mở toast Ghi thêm (append → status 'duplicate') / Đổi vị trí (relocate)
   d. INSERT scanned + INSERT audit → trả { conflict:false, status }
4. Realtime INSERT → useScannedData upsert theo id → Bảng 1 render lại
```

## 3. Luồng import nguồn (nơi sinh status stale — bug ảnh)

```
1. ReferenceImportCard upload .xlsx → Edge import-reference
2. Edge: dò header động (15 dòng đầu) → TRIM text (giữ *_raw audit) → Map khử trùng batch
2b. ✅ FIX 2026-09-23 (bug mất nhãn 7055): snapshot `batch_id WHERE tag_7055=true`
    TRƯỚC delete — file Excel không có cột 7055 nên delete-nạp lại từng reset hết
    nhãn gắn tay. Sau upsert gắn lại flag cho tag còn trong nguồn mới; tag không
    còn → báo `tag_7055_vanished[]` trong response + audit (KHÔNG dựng lại).
3. Edge: DELETE toàn bảng (delete().neq(batch_id,"")) → upsert từng chunk 500
4. ✅ FIX 2026-09-22 (bug status stale): gọi RPC `recompute_scanned_statuses` sau import
   (trước đó KHÔNG có bước này → badge xanh "Khớp" từ status cũ + ô BIN đỏ mới)
5. Realtime bulk DELETE+INSERT hàng nghìn event → máy khác có thể miss event;
   chỉ máy import được refetchReference (fix 2026-09-21), máy còn lại trông chờ realtime
```

## 4. Luồng sửa nguồn Bảng 2 (đồng bộ 1 phần)

```
update_reference_bin / update_reference_qty:
  UPDATE reference SET bin/qty (+ previous_bin/qty)
  → UPDATE scanned SET status = CASE ... END
    WHERE batch_id = X AND status IN ('ok','bin_mismatch','qty_mismatch')
  ⚠️ Bỏ qua pending / duplicate / not_in_reference (duplicate là cố ý giữ —
  Learning 2026-09-07; pending/not_in_reference là lỗ hổng: không bao giờ tự hết)
add_reference_stock: có rà soát scanned not_in_reference → ok/mismatch (đúng)
update_scanned_tag_id (sửa Tay Bảng 1): compare lại đầy đủ + trim bin (đúng)
```

## 5. Hai nguồn sự thật ở Bảng 1 (gốc của chữ đỏ "Khớp hoàn toàn")

`ReconciliationTable.tsx` hiện dùng 2 nguồn khác nhau trên cùng 1 hàng:

```
- Badge TRẠNG THÁI  ← r.status (DB, có thể stale sau import)
- Ô SL/BIN đỏ       ← isQtyDiff/isBinDiff = live-compare (sys từ byBatch vs r)
- Cột GHI CHÚ       ← ưu tiên live-compare:
    isDuplicate||isQtyDiff||isBinDiff||status mismatch → chữ ĐỎ (note)
    else status==='ok' → chữ XANH ("Khớp hoàn toàn")
    else → chữ VÀNG
→ Khi status stale ('ok') + live-compare diff (BIN 25 vs 01):
  badge xanh "Khớp" + note đỏ "Khớp hoàn toàn" = ảnh bug.
- KPI header (App.tsx) đếm theo r.status → cũng phồng "Khớp hoàn toàn".
- Row BIN HT '—': sys null hoặc sys.bin rỗng → live-compare falsy → rơi vào
  nhánh xanh dù thực chất nguồn đã mất → cảnh báo sai màu.
```

So sánh chuẩn lẽ ra phải là 1 nguồn:

```
lẽ ra: badge + note + KPI cùng suy từ live-compare (sys hiện tại vs r),
       r.status chỉ là gợi ý ban đầu từ lúc ghi, không phải chân lý sau import.
```

## 6. Chuẩn hóa dữ liệu (TRIM — bug ẩn thứ 2)

```
- Import TRIM đúng (stock_code/bin + giữ *_raw). PDA scan_submit so sánh
  `p_bin IS DISTINCT FROM v_ref.bin` KHÔNG trim → "25 " vs "25" = mismatch giả.
- Frontend live-compare `sys.bin !== r.bin` KHÔNG trim; useReferenceMap chỉ trim
  batch_id, giữ nguyên r.bin/qty thô → khoảng trắng đệm = đỏ giả.
- update_scanned_tag_id có btrim p_new_bin (đúng) → 3 nơi 3 kiểu = lệch nhau.
```

## 7. Realtime & hiện diện (nền cho lag PDA)

```
5 channel resilientSubscribe: presence + scanned_data + refmap + reftable + audit
  + heartbeat presence 20s + sweep 20s + refetch bù khi nối lại.
Bảng 2 tải 2 lần độc lập (useReferenceMap + ReferenceDataTable.load) → ~2×2721 dòng.
Bảng 1 sort localeCompare('vi', numeric) toàn danh sách mỗi render + filter keystroke.
Hiệu ứng chạy liên tục: duplicate-alert flash 0.8s infinite, animate-ping header,
animate-pulse nhiều chấm, backdrop-blur-md + glass-panel blur(16px) mọi modal,
transition-all + hover scale khắp bảng, shadow-2xl/inner.
```

## 8. Điểm cần sửa (đã triển khai 2026-09-22 — xem Learning.md cùng ngày)

```
✅ P0 (đúng/sai nghiệp vụ): (1) import recompute status sau upsert — migration
  20260922090000 (RPC recompute_scanned_statuses + backfill) + Edge gọi sau import;
  (2) note Bảng 1 không bao giờ "Khớp hoàn toàn" khi live-compare lệch/mất nguồn;
  (3) trim BIN 2 đầu ở live-compare + useReferenceMap (Edge/RPC sửa tay vốn đã trim);
  (4) sys-null → cảnh báo đỏ (không xanh); (5) recompute chữa cả pending/
  not_in_reference/duplicate-đơn-lẻ, batch ≥2 lượt giữ duplicate.
  ⏳ CHƯA LÊN CLOUD: cần db push + functions deploy (kẹt SUPABASE_DB_PASSWORD).
⏳ P1 (đa máy): refetch/broadcast sau import cho mọi client — để đợt sau.
✅ P2 (PDA lag, mức nhẹ): bỏ flash infinite + ping header + prefers-reduced-motion.
Tất cả đều KHÔNG đổi contract Edge/RPC (tương thích ngược), migration versioned
riêng nếu đụng DB — đúng hiến pháp AGENTS.md.
```
