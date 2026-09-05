-- Migration 20260905013000: Bổ sung RLS SELECT cho anon role
-- Cho phép hiển thị dữ liệu Bảng 1 (scanned_data) và Bảng 2 (reference_stock)
-- mà không cần bắt buộc người kiểm đếm PDA phải đăng nhập.
-- Các quyền ghi (INSERT/UPDATE/DELETE) trực tiếp bởi anon vẫn bị CHẶN bởi RLS
-- (mọi thao tác ghi chỉ được thực thi thông qua RPC / Edge Functions có service_role).

create policy reference_stock_select_to_anon
  on public.reference_stock for select to anon using (true);

create policy scanned_data_select_to_anon
  on public.scanned_data for select to anon using (true);

create policy scan_audit_log_select_to_anon
  on public.scan_audit_log for select to anon using (true);
