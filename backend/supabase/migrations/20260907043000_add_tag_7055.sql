-- Migration 20260907043000:
-- Bổ sung cột tag_7055 cho reference_stock và cập nhật RPC add_reference_stock hỗ trợ đánh dấu tag 7055.

-- 1. Thêm cột tag_7055 vào reference_stock
alter table public.reference_stock
  add column if not exists tag_7055 boolean not null default false;

-- 2. Xóa signature cũ để tránh trùng lặp overload
drop function if exists public.add_reference_stock(text, text, text, text, numeric, timestamptz, boolean);

-- 3. Tạo lại function add_reference_stock nhận p_tag_7055
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

  -- Tự động đánh giá lại trạng thái đối chiếu cho các dòng đã quét trong scanned_data nếu có
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
