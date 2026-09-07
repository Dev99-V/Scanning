// Reference7055Card — Thẻ hiển thị & mở danh sách Tag in thêm 7055 đặt kế bên thẻ + Thêm Dữ Liệu Nguồn.
// Khi mở lên sẽ hiển thị bảng UI nổi (Modal) danh sách các tag in thêm với đầy đủ trường dữ liệu tương ứng,
// và có nút xuất Excel riêng biệt với tên "Tag in thêm 7055 [YYYY-MM-DD].xlsx".
import { useMemo, useState } from 'react';
import { download7055Excel } from '../lib/exportExcel';
import type { ReferenceLine } from './ReferenceDataTable';

interface Reference7055CardProps {
  rows7055: ReferenceLine[];
}

export default function Reference7055Card({ rows7055 }: Reference7055CardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Lọc theo từ khóa trong modal nổi
  const filtered7055 = useMemo(() => {
    if (!searchTerm.trim()) return rows7055;
    const term = searchTerm.trim().toLowerCase();
    return rows7055.filter(
      (r) =>
        (r.stock_code || '').toLowerCase().includes(term) ||
        (r.batch_id || '').toLowerCase().includes(term) ||
        (r.warehouse || '').toLowerCase().includes(term) ||
        (r.bin || '').toLowerCase().includes(term),
    );
  }, [rows7055, searchTerm]);

  function handleExportExcel() {
    if (rows7055.length === 0) return;
    download7055Excel(rows7055);
  }

  function formatDate(dStr?: string | null) {
    if (!dStr) return '—';
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return dStr;
      return d.toLocaleDateString('vi-VN');
    } catch {
      return dStr;
    }
  }

  return (
    <>
      {/* Thẻ hiển thị trên giao diện kế bên Thẻ Thêm Dữ Liệu Nguồn */}
      <div
        data-testid="ref-7055-card"
        className="rounded-2xl border border-purple-500/30 bg-slate-900/80 p-4 sm:p-5 shadow-lg flex flex-col justify-between"
      >
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-2">
              <span>🏷️</span> Tag in thêm (7055)
            </h3>
            <span
              data-testid="ref-7055-badge-count"
              className="self-start sm:self-auto rounded-lg border border-purple-500/40 bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300 shadow-sm"
            >
              {rows7055.length} tag đã ghi nhận
            </span>
          </div>

          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            Danh sách các Tag ID được in thêm khi tích chọn <strong>7055</strong> lúc thêm dữ liệu nguồn. Dữ liệu được lưu trữ chuyên biệt, có thể xem danh sách và xuất file Excel độc lập.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
          <button
            type="button"
            data-testid="btn-open-7055-modal"
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-purple-600/80 hover:bg-purple-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-md shadow-purple-600/20 hover:scale-[1.02] active:scale-95 transition"
          >
            <span>📋</span>
            <span>Mở Bảng Tag In Thêm ({rows7055.length})</span>
          </button>

          <button
            type="button"
            data-testid="btn-quick-export-7055"
            disabled={rows7055.length === 0}
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-950/40 px-3 py-2 text-xs font-bold text-purple-300 hover:bg-purple-900/50 hover:text-white disabled:opacity-40 disabled:pointer-events-none transition"
            title="Xuất file Excel danh sách Tag in thêm 7055"
          >
            <span>📥</span>
            <span>Xuất Excel</span>
          </button>
        </div>
      </div>

      {/* Modal UI Nổi hiển thị danh sách Tag in thêm 7055 */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-7055-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-6 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-4xl max-h-[90vh] flex-col rounded-3xl border border-purple-500/50 bg-slate-950 p-5 sm:p-6 shadow-2xl">
            {/* Header Modal */}
            <div className="flex items-center justify-between border-b border-purple-500/20 pb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl sm:text-3xl">🏷️</span>
                <div>
                  <h3 id="modal-7055-title" className="font-cyber text-base font-bold uppercase tracking-wider text-white">
                    Bảng Danh Sách Tag In Thêm 7055
                  </h3>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-purple-400 mt-0.5">
                    Tổng cộng: {rows7055.length} tag in thêm đã ghi nhận trong hệ thống
                  </p>
                </div>
              </div>

              <button
                type="button"
                aria-label="Đóng bảng tag in thêm"
                onClick={() => setIsOpen(false)}
                className="rounded-xl border border-white/10 p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
              >
                ✕
              </button>
            </div>

            {/* Thanh công cụ: Tìm kiếm & Nút Xuất Excel */}
            <div className="my-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="🔍 Tìm nhanh Tag ID, Mã hàng, Kho, Bin..."
                  className="w-full rounded-xl border border-purple-500/40 bg-black/60 px-3.5 py-2 font-mono text-xs text-purple-200 placeholder:text-slate-500 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              <button
                type="button"
                data-testid="btn-modal-export-7055"
                disabled={rows7055.length === 0}
                onClick={handleExportExcel}
                className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2.5 font-cyber text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-purple-600/20 hover:scale-[1.02] hover:shadow-purple-500/30 active:scale-95 disabled:opacity-50 disabled:pointer-events-none transition"
              >
                <span>📥</span>
                <span>Xuất Excel Tag In Thêm 7055</span>
              </button>
            </div>

            {/* Bảng dữ liệu nổi */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {rows7055.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 rounded-2xl border border-white/5 bg-black/40">
                  <span className="text-3xl mb-2">🏷️</span>
                  <p className="font-bold text-sm text-slate-300">Chưa có Tag nào được in thêm qua mã 7055.</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-md">
                    Khi thêm dữ liệu nguồn mới ở thẻ kế bên, hãy tích chọn ô &quot;7055&quot; để tag được tự động đưa vào danh sách đặc biệt này.
                  </p>
                </div>
              ) : filtered7055.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 rounded-2xl border border-white/5 bg-black/40">
                  <p className="text-xs text-slate-500">Không tìm thấy tag nào khớp với từ khóa &quot;{searchTerm}&quot;.</p>
                </div>
              ) : (
                <div className="overflow-y-auto overflow-x-auto rounded-2xl border border-white/10 bg-black/50 custom-scrollbar max-h-[50vh]">
                  <table className="w-full min-w-[650px] text-left font-mono text-xs">
                    <thead className="sticky top-0 z-10 bg-slate-950 text-purple-300 border-b border-purple-500/20 shadow">
                      <tr>
                        <th className="px-3 py-2.5">STT</th>
                        <th className="px-3 py-2.5">MÃ HÀNG (STOCK CODE)</th>
                        <th className="px-3 py-2.5">TAG ID (BATCH)</th>
                        <th className="px-3 py-2.5">KHO</th>
                        <th className="px-3 py-2.5 text-right">BIN</th>
                        <th className="px-3 py-2.5 text-right">SỐ LƯỢNG</th>
                        <th className="px-3 py-2.5 text-center">NGÀY TẠO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filtered7055.map((r, idx) => (
                        <tr
                          key={`${r.batch_id}-${idx}`}
                          data-testid={`row-7055-${r.batch_id}`}
                          className="hover:bg-purple-950/20 transition-colors"
                        >
                          <td className="px-3 py-2 text-slate-500 text-[11px]">{idx + 1}</td>
                          <td className="px-3 py-2 font-bold text-slate-200">{r.stock_code}</td>
                          <td className="px-3 py-2 font-bold text-purple-300">
                            <span className="inline-flex items-center gap-1.5">
                              <span>{r.batch_id}</span>
                              <span className="rounded-full border border-purple-500/40 bg-purple-500/20 px-1.5 py-0.2 text-[9px] text-purple-300 font-extrabold">
                                7055
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-2 text-slate-300">{r.warehouse}</td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-300">{r.bin}</td>
                          <td className="px-3 py-2 text-right font-bold text-white">{r.qty}</td>
                          <td className="px-3 py-2 text-center text-slate-400 text-[11px]">{formatDate(r.create_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer Modal */}
            <div className="flex items-center justify-between border-t border-white/10 pt-3 mt-3 text-xs text-slate-400">
              <span>
                Hiển thị <strong className="text-purple-300">{filtered7055.length}</strong> / {rows7055.length} tag 7055
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
