// OnlineUsersModal — danh sách người dùng đang online theo thời gian thực (Supabase Presence).
import { useEffect } from 'react';
import { initialForName, type PresenceIdentity, type PresencePeer } from '../hooks/presenceHelpers';

export interface OnlineUsersModalProps {
  open: boolean;
  onClose: () => void;
  currentUser: PresenceIdentity | null;
  peers: PresencePeer[];
  onlineCount: number;
}

export default function OnlineUsersModal({
  open,
  onClose,
  currentUser,
  peers,
  onlineCount,
}: OnlineUsersModalProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Danh sách người dùng đang online"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-slate-900 p-5 sm:p-6 shadow-2xl shadow-emerald-500/10 flex flex-col max-h-[85vh]">
        {/* Header modal */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">👥</span>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
                Người Dùng Đang Online
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/30">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  {onlineCount}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Cập nhật tự động thời gian thực khi vào / thoát
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-xl border border-white/10 p-1.5 text-slate-400 hover:text-white hover:bg-white/5 transition cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Danh sách người dùng */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2 pr-1 custom-scrollbar">
          {/* Người dùng hiện tại (Bạn) */}
          {currentUser && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-500/40 bg-indigo-950/20 p-3">
              <div className="flex items-center gap-3 min-w-0">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black text-white shadow-md"
                  style={{ backgroundColor: currentUser.color }}
                >
                  {initialForName(currentUser.name)}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white truncate">{currentUser.name}</p>
                    <span className="shrink-0 rounded bg-indigo-500/30 px-1.5 py-0.5 text-[9px] font-bold text-indigo-300">
                      Bạn (Tab này)
                    </span>
                  </div>
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1 mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                    Đang trực tuyến
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-xs text-slate-400 font-mono">Phiên hiện tại</span>
            </div>
          )}

          {/* Danh sách peers khác */}
          {peers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-slate-400 my-2">
              <span className="text-2xl block mb-1">👀</span>
              <p className="text-xs font-semibold text-slate-300">Chưa có người dùng khác online</p>
              <p className="text-[10px] text-slate-500 mt-1">
                Khi đồng nghiệp mở hệ thống trên máy tính hoặc máy quét PDA khác, tên sẽ tự động xuất hiện ở đây.
              </p>
            </div>
          ) : (
            peers.map((peer) => {
              const actionText = peer.editing
                ? `Đang sửa Tag: ${peer.editing.batchId || peer.editing.key} (${peer.editing.table === 'table2' ? 'Bảng 2' : 'Bảng 1'})`
                : peer.viewing === 'table2'
                ? 'Đang xem Bảng 2 (Dữ liệu nguồn)'
                : 'Đang xem Bảng 1 (Quét & Đối chiếu)';

              return (
                <div
                  key={peer.sessionId}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-950/40 p-3 hover:bg-slate-950/60 transition"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black text-white shadow-md"
                      style={{ backgroundColor: peer.color }}
                    >
                      {initialForName(peer.name)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-white truncate">{peer.name}</p>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5" title={actionText}>
                        {actionText}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                    Online
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-500">
          <span>Tự động rời danh sách khi đóng tab</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-800 hover:bg-slate-700 px-4 py-2 text-xs font-bold text-white transition cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
