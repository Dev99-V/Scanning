// ReconciliationTable — Bảng 1: dữ liệu quét thực tế & đối chiếu (Plan.md §7.2).
// Cột: Stock code, Tag id, Số lượng, Bin, Số lượng hệ thống, Bin hệ thống, Trạng thái & Ghi chú cảnh báo.
// Hỗ trợ cuộn chuột 100 dòng tự động tải tiếp (Infinite Scroll / Virtualization Chunking).
import React, { useEffect, useRef, useState } from 'react';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import type { UsePresenceApi } from '../hooks/usePresence';
import { table1RowKey } from '../hooks/presenceHelpers';
import { copyText } from '../lib/copyText';
import { buildCheckedTagMap } from '../lib/inventoryCompare';
import { smoothScrollToElementById } from '../lib/smoothScroll';
import type { ScanStatus } from '../lib/scanApi';
import { supabase } from '../lib/supabase';
import type { InventoryRow, ScanRow } from '../lib/types';

const STATUS_LABEL: Record<ScanStatus, string> = {
  pending: 'Chờ',
  ok: 'Khớp',
  qty_mismatch: 'Lệch SL',
  bin_mismatch: 'Lệch vị trí',
  not_in_reference: 'Ngoài hệ thống',
  duplicate: 'Trùng Tag',
};

const STATUS_CLASS: Record<ScanStatus, string> = {
  pending: 'bg-slate-700 text-slate-200 border-slate-600',
  ok: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40',
  qty_mismatch: 'bg-rose-950/80 text-rose-300 border-rose-500/50 font-bold',
  bin_mismatch: 'bg-rose-950/80 text-rose-300 border-rose-500/50 font-bold',
  not_in_reference: 'bg-sky-950/80 text-sky-300 border-sky-500/40',
  duplicate: 'bg-rose-950/80 text-rose-300 border-rose-500/40',
};

interface ReconciliationTableProps {
  rows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
  onRowDeleted?: (id: string) => void;
  onRowUpdated?: () => void;
  /** Bật/tắt nhãn 7055 ở Bảng 1 → App đồng bộ map tra cứu để Bảng 2 + badge cùng đổi tức thì. */
  onTag7055Updated?: (batchId: string, value: boolean) => void;
  /** Presence realtime (khóa mềm theo dòng). Không bắt buộc để test cũ vẫn chạy. */
  presence?: UsePresenceApi | null;
  /** Tên hiển thị để ghi nhật ký hoạt động — optional để test cũ vẫn chạy. */
  actorName?: string | null;
  /** Dòng kiểm kê (Bảng 3) để highlight Tag đã kiểm kê khớp + loại trừ dần. */
  inventoryRows?: InventoryRow[];
}

export default function ReconciliationTable({ rows, systemByBatch, onRowDeleted, onRowUpdated, onTag7055Updated, presence, actorName, inventoryRows = [] }: ReconciliationTableProps) {
  const [visibleCount, setVisibleCount] = useState(100);
  const [statusFilter, setStatusFilter] = useState<'all' | ScanStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingRow, setDeletingRow] = useState<ScanRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  // Công tắc 7055 từng dòng quét: bật/tắt nhãn Tag in thêm ngay trên Bảng 1.
  // Nguồn thật duy nhất là reference_stock.tag_7055 (RPC restore_tag_7055 với
  // p_value true/false); Bảng 2 đồng bộ qua map tra cứu + realtime đa máy.
  const [toggling7055Id, setToggling7055Id] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  async function handleToggle7055(r: ScanRow) {
    const cleanBatch = (r.batch_id || '').trim();
    const sys = systemByBatch.get(cleanBatch);
    // Tag chưa có trong nguồn thì không có dòng reference để gắn nhãn.
    if (!sys || toggling7055Id !== null) return;
    const holder = presence?.getLock('table1', table1RowKey(r.id));
    if (holder) {
      setActionNotice(`🔒 ${holder.name} đang thao tác dòng ${cleanBatch} — vui lòng chờ cập nhật mới.`);
      return;
    }
    const next = !sys.tag_7055;
    setToggling7055Id(r.id);
    setActionNotice(null);
    try {
      const { data, error } = await supabase.rpc('restore_tag_7055', {
        p_batch_ids: [cleanBatch],
        p_value: next,
        ...(actorName ? { p_actor_name: actorName } : {}),
      });
      if (error || (data as { ok?: unknown } | null)?.ok !== true) {
        setActionNotice(
          `❌ Lỗi đổi nhãn 7055 (${cleanBatch}): ${error?.message || (data as { error?: unknown } | null)?.error || 'Không xác định'}`,
        );
      } else {
        // Đồng bộ tức thì máy này: map tra cứu đổi → badge Bảng 1 đổi ngay,
        // App truyền cùng updater cho Bảng 2 nên Bảng 2 đổi theo; máy khác
        // tự đổi qua realtime reference_stock.
        onTag7055Updated?.(cleanBatch, next);
      }
    } catch (err) {
      setActionNotice(`❌ Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setToggling7055Id(null);
    }
  }

  // State cho modal chỉnh sửa Tag ID & Số lượng & Vị trí quét
  const [editingRow, setEditingRow] = useState<ScanRow | null>(null);
  const [newTagId, setNewTagId] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editBin, setEditBin] = useState('');
  const [manualStockCode, setManualStockCode] = useState('');
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);

  // Copy nhanh từng ô: TAG ID / SL quét / Bin quét (chỉ copy đúng 1 giá trị của ô đó).
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
  }, []);

  async function handleCopyCell(value: string, key: string) {
    const ok = await copyText(value);
    if (!ok) return;
    setCopiedKey(key);
    if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopiedKey(null), 1200);
  }

  function openEditModal(r: ScanRow) {
    // Khóa mềm: dòng đang bị người khác sửa thì không cho mở modal.
    const holder = presence?.getLock('table1', table1RowKey(r.id));
    if (holder) {
      setEditNotice(`🔒 ${holder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới.`);
      return;
    }
    presence?.setEditing({
      table: 'table1',
      key: table1RowKey(r.id),
      batchId: (r.batch_id || '').trim(),
      label: 'sửa lượt quét Bảng 1',
    });
    setEditingRow(r);
    setNewTagId(r.batch_id);
    setEditQty(String(r.qty));
    setEditBin(r.bin);
    const cleanBatch = (r.batch_id || '').trim();
    const sys = systemByBatch.get(cleanBatch);
    setManualStockCode(r.stock_code ?? sys?.stock_code ?? '');
    setEditNotice(null);
  }

  async function handleConfirmEdit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!editingRow) return;
    const cleanTag = newTagId.trim();
    if (!cleanTag) {
      setEditNotice('⚠️ Vui lòng nhập Tag ID hợp lệ (không được để trống).');
      return;
    }
    const cleanQty = Number(editQty);
    if (isNaN(cleanQty) || cleanQty < 0) {
      setEditNotice('⚠️ Số lượng quét phải là một số không âm hợp lệ.');
      return;
    }
    const cleanBin = editBin.trim();
    if (!cleanBin) {
      setEditNotice('⚠️ Vui lòng nhập Vị trí (Bin) quét hợp lệ (không được để trống).');
      return;
    }
    setIsSavingTag(true);
    setEditNotice(null);
    try {
      const { data, error } = await supabase.rpc('update_scanned_tag_id', {
        p_id: editingRow.id,
        p_new_batch_id: cleanTag,
        p_stock_code: manualStockCode.trim() || null,
        p_new_qty: cleanQty,
        p_new_bin: cleanBin,
        ...(actorName ? { p_actor_name: actorName } : {}),
      });
      if (error || (data as { ok?: unknown } | null)?.ok !== true) {
        setEditNotice(`❌ Lỗi cập nhật: ${error?.message || (data as { error?: unknown } | null)?.error || 'Không xác định'}`);
      } else {
        onRowUpdated?.();
        closeEditModal();
      }
    } catch (err) {
      setEditNotice(`❌ Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSavingTag(false);
    }
  }

  // Nhả khóa presence khi unmount thật để dòng không kẹt. Dùng ref để object
  // presence mới (đổi mỗi khi peers đổi) không kích hoạt nhả khóa sớm làm mất
  // lock khi modal còn mở.
  const presenceRef = useRef(presence);
  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);
  useEffect(() => () => presenceRef.current?.clearEditing(), []);

  function closeEditModal() {
    setEditingRow(null);
    presence?.clearEditing();
  }

  function openDeleteModal(r: ScanRow) {
    const holder = presence?.getLock('table1', table1RowKey(r.id));
    if (holder) return;
    presence?.setEditing({
      table: 'table1',
      key: table1RowKey(r.id),
      batchId: (r.batch_id || '').trim(),
      label: 'xóa lượt quét Bảng 1',
    });
    setDeleteNotice(null);
    setDeletingRow(r);
  }

  function closeDeleteModal() {
    setDeletingRow(null);
    presence?.clearEditing();
  }

  async function handleConfirmDelete() {
    if (!deletingRow) return;
    setIsDeleting(true);
    setDeleteNotice(null);
    try {
      const { data, error } = await supabase.rpc('delete_scanned_row', {
        p_id: deletingRow.id,
        ...(actorName ? { p_actor_name: actorName } : {}),
      });
      if (error || !data?.ok) {
        setDeleteNotice(`❌ Lỗi xóa: ${error?.message || data?.error || 'Không xác định'}`);
      } else {
        onRowDeleted?.(deletingRow.id);
        closeDeleteModal();
      }
    } catch (e) {
      setDeleteNotice(`❌ Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeleting(false);
    }
  }

  // Đếm tần suất xuất hiện của từng Tag ID để nhận diện tag quét trùng nhiều vị trí
  const batchCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (!r?.batch_id) continue;
      const b = r.batch_id.trim();
      counts.set(b, (counts.get(b) || 0) + 1);
    }
    return counts;
  }, [rows]);

  // Tag đã kiểm kê khớp (Bảng 3 báo khớp cả B1 lẫn B2) → highlight để loại trừ dần.
  // Dòng trùng quét không tính (phải xử lý trùng trước), kể cả khi tổng SL vô tình khớp.
  const checkedMap = React.useMemo(
    () => buildCheckedTagMap(inventoryRows, rows, systemByBatch),
    [inventoryRows, rows, systemByBatch],
  );
  const [hideChecked, setHideChecked] = useState(false);
  const checkedCount = React.useMemo(() => {
    const seen = new Set<string>();
    let n = 0;
    for (const r of rows) {
      if (!r?.id || seen.has(r.id)) continue;
      seen.add(r.id);
      const b = (r.batch_id || '').trim();
      const dup = (batchCounts.get(b) ?? 0) > 1 || r.status === 'duplicate';
      if (!dup && checkedMap.get(b) === true) n++;
    }
    return n;
  }, [rows, batchCounts, checkedMap]);

  // Lọc theo trạng thái và từ khóa tìm kiếm (kèm chống duplicate key),
  // sau đó xếp hiển thị A–Z theo Bin quét — áp dụng chung cho mọi Trạng thái,
  // các cột khác giữ nguyên thứ tự quét ban đầu (sort ổn định, không tiêu chí phụ).
  const filteredRows = React.useMemo(() => {
    const seenIds = new Set<string>();
    const list = rows.filter((r) => {
      if (r?.id) {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
      }
      const b = r.batch_id?.trim() ?? '';
      const isDuplicate = (batchCounts.get(b) ?? 0) > 1 || r.status === 'duplicate';

      // Loại trừ dần: ẩn dòng đã kiểm kê khớp (trừ dòng trùng — giữ lại để xử lý).
      if (hideChecked && !isDuplicate && checkedMap.get(b) === true) return false;

      if (statusFilter === 'duplicate') {
        if (!isDuplicate) return false;
      } else if (statusFilter !== 'all') {
        if (isDuplicate) return false;
        if (r.status !== statusFilter) return false;
      }

      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const cleanBatch = (r.batch_id || '').trim();
        const sys = systemByBatch.get(cleanBatch);
        const sc = (r.stock_code ?? sys?.stock_code ?? '').toLowerCase();
        const tag = cleanBatch.toLowerCase();
        const bin = r.bin.toLowerCase();
        if (!sc.includes(term) && !tag.includes(term) && !bin.includes(term)) {
          return false;
        }
      }
      return true;
    });
    list.sort((a, b) =>
      (a.bin || '').trim().localeCompare((b.bin || '').trim(), 'vi', { numeric: true }),
    );
    return list;
  }, [rows, statusFilter, searchTerm, systemByBatch, batchCounts, hideChecked, checkedMap]);

  if (rows.length === 0) {
    return (
      <div data-testid="recon-empty" className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
        <span className="text-xl">📋</span>
        <p className="mt-1 font-bold">Chưa có lượt quét nào.</p>
        <p className="text-xs text-slate-500">Bấm nút &quot;Quét Tag&quot; ở trên để bắt đầu phiên quét mã PDA.</p>
      </div>
    );
  }

  // Cuộn chuột: chạm gần đáy (còn 80px) tự động tăng thêm 100 dòng
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visibleCount < filteredRows.length) {
      setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length));
    }
  }

  const displayedRows = filteredRows.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-3">
      {/* Bộ lọc trạng thái & Tìm kiếm ở Bảng 1 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        {/* Lọc trạng thái bằng dropdown tiện lợi */}
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="recon-status-filter" className="text-[11px] font-bold uppercase text-slate-400">
            Trạng thái:
          </label>
          <select
            id="recon-status-filter"
            aria-label="Lọc trạng thái"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as 'all' | ScanStatus);
              setVisibleCount(100);
            }}
            className="rounded-xl border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-xs text-cyan-300 focus:border-indigo-500 focus:outline-none"
          >
            <option value="all">Tất cả trạng thái ({rows.length})</option>
            <option value="ok">Chỉ hiện: Khớp hoàn toàn</option>
            <option value="qty_mismatch">Chỉ hiện: Lệch số lượng</option>
            <option value="bin_mismatch">Chỉ hiện: Lệch vị trí bin</option>
            <option value="not_in_reference">Chỉ hiện: Ngoài hệ thống</option>
            <option value="duplicate">Chỉ hiện: Trùng Tag</option>
            <option value="pending">Chỉ hiện: Đang chờ</option>
          </select>
        </div>

        {/* Ô tìm kiếm Stock Code / Tag / Bin */}
        <div className="w-full sm:w-64">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setVisibleCount(100);
            }}
            placeholder="🔍 Tìm Stock Code, Tag, Bin..."
            className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-xs text-cyan-300 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
        </div>

        {/* Loại trừ dần: ẩn dòng Tag đã kiểm kê khớp ở Bảng 3 */}
        <div>
          <button
            type="button"
            onClick={() => {
              setHideChecked((prev) => !prev);
              setVisibleCount(100);
            }}
            aria-pressed={hideChecked}
            aria-label="Ẩn dòng đã kiểm kê khớp"
            title="Ẩn các dòng Tag đã kiểm kê khớp ở Bảng 3 để loại trừ dần (dòng trùng quét vẫn giữ lại)"
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-xs font-bold transition active:scale-95 ${
              hideChecked
                ? 'border-teal-500 bg-teal-500/25 text-teal-300 shadow-md shadow-teal-500/20'
                : 'border-white/10 bg-black/50 text-slate-400 hover:border-teal-500/40 hover:text-teal-300'
            }`}
          >
            <span>{hideChecked ? '✓' : '📦'}</span>
            <span>Ẩn đã KK khớp ({checkedCount})</span>
          </button>
        </div>
      </div>

      {actionNotice && (
        <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2 text-xs text-rose-200">
          {actionNotice}
        </p>
      )}

      <div
        onScroll={handleScroll}
        className="max-h-[500px] overflow-y-auto overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/80 shadow-inner custom-scrollbar"
      >
        <table className="w-full min-w-[860px] text-left font-mono text-xs">
          <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-950 text-slate-400 shadow">
            <tr>
              <th className="px-3 py-3">STOCK CODE</th>
              <th className="px-3 py-3">TAG ID</th>
              <th className="px-3 py-3 text-right">SL QUÉT</th>
              <th className="px-3 py-3 text-right">SL HỆ THỐNG</th>
              <th className="px-3 py-3 text-right">BIN QUÉT</th>
              <th className="px-3 py-3 text-right">BIN HỆ THỐNG</th>
              <th className="px-3 py-3 text-center">TRẠNG THÁI</th>
              <th className="px-3 py-3 text-center">KIỂM KÊ</th>
              <th className="px-3 py-3 text-left">GHI CHÚ / CẢNH BÁO</th>
              <th className="px-3 py-3 text-center">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {displayedRows.map((r) => {
              const cleanBatch = (r.batch_id || '').trim();
              const sys = systemByBatch.get(cleanBatch);
              // Live-compare với nguồn HIỆN TẠI (pipeline.md §5): trim BIN 2 đầu
              // trước khi so (đồng nhất với import TRIM + RPC btrim), nếu không
              // "25 " vs "25" báo đỏ giả trong khi DB coi là khớp.
              const sysBin = (sys?.bin ?? '').trim();
              const scanBin = (r.bin ?? '').trim();
              const isMissingSys = !sys;
              const isQtyDiff = !!sys && Number(sys.qty) !== Number(r.qty);
              const isBinDiff = !!sys && sysBin !== scanBin;
              const stockCode = r.stock_code ?? sys?.stock_code ?? '—';
              const scanCount = batchCounts.get(r.batch_id?.trim() ?? '') ?? 1;
              const isDuplicate = scanCount > 1 || r.status === 'duplicate';
              // Highlight kiểm kê khớp (Bảng 3) — trừ dòng trùng để xử lý trùng trước.
              const showChecked = !isDuplicate && checkedMap.get(cleanBatch) === true;
              // Khóa mềm realtime: dòng đang bị người khác sửa/xóa thì disable.
              const lockHolder = presence?.getLock('table1', table1RowKey(r.id)) ?? null;

              // Ghi chú chi tiết cho dòng — NGUYÊN TẮC: không bao giờ hiển thị
              // "Khớp hoàn toàn" khi live-compare đang lệch (bug ảnh: BIN 25 vs 01
              // mà note đỏ "Khớp hoàn toàn"). status stale sau import được RPC
              // recompute chữa ở DB; ở đây note luôn phản ánh nguồn hiện tại.
              let note = '';
              if (isDuplicate) {
                note = scanCount > 1
                  ? `Trùng Tag ID (Quét ${scanCount} lần ở các vị trí khác nhau)`
                  : `Trùng Tag ID (${r.resolution === 'appended' ? 'Đã ghi thêm' : 'Đã đổi vị trí'})`;
              } else if (isMissingSys) {
                note = r.status === 'not_in_reference'
                  ? 'Tag ID không có trong file nguồn'
                  : `⚠️ Không còn trong nguồn (trạng thái lưu: ${STATUS_LABEL[r.status]} — chờ đối chiếu lại sau nạp nguồn)`;
              } else if (isBinDiff || isQtyDiff) {
                // Live-compare lệch thì note lệch — kể cả khi status còn 'ok' stale.
                if (isBinDiff && isQtyDiff) {
                  note = `Lệch cả SL và vị trí (Quét: ${r.qty}/${r.bin} / Nguồn: ${sys?.qty}/${sysBin || '—'})`;
                } else if (isBinDiff) {
                  note = `Lệch vị trí (Quét: ${r.bin} / Nguồn: ${sysBin || '—'})`;
                } else {
                  note = `Lệch số lượng (Quét: ${r.qty} / Nguồn: ${sys?.qty ?? '—'})`;
                }
              } else if (r.status === 'ok') {
                note = 'Khớp hoàn toàn';
              } else if (r.status === 'qty_mismatch') {
                note = `Lệch số lượng (Quét: ${r.qty} / Nguồn: ${sys?.qty ?? '—'})`;
              } else if (r.status === 'bin_mismatch') {
                note = `Lệch vị trí (Quét: ${r.bin} / Nguồn: ${sysBin || '—'})`;
              } else if (r.status === 'not_in_reference') {
                note = 'Tag ID không có trong file nguồn';
              }

              return (
                <tr
                  key={r.id}
                  data-testid={`recon-row-${r.id}`}
                  className={`hover:bg-white/5 transition-colors ${
                    isDuplicate
                      ? 'duplicate-alert bg-purple-950/20'
                      : showChecked
                        ? 'bg-teal-950/30 border-l-4 border-l-teal-400'
                        : ''
                  }`}
                >
                  {/* Stock Code */}
                  <td className="px-3 py-2.5 font-bold text-slate-200">{stockCode}</td>

                  {/* Tag ID (bấm để sửa hoặc dùng nút ở cột Thao tác) */}
                  <td className="px-3 py-2.5 font-bold text-cyan-300">
                    {/* flex-nowrap + whitespace-nowrap: TAG + icon copy + badge 7055 luôn đúng 1 hàng,
                        không tràn xuống hàng 2 (bảng đã cuộn ngang, không cần wrap). */}
                    <div className="flex items-center gap-1 flex-nowrap whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        disabled={Boolean(lockHolder)}
                        title={lockHolder ? `${lockHolder.name} đang thao tác dòng này` : 'Bấm để chỉnh sửa Tag ID'}
                        className="hover:underline hover:text-cyan-200 transition text-left font-bold disabled:no-underline disabled:opacity-60"
                      >
                        {r.batch_id}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyCell(String(r.batch_id), `${r.id}-tag`)}
                        title={copiedKey === `${r.id}-tag` ? 'Đã sao chép Tag ID!' : 'Sao chép nhanh Tag ID'}
                        aria-label={`Sao chép Tag ID ${r.batch_id}`}
                        data-testid={`copy-tag-${r.id}`}
                        className="shrink-0 rounded border border-transparent px-0.5 py-px text-[10px] leading-none text-slate-500 transition hover:border-cyan-500/40 hover:bg-cyan-950/60 hover:text-cyan-300 active:scale-95"
                      >
                        {copiedKey === `${r.id}-tag` ? '✓' : '📋'}
                      </button>
                      {Boolean(sys?.tag_7055) && (
                        <span
                          data-testid={`recon-tag-7055-${r.batch_id}`}
                          title="Tag in thêm 7055"
                          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-purple-500/50 bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-purple-300 shadow-sm"
                        >
                          <span>🏷️ 7055</span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Số lượng quét (bấm để chỉnh sửa hoặc dùng nút ở cột Thao tác) */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        disabled={Boolean(lockHolder)}
                        title={lockHolder ? `${lockHolder.name} đang thao tác dòng này` : 'Bấm để chỉnh sửa lượt quét'}
                        className="hover:underline transition text-right font-bold inline-block disabled:no-underline disabled:opacity-60"
                      >
                        <span
                          className={
                            isQtyDiff
                              ? 'inline-block rounded border border-rose-500/60 bg-rose-950/60 px-2 py-0.5 font-bold text-rose-400 shadow-sm'
                              : 'font-bold text-white'
                          }
                        >
                          {r.qty}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyCell(String(r.qty), `${r.id}-qty`)}
                        title={copiedKey === `${r.id}-qty` ? 'Đã sao chép SL quét!' : 'Sao chép nhanh SL quét'}
                        aria-label={`Sao chép SL quét ${r.qty} của ${r.batch_id}`}
                        data-testid={`copy-qty-${r.id}`}
                        className="rounded-md border border-transparent px-1 py-0.5 text-[11px] leading-none text-slate-500 transition hover:border-cyan-500/40 hover:bg-cyan-950/60 hover:text-cyan-300 active:scale-95"
                      >
                        {copiedKey === `${r.id}-qty` ? '✓' : '📋'}
                      </button>
                    </span>
                  </td>

                  {/* Số lượng hệ thống (màu đỏ cảnh báo nếu chênh lệch) */}
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className={
                        isQtyDiff
                          ? 'inline-block rounded border border-rose-500/60 bg-rose-950/60 px-2 py-0.5 font-bold text-rose-400 shadow-sm'
                          : 'text-slate-400'
                      }
                    >
                      {sys ? sys.qty : '—'}
                    </span>
                  </td>

                  {/* Bin quét (màu đỏ cảnh báo nếu sai lệch, bấm để sửa nhanh) */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="inline-flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        disabled={Boolean(lockHolder)}
                        title={lockHolder ? `${lockHolder.name} đang thao tác dòng này` : 'Bấm để chỉnh sửa vị trí quét'}
                        className="hover:underline transition text-right font-bold inline-block disabled:no-underline disabled:opacity-60"
                      >
                        <span
                          className={
                            isBinDiff
                              ? 'inline-block rounded border border-rose-500/60 bg-rose-950/60 px-2 py-0.5 font-bold text-rose-400 shadow-sm'
                              : 'font-semibold text-slate-200'
                          }
                        >
                          {r.bin}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyCell(String(r.bin), `${r.id}-bin`)}
                        title={copiedKey === `${r.id}-bin` ? 'Đã sao chép Bin quét!' : 'Sao chép nhanh Bin quét'}
                        aria-label={`Sao chép Bin quét ${r.bin} của ${r.batch_id}`}
                        data-testid={`copy-bin-${r.id}`}
                        className="rounded-md border border-transparent px-1 py-0.5 text-[11px] leading-none text-slate-500 transition hover:border-cyan-500/40 hover:bg-cyan-950/60 hover:text-cyan-300 active:scale-95"
                      >
                        {copiedKey === `${r.id}-bin` ? '✓' : '📋'}
                      </button>
                    </span>
                  </td>

                  {/* Bin hệ thống (màu đỏ cảnh báo nếu sai lệch) */}
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className={
                        isBinDiff
                          ? 'inline-block rounded border border-rose-500/60 bg-rose-950/60 px-2 py-0.5 font-bold text-rose-400 shadow-sm'
                          : 'text-slate-400'
                      }
                    >
                      {sys ? sys.bin || '—' : '—'}
                    </span>
                  </td>

                  {/* Trạng thái */}
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold shadow-sm ${
                        isDuplicate ? STATUS_CLASS.duplicate : STATUS_CLASS[r.status]
                      }`}
                    >
                      {isDuplicate ? STATUS_LABEL.duplicate : STATUS_LABEL[r.status]}
                      {r.resolution ? ` · ${r.resolution === 'appended' ? 'ghi thêm' : 'đổi vị trí'}` : ''}
                    </span>
                  </td>

                  {/* Kiểm kê (Bảng 3): Tag đã kiểm kê khớp thì đánh dấu để loại trừ dần */}
                  <td className="px-3 py-2.5 text-center">
                    {showChecked ? (
                      <span
                        data-testid={`recon-checked-${r.id}`}
                        title="Tag này đã kiểm kê khớp cả Bảng 1 & Bảng 2 ở Bảng 3 — có thể loại trừ"
                        className="inline-flex items-center gap-1 rounded-full border border-teal-500/50 bg-teal-500/20 px-2 py-0.5 text-[10px] font-extrabold text-teal-300 shadow-sm"
                      >
                        📦 Đã KK
                      </span>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>

                  {/* Ghi chú cảnh báo (màu đỏ nếu chênh lệch hoặc trùng quét) */}
                  <td className="px-3 py-2.5 text-left text-[11px]">
                    {lockHolder ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-950/60 px-2 py-0.5 font-bold text-amber-300"
                        title={`${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới`}
                      >
                        🔒 {lockHolder.name} đang thao tác
                      </span>
                    ) : isDuplicate || isMissingSys || isQtyDiff || isBinDiff || r.status === 'qty_mismatch' || r.status === 'bin_mismatch' ? (
                      <span className="text-rose-400 font-bold">{note}</span>
                    ) : r.status === 'ok' && !isMissingSys ? (
                      <span className="text-emerald-400 font-semibold">{note}</span>
                    ) : (
                      <span className="text-amber-300/90 font-medium">{note}</span>
                    )}
                  </td>

                  {/* Thao tác: công tắc 7055 + sửa Tag ID / xóa khi nhập nhầm */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(sys?.tag_7055)}
                        onClick={() => void handleToggle7055(r)}
                        disabled={!sys || Boolean(lockHolder) || toggling7055Id === r.id}
                        title={
                          !sys
                            ? 'Tag chưa có trong nguồn nên không gắn nhãn 7055 được'
                            : lockHolder
                              ? `${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới`
                              : toggling7055Id === r.id
                                ? 'Đang đổi nhãn 7055...'
                                : sys.tag_7055
                                  ? 'Tắt nhãn 7055 cho Tag này (Bảng 2 đồng bộ theo)'
                                  : 'Bật nhãn 7055 cho Tag này (Bảng 2 đồng bộ theo)'
                        }
                        aria-label={`Công tắc 7055 cho ${r.batch_id}`}
                        data-testid={`toggle-7055-${r.id}`}
                        className={`rounded-lg border px-1.5 py-1 text-[11px] font-extrabold leading-none transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${
                          sys?.tag_7055
                            ? 'border-purple-500/60 bg-purple-500/25 text-purple-200 shadow-sm hover:bg-purple-500/40'
                            : 'border-transparent text-slate-500 hover:border-purple-500/40 hover:text-purple-300'
                        }`}
                      >
                        {toggling7055Id === r.id ? '⏳' : '🏷️'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        disabled={Boolean(lockHolder)}
                        title={lockHolder ? `${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới` : 'Chỉnh sửa Tag ID'}
                        aria-label={`Chỉnh sửa Tag ID ${r.batch_id}`}
                        className="rounded-lg border border-transparent p-1.5 text-slate-400 transition hover:border-cyan-500/40 hover:bg-cyan-950/60 hover:text-cyan-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => openDeleteModal(r)}
                        disabled={Boolean(lockHolder)}
                        title={lockHolder ? `${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới` : 'Xóa lượt quét nhầm'}
                        aria-label={`Xóa lượt quét ${r.batch_id}`}
                        className="rounded-lg border border-transparent p-1.5 text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-950/60 hover:text-rose-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer thanh trạng thái: đếm dòng + tải tiếp + lối tắt trượt xuống Bảng 2 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-slate-400">
        <span>
          Đang hiển thị <strong className="text-cyan-300">{displayedRows.length}</strong> /{' '}
          <strong className="text-white">{filteredRows.length}</strong> lượt quét
          {filteredRows.length !== rows.length && (
            <span className="text-slate-500"> (Tổng {rows.length})</span>
          )}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {visibleCount < filteredRows.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length))}
              className="font-bold text-indigo-400 hover:text-indigo-300 transition underline"
            >
              Cuộn xuống hoặc bấm tải tiếp 100 dòng (còn {filteredRows.length - visibleCount} dòng)
            </button>
          )}
          <button
            type="button"
            onClick={() => smoothScrollToElementById('bang-2')}
            title="Trượt nhanh xuống Bảng 2 — dữ liệu file nguồn (phím ↓)"
            aria-label="Trượt nhanh xuống Bảng 2"
            data-testid="btn-goto-table2"
            className="rounded-xl border border-cyan-500/40 bg-cyan-950/60 px-3 py-1.5 font-bold text-cyan-300 shadow-sm transition hover:bg-cyan-900 active:scale-95"
          >
            ⬇ Bảng 2
          </button>
        </div>
      </div>

      {/* Modal UI nổi xác nhận xóa khi nhập nhầm */}
      {deletingRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-rose-500/50 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h3 id="confirm-delete-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Xác Nhận Xóa Lượt Quét
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                    Xóa dữ liệu do nhập nhầm
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => closeDeleteModal()}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              <p className="text-slate-300">
                Bạn có chắc chắn muốn xóa lượt quét này? Dữ liệu sẽ được loại bỏ khỏi hệ thống và đối chiếu lại ngay lập tức.
              </p>

              {/* Chi tiết lượt quét */}
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng:</span>
                  <span className="font-bold text-slate-200">{deletingRow.stock_code || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID:</span>
                  <span className="font-bold text-cyan-300">{deletingRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng:</span>
                  <span className="font-bold text-white">{deletingRow.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vị trí Bin:</span>
                  <span className="font-bold text-emerald-300">{deletingRow.bin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Trạng thái:</span>
                  <span className="font-bold text-amber-300">{STATUS_LABEL[deletingRow.status]}</span>
                </div>
              </div>

              {deleteNotice && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {deleteNotice}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => closeDeleteModal()}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="rounded-xl bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
              >
                {isDeleting ? 'Đang xóa...' : '🗑️ Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal UI nổi chỉnh sửa Tag ID */}
      {editingRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-tag-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-cyan-500/50 bg-slate-950 p-6 shadow-2xl">
            {/* Tiêu đề modal */}
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✏️</span>
                <div>
                  <h3 id="edit-tag-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Chỉnh Sửa Tag ID, Số Lượng &amp; Vị Trí Quét
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                    Sửa Tag ID, Số lượng hoặc Vị trí quét do quét hoặc nhập nhầm
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingTag}
                onClick={() => closeEditModal()}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Form chỉnh sửa */}
            <form onSubmit={handleConfirmEdit} className="my-4 space-y-4 text-xs">
              {/* Thông tin lượt quét hiện tại */}
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID hiện tại:</span>
                  <span className="font-bold text-slate-200">{editingRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vị trí Bin quét:</span>
                  <span className="font-bold text-emerald-300">{editingRow.bin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng quét hiện tại:</span>
                  <span className="font-bold text-white">{editingRow.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Trạng thái hiện tại:</span>
                  <span className="font-bold text-amber-300">{STATUS_LABEL[editingRow.status]}</span>
                </div>
              </div>

              {/* Hàng nhập Tag ID, Số lượng và Vị trí quét mới */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Ô nhập Tag ID mới */}
                <div>
                  <label htmlFor="edit-new-tag-input" className="block text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-1">
                    Tag ID:
                  </label>
                  <input
                    id="edit-new-tag-input"
                    type="text"
                    autoFocus
                    value={newTagId}
                    onChange={(e) => setNewTagId(e.target.value)}
                    placeholder="Nhập Tag ID chính xác..."
                    className="w-full rounded-xl border border-cyan-500/40 bg-black/50 p-2.5 font-mono text-xs font-bold uppercase text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>

                {/* Ô nhập Số lượng quét mới */}
                <div>
                  <label htmlFor="edit-new-qty-input" className="block text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-1">
                    Số lượng quét:
                  </label>
                  <input
                    id="edit-new-qty-input"
                    aria-label="Số lượng quét mới"
                    type="number"
                    min={0}
                    step="any"
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    placeholder="Nhập số lượng..."
                    className="w-full rounded-xl border border-cyan-500/40 bg-black/50 p-2.5 font-mono text-xs font-bold text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>

                {/* Ô nhập Vị trí (Bin) quét mới — sửa nhanh ngay trong Bảng 1 */}
                <div className="sm:col-span-2">
                  <label htmlFor="edit-new-bin-input" className="block text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-1">
                    Vị trí (Bin) quét:
                  </label>
                  <input
                    id="edit-new-bin-input"
                    aria-label="Vị trí Bin quét mới"
                    type="text"
                    value={editBin}
                    onChange={(e) => setEditBin(e.target.value)}
                    placeholder="Nhập vị trí Bin quét..."
                    className="w-full rounded-xl border border-cyan-500/40 bg-black/50 p-2.5 font-mono text-xs font-bold uppercase text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
                  />
                </div>
              </div>

              {/* Tra cứu tức thì trong file nguồn */}
              {newTagId.trim() && (
                (() => {
                  const matchedSys = systemByBatch.get(newTagId.trim());
                  if (matchedSys) {
                    return (
                      <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-2.5 text-[11px] text-emerald-300">
                        <p className="font-bold flex items-center gap-1.5">
                          <span>✓</span> Khớp dữ liệu nguồn hệ thống
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-slate-300">
                          <span>Mã hàng: <strong className="text-white">{matchedSys.stock_code}</strong></span>
                          <span>Vị trí: <strong className="text-white">{matchedSys.bin || '—'}</strong></span>
                          <span>SL nguồn: <strong className="text-white">{matchedSys.qty}</strong></span>
                        </div>
                      </div>
                    );
                  } else {
                    return (
                      <div className="space-y-2">
                        <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-2.5 text-[11px] text-amber-300">
                          <p className="font-bold flex items-center gap-1.5">
                            <span>⚠️</span> Tag ID không có trong file nguồn
                          </p>
                          <p className="mt-0.5 text-[10px] text-slate-400">
                            Trạng thái sau khi cập nhật sẽ là &quot;Ngoài hệ thống&quot;. Bạn có thể điền mã hàng (Stock Code) bên dưới nếu cần.
                          </p>
                        </div>
                        <div>
                          <label htmlFor="edit-stock-code-input" className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                            Mã hàng (Stock Code) tùy chọn:
                          </label>
                          <input
                            id="edit-stock-code-input"
                            type="text"
                            value={manualStockCode}
                            onChange={(e) => setManualStockCode(e.target.value)}
                            placeholder="Nhập mã hàng nếu có..."
                            className="w-full rounded-xl border border-white/10 bg-black/50 p-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    );
                  }
                })()
              )}

              {editNotice && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {editNotice}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  disabled={isSavingTag}
                  onClick={() => closeEditModal()}
                  className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSavingTag || !newTagId.trim() || editQty.trim() === '' || !editBin.trim()}
                  className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-cyan-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
                >
                  {isSavingTag ? 'Đang lưu...' : '💾 Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
