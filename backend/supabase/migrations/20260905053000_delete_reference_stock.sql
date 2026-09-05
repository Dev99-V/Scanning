-- Migration 20260905053000:
-- Tạo RPC delete_reference_stock (cho phép xóa bản ghi nguồn khi cần) và dọn dòng TEST

create or replace function public.delete_reference_stock(
  p_batch_id text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_clean_batch_id text;
begin
  v_clean_batch_id := btrim(p_batch_id);
  if v_clean_batch_id is null or v_clean_batch_id = '' then
    return jsonb_build_object('ok', false, 'error', 'batch_id_required', 'message', 'Tag ID không được để trống');
  end if;

  delete from public.reference_stock
  where batch_id = v_clean_batch_id;

  return jsonb_build_object('ok', true, 'deleted_batch_id', v_clean_batch_id);
end;
$$;

grant execute on function public.delete_reference_stock(text) to anon, authenticated, service_role;

-- Dọn dẹp bản ghi TEST
delete from public.reference_stock where batch_id = 'TEST';
