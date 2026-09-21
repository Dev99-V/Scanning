// InventoryTable — Bảng 3 kiểm kê full nằm cuối trang (theo dõi trực tiếp).
// Cột: STOCK CODE | TAG ID | BIN KK | SL KK | BIN B1 | SL B1 | BIN HT (B2) |
// SL HT (B2) | Cảnh báo đối chiếu chéo | Xóa. Nút Quét Kiểm Kê mở modal,
// nút Export XLSX xuất toàn bảng. Bảng streaming nhỏ trong modal giữ nguyên
// chỉ để theo dõi trong lúc quét.
import React, { useState } from 'react';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import { downloadInventoryExcel } from '../lib/exportExcel';
import { compareInventoryRow } from '../lib/inventoryCompare';
import { supabase } from '../lib/supabase';
import type { InventoryRow, ScanRow } from '../lib/types';

interface InventoryTableProps {
  inventoryRows: InventoryRow[];
  scannedRows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
  onOpenScan: () => void;
  onChanged?: () => void;
}

export default function InventoryTable({
  inventoryRows,
  scannedRows,
  systemByBatch,
  onOpenScan,
  onChanged,
}: InventoryTableProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [mismatchOnly, setMismatchOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(100);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function handleDeleteRow(id: string, batchId: string) {
    if (!window.confirm(`Xóa dòng kiểm kê ${batchId}?`)) return;
    setDeletingId(id);
    setNotice(null);
    try {
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

      {notice && (
        <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
          {notice}
        </p>
      )}

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
                <th className="px-3 py-3 text-center">XÓA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayedRows.map(({ row: r, cmp }) => {
                const stockCode = r.stock_code ?? cmp.systemStockCode ?? '—';
                return (
                  <tr key={r.id} data-testid={`inventory-row-${r.id}`} className="hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2.5 font-bold text-slate-200">{stockCode}</td>
                    <td className="px-3 py-2.5 font-bold text-cyan-300">{r.batch_id}</td>
                    <td className="px-3 py-2.5 text-right text-white">{r.bin}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-white">{r.qty}</td>
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
                      <button
                        type="button"
                        disabled={deletingId === r.id}
                        onClick={() => void handleDeleteRow(r.id, r.batch_id)}
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
    </div>
  );
}
