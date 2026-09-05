-- Migration 20260905024500:
-- 1. Bổ sung previous_qty cho reference_stock để lưu số lượng cũ trước đó khi chỉnh sửa
-- 2. Đổi FK scan_audit_log on delete set null
-- 3. RPC delete_scanned_row: cho phép xóa lượt quét ở Bảng 1 khi nhập nhầm
-- 4. RPC update_reference_qty: cho phép chỉnh sửa số lượng ở Bảng 2, lưu previous_qty, không ghi log

-- 1. Cột previous_qty
alter table public.reference_stock
  add column if not exists previous_qty numeric default null;

-- 2. FK on delete set null
alter table public.scan_audit_log
  drop constraint if exists scan_audit_log_scanned_id_fkey,
  add constraint scan_audit_log_scanned_id_fkey
    foreign key (scanned_id) references public.scanned_data(id) on delete set null;

-- 3. RPC delete_scanned_row
create or replace function public.delete_scanned_row(p_id uuid)
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

  select batch_id into v_batch_id from public.scanned_data where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  update public.scan_audit_log set scanned_id = null where scanned_id = p_id;

  delete from public.scanned_data where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'batch_id', v_batch_id);
end;
$$;

grant execute on function public.delete_scanned_row(uuid) to anon, authenticated, service_role;

-- 4. RPC update_reference_qty
create or replace function public.update_reference_qty(
  p_batch_id text,
  p_new_qty numeric
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_old_qty numeric;
begin
  if p_batch_id is null or btrim(p_batch_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'batch_id_required');
  end if;
  if p_new_qty is null then
    return jsonb_build_object('ok', false, 'error', 'qty_required');
  end if;

  select qty into v_old_qty
  from public.reference_stock
  where batch_id = p_batch_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Cập nhật: lưu số lượng cũ (v_old_qty) vào previous_qty và ghi số lượng mới vào qty
  -- Không ghi log vào scan_audit_log theo yêu cầu
  update public.reference_stock
  set previous_qty = v_old_qty,
      qty = p_new_qty
  where batch_id = p_batch_id;

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'new_qty', p_new_qty,
    'previous_qty', v_old_qty
  );
end;
$$;

grant execute on function public.update_reference_qty(text, numeric) to anon, authenticated, service_role;
