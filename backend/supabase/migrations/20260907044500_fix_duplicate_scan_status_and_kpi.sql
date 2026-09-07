-- Migration 20260907044500:
-- Khắc phục triệt để lỗi Tag quét trùng nhiều vị trí:
-- 1. Chuẩn hóa dữ liệu scanned_data hiện có: bất kỳ Tag ID nào xuất hiện >= 2 lần đều gán status='duplicate'
-- 2. Cập nhật RPC update_reference_bin: nếu Tag ID có >= 2 lượt quét trong scanned_data, bắt buộc giữ status='duplicate', không tự gán 'ok'
-- 3. Cập nhật RPC update_reference_qty: nếu Tag ID có >= 2 lượt quét trong scanned_data, bắt buộc giữ status='duplicate'
-- 4. Cập nhật RPC add_reference_stock: nếu Tag ID có >= 2 lượt quét trong scanned_data, bắt buộc giữ status='duplicate'

-- 1. Chuẩn hóa các dòng quét bị trùng trong scanned_data
update public.scanned_data s
set status = 'duplicate',
    resolution = coalesce(s.resolution, 'appended'),
    updated_at = now()
where (
  select count(*) from public.scanned_data s2 where s2.batch_id = s.batch_id
) > 1
and s.status <> 'duplicate';

-- 2. Cập nhật update_reference_bin
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
  v_scan_count integer;
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

  -- Đếm số lượt quét của batch_id trong scanned_data
  select count(*) into v_scan_count
  from public.scanned_data
  where batch_id = p_batch_id;

  -- Tự động tính toán lại status cho các dòng scanned_data liên quan
  -- NẾU có >= 2 lượt quét cùng batch_id, BẮT BUỘC giữ trạng thái duplicate (quét trùng ở nhiều vị trí)
  if v_scan_count > 1 then
    update public.scanned_data
    set status = 'duplicate',
        resolution = coalesce(resolution, 'appended'),
        updated_at = now()
    where batch_id = p_batch_id;
  else
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
  end if;

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'new_bin', v_clean_bin,
    'previous_bin', v_old_bin
  );
end;
$$;

grant execute on function public.update_reference_bin(text, text) to anon, authenticated, service_role;

-- 3. Cập nhật update_reference_qty
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
  v_scan_count integer;
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

  select count(*) into v_scan_count
  from public.scanned_data
  where batch_id = p_batch_id;

  -- NẾU có >= 2 lượt quét cùng batch_id, BẮT BUỘC giữ trạng thái duplicate
  if v_scan_count > 1 then
    update public.scanned_data
    set status = 'duplicate',
        resolution = coalesce(resolution, 'appended'),
        updated_at = now()
    where batch_id = p_batch_id;
  else
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
  end if;

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'new_qty', p_new_qty,
    'previous_qty', v_old_qty
  );
end;
$$;

grant execute on function public.update_reference_qty(text, numeric) to anon, authenticated, service_role;

-- 4. Cập nhật add_reference_stock
create or replace function public.add_reference_stock(
  p_batch_id text,
  p_stock_code text,
  p_warehouse text,
  p_bin text,
  p_qty numeric,
  p_create_date timestamptz default now(),
  p_overwrite boolean default false,
  p_tag_7055 boolean default false
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_clean_batch_id text;
  v_clean_stock_code text;
  v_clean_warehouse text;
  v_clean_bin text;
  v_existing record;
  v_is_7055 boolean;
  v_scan_count integer;
begin
  -- Validate batch_id
  v_clean_batch_id := btrim(p_batch_id);
  if v_clean_batch_id is null or v_clean_batch_id = '' then
    return jsonb_build_object('ok', false, 'error', 'batch_id_required', 'message', 'Tag ID không được để trống');
  end if;

  -- Validate stock_code
  v_clean_stock_code := btrim(p_stock_code);
  if v_clean_stock_code is null or v_clean_stock_code = '' then
    return jsonb_build_object('ok', false, 'error', 'stock_code_required', 'message', 'Mã hàng (Stock Code) không được để trống');
  end if;

  -- Validate warehouse
  v_clean_warehouse := btrim(p_warehouse);
  if v_clean_warehouse is null or v_clean_warehouse = '' then
    return jsonb_build_object('ok', false, 'error', 'warehouse_required', 'message', 'Kho (Warehouse) không được để trống');
  end if;

  -- Validate bin
  v_clean_bin := btrim(p_bin);
  if v_clean_bin is null or v_clean_bin = '' then
    return jsonb_build_object('ok', false, 'error', 'bin_required', 'message', 'Vị trí (Bin) không được để trống');
  end if;

  -- Validate qty
  if p_qty is null or p_qty < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_qty', 'message', 'Số lượng phải là số không âm');
  end if;

  v_is_7055 := coalesce(p_tag_7055, false);

  -- Kiểm tra trùng batch_id trong reference_stock
  select * into v_existing
  from public.reference_stock
  where batch_id = v_clean_batch_id;

  if found and not p_overwrite then
    return jsonb_build_object(
      'ok', false,
      'error', 'duplicate_batch_id',
      'message', 'Tag ID ' || v_clean_batch_id || ' đã tồn tại trong dữ liệu nguồn (Mã: ' || v_existing.stock_code || ', Kho: ' || v_existing.warehouse || ', Bin: ' || v_existing.bin || ')'
    );
  end if;

  if found and p_overwrite then
    update public.reference_stock
    set stock_code = v_clean_stock_code,
        stock_code_raw = v_clean_stock_code,
        warehouse = v_clean_warehouse,
        previous_bin = bin,
        bin = v_clean_bin,
        bin_raw = v_clean_bin,
        previous_qty = qty,
        qty = p_qty,
        create_date = coalesce(p_create_date, now()),
        tag_7055 = case when p_tag_7055 is not null then p_tag_7055 else tag_7055 end
    where batch_id = v_clean_batch_id;
  else
    insert into public.reference_stock (
      batch_id,
      stock_code,
      stock_code_raw,
      warehouse,
      bin,
      bin_raw,
      qty,
      create_date,
      imported_at,
      imported_by,
      tag_7055
    ) values (
      v_clean_batch_id,
      v_clean_stock_code,
      v_clean_stock_code,
      v_clean_warehouse,
      v_clean_bin,
      v_clean_bin,
      p_qty,
      coalesce(p_create_date, now()),
      now(),
      auth.uid(),
      v_is_7055
    );
  end if;

  select count(*) into v_scan_count
  from public.scanned_data
  where batch_id = v_clean_batch_id;

  -- Nếu có >= 2 lượt quét cùng batch_id, BẮT BUỘC giữ trạng thái duplicate
  if v_scan_count > 1 then
    update public.scanned_data
    set status = 'duplicate',
        resolution = coalesce(resolution, 'appended'),
        stock_code = coalesce(stock_code, v_clean_stock_code),
        updated_at = now()
    where batch_id = v_clean_batch_id;
  else
    update public.scanned_data s
    set status = case
          when s.bin is distinct from v_clean_bin then 'bin_mismatch'
          when s.qty is distinct from p_qty then 'qty_mismatch'
          else 'ok'
        end,
        stock_code = coalesce(s.stock_code, v_clean_stock_code),
        updated_at = now()
    where s.batch_id = v_clean_batch_id
      and s.status in ('not_in_reference', 'ok', 'bin_mismatch', 'qty_mismatch');
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'batch_id', v_clean_batch_id,
      'stock_code', v_clean_stock_code,
      'warehouse', v_clean_warehouse,
      'bin', v_clean_bin,
      'qty', p_qty,
      'create_date', coalesce(p_create_date, now()),
      'tag_7055', v_is_7055
    )
  );
end;
$$;

grant execute on function public.add_reference_stock(text, text, text, text, numeric, timestamptz, boolean, boolean) to anon, authenticated, service_role;
