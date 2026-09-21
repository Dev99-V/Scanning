import { describe, expect, it } from 'vitest';
import { compareInventoryRow, detectSourceChange } from './inventoryCompare';
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
