import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './pagedFetch';

const row = (id: string) => ({ id });

describe('fetchAllPages', () => {
  it('tải các trang trong sóng song song và ghép đúng thứ tự trang (kể cả resolve lộn xộn)', async () => {
    const calls: Array<[number, number]> = [];
    const fetchPage = vi.fn(async (from: number, to: number) => {
      calls.push([from, to]);
      // Trang 1 resolve CHẬM hơn trang 0 để giả lập mạng lộn xộn.
      if (from === 0) {
        await new Promise((r) => setTimeout(r, 20));
        return { data: [row('p0_a'), row('p0_b')], error: null };
      }
      if (from === 2) return { data: [row('p1_a')], error: null };
      return { data: [], error: null };
    });

    const { items, error } = await fetchAllPages(fetchPage, 2, 2);

    expect(error).toBeNull();
    // Sóng 1 bắn from=0 và from=2 cùng lúc (song song, không chờ nhau).
    expect(calls).toEqual([
      [0, 1],
      [2, 3],
    ]);
    // Ghép theo chỉ số trang: p0 trước p1 dù p1 resolve trước.
    expect(items.map((r) => r.id)).toEqual(['p0_a', 'p0_b', 'p1_a']);
  });

  it('bảng rỗng → đúng 1 sóng rồi dừng, không lỗi', async () => {
    const fetchPage = vi.fn(async () => ({ data: [], error: null }));
    const { items, error } = await fetchAllPages(fetchPage, 1000, 4);
    expect(error).toBeNull();
    expect(items).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('trang ngắn giữa sóng → giữ tới trang ngắn, bỏ trang sau, không bắn sóng tiếp', async () => {
    const fetchPage = vi.fn(async (from: number) => {
      if (from === 0) return { data: [row('a'), row('b')], error: null };
      if (from === 2) return { data: [row('c')], error: null };
      return { data: [row('SHOULD_DROP')], error: null };
    });
    const { items } = await fetchAllPages(fetchPage, 2, 4);
    expect(items.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    // Chỉ 1 sóng (4 calls), không có sóng 2.
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it('lỗi trang → trả error + dữ liệu đã gom trước trang lỗi', async () => {
    const fetchPage = vi.fn(async (from: number) => {
      if (from === 0) return { data: [row('a'), row('b')], error: null };
      return { data: null, error: { message: 'mất mạng' } };
    });
    const { items, error } = await fetchAllPages(fetchPage, 2, 2);
    expect(error).toBe('mất mạng');
    expect(items.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('trần an toàn: server cứ trả đầy mãi thì vẫn dừng (không treo)', async () => {
    const fetchPage = vi.fn(async () => ({ data: [row('x')], error: null }));
    const { items } = await fetchAllPages(fetchPage, 1, 1);
    expect(fetchPage).toHaveBeenCalledTimes(100);
    expect(items).toHaveLength(100);
  });
});
