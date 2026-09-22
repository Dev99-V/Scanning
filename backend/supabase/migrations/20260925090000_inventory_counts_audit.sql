-- Migration 20260925090000:
-- Audit cho Bảng 3 kiểm kê: 3 RPC inventory_counts (submit/update/delete) ghi
-- scan_audit_log + nhận p_actor_name OPTIONAL (tên presence, tối đa 50 ký tự),
-- giống chuẩn các RPC Bảng 1/Bảng 2 (migration 20260909091000).
-- Trước đây thao tác kiểm kê vô hình trong Nhật ký hoạt động (debt 2026-09-22).
-- Quy ước kind: 'inventory_add' (insert) / 'inventory_update' (edit SL/Bin) /
-- 'inventory_delete' (delete); scanned_id NULL (không phải scanned_data).
-- DROP overload cũ + tạo lại có default → frontend/Edge cũ không gửi
-- p_actor_name vẫn chạy (actor_name NULL = Ẩn danh).
-- Cần supabase db push lên cloud (cùng đợt 6 migration đang pending).

-- 1. submit_inventory_count + audit insert
drop function if exists public.submit_inventory_count(text, text, numeric, text, boolean);

create or replace function public.submit_inventory_count(
  p_batch_id text,
  p_stock_code text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_clean_batch text;
  v_clean_bin text;
  v_stock_code text;
  v_is_manual boolean;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
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

  v_clean_batch := btrim(p_batch_id);
  v_clean_bin := btrim(p_bin);
  v_stock_code := nullif(btrim(coalesce(p_stock_code, '')), '');
  v_is_manual := coalesce(p_is_manual, false);

  insert into public.inventory_counts (batch_id, stock_code, qty, bin, is_manual)
  values (v_clean_batch, v_stock_code, p_qty, v_clean_bin, v_is_manual)
  returning id into v_id;

  insert into public.scan_audit_log (scanned_id, action, new_value, actor, actor_name)
  values (
    null,
    'insert',
    jsonb_build_object(
      'kind', 'inventory_add',
      'inventory_id', v_id,
      'batch_id', v_clean_batch,
      'stock_code', v_stock_code,
      'qty', p_qty,
      'bin', v_clean_bin,
      'is_manual', v_is_manual
    ),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object('ok', true, 'id', v_id, 'batch_id', v_clean_batch);
end;
$$;

grant execute on function public.submit_inventory_count(text, text, numeric, text, boolean, text) to anon, authenticated, service_role;

-- 2. update_inventory_row + audit edit
-- Quy tắc nghiệp vụ Bảng 3: chỉ được sửa SL KK và Bin KK (Tag ID / Stock Code
-- khóa). NULL = giữ giá trị cũ để tương thích ngược caller chỉ gửi 1 trường.
drop function if exists public.update_inventory_row(uuid, numeric);
drop function if exists public.update_inventory_row(uuid, numeric, text);

create or replace function public.update_inventory_row(
  p_id uuid,
  p_new_qty numeric default null,
  p_new_bin text default null,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row public.inventory_counts%rowtype;
  v_old_qty numeric;
  v_old_bin text;
  v_qty numeric;
  v_bin text;
  v_clean_bin text;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'id_required');
  end if;

  if p_new_qty is not null and p_new_qty <= 0 then
    return jsonb_build_object('ok', false, 'error', 'qty_invalid');
  end if;

  if p_new_bin is not null then
    v_clean_bin := btrim(p_new_bin);
    if v_clean_bin is null or v_clean_bin = '' then
      return jsonb_build_object('ok', false, 'error', 'bin_required');
    end if;
  end if;

  select * into v_row from public.inventory_counts where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_old_qty := v_row.qty;
  v_old_bin := v_row.bin;
  v_qty := coalesce(p_new_qty, v_old_qty);
  v_bin := coalesce(v_clean_bin, v_old_bin);

  update public.inventory_counts
  set qty = v_qty,
      bin = v_bin
  where id = p_id;

  insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor, actor_name)
  values (
    null,
    'edit',
    jsonb_build_object(
      'kind', 'inventory_update',
      'inventory_id', p_id,
      'batch_id', v_row.batch_id,
      'qty', v_old_qty,
      'bin', v_old_bin
    ),
    jsonb_build_object(
      'kind', 'inventory_update',
      'inventory_id', p_id,
      'batch_id', v_row.batch_id,
      'qty', v_qty,
      'bin', v_bin
    ),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'batch_id', v_row.batch_id,
    'qty', v_qty,
    'bin', v_bin
  );
end;
$$;

grant execute on function public.update_inventory_row(uuid, numeric, text, text) to anon, authenticated, service_role;

-- 3. delete_inventory_row + audit delete
drop function if exists public.delete_inventory_row(uuid);

create or replace function public.delete_inventory_row(
  p_id uuid,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row public.inventory_counts%rowtype;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'id_required');
  end if;

  delete from public.inventory_counts where id = p_id returning * into v_row;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.scan_audit_log (scanned_id, action, old_value, actor, actor_name)
  values (
    null,
    'delete',
    jsonb_build_object(
      'kind', 'inventory_delete',
      'inventory_id', p_id,
      'batch_id', v_row.batch_id,
      'stock_code', v_row.stock_code,
      'qty', v_row.qty,
      'bin', v_row.bin
    ),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object('ok', true, 'id', p_id, 'batch_id', v_row.batch_id);
end;
$$;

grant execute on function public.delete_inventory_row(uuid, text) to anon, authenticated, service_role;
