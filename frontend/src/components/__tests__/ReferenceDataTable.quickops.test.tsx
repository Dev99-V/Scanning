import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceDataTable from '../ReferenceDataTable';

const { select, order, range, rpc, chanOn, chanSubscribe, removeChannel, submitScan, resolveDuplicate } =
  vi.hoisted(() => ({
    select: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    rpc: vi.fn(),
    chanOn: vi.fn(),
    chanSubscribe: vi.fn(),
    removeChannel: vi.fn(),
    submitScan: vi.fn(),
    resolveDuplicate: vi.fn(),
  }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select }),
    rpc,
    channel: () => ({ on: chanOn }),
    removeChannel,
  },
}));

vi.mock('../../lib/scanApi', () => ({
  submitScan,
  resolveDuplicate,
}));

const ROWS = [
  { batch_id: 'TAG001', stock_code: '3400010001', warehouse: '01', bin: '200202', qty: 1000, previous_qty: null, create_date: '2026-09-04' },
  { batch_id: 'TAG002', stock_code: '3400010002', warehouse: '61', bin: '100101', qty: 900, previous_qty: null, create_date: '2026-09-04' },
];

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ order, range });
  range.mockResolvedValue({ data: ROWS, error: null });
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  chanOn.mockReturnValue({ subscribe: chanSubscribe });
  chanSubscribe.mockReturnValue({});
  submitScan.mockResolvedValue({ kind: 'scanned', result: { id: 'new-id', status: 'ok' } });
  resolveDuplicate.mockResolvedValue({ kind: 'resolved', result: { id: 'new-id', status: 'ok', resolution: 'appended' } });
});

describe('ReferenceDataTable quick ops (nhập nhanh + xóa nguồn)', () => {
  it('mỗi dòng có nút + nhập kho nhanh và nút xóa dòng nguồn', async () => {
    render(<ReferenceDataTable />);
    await screen.findByText('3400010001');
    expect(screen.getByLabelText('Nhập kho nhanh TAG001')).toBeInTheDocument();
    expect(screen.getByLabelText('Nhập kho nhanh TAG002')).toBeInTheDocument();
    expect(screen.getByLabelText('Xóa dòng nguồn TAG001')).toBeInTheDocument();
    expect(screen.getByLabelText('Xóa dòng nguồn TAG002')).toBeInTheDocument();
  });

  it('bấm + mở modal xác nhận 1 lần với Tag/Bin/SL rồi gọi scan-submit giống modal quét tag', async () => {
    const onQuickImported = vi.fn();
    render(<ReferenceDataTable onQuickImported={onQuickImported} />);
    await screen.findByText('3400010001');

    fireEvent.click(screen.getByLabelText('Nhập kho nhanh TAG001'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Nhập Kho Nhanh Sang Bảng 1/i)).toBeInTheDocument();
    // Tag prefill từ dòng nguồn, Bin + SL prefill đúng dữ liệu nguồn
    // (TAG001 xuất hiện cả ở bảng nền + modal nên dùng getAllByText)
    expect(screen.getAllByText('TAG001').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText('Vị trí Bin nhập kho nhanh')).toHaveValue('200202');
    expect(screen.getByLabelText('Số lượng nhập kho nhanh')).toHaveValue(1000);

    fireEvent.click(screen.getByText('⚡ Xác nhận nhập kho'));

    await waitFor(() => {
      expect(submitScan).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: 'TAG001', bin: '200202', qty: 1000, isManual: false }),
      );
      expect(onQuickImported).toHaveBeenCalled();
    });
  });

  it('nhập kho nhanh khi trùng Tag hiện Ghi thêm / Đổi vị trí và gọi resolve-duplicate', async () => {
    submitScan.mockResolvedValueOnce({
      kind: 'duplicate',
      conflict: { existingId: 'old-id', computedStatus: 'ok', attempted: { batchId: 'TAG001', qty: 1000, bin: '200202' } },
    });
    render(<ReferenceDataTable />);
    await screen.findByText('3400010001');

    fireEvent.click(screen.getByLabelText('Nhập kho nhanh TAG001'));
    fireEvent.click(screen.getByText('⚡ Xác nhận nhập kho'));

    // Sau conflict phải hiện 2 lựa chọn giống modal quét tag
    await waitFor(() => {
      expect(screen.getByText('➕ Ghi thêm')).toBeInTheDocument();
      expect(screen.getByText('🔄 Đổi vị trí')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('➕ Ghi thêm'));
    fireEvent.click(screen.getByText('⚡ Xác nhận nhập kho'));

    await waitFor(() => {
      expect(resolveDuplicate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'append', scannedId: 'old-id', batchId: 'TAG001' }),
      );
    });
  });

  it('bấm xóa mở modal xác nhận và gọi delete_reference_stock rồi gỡ dòng', async () => {
    const onReferenceDeleted = vi.fn();
    render(<ReferenceDataTable onReferenceDeleted={onReferenceDeleted} />);
    await screen.findByText('3400010001');

    fireEvent.click(screen.getByLabelText('Xóa dòng nguồn TAG001'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Xác Nhận Xóa Dòng Nguồn/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('🗑️ Xác nhận xóa'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('delete_reference_stock', { p_batch_id: 'TAG001' });
      expect(onReferenceDeleted).toHaveBeenCalledWith('TAG001');
    });
    await waitFor(() => {
      expect(screen.queryByText('TAG001')).not.toBeInTheDocument();
    });
  });
});
