-- Quét Kiểm Kê (Bảng 3): bảng ghi riêng cho modal kiểm kê, đối chiếu chéo
-- Bảng 1 (scanned_data) vs Bảng 2 (reference_stock) ngay trong modal.
-- Không unique trên batch_id: kiểm kê quét lặp là nghiệp vụ, không phải constraint cứng.
create table public.inventory_counts (
  id            uuid primary key default gen_random_uuid(),
  batch_id      text not null,
  stock_code    text,
  qty           numeric not null,
  bin           text not null,
  scanned_by    uuid references auth.users(id),
  scanned_at    timestamptz default now(),
  is_manual     boolean default false
);
create index idx_inventory_counts_batch on public.inventory_counts (batch_id);
create index idx_inventory_counts_bin on public.inventory_counts (bin);

alter table public.inventory_counts enable row level security;

create policy inventory_counts_select_to_authenticated
  on public.inventory_counts for select to authenticated using (true);
create policy inventory_counts_insert_to_authenticated
  on public.inventory_counts for insert to authenticated with check (true);
create policy inventory_counts_update_to_authenticated
  on public.inventory_counts for update to authenticated using (true) with check (true);
create policy inventory_counts_delete_to_authenticated
  on public.inventory_counts for delete to authenticated using (true);

-- Realtime cho modal kiểm kê đa máy (guard: publication chỉ có trên Supabase).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.inventory_counts';
  end if;
end
$$;
