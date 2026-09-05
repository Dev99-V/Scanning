import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceDataTable from '../ReferenceDataTable';

const { select, order, range, eq, rpc } = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  eq: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select }),
    rpc,
  },
}));

const ROWS = [
  { batch_id: 'TAG001', stock_code: '3400010001', warehouse: '01', bin: 'C4', qty: 1000, previous_qty: null, create_date: '2026-09-04' },
  { batch_id: 'TAG002', stock_code: '3400010002', warehouse: '61', bin: 'C2', qty: 900, previous_qty: null, create_date: '2026-09-04' },
];

function thenable() {
  return {
    eq,
    range,
    then: (res: (v: unknown) => void) => Promise.resolve({ data: ROWS, error: null }).then(res),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ range, eq });
  range.mockReturnValue(Promise.resolve({ data: ROWS, error: null }));
  eq.mockImplementation(() => ({ range, eq, thenable: thenable() }));
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('ReferenceDataTable', () => {
  it('select đầy đủ cột nguồn bao gồm batch_id, previous_bin và previous_qty, render các dòng', async () => {
    render(<ReferenceDataTable />);
    await waitFor(() =>
      expect(select).toHaveBeenCalledWith('batch_id,stock_code,warehouse,bin,previous_bin,qty,previous_qty,create_date')
    );
    expect(await screen.findByText('3400010001')).toBeInTheDocument();
    expect(screen.getByText('TAG001')).toBeInTheDocument();
    expect(screen.getByText('3400010002')).toBeInTheDocument();
    expect(screen.getByText('TAG002')).toBeInTheDocument();
  });

  it('lọc thông minh với tiền tố WH cho kho và tìm kiếm thông thường', async () => {
    render(<ReferenceDataTable />);
    await screen.findByText('3400010001');

    // Lọc thông minh theo Kho với tiền tố WH
    const smartInput = screen.getByLabelText('Tìm kiếm thông minh');
    fireEvent.change(smartInput, { target: { value: 'WH01' } });
    expect(screen.getByText('3400010001')).toBeInTheDocument();
    expect(screen.queryByText('3400010002')).not.toBeInTheDocument();

    // Lọc thông thường theo Tag ID
    fireEvent.change(smartInput, { target: { value: 'TAG002' } });
    expect(screen.getByText('3400010002')).toBeInTheDocument();
    expect(screen.queryByText('3400010001')).not.toBeInTheDocument();
  });

  it('mở modal sửa số lượng và hiển thị note số lượng cũ cùng vị trí', async () => {
    render(<ReferenceDataTable />);
    await screen.findByText('3400010001');

    // Bấm nút sửa số lượng của TAG001
    const editBtn = screen.getByLabelText('Chỉnh sửa số lượng TAG001');
    fireEvent.click(editBtn);

    // Modal xuất hiện
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Chỉnh Sửa Số Lượng Nguồn/i)).toBeInTheDocument();

    // Nhập số lượng mới 300
    const qtyInput = screen.getByLabelText('Số lượng mới:');
    fireEvent.change(qtyInput, { target: { value: '300' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('update_reference_qty', {
        p_batch_id: 'TAG001',
        p_new_qty: 300,
      });
    });

    // Sau khi sửa, hiển thị số lượng 300 và note lại số lượng cũ (cũ: 1000)
    await waitFor(() => {
      expect(screen.getByText('300')).toBeInTheDocument();
      expect(screen.getByText('(cũ: 1000)')).toBeInTheDocument();
    });
  });

  it('mở modal sửa vị trí (Bin) và hiển thị note vị trí cũ cùng vị trí', async () => {
    const onBinUpdated = vi.fn();
    render(<ReferenceDataTable onBinUpdated={onBinUpdated} />);
    await screen.findByText('3400010001');

    // Bấm nút sửa vị trí của TAG001
    const editBinBtn = screen.getByLabelText('Chỉnh sửa vị trí TAG001');
    fireEvent.click(editBinBtn);

    // Modal xuất hiện
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Chỉnh Sửa Vị Trí Nguồn \(Bin\)/i)).toBeInTheDocument();

    // Nhập vị trí mới C9-NEW
    const binInput = screen.getByLabelText('Vị trí Bin mới:');
    fireEvent.change(binInput, { target: { value: 'C9-NEW' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('update_reference_bin', {
        p_batch_id: 'TAG001',
        p_new_bin: 'C9-NEW',
      });
      expect(onBinUpdated).toHaveBeenCalledWith('TAG001', 'C9-NEW');
    });

    // Sau khi sửa, hiển thị vị trí mới C9-NEW và note lại vị trí cũ (cũ: C4)
    await waitFor(() => {
      expect(screen.getByText('C9-NEW')).toBeInTheDocument();
      expect(screen.getByText('(cũ: C4)')).toBeInTheDocument();
    });
  });
});
