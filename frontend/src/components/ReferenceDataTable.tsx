// ReferenceDataTable — Bảng 2: dữ liệu hệ thống đã import (Plan.md §7.3).
// Hiển thị đầy đủ tất cả các trường dữ liệu như trong file nguồn (Stock Code, Batch, Warehouse, Bin, Qty, Ngày tạo).
// Lấy toàn bộ dữ liệu từ Supabase qua phân trang range (không bị chặn ở mốc 1000 dòng).
// Bộ lọc thông minh: tự động dò tìm mọi trường, riêng Kho cần thêm tiền tố 'WH' (vd WH01, WH50).
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import ReferenceImportCard from './ReferenceImportCard';

export interface ReferenceLine {
  batch_id: string;
  stock_code: string;
  warehouse: string;
  bin: string;
  qty: number;
  previous_qty?: number | null;
  create_date?: string | null;
}

interface ReferenceDataTableProps {
  onQtyUpdated?: (batchId: string, newQty: number) => void;
}

export default function ReferenceDataTable({ onQtyUpdated }: ReferenceDataTableProps = {}) {
  const [rows, setRows] = useState<ReferenceLine[]>([]);
  const [smartFilter, setSmartFilter] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [bin, setBin] = useState('');
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(100);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Trạng thái modal chỉnh sửa số lượng (không có nút xóa)
  const [editingRow, setEditingRow] = useState<ReferenceLine | null>(null);
  const [editQtyInput, setEditQtyInput] = useState('');
  const [isSavingQty, setIsSavingQty] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function openEditModal(row: ReferenceLine) {
    setEditingRow(row);
    setEditQtyInput(String(row.qty));
    setEditError(null);
  }

  async function handleSaveQty() {
    if (!editingRow) return;
    const newQ = Number(editQtyInput);
    if (isNaN(newQ) || newQ < 0) {
      setEditError('Số lượng phải là một số không âm hợp lệ');
      return;
    }
    setIsSavingQty(true);
    setEditError(null);
    try {
      const { data, error } = await supabase.rpc('update_reference_qty', {
        p_batch_id: editingRow.batch_id,
        p_new_qty: newQ,
      });
      if (error || !data?.ok) {
        setEditError(`Lỗi cập nhật: ${error?.message || data?.error || 'Không xác định'}`);
      } else {
        const oldQ = editingRow.qty;
        setRows((prev) =>
          prev.map((r) =>
            r.batch_id === editingRow.batch_id
              ? { ...r, qty: newQ, previous_qty: oldQ }
              : r,
          ),
        );
        onQtyUpdated?.(editingRow.batch_id, newQ);
        setEditingRow(null);
      }
    } catch (e) {
      setEditError(`Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSavingQty(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const step = 1000;
      let from = 0;
      const all: ReferenceLine[] = [];
      while (!cancelled) {
        let q = supabase
          .from('reference_stock')
          .select('batch_id,stock_code,warehouse,bin,qty,previous_qty,create_date')
          .order('stock_code', { ascending: true });

        if (warehouse.trim()) {
          const cleanWh = warehouse.trim().replace(/^wh[\s:-]*/i, '');
          q = q.eq('warehouse', cleanWh);
        }
        if (bin.trim()) {
          q = q.eq('bin', bin.trim());
        }

        const res = await (q.range ? q.range(from, from + step - 1) : q);
        const data = res?.data;
        const error = res?.error;
        if (cancelled || error || !data || (data as unknown[]).length === 0) break;
        all.push(...(data as ReferenceLine[]));
        if ((data as unknown[]).length < step || !q.range) break;
        from += step;
      }
      if (cancelled) return;
      setRows(all);
      setVisibleCount(100);
      setLoading(false);
    }
    void load();

    return () => {
      cancelled = true;
    };
  }, [warehouse, bin, refreshTrigger]);

  // Bộ lọc thông minh:
  // "bộ lọc phải được thiết lập thông minh khi lọc stock code hoặc bất kì trường nào trong bảng
  // sẽ được tự động dò tìm theo đúng trường dữ liệu đó riêng WH sẽ phải thêm WH ở trước sau đó điền theo dữ liệu trong bảng mới lọc được"
  const filteredRows = useMemo(() => {
    if (!smartFilter.trim()) return rows;
    const term = smartFilter.trim();

    // Nếu bắt đầu bằng WH (case-insensitive): dò tìm theo Warehouse
    if (/^wh/i.test(term)) {
      const whTerm = term.replace(/^wh[\s:-]*/i, '').toLowerCase();
      return rows.filter((r) => r.warehouse.toLowerCase().includes(whTerm));
    }

    // Các trường hợp khác: tự động dò tìm theo Stock Code, Batch/Tag ID, Bin, Qty, Ngày tạo
    const lower = term.toLowerCase();
    return rows.filter((r) => {
      return (
        r.stock_code.toLowerCase().includes(lower) ||
        r.batch_id.toLowerCase().includes(lower) ||
        r.bin.toLowerCase().includes(lower) ||
        String(r.qty).includes(lower) ||
        (r.create_date ? r.create_date.toLowerCase().includes(lower) : false)
      );
    });
  }, [rows, smartFilter]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visibleCount < filteredRows.length) {
      setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length));
    }
  }

  const displayedRows = filteredRows.slice(0, visibleCount);
  const isWhFilterActive = /^wh/i.test(smartFilter.trim());
  const activeWhQuery = isWhFilterActive ? smartFilter.trim().replace(/^wh[\s:-]*/i, '') : '';

  function formatDate(dStr?: string | null) {
    if (!dStr) return '—';
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return dStr;
      return d.toLocaleDateString('vi-VN');
    } catch {
      return dStr;
    }
  }

  return (
    <section aria-label="Dữ liệu hệ thống" className="flex flex-col gap-4">
      {/* Thẻ Import file nguồn */}
      <ReferenceImportCard onImportSuccess={() => setRefreshTrigger((prev) => prev + 1)} />

      {/* Bảng dữ liệu nguồn tra cứu */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 sm:p-5 shadow-lg">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex items-center gap-2">
                <span>📂</span> Bảng 2 — Dữ liệu file nguồn ({rows.length.toLocaleString()} dòng)
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Hiển thị đầy đủ thông tin tồn kho gốc: Stock Code, Tag ID (Batch), Kho, Bin, Số lượng và Ngày tạo.
              </p>
            </div>
          </div>

          {/* Hàng bộ lọc: Bộ lọc thông minh & Lọc kho / vị trí */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {/* Bộ lọc thông minh chính */}
            <div className="relative md:col-span-1">
              <input
                aria-label="Tìm kiếm thông minh"
                type="text"
                value={smartFilter}
                onChange={(e) => {
                  setSmartFilter(e.target.value);
                  setVisibleCount(100);
                }}
                placeholder="🔍 Dò tìm (Mã, Tag, Bin... hoặc WH01 lọc kho)"
                className="w-full rounded-xl border border-indigo-500/40 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
              {isWhFilterActive && (
                <span className="absolute right-2 top-2.5 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  Kho: {activeWhQuery || 'Tất cả'}
                </span>
              )}
            </div>

            {/* Lọc theo kho */}
            <div>
              <input
                aria-label="Lọc theo kho"
                type="text"
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                placeholder="Lọc theo kho (vd WH01 hoặc 01)"
                className="w-full rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Lọc theo vị trí */}
            <div>
              <input
                aria-label="Lọc theo vị trí"
                type="text"
                value={bin}
                onChange={(e) => setBin(e.target.value)}
                placeholder="Lọc theo vị trí (vd C4)"
                className="w-full rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-slate-400">⏳ Đang tải toàn bộ dữ liệu nguồn từ hệ thống...</p>
        ) : filteredRows.length === 0 ? (
          <p data-testid="ref-empty" className="p-6 text-center text-sm text-slate-500">
            Không có dòng nào khớp với bộ lọc.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              onScroll={handleScroll}
              className="max-h-[440px] overflow-y-auto overflow-x-auto rounded-xl border border-white/10 bg-black/30 custom-scrollbar"
            >
              <table className="w-full min-w-[700px] text-left font-mono text-xs">
                <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 border-b border-white/10 shadow">
                  <tr>
                    <th className="px-3 py-2.5">STOCK CODE</th>
                    <th className="px-3 py-2.5">TAG ID (BATCH)</th>
                    <th className="px-3 py-2.5">KHO</th>
                    <th className="px-3 py-2.5 text-right">BIN</th>
                    <th className="px-3 py-2.5 text-right">SỐ LƯỢNG</th>
                    <th className="px-3 py-2.5 text-center">NGÀY TẠO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayedRows.map((r, i) => (
                    <tr key={`${r.batch_id}-${i}`} className="hover:bg-white/5 transition-colors">
                      <td className="px-3 py-2 font-bold text-slate-200">{r.stock_code}</td>
                      <td className="px-3 py-2 font-bold text-cyan-300">{r.batch_id}</td>
                      <td className="px-3 py-2 text-slate-300">{r.warehouse}</td>
                      <td className="px-3 py-2 text-right font-semibold text-emerald-300">{r.bin}</td>

                      {/* Số lượng mới kèm note số lượng cũ gần nhất tại cùng vị trí + nút Sửa (không có nút xóa) */}
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="text-right">
                            <span className="font-bold text-white text-xs">{r.qty}</span>
                            {r.previous_qty !== null && r.previous_qty !== undefined && (
                              <span className="block text-[10px] font-medium text-amber-400/90">
                                (cũ: {r.previous_qty})
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => openEditModal(r)}
                            title="Chỉnh sửa số lượng"
                            aria-label={`Chỉnh sửa số lượng ${r.batch_id}`}
                            className="rounded-lg border border-white/10 bg-white/5 p-1 text-slate-400 transition hover:border-cyan-500/40 hover:bg-cyan-950/60 hover:text-cyan-300 active:scale-95"
                          >
                            ✏️
                          </button>
                        </div>
                      </td>

                      <td className="px-3 py-2 text-center text-slate-400 text-[11px]">{formatDate(r.create_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer thanh cuộn thông báo */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-slate-400">
              <span>
                Đang hiển thị <strong className="text-cyan-300">{displayedRows.length}</strong> /{' '}
                <strong className="text-white">{filteredRows.length.toLocaleString()}</strong> dòng
                {filteredRows.length !== rows.length && (
                  <span className="text-slate-500"> (Tổng nguồn: {rows.length.toLocaleString()} dòng)</span>
                )}
              </span>
              {visibleCount < filteredRows.length && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length))}
                  className="font-bold text-indigo-400 hover:text-indigo-300 transition underline"
                >
                  Cuộn xuống hoặc bấm tải tiếp 100 dòng (còn {(filteredRows.length - visibleCount).toLocaleString()} dòng)
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modal UI nổi chỉnh sửa số lượng Bảng 2 */}
      {editingRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-qty-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-cyan-500/50 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✏️</span>
                <div>
                  <h3 id="edit-qty-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Chỉnh Sửa Số Lượng Nguồn
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                    Cập nhật số lượng đồng bộ Supabase
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingQty}
                onClick={() => setEditingRow(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              {/* Thông tin mặt hàng */}
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng (Stock Code):</span>
                  <span className="font-bold text-slate-200">{editingRow.stock_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID (Batch):</span>
                  <span className="font-bold text-cyan-300">{editingRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kho / Vị trí:</span>
                  <span className="font-bold text-emerald-300">{editingRow.warehouse} / {editingRow.bin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng hiện tại:</span>
                  <span className="font-bold text-white text-xs">
                    {editingRow.qty}
                    {editingRow.previous_qty !== null && editingRow.previous_qty !== undefined && (
                      <span className="ml-2 font-normal text-amber-400">(cũ: {editingRow.previous_qty})</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Ô nhập số lượng mới */}
              <div>
                <label htmlFor="edit-new-qty-input" className="mb-1.5 block font-bold uppercase tracking-wider text-cyan-400 text-[11px]">
                  Số lượng mới:
                </label>
                <input
                  id="edit-new-qty-input"
                  type="number"
                  min={0}
                  step="any"
                  value={editQtyInput}
                  disabled={isSavingQty}
                  onChange={(e) => setEditQtyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveQty();
                  }}
                  autoFocus
                  className="w-full rounded-xl border-2 border-cyan-500/50 bg-black/70 p-3 text-center font-mono text-xl font-bold text-cyan-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                  placeholder="Nhập số lượng mới..."
                />
              </div>

              <p className="text-[11px] text-slate-400 italic">
                * Sau khi lưu, số lượng hiện tại ({editingRow.qty}) sẽ được note lại là số lượng cũ gần nhất ngay tại cột Số lượng.
              </p>

              {editError && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {editError}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                disabled={isSavingQty}
                onClick={() => setEditingRow(null)}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isSavingQty}
                onClick={() => void handleSaveQty()}
                className="rounded-xl bg-gradient-to-r from-cyan-600 via-teal-600 to-emerald-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-cyan-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
              >
                {isSavingQty ? 'Đang lưu...' : '💾 Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
