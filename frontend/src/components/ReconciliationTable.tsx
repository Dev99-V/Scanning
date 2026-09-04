// ReconciliationTable — Bảng 1: dữ liệu quét thực tế & đối chiếu (Plan.md §7.2).
// Cột: Stock code, Tag id, Số lượng, Bin, Số lượng hệ thống, Bin hệ thống, Trạng thái & Ghi chú cảnh báo.
// Hỗ trợ cuộn chuột 100 dòng tự động tải tiếp (Infinite Scroll / Virtualization Chunking).
import React, { useState } from 'react';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import type { ScanStatus } from '../lib/scanApi';
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
  qty_mismatch: 'bg-amber-950/80 text-amber-300 border-amber-500/40',
  bin_mismatch: 'bg-amber-950/80 text-amber-300 border-amber-500/40',
  not_in_reference: 'bg-sky-950/80 text-sky-300 border-sky-500/40',
  duplicate: 'bg-rose-950/80 text-rose-300 border-rose-500/40',
};

interface ReconciliationTableProps {
  rows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
}

export default function ReconciliationTable({ rows, systemByBatch }: ReconciliationTableProps) {
  const [visibleCount, setVisibleCount] = useState(100);

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
    if (nearBottom && visibleCount < rows.length) {
      setVisibleCount((prev) => Math.min(prev + 100, rows.length));
    }
  }

  const displayedRows = rows.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-2">
      <div
        onScroll={handleScroll}
        className="max-h-[500px] overflow-y-auto overflow-x-auto rounded-2xl border border-white/10 bg-slate-900/80 shadow-inner custom-scrollbar"
      >
        <table className="w-full min-w-[720px] text-left font-mono text-xs">
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

                  {/* Tag ID */}
                  <td className="px-3 py-2.5 font-bold text-cyan-300">{r.batch_id}</td>

                  {/* Số lượng quét */}
                  <td className="px-3 py-2.5 text-right font-bold text-white">{r.qty}</td>

                  {/* Số lượng hệ thống (cảnh báo nếu sai lệch) */}
                  <td
                    className={`px-3 py-2.5 text-right ${
                      isQtyDiff ? 'font-bold text-amber-400 underline decoration-amber-400/50' : 'text-slate-400'
                    }`}
                  >
                    {sys ? sys.qty : '—'}
                  </td>

                  {/* Bin quét */}
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-200">{r.bin}</td>

                  {/* Bin hệ thống (cảnh báo nếu sai lệch) */}
                  <td
                    className={`px-3 py-2.5 text-right ${
                      isBinDiff ? 'font-bold text-amber-400 underline decoration-amber-400/50' : 'text-slate-400'
                    }`}
                  >
                    {sys ? sys.bin || '—' : '—'}
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

                  {/* Ghi chú cảnh báo */}
                  <td className="px-3 py-2.5 text-left text-[11px]">
                    {r.status === 'ok' ? (
                      <span className="text-emerald-400 font-semibold">{note}</span>
                    ) : (
                      <span className="text-amber-300/90 font-medium">{note}</span>
                    )}
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
          <strong className="text-white">{rows.length}</strong> lượt quét
        </span>
        {visibleCount < rows.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((prev) => Math.min(prev + 100, rows.length))}
            className="font-bold text-indigo-400 hover:text-indigo-300 transition underline"
          >
            Cuộn xuống hoặc bấm tải tiếp 100 dòng (còn {rows.length - visibleCount} dòng)
          </button>
        )}
      </div>
    </div>
  );
}
