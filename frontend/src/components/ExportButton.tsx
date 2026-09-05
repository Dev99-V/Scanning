// ExportButton — nút xuất Excel đối chiếu (Plan.md §7.5).
import type { SystemNumbers } from '../hooks/useReferenceMap';
import type { ScanRow } from '../lib/types';
import { downloadReconExcel } from '../lib/exportExcel';

interface ExportButtonProps {
  rows: ScanRow[];
  systemByBatch: Map<string, SystemNumbers>;
}

export default function ExportButton({ rows, systemByBatch }: ExportButtonProps) {
  return (
    <button
      type="button"
      disabled={rows.length === 0}
      onClick={() => downloadReconExcel(rows, systemByBatch)}
      className="rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
    >
      📥 EXPORT XLSX ({rows.length})
    </button>
  );
}
