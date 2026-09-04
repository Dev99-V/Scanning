-- Migration: Add stock_code column to scanned_data and update RPCs
alter table public.scanned_data add column if not exists stock_code text;

-- Backfill stock_code from reference_stock if matches
update public.scanned_data s
set stock_code = r.stock_code
from public.reference_stock r
where s.batch_id = r.batch_id and s.stock_code is null;

-- Update scan_submit RPC to accept and store p_stock_code
create or replace function public.scan_submit(
  p_batch_id text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false,
  p_scanned_by uuid default null,
  p_stock_code text default null
) returns jsonb
language plpgsql
as $$
declare
  v_ref public.reference_stock%rowtype;
  v_existing_id uuid;
  v_status text;
  v_stock_code text;
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

  insert into public.scan_audit_log (scanned_id, action, new_value, actor)
  values (v_existing_id, 'insert',
          jsonb_build_object('batch_id', p_batch_id, 'qty', p_qty,
                             'bin', p_bin, 'status', v_status, 'stock_code', v_stock_code),
          p_scanned_by);

  return jsonb_build_object('conflict', false, 'id', v_existing_id, 'status', v_status, 'stock_code', v_stock_code);
end;
$$;

-- Update resolve_duplicate RPC to accept and store p_stock_code
create or replace function public.resolve_duplicate(
  p_action text,
  p_scanned_id uuid,
  p_batch_id text,
  p_qty numeric,
  p_bin text,
  p_is_manual boolean default false,
  p_actor uuid default null,
  p_stock_code text default null
) returns jsonb
language plpgsql
as $$
declare
  v_old public.scanned_data%rowtype;
  v_ref public.reference_stock%rowtype;
  v_status text;
  v_stock_code text;
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

    insert into public.scan_audit_log (scanned_id, action, new_value, actor)
    values (v_new_id, 'append',
            jsonb_build_object('batch_id', p_batch_id, 'qty', p_qty,
                               'bin', p_bin, 'appended_to', p_scanned_id, 'stock_code', v_stock_code),
            p_actor);

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

    insert into public.scan_audit_log (scanned_id, action, old_value, new_value, actor)
    values (p_scanned_id, 'relocate',
            jsonb_build_object('bin', v_old.bin, 'qty', v_old.qty, 'status', v_old.status, 'stock_code', v_old.stock_code),
            jsonb_build_object('bin', p_bin, 'qty', p_qty, 'status', v_status, 'stock_code', v_stock_code),
            p_actor);

    return jsonb_build_object('id', p_scanned_id, 'status', v_status,
                              'resolution', 'relocated', 'stock_code', v_stock_code);
  end if;
end;
$$;
