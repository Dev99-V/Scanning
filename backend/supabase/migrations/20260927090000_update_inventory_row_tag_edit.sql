-- Migration 20260927090000:
-- Bảng 3 kiểm kê (inventory_counts) — user yêu cầu 2026-09-27: được sửa TAG ID
-- (trước đây modal Bảng 3 khóa Tag/Mã hàng, chỉ sửa SL KK + Bin KK).
-- Quy tắc user chốt:
--   1. CHẶN TAG ngoài nguồn: TAG mới phải có trong reference_stock (Bảng 2),
--      không có → trả {ok:false, error:'not_in_reference'}, không ghi.
--   2. CHẶN CỨNG trùng TAG nội bộ Bảng 3: TAG mới đã có ở dòng kiểm kê khác
--      (id khác) → trả {ok:false, error:'duplicate_batch_id'}, không ghi
--      (giống luật submit_inventory_count đã chốt 2026-09-24).
--   3. Auto lookup Mã hàng: TAG mới có trong nguồn → stock_code đồng bộ theo
--      reference_stock.stock_code (giống Bảng 1 sửa TAG).
-- Tương thích ngược: p_new_batch_id OPTIONAL cuối cùng (NULL = giữ TAG cũ)
-- nên frontend/Edge cũ chỉ gửi qty/bin/actor vẫn chạy. DROP overload cũ để
-- PostgREST không phân vân (bài học 2026-09-08). Kèm advisory lock
-- inventory_submit theo TAG mới để 2 máy sửa cùng TAG đồng thời không lọt
-- trùng (đúng concurrency_strategy=db_row_lock_rpc).
-- Cần supabase db push lên cloud (CI backend-deploy khi merge main).

drop function if exists public.update_inventory_row(uuid, numeric);
drop function if exists public.update_inventory_row(uuid, numeric, text);
drop function if exists public.update_inventory_row(uuid, numeric, text, text);

create or replace function public.update_inventory_row(
  p_id uuid,
  p_new_qty numeric default null,
  p_new_bin text default null,
  p_actor_name text default null,
  p_new_batch_id text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row public.inventory_counts%rowtype;
  v_ref public.reference_stock%rowtype;
  v_old_qty numeric;
  v_old_bin text;
  v_qty numeric;
  v_bin text;
  v_clean_bin text;
  v_clean_new_batch text;
  v_new_batch text;
  v_new_stock text;
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

  if p_new_batch_id is not null then
    v_clean_new_batch := btrim(p_new_batch_id);
    if v_clean_new_batch is null or v_clean_new_batch = '' then
      return jsonb_build_object('ok', false, 'error', 'batch_id_required');
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
  v_new_batch := v_row.batch_id;
  v_new_stock := v_row.stock_code;

  -- Đổi TAG ID: chỉ xử lý khi khác TAG hiện tại sau khi trim.
  if v_clean_new_batch is not null
     and v_clean_new_batch is distinct from btrim(v_row.batch_id) then
    -- Serialize với submit/sửa cùng TAG mới (kể cả khi dòng đích chưa tồn tại).
    perform pg_advisory_xact_lock(hashtext('inventory_submit:' || v_clean_new_batch));

    -- 1. TAG mới phải có trong nguồn (Bảng 2) — user chốt Chặn ngoài nguồn.
    select * into v_ref from public.reference_stock where batch_id = v_clean_new_batch;
    if not found then
      return jsonb_build_object(
        'ok', false,
        'error', 'not_in_reference',
        'batch_id', v_clean_new_batch
      );
    end if;

    -- 2. TAG mới không được trùng dòng kiểm kê khác — user chốt Chặn cứng.
    if exists (
      select 1 from public.inventory_counts
      where btrim(batch_id) = v_clean_new_batch
        and id <> p_id
    ) then
      return jsonb_build_object(
        'ok', false,
        'error', 'duplicate_batch_id',
        'batch_id', v_clean_new_batch
      );
    end if;

    -- 3. Auto lookup Mã hàng từ nguồn (giống Bảng 1 sửa TAG).
    v_new_batch := v_clean_new_batch;
    v_new_stock := v_ref.stock_code;
  end if;

  update public.inventory_counts
  set batch_id = v_new_batch,
      stock_code = v_new_stock,
      qty = v_qty,
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
      'stock_code', v_row.stock_code,
      'qty', v_old_qty,
      'bin', v_old_bin
    ),
    jsonb_build_object(
      'kind', 'inventory_update',
      'inventory_id', p_id,
      'batch_id', v_new_batch,
      'stock_code', v_new_stock,
      'qty', v_qty,
      'bin', v_bin
    ),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'batch_id', v_new_batch,
    'stock_code', v_new_stock,
    'qty', v_qty,
    'bin', v_bin
  );
end;
$$;

grant execute on function public.update_inventory_row(uuid, numeric, text, text, text) to anon, authenticated, service_role;
