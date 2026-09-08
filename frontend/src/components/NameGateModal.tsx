// NameGateModal — cổng bắt buộc đặt tên trước khi vào hệ thống (avatar streaming).
// Mỗi tab = 1 session presence riêng; tên lưu sessionStorage (UI state, không
// phải dữ liệu quét nên không vi phạm quy tắc no-localStorage nghiệp vụ).
import { useState } from 'react';
import { validateDisplayName } from '../hooks/useIdentity';
import { colorForName, initialForName } from '../hooks/presenceHelpers';

interface NameGateModalProps {
  open: boolean;
  onSubmit: (name: string) => string | null;
}

export default function NameGateModal({ open, onSubmit }: NameGateModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const preview = name.trim() || '?';

  function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const err = validateDisplayName(name) ?? onSubmit(name.trim());
    setError(err);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Đặt tên để vào hệ thống"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-3xl border border-cyan-500/30 bg-slate-900 p-6 shadow-2xl shadow-cyan-500/20"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden
            className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-black text-white shadow-lg"
            style={{ backgroundColor: colorForName(preview) }}
          >
            {initialForName(preview)}
          </span>
          <h2 className="font-cyber text-base font-black uppercase tracking-widest text-white">
            Xác Nhận Danh Tính
          </h2>
          <p className="text-xs text-cyan-300 font-semibold">
            Bắt buộc đặt tên để vào hệ thống
          </p>
          <p className="text-[11px] text-slate-400">
            Tên của bạn sẽ hiển thị trong danh sách Online và lưu vào nhật ký hoạt động kiểm kê.
          </p>
        </div>
        <label htmlFor="presence-name" className="mt-4 block text-left text-[11px] font-bold uppercase tracking-widest text-slate-300">
          Tên hiển thị (2–20 ký tự) *
        </label>
        <input
          id="presence-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          placeholder="VD: Name?"
          autoFocus
          maxLength={20}
          className="mt-1 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-cyan-400"
        />
        {error && (
          <p role="alert" className="mt-2 text-xs font-bold text-rose-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-4 py-3 text-sm font-black uppercase tracking-widest text-white shadow-lg transition-transform hover:scale-[1.01] active:scale-95"
        >
          Vào hệ thống →
        </button>
        <p className="mt-2 text-center text-[10px] text-slate-500">
          User streaming realtime.
        </p>
      </form>
    </div>
  );
}
