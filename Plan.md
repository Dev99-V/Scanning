# PLAN.md — PDA Scan & Reconciliation System

## 0. Bối cảnh & Mục tiêu

Hệ thống hiện tại (`scantag.html`) là 1 trang tĩnh dùng PDA quét barcode, lưu vào
`localStorage` và xuất Excel. Mục tiêu của giai đoạn phát triển mới:

1. Giữ nguyên trải nghiệm quét bằng PDA (2 chế độ: quét **Vị trí (Bin)** trước,
   rồi quét **Tag ID**), nhưng chuyển từ lưu tạm trình duyệt sang **hệ thống
   thật (Supabase)**, realtime, nhiều người dùng cùng lúc.
2. Đối chiếu dữ liệu quét với **dữ liệu nguồn** (file tồn kho theo batch) đã
   được import trước đó vào hệ thống.
3. Phát hiện & cảnh báo: **trùng Tag ID**, **lệch số lượng**, **lệch vị trí**,
   **Tag ID không tồn tại trong nguồn** (cho phép thêm thủ công).
4. Stack: **TypeScript + React + Supabase (Postgres/Realtime/Auth/Edge
   Functions)**, deploy bằng **GitHub Actions**.

> Agent coding **không được tự suy diễn thêm tính năng** ngoài phạm vi file
> này. Nếu thiếu thông tin, phải dừng lại và hỏi (xem `Rules.md`).

---

## 1. Dữ liệu nguồn (Reference Data)

File mẫu đã cung cấp: `Stock Balance With Batch.xlsx`, sheet
`Stock Balance With Batch`, header thực tế ở **dòng 5**:

| Cột Excel | Tên cột       | Kiểu dữ liệu thực tế         | Vai trò trong hệ thống                                   |
|-----------|---------------|-------------------------------|-----------------------------------------------------------|
| A         | `Stock Code`  | text, có khoảng trắng đệm (cần `TRIM`) | Mã hàng                                          |
| B         | `Warehouse`   | text (vd `01`, `61`)          | Mã kho                                                     |
| C         | `CREATEDATE`  | datetime                      | Ngày tạo tồn kho                                           |
| D         | `BATCH`       | text/số 12 chữ số             | **= Tag ID / UUID nghiệp vụ, KEY duy nhất để lookup**      |
| E         | `BIN`         | text, có khoảng trắng đệm     | Vị trí lưu kho (đối chiếu với vị trí quét)                 |
| F         | `Qty`         | số                             | Số lượng tồn kho theo batch (đối chiếu với số lượng quét)  |

**Ghi chú kỹ thuật bắt buộc đọc trước khi code:**
- Dòng 1–4 là tiêu đề/metadata, phải bỏ qua khi import (`Company：K6`, dòng
  trống, 1 dòng chứa số lẻ không rõ nghĩa ở C3 — agent **không được tự suy
  diễn** ý nghĩa, chỉ bỏ qua khi import).
- `Stock Code` và `BIN` có khoảng trắng đệm cuối chuỗi trong file mẫu → phải
  `TRIM()` khi import, nhưng **giữ nguyên bản gốc** trong 1 cột raw để đối
  chiếu nếu cần audit.
- `BATCH` là key nghiệp vụ chính (tương đương "Tag ID" trong yêu cầu người
  dùng) — **không suy ra UUID ngẫu nhiên**, dùng đúng giá trị `BATCH` làm
  khóa tra cứu.
- 1 `Stock Code` có thể có nhiều `BATCH` khác nhau ở nhiều `Warehouse`/`BIN`
  khác nhau (đã thấy trong dữ liệu mẫu) → khóa lookup là `BATCH` đơn lẻ
  (không cần ghép thêm Stock Code), vì đề bài xác nhận "tagid là Key-uuid".

---

## 2. Kiến trúc tổng thể

```
┌─────────────────────┐        ┌───────────────────────────┐
│  Frontend (React+TS) │  <──>  │ Supabase (Postgres +      │
│  PDA scan UI, bảng   │ realtime│ Realtime + Edge Functions │
│  đối chiếu, cảnh báo │  ws    │ + RLS + Storage)           │
└─────────────────────┘        └───────────────────────────┘
          │                                  │
          ▼                                  ▼
   GitHub Actions (build/deploy       GitHub Actions (chạy
   frontend – Pages/Vercel/           `supabase db push`,
   static host)                       deploy Edge Functions)
```

- Không dùng `localStorage` cho dữ liệu nghiệp vụ — chỉ giữ tạm state UI
  (mode đang quét, focus input) nếu cần.
- Mọi ghi/đọc dữ liệu quét đi qua Supabase realtime, không cache ở client.

---

## 3. Schema Database (Supabase / Postgres)

### 3.1 `reference_stock` — dữ liệu import từ file nguồn
```sql
create table reference_stock (
  batch_id      text primary key,        -- = BATCH = Tag ID nghiệp vụ
  stock_code    text not null,
  warehouse     text not null,
  bin           text not null,
  qty           numeric not null,
  create_date   timestamptz,
  imported_at   timestamptz default now(),
  imported_by   uuid references auth.users(id)
);
create index idx_reference_stock_bin on reference_stock (bin);
create index idx_reference_stock_warehouse on reference_stock (warehouse);
```

### 3.2 `scanned_data` — dữ liệu quét thực tế
```sql
create table scanned_data (
  id            uuid primary key default gen_random_uuid(),
  batch_id      text not null,           -- Tag ID quét được
  qty           numeric not null,
  bin           text not null,
  scanned_by    uuid references auth.users(id),
  scanned_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  is_manual     boolean default false,   -- true nếu nhập tay không qua PDA
  status        text not null default 'pending'
                 check (status in ('pending','ok','qty_mismatch',
                                    'bin_mismatch','not_in_reference',
                                    'duplicate')),
  resolution    text                     -- 'appended' | 'relocated' | null
);
-- Không đặt unique cứng trên batch_id: cho phép "ghi thêm" khi user chọn
-- append; việc phát hiện trùng được xử lý ở tầng nghiệp vụ (Edge Function),
-- không phải constraint chặn cứng.
create index idx_scanned_data_batch on scanned_data (batch_id);
create index idx_scanned_data_bin on scanned_data (bin);
create index idx_scanned_data_status on scanned_data (status);
```

### 3.3 `scan_audit_log` — lịch sử thao tác (phục vụ truy vết/Learning)
```sql
create table scan_audit_log (
  id           bigint generated always as identity primary key,
  scanned_id   uuid references scanned_data(id),
  action       text not null,   -- 'insert' | 'append' | 'relocate' | 'edit' | 'delete'
  old_value    jsonb,
  new_value    jsonb,
  actor        uuid references auth.users(id),
  created_at   timestamptz default now()
);
```

### 3.4 Đề xuất chiến lược Index
- `batch_id` là chuỗi có độ dài cố định/gần cố định (12 ký tự trong mẫu) →
  B-Tree index mặc định là đủ, **không cần** GIN/trigram trừ khi có yêu cầu
  tìm kiếm mờ (fuzzy search) sau này.
- Composite index `(warehouse, bin)` trên `reference_stock` phục vụ màn hình
  lọc theo kho/vị trí.
- Index trên `status` của `scanned_data` phục vụ query "chỉ hiển thị dòng có
  cảnh báo" mà không phải quét toàn bảng.
- Không đánh index thừa trên các cột ít filter (`create_date`, `imported_at`)
  trừ khi có báo cáo cần lọc theo ngày.

---

## 4. Luồng nghiệp vụ (Business Flow)

1. **Import dữ liệu nguồn**: Admin upload `Stock Balance With Batch.xlsx` →
   Edge Function parse (bỏ 4 dòng đầu, `TRIM` các cột text) → upsert vào
   `reference_stock` theo `batch_id`.
2. **Quét PDA / nhập tay**:
   - Bước 1: quét **Vị trí (Bin)** → set "Active Bin" hiện hành trên UI.
   - Bước 2: quét **Tag ID** → gửi request tới Edge Function `scan-submit`
     kèm `{ batch_id, qty, bin, is_manual }`.
3. **Đối chiếu (Edge Function `scan-submit`)**, thực hiện **trong 1
   transaction** để tránh race-condition khi 2 request đến cùng lúc (xem
   mục 5):
   a. Lock theo `batch_id` (xem mục 5).
   b. Lookup `reference_stock` theo `batch_id`.
      - Không tồn tại → `status = not_in_reference`, vẫn cho lưu (vì đề bài
        cho phép thêm thủ công không khóa cứng với PDA).
      - Tồn tại → so `qty` và `bin` quét với `qty`/`bin` trong nguồn:
        - Khớp cả 2 → `status = ok`.
        - Lệch `qty` → `status = qty_mismatch`.
        - Lệch `bin` → `status = bin_mismatch`.
   c. Kiểm tra trùng `batch_id` đã tồn tại trong `scanned_data` (chưa bị
      xoá) → nếu có, **không tự động ghi**, trả về conflict để frontend hiện
      cảnh báo nổi (xem mục 6), không lưu bản ghi mới cho tới khi user chọn
      "Ghi thêm" hoặc "Đổi vị trí".
   d. Ghi `scan_audit_log`.
4. **Không hiển thị lại Tag ID nguồn** trên UI đối chiếu (theo yêu cầu) —
   chỉ hiển thị **số lượng hệ thống** và **vị trí hệ thống** cạnh số liệu
   quét được để so sánh trực quan, Tag ID nguồn dùng nội bộ để lookup.

---

## 5. Realtime & Xử lý ghi đồng thời (Queue)

- **Không cache**: Frontend subscribe `postgres_changes` trên `scanned_data`
  qua Supabase Realtime; mọi UI đọc trực tiếp từ subscription, không giữ bản
  sao cũ quá thời gian sống của phiên.
- **Hàng chờ khi 2 request ghi cùng lúc trên cùng 1 `batch_id`**:
  - Phương án khuyến nghị (ưu tiên): xử lý **tại tầng DB** bằng
    `SELECT ... FOR UPDATE` trong 1 hàm `plpgsql` (RPC) gọi từ Edge
    Function, đảm bảo 2 request cùng `batch_id` được **serialize** tự nhiên
    (request thứ 2 chờ tới khi transaction thứ 1 commit/rollback).
  - Phương án bổ sung ở tầng ứng dụng (nếu cần hàng đợi hiển thị được cho
    người dùng, ví dụ "đang xử lý 2 quét cùng lúc..."): dùng bảng
    `scan_submit_queue` (trạng thái `queued/processing/done/failed`) và 1
    worker (Edge Function cron hoặc Postgres `pg_cron`) xử lý tuần tự theo
    `batch_id`; dùng khi cần UI hiển thị trạng thái hàng chờ rõ ràng cho
    nhiều máy PDA quét cùng lúc.
  - Agent coding **phải chọn 1 trong 2 và ghi rõ lý do vào `Learning.md`**
    trước khi triển khai, không tự trộn lẫn nửa vời.

---

## 6. Xử lý trùng Tag ID (Duplicate Handling)

Khi phát hiện `batch_id` đã tồn tại trong `scanned_data`:
1. Hiển thị **thông báo UI nổi (toast/modal nổi)**, không chặn hoàn toàn màn
   hình, với 2 lựa chọn:
   - **"Ghi thêm"**: tạo thêm 1 bản ghi mới cùng `batch_id`
     (`resolution = 'appended'`), sau khi ghi vẫn tiếp tục hiển thị cảnh báo
     trùng (vì đề bài yêu cầu: "ghi thêm thì dữ liệu sẽ được ghi thêm và
     cảnh báo lại").
   - **"Đổi vị trí"**: **ghi đè `bin`** của bản ghi cũ bằng vị trí mới chọn,
     không tạo bản ghi mới (`resolution = 'relocated'`).
2. Cả 2 hành động đều ghi vào `scan_audit_log`.
3. Dòng liên quan trong bảng đối chiếu hiển thị cảnh báo **ngay trên hàng**
   (inline), độc lập với toast nổi.

---

## 7. UI Layout (bám theo phong cách `scantag.html` hiện có)

1. **Khu vực quét PDA**: giữ nguyên concept 2 mode (Vị trí → Tag ID) +
   ô nhập thủ công cho trường hợp cần thêm/sửa không qua PDA.
2. **Bảng 1 — Dữ liệu quét thực tế & đối chiếu**: mỗi hàng = 1 lượt quét,
   hiển thị Tag ID (ẩn thông tin nguồn thô), Qty quét vs Qty hệ thống, Bin
   quét vs Bin hệ thống, cờ trạng thái (`ok/qty_mismatch/bin_mismatch/
   not_in_reference/duplicate`) hiển thị màu ngay trên hàng.
3. **Bảng 2 — Dữ liệu hệ thống đã import**: read-only, phục vụ tra cứu/đối
   soát thủ công, lọc theo kho/bin.
4. **Thông báo nổi (toast)**: chỉ xuất hiện khi có điều kiện đúng (trùng
   Tag ID) — không dùng cho các cảnh báo đã hiển thị inline ở Bảng 1.
5. **Export Excel**: giữ chức năng export như bản cũ, cộng thêm export kèm
   cột trạng thái đối chiếu.

---

## 8. Chia dự án Backend / Frontend

Đề bài cho phép 2 phương án — agent coding **phải xác nhận phương án nào
đang dùng và ghi vào `state.json`** trước khi bắt đầu:

- **Phương án A (khuyến nghị nếu có 2 agent riêng biệt)**: 2 repo riêng —
  `pda-backend` (Supabase migrations, Edge Functions, RLS policies, GitHub
  Actions deploy DB/Functions) và `pda-frontend` (React + TS, GitHub Actions
  build & deploy static site), giao tiếp qua Supabase client SDK + REST/RPC,
  không agent nào sửa trực tiếp code của agent kia.
- **Phương án B (1 agent, nhiều sub-agent theo phiên)**: 1 repo mono, chia
  thư mục `/backend` (supabase/) và `/frontend` (src/), mỗi sub-agent chỉ
  chạy test/thao tác trong thư mục được giao, log việc bàn giao vào
  `state.json`.

---

## 9. Các giai đoạn triển khai (Milestones)

| Phase | Nội dung | Điều kiện hoàn thành (Definition of Done) |
|-------|----------|--------------------------------------------|
| 0 | Đọc `Plan.md`, `Skills.md`, `Rules.md`, `state.json` | Agent xác nhận đã đọc, không hỏi lại thông tin đã có |
| 1 | Dựng Supabase project + schema mục 3 + RLS cơ bản | Migration chạy thành công, có test insert/select |
| 2 | Edge Function import file nguồn (`Stock Balance With Batch.xlsx`) | Import đúng số dòng dữ liệu thật (2721 dòng dữ liệu, bỏ 4 dòng header), có test đối chiếu số dòng |
| 3 | Edge Function `scan-submit` (đối chiếu + khoá theo batch_id) | Test race-condition: 2 request cùng batch_id không mất dữ liệu |
| 4 | Frontend: khu vực quét PDA (giữ UX từ `scantag.html`) | Quét vị trí → tag id → gọi API thật, không dùng localStorage cho dữ liệu nghiệp vụ |
| 5 | Frontend: Bảng đối chiếu + cảnh báo inline + toast trùng | Đủ 3 loại cảnh báo: qty, bin, duplicate; đủ 2 lựa chọn xử lý trùng |
| 6 | Frontend: Bảng dữ liệu hệ thống (Bảng 2) + export Excel | Export ra đúng định dạng text như bản gốc |
| 7 | CI/CD: GitHub Actions deploy backend + frontend | Deploy tự động khi merge vào `main`, có bước chạy test trước deploy |
| 8 | Kiểm thử tổng, đối chiếu với dữ liệu mẫu thật | So khớp thủ công 1 tập mẫu, ghi kết quả vào `Learning.md` nếu có sai lệch |

---

## 10. Việc KHÔNG làm trong phạm vi này

- Không tự thêm tính năng phân quyền phức tạp (multi-role) nếu chưa được
  yêu cầu — chỉ cần auth cơ bản (ai đăng nhập được quét/ghi).
- Không tự đổi cấu trúc cột nguồn `reference_stock` khác với dữ liệu mẫu đã
  phân tích ở mục 1.
- Không tự chọn hosting cụ thể cho frontend (Vercel/Netlify/GitHub Pages)
  nếu chưa được xác nhận — ghi rõ giả định đã chọn vào `state.json` và hỏi
  lại nếu người dùng chưa xác nhận.
