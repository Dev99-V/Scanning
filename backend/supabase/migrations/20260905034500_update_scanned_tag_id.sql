-- Migration 20260905034500:
-- Tạo RPC update_scanned_tag_id: cho phép chỉnh sửa Tag ID của lượt quét ở Bảng 1 khi nhập hoặc quét nhầm
-- Không thay đổi bất kỳ cấu trúc bảng hay ràng buộc nào trong hệ thống
-- Tự động đối chiếu lại với reference_stock, kiểm tra trùng lặp và ghi lịch sử vào scan_audit_log (action 'edit')

create or replace function public.update_scanned_tag_id(
  p_id uuid,
  p_new_batch_id text,
  p_stock_code text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_scanned public.scanned_data%rowtype;
  v_ref public.reference_stock%rowtype;
  v_status text;
  v_stock_code text;
  v_resolution text;
  v_duplicate_id uuid;
  v_clean_batch_id text;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'id_required');
  end if;

  v_clean_batch_id := btrim(p_new_batch_id);
  if v_clean_batch_id is null or v_clean_batch_id = '' then
    return jsonb_build_object('ok', false, 'error', 'batch_id_required');
  end if;

  select * into v_scanned from public.scanned_data where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Tra cứu Tag ID mới trong reference_stock
  select * into v_ref from public.reference_stock where batch_id = v_clean_batch_id;

  if not found then
    v_status := 'not_in_reference';
    v_stock_code := coalesce(nullif(btrim(p_stock_code), ''), v_scanned.stock_code);
  elsif v_scanned.bin is distinct from v_ref.bin then
    v_status := 'bin_mismatch';
    v_stock_code := v_ref.stock_code;
  elsif v_scanned.qty is distinct from v_ref.qty then
    v_status := 'qty_mismatch';
    v_stock_code := v_ref.stock_code;
  else
    v_status := 'ok';
    v_stock_code := v_ref.stock_code;
  end if;

  -- Kiểm tra xem có trùng Tag ID với các lượt quét khác trong scanned_data hay không
  select id into v_duplicate_id from public.scanned_data
  where batch_id = v_clean_batch_id and id <> p_id
  order by scanned_at desc
  limit 1;

  if found then
    v_status := 'duplicate';
    v_resolution := 'appended';
  else
    v_resolution := null;
  end if;

  -- Cập nhật bản ghi scanned_data
  update public.scanned_data
  set batch_id = v_clean_batch_id,
      stock_code = v_stock_code,
      status = v_status,
      resolution = v_resolution,
      updated_at = now()
  where id = p_id;

  -- Ghi log truy vết thao tác chỉnh sửa Tag ID vào scan_audit_log (action 'edit')
  insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor)
  values (
    p_id,
    'edit',
    jsonb_build_object(
      'batch_id', v_scanned.batch_id,
      'stock_code', v_scanned.stock_code,
      'status', v_scanned.status,
      'qty', v_scanned.qty,
      'bin', v_scanned.bin
    ),
    jsonb_build_object(
      'batch_id', v_clean_batch_id,
      'stock_code', v_stock_code,
      'status', v_status,
      'qty', v_scanned.qty,
      'bin', v_scanned.bin
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'batch_id', v_clean_batch_id,
    'stock_code', v_stock_code,
    'status', v_status,
    'resolution', v_resolution
  );
end;
$$;

grant execute on function public.update_scanned_tag_id(uuid, text, text) to anon, authenticated, service_role;
