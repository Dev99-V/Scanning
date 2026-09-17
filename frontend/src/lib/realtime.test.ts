// realtime resilient — test cơ chế tự nối lại (fix mất online sau 1 thời gian).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRealtimeHealthForTest,
  forgetChannel,
  getOverallStatus,
  reportChannelStatus,
  resilientSubscribe,
  retryDelay,
  subscribeHealth,
} from './realtime';

beforeEach(() => {
  __resetRealtimeHealthForTest();
  vi.useRealTimers();
});

afterEach(() => {
  __resetRealtimeHealthForTest();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('retryDelay', () => {
  it('backoff 1s → 2s → 4s → 8s → trần 15s', () => {
    expect([0, 1, 2, 3, 4, 5, 99].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  });
});

describe('health tổng hợp', () => {
  it('chưa có kênh = connecting; 1 kênh reconnecting kéo cả app xuống', () => {
    expect(getOverallStatus()).toBe('connecting');
    reportChannelStatus('a', 'connected');
    reportChannelStatus('b', 'connected');
    expect(getOverallStatus()).toBe('connected');
    reportChannelStatus('b', 'reconnecting');
    expect(getOverallStatus()).toBe('reconnecting');
    forgetChannel('b');
    expect(getOverallStatus()).toBe('connected');
  });

  it('subscribeHealth nhận thông báo khi kênh đổi trạng thái', () => {
    const seen: string[] = [];
    const off = subscribeHealth((s) => seen.push(s));
    reportChannelStatus('x', 'connected');
    reportChannelStatus('x', 'reconnecting');
    off();
    reportChannelStatus('x', 'connected');
    expect(seen).toEqual(['connected', 'reconnecting']);
  });
});

type StatusCb = (s: string) => void;

// Channel giả lập supabase-js: on() trả về chính nó (chain), subscribe(cb) giữ cb.
function fakeChannel() {
  const handlers: { type: string; handler: (p: never) => void }[] = [];
  let statusCb: StatusCb | null = null;
  const ch = {
    handlers,
    on: vi.fn((type: string, _filter: unknown, handler: (p: never) => void) => {
      handlers.push({ type, handler });
      return ch;
    }),
    subscribe: vi.fn((cb?: StatusCb) => {
      if (cb) statusCb = cb;
      return ch;
    }),
    emitStatus: (s: string) => statusCb?.(s),
  };
  return ch;
}

describe('resilientSubscribe', () => {
  it('SUBSCRIBED lần đầu: onSubscribed chạy, onReconnect KHÔNG chạy (tránh fetch đúp)', () => {
    const ch = fakeChannel();
    const onSubscribed = vi.fn();
    const onReconnect = vi.fn();
    const cleanup = resilientSubscribe({
      id: 't1',
      createChannel: () => ch,
      bindings: [{ type: 'postgres_changes', event: '*', filter: { event: '*' }, handler: () => {} }],
      onSubscribed,
      onReconnect,
      removeChannel: vi.fn(),
    });
    ch.emitStatus('SUBSCRIBED');
    expect(onSubscribed).toHaveBeenCalledTimes(1);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(getOverallStatus()).toBe('connected');
    cleanup();
    expect(getOverallStatus()).toBe('connecting');
  });

  it('CHANNEL_ERROR → tự tạo channel mới + SUBSCRIBED lại thì gọi onReconnect (refetch bù)', () => {
    vi.useFakeTimers();
    const ch1 = fakeChannel();
    const ch2 = fakeChannel();
    const channels = [ch1, ch2];
    let n = 0;
    const remove = vi.fn();
    const onReconnect = vi.fn();
    const cleanup = resilientSubscribe({
      id: 't2',
      createChannel: () => channels[Math.min(n++, channels.length - 1)],
      bindings: [{ type: 'postgres_changes', event: '*', filter: { event: '*' }, handler: () => {} }],
      onReconnect,
      removeChannel: remove,
    });
    ch1.emitStatus('SUBSCRIBED');
    expect(onReconnect).not.toHaveBeenCalled();
    ch1.emitStatus('CHANNEL_ERROR');
    expect(getOverallStatus()).toBe('reconnecting');
    expect(remove).toHaveBeenCalledWith(ch1);
    // Chưa tới giờ retry → chưa tạo channel mới.
    expect(n).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(n).toBe(2);
    ch2.emitStatus('SUBSCRIBED');
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(getOverallStatus()).toBe('connected');
    cleanup();
  });

  it('CLOSED và TIMED_OUT đều kích hoạt retry', () => {
    vi.useFakeTimers();
    const ch1 = fakeChannel();
    const ch2 = fakeChannel();
    const ch3 = fakeChannel();
    const channels = [ch1, ch2, ch3];
    let n = 0;
    resilientSubscribe({
      id: 't3',
      createChannel: () => channels[Math.min(n++, channels.length - 1)],
      bindings: [{ type: 'postgres_changes', event: '*', filter: { event: '*' }, handler: () => {} }],
      removeChannel: vi.fn(),
    });
    ch1.emitStatus('CLOSED');
    vi.advanceTimersByTime(1000);
    expect(n).toBe(2);
    ch2.emitStatus('TIMED_OUT');
    // Lần retry thứ 2 backoff 2s (không phải 1s).
    vi.advanceTimersByTime(1000);
    expect(n).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(n).toBe(3);
  });

  it('gọi đủ bindings presence sync/join/leave trên cùng channel', () => {
    const ch = fakeChannel();
    resilientSubscribe({
      id: 'presence',
      createChannel: () => ch,
      bindings: [
        { type: 'presence', event: 'sync', handler: () => {} },
        { type: 'presence', event: 'join', handler: () => {} },
        { type: 'presence', event: 'leave', handler: () => {} },
      ],
      removeChannel: vi.fn(),
    });
    expect(ch.on).toHaveBeenCalledTimes(3);
    expect(ch.subscribe).toHaveBeenCalledTimes(1);
  });
});
