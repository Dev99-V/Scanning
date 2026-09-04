// exportExcel — xuất đối chiếu ra .xlsx (Plan.md §7.5, Skills B).
// Ép text (number format '@' + dấu nháy đầu) cho cột mã để Excel không nuốt
// số 0 đầu — đúng kỹ thuật bản prototype scantag.html. Thêm cột trạng thái
// đối chiếu theo yêu cầu (“export kèm cột trạng thái”).
import * as XLSX from 'xlsx';
import type { SystemNumbers } from '../hooks/useReferenceMap';
import type { ScanRow } from '../lib/types';

export const EXPORT_HEADER = ['Tag ID', 'SL quét', 'SL hệ thống', 'Bin quét', 'Bin hệ thống', 'Trạng thái'];

function textCell(v: string | number): { v: string; t: 's'; z: '@' } {
  return { v: `'${v}`, t: 's', z: '@' };
}

export function buildReconWorkbook(rows: ScanRow[], systemByBatch: Map<string, SystemNumbers>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const data: unknown[][] = [EXPORT_HEADER];
  for (const r of rows) {
    const sys = systemByBatch.get(r.batch_id);
    data.push([
      textCell(r.batch_id),
      textCell(r.qty),
      sys ? textCell(sys.qty) : '',
      textCell(r.bin),
      sys ? textCell(sys.bin) : '',
      r.status,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    for (let R = range.s.r + 1; R <= range.e.r; R++) {
      const addr = XLSX.utils.encode_cell({ r: R, c });
      const cell = ws[addr] as { z?: string } | undefined;
      // Mọi ô dữ liệu ép text; ô status (chuỗi thường) cũng ép text cho đồng nhất.
      if (cell && typeof cell === 'object') cell.z = '@';
      else ws[addr] = { v: '', t: 's', z: '@' };
    }
  }
  XLSX.utils.book_append_sheet(wb, ws, 'DoiChieu');
  return wb;
}

export function downloadReconExcel(rows: ScanRow[], systemByBatch: Map<string, SystemNumbers>): void {
  const wb = buildReconWorkbook(rows, systemByBatch);
  XLSX.writeFile(wb, `DoiChieu_${Date.now()}.xlsx`);
}
