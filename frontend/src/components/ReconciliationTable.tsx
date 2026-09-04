// ReconciliationTable — Bảng 1: dữ liệu quét thực tế & đối chiếu (Plan.md §7.2).
// Mỗi hàng = 1 lượt quét: Tag ID + Qty quét vs Qty hệ thống + Bin quét vs Bin
// hệ thống + cờ trạng thái màu ngay trên hàng (inline). Toast chỉ dành cho
// trùng — các cảnh báo qty/bin/not_in_reference hiển thị inline tại đây.
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
  pending: 'bg-slate-700 text-slate-200',
  ok: 'bg-emerald-900/60 text-emerald-200',
  qty_mismatch: 'bg-amber-900/60 text-amber-200',
  bin_mismatch: 'bg-amber-900/60 text-amber-200',
  not_in_reference: 'bg-sky-900/60 text-sky-200',
  duplicate: 'bg-rose-900/60 text-rose-200',
};

interface ReconciliationTableProps {
  rows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
}

export default function ReconciliationTable({ rows, systemByBatch }: ReconciliationTableProps) {
  if (rows.length === 0) {
    return (
      <p data-testid="recon-empty" className="rounded-xl border border-white/10 p-4 text-center text-sm text-slate-400">
        Chưa có lượt quét nào.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left font-mono text-xs">
        <thead className="bg-white/5 text-slate-400">
          <tr>
            <th className="px-2 py-2">TAG ID</th>
            <th className="px-2 py-2 text-right">SL QUÉT</th>
            <th className="px-2 py-2 text-right">SL HỆ THỐNG</th>
            <th className="px-2 py-2 text-right">BIN QUÉT</th>
            <th className="px-2 py-2 text-right">BIN HỆ THỐNG</th>
            <th className="px-2 py-2 text-center">TRẠNG THÁI</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => {
            const sys = systemByBatch.get(r.batch_id);
            return (
              <tr key={r.id} data-testid={`recon-row-${r.id}`} className="hover:bg-white/5">
                <td className="px-2 py-2 font-bold text-cyan-300">{r.batch_id}</td>
                <td className="px-2 py-2 text-right text-slate-200">{r.qty}</td>
                <td className="px-2 py-2 text-right text-slate-400">{sys ? sys.qty : '—'}</td>
                <td className="px-2 py-2 text-right text-slate-200">{r.bin}</td>
                <td className="px-2 py-2 text-right text-slate-400">{sys ? sys.bin || '—' : '—'}</td>
                <td className="px-2 py-2 text-center">
                  <span
                    className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CLASS[r.status]}`}
                  >
                    {STATUS_LABEL[r.status]}
                    {r.resolution ? ` · ${r.resolution === 'appended' ? 'ghi thêm' : 'đổi vị trí'}` : ''}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
