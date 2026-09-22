-- Migration 20260922090000: RPC recompute_scanned_statuses + backfill 1 lần.
-- Ngữ cảnh (pipeline.md §3, §5): Edge import-reference xóa-nạp lại toàn bảng
-- reference_stock nhưng KHÔNG tính lại scanned_data.status → dòng quét cũ giữ
-- status 'ok' dù BIN/QTY nguồn mới đã đổi (bug ảnh: BIN quét 25 vs BIN HT 01
-- mà badge vẫn "Khớp", note đỏ "Khớp hoàn toàn").
-- RPC này được import-reference gọi sau mỗi lần upsert (không đổi contract cũ,
-- chỉ thêm 1 lời gọi service_role nội bộ), và chạy backfill ngay trong migration
-- để chữa dữ liệu stale hiện tại.
--
-- Quy tắc giữ nguyên từ các migration trước:
--  1. Batch có >= 2 lượt quét trong scanned_data LUÔN là 'duplicate'
--     (Learning 2026-09-07 — không bao giờ báo khớp cho tag quét trùng).
--  2. So BIN sau khi btrim 2 đầu (đồng nhất với Edge đã trim + update_scanned_tag_id).
--  3. Tie-break Plan §4: lệch cả qty lẫn bin -> 'bin_mismatch'.
--  4. Chỉ chạm cột status/updated_at (+ stock_code khi đang null và nguồn có),
--     giữ nguyên resolution và mọi cột khác.

create or replace function public.recompute_scanned_statuses()
returns jsonb
language plpgsql
security definer
as $$
declare
  v_recomputed integer := 0;
  v_marked_duplicate integer := 0;
begin
  -- Serialize với các lượt quét đang ghi (chung namespace scan_submit).
  perform pg_advisory_xact_lock(hashtext('scan_submit:__recompute__'));

  -- Bước 1: tính lại status nền cho batch chỉ có đúng 1 lượt quét.
  -- Dòng 'duplicate' đơn lẻ (bạn quét cặp đã bị xóa) cũng được chữa về nền đúng.
  with ranked as (
    select s.id, s.batch_id, s.qty, s.bin, s.stock_code,
           count(*) over (partition by s.batch_id) as cnt
    from public.scanned_data s
  ), calc as (
    select ranked.id,
      case
        when r.batch_id is null then 'not_in_reference'
        when btrim(ranked.bin) is distinct from btrim(r.bin) then 'bin_mismatch'
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

  -- Bước 2: cưỡng chế 'duplicate' cho mọi batch có >= 2 lượt quét
  -- (kể cả dòng vừa bị bước 1 tính thành ok/mismatch — trùng là trùng).
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

-- Backfill 1 lần ngay khi migration apply: chữa toàn bộ status stale hiện tại.
do $$
begin
  perform public.recompute_scanned_statuses();
end
$$;
