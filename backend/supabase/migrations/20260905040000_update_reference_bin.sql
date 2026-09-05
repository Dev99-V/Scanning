-- Migration 20260905040000:
-- 1. Bổ sung previous_bin cho reference_stock để lưu vết vị trí cũ khi chỉnh sửa
-- 2. RPC update_reference_bin: cho phép chỉnh sửa vị trí (Bin) ở Bảng 2, lưu previous_bin
--    và tự động cập nhật lại status của các dòng quét trong scanned_data tương ứng.
-- 3. Cập nhật update_reference_qty: tự động đồng bộ lại status cho các dòng scanned_data tương ứng.

-- 1. Cột previous_bin
alter table public.reference_stock
  add column if not exists previous_bin text default null;

-- 2. RPC update_reference_bin
create or replace function public.update_reference_bin(
  p_batch_id text,
  p_new_bin text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_old_bin text;
  v_clean_bin text;
begin
  if p_batch_id is null or btrim(p_batch_id) = '' then
    return jsonb_build_object('ok', false, 'error', 'batch_id_required');
  end if;

  v_clean_bin := btrim(p_new_bin);
  if v_clean_bin is null or v_clean_bin = '' then
    return jsonb_build_object('ok', false, 'error', 'bin_required');
  end if;

  select bin into v_old_bin
  from public.reference_stock
  where batch_id = p_batch_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Cập nhật: lưu vị trí cũ vào previous_bin và ghi vị trí mới vào bin
  update public.reference_stock
  set previous_bin = v_old_bin,
      bin = v_clean_bin
  where batch_id = p_batch_id;

  -- Tự động tính toán lại status cho các dòng scanned_data liên quan (nếu có)
  update public.scanned_data s
  set status = case
        when s.bin is distinct from v_clean_bin then 'bin_mismatch'
        when s.qty is distinct from r.qty then 'qty_mismatch'
        else 'ok'
      end,
      updated_at = now()
  from public.reference_stock r
  where s.batch_id = p_batch_id
    and r.batch_id = p_batch_id
    and s.status in ('ok', 'bin_mismatch', 'qty_mismatch');

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'new_bin', v_clean_bin,
    'previous_bin', v_old_bin
  );
end;
$$;

grant execute on function public.update_reference_bin(text, text) to anon, authenticated, service_role;

-- 3. Cập nhật update_reference_qty để đồng bộ status cho scanned_data
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

  update public.reference_stock
  set previous_qty = v_old_qty,
      qty = p_new_qty
  where batch_id = p_batch_id;

  -- Tự động tính toán lại status cho các dòng scanned_data liên quan (nếu có)
  update public.scanned_data s
  set status = case
        when s.bin is distinct from r.bin then 'bin_mismatch'
        when s.qty is distinct from p_new_qty then 'qty_mismatch'
        else 'ok'
      end,
      updated_at = now()
  from public.reference_stock r
  where s.batch_id = p_batch_id
    and r.batch_id = p_batch_id
    and s.status in ('ok', 'bin_mismatch', 'qty_mismatch');

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'new_qty', p_new_qty,
    'previous_qty', v_old_qty
  );
end;
$$;

grant execute on function public.update_reference_qty(text, numeric) to anon, authenticated, service_role;
