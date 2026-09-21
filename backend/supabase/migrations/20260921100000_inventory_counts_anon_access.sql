-- Migration 20260921100000: mở đường ghi Bảng 3 kiểm kê cho phiên anon.
-- Bối cảnh: app không đăng nhập (mọi session là anon); Bảng 1/Bảng 2 mở anon
-- SELECT (migration allow_anon_read) và mọi thao tác ghi đi qua RPC SECURITY
-- DEFINER. inventory_counts (20260921090000) thiếu cả hai nên modal Quét Kiểm
-- Kê lỗi RLS khi lưu. Fix theo đúng chuẩn repo, KHÔNG mở anon INSERT trực tiếp:
-- 1. Anon SELECT (chỉ đọc, như 3 bảng cũ).
-- 2. RPC submit_inventory_count: validate rồi insert (thay client insert thẳng).
-- 3. RPC delete_inventory_row: xóa dòng kiểm kê nhập nhầm (thay client delete thẳng).

-- 1. Anon SELECT
drop policy if exists inventory_counts_select_to_anon on public.inventory_counts;
create policy inventory_counts_select_to_anon
  on public.inventory_counts for select to anon using (true);

-- 2. RPC ghi lượt kiểm kê
create or replace function public.submit_inventory_count(
  p_batch_id text,
  p_stock_code text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  if p_batch_id is null or btrim(p_batch_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'batch_id_required');
  end if;
  if p_qty is null or p_qty <= 0 then
    return jsonb_build_object('ok', false, 'error', 'qty_invalid');
  end if;
  if p_bin is null or btrim(p_bin) = '' then
    return jsonb_build_object('ok', false, 'error', 'bin_required');
  end if;

  insert into public.inventory_counts (batch_id, stock_code, qty, bin, is_manual)
  values (btrim(p_batch_id), nullif(btrim(coalesce(p_stock_code, '')), ''), p_qty, btrim(p_bin), coalesce(p_is_manual, false))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'batch_id', btrim(p_batch_id));
end;
$$;

grant execute on function public.submit_inventory_count(text, text, numeric, text, boolean) to anon, authenticated, service_role;

-- 3. RPC xóa dòng kiểm kê nhập nhầm
create or replace function public.delete_inventory_row(p_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id text;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'id_required');
  end if;

  select batch_id into v_batch_id from public.inventory_counts where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  delete from public.inventory_counts where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'batch_id', v_batch_id);
end;
$$;

grant execute on function public.delete_inventory_row(uuid) to anon, authenticated, service_role;
