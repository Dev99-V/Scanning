import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { EXPORT_HEADER, buildReconWorkbook } from './exportExcel';
import type { ScanRow } from './types';

const rows: ScanRow[] = [
  { id: 'r1', batch_id: '000012340001', qty: 5, bin: 'C4', status: 'ok', resolution: null, is_manual: false, scanned_at: '2026-09-04T00:00:00Z' },
  { id: 'r2', batch_id: '999900004299', qty: 3, bin: 'A1', status: 'bin_mismatch', resolution: null, is_manual: true, scanned_at: '2026-09-04T00:00:00Z' },
];
const sys = new Map([['000012340001', { qty: 5, bin: 'C4' }]]);

describe('buildReconWorkbook', () => {
  it('header + đủ cột kèm trạng thái đối chiếu', () => {
    const wb = buildReconWorkbook(rows, sys);
    const ws = wb.Sheets['DoiChieu'];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    expect(data[0]).toEqual(EXPORT_HEADER);
    expect(data).toHaveLength(3);
    expect(String(data[1][1])).toContain('000012340001');
    expect(data[1][6]).toBe('ok');
    expect(data[2][6]).toBe('bin_mismatch');
  });

  it('ép text: dấu nháy đầu + number format @ để giữ số 0 đầu', () => {
    const wb = buildReconWorkbook(rows, sys);
    const ws = wb.Sheets['DoiChieu'];
    const tagCell = ws['B2'] as { v: string; z: string };
    expect(tagCell.v).toBe("'000012340001");
    expect(tagCell.z).toBe('@');
    const qtyCell = ws['C2'] as { z: string };
    expect(qtyCell.z).toBe('@');
    // Đọc lại bằng Excel engine: text giữ nguyên (không mất số 0 đầu khi mở file)
    const buf: ArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const wb2 = XLSX.read(buf, { type: 'array' });
    const data2 = XLSX.utils.sheet_to_json(wb2.Sheets['DoiChieu'], { header: 1, raw: false }) as unknown[][];
    expect(String(data2[1][1])).toContain('000012340001');
  });

  it('batch không có trong hệ thống -> ô hệ thống trống', () => {
    const wb = buildReconWorkbook(rows, sys);
    const data = XLSX.utils.sheet_to_json(wb.Sheets['DoiChieu'], { header: 1 }) as unknown[][];
    expect(data[2][3]).toBeFalsy();
    expect(data[2][5]).toBeFalsy();
  });
});
