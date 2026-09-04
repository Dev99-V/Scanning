// App — Phase 5: quét + bảng đối chiếu realtime + toast trùng (Plan.md §7).
// Bảng 2 (reference read-only) + export Excel ở Phase 6.
import { useState } from 'react';
import DuplicateAlertToast from './components/DuplicateAlertToast';
import ExportButton from './components/ExportButton';
import ManualEntryForm from './components/ManualEntryForm';
import PdaScanPanel from './components/PdaScanPanel';
import ReconciliationTable from './components/ReconciliationTable';
import ReferenceDataTable from './components/ReferenceDataTable';
import { useReferenceMap } from './hooks/useReferenceMap';
import { useScannedData } from './hooks/useScannedData';
import { resolveDuplicate, type DuplicateConflict } from './lib/scanApi';

export default function App() {
  const { rows } = useScannedData();
  const { byBatch } = useReferenceMap();
  const [conflict, setConflict] = useState<DuplicateConflict | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  async function handleResolve(action: 'append' | 'relocate') {
    if (!conflict || resolving) return;
    setResolving(true);
    setResolveError(null);
    try {
      const outcome = await resolveDuplicate({
        action,
        scannedId: conflict.existingId,
        batchId: conflict.attempted.batchId,
        qty: conflict.attempted.qty,
        bin: conflict.attempted.bin,
      });
      if (outcome.kind === 'resolved') {
        setConflict(null); // bảng tự cập nhật qua realtime
      } else {
        setResolveError(`Lỗi: ${outcome.message} (${outcome.code})`);
      }
    } finally {
      setResolving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 p-4">
      <header className="pt-4 text-center">
        <h1 className="text-2xl font-black tracking-widest text-white">PDA AI MAPPING</h1>
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-indigo-400">
          Core System Active
        </p>
      </header>

      <PdaScanPanel onScanned={() => setConflict(null)} onDuplicate={setConflict} />
      <ManualEntryForm onScanned={() => setConflict(null)} onDuplicate={setConflict} />

      <section aria-label="Đối chiếu">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
          Bảng 1 — Đối chiếu ({rows.length})
        </h2>
        <ReconciliationTable rows={rows} systemByBatch={byBatch} />
      </section>

      <ExportButton rows={rows} systemByBatch={byBatch} />
      <ReferenceDataTable />

      {conflict && (
        <DuplicateAlertToast
          conflict={conflict}
          busy={resolving}
          onResolve={(a) => void handleResolve(a)}
          onDismiss={() => setConflict(null)}
        />
      )}
      {resolveError && (
        <p role="alert" className="rounded-lg bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
          {resolveError}
        </p>
      )}
    </main>
  );
}
