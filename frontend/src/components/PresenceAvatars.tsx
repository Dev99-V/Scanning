// PresenceAvatars — dải avatar realtime ở header mỗi bảng (kiểu Excel co-editing).
// Hiện ai đang XEM bảng này + ai đang SỬA dòng nào (badge 🔒).
import { initialForName, type PresencePeer } from '../hooks/presenceHelpers';

interface PresenceAvatarsProps {
  /** Người đang xem/sửa bảng này (đã lọc ở App qua viewersOfTable). */
  users: PresencePeer[];
  /** Nhãn bảng để test/a11y, vd "Bảng 1". */
  tableLabel: string;
  compact?: boolean;
}

export default function PresenceAvatars({ users, tableLabel, compact }: PresenceAvatarsProps) {
  if (users.length === 0) return null;
  const editors = users.filter((u) => u.editing);
  return (
    <div
      aria-label={`Đang hoạt động ở ${tableLabel}`}
      data-testid={`presence-${tableLabel}`}
      className="flex flex-wrap items-center gap-2"
    >
      <div className="flex -space-x-2">
        {users.slice(0, 5).map((u) => (
          <span
            key={u.sessionId}
            title={`${u.name}${u.editing ? ` — đang sửa ${u.editing.batchId || 'dòng dữ liệu'}` : ' — đang xem'}`}
            className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-900 text-[11px] font-black text-white"
            style={{ backgroundColor: u.color }}
          >
            {initialForName(u.name)}
          </span>
        ))}
      </div>
      {!compact && (
        <p className="text-[11px] text-slate-300">
          {users.slice(0, 3).map((u) => (
            <span key={u.sessionId} className="mr-2 inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              <strong style={{ color: u.color }}>{u.name}</strong>
              {u.editing ? (
                <span className="text-amber-300">
                  đang sửa {u.editing.batchId ? <code>{u.editing.batchId}</code> : 'dòng dữ liệu'}
                </span>
              ) : (
                <span className="text-slate-400">đang xem</span>
              )}
            </span>
          ))}
          {users.length > 3 && <span className="text-slate-500">+{users.length - 3} người khác</span>}
        </p>
      )}
      {editors.length > 0 && (
        <span className="rounded-full border border-amber-500/40 bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold text-amber-300">
          🔒 {editors.length} dòng đang bị khóa
        </span>
      )}
    </div>
  );
}
