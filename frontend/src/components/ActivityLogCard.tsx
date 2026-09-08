// ActivityLogCard — Thẻ Nhật ký hoạt động ở khu vực thẻ Bảng 2.
// Hiển thị "ai làm gì": quét PDA / thêm-ghi đè mã nguồn / import file /
// sửa SL-Bin nguồn / sửa-xóa lượt quét — streaming realtime cho nhiều người.
// Có ô tìm kiếm (tên / hành động / Tag ID) + nút export Excel.
import React, { useMemo, useState } from 'react';
import { useAuditLog } from '../hooks/useAuditLog';
import { actorDisplayName, describeAuditEntry } from '../lib/auditLog';
import { downloadAuditExcel } from '../lib/exportExcel';

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('vi-VN', { hour12: false });
  } catch {
    return iso;
  }
}

export default function ActivityLogCard() {
  const { entries, loading } = useAuditLog();
  const [filter, setFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(100);

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((e) => {
      const d = describeAuditEntry(e);
      return (
        actorDisplayName(e).toLowerCase().includes(term) ||
        d.actionLabel.toLowerCase().includes(term) ||
        d.tagId.toLowerCase().includes(term) ||
        d.detail.toLowerCase().includes(term)
      );
    });
  }, [entries, filter]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visibleCount < filtered.length) {
      setVisibleCount((prev) => Math.min(prev + 100, filtered.length));
    }
  }

  const displayed = filtered.slice(0, visibleCount);

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-slate-900/80 p-4 sm:p-5 shadow-lg">
      <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-2">
            <span>🧾</span> Nhật Ký Hoạt Động ({entries.length.toLocaleString()} dòng gần nhất)
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Cập nhật trực tiếp hoạt động của hệ thống.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            aria-label="Tìm kiếm nhật ký"
            type="text"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setVisibleCount(100);
            }}
            placeholder="🔍 Tìm tên, hành động, Tag ID..."
            className="w-full sm:w-64 rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => downloadAuditExcel(filtered)}
            disabled={filtered.length === 0}
            title="Xuất nhật ký đang hiển thị ra Excel"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-md hover:opacity-90 active:scale-95 disabled:opacity-40 transition whitespace-nowrap"
          >
            <span>📤</span>
            <span>Export</span>
          </button>
        </div>
      </div>

      {loading ? (
        <p className="p-6 text-center text-sm text-slate-400">⏳ Đang tải nhật ký hoạt động...</p>
      ) : filtered.length === 0 ? (
        <p data-testid="audit-empty" className="p-6 text-center text-sm text-slate-500">
          {entries.length === 0 ? 'Chưa có hoạt động nào được ghi nhận.' : 'Không có dòng nào khớp với tìm kiếm.'}
        </p>
      ) : (
        <div
          onScroll={handleScroll}
          className="max-h-[320px] overflow-y-auto overflow-x-auto rounded-xl border border-white/10 bg-black/30 custom-scrollbar"
        >
          <table className="w-full min-w-[640px] text-left font-mono text-xs">
            <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 border-b border-white/10 shadow">
              <tr>
                <th className="px-3 py-2.5">THỜI GIAN</th>
                <th className="px-3 py-2.5">NGƯỜI LÀM</th>
                <th className="px-3 py-2.5">HÀNH ĐỘNG</th>
                <th className="px-3 py-2.5">TAG ID</th>
                <th className="px-3 py-2.5">CHI TIẾT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {displayed.map((e) => {
                const d = describeAuditEntry(e);
                return (
                  <tr key={e.id} data-testid="audit-row" className="hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{formatTime(e.created_at)}</td>
                    <td className="px-3 py-2 font-bold text-cyan-300">{actorDisplayName(e)}</td>
                    <td className="px-3 py-2">
                      <span className="inline-block rounded-full border border-amber-500/40 bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                        {d.actionLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-200">{d.tagId}</td>
                    <td className="px-3 py-2 text-slate-300">{d.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visibleCount < filtered.length && (
        <button
          type="button"
          onClick={() => setVisibleCount((prev) => Math.min(prev + 100, filtered.length))}
          className="mt-2 text-[11px] font-bold text-amber-400 hover:text-amber-300 transition underline"
        >
          Tải tiếp 100 dòng (còn {(filtered.length - visibleCount).toLocaleString()} dòng)
        </button>
      )}
    </div>
  );
}
