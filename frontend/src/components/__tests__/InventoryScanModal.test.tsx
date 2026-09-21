import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryScanModal from '../InventoryScanModal';
import type { InventoryRow, ScanRow } from '../../lib/types';

vi.mock('../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('../../lib/exportExcel', async () => {
  const actual = await vi.importActual('../../lib/exportExcel');
  return { ...actual, downloadInventoryExcel: vi.fn() };
});

const invRows: InventoryRow[] = [
  {
    id: 'inv1',
    batch_id: 'TAG1',
    stock_code: 'ST_A',
    qty: 10,
    bin: 'BIN_A',
    is_manual: false,
    scanned_at: '2026-09-21T00:00:00Z',
  },
];

const scannedRows: ScanRow[] = [
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

const sys10 = new Map([['TAG1', { stock_code: 'ST_A', qty: 10, bin: 'BIN_A' }]]);
const sys12 = new Map([['TAG1', { stock_code: 'ST_A', qty: 12, bin: 'BIN_A' }]]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InventoryScanModal', () => {
  it('không render khi isOpen = false', () => {
    render(
      <InventoryScanModal
        isOpen={false}
        onClose={() => {}}
        inventoryRows={invRows}
        scannedRows={scannedRows}
        systemByBatch={sys10}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Bảng 3 nằm trong modal với đủ cột KK / B1 / B2', () => {
    render(
      <InventoryScanModal
        isOpen={true}
        onClose={() => {}}
        inventoryRows={invRows}
        scannedRows={scannedRows}
        systemByBatch={sys10}
      />,
    );
    expect(screen.getByText(/Bảng 3 — Đối chiếu kiểm kê/)).toBeInTheDocument();
    for (const h of ['BIN KK', 'SL KK', 'BIN B1', 'SL B1', 'BIN HT (B2)', 'SL HT (B2)', 'CẢNH BÁO']) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.getByTestId('inventory-row-inv1')).toBeInTheDocument();
    expect(screen.getByText('Khớp cả 2 bảng')).toBeInTheDocument();
  });

  it('nguồn đổi SL khi modal đang mở → highlight dòng + banner, chốt mốc thì hết', () => {
    const { rerender } = render(
      <InventoryScanModal
        isOpen={true}
        onClose={() => {}}
        inventoryRows={invRows}
        scannedRows={scannedRows}
        systemByBatch={sys10}
      />,
    );
    expect(screen.queryByTestId('inventory-source-changed-badge')).not.toBeInTheDocument();

    // Giả lập nạp file nguồn mới làm đổi SL hệ thống 10 → 12 trong lúc modal mở.
    rerender(
      <InventoryScanModal
        isOpen={true}
        onClose={() => {}}
        inventoryRows={invRows}
        scannedRows={scannedRows}
        systemByBatch={sys12}
      />,
    );
    expect(screen.getByTestId('inventory-source-changed-badge')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-source-changed-inv1')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-row-inv1').getAttribute('data-source-changed')).toBe('true');
    // Cảnh báo đối chiếu cũng tự tra lại theo nguồn mới.
    expect(screen.getByText(/Lệch SL vs hệ thống/)).toBeInTheDocument();

    // Bấm chốt lại mốc → highlight tắt.
    fireEvent.click(screen.getByRole('button', { name: /chốt lại mốc/i }));
    expect(screen.queryByTestId('inventory-source-changed-badge')).not.toBeInTheDocument();
  });
});
