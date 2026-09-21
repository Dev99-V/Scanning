import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryTable from '../InventoryTable';
import type { InventoryRow, ScanRow } from '../../lib/types';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: mockRpc },
}));

vi.mock('../../lib/exportExcel', async () => {
  const actual = await vi.importActual('../../lib/exportExcel');
  return { ...actual, downloadInventoryExcel: vi.fn() };
});

import { downloadInventoryExcel } from '../../lib/exportExcel';

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

const inventoryRows: InventoryRow[] = [
  {
    id: 'i1',
    batch_id: 'TAG1',
    stock_code: 'ST_A',
    qty: 10,
    bin: 'BIN_A',
    is_manual: false,
    scanned_at: '2026-09-21T00:00:00Z',
  },
  {
    id: 'i2',
    batch_id: 'TAG2',
    stock_code: 'ST_B',
    qty: 3,
    bin: 'BIN_X',
    is_manual: false,
    scanned_at: '2026-09-21T00:00:00Z',
  },
];

const sys = new Map([
  ['TAG1', { stock_code: 'ST_A', qty: 10, bin: 'BIN_A' }],
  ['TAG2', { stock_code: 'ST_B', qty: 9, bin: 'BIN_X' }],
]);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: { ok: true, id: 'i2', batch_id: 'TAG2' }, error: null });
});

describe('InventoryTable', () => {
  it('render trực tiếp (không phải dialog) đủ cột KK/B1/B2 + export', () => {
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    for (const h of ['BIN KK', 'SL KK', 'BIN B1', 'SL B1', 'BIN HT (B2)', 'SL HT (B2)', 'CẢNH BÁO']) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    expect(screen.getByTestId('inventory-row-i1')).toHaveTextContent('Khớp cả 2 bảng');
    expect(screen.getByTestId('inventory-row-i2')).toHaveTextContent('Lệch SL vs hệ thống');
    expect(screen.getByRole('button', { name: /EXPORT XLSX/ })).toBeInTheDocument();
  });

  it('nút Quét Kiểm Kê gọi onOpenScan, nút Export gọi downloadInventoryExcel', () => {
    const onOpenScan = vi.fn();
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={onOpenScan}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /QUÉT KIỂM KÊ/ }));
    expect(onOpenScan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /EXPORT XLSX/ }));
    expect(downloadInventoryExcel).toHaveBeenCalledTimes(1);
  });

  it('tìm kiếm + lọc chỉ-hiện-lệch', () => {
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Tìm kiếm bảng kiểm kê'), { target: { value: 'TAG2' } });
    expect(screen.queryByTestId('inventory-row-i1')).not.toBeInTheDocument();
    expect(screen.getByTestId('inventory-row-i2')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Tìm kiếm bảng kiểm kê'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Chỉ hiện dòng kiểm kê lệch/ }));
    expect(screen.queryByTestId('inventory-row-i1')).not.toBeInTheDocument();
    expect(screen.getByTestId('inventory-row-i2')).toBeInTheDocument();
  });

  it('xóa dòng qua RPC delete_inventory_row', async () => {
    const onChanged = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByLabelText('Xóa dòng kiểm kê TAG2'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('delete_inventory_row', { p_id: 'i2' }));
    expect(onChanged).toHaveBeenCalledTimes(1);
    (window.confirm as unknown as { mockRestore: () => void }).mockRestore();
  });

  it('chưa có dữ liệu → empty state', () => {
    render(
      <InventoryTable inventoryRows={[]} scannedRows={[]} systemByBatch={new Map()} onOpenScan={() => {}} />,
    );
    expect(screen.getByTestId('inventory-empty')).toBeInTheDocument();
  });
});
