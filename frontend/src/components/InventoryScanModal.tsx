// InventoryScanModal — Modal "Quét Kiểm Kê" (Bảng 3).
// Luồng giống hệt PdaScanModal: Quét Bin -> Quét Tag ID -> Điền Số lượng tay.
// Ghi vào bảng riêng `inventory_counts` (không lẫn scanned_data).
// Bảng 3 nằm TRONG modal: STOCK CODE | TAG ID | BIN KK | SL KK | BIN B1 | SL B1
// | BIN HT (B2) | SL HT (B2) | Cảnh báo đối chiếu chéo cả 2 bảng.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import { downloadInventoryExcel } from '../lib/exportExcel';
import { compareInventoryRow, detectSourceChange, type SourceBaseline } from '../lib/inventoryCompare';
import { supabase } from '../lib/supabase';
import type { InventoryRow, ScanRow } from '../lib/types';

export const INVENTORY_WAITING_BIN = 'WAITING...';

interface InventoryScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventoryRows: InventoryRow[];
  scannedRows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
  onChanged?: () => void;
}

export default function InventoryScanModal({
  isOpen,
  onClose,
  inventoryRows,
  scannedRows,
  systemByBatch,
  onChanged,
}: InventoryScanModalProps) {
  const [mode, setMode] = useState<'location' | 'tag'>('location');
  const [activeBin, setActiveBin] = useState<string>(INVENTORY_WAITING_BIN);

  const [binInput, setBinInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [stockCodeInput, setStockCodeInput] = useState('');

  const [isDuplicateInInventory, setIsDuplicateInInventory] = useState(false);
  const [isNotInRefAlert, setIsNotInRefAlert] = useState(false);
  const [matchedStockCode, setMatchedStockCode] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Mốc nguồn chốt lúc mở modal (theo Tag): phát hiện file nguồn vừa nạp/sửa
  // làm đổi SL/Bin hệ thống của Tag đã kiểm kê → highlight riêng, không lẫn
  // với cảnh báo lệch kiểm-kê-vs-nguồn thông thường.
  const [baseline, setBaseline] = useState<Map<string, SourceBaseline>>(new Map());
  const wasOpenRef = useRef(false);

  const buildBaseline = useCallback((): Map<string, SourceBaseline> => {
    const m = new Map<string, SourceBaseline>();
    for (const r of inventoryRows) {
      const k = (r.batch_id || '').trim();
      if (!k || m.has(k)) continue;
      const s = systemByBatch.get(k);
      m.set(k, {
        qty: s ? Number(s.qty) : NaN,
        bin: s ? (s.bin || '').trim() : '',
      });
    }
    return m;
  }, [inventoryRows, systemByBatch]);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      // Vừa mở modal: chốt mốc theo nguồn hiện tại.
      setBaseline(buildBaseline());
      wasOpenRef.current = true;
      return;
    }
    // Đang mở: chỉ bổ sung Tag mới xuất hiện (quét thêm / nguồn thêm mới),
    // KHÔNG ghi đè mốc cũ — nếu không sẽ mất dấu "nguồn vừa đổi".
    setBaseline((prev) => {
      const next = new Map(prev);
      let added = false;
      for (const r of inventoryRows) {
        const k = (r.batch_id || '').trim();
        if (!k || next.has(k)) continue;
        const s = systemByBatch.get(k);
        next.set(k, { qty: s ? Number(s.qty) : NaN, bin: s ? (s.bin || '').trim() : '' });
        added = true;
      }
      return added ? next : prev;
    });
    // buildBaseline đã useCallback theo inventoryRows/systemByBatch nên Tag quét thêm
    // khi modal đang mở vẫn được chốt mốc first-seen.
  }, [isOpen, inventoryRows, systemByBatch, buildBaseline]);

  const binInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const stockCodeInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'location') {
      binInputRef.current?.focus();
    } else {
      tagInputRef.current?.focus();
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  function handleBinSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const val = binInput.trim();
    if (!val) return;
    setActiveBin(val);
    setBinInput('');
    setNotice(null);
    setMode('tag');
    setTimeout(() => tagInputRef.current?.focus(), 50);
  }

  function handleTagSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const tag = tagInput.trim();
    if (!tag) return;

    if (activeBin === INVENTORY_WAITING_BIN) {
      setNotice('⚠️ Vui lòng quét VỊ TRÍ (BIN) trước khi quét Tag ID!');
      setMode('location');
      return;
    }

    setNotice(null);
    setSuccessNotice(null);

    const cleanTag = tag.trim();
    setIsDuplicateInInventory(
      inventoryRows.some((r) => (r.batch_id || '').trim() === cleanTag),
    );

    const refItem = systemByBatch.get(cleanTag);
    if (!refItem) {
      setIsNotInRefAlert(true);
      setMatchedStockCode(null);
      setStockCodeInput('');
      setTimeout(() => stockCodeInputRef.current?.focus(), 50);
    } else {
      setIsNotInRefAlert(false);
      setMatchedStockCode(refItem.stock_code ?? '');
      setStockCodeInput(refItem.stock_code ?? '');
      setTimeout(() => qtyInputRef.current?.focus(), 50);
    }
    setQtyInput('');
  }

  async function handleFinalSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const tag = tagInput.trim();
    const qVal = Number(qtyInput.trim());

    if (!tag) {
      setNotice('⚠️ Vui lòng quét hoặc nhập Tag ID!');
      tagInputRef.current?.focus();
      return;
    }
    if (!qVal || qVal <= 0 || !Number.isFinite(qVal)) {
      setNotice('⚠️ Vui lòng điền Số lượng hợp lệ (> 0)!');
      qtyInputRef.current?.focus();
      return;
    }
    if (activeBin === INVENTORY_WAITING_BIN) {
      setNotice('⚠️ Vui lòng quét VỊ TRÍ (BIN) trước!');
      return;
    }

    const finalStockCode = stockCodeInput.trim() || matchedStockCode || null;
    setBusy(true);
    setNotice(null);
    try {
      // Ghi qua RPC SECURITY DEFINER: app chạy phiên anon nên insert thẳng bị
      // RLS chặn (đúng chuẩn repo: mọi ghi đi qua RPC, như delete_scanned_row).
      const { data, error } = await supabase.rpc('submit_inventory_count', {
        p_batch_id: tag,
        p_stock_code: finalStockCode,
        p_qty: qVal,
        p_bin: activeBin,
        p_is_manual: false,
      });
      if (error || (data as { ok?: unknown } | null)?.ok !== true) {
        setNotice(`❌ Lỗi lưu kiểm kê: ${error?.message || (data as { error?: unknown } | null)?.error || 'Không xác định'}`);
      } else {
        setSuccessNotice(`✅ Đã lưu kiểm kê: ${tag} (SL: ${qVal}, Bin: ${activeBin})`);
        resetTagForm();
        onChanged?.();
      }
    } catch (err) {
      setNotice(`❌ Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRow(id: string) {
    if (!window.confirm('Xóa dòng kiểm kê này?')) return;
    setDeletingId(id);
    try {
      // Xóa qua RPC SECURITY DEFINER (phiên anon không được delete thẳng).
      const { data, error } = await supabase.rpc('delete_inventory_row', { p_id: id });
      if (error || (data as { ok?: unknown } | null)?.ok !== true) {
        setNotice(`❌ Lỗi xóa: ${error?.message || (data as { error?: unknown } | null)?.error || 'Không xác định'}`);
      } else {
        onChanged?.();
      }
    } catch (err) {
      setNotice(`❌ Lỗi kết nối: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingId(null);
    }
  }

  function resetTagForm() {
    setTagInput('');
    setQtyInput('');
    setStockCodeInput('');
    setIsNotInRefAlert(false);
    setIsDuplicateInInventory(false);
    setMatchedStockCode(null);
    setTimeout(() => tagInputRef.current?.focus(), 50);
  }

  function resetBin() {
    setActiveBin(INVENTORY_WAITING_BIN);
    setBinInput('');
    resetTagForm();
    setMode('location');
    setNotice(null);
    setSuccessNotice(null);
    setTimeout(() => binInputRef.current?.focus(), 50);
  }

  const uniqueRows = inventoryRows.filter(
    (r, idx, arr) => arr.findIndex((x) => x.id === r.id) === idx,
  );

  // Dòng bị nguồn "đụng" sau mốc chốt (nạp file mới / sửa SL-Bin Bảng 2 khi modal đang mở).
  const changedDetails = new Map<string, string>();
  for (const r of uniqueRows) {
    const k = (r.batch_id || '').trim();
    if (!k || changedDetails.has(k)) continue;
    const chg = detectSourceChange(baseline.get(k), systemByBatch.get(k));
    if (chg.changed && chg.detail) changedDetails.set(k, chg.detail);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inventory-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-2 sm:p-4 backdrop-blur-md"
    >
      <div className="glass-panel relative flex w-full max-w-4xl flex-col rounded-[28px] border border-amber-500/50 bg-slate-950/95 shadow-2xl transition-all">
        {/* Header */}
        <div className="relative flex items-center justify-between border-b border-amber-500/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-amber-400"></span>
            <div>
              <h2 id="inventory-modal-title" className="font-cyber text-lg font-black tracking-widest text-white">
                📦 QUÉT KIỂM KÊ
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-amber-400">
                Inventory Count — Đối chiếu Bảng 1 &amp; Bảng 2
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng giao diện kiểm kê"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm font-bold text-slate-400 transition hover:bg-rose-900/60 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="flex border-b border-white/10 bg-white/5 p-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setMode('location');
              setTimeout(() => binInputRef.current?.focus(), 50);
            }}
            className={`flex-1 rounded-xl py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
              mode === 'location'
                ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white shadow-lg shadow-indigo-500/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            📍 1. Vị Trí (Bin)
          </button>
          <button
            type="button"
            onClick={() => {
              if (activeBin === INVENTORY_WAITING_BIN) {
                setNotice('⚠️ Vui lòng quét VỊ TRÍ trước khi quét Tag!');
                return;
              }
              setMode('tag');
              setTimeout(() => tagInputRef.current?.focus(), 50);
            }}
            className={`flex-1 rounded-xl py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
              mode === 'tag'
                ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-lg shadow-amber-500/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            📦 2. Quét Tag Kiểm Kê
          </button>
        </div>

        {/* Active Bin Bar */}
        <div className="flex items-center justify-between border-b border-indigo-500/30 bg-indigo-950/40 px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
              Active Bin:
            </span>
            <span
              data-testid="inventory-active-bin"
              className={`font-cyber text-base font-bold ${
                activeBin === INVENTORY_WAITING_BIN ? 'text-amber-400 animate-pulse' : 'text-cyan-400'
              }`}
            >
              {activeBin}
            </span>
          </div>
          {activeBin !== INVENTORY_WAITING_BIN && (
            <button
              type="button"
              onClick={resetBin}
              className="text-[10px] font-bold text-rose-400 transition hover:text-rose-300"
            >
              🔄 RESET BIN
            </button>
          )}
        </div>

        {/* Main Input Form */}
        <div className="space-y-4 p-5 sm:p-6">
          {mode === 'location' ? (
            <form onSubmit={handleBinSubmit} className="space-y-3">
              <label htmlFor="inventory-bin-input" className="block text-[11px] font-bold uppercase tracking-widest text-indigo-400">
                Quét hoặc nhập Vị Trí (BIN):
              </label>
              <input
                id="inventory-bin-input"
                ref={binInputRef}
                type="text"
                value={binInput}
                onChange={(e) => setBinInput(e.target.value)}
                placeholder="READY TO SCAN BIN..."
                className="w-full rounded-2xl border-2 border-indigo-500/60 bg-black/60 p-4 text-center font-cyber text-xl font-bold text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
              />
              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-indigo-500 active:scale-95"
              >
                Xác nhận Vị Trí ➔ Sang Quét Tag
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="inventory-tag-input" className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-amber-400">
                  Tag ID (Barcode Batch):
                </label>
                <div className="flex gap-2">
                  <input
                    id="inventory-tag-input"
                    ref={tagInputRef}
                    type="text"
                    value={tagInput}
                    disabled={busy}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleTagSubmit();
                    }}
                    placeholder="SCAN TAG ID (ENTER)..."
                    className="flex-1 rounded-xl border-2 border-amber-500/50 bg-black/60 p-3.5 text-center font-cyber text-lg font-bold text-cyan-300 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => handleTagSubmit()}
                    className="rounded-xl border border-amber-500/40 bg-amber-950/60 px-4 text-xs font-bold text-amber-300 transition hover:bg-amber-900"
                  >
                    Kiểm tra
                  </button>
                </div>
              </div>

              {isDuplicateInInventory && (
                <div className="rounded-xl border border-rose-500/60 bg-rose-950/40 p-3 text-xs">
                  <p className="font-bold text-rose-300">
                    ⚠️ Tag {tagInput} đã có trong bảng kiểm kê — lưu tiếp sẽ tạo dòng mới, đối chiếu vẫn tính tổng.
                  </p>
                </div>
              )}

              {isNotInRefAlert && (
                <div className="rounded-xl border border-amber-500/50 bg-amber-950/30 p-3 text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <span>⚠️ Tag ID không tồn tại trong file nguồn (Bảng 2)!</span>
                  </div>
                  <p className="mt-1 text-[11px] text-amber-200/80">
                    Vui lòng điền thêm Stock Code để đối chiếu truy xuất:
                  </p>
                  <input
                    id="inventory-stockcode-input"
                    ref={stockCodeInputRef}
                    type="text"
                    value={stockCodeInput}
                    disabled={busy}
                    onChange={(e) => setStockCodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') qtyInputRef.current?.focus();
                    }}
                    placeholder="NHẬP STOCK CODE..."
                    className="mt-2 w-full rounded-lg border border-amber-500/40 bg-black/60 p-2.5 font-mono text-sm font-bold text-amber-300 focus:border-amber-400 focus:outline-none"
                  />
                </div>
              )}

              {matchedStockCode && !isNotInRefAlert && (
                <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-950/30 px-3 py-2 text-xs">
                  <span className="text-slate-400">Mã hàng nguồn:</span>
                  <span className="font-mono font-bold text-cyan-300">{matchedStockCode}</span>
                </div>
              )}

              <div>
                <label htmlFor="inventory-qty-input" className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-cyan-400">
                  Số lượng (Điền tay):
                </label>
                <input
                  id="inventory-qty-input"
                  ref={qtyInputRef}
                  type="number"
                  min={1}
                  step="any"
                  value={qtyInput}
                  disabled={busy}
                  onChange={(e) => setQtyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleFinalSave();
                  }}
                  placeholder="NHẬP SỐ LƯỢNG..."
                  className="w-full rounded-xl border-2 border-cyan-500/50 bg-black/60 p-3.5 text-center font-cyber text-2xl font-bold text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                />
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleFinalSave()}
                className="w-full rounded-2xl bg-gradient-to-r from-amber-600 via-orange-600 to-amber-600 py-4 font-cyber text-sm font-bold uppercase tracking-widest text-white shadow-xl shadow-amber-900/40 transition hover:opacity-95 active:scale-95 disabled:opacity-50"
              >
                {busy ? 'ĐANG LƯU DỮ LIỆU...' : '💾 LƯU LƯỢT KIỂM KÊ (ENTER)'}
              </button>
            </div>
          )}

          {notice && (
            <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-3 text-xs text-rose-200">
              {notice}
            </p>
          )}
          {successNotice && (
            <p className="rounded-xl border border-emerald-500/40 bg-emerald-950/60 p-3 text-xs text-emerald-200">
              {successNotice}
            </p>
          )}
        </div>

        {/* Bảng 3 kiểm kê — CHỈ nằm trong modal */}
        <div className="border-t border-white/10 bg-black/50 p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Bảng 3 — Đối chiếu kiểm kê ({uniqueRows.length})
              </h3>
              {changedDetails.size > 0 && (
                <span
                  data-testid="inventory-source-changed-badge"
                  className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                  NGUỒN VỪA ĐỔI: {changedDetails.size} TAG
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {changedDetails.size > 0 && (
                <button
                  type="button"
                  onClick={() => setBaseline(buildBaseline())}
                  title="Chốt lại mốc nguồn hiện tại — tắt highlight các dòng đã xem"
                  className="rounded-xl border border-amber-500/40 bg-amber-950/60 px-3 py-1.5 text-[11px] font-bold text-amber-300 transition hover:bg-amber-900 active:scale-95"
                >
                  ✓ Đã xem — chốt lại mốc
                </button>
              )}
              <button
                type="button"
                disabled={uniqueRows.length === 0}
                onClick={() => downloadInventoryExcel(uniqueRows, scannedRows, systemByBatch)}
                className="rounded-xl border border-emerald-500/40 bg-emerald-900/40 px-3 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-800 disabled:opacity-40"
              >
                📥 EXPORT XLSX
              </button>
            </div>
          </div>

          {changedDetails.size > 0 && (
            <p role="alert" className="mb-3 rounded-xl border border-amber-500/40 bg-amber-950/50 p-2.5 text-[11px] font-bold text-amber-200">
              ⚠️ Dữ liệu nguồn (Bảng 2) vừa thay đổi sau thời điểm mở modal — {changedDetails.size} Tag kiểm kê bị ảnh hưởng
              (dòng viền vàng + nhãn 🔄). So lại cột CẢNH BÁO rồi bấm “Đã xem — chốt lại mốc”.
            </p>
          )}

          <div className="max-h-72 overflow-auto rounded-xl border border-white/10">
            {uniqueRows.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">Chưa có lượt kiểm kê nào trong phiên.</p>
            ) : (
              <table className="w-full min-w-[900px] text-left font-mono text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-2.5 py-2">STOCK CODE</th>
                    <th className="px-2.5 py-2">TAG ID</th>
                    <th className="px-2.5 py-2 text-right">BIN KK</th>
                    <th className="px-2.5 py-2 text-right">SL KK</th>
                    <th className="px-2.5 py-2 text-right">BIN B1</th>
                    <th className="px-2.5 py-2 text-right">SL B1</th>
                    <th className="px-2.5 py-2 text-right">BIN HT (B2)</th>
                    <th className="px-2.5 py-2 text-right">SL HT (B2)</th>
                    <th className="px-2.5 py-2 text-left">CẢNH BÁO</th>
                    <th className="px-2.5 py-2 text-center">XÓA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {uniqueRows.slice(0, 200).map((r) => {
                    const cmp = compareInventoryRow(r, scannedRows, systemByBatch);
                    const stockCode = r.stock_code ?? cmp.systemStockCode ?? '—';
                    const srcDetail = changedDetails.get((r.batch_id || '').trim()) ?? null;
                    return (
                      <tr
                        key={r.id}
                        data-testid={`inventory-row-${r.id}`}
                        data-source-changed={srcDetail ? 'true' : undefined}
                        className={srcDetail ? 'bg-amber-950/40 hover:bg-amber-900/40 border-l-4 border-l-amber-500' : 'hover:bg-white/5'}
                      >
                        <td className="px-2.5 py-1.5 font-bold text-slate-200">{stockCode}</td>
                        <td className="px-2.5 py-1.5 font-bold text-cyan-300">{r.batch_id}</td>
                        <td className="px-2.5 py-1.5 text-right text-white">{r.bin}</td>
                        <td className="px-2.5 py-1.5 text-right font-bold text-white">{r.qty}</td>
                        <td className="px-2.5 py-1.5 text-right text-slate-300">
                          {cmp.table1Bins.join(', ') || '—'}
                        </td>
                        <td className={`px-2.5 py-1.5 text-right font-bold ${cmp.table1Qty !== null && Number(r.qty) !== cmp.table1Qty ? 'text-rose-400' : 'text-slate-300'}`}>
                          {cmp.table1Qty ?? '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-right text-slate-400">{cmp.table2Bin ?? '—'}</td>
                        <td className={`px-2.5 py-1.5 text-right font-bold ${cmp.table2Qty !== null && Number(r.qty) !== cmp.table2Qty ? 'text-rose-400' : 'text-slate-400'}`}>
                          {cmp.table2Qty ?? '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-left text-[11px]">
                          {srcDetail && (
                            <span className="mb-1 block">
                              <span
                                data-testid={`inventory-source-changed-${r.id}`}
                                title={srcDetail}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-extrabold text-amber-300"
                              >
                                🔄 Nguồn vừa đổi
                              </span>
                              <span className="block font-medium text-amber-200/90">{srcDetail}</span>
                            </span>
                          )}
                          {cmp.allMatch ? (
                            <span className="font-semibold text-emerald-400">Khớp cả 2 bảng</span>
                          ) : (
                            <span className="font-bold text-rose-400">{cmp.warnings.join(' | ')}</span>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 text-center">
                          <button
                            type="button"
                            disabled={deletingId === r.id}
                            onClick={() => void handleDeleteRow(r.id)}
                            title={`Xóa dòng kiểm kê ${r.batch_id}`}
                            aria-label={`Xóa dòng kiểm kê ${r.batch_id}`}
                            className="rounded-lg p-1 text-slate-500 transition hover:bg-rose-950/60 hover:text-rose-300 disabled:opacity-40"
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
