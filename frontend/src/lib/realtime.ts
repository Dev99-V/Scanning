// realtime — lớp realtime tự hồi phục dùng chung cho mọi channel.
//
// Vấn đề gốc (mất online sau 1 thời gian, vẫn thao tác REST bình thường):
// - Mọi hook trước đây `.subscribe()` chay, không xử lý CLOSED/TIMED_OUT/
//   CHANNEL_ERROR nên socket rớt (wifi kho, PDA sleep, NAT timeout) là chết im.
// - Presence heartbeat `track()` khi channel chết bị nuốt lỗi, sweep đọc
//   `presenceState()` local cũ → sau 90s stale là avatar biến mất hàng loạt.
// - Không refetch bù sau khi nối lại → event mất trong lúc rớt là mất luôn.
//
// Helper này: tự nối lại với backoff + refetch bù khi SUBSCRIBED trở lại +
// gom sức khỏe toàn app để badge header hiển thị thật (không chữ cứng).
// Tương thích mock test cũ: vẫn gọi `channel.on(...)` rồi `.subscribe(cb)`.
import { supabase } from './supabase';

export type RealtimeChannelState = 'connecting' | 'connected' | 'reconnecting';
export type SubscribeStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR' | string;

export interface RealtimeBinding {
  /** 'postgres_changes' | 'presence' */
  type: string;
  event: string;
  filter?: Record<string, unknown>;
  handler: (payload: never) => void;
}

interface HealthListener {
  (overall: RealtimeChannelState): void;
}

const channelStates = new Map<string, RealtimeChannelState>();
const healthListeners = new Set<HealthListener>();

function computeOverall(): RealtimeChannelState {
  if (channelStates.size === 0) return 'connecting';
  let hasConnecting = false;
  for (const s of channelStates.values()) {
    if (s === 'reconnecting') return 'reconnecting';
    if (s === 'connecting') hasConnecting = true;
  }
  return hasConnecting ? 'connecting' : 'connected';
}

function emitHealth(): void {
  const overall = computeOverall();
  for (const fn of healthListeners) {
    try {
      fn(overall);
    } catch {
      /* listener lỗi không được làm chết realtime */
    }
  }
}

/** Kênh vừa chuyển trạng thái — badge header cập nhật theo. */
export function reportChannelStatus(id: string, state: RealtimeChannelState): void {
  if (channelStates.get(id) === state) return;
  channelStates.set(id, state);
  emitHealth();
}

/** Kênh unmount — gỡ khỏi health để không kẹt 'reconnecting' mãi. */
export function forgetChannel(id: string): void {
  if (channelStates.delete(id)) emitHealth();
}

export function getOverallStatus(): RealtimeChannelState {
  return computeOverall();
}

export function subscribeHealth(fn: HealthListener): () => void {
  healthListeners.add(fn);
  return () => {
    healthListeners.delete(fn);
  };
}

/** Reset toàn bộ health — CHỈ dùng cho test. */
export function __resetRealtimeHealthForTest(): void {
  channelStates.clear();
}

/** Backoff nối lại: 1s → 2s → 4s → 8s → trần 15s (đủ nhanh cho kho, đủ thưa cho server). */
export function retryDelay(attempt: number): number {
  const steps = [1000, 2000, 4000, 8000, 15000];
  if (attempt < 0) return steps[0];
  return steps[Math.min(attempt, steps.length - 1)];
}

export interface ResilientOptions {
  /** id ổn định của kênh trong health map, vd 'scanned_data', 'presence'. */
  id: string;
  /** Tạo channel MỚI mỗi lần nối (kể cả nối lại). Caller giữ topic cố định. */
  createChannel: () => unknown;
  bindings: RealtimeBinding[];
  /** Gọi MỖI lần SUBSCRIBED (kể cả lần đầu) — để presence track lại. */
  onSubscribed?: () => void;
  /** Chỉ gọi khi SUBSCRIBED TRỞ LẠI sau sự cố — để refetch bù event đã mất. */
  onReconnect?: () => void;
  /** Gỡ channel khi retry/unmount. Mặc định supabase.removeChannel. */
  removeChannel?: (ch: unknown) => unknown;
}

/**
 * Subscribe 1 channel có tự nối lại. Trả về hàm cleanup.
 * Tương thích cả channel thật (supabase-js v2) lẫn mock test
 * (`{ on: () => ({ subscribe }) }` hoặc `{ on, subscribe }`).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyBindings(channel: any, bindings: RealtimeBinding[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = channel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lastSubscribable: any = typeof cur?.subscribe === 'function' ? cur : null;
  for (const b of bindings) {
    // Ưu tiên chain (channel thật trả về `this`); mock chỉ có 1 nấc thì
    // bám vào channel gốc cho binding tiếp theo.
    const target = typeof cur?.on === 'function' ? cur : channel;
    if (!target || typeof target.on !== 'function') continue;
    let next: unknown = null;
    try {
      next = target.on(b.type, b.filter ?? { event: b.event }, b.handler);
    } catch {
      next = null;
    }
    if (next && typeof (next as { subscribe?: unknown }).subscribe === 'function') {
      lastSubscribable = next;
    }
    if (next && typeof (next as { on?: unknown }).on === 'function') {
      cur = next;
    }
  }
  return lastSubscribable ?? cur ?? channel;
}

export function resilientSubscribe(opts: ResilientOptions): () => void {
  const { id, createChannel, bindings, onSubscribed, onReconnect } = opts;
  const remove =
    opts.removeChannel ??
    ((ch: unknown) => {
      try {
        const sb = supabase as unknown as {
          removeChannel?: (c: unknown) => unknown;
        };
        return sb.removeChannel?.(ch);
      } catch {
        return undefined;
      }
    });

  let cancelled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let channel: any = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  let everFailed = false;
  let lastStatus: RealtimeChannelState = 'connecting';

  reportChannelStatus(id, 'connecting');

  function clearTimer(): void {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function detach(): void {
    if (channel) {
      const ch = channel;
      channel = null;
      try {
        const r = remove(ch) as unknown;
        if (r && typeof (r as Promise<unknown>).catch === 'function') {
          (r as Promise<unknown>).catch(() => undefined);
        }
      } catch {
        /* bỏ qua */
      }
    }
  }

  function scheduleRetry(): void {
    if (cancelled) return;
    everFailed = true;
    lastStatus = 'reconnecting';
    reportChannelStatus(id, 'reconnecting');
    detach();
    clearTimer();
    const wait = retryDelay(retryCount);
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, wait);
  }

  function handleStatus(status: SubscribeStatus): void {
    if (cancelled) return;
    if (status === 'SUBSCRIBED') {
      const wasRecovery = everFailed;
      everFailed = false;
      retryCount = 0;
      lastStatus = 'connected';
      reportChannelStatus(id, 'connected');
      try {
        onSubscribed?.();
      } catch {
        /* callback lỗi không được giết channel */
      }
      if (wasRecovery) {
        try {
          onReconnect?.();
        } catch {
          /* bỏ qua */
        }
      }
    } else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      scheduleRetry();
    }
  }

  function connect(): void {
    if (cancelled) return;
    clearTimer();
    detach();
    let fresh: unknown = null;
    try {
      fresh = createChannel();
    } catch {
      scheduleRetry();
      return;
    }
    if (!fresh) {
      scheduleRetry();
      return;
    }
    channel = fresh;
    let subTarget: unknown = null;
    try {
      subTarget = applyBindings(channel, bindings);
    } catch {
      scheduleRetry();
      return;
    }
    const target = subTarget as {
      subscribe?: (cb?: (s: SubscribeStatus) => void) => unknown;
    };
    if (!target || typeof target.subscribe !== 'function') {
      scheduleRetry();
      return;
    }
    try {
      target.subscribe(handleStatus);
    } catch {
      scheduleRetry();
    }
  }

  function reconnectNow(): void {
    if (cancelled) return;
    if (lastStatus === 'connected') return;
    retryCount = 0;
    connect();
  }

  function onVisibility(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      reconnectNow();
    }
  }

  function onOnline(): void {
    reconnectNow();
  }

  function onOffline(): void {
    if (cancelled) return;
    lastStatus = 'reconnecting';
    reportChannelStatus(id, 'reconnecting');
  }

  const canListen =
    typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (canListen) {
    window.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }

  connect();

  return () => {
    cancelled = true;
    clearTimer();
    detach();
    forgetChannel(id);
    if (canListen) {
      window.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    }
  };
}
