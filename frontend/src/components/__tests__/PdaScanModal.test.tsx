import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PdaScanModal from '../PdaScanModal';
import type { ScanRow } from '../../lib/types';
import * as exportExcel from '../../lib/exportExcel';

const { submitScan, resolveDuplicate } = vi.hoisted(() => ({
  submitScan: vi.fn(),
  resolveDuplicate: vi.fn(),
}));

vi.mock('../../lib/scanApi', () => ({
  submitScan,
  resolveDuplicate,
}));

vi.mock('../../lib/exportExcel', async () => {
  const actual = await vi.importActual('../../lib/exportExcel');
  return {
    ...actual,
    downloadStreamingExcel: vi.fn(),
  };
});

const mockRows: ScanRow[] = [
  {
    id: 'r1',
    batch_id: 'EXISTING_TAG',
    qty: 10,
    bin: 'OLD_BIN',
    stock_code: 'STOCK_A',
    status: 'ok',
    resolution: null,
    is_manual: false,
    scanned_at: '2026-09-04T00:00:00Z',
  },
];

const mockSystemByBatch = new Map([
  ['KNOWN_TAG', { stock_code: 'STOCK_KNOWN', qty: 20, bin: 'BIN_A' }],
]);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PdaScanModal', () => {
  it('không render khi isOpen = false', () => {
    render(
      <PdaScanModal
        isOpen={false}
        onClose={() => {}}
        rows={mockRows}
        systemByBatch={mockSystemByBatch}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('luồng chuẩn: Quét Bin -> Quét Tag (có trong nguồn) -> Nhập SL tay -> submitScan', async () => {
    submitScan.mockResolvedValue({
      kind: 'scanned',
      result: { id: 'new_id', status: 'ok', stockCode: 'STOCK_KNOWN' },
    });

    render(
      <PdaScanModal
        isOpen={true}
        onClose={() => {}}
        rows={[]}
        systemByBatch={mockSystemByBatch}
      />,
    );

    // 1. Quét Bin
    const binInput = screen.getByPlaceholderText('READY TO SCAN BIN...');
    fireEvent.change(binInput, { target: { value: 'BIN_A' } });
    fireEvent.submit(binInput.closest('form')!);

    // Chuyển sang quét Tag
    const tagInput = await screen.findByPlaceholderText('SCAN TAG ID (ENTER)...');
    expect(screen.getByTestId('pda-active-bin')).toHaveTextContent('BIN_A');

    // 2. Quét Tag ID có trong nguồn
    fireEvent.change(tagInput, { target: { value: 'KNOWN_TAG' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });

    // Hiển thị mã hàng nguồn tự động
    expect(await screen.findByText('STOCK_KNOWN')).toBeInTheDocument();

    // 3. Nhập số lượng tay (bắt buộc)
    const qtyInput = screen.getByPlaceholderText('NHẬP SỐ LƯỢNG...');
    expect(qtyInput).toHaveValue(null); // Ô số lượng luôn để trống theo yêu cầu
    fireEvent.change(qtyInput, { target: { value: '15' } });
    fireEvent.keyDown(qtyInput, { key: 'Enter', code: 'Enter' });

    // 4. Kiểm tra gọi submitScan
    await waitFor(() =>
      expect(submitScan).toHaveBeenCalledWith({
        batchId: 'KNOWN_TAG',
        qty: 15,
        bin: 'BIN_A',
        isManual: false,
        stockCode: 'STOCK_KNOWN',
      }),
    );
  });

  it('luồng cảnh báo: Tag ID không có trong nguồn -> mở ô nhập Stock code', async () => {
    submitScan.mockResolvedValue({
      kind: 'scanned',
      result: { id: 'new_id', status: 'not_in_reference' },
    });

    render(
      <PdaScanModal
        isOpen={true}
        onClose={() => {}}
        rows={[]}
        systemByBatch={mockSystemByBatch}
      />,
    );

    // 1. Quét Bin
    const binInput = screen.getByPlaceholderText('READY TO SCAN BIN...');
    fireEvent.change(binInput, { target: { value: 'BIN_X' } });
    fireEvent.submit(binInput.closest('form')!);

    // 2. Quét Tag ID không có trong nguồn
    const tagInput = await screen.findByPlaceholderText('SCAN TAG ID (ENTER)...');
    fireEvent.change(tagInput, { target: { value: 'UNKNOWN_TAG' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });

    // Cảnh báo xuất hiện
    expect(await screen.findByText(/Tag ID không tồn tại trong file nguồn!/i)).toBeInTheDocument();

    // 3. Điền Stock code bằng tay
    const stockInput = screen.getByPlaceholderText('NHẬP STOCK CODE...');
    fireEvent.change(stockInput, { target: { value: 'MANUAL_STOCK_01' } });

    // 4. Nhập số lượng và lưu
    const qtyInput = screen.getByPlaceholderText('NHẬP SỐ LƯỢNG...');
    fireEvent.change(qtyInput, { target: { value: '3' } });
    fireEvent.keyDown(qtyInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(submitScan).toHaveBeenCalledWith({
        batchId: 'UNKNOWN_TAG',
        qty: 3,
        bin: 'BIN_X',
        isManual: false,
        stockCode: 'MANUAL_STOCK_01',
      }),
    );
  });

  it('luồng trùng: chọn Đổi vị trí -> resolveDuplicate relocate', async () => {
    resolveDuplicate.mockResolvedValue({
      kind: 'resolved',
      result: { id: 'r1', status: 'ok', resolution: 'relocated' },
    });

    render(
      <PdaScanModal
        isOpen={true}
        onClose={() => {}}
        rows={mockRows}
        systemByBatch={mockSystemByBatch}
      />,
    );

    // 1. Quét Bin mới
    const binInput = screen.getByPlaceholderText('READY TO SCAN BIN...');
    fireEvent.change(binInput, { target: { value: 'NEW_BIN' } });
    fireEvent.submit(binInput.closest('form')!);

    // 2. Quét Tag trùng đã có trong mockRows
    const tagInput = await screen.findByPlaceholderText('SCAN TAG ID (ENTER)...');
    fireEvent.change(tagInput, { target: { value: 'EXISTING_TAG' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });

    // 3. Cảnh báo trùng hiện ra
    expect(await screen.findByText(/CẢNH BÁO TRÙNG MÃ/i)).toBeInTheDocument();

    // 4. Chọn Đổi vị trí
    fireEvent.click(screen.getByRole('button', { name: /2\. Đổi vị trí/i }));

    // 5. Nhập số lượng và lưu
    const qtyInput = screen.getByPlaceholderText('NHẬP SỐ LƯỢNG...');
    fireEvent.change(qtyInput, { target: { value: '10' } });
    fireEvent.keyDown(qtyInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(resolveDuplicate).toHaveBeenCalledWith({
        action: 'relocate',
        scannedId: 'r1',
        batchId: 'EXISTING_TAG',
        qty: 10,
        bin: 'NEW_BIN',
        stockCode: null,
      }),
    );
  });

  it('nút Export XLS ở bảng streaming hoạt động', () => {
    render(
      <PdaScanModal
        isOpen={true}
        onClose={() => {}}
        rows={mockRows}
        systemByBatch={mockSystemByBatch}
      />,
    );

    const exportBtn = screen.getByRole('button', { name: /EXPORT XLS/i });
    fireEvent.click(exportBtn);

    expect(exportExcel.downloadStreamingExcel).toHaveBeenCalledWith(mockRows);
  });
});
