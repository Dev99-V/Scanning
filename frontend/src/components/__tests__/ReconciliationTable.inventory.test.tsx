import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReconciliationTable from '../ReconciliationTable';
import type { InventoryRow, ScanRow } from '../../lib/types';

vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: { ok: true }, error: null }) },
}));

function scanRow(partial: Partial<ScanRow> & { id: string; batch_id: string }): ScanRow {
  return {
    qty: 10,
    bin: 'BIN_A',
    stock_code: 'ST',
    status: 'ok',
    resolution: null,
    is_manual: false,
    scanned_at: '2026-09-21T00:00:00Z',
    ...partial,
  };
}

function invRow(partial: Partial<InventoryRow> & { id: string; batch_id: string }): InventoryRow {
  return {
    qty: 10,
    bin: 'BIN_A',
    stock_code: 'ST',
    is_manual: false,
    scanned_at: '2026-09-21T00:00:00Z',
    ...partial,
  };
}

const sys = new Map([
  ['OK_TAG', { stock_code: 'ST', qty: 10, bin: 'BIN_A' }],
  ['BAD_TAG', { stock_code: 'ST', qty: 8, bin: 'BIN_A' }],
]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReconciliationTable — highlight kiểm kê Bảng 3', () => {
  it('Tag kiểm kê khớp → cột KIỂM KÊ hiện badge, Tag lệch → gạch ngang', () => {
    render(
      <ReconciliationTable
        rows={[
          scanRow({ id: 'r1', batch_id: 'OK_TAG' }),
          scanRow({ id: 'r2', batch_id: 'BAD_TAG', status: 'qty_mismatch' }),
        ]}
        systemByBatch={sys}
        inventoryRows={[invRow({ id: 'i1', batch_id: 'OK_TAG' }), invRow({ id: 'i2', batch_id: 'BAD_TAG' })]}
      />,
    );
    expect(screen.getByText('KIỂM KÊ')).toBeInTheDocument();
    expect(screen.getByTestId('recon-checked-r1')).toHaveTextContent('Đã KK');
    expect(screen.queryByTestId('recon-checked-r2')).not.toBeInTheDocument();
  });

  it('bật Ẩn đã KK khớp → loại trừ dòng khớp, giữ dòng chưa khớp', () => {
    render(
      <ReconciliationTable
        rows={[
          scanRow({ id: 'r1', batch_id: 'OK_TAG' }),
          scanRow({ id: 'r2', batch_id: 'BAD_TAG', status: 'qty_mismatch' }),
        ]}
        systemByBatch={sys}
        inventoryRows={[invRow({ id: 'i1', batch_id: 'OK_TAG' }), invRow({ id: 'i2', batch_id: 'BAD_TAG' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Ẩn dòng đã kiểm kê khớp/ }));
    expect(screen.queryByTestId('recon-row-r1')).not.toBeInTheDocument();
    expect(screen.getByTestId('recon-row-r2')).toBeInTheDocument();
  });

  it('dòng trùng quét không bị highlight kiểm kê (giữ lại xử lý trùng)', () => {
    render(
      <ReconciliationTable
        rows={[
          scanRow({ id: 'r1', batch_id: 'OK_TAG' }),
          scanRow({ id: 'r2', batch_id: 'OK_TAG', bin: 'BIN_B', status: 'duplicate' }),
        ]}
        systemByBatch={sys}
        inventoryRows={[invRow({ id: 'i1', batch_id: 'OK_TAG', qty: 20 })]}
      />,
    );
    expect(screen.queryByTestId('recon-checked-r1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('recon-checked-r2')).not.toBeInTheDocument();
  });
});
