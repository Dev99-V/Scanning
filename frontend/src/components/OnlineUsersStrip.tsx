// OnlineUsersStrip — dải avatar từng người online ngay trên header, cạnh nút Quét Tag.
// Thay kiểu gộp "Online (N)": mỗi peer 1 chip riêng (avatar màu + tên + chấm xanh),
// người mới vào trượt từ trái sang (animate-online-in), người thoát trượt sang
// phải rồi biến mất (giữ render 350ms với animate-online-out). Đông người tự co:
// full (<=3) → compact (4-6) → mini avatar + badge +N (>6, hiện tối đa 9).
// Click mở modal danh sách chi tiết. Không tràn layout: flex-nowrap +
// overflow-hidden, các khối xung quanh giữ shrink-0 ở App.
import { useEffect, useRef, useState } from 'react';
import { initialForName, type PresencePeer } from '../hooks/presenceHelpers';

/** Thời gian giữ chip người vừa thoát để chạy animation (khớp CSS online-slide-out). */
export const LEAVE_ANIM_MS = 350;
/** Số avatar tối đa ở tier mini, còn lại gom vào badge +N. */
const MINI_MAX = 9;

interface OnlineUsersStripProps {
  /** Người khác đang online (chưa gồm chính mình — thẻ tên riêng ở App). */
  peers: PresencePeer[];
  /** Tổng số online gồm mình (để aria-label/modal). */
  onlineCount: number;
  onOpenList: () => void;
}

type Tier = 'full' | 'compact' | 'mini';

function PeerChip({ peer, tier, leaving }: { peer: PresencePeer; tier: Tier; leaving: boolean }) {
  const anim = leaving ? 'animate-online-out' : 'animate-online-in';
  if (tier === 'mini') {
    return (
      <span
        title={peer.name}
        aria-hidden={leaving || undefined}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-black text-white ring-2 ring-slate-950 ${anim}`}
        style={{ backgroundColor: peer.color }}
      >
        {initialForName(peer.name)}
      </span>
    );
  }
  const avatarSize = tier === 'full' ? 'h-8 w-8 text-xs' : 'h-7 w-7 text-[10px]';
  return (
    <span
      title={`${peer.name} — đang online`}
      aria-hidden={leaving || undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-slate-900/80 py-0.5 ${
        tier === 'full' ? 'pl-0.5 pr-2.5' : 'pl-0.5 pr-2'
      } ${anim}`}
    >
      <span className="relative shrink-0">
        <span
          aria-hidden
          className={`flex items-center justify-center rounded-full font-black text-white ${avatarSize}`}
          style={{ backgroundColor: peer.color }}
        >
          {initialForName(peer.name)}
        </span>
        <span
          aria-hidden
          className="absolute -bottom-0 -right-0 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-950"
        />
      </span>
      <span
        className={`truncate font-bold text-white ${
          tier === 'full' ? 'max-w-[120px] text-xs' : 'max-w-[72px] text-[10px]'
        }`}
      >
        {peer.name}
      </span>
    </span>
  );
}

export default function OnlineUsersStrip({ peers, onlineCount, onOpenList }: OnlineUsersStripProps) {
  const [leaving, setLeaving] = useState<PresencePeer[]>([]);
  const prevPeersRef = useRef(new Map<string, PresencePeer>());
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const prev = prevPeersRef.current;
    const curIds = new Set(peers.map((p) => p.sessionId));

    // Peer quay lại trong lúc đang chạy animation thoát → hủy timeout, gỡ khỏi leaving.
    for (const p of peers) {
      const timer = timersRef.current.get(p.sessionId);
      if (timer !== undefined) {
        clearTimeout(timer);
        timersRef.current.delete(p.sessionId);
        if (mountedRef.current) {
          // eslint-disable-next-line react/set-state-in-effect
          setLeaving((old) => old.filter((l) => l.sessionId !== p.sessionId));
        }
      }
    }
    // Peer vừa rời → giữ render đủ 1 nhịp animation thoát rồi mới gỡ.
    for (const [id, peer] of prev) {
      if (!curIds.has(id) && !timersRef.current.has(id)) {
        if (mountedRef.current) {
          // eslint-disable-next-line react/set-state-in-effect
          setLeaving((old) => (old.some((l) => l.sessionId === id) ? old : [...old, peer]));
        }
        const timer = setTimeout(() => {
          timersRef.current.delete(id);
          if (mountedRef.current) setLeaving((old) => old.filter((l) => l.sessionId !== id));
        }, LEAVE_ANIM_MS);
        timersRef.current.set(id, timer);
      }
    }
    prevPeersRef.current = new Map(peers.map((p) => [p.sessionId, p]));
  }, [peers]);

  const total = peers.length;
  const tier: Tier = total <= 3 ? 'full' : total <= 6 ? 'compact' : 'mini';
  const visible = tier === 'mini' ? peers.slice(0, MINI_MAX) : peers;
  const hiddenCount = tier === 'mini' ? total - visible.length : 0;

  return (
    <button
      type="button"
      onClick={onOpenList}
      aria-label={`Xem danh sách ${onlineCount} người đang online`}
      title="Xem danh sách người đang online"
      data-testid="online-strip"
      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-2xl border border-emerald-500/20 bg-slate-950/60 px-2.5 py-2 transition hover:border-emerald-500/40"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" />
      {total === 0 ? (
        <span className="truncate text-[10px] text-slate-500">Chỉ mình bạn online</span>
      ) : (
        <span className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden">
          {visible.map((p) => (
            <PeerChip key={p.sessionId} peer={p} tier={tier} leaving={false} />
          ))}
          {leaving.map((p) => (
            <PeerChip key={`leaving-${p.sessionId}`} peer={p} tier={tier} leaving />
          ))}
          {hiddenCount > 0 && (
            <span className="shrink-0 rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-300">
              +{hiddenCount}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
