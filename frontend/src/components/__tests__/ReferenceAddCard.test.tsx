import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceAddCard from '../ReferenceAddCard';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc,
  },
}));

const existingRows = [
  {
    batch_id: 'TAG100',
    stock_code: '3400010001',
    warehouse: 'WH01',
    bin: 'C4',
    qty: 100,
    previous_qty: null,
    previous_bin: null,
    create_date: '2026-09-04',
  },
  {
    batch_id: 'TAG200',
    stock_code: '3400010002',
    warehouse: 'WH50',
    bin: 'A2',
    qty: 250,
    previous_qty: null,
    previous_bin: null,
    create_date: '2026-09-04',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: {
      ok: true,
      data: {
        batch_id: 'NEW_TAG_001',
        stock_code: '3400010001',
        warehouse: 'WH01',
        bin: 'B9',
        qty: 50,
        create_date: new Date().toISOString(),
      },
    },
    error: null,
  });
});

describe('ReferenceAddCard', () => {
  it('hiển thị đầy đủ các trường nhập liệu và tự động chọn ngày hôm nay', () => {
    render(<ReferenceAddCard existingRows={existingRows} />);

    expect(screen.getByText(/Thẻ Thêm Dữ Liệu Nguồn Mới/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Mã hàng \(Stock Code\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Tag ID \(Batch\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Kho \(Warehouse\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Vị trí \(Bin\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Số lượng/i)).toBeInTheDocument();

    const dateInput = screen.getByLabelText(/Ngày tạo \(Tự động\)/i) as HTMLInputElement;
    expect(dateInput).toBeInTheDocument();
    expect(dateInput.value).toBe(new Date().toISOString().slice(0, 10));
    expect(dateInput).toHaveAttribute('readonly');
  });

  it('gợi ý dropdown Stock Code khi gõ và chọn gợi ý tự điền vào ô', async () => {
    render(<ReferenceAddCard existingRows={existingRows} />);

    const stockInput = screen.getByLabelText(/Mã hàng \(Stock Code\)/i);
    fireEvent.focus(stockInput);
    fireEvent.change(stockInput, { target: { value: '3400' } });

    // Hiển thị gợi ý dropdown
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('3400010001')).toBeInTheDocument();
    expect(screen.getByText('3400010002')).toBeInTheDocument();

    // Click chọn gợi ý thứ nhất
    const option = screen.getByText('3400010001');
    fireEvent.mouseDown(option);

    // Giá trị được điền vào ô input
    expect(stockInput).toHaveValue('3400010001');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('gợi ý dropdown Kho (Warehouse) khi gõ và chọn gợi ý tự điền vào ô', async () => {
    render(<ReferenceAddCard existingRows={existingRows} />);

    const whInput = screen.getByLabelText(/Kho \(Warehouse\)/i);
    fireEvent.focus(whInput);
    fireEvent.change(whInput, { target: { value: 'WH' } });

    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('WH01')).toBeInTheDocument();
    expect(screen.getByText('WH50')).toBeInTheDocument();

    // Click chọn WH50
    fireEvent.mouseDown(screen.getByText('WH50'));
    expect(whInput).toHaveValue('WH50');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('báo lỗi validation khi thiếu các trường bắt buộc', async () => {
    render(<ReferenceAddCard existingRows={existingRows} />);

    const submitBtn = screen.getByRole('button', { name: /Thêm Vào Dữ Liệu Nguồn/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Vui lòng nhập Tag ID \(Batch\)/i)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('thêm thành công dữ liệu nguồn mới qua RPC add_reference_stock và gọi onAddSuccess', async () => {
    const onAddSuccess = vi.fn();
    render(<ReferenceAddCard existingRows={existingRows} onAddSuccess={onAddSuccess} />);

    fireEvent.change(screen.getByLabelText(/Tag ID \(Batch\)/i), { target: { value: 'NEW_TAG_001' } });
    fireEvent.change(screen.getByLabelText(/Mã hàng \(Stock Code\)/i), { target: { value: '3400010001' } });
    fireEvent.change(screen.getByLabelText(/Kho \(Warehouse\)/i), { target: { value: 'WH01' } });
    fireEvent.change(screen.getByLabelText(/Vị trí \(Bin\)/i), { target: { value: 'B9' } });
    fireEvent.change(screen.getByLabelText(/Số lượng/i), { target: { value: '50' } });

    const submitBtn = screen.getByRole('button', { name: /Thêm Vào Dữ Liệu Nguồn/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith(
        'add_reference_stock',
        expect.objectContaining({
          p_batch_id: 'NEW_TAG_001',
          p_stock_code: '3400010001',
          p_warehouse: 'WH01',
          p_bin: 'B9',
          p_qty: 50,
          p_overwrite: false,
        }),
      );
    });

    expect(await screen.findByText(/Đã thêm Tag ID NEW_TAG_001 vào nguồn thành công!/i)).toBeInTheDocument();
    expect(onAddSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        batch_id: 'NEW_TAG_001',
        stock_code: '3400010001',
        warehouse: 'WH01',
        bin: 'B9',
        qty: 50,
      }),
    );
  });

  it('hiển thị cảnh báo trùng Tag ID và cho phép ghi đè cập nhật', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        ok: false,
        error: 'duplicate_batch_id',
        message: 'Tag ID TAG100 đã tồn tại trong dữ liệu nguồn (Mã: 3400010001, Kho: WH01, Bin: C4)',
      },
      error: null,
    });

    render(<ReferenceAddCard existingRows={existingRows} />);

    fireEvent.change(screen.getByLabelText(/Tag ID \(Batch\)/i), { target: { value: 'TAG100' } });
    fireEvent.change(screen.getByLabelText(/Mã hàng \(Stock Code\)/i), { target: { value: '3400010001' } });
    fireEvent.change(screen.getByLabelText(/Kho \(Warehouse\)/i), { target: { value: 'WH01' } });
    fireEvent.change(screen.getByLabelText(/Vị trí \(Bin\)/i), { target: { value: 'C4' } });
    fireEvent.change(screen.getByLabelText(/Số lượng/i), { target: { value: '100' } });

    fireEvent.click(screen.getByRole('button', { name: /Thêm Vào Dữ Liệu Nguồn/i }));

    expect(await screen.findByText(/Tag ID TAG100 đã tồn tại trong dữ liệu nguồn/i)).toBeInTheDocument();
    expect(screen.getByText('Ghi đè cập nhật')).toBeInTheDocument();

    // Mock response khi ghi đè thành công
    rpc.mockResolvedValueOnce({
      data: { ok: true, data: {} },
      error: null,
    });

    fireEvent.click(screen.getByText('Ghi đè cập nhật'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith(
        'add_reference_stock',
        expect.objectContaining({
          p_batch_id: 'TAG100',
          p_overwrite: true,
        }),
      );
    });
  });
});
