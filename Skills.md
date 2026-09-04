# SKILLS.md — Kỹ năng kỹ thuật cho Agent Coding

> File này định nghĩa **kỹ năng nào dùng cho việc nào**. Agent phải xác định
> mình đang làm nhánh nào (Backend/DB, Frontend, API/Config, DevOps) trước
> khi viết code, và chỉ dùng kỹ thuật thuộc đúng nhánh đó trừ khi `Plan.md`
> yêu cầu khác.

---

## A. Skill: Backend & Database (Supabase/Postgres)

**Phạm vi áp dụng**: schema, migration, RLS, Edge Functions, import Excel,
xử lý đối chiếu, khóa concurrency.

- **Schema design**: dùng `text` cho `batch_id`/`bin`/`stock_code` (dữ liệu
  nguồn có khoảng trắng đệm và giá trị dạng số-nhưng-là-mã, không ép
  `integer`/`numeric` cho các cột định danh).
- **Migration**: viết migration Supabase CLI (`supabase/migrations/*.sql`),
  không sửa schema trực tiếp qua dashboard trong môi trường production —
  mọi thay đổi schema phải có file migration versioned.
- **Row Level Security (RLS)**: bật RLS cho mọi bảng chứa dữ liệu nghiệp vụ;
  viết policy tường minh cho `select/insert/update/delete`, không tắt RLS
  để "cho dễ test".
- **Edge Functions (Deno/TypeScript)**:
  - 1 function/1 trách nhiệm rõ ràng (`import-reference`, `scan-submit`,
    `resolve-duplicate`).
  - Toàn bộ logic đối chiếu + khóa (`FOR UPDATE`) nằm trong **1 RPC
    (`plpgsql` function)** được Edge Function gọi qua `supabase.rpc()`, để
    đảm bảo tính transaction/atomic — không tách logic so sánh ra làm ở
    tầng Edge Function (JS) vì sẽ mất tính atomic với DB lock.
- **Xử lý Excel nguồn**: dùng thư viện `xlsx`/`sheetjs` (đã dùng trong bản
  cũ) hoặc `exceljs` phía server để parse file `.xlsx`; luôn:
  - Bỏ qua dòng header rác (dòng 1–4 theo cấu trúc file mẫu).
  - `TRIM()` mọi cột text trước khi ghi DB.
  - Dùng `upsert (on conflict batch_id do update)` để import lại không tạo
    trùng.
- **Concurrency**: dùng `SELECT ... FOR UPDATE` theo `batch_id` trong RPC,
  hoặc bảng hàng chờ `scan_submit_queue` nếu `Plan.md` mục 5 chọn phương án
  hàng đợi tường minh — không dùng `setTimeout`/khóa giả ở phía client để
  "giả lập" hàng chờ.
- **Testing**: viết test cho RPC bằng `pgTAP` hoặc test tích hợp gọi qua
  Supabase client trong CI, đặc biệt test race-condition (2 request đồng
  thời cùng `batch_id`).

## B. Skill: Frontend (React + TypeScript)

**Phạm vi áp dụng**: UI quét PDA, bảng đối chiếu, cảnh báo, export.

- **Stack cụ thể**: React 18+, TypeScript strict mode (`strict: true` trong
  `tsconfig.json`), Vite làm build tool (nhanh, phù hợp deploy static qua
  GitHub Actions).
- **State/data**: dùng Supabase client JS SDK + `postgres_changes`
  subscription cho realtime; không dùng Redux/global cache phức tạp cho dữ
  liệu nghiệp vụ — dữ liệu quét phải phản ánh trực tiếp DB (theo yêu cầu
  "chạy realtime không cache").
- **UI kế thừa từ `scantag.html`**: giữ 2 mode quét (Vị trí → Tag ID), input
  auto-focus, style neon/glass hiện có có thể tái dùng làm nền tảng CSS
  (Tailwind), nhưng **phải viết lại bằng component React có kiểu dữ liệu rõ
  ràng**, không copy nguyên script DOM thuần.
- **Component tách rõ**:
  - `PdaScanPanel` (quét vị trí/tag)
  - `ManualEntryForm` (nhập tay không qua PDA)
  - `ReconciliationTable` (Bảng 1 — cảnh báo inline theo hàng)
  - `ReferenceDataTable` (Bảng 2 — dữ liệu hệ thống, read-only)
  - `DuplicateAlertToast` (cảnh báo nổi, 2 nút: Ghi thêm / Đổi vị trí)
- **Excel export**: dùng `xlsx` (SheetJS) phía client như bản cũ, ép định
  dạng `@` (text) cho cột mã để tránh Excel tự chuyển số/mất số 0 đầu.
- **Accessibility & PDA thực tế**: input quét phải nhận input dạng "gõ
  nhanh + Enter" (PDA hoạt động như bàn phím ảo) — giữ `onKeyPress`/`onKeyDown`
  lắng nghe phím Enter, không dùng debounce làm mất ký tự.
- **Testing**: Vitest + React Testing Library cho component, Playwright (tuỳ
  chọn) cho luồng end-to-end quét → cảnh báo → export.

## C. Skill: API / Cấu hình / Tích hợp

- **Kết nối Supabase**: dùng biến môi trường (`SUPABASE_URL`,
  `SUPABASE_ANON_KEY` cho frontend; `SUPABASE_SERVICE_ROLE_KEY` **chỉ** dùng
  trong Edge Function/CI, không bao giờ đưa vào bundle frontend).
- **Realtime config**: bật Realtime cho bảng `scanned_data` trong Supabase
  dashboard/migration (`alter publication supabase_realtime add table
  scanned_data;`), subscribe theo filter cần thiết (ví dụ theo `warehouse`
  nếu có nhiều kho hoạt động song song) để giảm tải.
- **API versioning**: mọi Edge Function đặt tên rõ chức năng, version hoá
  qua path nếu có breaking change (`/scan-submit-v2`), không sửa hành vi
  ngầm của endpoint đang chạy production.
- **Error contract**: mọi Edge Function trả JSON có cấu trúc thống nhất
  `{ ok: boolean, data?, error?: { code, message } }`, để frontend xử lý
  cảnh báo (`qty_mismatch`, `bin_mismatch`, `duplicate`, `not_in_reference`)
  dựa vào `error.code` thay vì parse chuỗi message.

## D. Skill: DevOps / CI-CD (GitHub Actions)

- **Backend pipeline** (`.github/workflows/backend-deploy.yml`):
  1. Lint + test migration/RPC.
  2. `supabase db push` (hoặc `supabase migration up`) vào project qua
     `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_ID` lưu trong GitHub Secrets.
  3. Deploy Edge Functions (`supabase functions deploy`).
  4. Chạy trên nhánh `main` sau khi PR merge, có thể thêm bước "deploy vào
     staging project trước, rồi promote" nếu cần (ghi rõ trong `state.json`
     nếu áp dụng).
- **Frontend pipeline** (`.github/workflows/frontend-deploy.yml`):
  1. Install, typecheck (`tsc --noEmit`), lint, test (Vitest).
  2. Build (`vite build`).
  3. Deploy static output tới host đã xác nhận (xem `Plan.md` mục 10 — phải
     xác nhận trước khi cấu hình).
- **Secrets**: không commit bất kỳ key nào vào repo — dùng GitHub Secrets,
  và với biến `VITE_*` (public anon key) vẫn nên qua secret để dễ đổi theo
  môi trường (dev/staging/prod).
- **Không tự động deploy production từ nhánh không phải `main`** trừ khi
  `Plan.md`/`state.json` ghi rõ chiến lược nhánh khác.

---

## E. Nguyên tắc chọn skill

1. Xác định đang ở nhánh nào (A/B/C/D) trước khi viết dòng code đầu tiên.
2. Nếu 1 task chạm nhiều nhánh (ví dụ sửa Edge Function ảnh hưởng cả API
   contract lẫn frontend), phải note rõ trong `state.json` các nhánh liên
   quan để agent khác (nếu chạy song song) biết tránh đụng.
3. Không áp dụng kỹ thuật ngoài danh sách trên (ví dụ thêm Redis cache,
   GraphQL layer, message broker riêng) trừ khi `Plan.md` được cập nhật để
   yêu cầu — tránh phình kiến trúc ngoài phạm vi đã duyệt.
