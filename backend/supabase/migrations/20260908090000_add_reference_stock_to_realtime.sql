-- Migration 20260908090000: bật Realtime cho reference_stock (Bảng 2) để nhiều
-- người cùng mở frontend thấy streaming khi có người sửa SL/Bin, thêm dòng nguồn
-- hoặc import file mới (Plan.md §5: không cache, đọc trực tiếp subscription).
-- Trước đây publication supabase_realtime chỉ có scanned_data (Bảng 1) nên Bảng 2
-- của các máy khác im lặng tới khi F5 — đúng triệu chứng "streaming nhiều người
-- không hoạt động". Idempotent + guard publication (giống init schema Phase 1).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'reference_stock'
    ) then
      execute 'alter publication supabase_realtime add table public.reference_stock';
    end if;
  end if;
end
$$;
