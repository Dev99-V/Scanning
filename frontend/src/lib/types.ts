// Kiểu dùng chung cho dữ liệu quét (khớp schema scanned_data, Plan.md §3.2).
import type { ScanStatus } from '../lib/scanApi';

export interface ScanRow {
  id: string;
  batch_id: string;
  qty: number;
  bin: string;
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
}
