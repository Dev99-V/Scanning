-- Phase 3: RPC đối chiếu + khóa (Plan.md §4.3, §5, §6; Skills A; Learning.md 2026-09-04).
-- QUY TẮC: mọi so sánh + khóa nằm trong 1 transaction duy nhất ở tầng DB.
-- Edge Functions chỉ gọi supabase.rpc(), không tách logic compare ra JS.
--
-- Khóa 2 lớp trong cùng transaction:
--   1. pg_advisory_xact_lock theo batch_id — serialize mọi concurrent call cùng
--      batch (kể cả khi chưa có dòng nào để lock: lần quét đầu, hoặc batch chưa
--      có trong reference). Đây vẫn là lock ở tầng DB trong 1 RPC, KHÔNG phải
--      bảng queue (đúng quyết định db_row_lock_rpc đã chốt).
--   2. SELECT ... FOR UPDATE trên dòng reference (nếu có) và dòng scanned hiện
--      có — chống đọc dữ liệu đang sửa dở khi compare.
-- Tie-break đã chốt (Plan không định nghĩa): lệch cả qty lẫn bin -> bin_mismatch.

create or replace function public.scan_submit(
  p_batch_id text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false,
  p_scanned_by uuid default null
) returns jsonb
language plpgsql
as $$
declare
  v_ref public.reference_stock%rowtype;
  v_existing_id uuid;
  v_status text;
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
  elsif p_bin is distinct from v_ref.bin then
    v_status := 'bin_mismatch';
  elsif p_qty is distinct from v_ref.qty then
    v_status := 'qty_mismatch';
  else
    v_status := 'ok';
  end if;

  -- Trùng: lock dòng hiện có, KHÔNG tự ghi (Plan §4.3c) — trả conflict để
  -- frontend hiện toast Ghi thêm / Đổi vị trí.
  select id into v_existing_id from public.scanned_data
  where batch_id = p_batch_id order by scanned_at desc limit 1 for update;
  if found then
    return jsonb_build_object(
      'conflict', true,
      'existing_id', v_existing_id,
      'computed_status', v_status
    );
  end if;

  insert into public.scanned_data (batch_id, qty, bin, scanned_by, is_manual, status)
  values (p_batch_id, p_qty, p_bin, p_scanned_by, coalesce(p_is_manual, false), v_status)
  returning id into v_existing_id;

  insert into public.scan_audit_log (scanned_id, action, new_value, actor)
  values (v_existing_id, 'insert',
          jsonb_build_object('batch_id', p_batch_id, 'qty', p_qty,
                             'bin', p_bin, 'status', v_status),
          p_scanned_by);

  return jsonb_build_object('conflict', false, 'id', v_existing_id, 'status', v_status);
end;
$$;

-- resolve_duplicate: xử lý 2 lựa chọn ở toast trùng (Plan §6).
--   'append'   (Ghi thêm):   tạo dòng mới cùng batch_id, status='duplicate'
--                            (cảnh báo vẫn hiển thị), resolution='appended'.
--   'relocate' (Đổi vị trí): ghi đè bin (+qty) của dòng cũ, compare lại status,
--                            resolution='relocated'. Không tạo dòng mới.
-- Cả 2 đều ghi scan_audit_log.
create or replace function public.resolve_duplicate(
  p_action text,
  p_scanned_id uuid,
  p_batch_id text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false,
  p_actor uuid default null
) returns jsonb
language plpgsql
as $$
declare
  v_old public.scanned_data%rowtype;
  v_ref public.reference_stock%rowtype;
  v_status text;
  v_new_id uuid;
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
  elsif p_bin is distinct from v_ref.bin then
    v_status := 'bin_mismatch';
  elsif p_qty is distinct from v_ref.qty then
    v_status := 'qty_mismatch';
  else
    v_status := 'ok';
  end if;

  if p_action = 'append' then
    insert into public.scanned_data
      (batch_id, qty, bin, scanned_by, is_manual, status, resolution)
    values (p_batch_id, p_qty, p_bin, p_actor,
            coalesce(p_is_manual, false), 'duplicate', 'appended')
    returning id into v_new_id;

    insert into public.scan_audit_log (scanned_id, action, new_value, actor)
    values (v_new_id, 'append',
            jsonb_build_object('batch_id', p_batch_id, 'qty', p_qty,
                               'bin', p_bin, 'appended_to', p_scanned_id),
            p_actor);

    return jsonb_build_object('id', v_new_id, 'status', 'duplicate',
                              'resolution', 'appended');
  else
    update public.scanned_data
    set bin = p_bin,
        qty = p_qty,
        status = v_status,
        resolution = 'relocated',
        updated_at = now(),
        scanned_by = coalesce(p_actor, scanned_by)
    where id = p_scanned_id;

    insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor)
    values (p_scanned_id, 'relocate',
            jsonb_build_object('bin', v_old.bin, 'qty', v_old.qty, 'status', v_old.status),
            jsonb_build_object('bin', p_bin, 'qty', p_qty, 'status', v_status),
            p_actor);

    return jsonb_build_object('id', p_scanned_id, 'status', v_status,
                              'resolution', 'relocated');
  end if;
end;
$$;
