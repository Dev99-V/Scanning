// Kiểu dùng chung cho dữ liệu quét (khớp schema scanned_data, Plan.md §3.2).
import type { ScanStatus } from '../lib/scanApi';

export interface ScanRow {
  id: string;
  batch_id: string;
  qty: number;
  bin: string;
  stock_code?: string | null;
  status: ScanStatus;
  resolution: 'appended' | 'relocated' | null;
  is_manual: boolean;
  scanned_at: string;
}

export interface ReferenceRow {
  batch_id: string;
  stock_code: string;
  warehouse: string;
  bin: string;
  qty: number;
  tag_7055?: boolean;
}

// Dòng kiểm kê (bảng inventory_counts): ghi riêng trong modal Quét Kiểm Kê,
// đối chiếu chéo với Bảng 1 (scanned_data) + Bảng 2 (reference_stock).
export interface InventoryRow {
  id: string;
  batch_id: string;
  stock_code?: string | null;
  qty: number;
  bin: string;
  is_manual: boolean;
  scanned_at: string;
}
