-- Migration 20260915090000:
-- Nâng cấp RPC update_scanned_tag_id để hỗ trợ chỉnh sửa nhanh vị trí Bin ở Bảng 1
-- (yêu cầu: cây bút sửa ở Bảng 1 thêm trường sửa vị trí).
-- Giữ nguyên toàn bộ logic đối chiếu + trùng + audit hiện có, chỉ thêm p_new_bin OPTIONAL.
-- Tương thích ngược: frontend cũ không gửi p_new_bin (NULL) thì giữ nguyên bin cũ.
-- Không đổi Edge Functions contract; cần supabase db push lên cloud (CI backend-deploy khi merge main).

drop function if exists public.update_scanned_tag_id(uuid, text, text);
drop function if exists public.update_scanned_tag_id(uuid, text, text, numeric);
drop function if exists public.update_scanned_tag_id(uuid, text, text, numeric, text);

create or replace function public.update_scanned_tag_id(
  p_id uuid,
  p_new_batch_id text,
  p_stock_code text default null,
  p_new_qty numeric default null,
  p_new_bin text default null,
  p_actor_name text default null
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
  v_clean_bin text;
  v_new_qty numeric;
  v_new_bin text;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
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

  if p_new_qty is not null and p_new_qty < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_qty');
  end if;

  v_new_qty := coalesce(p_new_qty, v_scanned.qty);

  -- Bin mới: NULL (client cũ) -> giữ bin cũ; chuỗi rỗng -> lỗi để frontend báo rõ.
  if p_new_bin is null then
    v_new_bin := v_scanned.bin;
  else
    v_clean_bin := btrim(p_new_bin);
    if v_clean_bin is null or v_clean_bin = '' then
      return jsonb_build_object('ok', false, 'error', 'bin_required');
    end if;
    v_new_bin := v_clean_bin;
  end if;

  -- Tra cứu Tag ID mới trong reference_stock
  select * into v_ref from public.reference_stock where batch_id = v_clean_batch_id;

  if not found then
    v_status := 'not_in_reference';
    v_stock_code := coalesce(nullif(btrim(p_stock_code), ''), v_scanned.stock_code);
  elsif v_new_bin is distinct from v_ref.bin then
    v_status := 'bin_mismatch';
    v_stock_code := v_ref.stock_code;
  elsif v_new_qty is distinct from v_ref.qty then
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

  -- Cập nhật bản ghi scanned_data (gồm cả bin mới)
  update public.scanned_data
  set batch_id = v_clean_batch_id,
      qty = v_new_qty,
      bin = v_new_bin,
      stock_code = v_stock_code,
      status = v_status,
      resolution = v_resolution,
      updated_at = now()
  where id = p_id;

  -- Ghi log truy vết thao tác chỉnh sửa vào scan_audit_log (action 'edit')
  insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor, actor_name)
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
      'qty', v_new_qty,
      'bin', v_new_bin
    ),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'batch_id', v_clean_batch_id,
    'qty', v_new_qty,
    'bin', v_new_bin,
    'stock_code', v_stock_code,
    'status', v_status,
    'resolution', v_resolution
  );
end;
$$;

grant execute on function public.update_scanned_tag_id(uuid, text, text, numeric, text, text) to anon, authenticated, service_role;
