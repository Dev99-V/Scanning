# LEARNING.md — Nhật ký lỗi & giải pháp đã xác nhận

> Mục đích: mỗi khi gặp và **sửa xong** 1 lỗi (đã có bằng chứng theo
> `Rules.md` mục 4), ghi lại tại đây theo template bên dưới. Trước khi sửa 1
> lỗi mới, luôn tìm trong file này trước (Ctrl+F theo từ khóa lỗi/khu vực
> code) để tránh dò lại từ đầu.
>
> Không ghi phỏng đoán chưa xác nhận vào đây — chỉ ghi khi đã có bằng chứng
> là đã hết lỗi.

---

## Template (copy khối bên dưới cho mỗi lỗi mới)

```
### [YYYY-MM-DD] Tiêu đề ngắn gọn mô tả lỗi

- **Khu vực**: (vd: Edge Function scan-submit / ReconciliationTable / migration 003)
- **Triệu chứng**: mô tả hiện tượng quan sát được (log lỗi, hành vi sai)
- **Nguyên nhân gốc**: nguyên nhân thực sự đã xác minh (không phải suy đoán)
- **Cách sửa**: thay đổi cụ thể đã áp dụng (file/dòng/logic)
- **Bằng chứng đã hết lỗi**: (test pass nào / lệnh nào / số liệu đối chiếu nào)
- **Cách phòng tránh lần sau**: quy tắc rút ra để không lặp lại
- **Liên quan**: (link tới file/Phase trong Plan.md nếu có)
```

---

## Nhật ký

### [2026-09-04] P8 e2e live: toàn bộ luồng xanh, 0 sai lệch với dữ liệu mẫu

- **Khu vực**: E2E tổng (auth + RLS + đối chiếu mẫu thật + realtime live + audit)
- **Triệu chứng**: (kiểm tổng theo Plan §9-Phase 8, không phải lỗi) — chạy gate `tests/qc_phase8.sh`
- **Kết quả đã xác minh**: auth local sign-in OK; authenticated đọc reference được, anon không thấy scanned_data (RLS đúng); mẫu 4 batch thật → ok / qty_mismatch / bin_mismatch / not_in_reference đúng hết, duplicate → conflict, append + relocate đúng, 6/6 dòng ghi đúng `scanned_by`, audit actor đủ; realtime INSERT live tới client (`QC8_REALTIME_OK`); reference giữ nguyên 2721 dòng; cleanup 0 dòng sót
- **Bài học kỹ thuật**: (1) `UID` là biến readonly của bash — script dùng `E2E_UID`; (2) gate e2e phải pre-clean dữ liệu test ở đầu để rerun hermetic (leftover khiến lần chạy sau fail giả); (3) `node file.mjs` resolve module theo vị trí FILE, không theo cwd — import tương đối tới `frontend/node_modules`
- **Liên quan**: Phase 8, `tests/qc_phase8.sh`, `tests/qc_phase8_realtime.mjs`

### [2026-09-04] Parse YAML workflow: key `on` thành boolean True

- **Khu vực**: QC gate Phase 7 (PyYAML đọc `.github/workflows/*.yml`)
- **Triệu chứng**: `d.get('on')` trả `None` dù file có trigger `on:` hợp lệ
- **Nguyên nhân gốc**: YAML 1.1 parse key `on` không quote thành boolean `True` (bẫy kinh điển của GitHub Actions + PyYAML)
- **Cách sửa**: đọc trigger bằng `d.get('on', d.get(True, {}))`
- **Bằng chứng đã hết lỗi**: gate QC_PHASE7 check YAML pass
- **Cách phòng tránh lần sau**: mọi script Python đọc workflow GitHub Actions đều phải xử lý key `True`
- **Liên quan**: Phase 7, `tests/qc_phase7.sh`

### [2026-09-04] Vitest + RTL: render rò sang test khác (Found multiple elements)

- **Khu vực**: Frontend tests (`PdaScanPanel.test.tsx`, Vitest 5 + RTL 16, `globals` tắt)
- **Triệu chứng**: 5/13 test fail `Found multiple elements with the placeholder text` dù component đúng
- **Nguyên nhân gốc**: RTL chỉ tự `cleanup` khi phát hiện `afterEach` global; Vitest mặc định không bật globals nên render các test trước không bị unmount
- **Cách sửa**: `src/test/setup.ts` đăng ký tường minh `afterEach(() => cleanup())`
- **Bằng chứng đã hết lỗi**: `npx vitest run` 13/13 pass
- **Cách phòng tránh lần sau**: mọi dự án Vitest + RTL không dùng `globals:true` đều cần dòng này trong setupFiles
- **Liên quan**: Phase 4, Skills B

### [2026-09-04] functions serve từ chối env SUPABASE_* + .env serve không dùng tới

- **Khu vực**: Edge Functions local (`supabase functions serve --env-file supabase/.env`)
- **Triệu chứng**: log hiện `Env name cannot start with SUPABASE_, skipping` cho cả `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` trong file env
- **Nguyên nhân gốc**: CLI tự inject `SUPABASE_URL`/`SERVICE_ROLE_KEY` (trỏ đúng kong nội bộ) vào runtime, cấm override bằng tiền tố `SUPABASE_`
- **Cách sửa**: code Edge Function cứ đọc `Deno.env.get("SUPABASE_URL"/"SUPABASE_SERVICE_ROLE_KEY")`, chạy serve không cần `--env-file`; file `backend/supabase/.env` local chỉ còn giá trị tài liệu, không ảnh hưởng runtime
- **Bằng chứng đã hết lỗi**: 3 functions serve + import/scan/resolve chạy thật trên local đều kết nối DB thành công
- **Cách phòng tránh lần sau**: không debug "thiếu env" khi thấy dòng skipping này — đó là hành vi chuẩn
- **Liên quan**: Phase 2/3, Skills C

### [2026-09-04] Quyết định concurrency: db_row_lock_rpc (không phải explicit_queue_table)

- **Khu vực**: Concurrency scan-submit, `Plan.md` mục 5
- **Triệu chứng**: (quyết định kiến trúc, chưa phải lỗi) — cần chốt 1 trong 2 chiến lược trước Phase 3, đã được user xác nhận chọn `db_row_lock_rpc`
- **Nguyên nhân gốc**: 2 request cùng `batch_id` đến đồng thời cần serialize; lock ở tầng DB là điểm serialize tự nhiên duy nhất cả Edge Functions và RPC đều đi qua
- **Cách sửa**: (áp dụng từ Phase 3) toàn bộ đối chiếu + `SELECT ... FOR UPDATE` theo `batch_id` nằm trong 1 hàm `plpgsql` gọi qua `supabase.rpc()` trong 1 transaction; không tách so sánh ra JS, không thêm bảng `scan_submit_queue`/worker
- **Bằng chứng đã hết lỗi**: (chờ Phase 3) test race-condition: 2 request đồng thời cùng `batch_id` không mất dữ liệu
- **Cách phòng tránh lần sau**: không trộn nửa vời 2 phương án; nếu sau này cần UI hiện trạng thái hàng chờ thì mới xem lại quyết định này qua `Plan.md` + `state.json`
- **Liên quan**: `Plan.md` §4 bước 3, §5, §9 Phase 3; `Skills.md` A; `state.json:decisions_locked.concurrency_strategy`
