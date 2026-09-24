-- Migration 20260926090000:
-- Bảng 3 kiểm kê (inventory_counts) — 3 yêu cầu user chốt 2026-09-24:
--   1. CHẶN CỨNG trùng TAG ID ở modal Quét Kiểm Kê: submit_inventory_count trả
--      {ok:false, error:'duplicate_batch_id'} khi batch đã có trong Bảng 3
--      (thay vì insert dòng mới như trước). Kèm advisory lock theo batch để
--      2 máy quét cùng Tag đồng thời không lọt trùng (đúng
--      concurrency_strategy=db_row_lock_rpc đã chốt trong state.json).
--   2. UPPER + TRIM mọi tầng ở cột BIN: b4 nhập vào lưu thành B4.
--      - submit_inventory_count / update_inventory_row: upper(btrim(p_bin)).
--      - recompute_scanned_statuses: so sánh upper(btrim()) để b4/B4 không báo
--        lệch giả (đồng nhất với frontend compare case-insensitive).
--      - Backfill 1 lần 3 bảng (inventory_counts, scanned_data,
--        reference_stock): bin = upper(btrim(bin)). Cột *_raw giữ nguyên bản
--        gốc để audit (đúng Plan.md §1: TRIM nhưng giữ raw).
-- Frontend rẽ nhánh theo error.code 'duplicate_batch_id' (đúng Skills C),
-- không parse message. Tương thích ngược: signature RPC giữ nguyên.
-- Cần supabase db push + (không cần deploy Edge cho RPC, nhưng import-reference
-- có đổi kèm ở đợt này nên deploy function đó).

-- 1. submit_inventory_count: chặn trùng + UPPER BIN + lock chống race.
drop function if exists public.submit_inventory_count(text, text, numeric, text, boolean);
drop function if exists public.submit_inventory_count(text, text, numeric, text, boolean, text);

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
  -- UPPER mọi chữ cái ở cột BIN QUÉT: b4 -> B4 (user chốt 2026-09-24).
  v_clean_bin := upper(btrim(p_bin));
  v_stock_code := nullif(btrim(coalesce(p_stock_code, '')), '');
  v_is_manual := coalesce(p_is_manual, false);

  -- Serialize 2 lượt quét cùng Tag (kể cả khi chưa có dòng nào để lock).
  perform pg_advisory_xact_lock(hashtext('inventory_submit:' || v_clean_batch));

  -- CHẶN CỨNG trùng TAG ID trong Bảng 3: đã có thì không ghi, frontend hiện
  -- cảnh báo + điều hướng sửa/xóa dòng cũ (không tự ghi thêm như trước).
  if exists (select 1 from public.inventory_counts where btrim(batch_id) = v_clean_batch) then
    return jsonb_build_object('ok', false, 'error', 'duplicate_batch_id', 'batch_id', v_clean_batch);
  end if;

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

-- 2. update_inventory_row: UPPER BIN khi sửa (Tag/Mã hàng vẫn khóa).
drop function if exists public.update_inventory_row(uuid, numeric);
drop function if exists public.update_inventory_row(uuid, numeric, text);
drop function if exists public.update_inventory_row(uuid, numeric, text, text);

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
    v_clean_bin := upper(btrim(p_new_bin));
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

-- 3. recompute_scanned_statuses: so sánh BIN case-insensitive (upper+btrim)
-- để b4/B4 không báo lệch giả sau khi chuẩn hóa. Giữ nguyên mọi quy tắc khác
-- (duplicate cưỡng chế, tie-break bin_mismatch, chỉ chạm status/updated_at).
create or replace function public.recompute_scanned_statuses()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_recomputed integer := 0;
  v_marked_duplicate integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('scan_submit:__recompute__'));

  with ranked as (
    select s.id, s.batch_id, s.qty, s.bin, s.stock_code,
           count(*) over (partition by s.batch_id) as cnt
    from public.scanned_data s
  ), calc as (
    select ranked.id,
      case
        when r.batch_id is null then 'not_in_reference'
        when upper(btrim(ranked.bin)) is distinct from upper(btrim(r.bin)) then 'bin_mismatch'
        when ranked.qty is distinct from r.qty then 'qty_mismatch'
        else 'ok'
      end as want,
      r.stock_code as ref_stock_code
    from ranked
    left join public.reference_stock r on r.batch_id = ranked.batch_id
    where ranked.cnt = 1
  )
  update public.scanned_data s
  set status = calc.want,
      stock_code = coalesce(s.stock_code, calc.ref_stock_code),
      updated_at = now()
  from calc
  where s.id = calc.id
    and (s.status is distinct from calc.want
         or (s.stock_code is null and calc.ref_stock_code is not null));
  get diagnostics v_recomputed = row_count;

  with ranked as (
    select s.id, count(*) over (partition by s.batch_id) as cnt
    from public.scanned_data s
  )
  update public.scanned_data s
  set status = 'duplicate',
      updated_at = now()
  from ranked
  where s.id = ranked.id
    and ranked.cnt > 1
    and s.status is distinct from 'duplicate';
  get diagnostics v_marked_duplicate = row_count;

  return jsonb_build_object(
    'ok', true,
    'recomputed', v_recomputed,
    'marked_duplicate', v_marked_duplicate
  );
end;
$$;

grant execute on function public.recompute_scanned_statuses() to authenticated, service_role;

-- 4. Backfill 1 lần: UPPER + TRIM BIN 3 bảng (cột *_raw giữ nguyên để audit).
update public.inventory_counts
set bin = upper(btrim(bin))
where bin is distinct from upper(btrim(bin));

update public.scanned_data
set bin = upper(btrim(bin)),
    updated_at = now()
where bin is distinct from upper(btrim(bin));

update public.reference_stock
set bin = upper(btrim(bin))
where bin is distinct from upper(btrim(bin));

-- Tính lại status quét sau backfill để cảnh báo Bảng 1 đúng ngay.
do $$
begin
  perform public.recompute_scanned_statuses();
end
$$;
