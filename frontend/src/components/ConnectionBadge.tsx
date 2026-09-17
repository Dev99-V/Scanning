// ConnectionBadge — chỉ báo sức khỏe realtime THẬT (thay chữ cứng "Đang online").
// Đọc health gom từ mọi channel qua lib/realtime (resilientSubscribe báo về).
// - connected: ● Realtime (xanh) — socket + subscription sống.
// - connecting: ● Đang kết nối... (xám, lần đầu mount).
// - reconnecting: ● Đang nối lại... (vàng nhấp nháy — đang rớt, sẽ tự nối + refetch bù).
import { useEffect, useState } from 'react';
import { getOverallStatus, subscribeHealth, type RealtimeChannelState } from '../lib/realtime';

const LABEL: Record<RealtimeChannelState, string> = {
  connected: '● Realtime',
  connecting: '● Đang kết nối...',
  reconnecting: '● Đang nối lại...',
};

const STYLE: Record<RealtimeChannelState, string> = {
  connected: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  connecting: 'border-white/10 bg-white/5 text-slate-400',
  reconnecting: 'border-amber-500/50 bg-amber-500/15 text-amber-300 animate-pulse',
};

const TITLE: Record<RealtimeChannelState, string> = {
  connected: 'Realtime đang hoạt động — dữ liệu đa người tự cập nhật',
  connecting: 'Đang thiết lập kết nối realtime...',
  reconnecting:
    'Mất kết nối realtime — hệ thống tự nối lại và tải bù dữ liệu. Vẫn thao tác được, nhưng màn hình có thể chậm vài giây.',
};

export default function ConnectionBadge() {
  const [status, setStatus] = useState<RealtimeChannelState>(() => getOverallStatus());

  useEffect(() => {
    // Đồng bộ lại lúc mount (health có thể đổi giữa init state và subscribe).
    // eslint-disable-next-line react/set-state-in-effect
    setStatus(getOverallStatus());
    return subscribeHealth(setStatus);
  }, []);

  return (
    <span
      data-testid="realtime-status"
      data-status={status}
      title={TITLE[status]}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${STYLE[status]}`}
    >
      {LABEL[status]}
    </span>
  );
}
