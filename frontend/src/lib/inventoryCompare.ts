// inventoryCompare — logic đối chiếu Bảng 3 kiểm kê với Bảng 1 + Bảng 2.
// Pure function để dễ unit-test, UI chỉ render kết quả.
// - Bảng 1 (scanned_data): tổng hợp theo batch_id (tổng SL + danh sách Bin đã quét).
// - Bảng 2 (reference_stock): tra qua byBatch (SL + Bin hệ thống).
import type { SystemNumbers } from '../hooks/useReferenceMap';
import type { InventoryRow, ScanRow } from './types';

export interface InventoryComparison {
  /** Tổng SL đã quét ở Bảng 1 cho cùng Tag (null = chưa có ở Bảng 1). */
  table1Qty: number | null;
  /** Các Bin đã quét ở Bảng 1 cho cùng Tag. */
  table1Bins: string[];
  /** SL hệ thống Bảng 2 (null = ngoài nguồn). */
  table2Qty: number | null;
  /** Bin hệ thống Bảng 2. */
  table2Bin: string | null;
  /** Stock code hệ thống (fallback hiển thị). */
  systemStockCode: string | null;
  /** true khi khớp cả SL + Bin với cả 2 bảng. */
  allMatch: boolean;
  /** Danh sách cảnh báo chi tiết (rỗng = khớp hoàn toàn). */
  warnings: string[];
}

/** Chuẩn hóa BIN để so sánh: TRIM + UPPER (user chốt 2026-09-24: b4 = B4).
 * DB cũng lưu upper(btrim(bin)) từ migration 20260926; hàm này là lưới an
 * toàn cho dòng cũ chưa backfill + input chưa chuẩn hóa. */
export function normBin(v: string | null | undefined): string {
  return (v || '').trim().toUpperCase();
}

/** Tổng hợp Bảng 1 theo Tag (dùng chung cho đối chiếu từng dòng + check-tag). */
export interface Table1Agg {
  present: boolean;
  qty: number | null;
  bins: string[];
}

export function aggregateTable1(matches: ScanRow[]): Table1Agg {
  if (matches.length === 0) return { present: false, qty: null, bins: [] };
  return {
    present: true,
    qty: matches.reduce((sum, r) => sum + Number(r.qty || 0), 0),
    bins: [...new Set(matches.map((r) => normBin(r.bin)).filter(Boolean))],
  };
}

/** Logic cảnh báo dùng chung — Bảng 3 và check-tag Bảng 1 phải ra cùng kết quả. */
export function inventoryWarnings(
  row: InventoryRow,
  agg: Table1Agg,
  sys: SystemNumbers | undefined,
): string[] {
  const warnings: string[] = [];
  if (!agg.present || agg.qty === null) {
    warnings.push('Chưa có ở Bảng 1 (chưa quét đối chiếu)');
  } else {
    if (Number(row.qty) !== agg.qty) {
      warnings.push(`Lệch SL vs Bảng 1 (kiểm kê: ${row.qty} / Bảng 1: ${agg.qty})`);
    }
    const kkBin = normBin(row.bin);
    if (kkBin && !agg.bins.includes(kkBin)) {
      warnings.push(`Lệch Bin vs Bảng 1 (kiểm kê: ${row.bin} / Bảng 1: ${agg.bins.join(', ') || '—'})`);
    }
  }

  if (sys == null) {
    warnings.push('Ngoài nguồn (không có ở Bảng 2)');
  } else {
    if (Number(row.qty) !== Number(sys.qty)) {
      warnings.push(`Lệch SL vs hệ thống (kiểm kê: ${row.qty} / HT: ${sys.qty})`);
    }
    if (normBin(row.bin) !== normBin(sys.bin)) {
      warnings.push(`Lệch Bin vs hệ thống (kiểm kê: ${row.bin} / HT: ${sys.bin || '—'})`);
    }
  }
  return warnings;
}

export function compareInventoryRow(
  row: InventoryRow,
  scannedRows: ScanRow[],
  systemByBatch: Map<string, SystemNumbers>,
): InventoryComparison {
  const cleanTag = (row.batch_id || '').trim();
  const agg = aggregateTable1(scannedRows.filter((r) => (r.batch_id || '').trim() === cleanTag));
  const sys = systemByBatch.get(cleanTag);
  const warnings = inventoryWarnings(row, agg, sys);

  return {
    table1Qty: agg.qty,
    table1Bins: agg.bins,
    table2Qty: sys ? Number(sys.qty) : null,
    table2Bin: sys ? (sys.bin || '').trim() || null : null,
    systemStockCode: sys?.stock_code ?? null,
    allMatch: warnings.length === 0,
    warnings,
  };
}

/**
 * Map Tag → đã kiểm kê khớp hay chưa, để Bảng 1 highlight + loại trừ dần.
 * Tag được tính là khớp khi có ≥1 dòng kiểm kê và MỌI dòng kiểm kê của Tag
 * đều khớp cả Bảng 1 lẫn Bảng 2 (cùng logic inventoryWarnings, tổng hợp 1 pass).
 */
export function buildCheckedTagMap(
  inventoryRows: InventoryRow[],
  scannedRows: ScanRow[],
  systemByBatch: Map<string, SystemNumbers>,
): Map<string, boolean> {
  const scannedByTag = new Map<string, ScanRow[]>();
  for (const s of scannedRows) {
    const k = (s.batch_id || '').trim();
    if (!k) continue;
    const list = scannedByTag.get(k);
    if (list) list.push(s);
    else scannedByTag.set(k, [s]);
  }
  const invByTag = new Map<string, InventoryRow[]>();
  for (const r of inventoryRows) {
    const k = (r.batch_id || '').trim();
    if (!k) continue;
    const list = invByTag.get(k);
    if (list) list.push(r);
    else invByTag.set(k, [r]);
  }

  const out = new Map<string, boolean>();
  for (const [tag, invs] of invByTag) {
    const agg = aggregateTable1(scannedByTag.get(tag) ?? []);
    const sys = systemByBatch.get(tag);
    out.set(tag, invs.every((inv) => inventoryWarnings(inv, agg, sys).length === 0));
  }
  return out;
}

/**
 * Xếp dòng TRÙNG Tag nội bộ Bảng 3 xuống cuối bảng (user chốt 2026-09-24:
 * gom trùng cũ xuống cuối để nhận diện + xóa, không thêm UI nặng).
 * - Ổn định (stable): giữ nguyên thứ tự trong nhóm không-trùng và nhóm trùng.
 * - Không đụng dữ liệu/highlight/cảnh báo: chỉ đổi thứ tự hiển thị.
 */
export function sortInventoryDupLast<T extends { batch_id: string }>(rows: T[]): T[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = (r.batch_id || '').trim();
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const single: T[] = [];
  const dup: T[] = [];
  for (const r of rows) {
    if ((counts.get((r.batch_id || '').trim()) || 0) > 1) dup.push(r);
    else single.push(r);
  }
  return [...single, ...dup];
}

/** Mốc nguồn đã chốt cho 1 Tag tại thời điểm mở modal (để phát hiện nguồn vừa đổi). */
export interface SourceBaseline {
  /** NaN = lúc chốt mốc Tag chưa có trong nguồn. */
  qty: number;
  bin: string;
}

export interface SourceChange {
  changed: boolean;
  /** Mô tả cũ → mới (null khi không đổi). */
  detail: string | null;
}

/**
 * So sánh giá trị nguồn HIỆN TẠI với mốc đã chốt lúc mở modal.
 * Pure function để unit-test + render badge "🔄 Nguồn vừa đổi" ở Bảng 3.
 * - SL hoặc Bin khác mốc → changed.
 * - Có ở mốc nhưng mất khỏi nguồn (bị xóa) → changed.
 * - Chưa có ở mốc nhưng giờ xuất hiện (thêm mới) → changed.
 */
export function detectSourceChange(
  baseline: SourceBaseline | undefined,
  sys: SystemNumbers | undefined,
): SourceChange {
  if (!baseline) return { changed: false, detail: null };
  const baseHad = !Number.isNaN(baseline.qty);
  if (sys == null) {
    if (!baseHad) return { changed: false, detail: null };
    return { changed: true, detail: `Nguồn xóa Tag này (trước: SL ${baseline.qty}, Bin ${baseline.bin || '—'})` };
  }
  const curQty = Number(sys.qty);
  const curBin = normBin(sys.bin);
  if (!baseHad) {
    return { changed: true, detail: `Nguồn thêm mới Tag này (SL ${curQty}, Bin ${curBin || '—'})` };
  }
  const parts: string[] = [];
  if (curQty !== baseline.qty) parts.push(`SL ${baseline.qty}→${curQty}`);
  // So sánh BIN không phân biệt hoa/thường (b4 = B4 đã chuẩn hóa UPPER).
  if (curBin !== normBin(baseline.bin)) parts.push(`Bin ${baseline.bin || '—'}→${curBin || '—'}`);
  if (parts.length === 0) return { changed: false, detail: null };
  return { changed: true, detail: `Nguồn vừa đổi: ${parts.join(', ')}` };
}
