// PdaScanPanel — khu vực quét PDA, 2 mode Vị trí → Tag ID (Plan.md §7.1,
// UX kế thừa scantag.html nhưng viết lại bằng React typed).
// - PDA wedge = gõ nhanh + Enter: xử lý onKeyDown Enter, KHÔNG debounce.
// - Input luôn auto-focus. Quét Bin xong tự chuyển sang mode Tag.
// - Guard WAITING...: chưa quét Bin thì không cho quét Tag.
// - Chỉ giữ state UI (mode, bin hiện tại) trong memory — KHÔNG localStorage
//   cho dữ liệu nghiệp vụ (Plan.md §2).
import { useEffect, useRef, useState } from 'react';
import { submitScan, type DuplicateConflict, type ScanSuccess } from '../lib/scanApi';

type Mode = 'location' | 'tag';

export const WAITING_BIN = 'WAITING...';

interface PdaScanPanelProps {
  onScanned: (result: ScanSuccess) => void;
  onDuplicate: (conflict: DuplicateConflict) => void;
}

export default function PdaScanPanel({ onScanned, onDuplicate }: PdaScanPanelProps) {
  const [mode, setMode] = useState<Mode>('location');
  const [activeBin, setActiveBin] = useState<string>(WAITING_BIN);
  const [value, setValue] = useState('');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  async function handleEnter(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    if (mode === 'location') {
      setActiveBin(text);
      setValue('');
      setNotice(null);
      setMode('tag'); // tự chuyển sang quét Tag sau khi quét Vị trí
      return;
    }
    // mode tag
    if (activeBin === WAITING_BIN) {
      setNotice('Vui lòng quét VỊ TRÍ trước khi quét Tag ID!');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await submitScan({ batchId: text, qty, bin: activeBin, isManual: false });
      if (outcome.kind === 'scanned') {
        onScanned(outcome.result);
        setValue('');
      } else if (outcome.kind === 'duplicate') {
        onDuplicate(outcome.conflict);
        setValue('');
      } else {
        setNotice(`Lỗi: ${outcome.message} (${outcome.code})`);
      }
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function resetBin() {
    setActiveBin(WAITING_BIN);
    setValue('');
    setNotice(null);
    setMode('location');
  }

  return (
    <section aria-label="Quét PDA" className="rounded-2xl border border-indigo-500/40 bg-slate-900/70 p-5">
      <div className="mb-3 flex gap-2" role="group" aria-label="Chế độ quét">
        <button
          type="button"
          onClick={() => setMode('location')}
          aria-pressed={mode === 'location'}
          className={`flex-1 rounded-xl py-2 text-xs font-bold uppercase tracking-wider ${
            mode === 'location' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          📍 Vị Trí
        </button>
        <button
          type="button"
          onClick={() => setMode('tag')}
          aria-pressed={mode === 'tag'}
          className={`flex-1 rounded-xl py-2 text-xs font-bold uppercase tracking-wider ${
            mode === 'tag' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300'
          }`}
        >
          🏷️ Tag ID
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between border-b border-indigo-500/30 pb-2">
        <span className="text-[10px] font-bold uppercase text-indigo-400">Active Bin:</span>
        <span className="font-mono text-lg font-bold text-cyan-400" data-testid="active-bin">
          {activeBin}
        </span>
      </div>

      <label htmlFor="pda-scan-input" className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-indigo-400">
        Scanning: {mode === 'location' ? 'LOCATION' : 'TAG ID'}
      </label>
      <input
        id="pda-scan-input"
        ref={inputRef}
        autoFocus
        type="text"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleEnter(value);
        }}
        placeholder="READY TO SCAN..."
        className="w-full rounded-2xl border-2 border-indigo-500/50 bg-black/40 p-4 text-center font-mono text-xl font-bold text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
      />

      {mode === 'tag' && (
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor="pda-qty" className="text-[10px] font-bold uppercase text-indigo-400">
            Qty:
          </label>
          <input
            id="pda-qty"
            type="number"
            min={1}
            value={qty}
            disabled={busy}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="w-24 rounded-lg border border-white/10 bg-black/40 p-2 text-center font-mono text-cyan-300"
          />
          <button
            type="button"
            onClick={resetBin}
            className="ml-auto text-[10px] font-bold text-rose-400 hover:text-rose-300"
          >
            🔄 RESET BIN
          </button>
        </div>
      )}

      {notice && (
        <p role="alert" className="mt-3 rounded-lg bg-rose-900/40 px-3 py-2 text-sm text-rose-200">
          {notice}
        </p>
      )}
    </section>
  );
}
