import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScannedData } from '../useScannedData';

const { order, limit, select, on, subscribe, removeChannel } = vi.hoisted(() => ({
  order: vi.fn(),
  limit: vi.fn(),
  select: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select, }),
    channel: () => ({ on, subscribe }),
    removeChannel,
  },
}));

type Handler = (payload: { eventType: string; new?: unknown; old?: unknown }) => void;
let handler: Handler = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ limit });
  limit.mockImplementation(async () => ({ data: [{ id: 'a', batch_id: 'B1' }], error: null }));
  on.mockImplementation((_ev: string, _filter: unknown, h: Handler) => {
    handler = h;
    return { subscribe };
  });
  subscribe.mockReturnValue({});
});

describe('useScannedData', () => {
  it('fetch đầu kỳ + subscribe postgres_changes bảng scanned_data', async () => {
    const { result } = renderHook(() => useScannedData());
    await act(async () => {});
    expect(select).toHaveBeenCalledWith('id,batch_id,qty,bin,status,resolution,is_manual,scanned_at,stock_code');
    expect(on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'scanned_data' },
      expect.any(Function),
    );
    expect(subscribe).toHaveBeenCalled();
    expect(result.current.rows).toEqual([{ id: 'a', batch_id: 'B1' }]);
  });

  it('INSERT thêm đầu danh sách, UPDATE thay thế, DELETE loại bỏ', async () => {
    const { result } = renderHook(() => useScannedData());
    await act(async () => {});
    act(() => {
      handler({ eventType: 'INSERT', new: { id: 'b', batch_id: 'B2' } });
    });
    expect(result.current.rows.map((r) => r.id)).toEqual(['b', 'a']);
    act(() => {
      handler({ eventType: 'UPDATE', new: { id: 'a', batch_id: 'B1X' } });
    });
    expect(result.current.rows.find((r) => r.id === 'a')?.batch_id).toBe('B1X');
    act(() => {
      handler({ eventType: 'DELETE', old: { id: 'b' } });
    });
    expect(result.current.rows.map((r) => r.id)).toEqual(['a']);
  });
});
