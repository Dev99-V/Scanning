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

### [2026-09-05] Khắc phục lỗi Import file nguồn mẫu (2).xlsx và lỗi Bảng 1 không hiển thị dữ liệu quét

- **Khu vực**: Edge Function `import-reference`, `ReferenceImportCard.tsx`, Frontend Authentication (`AuthModal.tsx`, `App.tsx`, `useScannedData.ts`, `useReferenceMap.ts`, `ReferenceDataTable.tsx`)
- **Triệu chứng**:
  1. Khi người dùng nạp file `Stock Balance With Batch (2).xlsx` qua giao diện thì hệ thống báo `Lỗi import: Edge Function returned a non-2xx status code`.
  2. Khi quét mã PDA, Supabase Table Editor trong Dashboard ghi nhận dòng quét nhưng trên giao diện web (Bảng 1 - Danh sách quét & đối chiếu) không hiển thị dữ liệu, hiển thị 0 dòng.
- **Nguyên nhân gốc**:
  1. File `Stock Balance With Batch (2).xlsx` có tiêu đề ở dòng 2 (thay vì dòng 5 như file cũ), cột D bị trống (BATCH dời sang cột E, BIN cột F, Qty cột G), và trong file có 418 mã BATCH trùng nhau (mã che `******000832` ở kho 50). Logic cũ khóa cứng header dòng 5 và nạp mảng trùng vào PostgreSQL `ON CONFLICT (batch_id) DO UPDATE` gây lỗi Postgres `21000: ON CONFLICT DO UPDATE command cannot affect row a second time`. Thêm vào đó, `ReferenceImportCard.tsx` chưa trích xuất `error.context.json()` nên nuốt mất thông điệp chi tiết của backend.
  2. Toàn bộ schema cơ sở dữ liệu và RLS policies của hệ thống được cấu hình theo `Plan.md` §3 và §10 chỉ cấp quyền `SELECT` cho vai trò `authenticated`. Tuy nhiên, frontend trước đó hoàn toàn không có module / giao diện đăng nhập (Login/Sign-in) nên người dùng luôn ở vai trò `anon`. Khi client gửi truy vấn đọc `scanned_data` và `reference_stock`, Postgres RLS chặn `anon` và trả về 0 dòng rỗng. Đồng thời Supabase Realtime cũng từ chối gửi event `postgres_changes` cho `anon`. Ngoài ra, `App.tsx` chưa truyền `onScanned` callback cho `PdaScanModal` để re-fetch tức thì.
- **Cách sửa**:
  1. Backend `import-reference/index.ts`: Quét động 15 dòng đầu tìm dòng tiêu đề chứa đủ các cột (`Stock Code`, `Warehouse`, `BATCH`, `BIN`, `Qty`), tự động map chỉ mục cột (chấp nhận cột trống/lệch cột), và dùng `Map` khử trùng `batch_id` trước khi chunking để loại trừ hoàn toàn lỗi Postgres 21000.
  2. Frontend `ReferenceImportCard.tsx`: Bắt context JSON trả về từ Edge Function để hiển thị chi tiết nguyên nhân nếu có lỗi, và cập nhật thông báo import hiển thị số batch duy nhất nạp thành công.
  3. Frontend `AuthModal.tsx` & `App.tsx`: Xây dựng modal đăng nhập / đăng ký tài khoản Supabase Auth; hiển thị trạng thái người dùng (email + đăng xuất); hiển thị banner cảnh báo rõ ràng khi chưa đăng nhập để người dùng hiểu quy định bảo mật RLS; truyền `onScanned={refetch}` vào `PdaScanModal` để cập nhật Bảng 1 ngay lập tức khi hoàn thành lượt quét.
  4. Hooks `useScannedData.ts`, `useReferenceMap.ts`, `ReferenceDataTable.tsx`: Đăng ký lắng nghe `supabase.auth.onAuthStateChange` để tự động tải lại dữ liệu ngay khi người dùng đăng nhập hoặc đăng xuất.
- **Bằng chứng đã hết lỗi**:
  - `curl -X POST /functions/v1/import-reference -F "file=@Stock Balance With Batch (2).xlsx"` ➔ `{"ok":true,"data":{"total_rows_in_file":8845,"unique_batches":8055,"upserted":8055,"skipped":0}}`. Kiểm tra DB: 8055 dòng, spot-check TRIM chính xác, re-import ổn định.
  - Cả 8/8 QC gates chạy thành công liên tiếp (Exit 0): `qc_phase1.sh`, `qc_phase2.sh`, `qc_phase3.sh`, `qc_phase4.sh`, `qc_phase5.sh`, `qc_phase6.sh`, `qc_phase7.sh`, `qc_phase8.sh`.
  - Toàn bộ 12 test files của Frontend Vitest pass (39/39 tests), `npm run lint` 0 warning, `npm run build` thành công.
- **Cách phòng tránh lần sau**:
  - Khi làm việc với file Excel từ các nguồn xuất ERP khác nhau, luôn dò tìm vị trí header và tên cột động thay vì fix cứng số dòng và thứ tự cột.
  - Với các bảng có RLS yêu cầu `authenticated`, frontend bắt buộc phải có màn hình / nút đăng nhập rõ ràng, không giả định người dùng tự đăng nhập qua công cụ ngoài.

### [2026-09-04] Tái cấu trúc layout: Thẻ Quét Tag nổi (scantag.html), Stock Code, Thẻ Import và Cuộn 100 dòng

- **Khu vực**: Toàn bộ luồng PDA Scan (Migration DB, Edge Functions, RPC, PdaScanModal, ReconciliationTable, ReferenceDataTable)
- **Triệu chứng**: Giao diện cũ phân mảnh ô quét tĩnh và thiếu cột Stock Code ở bảng quét, thiếu thẻ import trực tiếp từ UI, thiếu bảng streaming trong modal và chưa hỗ trợ cuộn 100 dòng.
- **Nguyên nhân gốc**: Cần chuẩn hóa theo mô tả người dùng thực tế: modal nổi phong cách cyberpunk `scantag.html`, luồng quét 3 bước (Bin ➔ Tag ➔ Số lượng bắt buộc gõ tay từ đầu), cảnh báo trùng (Ghi thêm / Đổi vị trí) và cảnh báo ngoài nguồn (điền Stock Code) trực tiếp trong modal, giao diện chính xếp chồng 2 bảng với phân đoạn 100 dòng mượt mà.
- **Cách sửa**:
  1. DB: Tạo migration `20260904091500_add_stock_code_to_scanned_data.sql` thêm cột `stock_code`, cập nhật RPC `scan_submit` và `resolve_duplicate` nhận `p_stock_code`.
  2. Edge Functions: Cập nhật `scan-submit` và `resolve-duplicate` chuyển tiếp `stock_code`.
  3. Frontend: Xây dựng `PdaScanModal.tsx` kế thừa UI `scantag.html` (neon, glassmorphism, auto-jump focus Bin ➔ Tag ➔ Qty, cảnh báo trùng/ngoài nguồn, streaming table + export XLS); nâng cấp `ReconciliationTable.tsx` hiển thị đủ 7 cột (`Stock code`, `Tag ID`, `SL quét`, `Bin quét`, `SL hệ thống`, `Bin hệ thống`, `Ghi chú/Cảnh báo`) và cuộn 100 dòng; nâng cấp `ReferenceDataTable.tsx` tích hợp `ReferenceImportCard.tsx` nạp file Excel `Stock Balance With Batch.xlsx` từ dòng 5 header; cập nhật `exportExcel.ts` xuất đủ cột và ghi chú.
- **Bằng chứng đã hết lỗi**:
  - `bash backend/supabase/tests/qc_phase3.sh` PASS (7/7 checks)
  - `bash frontend/tests/qc_phase4.sh` PASS (5/5 checks)
  - `bash frontend/tests/qc_phase5.sh` PASS (5/5 checks)
  - `bash frontend/tests/qc_phase6.sh` PASS (5/5 checks)
  - `bash tests/qc_phase8.sh` PASS (5/5 checks, realtime live OK, 0 leftovers)
  - Vitest 11 test files, 35/35 tests PASS; `npm run build` PASS.
- **Cách phòng tránh lần sau**: Khi mở rộng contract thêm tham số mới (như `stockCode`), giữ tham số ở dạng optional/undefined-safe để không phá vỡ các unit test và API client cũ.
- **Liên quan**: `PdaScanModal.tsx`, `ReconciliationTable.tsx`, `ReferenceDataTable.tsx`, `ReferenceImportCard.tsx`, `exportExcel.ts`, migration `20260904091500_add_stock_code_to_scanned_data.sql`

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

### [2026-09-05] Loại bỏ yêu cầu đăng nhập và phân quyền RLS cho phép anon SELECT

- **Khu vực**: Postgres RLS policies (`scanned_data`, `reference_stock`, `scan_audit_log`) & Frontend UI (`App.tsx`, hooks)
- **Triệu chứng**: Người dùng yêu cầu bỏ hoàn toàn phần đăng nhập trên giao diện để công nhân kho có thể quét và xem dữ liệu ngay lập tức mà không cần qua bước login.
- **Nguyên nhân gốc**: RLS ban đầu chỉ cấu hình `for select to authenticated`. Nếu frontend không đăng nhập (kết nối với role `anon`), Postgres chặn không trả về dòng dữ liệu nào (`[]`) và Supabase Realtime không phát event tới client.
- **Cách sửa**:
  1. Tạo migration `20260905013000_allow_anon_read.sql` cấp quyền `SELECT` cho role `anon` trên cả 3 bảng (`reference_stock`, `scanned_data`, `scan_audit_log`).
  2. Các quyền ghi trực tiếp (`INSERT`/`UPDATE`/`DELETE`) của `anon` vẫn bị RLS chặn chặt chẽ; mọi thao tác ghi dữ liệu chỉ được thực hiện qua RPC / Edge Functions dùng `service_role`.
  3. Gỡ bỏ `AuthModal`, nút đăng nhập, banner cảnh báo đăng nhập khỏi frontend. Hooks tải dữ liệu trực tiếp và lắng nghe Realtime ngay khi mount.
  4. Cập nhật `qc_phase1.sql` và `qc_phase8.sh` để kiểm thử rằng anon có thể SELECT và không thể ghi trực tiếp.
- **Bằng chứng đã hết lỗi**: Cả 8/8 QC gates đều PASS. Vitest 11 files 35/35 tests PASS, lint clean, build clean.
- **Cách phòng tránh lần sau**: Với các ứng dụng kiosk/kho quét mã không yêu cầu định danh người dùng từng lượt quét, luôn mở RLS SELECT cho `anon` để Realtime và bảng đối chiếu hoạt động trơn tru.

### [2026-09-05] Nâng cấp giao diện PDA, bộ lọc thông minh Bảng 2, bộ lọc trạng thái Bảng 1 và xóa data cũ khi import

- **Khu vực**: Frontend (`PdaScanModal.tsx`, `ReconciliationTable.tsx`, `ReferenceDataTable.tsx`, `useReferenceMap.ts`, `exportExcel.ts`) & Backend Edge Function (`import-reference/index.ts`).
- **Triệu chứng & Yêu cầu người dùng**:
  1. Khi quét Tag ID trùng với nguồn: tự động tìm Stock Code và focus vào ô Số lượng, chỉ khi không tìm thấy mới bắt nhập Stock Code thủ công.
  2. Bảng 1 cần có bộ lọc trạng thái (Khớp, Lệch SL, Lệch Bin, Ngoài nguồn, Trùng) và ô tìm kiếm nhanh.
  3. Xuất file chuẩn `.xlsx` (SheetJS).
  4. Bảng 2 tải ĐỦ dữ liệu từ Supabase (thay vì giới hạn 1000 dòng mặc định của PostgREST) và render đủ 6 cột dữ liệu (`Stock Code`, `Tag ID`, `Kho`, `Bin`, `Số lượng`, `Ngày tạo`).
  5. Bộ lọc Bảng 2 thông minh: nếu có tiền tố `WH` (ví dụ `WH01`, `WH50`) thì dò theo cột Kho (`Warehouse`); nếu không có `WH` thì tự động dò tìm qua tất cả các cột dữ liệu khác.
  6. Khi import file nguồn mới: xóa toàn bộ data cũ trong `reference_stock` trước khi nạp mới vào.
  7. Đồng bộ màu thanh cuộn theo phong cách cyber dark của hệ thống.
  8. Tư vấn về bảng `scan_audit_log`: giải thích giá trị lưu trữ truy vết thay đổi / đổi vị trí.
- **Cách sửa**:
  1. `PdaScanModal.tsx`: sau khi scan Tag ID, tra cứu `systemByBatch` (hoặc query fallback tức thì tới Supabase `reference_stock`). Nếu khớp, tự set `matchedStockCode` và focus ngay `qtyInputRef`; nếu không khớp mới mở ô nhập `Stock Code`.
  2. `ReconciliationTable.tsx`: thêm dropdown lọc trạng thái (all, ok, qty_mismatch, bin_mismatch, not_in_reference, duplicate, pending) và thanh tìm kiếm nhanh.
  3. `useReferenceMap.ts` & `ReferenceDataTable.tsx`: dùng vòng lặp `.range(from, from + 999)` để phân trang lấy toàn bộ dữ liệu từ `reference_stock`, không còn bị cắt ở 1000 dòng.
  4. `ReferenceDataTable.tsx`: hiển thị đủ 6 cột; bộ lọc thông minh phân tích tiền tố `WH` để tìm theo `Warehouse` hoặc các trường còn lại.
  5. `import-reference/index.ts`: gọi `supabase.from("reference_stock").delete().neq("batch_id", "")` trước khi chunk upsert.
  6. `index.css`: thêm CSS chuẩn `::-webkit-scrollbar` và Firefox `scrollbar-color` tông màu slate/cyan/indigo đồng bộ dark mode.
- **Bằng chứng đã hết lỗi**: Cả 8/8 QC gates đều PASS. Vitest 11 files 35/35 tests PASS, lint clean, build clean.
- **Cách phòng tránh lần sau**: Với Supabase PostgREST, mặc định mỗi query chỉ trả tối đa 1000 records. Với bảng danh mục lớn (như 2721 dòng `reference_stock`), bắt buộc phải dùng vòng lặp `.range()` hoặc RPC phân trang để tải đủ.

### [2026-09-05] Khắc phục hiện tượng nhân đôi dòng tạm thời do race condition giữa Realtime và refetch

- **Khu vực**: Frontend state management (`useScannedData.ts`, `ReconciliationTable.tsx`, `PdaScanModal.tsx`, `App.tsx`).
- **Triệu chứng**: Sau khi quét tag, trên giao diện Bảng 1 xuất hiện 2 dòng giống hệt nhau. Sau khoảng gần 1 phút (khi có lần quét tiếp theo hoặc re-sync), dữ liệu mới co lại còn 1 dòng.
- **Nguyên nhân gốc**:
  1. Khi người dùng submit lượt quét, hai luồng đồng thời diễn ra:
     - Luồng 1: `onScanned` kích hoạt `refetch()` gửi HTTP GET query trực tiếp bảng `scanned_data`. Do DB đã commit, `refetch()` nhận về dòng mới và set vào state.
     - Luồng 2: Supabase Realtime phát event `postgres_changes` loại `INSERT` qua WebSocket tới client.
  2. Trước đó, trong `useScannedData.ts`, event `INSERT` dùng lệnh `setRows((prev) => [payload.new, ...prev])` mà KHÔNG kiểm tra `id` đã tồn tại trong `prev` hay chưa. Khi `refetch()` chạy xong trước, `prev` đã có dòng mới; event Realtime tới sau sẽ chèn thêm một bản sao nữa của chính dòng đó vào mảng state.
  3. Dưới database Supabase thực tế chỉ có DUY NHẤT 1 DÒNG. Hiện tượng nhân đôi hoàn toàn nằm ở bộ nhớ frontend do 2 luồng (HTTP query và WebSocket push) chồng lấn. Gần 1 phút sau khi người dùng quét mã tiếp theo hoặc token/channel làm mới, một lệnh `refetch()` khác chạy và ghi đè state bằng dữ liệu sạch từ DB, làm bản sao biến mất.
  4. Ngoài ra, việc dùng tên channel tĩnh `'scanned_data_changes'` có thể dẫn tới việc re-mount trong React giữ lại listener cũ, nhận 2 lần event.
- **Cách sửa**:
  1. Trong `useScannedData.ts`:
     - Xử lý `INSERT` và `UPDATE` theo cơ chế idempotent: kiểm tra `existingIdx = prev.findIndex(r => r.id === incoming.id)`. Nếu đã tồn tại thì cập nhật in-place, tuyệt đối không chèn thêm phần tử mới.
     - Khử trùng lặp ID trong cả hàm `fetchData()`.
     - Sinh tên channel độc lập theo timestamp/random (`scanned_data_changes_${Date.now()}_...`) để tránh chồng lấn listener.
  2. Bổ sung lớp phòng thủ hiển thị (defensive rendering) tại `ReconciliationTable.tsx`, `PdaScanModal.tsx` và `App.tsx` (stats): dùng `seenIds` để bảo đảm giao diện không bao giờ render 2 dòng có cùng `id`.
  3. Viết unit test mới kiểm thử tính idempotent: `it('INSERT cùng id không làm nhân đôi dòng (chống race condition giữa Realtime và refetch)')`.
- **Bằng chứng đã hết lỗi**: Test suite 11 files 36/36 tests PASS; toàn bộ 8/8 QC gates PASS; build clean.
- **Cách phòng tránh lần sau**: Với các ứng dụng vừa dùng Realtime WebSocket vừa có callback refetch/optimistic update, luôn xử lý cập nhật state dạng Upsert (idempotent theo khóa chính `id`), không bao giờ prepend/append mù quáng.

### [2026-09-05] Xóa lượt quét nhầm qua Modal nổi, cảnh báo đỏ chênh lệch, và chỉnh sửa số lượng nguồn Bảng 2

- **Khu vực**: Database schema (`migrations/20260905024500_delete_scan_and_update_ref_qty.sql`), RPCs (`delete_scanned_row`, `update_reference_qty`), Frontend (`ReconciliationTable.tsx`, `ReferenceDataTable.tsx`, `useReferenceMap.ts`, `App.tsx`).
- **Triệu chứng & Yêu cầu người dùng**:
  1. Thêm chức năng xóa dữ liệu trên Bảng 1 khi nhập nhầm, yêu cầu hỏi xác nhận trước khi xóa bằng Modal UI nổi.
  2. Thêm màu sắc cảnh báo chênh lệch (màu đỏ) đối với các số lượng bị chênh lệch và vị trí bin bị sai giữa thực tế và hệ thống.
  3. Thêm 1 nút chỉnh sửa số lượng ở Bảng 2 (không có nút xóa), chỉnh sửa đồng bộ với Supabase. Khi sửa không xóa số lượng cũ mà ghi số lượng mới và note lại số lượng trước đó ở cùng vị trí (số lượng cũ note gần nhất: ví dụ 500 sửa về 300 thì hiện 300 note (cũ: 500), sửa tiếp về 200 thì hiện 200 note (cũ: 300)), không cần ghi log cho thao tác này.
- **Cách sửa**:
  1. Database Migration `20260905024500_delete_scan_and_update_ref_qty.sql`:
     - Bổ sung cột `previous_qty numeric` vào bảng `reference_stock` để lưu vết số lượng cũ trước đó một cách bền vững trên DB.
     - Cập nhật foreign key `scan_audit_log_scanned_id_fkey` sang `ON DELETE SET NULL` để không bị lỗi ràng buộc khi xóa bản ghi `scanned_data`.
     - Tạo RPC `delete_scanned_row(p_id uuid)` (SECURITY DEFINER): Gỡ FK từ audit log và xóa dòng khỏi `scanned_data`. Cấp quyền execute cho `anon, authenticated, service_role`.
     - Tạo RPC `update_reference_qty(p_batch_id text, p_new_qty numeric)` (SECURITY DEFINER): Cập nhật `previous_qty = qty, qty = p_new_qty` nguyên tử trong Postgres, không ghi log vào `scan_audit_log`. Cấp quyền execute cho `anon, authenticated, service_role`.
  2. Frontend Bảng 1 ([ReconciliationTable.tsx](file:///workspaces/Scaning/frontend/src/components/ReconciliationTable.tsx)):
     - Cột Thao tác: Thêm nút 🗑️ kích hoạt Modal UI nổi xác nhận xóa với đầy đủ chi tiết lượt quét (Tag ID, Stock Code, SL, Bin, Trạng thái) và 2 nút Hủy / Xác nhận xóa.
     - Màu sắc cảnh báo chênh lệch: Khi `isQtyDiff` (lệch SL) hoặc `isBinDiff` (lệch Bin), highlight các ô và ghi chú bằng tông đỏ `rose` nổi bật (`text-rose-400`, `bg-rose-950/60`, `border-rose-500/60`).
  3. Frontend Bảng 2 ([ReferenceDataTable.tsx](file:///workspaces/Scaning/frontend/src/components/ReferenceDataTable.tsx)):
     - Cột Số lượng: Hiển thị số lượng hiện tại, nếu có `previous_qty` thì note ngay cùng vị trí `(cũ: [previous_qty])`.
     - Nút ✏️ mở Modal UI nổi cho phép gõ số lượng mới, gọi RPC `update_reference_qty`. Cập nhật đồng bộ cả state Bảng 2 và `useReferenceMap` để Bảng 1 tính toán lại đối chiếu tức thì. Không có nút xóa.
- **Bằng chứng đã hết lỗi**: Cả 8/8 QC gates đều PASS. Vitest 11 files 39/39 tests PASS, lint clean, build clean.

### [2026-09-05] Thêm tính năng chỉnh sửa Tag ID ở Bảng 1 không thay đổi cấu trúc hệ thống

- **Khu vực**: Database RPC migration (`migrations/20260905034500_update_scanned_tag_id.sql`), Frontend Bảng 1 ([ReconciliationTable.tsx](file:///workspaces/Scaning/frontend/src/components/ReconciliationTable.tsx)), [App.tsx](file:///workspaces/Scaning/frontend/src/App.tsx), Unit Tests ([ReconciliationTable.test.tsx](file:///workspaces/Scaning/frontend/src/components/__tests__/ReconciliationTable.test.tsx)).
- **Yêu cầu người dùng**: Thêm tính năng có thể chỉnh sửa Tag ID ở Bảng 1 (Reconciliation / Scanned Table) khi nhập hoặc quét nhầm mà không làm thay đổi các cấu trúc khác trong hệ thống.
- **Nguyên nhân & Giải pháp kiến trúc**:
  1. Giữ nguyên 100% cấu trúc các bảng (`scanned_data`, `reference_stock`, `scan_audit_log`), không thay đổi kiểu cột, không thay đổi các Edge Functions contract (`scan-submit`, `resolve-duplicate`, `import-reference`) và không ảnh hưởng các RPC hiện có.
  2. Tạo migration `20260905034500_update_scanned_tag_id.sql` với RPC `update_scanned_tag_id(p_id uuid, p_new_batch_id text, p_stock_code text default null)` chạy `security definer`:
     - Khóa dòng quét bằng `SELECT ... FOR UPDATE`.
     - Tra cứu `p_new_batch_id` trong `reference_stock`: nếu tìm thấy thì tự động đồng bộ `stock_code = v_ref.stock_code` và tính lại trạng thái đối chiếu (`ok`, `bin_mismatch`, `qty_mismatch`); nếu không có trong nguồn thì chuyển thành `not_in_reference` và nhận `p_stock_code` thủ công.
     - Kiểm tra trùng lặp với các lượt quét khác trong `scanned_data`: nếu trùng thì đánh dấu trạng thái `duplicate` kèm `resolution = 'appended'`.
     - Ghi nhận vào `scan_audit_log` với hành động `edit` (đã được định nghĩa sẵn từ schema khởi tạo) lưu cả giá trị cũ và mới.
     - Cấp quyền thực thi (`GRANT EXECUTE`) cho các role `anon, authenticated, service_role`.
  3. Frontend Bảng 1:
     - Cho phép click trực tiếp vào ô Tag ID hoặc bấm nút `✏️` ở cột Thao tác để mở Modal UI nổi `Chỉnh Sửa Tag ID` chuẩn phong cách Cyberpunk dark.
     - Hiển thị đầy đủ thông tin dòng quét hiện tại (Tag ID, Vị trí Bin, Số lượng, Trạng thái).
     - Hỗ trợ tra cứu tức thì theo dữ liệu nguồn (`systemByBatch`): nếu tìm thấy thì hiện badge xanh báo khớp kèm chi tiết mã hàng, vị trí, số lượng nguồn; nếu không có thì hiện cảnh báo ngoài hệ thống kèm ô điền mã hàng tùy chọn.
     - Gọi RPC `update_scanned_tag_id`, tự động kích hoạt callback `onRowUpdated` đồng bộ lại Bảng 1 ngay lập tức, đồng thời Supabase Realtime `UPDATE` event tự cập nhật in-place không cần reload trang.
- **Bằng chứng đã hết lỗi**:
  - Migration áp dụng thành công trên Postgres local; kiểm thử transaction trực tiếp cho cả 3 trường hợp: Khớp nguồn (chuyển sang `ok`), Trùng Tag ID (chuyển sang `duplicate`), Ngoài nguồn (nhận mã hàng tùy chọn và chuyển sang `not_in_reference`). Cả 3 trường hợp đều ghi log `edit` trong `scan_audit_log`.
  - Toàn bộ 8/8 QC gates đều PASS (Exit 0): `qc_phase1.sh`, `qc_phase2.sh`, `qc_phase3.sh`, `qc_phase4.sh`, `qc_phase5.sh`, `qc_phase6.sh`, `qc_phase7.sh`, `qc_phase8.sh`.
  - Vitest 11 test files với 41/41 tests PASS (bổ sung 2 tests mới cho luồng sửa Tag ID).
  - TypeScript strict check và Vite build thành công sạch sẽ.

### [2026-09-05] Thêm tính năng chỉnh sửa vị trí (Bin) ở Bảng 2 và tự động đồng bộ trạng thái đối chiếu

- **Khu vực**: Database schema (`migrations/20260905040000_update_reference_bin.sql`), RPCs (`update_reference_bin`, `update_reference_qty`), Frontend Bảng 2 ([ReferenceDataTable.tsx](file:///workspaces/Scaning/frontend/src/components/ReferenceDataTable.tsx)), [useReferenceMap.ts](file:///workspaces/Scaning/frontend/src/hooks/useReferenceMap.ts), [App.tsx](file:///workspaces/Scaning/frontend/src/App.tsx), Unit Tests ([ReferenceDataTable.test.tsx](file:///workspaces/Scaning/frontend/src/components/__tests__/ReferenceDataTable.test.tsx)).
- **Yêu cầu người dùng**: Thêm tính năng chỉnh sửa vị trí (Bin) ở Bảng số 2 (Reference Data Table) đồng bộ với Supabase, lưu vết vị trí cũ ngay tại ô Bin `(cũ: [previous_bin])`, không xóa dữ liệu cũ.
- **Nguyên nhân & Giải pháp kiến trúc**:
  1. Tương tự như cơ chế chỉnh sửa số lượng (`previous_qty`), thêm cột `previous_bin text default null` vào bảng `reference_stock` để lưu vết vị trí trước đó bền vững trên cơ sở dữ liệu.
  2. Tạo RPC `update_reference_bin(p_batch_id text, p_new_bin text)` (`SECURITY DEFINER`):
     - Kiểm tra tham số hợp lệ (`p_batch_id`, `p_new_bin` không rỗng sau khi trim).
     - Cập nhật `previous_bin = v_old_bin, bin = v_clean_bin` cho dòng tương ứng trong `reference_stock`.
     - Tự động đánh giá và tính toán lại `status` (`bin_mismatch`, `qty_mismatch`, `ok`) cho tất cả các dòng đã quét trong `scanned_data` có `batch_id` tương ứng, giúp Bảng 1 cập nhật trạng thái đối chiếu ngay lập tức.
     - Cập nhật cả RPC `update_reference_qty` để cũng tự động tính toán lại `status` cho `scanned_data`.
     - Cấp quyền execute cho `anon, authenticated, service_role`.
  3. Frontend:
     - Hook `useReferenceMap.ts`: Bổ sung hàm `updateBatchBin(batchId, newBin)` để cập nhật bản đồ tra cứu tức thì trong bộ nhớ.
     - Component `ReferenceDataTable.tsx`: Cột Bin hiển thị vị trí hiện tại và ghi chú `(cũ: [previous_bin])` nếu có; nút `✏️` mở Modal UI nổi `Chỉnh Sửa Vị Trí Nguồn (Bin)` phong cách Cyberpunk dark.
     - Component `App.tsx`: Nối callback `onBinUpdated` để đồng thời cập nhật `useReferenceMap` và kích hoạt refetch Bảng 1.
- **Bằng chứng đã hết lỗi**:
  - Migration áp dụng thành công trên Postgres local; kiểm thử transaction update bin trực tiếp và kiểm tra việc tự động chuyển `status` từ `bin_mismatch` sang `ok`.
  - Cả 8/8 QC gates đều PASS (Exit 0): `qc_phase1.sh`, `qc_phase2.sh`, `qc_phase3.sh`, `qc_phase4.sh`, `qc_phase5.sh`, `qc_phase6.sh`, `qc_phase7.sh`, `qc_phase8.sh`.
  - Vitest 11 test files với 42/42 tests PASS (bao gồm test mở modal và kiểm tra ghi chú vị trí cũ).
  - TypeScript strict (`tsc -b`) và Vite build thành công không lỗi; Biome lint 0 lỗi 0 cảnh báo.





