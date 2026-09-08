import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDIT_LATEST_LIMIT, useAuditLog } from '../useAuditLog';

const { range, order, select, on, subscribe, removeChannel } = vi.hoisted(() => ({
  range: vi.fn(),
  order: vi.fn(),
  select: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select }),
    channel: () => ({ on, subscribe }),
    removeChannel,
  },
}));

type Handler = (payload: { eventType: string; new?: unknown; old?: unknown }) => void;
let handler: Handler = () => {};

const ROWS = [
  { id: 2, scanned_id: null, action: 'insert', old_value: null, new_value: { batch_id: 'T2' }, actor: null, actor_name: 'Anh B', created_at: '2026-09-08T02:00:00Z' },
  { id: 1, scanned_id: 's1', action: 'insert', old_value: null, new_value: { batch_id: 'T1' }, actor: null, actor_name: 'Anh A', created_at: '2026-09-08T01:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ range });
  range.mockImplementation(async () => ({ data: ROWS, error: null }));
  on.mockImplementation((_ev: string, _filter: unknown, h: Handler) => {
    handler = h;
    return { subscribe };
  });
  subscribe.mockReturnValue({});
});

describe('useAuditLog', () => {
  it('tải 300 dòng mới nhất + subscribe INSERT bảng scan_audit_log', async () => {
    const { result } = renderHook(() => useAuditLog());
    await act(async () => {});
    expect(select).toHaveBeenCalledWith('id,scanned_id,action,old_value,new_value,actor,actor_name,created_at');
    expect(range).toHaveBeenCalledWith(0, AUDIT_LATEST_LIMIT - 1);
    expect(on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'scan_audit_log' },
      expect.any(Function),
    );
    expect(result.current.entries).toHaveLength(2);
  });

  it('INSERT realtime prepend đầu danh sách, trùng id không nhân đôi', async () => {
    const { result } = renderHook(() => useAuditLog());
    await act(async () => {});
    act(() => {
      handler({ eventType: 'INSERT', new: { id: 3, action: 'insert', new_value: { batch_id: 'T3' }, actor_name: 'Anh C' } });
    });
    expect(result.current.entries.map((e) => e.id)).toEqual([3, 2, 1]);
    act(() => {
      handler({ eventType: 'INSERT', new: { id: 3, action: 'insert', new_value: { batch_id: 'T3' }, actor_name: 'Anh C' } });
    });
    expect(result.current.entries.map((e) => e.id)).toEqual([3, 2, 1]);
  });
});
