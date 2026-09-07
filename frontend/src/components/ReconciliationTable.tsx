// ReconciliationTable — Bảng 1: dữ liệu quét thực tế & đối chiếu (Plan.md §7.2).
// Cột: Stock code, Tag id, Số lượng, Bin, Số lượng hệ thống, Bin hệ thống, Trạng thái & Ghi chú cảnh báo.
// Hỗ trợ cuộn chuột 100 dòng tự động tải tiếp (Infinite Scroll / Virtualization Chunking).
import React, { useState } from 'react';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import type { ScanStatus } from '../lib/scanApi';
import { supabase } from '../lib/supabase';
import type { ScanRow } from '../lib/types';

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
}

export default function ReconciliationTable({ rows, systemByBatch, onRowDeleted, onRowUpdated }: ReconciliationTableProps) {
  const [visibleCount, setVisibleCount] = useState(100);
  const [statusFilter, setStatusFilter] = useState<'all' | ScanStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [deletingRow, setDeletingRow] = useState<ScanRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  // State cho modal chỉnh sửa Tag ID & Số lượng quét
  const [editingRow, setEditingRow] = useState<ScanRow | null>(null);
  const [newTagId, setNewTagId] = useState('');
  const [editQty, setEditQty] = useState('');
  const [manualStockCode, setManualStockCode] = useState('');
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);

  function openEditModal(r: ScanRow) {
    setEditingRow(r);
    setNewTagId(r.batch_id);
    setEditQty(String(r.qty));
    const sys = systemByBatch.get(r.batch_id);
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
    setIsSavingTag(true);
    setEditNotice(null);
    try {
      const { data, error } = await supabase.rpc('update_scanned_tag_id', {
        p_id: editingRow.id,
        p_new_batch_id: cleanTag,
        p_stock_code: manualStockCode.trim() || null,
        p_new_qty: cleanQty,
      });
      if (error || !data?.ok) {
        setEditNotice(`❌ Lỗi cập nhật: ${error?.message || data?.error || 'Không xác định'}`);
      } else {
        onRowUpdated?.();
        setEditingRow(null);
      }
    } catch (err) {
      setEditNotice(`❌ Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSavingTag(false);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingRow) return;
    setIsDeleting(true);
    setDeleteNotice(null);
    try {
      const { data, error } = await supabase.rpc('delete_scanned_row', { p_id: deletingRow.id });
      if (error || !data?.ok) {
        setDeleteNotice(`❌ Lỗi xóa: ${error?.message || data?.error || 'Không xác định'}`);
      } else {
        onRowDeleted?.(deletingRow.id);
        setDeletingRow(null);
      }
    } catch (e) {
      setDeleteNotice(`❌ Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeleting(false);
    }
  }

  // Lọc theo trạng thái và từ khóa tìm kiếm (kèm chống duplicate key)
  const filteredRows = React.useMemo(() => {
    const seenIds = new Set<string>();
    return rows.filter((r) => {
      if (r?.id) {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
      }
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        const sys = systemByBatch.get(r.batch_id);
        const sc = (r.stock_code ?? sys?.stock_code ?? '').toLowerCase();
        const tag = r.batch_id.toLowerCase();
        const bin = r.bin.toLowerCase();
        if (!sc.includes(term) && !tag.includes(term) && !bin.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [rows, statusFilter, searchTerm, systemByBatch]);

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
      </div>

      <div
        onScroll={handleScroll}
        className="max-h-[500px] overflow-y-auto overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/80 shadow-inner custom-scrollbar"
      >
        <table className="w-full min-w-[760px] text-left font-mono text-xs">
          <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-950 text-slate-400 shadow">
            <tr>
              <th className="px-3 py-3">STOCK CODE</th>
              <th className="px-3 py-3">TAG ID</th>
              <th className="px-3 py-3 text-right">SL QUÉT</th>
              <th className="px-3 py-3 text-right">SL HỆ THỐNG</th>
              <th className="px-3 py-3 text-right">BIN QUÉT</th>
              <th className="px-3 py-3 text-right">BIN HỆ THỐNG</th>
              <th className="px-3 py-3 text-center">TRẠNG THÁI</th>
              <th className="px-3 py-3 text-left">GHI CHÚ / CẢNH BÁO</th>
              <th className="px-3 py-3 text-center">THAO TÁC</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {displayedRows.map((r) => {
              const sys = systemByBatch.get(r.batch_id);
              const isQtyDiff = sys && Number(sys.qty) !== Number(r.qty);
              const isBinDiff = sys && sys.bin !== r.bin;
              const stockCode = r.stock_code ?? sys?.stock_code ?? '—';

              // Ghi chú chi tiết cho dòng
              let note = '';
              if (r.status === 'ok') {
                note = 'Khớp hoàn toàn';
              } else if (r.status === 'qty_mismatch') {
                note = `Lệch số lượng (Quét: ${r.qty} / Nguồn: ${sys?.qty ?? '—'})`;
              } else if (r.status === 'bin_mismatch') {
                note = `Lệch vị trí (Quét: ${r.bin} / Nguồn: ${sys?.bin ?? '—'})`;
              } else if (r.status === 'not_in_reference') {
                note = 'Tag ID không có trong file nguồn';
              } else if (r.status === 'duplicate') {
                note = `Trùng Tag ID (${r.resolution === 'appended' ? 'Đã ghi thêm' : 'Đã đổi vị trí'})`;
              }

              return (
                <tr
                  key={r.id}
                  data-testid={`recon-row-${r.id}`}
                  className={`hover:bg-white/5 transition-colors ${
                    r.status === 'duplicate' ? 'duplicate-alert' : ''
                  }`}
                >
                  {/* Stock Code */}
                  <td className="px-3 py-2.5 font-bold text-slate-200">{stockCode}</td>

                  {/* Tag ID (bấm để sửa hoặc dùng nút ở cột Thao tác) */}
                  <td className="px-3 py-2.5 font-bold text-cyan-300">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        title="Bấm để chỉnh sửa Tag ID"
                        className="hover:underline hover:text-cyan-200 transition text-left font-bold"
                      >
                        {r.batch_id}
                      </button>
                      {Boolean(sys?.tag_7055) && (
                        <span
                          data-testid={`recon-tag-7055-${r.batch_id}`}
                          title="Tag in thêm 7055"
                          className="inline-flex items-center gap-1 rounded-full border border-purple-500/50 bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-purple-300 shadow-sm"
                        >
                          <span>🏷️ 7055</span>
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Số lượng quét (bấm để chỉnh sửa hoặc dùng nút ở cột Thao tác) */}
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => openEditModal(r)}
                      title="Bấm để chỉnh sửa lượt quét"
                      className="hover:underline transition text-right font-bold inline-block"
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

                  {/* Bin quét (màu đỏ cảnh báo nếu sai lệch) */}
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className={
                        isBinDiff
                          ? 'inline-block rounded border border-rose-500/60 bg-rose-950/60 px-2 py-0.5 font-bold text-rose-400 shadow-sm'
                          : 'font-semibold text-slate-200'
                      }
                    >
                      {r.bin}
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
                        STATUS_CLASS[r.status]
                      }`}
                    >
                      {STATUS_LABEL[r.status]}
                      {r.resolution ? ` · ${r.resolution === 'appended' ? 'ghi thêm' : 'đổi vị trí'}` : ''}
                    </span>
                  </td>

                  {/* Ghi chú cảnh báo (màu đỏ nếu chênh lệch) */}
                  <td className="px-3 py-2.5 text-left text-[11px]">
                    {r.status === 'ok' ? (
                      <span className="text-emerald-400 font-semibold">{note}</span>
                    ) : isQtyDiff || isBinDiff || r.status === 'qty_mismatch' || r.status === 'bin_mismatch' ? (
                      <span className="text-rose-400 font-bold">{note}</span>
                    ) : (
                      <span className="text-amber-300/90 font-medium">{note}</span>
                    )}
                  </td>

                  {/* Thao tác sửa Tag ID / xóa khi nhập nhầm */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        title="Chỉnh sửa Tag ID"
                        aria-label={`Chỉnh sửa Tag ID ${r.batch_id}`}
                        className="rounded-lg border border-transparent p-1.5 text-slate-400 transition hover:border-cyan-500/40 hover:bg-cyan-950/60 hover:text-cyan-300 active:scale-95"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteNotice(null);
                          setDeletingRow(r);
                        }}
                        title="Xóa lượt quét nhầm"
                        aria-label={`Xóa lượt quét ${r.batch_id}`}
                        className="rounded-lg border border-transparent p-1.5 text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-950/60 hover:text-rose-300 active:scale-95"
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

      {/* Footer thanh cuộn thông báo */}
      <div className="flex items-center justify-between px-2 text-[11px] text-slate-400">
        <span>
          Đang hiển thị <strong className="text-cyan-300">{displayedRows.length}</strong> /{' '}
          <strong className="text-white">{filteredRows.length}</strong> lượt quét
          {filteredRows.length !== rows.length && (
            <span className="text-slate-500"> (Tổng {rows.length})</span>
          )}
        </span>
        {visibleCount < filteredRows.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length))}
            className="font-bold text-indigo-400 hover:text-indigo-300 transition underline"
          >
            Cuộn xuống hoặc bấm tải tiếp 100 dòng (còn {filteredRows.length - visibleCount} dòng)
          </button>
        )}
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
                onClick={() => setDeletingRow(null)}
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
                onClick={() => setDeletingRow(null)}
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
                    Chỉnh Sửa Tag ID &amp; Số Lượng Quét
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                    Sửa Tag ID hoặc Số lượng quét do quét hoặc nhập nhầm
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingTag}
                onClick={() => setEditingRow(null)}
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

              {/* Hàng nhập Tag ID và Số lượng quét mới */}
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
                  onClick={() => setEditingRow(null)}
                  className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSavingTag || !newTagId.trim() || editQty.trim() === ''}
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
