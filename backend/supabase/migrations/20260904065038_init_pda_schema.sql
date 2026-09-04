-- Phase 1: PDA Scan & Reconciliation — initial schema (Plan.md §3, Skills A).
-- Tables: reference_stock / scanned_data / scan_audit_log + indexes (§3.4) + RLS + realtime.

-- 3.1 reference_stock: dữ liệu import từ file nguồn.
-- batch_id = BATCH = Tag ID nghiệp vụ, text 12 ký tự, khóa lookup duy nhất.
create table public.reference_stock (
  batch_id      text primary key,
  stock_code    text not null,             -- đã TRIM khi import
  stock_code_raw text,                     -- bản gốc chưa TRIM để audit (Plan.md §1)
  warehouse     text not null,
  bin           text not null,             -- đã TRIM khi import
  bin_raw       text,                      -- bản gốc chưa TRIM để audit (Plan.md §1)
  qty           numeric not null,
  create_date   timestamptz,
  imported_at   timestamptz default now(),
  imported_by   uuid references auth.users(id)
);
create index idx_reference_stock_bin on public.reference_stock (bin);
create index idx_reference_stock_warehouse on public.reference_stock (warehouse);
create index idx_reference_stock_warehouse_bin on public.reference_stock (warehouse, bin);

-- 3.2 scanned_data: dữ liệu quét thực tế.
-- KHÔNG đặt unique trên batch_id: trùng là nghiệp vụ xử lý ở Edge Function, không phải constraint cứng.
create table public.scanned_data (
  id            uuid primary key default gen_random_uuid(),
  batch_id      text not null,
  qty           numeric not null,
  bin           text not null,
  scanned_by    uuid references auth.users(id),
  scanned_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  is_manual     boolean default false,
  status        text not null default 'pending'
                 check (status in ('pending','ok','qty_mismatch',
                                    'bin_mismatch','not_in_reference',
                                    'duplicate')),
  resolution    text check (resolution in ('appended','relocated'))
);
create index idx_scanned_data_batch on public.scanned_data (batch_id);
create index idx_scanned_data_bin on public.scanned_data (bin);
create index idx_scanned_data_status on public.scanned_data (status);

-- 3.3 scan_audit_log: lịch sử thao tác.
create table public.scan_audit_log (
  id           bigint generated always as identity primary key,
  scanned_id   uuid references public.scanned_data(id),
  action       text not null
               check (action in ('insert','append','relocate','edit','delete')),
  old_value    jsonb,
  new_value    jsonb,
  actor        uuid references auth.users(id),
  created_at   timestamptz default now()
);

-- RLS cơ bản (Phase 1): bật cho mọi bảng nghiệp vụ, policy tường minh
-- từng thao tác cho user đã đăng nhập (Plan §10: chỉ cần auth cơ bản).
alter table public.reference_stock enable row level security;
alter table public.scanned_data enable row level security;
alter table public.scan_audit_log enable row level security;

create policy reference_stock_select_to_authenticated
  on public.reference_stock for select to authenticated using (true);
create policy reference_stock_insert_to_authenticated
  on public.reference_stock for insert to authenticated with check (true);
create policy reference_stock_update_to_authenticated
  on public.reference_stock for update to authenticated using (true) with check (true);
create policy reference_stock_delete_to_authenticated
  on public.reference_stock for delete to authenticated using (true);

create policy scanned_data_select_to_authenticated
  on public.scanned_data for select to authenticated using (true);
create policy scanned_data_insert_to_authenticated
  on public.scanned_data for insert to authenticated with check (true);
create policy scanned_data_update_to_authenticated
  on public.scanned_data for update to authenticated using (true) with check (true);
create policy scanned_data_delete_to_authenticated
  on public.scanned_data for delete to authenticated using (true);

create policy scan_audit_log_select_to_authenticated
  on public.scan_audit_log for select to authenticated using (true);
create policy scan_audit_log_insert_to_authenticated
  on public.scan_audit_log for insert to authenticated with check (true);
create policy scan_audit_log_update_to_authenticated
  on public.scan_audit_log for update to authenticated using (true) with check (true);
create policy scan_audit_log_delete_to_authenticated
  on public.scan_audit_log for delete to authenticated using (true);

-- Realtime cho scanned_data (Skills C). Guard: publication supabase_realtime
-- chỉ tồn tại trên Supabase (local stack / cloud), không có trên Postgres thuần.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.scanned_data';
  end if;
end
$$;
