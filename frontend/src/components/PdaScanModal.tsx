// PdaScanModal — Giao diện nổi quét PDA phong cách scantag.html
// 3 bước ánh xạ: Quét Bin -> Quét Tag ID -> Điền Số lượng tay.
// Cảnh báo trực tiếp: Trùng Tag ID (Ghi thêm / Đổi vị trí), Không có trong nguồn (Điền Stock code).
// Bảng streaming bên dưới + Nút Export XLS.
import React, { useEffect, useRef, useState } from 'react';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import { downloadStreamingExcel } from '../lib/exportExcel';
import { resolveDuplicate, submitScan, type ScanStatus } from '../lib/scanApi';
import { supabase } from '../lib/supabase';
import type { ScanRow } from '../lib/types';

export const WAITING_BIN = 'WAITING...';

const STATUS_BADGE: Record<ScanStatus, { text: string; bg: string }> = {
  pending: { text: 'Chờ', bg: 'bg-slate-700 text-slate-200' },
  ok: { text: 'Khớp', bg: 'bg-emerald-900/80 text-emerald-200' },
  qty_mismatch: { text: 'Lệch SL', bg: 'bg-amber-900/80 text-amber-200' },
  bin_mismatch: { text: 'Lệch vị trí', bg: 'bg-amber-900/80 text-amber-200' },
  not_in_reference: { text: 'Ngoài nguồn', bg: 'bg-sky-900/80 text-sky-200' },
  duplicate: { text: 'Trùng Tag', bg: 'bg-rose-900/80 text-rose-200' },
};

interface PdaScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  rows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
  onScanned?: () => void;
}

export default function PdaScanModal({
  isOpen,
  onClose,
  rows,
  systemByBatch,
  onScanned,
}: PdaScanModalProps) {
  const [mode, setMode] = useState<'location' | 'tag'>('location');
  const [activeBin, setActiveBin] = useState<string>(WAITING_BIN);

  const [binInput, setBinInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [qtyInput, setQtyInput] = useState('');
  const [stockCodeInput, setStockCodeInput] = useState('');

  // Trạng thái cảnh báo trực tiếp
  const [duplicateConflict, setDuplicateConflict] = useState<{
    existingId: string;
    existingBin: string;
    action: 'append' | 'relocate' | null;
  } | null>(null);
  const [isNotInRefAlert, setIsNotInRefAlert] = useState(false);
  const [matchedStockCode, setMatchedStockCode] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const binInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const stockCodeInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // Auto focus khi mở modal hoặc đổi mode
  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'location') {
      binInputRef.current?.focus();
    } else {
      tagInputRef.current?.focus();
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  // Bước 1: Quét hoặc nhập Bin
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

  // Bước 2: Quét hoặc nhập Tag ID (Pre-check)
  function handleTagSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const tag = tagInput.trim();
    if (!tag) return;

    if (activeBin === WAITING_BIN) {
      setNotice('⚠️ Vui lòng quét VỊ TRÍ (BIN) trước khi quét Tag ID!');
      setMode('location');
      return;
    }

    setNotice(null);
    setSuccessNotice(null);

    // 1. Kiểm tra trùng trong danh sách đã quét
    const existing = rows.find((r) => r.batch_id === tag);
    if (existing) {
      setDuplicateConflict({
        existingId: existing.id,
        existingBin: existing.bin,
        action: null, // Chờ user chọn Ghi thêm hoặc Đổi vị trí
      });
    } else {
      setDuplicateConflict(null);
    }

    // 2. Tra cứu trong file nguồn
    const refItem = systemByBatch.get(tag);
    if (!refItem) {
      void supabase
        .from('reference_stock')
        .select('stock_code,qty,bin')
        .eq('batch_id', tag)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            systemByBatch.set(tag, { stock_code: data.stock_code, qty: data.qty, bin: data.bin });
            setIsNotInRefAlert(false);
            setMatchedStockCode(data.stock_code ?? '');
            setStockCodeInput(data.stock_code ?? '');
            qtyInputRef.current?.focus();
          } else {
            setIsNotInRefAlert(true);
            setMatchedStockCode(null);
            setStockCodeInput('');
            setTimeout(() => stockCodeInputRef.current?.focus(), 50);
          }
        });
    } else {
      setIsNotInRefAlert(false);
      setMatchedStockCode(refItem.stock_code ?? '');
      setStockCodeInput(refItem.stock_code ?? '');
      // Nhảy sang ô Số lượng (để trống bắt buộc gõ tay)
      setTimeout(() => qtyInputRef.current?.focus(), 50);
    }

    // Luôn reset ô Số lượng để trống
    setQtyInput('');
  }

  // Chọn giải pháp trùng
  function chooseDuplicateAction(action: 'append' | 'relocate') {
    if (!duplicateConflict) return;
    setDuplicateConflict({ ...duplicateConflict, action });
    if (action === 'relocate') {
      // Đổi vị trí: nếu đã có sẵn số lượng thì có thể submit ngay, hoặc nhảy sang số lượng
      setNotice(`Đã chọn: ĐỔI VỊ TRÍ sang "${activeBin}". Nhập số lượng và lưu.`);
    } else {
      setNotice(`Đã chọn: GHI THÊM bản ghi mới tại "${activeBin}". Nhập số lượng và lưu.`);
    }
    setTimeout(() => qtyInputRef.current?.focus(), 50);
  }

  // Bước 3: Lưu lượt quét hoàn chỉnh (Submit)
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

    if (activeBin === WAITING_BIN) {
      setNotice('⚠️ Vui lòng quét VỊ TRÍ (BIN) trước!');
      return;
    }

    const finalStockCode = stockCodeInput.trim() || matchedStockCode || null;

    setBusy(true);
    setNotice(null);

    try {
      if (duplicateConflict && duplicateConflict.action) {
        // Xử lý trùng theo lựa chọn của người dùng
        const res = await resolveDuplicate({
          action: duplicateConflict.action,
          scannedId: duplicateConflict.existingId,
          batchId: tag,
          qty: qVal,
          bin: activeBin,
          stockCode: finalStockCode,
        });

        if (res.kind === 'resolved') {
          setSuccessNotice(`✅ Đã ${duplicateConflict.action === 'append' ? 'ghi thêm' : 'đổi vị trí'}: ${tag} (SL: ${qVal})`);
          resetTagForm();
          onScanned?.();
        } else {
          setNotice(`❌ Lỗi: ${res.message} (${res.code})`);
        }
      } else {
        // Quét thông thường
        const outcome = await submitScan({
          batchId: tag,
          qty: qVal,
          bin: activeBin,
          isManual: false,
          stockCode: finalStockCode,
        });

        if (outcome.kind === 'scanned') {
          setSuccessNotice(`✅ Đã lưu thành công: ${tag} (SL: ${qVal}, Vị trí: ${activeBin})`);
          resetTagForm();
          onScanned?.();
        } else if (outcome.kind === 'duplicate') {
          setDuplicateConflict({
            existingId: outcome.conflict.existingId,
            existingBin: outcome.conflict.attempted.bin,
            action: null,
          });
          setNotice(`⚠️ Tag ID ${tag} đã tồn tại — vui lòng chọn Ghi thêm hoặc Đổi vị trí bên dưới.`);
        } else {
          setNotice(`❌ Lỗi: ${outcome.message} (${outcome.code})`);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function resetTagForm() {
    setTagInput('');
    setQtyInput('');
    setStockCodeInput('');
    setIsNotInRefAlert(false);
    setDuplicateConflict(null);
    setMatchedStockCode(null);
    setTimeout(() => tagInputRef.current?.focus(), 50);
  }

  function resetBin() {
    setActiveBin(WAITING_BIN);
    setBinInput('');
    resetTagForm();
    setMode('location');
    setNotice(null);
    setSuccessNotice(null);
    setTimeout(() => binInputRef.current?.focus(), 50);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-2 sm:p-4 backdrop-blur-md"
    >
      <div className="glass-panel relative flex w-full max-w-xl flex-col rounded-[28px] border border-indigo-500/50 bg-slate-950/95 shadow-2xl transition-all">
        {/* Header Futuristic */}
        <div className="relative flex items-center justify-between border-b border-indigo-500/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-cyan-400"></span>
            <div>
              <h2 id="modal-title" className="font-cyber text-lg font-black tracking-widest text-white">
                PDA SCAN MATRIX
              </h2>
              <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-indigo-400">
                Core Scanner Active
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng giao diện quét"
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
              if (activeBin === WAITING_BIN) {
                setNotice('⚠️ Vui lòng quét VỊ TRÍ trước khi quét Tag!');
                return;
              }
              setMode('tag');
              setTimeout(() => tagInputRef.current?.focus(), 50);
            }}
            className={`flex-1 rounded-xl py-2.5 text-xs font-bold uppercase tracking-wider transition-all ${
              mode === 'tag'
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-500/30'
                : 'bg-slate-900 text-slate-400 hover:text-slate-200'
            }`}
          >
            🏷️ 2. Quét Tag ID
          </button>
        </div>

        {/* Active Bin Bar */}
        <div className="flex items-center justify-between border-b border-indigo-500/30 bg-indigo-950/40 px-6 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">
              Active Bin:
            </span>
            <span
              data-testid="pda-active-bin"
              className={`font-cyber text-base font-bold ${
                activeBin === WAITING_BIN ? 'text-amber-400 animate-pulse' : 'text-cyan-400'
              }`}
            >
              {activeBin}
            </span>
          </div>
          {activeBin !== WAITING_BIN && (
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
            /* Mode 1: Quét Vị Trí */
            <form onSubmit={handleBinSubmit} className="space-y-3">
              <label htmlFor="modal-bin-input" className="block text-[11px] font-bold uppercase tracking-widest text-indigo-400">
                Quét hoặc nhập Vị Trí (BIN):
              </label>
              <div className="relative">
                <input
                  id="modal-bin-input"
                  ref={binInputRef}
                  type="text"
                  value={binInput}
                  onChange={(e) => setBinInput(e.target.value)}
                  placeholder="READY TO SCAN BIN..."
                  className="w-full rounded-2xl border-2 border-indigo-500/60 bg-black/60 p-4 text-center font-cyber text-xl font-bold text-cyan-300 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-4 focus:ring-cyan-500/20"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-indigo-600 py-3 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-indigo-500 active:scale-95"
              >
                Xác nhận Vị Trí ➔ Sang Quét Tag
              </button>
            </form>
          ) : (
            /* Mode 2: Quét Tag ID & Nhập Số lượng */
            <div className="space-y-4">
              {/* Ô Tag ID */}
              <div>
                <label htmlFor="modal-tag-input" className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-emerald-400">
                  Tag ID (Barcode Batch):
                </label>
                <div className="flex gap-2">
                  <input
                    id="modal-tag-input"
                    ref={tagInputRef}
                    type="text"
                    value={tagInput}
                    disabled={busy}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleTagSubmit();
                    }}
                    placeholder="SCAN TAG ID (ENTER)..."
                    className="flex-1 rounded-xl border-2 border-emerald-500/50 bg-black/60 p-3.5 text-center font-cyber text-lg font-bold text-cyan-300 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => handleTagSubmit()}
                    className="rounded-xl border border-emerald-500/40 bg-emerald-950/60 px-4 text-xs font-bold text-emerald-300 transition hover:bg-emerald-900"
                  >
                    Kiểm tra
                  </button>
                </div>
              </div>

              {/* Cảnh báo 1: Trùng Tag ID */}
              {duplicateConflict && (
                <div className="duplicate-alert rounded-xl border border-rose-500/60 p-3 text-xs">
                  <div className="flex items-center gap-2 font-bold text-rose-300">
                    <span>⚠️ CẢNH BÁO TRÙNG MÃ:</span>
                    <span>Tag {tagInput} đã quét tại vị trí &quot;{duplicateConflict.existingBin}&quot;</span>
                  </div>
                  <p className="mt-1 text-[11px] text-rose-200">
                    Chọn hành động để tiếp tục:
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => chooseDuplicateAction('append')}
                      className={`flex-1 rounded-lg py-2 font-bold transition ${
                        duplicateConflict.action === 'append'
                          ? 'bg-rose-600 text-white shadow-lg'
                          : 'bg-rose-950/80 text-rose-200 hover:bg-rose-900'
                      }`}
                    >
                      ➕ 1. Ghi thêm
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseDuplicateAction('relocate')}
                      className={`flex-1 rounded-lg py-2 font-bold transition ${
                        duplicateConflict.action === 'relocate'
                          ? 'bg-amber-600 text-white shadow-lg'
                          : 'bg-amber-950/80 text-amber-200 hover:bg-amber-900'
                      }`}
                    >
                      🔄 2. Đổi vị trí
                    </button>
                  </div>
                </div>
              )}

              {/* Cảnh báo 2: Không tồn tại trong nguồn ➔ Hiện ô Stock code */}
              {isNotInRefAlert && (
                <div className="rounded-xl border border-amber-500/50 bg-amber-950/30 p-3 text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-300">
                    <span>⚠️ Tag ID không tồn tại trong file nguồn!</span>
                  </div>
                  <p className="mt-1 text-[11px] text-amber-200/80">
                    Vui lòng điền thêm Stock Code để đối chiếu truy xuất:
                  </p>
                  <input
                    id="modal-stockcode-input"
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

              {/* Tag ID có trong nguồn ➔ Hiển thị Stock code tự động */}
              {matchedStockCode && !isNotInRefAlert && (
                <div className="flex items-center justify-between rounded-xl border border-indigo-500/30 bg-indigo-950/30 px-3 py-2 text-xs">
                  <span className="text-slate-400">Mã hàng nguồn:</span>
                  <span className="font-mono font-bold text-cyan-300">{matchedStockCode}</span>
                </div>
              )}

              {/* Ô Nhập Số lượng (bắt buộc điền tay) */}
              <div>
                <label htmlFor="modal-qty-input" className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-cyan-400">
                  Số lượng (Điền tay):
                </label>
                <input
                  id="modal-qty-input"
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

              {/* Nút Submit Lưu */}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleFinalSave()}
                className="w-full rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 py-4 font-cyber text-sm font-bold uppercase tracking-widest text-white shadow-xl shadow-cyan-900/40 transition hover:opacity-95 active:scale-95 disabled:opacity-50"
              >
                {busy ? 'ĐANG LƯU DỮ LIỆU...' : '💾 LƯU LƯỢT QUÉT (ENTER)'}
              </button>
            </div>
          )}

          {/* Thông báo lỗi / thành công */}
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

        {/* Bảng Streaming Danh Sách Đang Quét Hiện Tại */}
        <div className="border-t border-white/10 bg-black/50 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Streaming danh sách đang quét ({rows.length})
              </h3>
            </div>
            <button
              type="button"
              disabled={rows.length === 0}
              onClick={() => downloadStreamingExcel(rows)}
              className="rounded-xl border border-emerald-500/40 bg-emerald-900/40 px-3 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-800 disabled:opacity-40"
            >
              📥 EXPORT XLSX
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10">
            {rows.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">Chưa có lượt quét nào trong phiên.</p>
            ) : (
              <table className="w-full text-left font-mono text-xs">
                <thead className="sticky top-0 bg-slate-900 text-slate-400">
                  <tr>
                    <th className="px-2.5 py-2">TAG ID</th>
                    <th className="px-2.5 py-2">MÃ HÀNG</th>
                    <th className="px-2.5 py-2 text-right">SL</th>
                    <th className="px-2.5 py-2 text-right">BIN</th>
                    <th className="px-2.5 py-2 text-center">TRẠNG THÁI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.slice(0, 50).map((r) => {
                    const badge = STATUS_BADGE[r.status] ?? { text: r.status, bg: 'bg-slate-700' };
                    return (
                      <tr key={r.id} className="hover:bg-white/5">
                        <td className="px-2.5 py-1.5 font-bold text-cyan-300">{r.batch_id}</td>
                        <td className="px-2.5 py-1.5 text-slate-300">{r.stock_code || '—'}</td>
                        <td className="px-2.5 py-1.5 text-right font-bold text-white">{r.qty}</td>
                        <td className="px-2.5 py-1.5 text-right text-slate-300">{r.bin}</td>
                        <td className="px-2.5 py-1.5 text-center">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.bg}`}>
                            {badge.text}
                          </span>
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
