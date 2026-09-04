// ReferenceDataTable — Bảng 2: dữ liệu hệ thống đã import (Plan.md §7.3).
// Read-only, tra cứu/đối soát thủ công, lọc theo kho (warehouse) / vị trí (bin).
// KHÔNG hiển thị cột BATCH/Tag ID: filter theo spec chỉ cần kho/bin, và tránh
// mọi tranh cãi về "hiển thị lại Tag ID nguồn" (Plan.md §4.4).
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface ReferenceLine {
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let q = supabase
        .from('reference_stock')
        .select('stock_code,warehouse,bin,qty')
        .order('stock_code', { ascending: true })
        .limit(500);
      if (warehouse.trim()) q = q.eq('warehouse', warehouse.trim());
      if (bin.trim()) q = q.eq('bin', bin.trim());
      const { data } = await q;
      if (cancelled) return;
      setRows((data ?? []) as ReferenceLine[]);
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [warehouse, bin]);

  return (
    <section aria-label="Dữ liệu hệ thống" className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
        Bảng 2 — Dữ liệu hệ thống
      </h2>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <input
          aria-label="Lọc theo kho"
          type="text"
          value={warehouse}
          onChange={(e) => setWarehouse(e.target.value)}
          placeholder="Lọc kho (vd 01)"
          className="rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-sm text-cyan-300 placeholder:text-slate-600"
        />
        <input
          aria-label="Lọc theo vị trí"
          type="text"
          value={bin}
          onChange={(e) => setBin(e.target.value)}
          placeholder="Lọc vị trí (vd C4)"
          className="rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-sm text-cyan-300 placeholder:text-slate-600"
        />
      </div>
      {loading ? (
        <p className="p-2 text-center text-sm text-slate-500">Đang tải...</p>
      ) : rows.length === 0 ? (
        <p data-testid="ref-empty" className="p-2 text-center text-sm text-slate-500">
          Không có dòng nào.
        </p>
      ) : (
        <div className="max-h-64 overflow-auto rounded-xl border border-white/10">
          <table className="w-full text-left font-mono text-xs">
            <thead className="sticky top-0 bg-slate-800 text-slate-400">
              <tr>
                <th className="px-2 py-2">STOCK CODE</th>
                <th className="px-2 py-2">KHO</th>
                <th className="px-2 py-2 text-right">BIN</th>
                <th className="px-2 py-2 text-right">SL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r, i) => (
                <tr key={`${r.stock_code}-${r.warehouse}-${r.bin}-${i}`} className="hover:bg-white/5">
                  <td className="px-2 py-1.5 text-slate-200">{r.stock_code}</td>
                  <td className="px-2 py-1.5 text-slate-300">{r.warehouse}</td>
                  <td className="px-2 py-1.5 text-right text-slate-300">{r.bin}</td>
                  <td className="px-2 py-1.5 text-right text-slate-200">{r.qty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
