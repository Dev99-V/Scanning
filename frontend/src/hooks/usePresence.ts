// usePresence — hiện diện realtime qua Supabase Presence (giống Excel co-editing).
// 1 channel dùng chung PRESENCE_TOPIC; mỗi client track:
//   { sessionId, name, color, viewing, editing, updatedAt }.
// - viewing: bảng đang di chuột/focus (để header hiện "A đang xem Bảng 1").
// - editing: dòng đang mở modal sửa/xóa (để khóa mềm dòng đó tới khi lưu xong).
// Lock tự nhả khi: lưu thành công / đóng modal / rớt mạng (server kick presence)
// / stale > 90s (heartbeat 20s). Ghi cứng chống race vẫn do RPC DB lo
// (pg_advisory_xact_lock — Plan §5), presence chỉ khóa mềm + hiển thị.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { resilientSubscribe } from '../lib/realtime';
import {
  PRESENCE_TOPIC,
  editorsOf,
  findLockHolder,
  parsePresenceState,
  viewersOf,
  type PresenceEditing,
  type PresenceIdentity,
  type PresencePeer,
  type PresenceTable,
} from './presenceHelpers';

const HEARTBEAT_MS = 20_000;

export interface UsePresenceApi {
  peers: PresencePeer[];
  onlineCount: number;
  setViewing: (table: PresenceTable | null) => void;
  setEditing: (editing: PresenceEditing | null) => void;
  clearEditing: () => void;
  getLock: (table: PresenceTable, key: string) => PresencePeer | null;
  viewersOfTable: (table: PresenceTable) => PresencePeer[];
  editorsOfTable: (table: PresenceTable) => PresencePeer[];
}

export function usePresence(identity: PresenceIdentity | null): UsePresenceApi {
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  // Mặc định đang xem Bảng 1 (bảng chính): user vừa vào đã hiện avatar ở
  // header Bảng 1 ngay, kể cả chưa di chuột (PDA cảm ứng không có hover) —
  // trước đây viewing=null nên viewersOfTable loại hết, online mà "tàng hình".
  const stateRef = useRef({
    viewing: 'table1' as PresenceTable | null,
    editing: null as PresenceEditing | null,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);

  // Giữ bản mới nhất để callback channel không bị stale closure.
  const identityRef = useRef(identity);
  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    if (!identity) {
      // eslint-disable-next-line react/set-state-in-effect
      setPeers([]);
      return;
    }
    let cancelled = false;
    // Channel thật được tạo bên trong resilientSubscribe (để nối lại được);
    // giữ ref tới channel hiện hành cho track/presenceState/snapshot.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let liveChannel: any = null;
    const channelTopic = PRESENCE_TOPIC;

    const snapshot = () => {
      if (cancelled || !liveChannel) return;
      try {
        const raw = liveChannel.presenceState() as Record<string, unknown>;
        setPeers(parsePresenceState(raw, identity.sessionId));
      } catch {
        /* giữ danh sách cũ khi parse lỗi */
      }
    };

    const trackCurrent = () => {
      if (cancelled || !liveChannel) return;
      const me = identityRef.current;
      if (!me) return;
      try {
        const r = liveChannel.track({
          sessionId: me.sessionId,
          name: me.name,
          color: me.color,
          viewing: stateRef.current.viewing,
          editing: stateRef.current.editing,
          updatedAt: Date.now(),
        }) as unknown;
        if (r && typeof (r as Promise<unknown>).catch === 'function') {
          (r as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        /* resilientSubscribe sẽ nối lại khi channel chết */
      }
    };

    // resilientSubscribe tự nối lại khi CLOSED/TIMED_OUT/CHANNEL_ERROR +
    // track lại ngay khi SUBSCRIBED (kể cả lần đầu) — trước đây chỉ track 1
    // lần đầu nên heartbeat sau khi rớt mạng chết im, avatar mất hàng loạt.
    const cleanupChannel = resilientSubscribe({
      id: 'presence',
      createChannel: () => {
        const ch = supabase.channel(channelTopic, {
          config: { presence: { key: identity.sessionId } },
        });
        liveChannel = ch;
        return ch;
      },
      bindings: [
        { type: 'presence', event: 'sync', handler: (() => snapshot()) as (payload: never) => void },
        { type: 'presence', event: 'join', handler: (() => snapshot()) as (payload: never) => void },
        { type: 'presence', event: 'leave', handler: (() => snapshot()) as (payload: never) => void },
      ],
      onSubscribed: () => {
        trackCurrent();
        // snapshot sau 1 nhịp để server kịp gom presence các tab khác.
        window.setTimeout(snapshot, 300);
      },
    });
    channelRef.current = {
      track: () =>
        Promise.resolve().then(() => {
          trackCurrent();
        }),
    };

    const heartbeat = window.setInterval(trackCurrent, HEARTBEAT_MS);
    // Quét định kỳ để loại peer stale khi server chưa kịp kick (rớt mạng lặng).
    const sweep = window.setInterval(snapshot, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      window.clearInterval(sweep);
      channelRef.current = null;
      liveChannel = null;
      cleanupChannel();
    };
  }, [identity?.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pushUpdate = useCallback(() => {
    // Gửi lại presence mới nhất (realtime tự gộp). Không có identity thì bỏ qua.
    const me = identityRef.current;
    const ch = channelRef.current;
    if (!me || !ch) return;
    void ch
      .track({
        sessionId: me.sessionId,
        name: me.name,
        color: me.color,
        viewing: stateRef.current.viewing,
        editing: stateRef.current.editing,
        updatedAt: Date.now(),
      })
      .catch(() => undefined);
  }, []);

  const setViewing = useCallback(
    (table: PresenceTable | null) => {
      if (stateRef.current.viewing === table) return;
      stateRef.current.viewing = table;
      pushUpdate();
    },
    [pushUpdate],
  );

  const setEditing = useCallback(
    (editing: PresenceEditing | null) => {
      stateRef.current.editing = editing;
      if (editing) stateRef.current.viewing = editing.table;
      pushUpdate();
    },
    [pushUpdate],
  );

  const clearEditing = useCallback(() => {
    if (!stateRef.current.editing) return;
    stateRef.current.editing = null;
    pushUpdate();
  }, [pushUpdate]);

  return useMemo<UsePresenceApi>(() => {
    // peers đã được lọc stale lúc snapshot (parsePresenceState) + sweep 20s,
    // nên ở render chỉ dùng trực tiếp — tránh gọi Date.now() trong render.
    return {
      peers,
      onlineCount: peers.length + (identity ? 1 : 0),
      setViewing,
      setEditing,
      clearEditing,
      getLock: (table, key) => findLockHolder(peers, table, key),
      viewersOfTable: (table) => viewersOf(peers, table),
      editorsOfTable: (table) => editorsOf(peers, table),
    };
  }, [peers, identity, setViewing, setEditing, clearEditing]);
}
