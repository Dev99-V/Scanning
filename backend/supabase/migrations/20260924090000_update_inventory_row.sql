-- Migration 20260924090000:
-- RPC update_inventory_row: cho phép chỉnh sửa DUY NHẤT số lượng (SL KK)
-- của dòng kiểm kê ở Bảng 3 (quy tắc nghiệp vụ: Tag ID / Bin KK / Stock Code
-- không được sửa, chỉ SL đếm nhầm mới được sửa).
-- Chuẩn repo: mọi ghi đi qua RPC SECURITY DEFINER (app chạy phiên anon),
-- validate rõ ràng, grant anon/authenticated/service_role.
-- Không đổi contract cũ (submit_inventory_count / delete_inventory_row giữ nguyên).
-- Cần supabase db push lên cloud (RPC-only, không cần deploy Edge).

create or replace function public.update_inventory_row(
  p_id uuid,
  p_new_qty numeric
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id text;
begin
  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'id_required');
  end if;

  if p_new_qty is null or p_new_qty <= 0 then
    return jsonb_build_object('ok', false, 'error', 'qty_invalid');
  end if;

  update public.inventory_counts
  set qty = p_new_qty
  where id = p_id
  returning batch_id into v_batch_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', p_id,
    'batch_id', v_batch_id,
    'qty', p_new_qty
  );
end;
$$;

grant execute on function public.update_inventory_row(uuid, numeric) to anon, authenticated, service_role;
