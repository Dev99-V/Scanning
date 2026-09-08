-- Migration 20260909091000: bảng Nhật ký hoạt động cho frontend.
-- Mục tiêu: Bảng 2 có thẻ log hiển thị "ai làm gì" (quét PDA / thêm mã nguồn /
-- sửa SL-Bin nguồn / sửa-xóa lượt quét) realtime cho nhiều người cùng xem.
--
-- Vấn đề đã xác minh:
--  1. Hệ thống bỏ đăng nhập nên auth.uid()/actor luôn NULL — log không biết tên ai.
--     Sửa: thêm cột actor_name (tên hiển thị presence ở frontend, tối đa 50 ký tự),
--     mọi RPC nhận thêm p_actor_name OPTIONAL (có default → frontend cũ vẫn chạy).
--  2. Thiếu audit: add_reference_stock, update_reference_qty/bin, delete_scanned_row
--     KHÔNG ghi scan_audit_log nên "thêm nguồn / sửa nguồn / xóa nhầm" tàng hình.
--     Sửa: ghi audit cho cả 4 (action 'insert'/'edit'/'delete' đã có trong check).
--  3. scan_audit_log chưa nằm trong publication supabase_realtime nên log không stream.
--     Sửa: add table vào publication (guarded, idempotent).
--  4. add_reference_stock từng được 20260909090000 thêm advisory lock nhưng bản đó
--     chép từ migration cũ nên LÀM MẤT logic giữ status 'duplicate' của 20260907044500.
--     Sửa: dựng lại add_reference_stock gồm ĐỦ lock + duplicate-giữ + audit.
-- Không đổi params/returns cũ (chỉ thêm optional) → contract tương thích ngược.

-- 1. Cột tên người thực hiện
alter table public.scan_audit_log
  add column if not exists actor_name text default null;

-- 2. Realtime cho bảng log
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'scan_audit_log'
    ) then
      execute 'alter publication supabase_realtime add table public.scan_audit_log';
    end if;
  end if;
end
$$;

-- 3. Dọn các overload cũ để tránh PostgREST phân vân khi thêm param mới
drop function if exists public.scan_submit(text, numeric, text, boolean, uuid);
drop function if exists public.scan_submit(text, numeric, text, boolean, uuid, text);
drop function if exists public.resolve_duplicate(text, uuid, text, numeric, text, boolean, uuid);
drop function if exists public.resolve_duplicate(text, uuid, text, numeric, text, boolean, uuid, text);
drop function if exists public.delete_scanned_row(uuid);
drop function if exists public.update_scanned_tag_id(uuid, text, text);
drop function if exists public.update_scanned_tag_id(uuid, text, text, numeric);
drop function if exists public.update_reference_qty(text, numeric);
drop function if exists public.update_reference_bin(text, text);
drop function if exists public.add_reference_stock(text, text, text, text, numeric, timestamptz, boolean, boolean);

-- 4. scan_submit + p_actor_name
create or replace function public.scan_submit(
  p_batch_id text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false,
  p_scanned_by uuid default null,
  p_stock_code text default null,
  p_actor_name text default null
) returns jsonb
language plpgsql
as $$
declare
  v_ref public.reference_stock%rowtype;
  v_existing_id uuid;
  v_status text;
  v_stock_code text;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
begin
  if p_batch_id is null or btrim(p_batch_id) = '' then
    raise exception 'batch_id is required' using errcode = '22023';
  end if;
  if p_qty is null then
    raise exception 'qty is required' using errcode = '22023';
  end if;
  if p_bin is null or btrim(p_bin) = '' then
    raise exception 'bin is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('scan_submit:' || p_batch_id));

  select * into v_ref from public.reference_stock
  where batch_id = p_batch_id for update;

  if not found then
    v_status := 'not_in_reference';
    v_stock_code := nullif(btrim(p_stock_code), '');
  elsif p_bin is distinct from v_ref.bin then
    v_status := 'bin_mismatch';
    v_stock_code := v_ref.stock_code;
  elsif p_qty is distinct from v_ref.qty then
    v_status := 'qty_mismatch';
    v_stock_code := v_ref.stock_code;
  else
    v_status := 'ok';
    v_stock_code := v_ref.stock_code;
  end if;

  select id into v_existing_id from public.scanned_data
  where batch_id = p_batch_id order by scanned_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'conflict', true,
      'existing_id', v_existing_id,
      'computed_status', v_status,
      'stock_code', v_stock_code
    );
  end if;

  insert into public.scanned_data (batch_id, qty, bin, scanned_by, is_manual, status, stock_code)
  values (p_batch_id, p_qty, p_bin, p_scanned_by, coalesce(p_is_manual, false), v_status, v_stock_code)
  returning id into v_existing_id;

  insert into public.scan_audit_log (scanned_id, action, new_value, actor, actor_name)
  values (v_existing_id, 'insert',
          jsonb_build_object('batch_id', p_batch_id, 'qty', p_qty,
                             'bin', p_bin, 'status', v_status, 'stock_code', v_stock_code),
          p_scanned_by, v_actor_name);

  return jsonb_build_object('conflict', false, 'id', v_existing_id, 'status', v_status, 'stock_code', v_stock_code);
end;
$$;

-- 5. resolve_duplicate + p_actor_name
create or replace function public.resolve_duplicate(
  p_action text,
  p_scanned_id uuid,
  p_batch_id text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false,
  p_actor uuid default null,
  p_stock_code text default null,
  p_actor_name text default null
) returns jsonb
language plpgsql
as $$
declare
  v_old public.scanned_data%rowtype;
  v_ref public.reference_stock%rowtype;
  v_status text;
  v_stock_code text;
  v_new_id uuid;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
begin
  if p_action not in ('append', 'relocate') then
    raise exception 'action must be append or relocate' using errcode = '22023';
  end if;
  if p_scanned_id is null then
    raise exception 'scanned_id is required' using errcode = '22023';
  end if;
  if p_batch_id is null or btrim(p_batch_id) = '' then
    raise exception 'batch_id is required' using errcode = '22023';
  end if;
  if p_qty is null then
    raise exception 'qty is required' using errcode = '22023';
  end if;
  if p_bin is null or btrim(p_bin) = '' then
    raise exception 'bin is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('scan_submit:' || p_batch_id));

  select * into v_old from public.scanned_data
  where id = p_scanned_id for update;
  if not found then
    raise exception 'duplicate_target_not_found' using errcode = 'P0001';
  end if;
  if v_old.batch_id is distinct from p_batch_id then
    raise exception 'batch_id does not match target row' using errcode = '22023';
  end if;

  select * into v_ref from public.reference_stock
  where batch_id = p_batch_id for update;

  if not found then
    v_status := 'not_in_reference';
    v_stock_code := coalesce(nullif(btrim(p_stock_code), ''), v_old.stock_code);
  elsif p_bin is distinct from v_ref.bin then
    v_status := 'bin_mismatch';
    v_stock_code := v_ref.stock_code;
  elsif p_qty is distinct from v_ref.qty then
    v_status := 'qty_mismatch';
    v_stock_code := v_ref.stock_code;
  else
    v_status := 'ok';
    v_stock_code := v_ref.stock_code;
  end if;

  if p_action = 'append' then
    insert into public.scanned_data
      (batch_id, qty, bin, scanned_by, is_manual, status, resolution, stock_code)
    values (p_batch_id, p_qty, p_bin, p_actor,
            coalesce(p_is_manual, false), 'duplicate', 'appended', v_stock_code)
    returning id into v_new_id;

    insert into public.scan_audit_log (scanned_id, action, new_value, actor, actor_name)
    values (v_new_id, 'append',
            jsonb_build_object('batch_id', p_batch_id, 'qty', p_qty,
                               'bin', p_bin, 'appended_to', p_scanned_id, 'stock_code', v_stock_code),
            p_actor, v_actor_name);

    return jsonb_build_object('id', v_new_id, 'status', 'duplicate',
                              'resolution', 'appended', 'stock_code', v_stock_code);
  else
    update public.scanned_data
    set bin = p_bin,
        qty = p_qty,
        status = v_status,
        resolution = 'relocated',
        updated_at = now(),
        scanned_by = coalesce(p_actor, scanned_by),
        stock_code = coalesce(v_stock_code, scanned_data.stock_code)
    where id = p_scanned_id;

    insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor, actor_name)
    values (p_scanned_id, 'relocate',
            jsonb_build_object('bin', v_old.bin, 'qty', v_old.qty, 'status', v_old.status, 'stock_code', v_old.stock_code),
            jsonb_build_object('bin', p_bin, 'qty', p_qty, 'status', v_status, 'stock_code', v_stock_code),
            p_actor, v_actor_name);

    return jsonb_build_object('id', p_scanned_id, 'status', v_status,
                              'resolution', 'relocated', 'stock_code', v_stock_code);
  end if;
end;
$$;

-- 6. delete_scanned_row: ghi audit 'delete' (trước đây xóa là mất dấu)
create or replace function public.delete_scanned_row(
  p_id uuid,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_old public.scanned_data%rowtype;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'id_required');
  end if;

  select * into v_old from public.scanned_data where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.scan_audit_log (scanned_id, action, old_value, actor, actor_name)
  values (
    null,
    'delete',
    jsonb_build_object(
      'batch_id', v_old.batch_id,
      'stock_code', v_old.stock_code,
      'qty', v_old.qty,
      'bin', v_old.bin,
      'status', v_old.status
    ),
    auth.uid(),
    v_actor_name
  );

  update public.scan_audit_log set scanned_id = null where scanned_id = p_id;

  delete from public.scanned_data where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'batch_id', v_old.batch_id);
end;
$$;

-- 7. update_scanned_tag_id + p_actor_name
create or replace function public.update_scanned_tag_id(
  p_id uuid,
  p_new_batch_id text,
  p_stock_code text default null,
  p_new_qty numeric default null,
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
  v_new_qty numeric;
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

  -- Tra cứu Tag ID mới trong reference_stock
  select * into v_ref from public.reference_stock where batch_id = v_clean_batch_id;

  if not found then
    v_status := 'not_in_reference';
    v_stock_code := coalesce(nullif(btrim(p_stock_code), ''), v_scanned.stock_code);
  elsif v_scanned.bin is distinct from v_ref.bin then
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

  -- Cập nhật bản ghi scanned_data
  update public.scanned_data
  set batch_id = v_clean_batch_id,
      qty = v_new_qty,
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
      'bin', v_scanned.bin
    ),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'batch_id', v_clean_batch_id,
    'qty', v_new_qty,
    'stock_code', v_stock_code,
    'status', v_status,
    'resolution', v_resolution
  );
end;
$$;

-- 8. update_reference_qty: ghi audit 'edit' (đảo quyết định cũ "không ghi log"
-- theo yêu cầu mới: sửa SL nguồn phải hiện trong nhật ký hoạt động)
create or replace function public.update_reference_qty(
  p_batch_id text,
  p_new_qty numeric,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_old_qty numeric;
  v_scan_count integer;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
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

  insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor, actor_name)
  values (
    null,
    'edit',
    jsonb_build_object('batch_id', p_batch_id, 'kind', 'reference_qty', 'qty', v_old_qty),
    jsonb_build_object('batch_id', p_batch_id, 'kind', 'reference_qty', 'qty', p_new_qty),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'new_qty', p_new_qty,
    'previous_qty', v_old_qty
  );
end;
$$;

-- 9. update_reference_bin: ghi audit 'edit' (đảo quyết định cũ "không ghi log")
create or replace function public.update_reference_bin(
  p_batch_id text,
  p_new_bin text,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_old_bin text;
  v_clean_bin text;
  v_scan_count integer;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
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

  insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor, actor_name)
  values (
    null,
    'edit',
    jsonb_build_object('batch_id', p_batch_id, 'kind', 'reference_bin', 'bin', v_old_bin),
    jsonb_build_object('batch_id', p_batch_id, 'kind', 'reference_bin', 'bin', v_clean_bin),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object(
    'ok', true,
    'batch_id', p_batch_id,
    'new_bin', v_clean_bin,
    'previous_bin', v_old_bin
  );
end;
$$;

-- 10. add_reference_stock: GIỮ advisory lock (20260909090000) + KHÔI PHỤC logic giữ
-- status 'duplicate' (20260907044500) + audit 'insert' + p_actor_name
create or replace function public.add_reference_stock(
  p_batch_id text,
  p_stock_code text,
  p_warehouse text,
  p_bin text,
  p_qty numeric,
  p_create_date timestamptz default now(),
  p_overwrite boolean default false,
  p_tag_7055 boolean default false,
  p_actor_name text default null
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
  v_overwrote boolean := false;
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
begin
  -- Validate batch_id
  v_clean_batch_id := btrim(p_batch_id);
  if v_clean_batch_id is null or v_clean_batch_id = '' then
    return jsonb_build_object('ok', false, 'error', 'batch_id_required', 'message', 'Tag ID không được để trống');
  end if;

  -- Khóa theo batch NGAY sau khi có batch sạch, TRƯỚC mọi SELECT/INSERT/UPDATE
  -- (bịt race 2 thêm cùng Tag; đồng thời serialize với quét cùng Tag).
  perform pg_advisory_xact_lock(hashtext('scan_submit:' || v_clean_batch_id));

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
    v_overwrote := true;
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

  insert into public.scan_audit_log (scanned_id, action, new_value, actor, actor_name)
  values (
    null,
    'insert',
    jsonb_build_object(
      'batch_id', v_clean_batch_id,
      'kind', 'reference_add',
      'stock_code', v_clean_stock_code,
      'warehouse', v_clean_warehouse,
      'bin', v_clean_bin,
      'qty', p_qty,
      'overwrote', v_overwrote
    ),
    auth.uid(),
    v_actor_name
  );

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

grant execute on function public.scan_submit(text, numeric, text, boolean, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.resolve_duplicate(text, uuid, text, numeric, text, boolean, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.delete_scanned_row(uuid, text) to anon, authenticated, service_role;
grant execute on function public.update_scanned_tag_id(uuid, text, text, numeric, text) to anon, authenticated, service_role;
grant execute on function public.update_reference_qty(text, numeric, text) to anon, authenticated, service_role;
grant execute on function public.update_reference_bin(text, text, text) to anon, authenticated, service_role;
grant execute on function public.add_reference_stock(text, text, text, text, numeric, timestamptz, boolean, boolean, text) to anon, authenticated, service_role;
