import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useScannedData } from '../useScannedData';

const { order, limit, range, select, on, subscribe, removeChannel } = vi.hoisted(() => ({
  order: vi.fn(),
  limit: vi.fn(),
  range: vi.fn(),
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
  order.mockReturnValue({ range, limit });
  range.mockImplementation(async () => ({ data: [{ id: 'a', batch_id: 'B1' }], error: null }));
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

  it('INSERT cùng id không làm nhân đôi dòng (chống race condition giữa Realtime và refetch)', async () => {
    const { result } = renderHook(() => useScannedData());
    await act(async () => {});
    // Giả lập event Realtime phát lần 1
    act(() => {
      handler({ eventType: 'INSERT', new: { id: 'dup1', batch_id: 'TAG_DUP' } });
    });
    expect(result.current.rows.map((r) => r.id)).toEqual(['dup1', 'a']);

    // Giả lập event lặp hoặc refetch đã có sẵn dòng 'dup1'
    act(() => {
      handler({ eventType: 'INSERT', new: { id: 'dup1', batch_id: 'TAG_DUP_UPDATED' } });
    });
    // Không bị nhân đôi thành ['dup1', 'dup1', 'a'] mà vẫn là 1 dòng duy nhất được cập nhật
    expect(result.current.rows.map((r) => r.id)).toEqual(['dup1', 'a']);
    expect(result.current.rows.find((r) => r.id === 'dup1')?.batch_id).toBe('TAG_DUP_UPDATED');
  });

  it('tải đầy đủ dữ liệu qua phân trang range không bị giới hạn 500 dòng (ví dụ 1050 dòng)', async () => {
    // Trang 1: 1000 dòng, Trang 2: 50 dòng (tổng 1050 dòng)
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ id: `p1_${i}`, batch_id: `TAG_${i}` }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ id: `p2_${i}`, batch_id: `TAG_${1000 + i}` }));

    range.mockImplementation(async (from: number) => {
      if (from === 0) return { data: page1, error: null };
      if (from === 1000) return { data: page2, error: null };
      return { data: [], error: null };
    });

    const { result } = renderHook(() => useScannedData());
    await act(async () => {});

    expect(result.current.rows).toHaveLength(1050);
    expect(result.current.rows[0].id).toBe('p1_0');
    expect(result.current.rows[1049].id).toBe('p2_49');
  });
});
