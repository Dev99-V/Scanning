// DuplicateAlertToast — cảnh báo nổi khi trùng Tag ID (Plan.md §6, Skills B).
// Non-blocking (fixed góc màn hình): 2 lựa chọn Ghi thêm / Đổi vị trí.
// Cả 2 action đều đi qua resolve-duplicate và ghi audit ở backend.
import type { DuplicateConflict } from '../lib/scanApi';

interface DuplicateAlertToastProps {
  conflict: DuplicateConflict;
  busy: boolean;
  onResolve: (action: 'append' | 'relocate') => void;
  onDismiss: () => void;
}

export default function DuplicateAlertToast({ conflict, busy, onResolve, onDismiss }: DuplicateAlertToastProps) {
  return (
    <div
      role="alertdialog"
      aria-label="Trùng Tag ID"
      className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl border border-rose-500/50 bg-slate-900/95 p-4 shadow-2xl shadow-rose-900/40"
    >
      <p className="mb-1 text-sm font-bold text-rose-300">⚠️ Trùng Tag ID</p>
      <p className="mb-3 font-mono text-xs text-slate-300">
        {conflict.attempted.batchId} đã được quét tại {conflict.attempted.bin || '—'}.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve('append')}
          className="flex-1 rounded-xl bg-rose-600 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50"
        >
          Ghi thêm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve('relocate')}
          className="flex-1 rounded-xl bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Đổi vị trí
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 w-full text-center text-[11px] text-slate-500 hover:text-slate-300"
      >
        Để sau
      </button>
    </div>
  );
}
