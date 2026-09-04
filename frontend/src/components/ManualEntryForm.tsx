// ManualEntryForm — nhập tay khi không qua PDA (Plan.md §7.1, Skills B).
// Gọi cùng API scan-submit với is_manual=true. Không dùng localStorage.
import { useState } from 'react';
import { submitScan, type DuplicateConflict, type ScanSuccess } from '../lib/scanApi';

interface ManualEntryFormProps {
  onScanned: (result: ScanSuccess) => void;
  onDuplicate: (conflict: DuplicateConflict) => void;
}

export default function ManualEntryForm({ onScanned, onDuplicate }: ManualEntryFormProps) {
  const [batchId, setBatchId] = useState('');
  const [bin, setBin] = useState('');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const b = batchId.trim();
    const bn = bin.trim();
    if (!b || !bn || busy) {
      if (!b || !bn) setNotice('Nhập đủ Tag ID và Vị trí.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await submitScan({ batchId: b, qty, bin: bn, isManual: true });
      if (outcome.kind === 'scanned') {
        onScanned(outcome.result);
        setBatchId('');
      } else if (outcome.kind === 'duplicate') {
        onDuplicate(outcome.conflict);
        setBatchId('');
      } else {
        setNotice(`Lỗi: ${outcome.message} (${outcome.code})`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Nhập tay" className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
        Nhập tay (không qua PDA)
      </h2>
      <form onSubmit={(e) => void handleSubmit(e)} className="grid grid-cols-2 gap-2">
        <input
          aria-label="Tag ID"
          type="text"
          value={batchId}
          disabled={busy}
          onChange={(e) => setBatchId(e.target.value)}
          placeholder="Tag ID"
          className="rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-cyan-300 placeholder:text-slate-600"
        />
        <input
          aria-label="Vị trí"
          type="text"
          value={bin}
          disabled={busy}
          onChange={(e) => setBin(e.target.value)}
          placeholder="Vị trí (Bin)"
          className="rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-cyan-300 placeholder:text-slate-600"
        />
        <input
          aria-label="Số lượng"
          type="number"
          min={1}
          value={qty}
          disabled={busy}
          onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          className="rounded-lg border border-white/10 bg-black/40 p-2 text-center font-mono text-cyan-300"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-emerald-600 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Ghi nhận
        </button>
      </form>
      {notice && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
          {notice}
        </p>
      )}
    </section>
  );
}
