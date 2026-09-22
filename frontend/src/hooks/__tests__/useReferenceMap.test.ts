import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useReferenceMap } from '../useReferenceMap';

const { range, select, order, on, subscribe, removeChannel } = vi.hoisted(() => ({
  range: vi.fn(),
  select: vi.fn(),
  order: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ range });
  range.mockImplementation(async () => ({
    data: [{ batch_id: 'B1', stock_code: 'S1', bin: 'BIN1', qty: 10, tag_7055: false }],
    error: null,
  }));
  on.mockImplementation((_ev: string, _filter: unknown, h: Handler) => {
    handler = h;
    return { subscribe };
  });
  subscribe.mockReturnValue({});
});

describe('useReferenceMap', () => {
  it('fetch đầu kỳ + subscribe postgres_changes bảng reference_stock (streaming đa người)', async () => {
    const { result } = renderHook(() => useReferenceMap());
    await act(async () => {});
    expect(select).toHaveBeenCalled();
    expect(on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reference_stock' },
      expect.any(Function),
    );
    expect(subscribe).toHaveBeenCalled();
    expect(result.current.byBatch.get('B1')?.qty).toBe(10);
  });

  it('INSERT/UPDATE upsert map, DELETE gỡ khỏi map (máy khác sửa Bảng 2 thì máy này tự thấy)', async () => {    const { result } = renderHook(() => useReferenceMap());
    await act(async () => {});
    act(() => {
      handler({
        eventType: 'INSERT',
        new: { batch_id: 'B2', stock_code: 'S2', bin: 'BIN2', qty: 5 },
      });
    });
    expect(result.current.byBatch.get('B2')?.qty).toBe(5);
    act(() => {
      handler({
        eventType: 'UPDATE',
        new: { batch_id: 'B1', stock_code: 'S1', bin: 'BIN9', qty: 99 },
      });
    });
    expect(result.current.byBatch.get('B1')?.qty).toBe(99);
    expect(result.current.byBatch.get('B1')?.bin).toBe('BIN9');
    act(() => {
      handler({ eventType: 'DELETE', old: { batch_id: 'B2' } });
    });
    expect(result.current.byBatch.has('B2')).toBe(false);
  });

  it('removeBatch gỡ khỏi map sau khi xóa dòng nguồn Bảng 2', async () => {
    const { result } = renderHook(() => useReferenceMap());
    await act(async () => {});
    expect(result.current.byBatch.has('B1')).toBe(true);
    act(() => {
      result.current.removeBatch('B1');
    });
    expect(result.current.byBatch.has('B1')).toBe(false);
  });

  it('updateBatch7055 đổi nhãn 7055 của 1 batch để công tắc Bảng 1/2 đồng bộ', async () => {
    const { result } = renderHook(() => useReferenceMap());
    await act(async () => {});
    expect(result.current.byBatch.get('B1')?.tag_7055).toBe(false);
    act(() => {
      result.current.updateBatch7055('B1', true);
    });
    expect(result.current.byBatch.get('B1')?.tag_7055).toBe(true);
    // Giữ nguyên qty/bin, batch lạ thì bỏ qua
    expect(result.current.byBatch.get('B1')?.qty).toBe(10);
    act(() => {
      result.current.updateBatch7055('NOPE', true);
    });
    expect(result.current.byBatch.has('NOPE')).toBe(false);
  });

  it('order ổn định theo batch_id (PK) + gộp nhiều trang không trùng key', async () => {    const fillers = Array.from({ length: 999 }, (_, i) => ({
      batch_id: `F${i}`,
      stock_code: 'SF',
      bin: 'B',
      qty: 1,
      tag_7055: false,
    }));
    const x = { batch_id: 'DUPX', stock_code: 'SX', bin: 'B', qty: 1, tag_7055: false };
    const y = { batch_id: 'NEWY', stock_code: 'SY', bin: 'B', qty: 2, tag_7055: false };
    range.mockImplementation(async (from: number) => {
      if (from === 0) return { data: [...fillers, x], error: null };
      if (from === 1000) return { data: [x, y], error: null };
      return { data: [], error: null };
    });
    const { result } = renderHook(() => useReferenceMap());
    await act(async () => {});
    expect(order).toHaveBeenCalledWith('batch_id', expect.objectContaining({ ascending: true }));
    expect(result.current.byBatch.size).toBe(1001);
    expect(result.current.byBatch.get('DUPX')?.qty).toBe(1);
    expect(result.current.byBatch.get('NEWY')?.qty).toBe(2);
  });
});
