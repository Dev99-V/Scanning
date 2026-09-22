-- Migration 20260923090000: RPC restore_tag_7055 (gắn lại nhãn 7055 hàng loạt).
-- Ngữ cảnh (bug mất nhãn 7055 sau update nguồn, 2026-09-23): Edge import-reference
-- xóa-nạp lại toàn bảng reference_stock bằng dữ liệu file Excel — mà file Excel
-- KHÔNG có cột 7055 — nên mọi nhãn tag_7055=true bị reset về false sau mỗi lần
-- nạp. Nhãn này là dữ liệu do người dùng gắn tay (thẻ Thêm Nguồn, checkbox 7055),
-- audit log cũng không lưu giá trị flag nên không thể suy ngược từ log.
-- RPC này để khôi phục surgical: nhận danh sách Tag ID (lấy từ file Excel
-- "Tag in thêm 7055 [ngày].xlsx" đã xuất trước đó), gắn lại flag cho tag còn
-- trong nguồn, trả về danh sách tag không còn tồn tại để đối chiếu tay.
-- Edge import-reference (từ bản này) tự snapshot + gắn lại sau mỗi lần nạp nên
-- RPC chủ yếu dùng 1 lần để chữa dữ liệu đã mất; về sau không cần gọi tay nữa.

create or replace function public.restore_tag_7055(
  p_batch_ids text[],
  p_value boolean default true,
  p_actor_name text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_clean text[];
  v_applied integer := 0;
  v_missing text[] := '{}';
  v_actor_name text := left(nullif(btrim(coalesce(p_actor_name, '')), ''), 50);
begin
  if p_batch_ids is null or coalesce(array_length(p_batch_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'batch_ids_required');
  end if;

  -- Chuẩn hóa: trim, bỏ rỗng, khử trùng.
  select coalesce(array_agg(distinct btrim(x)), '{}')
    into v_clean
  from unnest(p_batch_ids) as x
  where btrim(x) is not null and btrim(x) <> '';
  if coalesce(array_length(v_clean, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'batch_ids_required');
  end if;

  update public.reference_stock
  set tag_7055 = coalesce(p_value, true)
  where batch_id = any (v_clean);
  get diagnostics v_applied = row_count;

  -- Tag yêu cầu nhưng không còn trong nguồn (đã bị xóa khỏi file mới).
  select coalesce(array_agg(v), '{}')
    into v_missing
  from unnest(v_clean) as v
  where not exists (select 1 from public.reference_stock r where r.batch_id = v);

  insert into public.scan_audit_log (scanned_id, action, new_value, actor, actor_name)
  values (
    null,
    'edit',
    jsonb_build_object(
      'kind', 'tag_7055_restore',
      'value', coalesce(p_value, true),
      'requested', array_length(v_clean, 1),
      'applied', v_applied,
      'missing', v_missing,
      'batch_ids', v_clean
    ),
    auth.uid(),
    v_actor_name
  );

  return jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'missing', v_missing,
    'missing_count', coalesce(array_length(v_missing, 1), 0)
  );
end;
$$;

-- Kiosk kho chạy anon (như add_reference_stock): mở execute cho cả 3 role.
grant execute on function public.restore_tag_7055(text[], boolean, text) to anon, authenticated, service_role;
