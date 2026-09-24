import { describe, expect, it } from 'vitest';
import { buildCheckedTagMap, compareInventoryRow, detectSourceChange, normBin, sortInventoryDupLast } from './inventoryCompare';
import type { InventoryRow, ScanRow } from './types';

function invRow(over: Partial<InventoryRow> = {}): InventoryRow {
  return {
    id: 'inv1',
    batch_id: 'TAG1',
    stock_code: 'ST_A',
    qty: 10,
    bin: 'BIN_A',
    is_manual: false,
    scanned_at: '2026-09-21T00:00:00Z',
    ...over,
  };
}

describe('detectSourceChange', () => {
  it('không mốc → không đổi', () => {
    expect(
      detectSourceChange(undefined, { stock_code: 'ST', qty: 10, bin: 'BIN_A' }).changed,
    ).toBe(false);
  });

  it('nguồn giữ nguyên → không đổi', () => {
    const r = detectSourceChange({ qty: 10, bin: 'BIN_A' }, { qty: 10, bin: 'BIN_A' });
    expect(r).toEqual({ changed: false, detail: null });
  });

  it('đổi SL → changed + chi tiết cũ→mới', () => {
    const r = detectSourceChange({ qty: 10, bin: 'BIN_A' }, { qty: 12, bin: 'BIN_A' });
    expect(r.changed).toBe(true);
    expect(r.detail).toContain('10→12');
  });

  it('đổi Bin → changed + chi tiết cũ→mới', () => {
    const r = detectSourceChange({ qty: 10, bin: 'BIN_A' }, { qty: 10, bin: 'BIN_B' });
    expect(r.changed).toBe(true);
    expect(r.detail).toContain('BIN_A→BIN_B');
  });

  it('Tag bị xóa khỏi nguồn sau mốc → changed', () => {
    const r = detectSourceChange({ qty: 10, bin: 'BIN_A' }, undefined);
    expect(r.changed).toBe(true);
    expect(r.detail).toContain('xóa');
  });

  it('Tag mới xuất hiện trong nguồn sau mốc → changed', () => {
    const r = detectSourceChange(
      { qty: NaN, bin: '' },
      { stock_code: 'ST', qty: 5, bin: 'BIN_X' },
    );
    expect(r.changed).toBe(true);
    expect(r.detail).toContain('thêm mới');
  });

  it('cả mốc lẫn nguồn đều không có → không đổi', () => {
    expect(detectSourceChange({ qty: NaN, bin: '' }, undefined).changed).toBe(false);
  });
});

describe('compareInventoryRow', () => {
  const scanned: ScanRow[] = [
    {
      id: 's1',
      batch_id: 'TAG1',
      qty: 10,
      bin: 'BIN_A',
      stock_code: 'ST_A',
      status: 'ok',
      resolution: null,
      is_manual: false,
      scanned_at: '2026-09-21T00:00:00Z',
    },
  ];
  const sys = new Map([['TAG1', { stock_code: 'ST_A', qty: 10, bin: 'BIN_A' }]]);

  it('khớp cả 2 bảng → allMatch, không warnings', () => {
    const cmp = compareInventoryRow(invRow(), scanned, sys);
    expect(cmp.allMatch).toBe(true);
    expect(cmp.warnings).toEqual([]);
    expect(cmp.table1Qty).toBe(10);
    expect(cmp.table2Qty).toBe(10);
  });

  it('nguồn đổi SL sau khi kiểm kê → cảnh báo lệch vs hệ thống', () => {
    const sysNew = new Map([['TAG1', { stock_code: 'ST_A', qty: 12, bin: 'BIN_A' }]]);
    const cmp = compareInventoryRow(invRow(), scanned, sysNew);
    expect(cmp.allMatch).toBe(false);
    expect(cmp.warnings.join(' ')).toContain('Lệch SL vs hệ thống');
  });
});

describe('buildCheckedTagMap', () => {
  const scanned: ScanRow[] = [
    {
      id: 's1',
      batch_id: 'OK_TAG',
      qty: 10,
      bin: 'BIN_A',
      stock_code: 'ST',
      status: 'ok',
      resolution: null,
      is_manual: false,
      scanned_at: '2026-09-21T00:00:00Z',
    },
    {
      id: 's2',
      batch_id: 'BAD_TAG',
      qty: 5,
      bin: 'BIN_A',
      stock_code: 'ST',
      status: 'qty_mismatch',
      resolution: null,
      is_manual: false,
      scanned_at: '2026-09-21T00:00:00Z',
    },
  ];
  const sys = new Map([
    ['OK_TAG', { stock_code: 'ST', qty: 10, bin: 'BIN_A' }],
    ['BAD_TAG', { stock_code: 'ST', qty: 8, bin: 'BIN_A' }],
  ]);

  function inv(tag: string, qty: number): InventoryRow {
    return {
      id: `inv-${tag}`,
      batch_id: tag,
      stock_code: 'ST',
      qty,
      bin: 'BIN_A',
      is_manual: false,
      scanned_at: '2026-09-21T00:00:00Z',
    };
  }

  it('Tag kiểm kê khớp cả 2 bảng → true; lệch → false; chưa kiểm kê → vắng mặt', () => {
    const m = buildCheckedTagMap([inv('OK_TAG', 10), inv('BAD_TAG', 5)], scanned, sys);
    expect(m.get('OK_TAG')).toBe(true);
    expect(m.get('BAD_TAG')).toBe(false);
    expect(m.has('NOPE_TAG')).toBe(false);
  });

  it('một dòng KK lệch trong nhiều dòng cùng Tag → cả Tag false', () => {
    const m = buildCheckedTagMap([inv('OK_TAG', 10), { ...inv('OK_TAG', 3), id: 'inv-x' }], scanned, sys);
    expect(m.get('OK_TAG')).toBe(false);
  });
});

describe('normBin + so sánh không phân biệt hoa/thường (b4 = B4)', () => {
  const scanned: ScanRow[] = [
    {
      id: 's1',
      batch_id: 'TAG1',
      qty: 10,
      bin: 'B4',
      stock_code: 'ST_A',
      status: 'ok',
      resolution: null,
      is_manual: false,
      scanned_at: '2026-09-21T00:00:00Z',
    },
  ];
  const sys = new Map([['TAG1', { stock_code: 'ST_A', qty: 10, bin: 'B4' }]]);

  it('normBin trim + upper', () => {
    expect(normBin('  b4 ')).toBe('B4');
    expect(normBin(null)).toBe('');
    expect(normBin('Bin-12a')).toBe('BIN-12A');
  });

  it('KK nhập b4 vs nguồn B4 → khớp, không cảnh báo lệch Bin', () => {
    const cmp = compareInventoryRow(invRow({ bin: 'b4' }), scanned, sys);
    expect(cmp.allMatch).toBe(true);
    expect(cmp.warnings).toEqual([]);
  });

  it('KK nhập b4 vs Bảng 1 quét B4 → khớp Bin Bảng 1', () => {
    const cmp = compareInventoryRow(
      invRow({ bin: 'b4' }),
      [{ ...scanned[0], bin: '  b4 ' }],
      new Map([['TAG1', { stock_code: 'ST_A', qty: 10, bin: 'B4' }]]),
    );
    expect(cmp.warnings.join(' ')).not.toContain('Lệch Bin');
  });

  it('mốc b4 vs nguồn B4 → không gắn cờ nguồn vừa đổi', () => {
    const r = detectSourceChange({ qty: 10, bin: 'b4' }, { stock_code: 'ST', qty: 10, bin: 'B4' });
    expect(r).toEqual({ changed: false, detail: null });
  });
});

describe('sortInventoryDupLast', () => {
  function row(id: string, tag: string): InventoryRow {
    return {
      id,
      batch_id: tag,
      stock_code: 'ST',
      qty: 1,
      bin: 'B1',
      is_manual: false,
      scanned_at: '2026-09-21T00:00:00Z',
    };
  }

  it('dòng trùng Tag gom xuống cuối, giữ thứ tự ổn định, không mất dòng', () => {
    const rows = [row('d1', 'DUP'), row('s1', 'SINGLE'), row('d2', 'DUP'), row('s2', 'SINGLE2')];
    const out = sortInventoryDupLast(rows);
    expect(out.map((r) => r.id)).toEqual(['s1', 's2', 'd1', 'd2']);
  });

  it('không có trùng → giữ nguyên thứ tự', () => {
    const rows = [row('a', 'A'), row('b', 'B')];
    expect(sortInventoryDupLast(rows).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
