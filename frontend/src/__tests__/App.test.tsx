import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const { submitScan, resolveDuplicate } = vi.hoisted(() => ({
  submitScan: vi.fn(),
  resolveDuplicate: vi.fn(),
}));
vi.mock('../lib/scanApi', () => ({ submitScan, resolveDuplicate }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => ({
            eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
            then: (res: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(res),
          }),
        }),
      }),
    }),
  },
}));

const mockExistingRow = {
  id: 'e1',
  batch_id: 'T1',
  qty: 1,
  bin: 'C4',
  stock_code: 'S1',
  status: 'ok' as const,
  resolution: null,
  is_manual: false,
  scanned_at: '2026-09-04T00:00:00Z',
};

vi.mock('../hooks/useScannedData', () => ({
  useScannedData: () => ({ rows: [mockExistingRow], loading: false, error: null }),
}));
vi.mock('../hooks/useReferenceMap', () => ({
  useReferenceMap: () => ({
    byBatch: new Map([['T1', { stock_code: 'S1', qty: 1, bin: 'C4' }]]),
    loading: false,
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('App layout and modal workflow', () => {
  it('hiển thị bảng đối chiếu và bảng nguồn, mở modal quét khi click Quét Tag', async () => {
    render(<App />);

    // Kiểm tra các bảng chính ở Dashboard
    expect(screen.getByText(/Bảng 1 — Danh Sách Quét & Đối Chiếu/i)).toBeInTheDocument();
    expect(screen.getByText(/Bảng 2 — Dữ liệu file nguồn/i)).toBeInTheDocument();

    // Mở modal quét
    const scanBtn = screen.getByRole('button', { name: /QUÉT TAG/i });
    expect(scanBtn).toBeInTheDocument();
    fireEvent.click(scanBtn);

    // Modal hiện lên với tiêu đề
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('PDA SCAN MATRIX')).toBeInTheDocument();
  });

  it('luồng quét Bin -> Tag -> Trùng -> Ghi thêm -> Điền SL tay -> Lưu', async () => {
    resolveDuplicate.mockResolvedValue({
      kind: 'resolved',
      result: { id: 'n1', status: 'duplicate', resolution: 'appended' },
    });

    render(<App />);

    // 1. Mở modal Quét Tag
    fireEvent.click(screen.getByRole('button', { name: /QUÉT TAG/i }));
    await screen.findByRole('dialog');

    // 2. Quét Bin
    const binInput = screen.getByPlaceholderText('READY TO SCAN BIN...');
    fireEvent.change(binInput, { target: { value: 'C4' } });
    fireEvent.submit(binInput.closest('form')!);

    // 3. Chuyển sang quét Tag ID
    const tagInput = await screen.findByPlaceholderText('SCAN TAG ID (ENTER)...');
    fireEvent.change(tagInput, { target: { value: 'T1' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });

    // 4. Phát hiện trùng mã -> hiện cảnh báo trực tiếp trong modal
    expect(await screen.findByText(/CẢNH BÁO TRÙNG MÃ/i)).toBeInTheDocument();

    // 5. Chọn Ghi thêm
    const appendBtn = screen.getByRole('button', { name: /1\. Ghi thêm/i });
    fireEvent.click(appendBtn);

    // 6. Nhập số lượng tay (bắt buộc gõ tay)
    const qtyInput = screen.getByPlaceholderText('NHẬP SỐ LƯỢNG...');
    fireEvent.change(qtyInput, { target: { value: '5' } });
    fireEvent.keyDown(qtyInput, { key: 'Enter', code: 'Enter' });

    // 7. Kiểm tra hàm resolveDuplicate được gọi đúng
    await waitFor(() =>
      expect(resolveDuplicate).toHaveBeenCalledWith({
        action: 'append',
        scannedId: 'e1',
        batchId: 'T1',
        qty: 5,
        bin: 'C4',
        stockCode: 'S1',
      }),
    );
  });
});
