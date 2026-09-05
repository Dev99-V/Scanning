// ReferenceDataTable — Bảng 2: dữ liệu hệ thống đã import (Plan.md §7.3).
// Read-only, tra cứu/đối soát thủ công, lọc theo kho (warehouse) / vị trí (bin).
// Tích hợp Thẻ Import file nguồn (Stock Balance With Batch.xlsx).
// Hỗ trợ cuộn chuột tải 100 dòng tự động tiếp theo (Infinite Scroll).
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import ReferenceImportCard from './ReferenceImportCard';

export interface ReferenceLine {
  stock_code: string;
  warehouse: string;
  bin: string;
  qty: number;
}

export default function ReferenceDataTable() {
  const [rows, setRows] = useState<ReferenceLine[]>([]);
  const [warehouse, setWarehouse] = useState('');
  const [bin, setBin] = useState('');
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(100);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let q = supabase
        .from('reference_stock')
        .select('stock_code,warehouse,bin,qty')
        .order('stock_code', { ascending: true })
        .limit(5000);
      if (warehouse.trim()) q = q.eq('warehouse', warehouse.trim());
      if (bin.trim()) q = q.eq('bin', bin.trim());
      const { data } = await q;
      if (cancelled) return;
      setRows((data ?? []) as ReferenceLine[]);
      setVisibleCount(100);
      setLoading(false);
    }
    void load();

    return () => {
      cancelled = true;
    };
  }, [warehouse, bin, refreshTrigger]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visibleCount < rows.length) {
      setVisibleCount((prev) => Math.min(prev + 100, rows.length));
    }
  }

  const displayedRows = rows.slice(0, visibleCount);

  return (
    <section aria-label="Dữ liệu hệ thống" className="flex flex-col gap-4">
      {/* Thẻ Import file nguồn */}
      <ReferenceImportCard onImportSuccess={() => setRefreshTrigger((prev) => prev + 1)} />

      {/* Bảng dữ liệu nguồn tra cứu */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 sm:p-5 shadow-lg">
        <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex items-center gap-2">
              <span>📂</span> Bảng 2 — Dữ liệu file nguồn ({rows.length.toLocaleString()} dòng)
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Danh sách tồn kho theo vị trí đã nạp vào hệ thống để tra cứu khi cần.
            </p>
          </div>

          {/* Bộ lọc Kho & Vị trí */}
          <div className="grid grid-cols-2 gap-2 w-full sm:w-72">
            <input
              aria-label="Lọc theo kho"
              type="text"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              placeholder="Lọc kho (vd 01)"
              className="rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            />
            <input
              aria-label="Lọc theo vị trí"
              type="text"
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              placeholder="Lọc vị trí (vd C4)"
              className="rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-slate-400">⏳ Đang tải dữ liệu nguồn...</p>
        ) : rows.length === 0 ? (
          <p data-testid="ref-empty" className="p-6 text-center text-sm text-slate-500">
            Không có dòng nào khớp với bộ lọc.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              onScroll={handleScroll}
              className="max-h-[420px] overflow-y-auto overflow-x-auto rounded-xl border border-white/10 bg-black/30 custom-scrollbar"
            >
              <table className="w-full min-w-[500px] text-left font-mono text-xs">
                <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2.5">STOCK CODE</th>
                    <th className="px-3 py-2.5">KHO</th>
                    <th className="px-3 py-2.5 text-right">BIN</th>
                    <th className="px-3 py-2.5 text-right">SỐ LƯỢNG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayedRows.map((r, i) => (
                    <tr key={`${r.stock_code}-${r.warehouse}-${r.bin}-${i}`} className="hover:bg-white/5 transition-colors">
                      <td className="px-3 py-2 font-bold text-slate-200">{r.stock_code}</td>
                      <td className="px-3 py-2 text-slate-300">{r.warehouse}</td>
                      <td className="px-3 py-2 text-right font-semibold text-cyan-300">{r.bin}</td>
                      <td className="px-3 py-2 text-right font-bold text-white">{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer thanh cuộn thông báo */}
            <div className="flex items-center justify-between px-2 text-[11px] text-slate-400">
              <span>
                Đang hiển thị <strong className="text-cyan-300">{displayedRows.length}</strong> /{' '}
                <strong className="text-white">{rows.length.toLocaleString()}</strong> dòng nguồn
              </span>
              {visibleCount < rows.length && (
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => Math.min(prev + 100, rows.length))}
                  className="font-bold text-indigo-400 hover:text-indigo-300 transition underline"
                >
                  Cuộn xuống hoặc bấm tải tiếp 100 dòng (còn {(rows.length - visibleCount).toLocaleString()} dòng)
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
