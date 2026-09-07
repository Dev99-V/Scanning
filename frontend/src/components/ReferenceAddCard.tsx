// ReferenceAddCard — Thẻ hoạt động thêm dữ liệu nguồn mới vào Bảng 2.
// Hỗ trợ:
// - Stock Code: dropdown tự động gợi ý dữ liệu có sẵn trong bảng, gõ đến đâu gợi ý đến đó.
// - Kho (WH): dropdown tự động gợi ý các kho có trong bảng, gõ đến đâu gợi ý đến đó.
// - Ngày tạo: tự động chọn ngày hiện tại (ngày add).
// - Bin, Số lượng, Tag ID: bắt buộc nhập tay.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ReferenceLine } from './ReferenceDataTable';

interface ReferenceAddCardProps {
  existingRows: ReferenceLine[];
  onAddSuccess?: (newRow: ReferenceLine) => void;
}

export default function ReferenceAddCard({ existingRows, onAddSuccess }: ReferenceAddCardProps) {
  const [stockCode, setStockCode] = useState('');
  const [batchId, setBatchId] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [bin, setBin] = useState('');
  const [qty, setQty] = useState('');
  const [createDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [is7055, setIs7055] = useState(false);

  // Trạng thái gợi ý dropdown
  const [showStockDropdown, setShowStockDropdown] = useState(false);
  const [showWhDropdown, setShowWhDropdown] = useState(false);

  // Trạng thái gửi dữ liệu
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Trạng thái xác nhận ghi đè nếu trùng Tag ID
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const stockContainerRef = useRef<HTMLDivElement>(null);
  const whContainerRef = useRef<HTMLDivElement>(null);

  // Danh sách các Stock Code duy nhất từ bảng hiện có
  const allStockCodes = useMemo(() => {
    const set = new Set<string>();
    for (const r of existingRows) {
      if (r.stock_code) set.add(r.stock_code.trim());
    }
    return Array.from(set).sort();
  }, [existingRows]);

  // Danh sách các Kho (Warehouse) duy nhất từ bảng hiện có
  const allWarehouses = useMemo(() => {
    const set = new Set<string>();
    for (const r of existingRows) {
      if (r.warehouse) set.add(r.warehouse.trim());
    }
    return Array.from(set).sort();
  }, [existingRows]);

  // Gợi ý Stock Code: điền đến đâu gợi ý đến đó
  const stockSuggestions = useMemo(() => {
    const clean = stockCode.trim().toLowerCase();
    if (!clean) return allStockCodes.slice(0, 12);
    return allStockCodes.filter((c) => c.toLowerCase().includes(clean)).slice(0, 12);
  }, [allStockCodes, stockCode]);

  // Gợi ý Kho: điền đến đâu gợi ý đến đó
  const whSuggestions = useMemo(() => {
    const clean = warehouse.trim().toLowerCase();
    if (!clean) return allWarehouses.slice(0, 10);
    return allWarehouses.filter((w) => w.toLowerCase().includes(clean)).slice(0, 10);
  }, [allWarehouses, warehouse]);

  // Click ra ngoài để đóng dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (stockContainerRef.current && !stockContainerRef.current.contains(e.target as Node)) {
        setShowStockDropdown(false);
      }
      if (whContainerRef.current && !whContainerRef.current.contains(e.target as Node)) {
        setShowWhDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function executeAdd(overwrite = false) {
    const cleanBatch = batchId.trim();
    const cleanStock = stockCode.trim();
    const cleanWh = warehouse.trim();
    const cleanBin = bin.trim();
    const numQty = Number(qty);

    if (!cleanBatch) {
      setErrorMessage('Vui lòng nhập Tag ID (Batch)');
      return;
    }
    if (!cleanStock) {
      setErrorMessage('Vui lòng chọn hoặc nhập Mã hàng (Stock Code)');
      return;
    }
    if (!cleanWh) {
      setErrorMessage('Vui lòng chọn hoặc nhập Kho (Warehouse)');
      return;
    }
    if (!cleanBin) {
      setErrorMessage('Vui lòng nhập Vị trí (Bin)');
      return;
    }
    if (qty.trim() === '' || isNaN(numQty) || numQty < 0) {
      setErrorMessage('Vui lòng nhập Số lượng hợp lệ (>= 0)');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setDuplicateWarning(null);

    try {
      const { data, error } = await supabase.rpc('add_reference_stock', {
        p_batch_id: cleanBatch,
        p_stock_code: cleanStock,
        p_warehouse: cleanWh,
        p_bin: cleanBin,
        p_qty: numQty,
        p_create_date: new Date(`${createDate}T00:00:00Z`).toISOString(),
        p_overwrite: overwrite,
        p_tag_7055: is7055,
      });

      if (error) {
        setErrorMessage(`Lỗi thêm dữ liệu: ${error.message}`);
        return;
      }

      if (!data?.ok) {
        if (data?.error === 'duplicate_batch_id') {
          setDuplicateWarning(data?.message || 'Mã Tag ID đã tồn tại trong dữ liệu nguồn');
        } else {
          setErrorMessage(data?.message || data?.error || 'Không thể thêm dữ liệu');
        }
        return;
      }

      const created: ReferenceLine = {
        batch_id: cleanBatch,
        stock_code: cleanStock,
        warehouse: cleanWh,
        bin: cleanBin,
        qty: numQty,
        create_date: `${createDate}T00:00:00Z`,
        previous_bin: null,
        previous_qty: null,
        tag_7055: is7055,
      };

      setSuccessMessage(`✅ Đã thêm Tag ID ${cleanBatch} vào nguồn thành công!${is7055 ? ' (Đánh dấu 7055)' : ''}`);
      // Giữ lại Stock Code và Kho nếu muốn tiếp tục add nhanh nhiều tag cùng loại, xóa batch, bin, qty
      setBatchId('');
      setBin('');
      setQty('');
      setIs7055(false);

      onAddSuccess?.(created);
    } catch (err) {
      setErrorMessage(`Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void executeAdd(false);
  }

  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/80 p-4 sm:p-5 shadow-lg flex flex-col justify-between">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-300 flex items-center gap-2">
              <span>➕</span> Thẻ Thêm Dữ Liệu Nguồn Mới
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Thêm dòng tồn kho gốc với gợi ý thông minh Stock Code &amp; Kho. Ngày tạo tự động gán hôm nay.
            </p>
          </div>
          <span className="self-start sm:self-auto rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400">
            📅 {createDate}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {/* 1. Stock Code (Dropdown tự động gợi ý có sẵn, gõ đến đâu gợi ý đến đó) */}
            <div ref={stockContainerRef} className="relative">
              <label htmlFor="ref-add-stock-code" className="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                Mã hàng (Stock Code) *
              </label>
              <input
                id="ref-add-stock-code"
                type="text"
                value={stockCode}
                onChange={(e) => {
                  setStockCode(e.target.value);
                  setShowStockDropdown(true);
                }}
                onFocus={() => setShowStockDropdown(true)}
                placeholder="Gõ tìm hoặc nhập mã..."
                autoComplete="off"
                className="w-full rounded-xl border border-indigo-500/40 bg-black/60 px-3 py-2 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              {showStockDropdown && stockSuggestions.length > 0 && (
                <ul
                  role="listbox"
                  className="absolute z-30 left-0 top-full mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-cyan-500/40 bg-slate-950/95 p-1 shadow-2xl backdrop-blur-md custom-scrollbar"
                >
                  <li className="px-2 py-1 text-[10px] font-bold uppercase text-slate-500 border-b border-white/5">
                    Gợi ý mã hàng ({stockSuggestions.length})
                  </li>
                  {stockSuggestions.map((code) => (
                    <li
                      key={code}
                      role="option"
                      aria-selected={stockCode === code}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setStockCode(code);
                        setShowStockDropdown(false);
                      }}
                      className="cursor-pointer rounded-lg px-2.5 py-1.5 font-mono text-xs text-slate-200 hover:bg-cyan-500/20 hover:text-cyan-200 transition-colors flex items-center justify-between"
                    >
                      <span className="font-bold">{code}</span>
                      <span className="text-[9px] text-slate-500">Mã có sẵn</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 2. Tag ID / Batch (Nhập tay) */}
            <div>
              <label htmlFor="ref-add-tag-id" className="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                Tag ID (Batch) * <span className="text-amber-400/90 lowercase text-[9px] font-normal">(nhập tay)</span>
              </label>
              <input
                id="ref-add-tag-id"
                type="text"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                placeholder="VD: 000000000001..."
                className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {/* 3. Kho (Warehouse) (Dropdown tự động gợi ý có sẵn, gõ đến đâu gợi ý đến đó) */}
            <div ref={whContainerRef} className="relative">
              <label htmlFor="ref-add-warehouse" className="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                Kho (Warehouse) *
              </label>
              <input
                id="ref-add-warehouse"
                type="text"
                value={warehouse}
                onChange={(e) => {
                  setWarehouse(e.target.value);
                  setShowWhDropdown(true);
                }}
                onFocus={() => setShowWhDropdown(true)}
                placeholder="Gõ tìm kho (vd WH01, 01)..."
                autoComplete="off"
                className="w-full rounded-xl border border-indigo-500/40 bg-black/60 px-3 py-2 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              {showWhDropdown && whSuggestions.length > 0 && (
                <ul
                  role="listbox"
                  className="absolute z-30 left-0 top-full mt-1 max-h-40 w-full overflow-y-auto rounded-xl border border-cyan-500/40 bg-slate-950/95 p-1 shadow-2xl backdrop-blur-md custom-scrollbar"
                >
                  <li className="px-2 py-1 text-[10px] font-bold uppercase text-slate-500 border-b border-white/5">
                    Gợi ý kho ({whSuggestions.length})
                  </li>
                  {whSuggestions.map((wh) => (
                    <li
                      key={wh}
                      role="option"
                      aria-selected={warehouse === wh}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setWarehouse(wh);
                        setShowWhDropdown(false);
                      }}
                      className="cursor-pointer rounded-lg px-2.5 py-1.5 font-mono text-xs text-slate-200 hover:bg-indigo-500/20 hover:text-indigo-200 transition-colors flex items-center justify-between"
                    >
                      <span className="font-bold">{wh}</span>
                      <span className="text-[9px] text-slate-500">Kho nguồn</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 4. Vị trí Bin (Nhập tay) */}
            <div>
              <label htmlFor="ref-add-bin" className="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                Vị trí (Bin) * <span className="text-amber-400/90 lowercase text-[9px] font-normal">(nhập tay)</span>
              </label>
              <input
                id="ref-add-bin"
                type="text"
                value={bin}
                onChange={(e) => setBin(e.target.value)}
                placeholder="VD: C4, A1-02..."
                className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-xs text-emerald-300 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            {/* 5. Số lượng (Nhập tay) */}
            <div>
              <label htmlFor="ref-add-qty" className="block text-[10px] font-bold uppercase tracking-wider text-slate-300 mb-1">
                Số lượng * <span className="text-amber-400/90 lowercase text-[9px] font-normal">(nhập tay)</span>
              </label>
              <input
                id="ref-add-qty"
                type="number"
                min="0"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="VD: 500..."
                className="w-full rounded-xl border border-white/10 bg-black/60 px-3 py-2 font-mono text-xs text-white placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            {/* 6. Ngày tạo (Tự động) */}
            <div>
              <label htmlFor="ref-add-date" className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Ngày tạo (Tự động)
              </label>
              <input
                id="ref-add-date"
                type="date"
                value={createDate}
                readOnly
                aria-readonly="true"
                className="w-full rounded-xl border border-white/5 bg-slate-950/80 px-3 py-2 font-mono text-xs text-slate-400 cursor-not-allowed"
              />
            </div>
          </div>

          {/* Tích chọn 7055 (Tag in thêm) */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-purple-500/30 bg-purple-950/20 px-3 py-2">
            <label
              htmlFor="ref-add-tag-7055"
              className="inline-flex items-center gap-2 cursor-pointer select-none"
            >
              <input
                id="ref-add-tag-7055"
                data-testid="ref-add-checkbox-7055"
                type="checkbox"
                checked={is7055}
                onChange={(e) => setIs7055(e.target.checked)}
                className="h-4 w-4 rounded border-purple-500 bg-black/60 text-purple-600 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer accent-purple-500"
              />
              <span className="font-cyber text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                <span>🏷️</span> 7055
              </span>
            </label>
            <span className="text-[10px] text-slate-400 italic">
              * Tích chọn để đánh dấu và đưa vào danh sách Tag in thêm 7055
            </span>
          </div>

          {/* Cảnh báo trùng Tag ID */}
          {duplicateWarning && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3 text-xs text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span>⚠️</span>
                <span>{duplicateWarning}</span>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-auto">
                <button
                  type="button"
                  onClick={() => setDuplicateWarning(null)}
                  className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:text-white"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => void executeAdd(true)}
                  className="rounded-lg bg-amber-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-amber-500"
                >
                  Ghi đè cập nhật
                </button>
              </div>
            </div>
          )}

          {/* Thông báo lỗi */}
          {errorMessage && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/40 p-2.5 text-xs text-rose-300 flex items-center gap-2">
              <span>❌</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Thông báo thành công */}
          {successMessage && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-2.5 text-xs text-emerald-300 flex items-center gap-2">
              <span>{successMessage}</span>
            </div>
          )}

          {/* Nút hành động Submit */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-5 py-2.5 font-cyber text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-emerald-600/20 hover:scale-[1.02] hover:shadow-cyan-500/30 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition"
            >
              {isSubmitting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
                  <span>Đang lưu...</span>
                </>
              ) : (
                <>
                  <span>➕</span>
                  <span>Thêm Vào Dữ Liệu Nguồn</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
