// InventoryTable — Bảng 3 kiểm kê full nằm cuối trang (theo dõi trực tiếp).
// Cột: STOCK CODE | TAG ID | BIN KK | SL KK | BIN B1 | SL B1 | BIN HT (B2) |
// SL HT (B2) | Cảnh báo đối chiếu chéo | Xóa. Nút Quét Kiểm Kê mở modal,
// nút Export XLSX xuất toàn bảng. Bảng streaming nhỏ trong modal giữ nguyên
// chỉ để theo dõi trong lúc quét.
import React, { useState } from 'react';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import { downloadInventoryExcel } from '../lib/exportExcel';
import { compareInventoryRow } from '../lib/inventoryCompare';
import { deleteInventoryRow, updateInventoryRow } from '../lib/inventoryApi';
import type { InventoryRow, ScanRow } from '../lib/types';

interface InventoryTableProps {
  inventoryRows: InventoryRow[];
  scannedRows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
  onOpenScan: () => void;
  onChanged?: () => void;
  /** Tên hiển thị để ghi nhật ký hoạt động — optional để test cũ vẫn chạy. */
  actorName?: string | null;
}

export default function InventoryTable({
  inventoryRows,
  scannedRows,
  systemByBatch,
  onOpenScan,
  onChanged,
  actorName,
}: InventoryTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);

  // Modal xác nhận xóa (custom, giống Bảng 1 — không dùng window.confirm
  // native khó bấm trên PDA).
  const [deletingRow, setDeletingRow] = useState<InventoryRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  // Modal chỉnh sửa lượt kiểm kê (giống modal sửa Bảng 1/Bảng 2):
  // Quy tắc nghiệp vụ: Bảng 3 chỉ được sửa SL KK và Bin KK
  // (Tag ID / Stock Code không được sửa — hiển thị read-only).
  const [editingRow, setEditingRow] = useState<InventoryRow | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editBin, setEditBin] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editNotice, setEditNotice] = useState<string | null>(null);

  const uniqueRows = React.useMemo(
    () => inventoryRows.filter((r, idx, arr) => arr.findIndex((x) => x.id === r.id) === idx),
    [inventoryRows],
  );

  const compared = React.useMemo(
    () =>
      uniqueRows.map((r) => ({
        row: r,
        cmp: compareInventoryRow(r, scannedRows, systemByBatch),
      })),
    [uniqueRows, scannedRows, systemByBatch],
  );

  const matchedCount = React.useMemo(() => compared.filter((c) => c.cmp.allMatch).length, [compared]);

  const filteredRows = React.useMemo(() => {
    let list = compared;
    if (mismatchOnly) list = list.filter((c) => !c.cmp.allMatch);
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter((c) => {
        const stock = (c.row.stock_code ?? c.cmp.systemStockCode ?? '').toLowerCase();
        return (
          stock.includes(term) ||
          (c.row.batch_id || '').toLowerCase().includes(term) ||
          (c.row.bin || '').toLowerCase().includes(term)
        );
      });
    }
    return list;
  }, [compared, mismatchOnly, searchTerm]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visibleCount < filteredRows.length) {
      setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length));
    }
  }

  function openDeleteModal(r: InventoryRow) {
    setDeletingRow(r);
    setDeleteNotice(null);
  }

  function closeDeleteModal() {
    setDeletingRow(null);
  }

  async function handleConfirmDelete() {
    if (!deletingRow) return;
    setIsDeleting(true);
    setDeleteNotice(null);
    const res = await deleteInventoryRow(deletingRow.id, actorName);
    setIsDeleting(false);
    if (!res.ok) {
      setDeleteNotice(`❌ Lỗi xóa: ${res.message}`);
      return;
    }
    onChanged?.();
    closeDeleteModal();
  }

  function openEditModal(r: InventoryRow) {
    setEditingRow(r);
    setEditQty(String(r.qty));
    setEditBin(r.bin);
    setEditNotice(null);
  }

  function closeEditModal() {
    setEditingRow(null);
  }

  async function handleConfirmEdit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!editingRow) return;
    const cleanQty = Number(editQty);
    if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
      setEditNotice('⚠️ Số lượng kiểm kê phải là một số hợp lệ (> 0).');
      return;
    }
    const cleanBin = editBin.trim();
    if (!cleanBin) {
      setEditNotice('⚠️ Vui lòng nhập Vị trí (Bin) kiểm kê hợp lệ (không được để trống).');
      return;
    }
    setIsSavingEdit(true);
    setEditNotice(null);
    const res = await updateInventoryRow(editingRow.id, cleanQty, cleanBin, actorName);
    setIsSavingEdit(false);
    if (!res.ok) {
      setEditNotice(`❌ Lỗi cập nhật: ${res.message}`);
      return;
    }
    onChanged?.();
    closeEditModal();
  }

  const displayedRows = filteredRows.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-3">
      {/* Thanh công cụ: tìm kiếm + lọc lệch + quét + export */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-white/10 bg-slate-900/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-full sm:w-64">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setVisibleCount(100);
              }}
              placeholder="🔍 Tìm Stock Code, Tag, Bin KK..."
              aria-label="Tìm kiếm bảng kiểm kê"
              className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setMismatchOnly((prev) => !prev);
              setVisibleCount(100);
            }}
            aria-pressed={mismatchOnly}
            aria-label="Chỉ hiện dòng kiểm kê lệch"
            title="Chỉ hiện dòng kiểm kê đang lệch vs Bảng 1 hoặc Bảng 2"
            className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-xs font-bold transition active:scale-95 ${
              mismatchOnly
                ? 'border-rose-500 bg-rose-500/25 text-rose-300 shadow-md shadow-rose-500/20'
                : 'border-white/10 bg-black/50 text-slate-400 hover:border-rose-500/40 hover:text-rose-300'
            }`}
          >
            <span>{mismatchOnly ? '✓' : '⚠️'}</span>
            <span>Chỉ hiện lệch ({compared.length - matchedCount})</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenScan}
            title="Mở modal quét kiểm kê (Bin → Tag → SL tay)"
            className="rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 py-2.5 px-4 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-amber-900/30 transition hover:opacity-95 active:scale-95"
          >
            📦 QUÉT KIỂM KÊ ({uniqueRows.length})
          </button>
          <button
            type="button"
            disabled={uniqueRows.length === 0}
            onClick={() => downloadInventoryExcel(uniqueRows, scannedRows, systemByBatch)}
            className="rounded-xl bg-emerald-600 py-2.5 px-4 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-40"
          >
            📥 EXPORT XLSX ({uniqueRows.length})
          </button>
        </div>
      </div>

      {uniqueRows.length === 0 ? (
        <div data-testid="inventory-empty" className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 text-center text-sm text-slate-400">
          <span className="text-xl">📦</span>
          <p className="mt-1 font-bold">Chưa có lượt kiểm kê nào.</p>
          <p className="text-xs text-slate-500">Bấm nút &quot;Quét Kiểm Kê&quot; ở trên để bắt đầu.</p>
        </div>
      ) : (
        <div
          onScroll={handleScroll}
          className="max-h-[500px] overflow-y-auto overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/80 shadow-inner custom-scrollbar"
        >
          <table className="w-full min-w-[900px] text-left font-mono text-xs">
            <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-950 text-slate-400 shadow">
              <tr>
                <th className="px-3 py-3">STOCK CODE</th>
                <th className="px-3 py-3">TAG ID</th>
                <th className="px-3 py-3 text-right">BIN KK</th>
                <th className="px-3 py-3 text-right">SL KK</th>
                <th className="px-3 py-3 text-right">BIN B1</th>
                <th className="px-3 py-3 text-right">SL B1</th>
                <th className="px-3 py-3 text-right">BIN HT (B2)</th>
                <th className="px-3 py-3 text-right">SL HT (B2)</th>
                <th className="px-3 py-3 text-left">CẢNH BÁO</th>
                <th className="px-3 py-3 text-center">THAO TÁC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayedRows.map(({ row: r, cmp }) => {
                const stockCode = r.stock_code ?? cmp.systemStockCode ?? '—';
                return (
                  <tr key={r.id} data-testid={`inventory-row-${r.id}`} className="hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2.5 font-bold text-slate-200">{stockCode}</td>
                    {/* Tag ID: read-only (quy tắc Bảng 3 chỉ sửa SL + Bin KK) */}
                    <td className="px-3 py-2.5 font-bold text-cyan-300">{r.batch_id}</td>
                    {/* Bin KK (bấm để sửa) */}
                    <td className="px-3 py-2.5 text-right text-white">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        title="Bấm để chỉnh sửa vị trí kiểm kê"
                        className="hover:underline transition font-semibold"
                      >
                        {r.bin}
                      </button>
                    </td>
                    {/* SL KK (bấm để sửa) */}
                    <td className="px-3 py-2.5 text-right font-bold text-white">
                      <button
                        type="button"
                        onClick={() => openEditModal(r)}
                        title="Bấm để chỉnh sửa số lượng kiểm kê"
                        className="hover:underline transition font-bold"
                      >
                        {r.qty}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-300">
                      {cmp.table1Bins.join(', ') || '—'}
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold ${cmp.table1Qty !== null && Number(r.qty) !== cmp.table1Qty ? 'text-rose-400' : 'text-slate-300'}`}>
                      {cmp.table1Qty ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-400">{cmp.table2Bin ?? '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-bold ${cmp.table2Qty !== null && Number(r.qty) !== cmp.table2Qty ? 'text-rose-400' : 'text-slate-400'}`}>
                      {cmp.table2Qty ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-left text-[11px]">
                      {cmp.allMatch ? (
                        <span className="font-semibold text-emerald-400">Khớp cả 2 bảng</span>
                      ) : (
                        <span className="font-bold text-rose-400">{cmp.warnings.join(' | ')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEditModal(r)}
                          title={`Chỉnh sửa số lượng kiểm kê ${r.batch_id}`}
                          aria-label={`Chỉnh sửa số lượng kiểm kê ${r.batch_id}`}
                          className="rounded-lg border border-transparent p-1.5 text-slate-400 transition hover:border-amber-500/40 hover:bg-amber-950/60 hover:text-amber-300 active:scale-95"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteModal(r)}
                          title={`Xóa dòng kiểm kê ${r.batch_id}`}
                          aria-label={`Xóa dòng kiểm kê ${r.batch_id}`}
                          className="rounded-lg p-1 text-slate-500 transition hover:bg-rose-950/60 hover:text-rose-300 disabled:opacity-40"
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
      )}

      {/* Footer: đếm dòng + tải tiếp */}
      {uniqueRows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-slate-400">
          <span>
            Đang hiển thị <strong className="text-cyan-300">{displayedRows.length}</strong> /{' '}
            <strong className="text-white">{filteredRows.length}</strong> lượt kiểm kê
            <span className="text-emerald-400"> (khớp {matchedCount})</span>
          </span>
          {visibleCount < filteredRows.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length))}
              className="font-bold text-indigo-400 hover:text-indigo-300 transition underline"
            >
              Tải tiếp 100 dòng (còn {filteredRows.length - visibleCount} dòng)
            </button>
          )}
        </div>
      )}

      {/* Modal UI nổi xác nhận xóa lượt kiểm kê (giống Bảng 1) */}
      {deletingRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-inventory-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-rose-500/50 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h3 id="confirm-delete-inventory-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Xác Nhận Xóa Lượt Kiểm Kê
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
                Bạn có chắc chắn muốn xóa lượt kiểm kê này? Dữ liệu sẽ được loại bỏ khỏi hệ thống và đối chiếu lại ngay lập tức.
              </p>

              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID:</span>
                  <span className="font-bold text-cyan-300">{deletingRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng:</span>
                  <span className="font-bold text-slate-200">{deletingRow.stock_code || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng KK:</span>
                  <span className="font-bold text-white">{deletingRow.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vị trí Bin KK:</span>
                  <span className="font-bold text-emerald-300">{deletingRow.bin}</span>
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

      {/* Modal UI nổi chỉnh sửa lượt kiểm kê (giống modal sửa Bảng 1) */}
      {editingRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-inventory-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-amber-500/50 bg-slate-950 p-6 shadow-2xl">
            {/* Tiêu đề modal */}
            <div className="flex items-center justify-between border-b border-amber-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✏️</span>
                <div>
                  <h3 id="edit-inventory-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Chỉnh Sửa Số Lượng &amp; Vị Trí Kiểm Kê
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                    Chỉ sửa SL và Bin KK do đếm hoặc nhập nhầm (Tag / Mã hàng không đổi)
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingEdit}
                onClick={() => closeEditModal()}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Form chỉnh sửa */}
            <form onSubmit={handleConfirmEdit} className="my-4 space-y-4 text-xs">
              {/* Thông tin lượt kiểm kê hiện tại (Tag / Bin / Mã hàng read-only) */}
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID:</span>
                  <span className="font-bold text-slate-200">{editingRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vị trí Bin KK:</span>
                  <span className="font-bold text-emerald-300">{editingRow.bin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng KK hiện tại:</span>
                  <span className="font-bold text-white">{editingRow.qty}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng:</span>
                  <span className="font-bold text-slate-200">{editingRow.stock_code || '—'}</span>
                </div>
              </div>

              {/* Ô nhập Số lượng KK + Vị trí Bin KK mới — 2 trường duy nhất được sửa */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-inventory-qty-input" className="block text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-1">
                    Số lượng KK mới:
                  </label>
                  <input
                    id="edit-inventory-qty-input"
                    aria-label="Số lượng kiểm kê mới"
                    type="number"
                    autoFocus
                    min={0}
                    step="any"
                    value={editQty}
                    onChange={(e) => setEditQty(e.target.value)}
                    placeholder="Nhập số lượng..."
                    className="w-full rounded-xl border border-amber-500/40 bg-black/50 p-2.5 font-mono text-xs font-bold text-amber-300 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div>
                  <label htmlFor="edit-inventory-bin-input" className="block text-[11px] font-bold uppercase tracking-wider text-amber-400 mb-1">
                    Vị trí (Bin) KK mới:
                  </label>
                  <input
                    id="edit-inventory-bin-input"
                    aria-label="Vị trí Bin kiểm kê mới"
                    type="text"
                    value={editBin}
                    onChange={(e) => setEditBin(e.target.value)}
                    placeholder="Nhập vị trí Bin..."
                    className="w-full rounded-xl border border-amber-500/40 bg-black/50 p-2.5 font-mono text-xs font-bold uppercase text-amber-300 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
              </div>

              {editNotice && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {editNotice}
                </p>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  disabled={isSavingEdit}
                  onClick={() => closeEditModal()}
                  className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-amber-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
                >
                  {isSavingEdit ? 'Đang lưu...' : '💾 Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
