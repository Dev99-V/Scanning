import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReconciliationTable from '../ReconciliationTable';
import type { ScanRow } from '../../lib/types';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    rpc,
  },
}));

function row(partial: Partial<ScanRow> & { id: string; batch_id: string }): ScanRow {
  return {
    qty: 1,
    bin: 'A1',
    status: 'ok',
    resolution: null,
    is_manual: false,
    scanned_at: '2026-09-04T00:00:00Z',
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('ReconciliationTable', () => {
  it('hiển thị SL/Bin quét cạnh SL/Bin hệ thống', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r1', batch_id: 'B1', qty: 5, bin: 'C4' })]}
        systemByBatch={new Map([['B1', { qty: 10, bin: 'C9' }]])}
      />,
    );
    const tr = screen.getByTestId('recon-row-r1');
    expect(tr).toHaveTextContent('B1');
    expect(tr).toHaveTextContent('5');
    expect(tr).toHaveTextContent('10');
    expect(tr).toHaveTextContent('C4');
    expect(tr).toHaveTextContent('C9');
  });

  it('cảnh báo màu đỏ (border-rose/bg-rose) khi lệch số lượng hoặc sai bin', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r1', batch_id: 'B1', qty: 5, bin: 'C4', status: 'qty_mismatch' })]}
        systemByBatch={new Map([['B1', { qty: 10, bin: 'C4' }]])}
      />,
    );
    const tr = screen.getByTestId('recon-row-r1');
    // Có thẻ cảnh báo màu đỏ rose
    const redCells = tr.querySelectorAll('.text-rose-400');
    expect(redCells.length).toBeGreaterThan(0);
  });

  it('đủ 6 cờ trạng thái inline', () => {
    const statuses = ['pending', 'ok', 'qty_mismatch', 'bin_mismatch', 'not_in_reference', 'duplicate'] as const;
    render(
      <ReconciliationTable
        rows={statuses.map((s, i) => row({ id: `r${i}`, batch_id: `B${i}`, status: s }))}
        systemByBatch={new Map()}
      />,
    );
    expect(screen.getByText('Chờ')).toBeInTheDocument();
    expect(screen.getByText('Khớp')).toBeInTheDocument();
    expect(screen.getByText('Lệch SL')).toBeInTheDocument();
    expect(screen.getByText('Lệch vị trí')).toBeInTheDocument();
    expect(screen.getByText('Ngoài hệ thống')).toBeInTheDocument();
    expect(screen.getByText('Trùng Tag')).toBeInTheDocument();
  });

  it('bấm nút xóa mở modal UI nổi xác nhận và gọi delete_scanned_row', async () => {
    const onRowDeleted = vi.fn();
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-del', batch_id: 'TAG_MISTAKE', qty: 3, bin: 'BIN_ERR' })]}
        systemByBatch={new Map()}
        onRowDeleted={onRowDeleted}
      />,
    );

    // Bấm nút xóa trên dòng
    const delBtn = screen.getByLabelText('Xóa lượt quét TAG_MISTAKE');
    fireEvent.click(delBtn);

    // Modal UI nổi xuất hiện
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Xác Nhận Xóa Lượt Quét/i)).toBeInTheDocument();
    expect(screen.getAllByText('TAG_MISTAKE').length).toBe(2);

    // Bấm xác nhận xóa trong modal
    const confirmBtn = screen.getByText('🗑️ Xác nhận xóa');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('delete_scanned_row', { p_id: 'r-del' });
      expect(onRowDeleted).toHaveBeenCalledWith('r-del');
    });
  });

  it('bấm nút sửa mở modal UI nổi chỉnh sửa Tag ID và gọi update_scanned_tag_id', async () => {
    const onRowUpdated = vi.fn();
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-edit', batch_id: 'WRONG_TAG', qty: 5, bin: 'BIN_A' })]}
        systemByBatch={new Map([['CORRECT_TAG', { stock_code: 'SKU_1', qty: 5, bin: 'BIN_A' }]])}
        onRowUpdated={onRowUpdated}
      />,
    );

    // Bấm nút sửa ✏️ trên dòng
    const editBtn = screen.getByLabelText('Chỉnh sửa Tag ID WRONG_TAG');
    fireEvent.click(editBtn);

    // Modal UI nổi xuất hiện
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Chỉnh Sửa Tag ID/i)).toBeInTheDocument();

    // Nhập Tag ID mới
    const input = screen.getByPlaceholderText('Nhập Tag ID chính xác...');
    fireEvent.change(input, { target: { value: 'CORRECT_TAG' } });

    // Hiển thị badge khớp nguồn
    expect(screen.getByText(/Khớp dữ liệu nguồn hệ thống/i)).toBeInTheDocument();

    // Bấm Lưu thay đổi
    const saveBtn = screen.getByText('💾 Lưu thay đổi');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('update_scanned_tag_id', {
        p_id: 'r-edit',
        p_new_batch_id: 'CORRECT_TAG',
        p_stock_code: null,
      });
      expect(onRowUpdated).toHaveBeenCalled();
    });
  });

  it('bấm trực tiếp vào chữ Tag ID cũng mở modal chỉnh sửa', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-click', batch_id: 'CLICK_TAG', qty: 2, bin: 'BIN_B' })]}
        systemByBatch={new Map()}
      />,
    );

    const tagBtn = screen.getByTitle('Bấm để chỉnh sửa Tag ID');
    fireEvent.click(tagBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Chỉnh Sửa Tag ID/i)).toBeInTheDocument();
  });

  it('KHÔNG liệt kê Tag ID chỉ có trong reference (không hiển thị lại Tag nguồn)', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r1', batch_id: 'SCANNED1' })]}
        systemByBatch={
          new Map([
            ['SCANNED1', { qty: 1, bin: 'A' }],
            ['SOURCE_ONLY_9', { qty: 99, bin: 'Z9' }],
          ])
        }
      />,
    );
    expect(screen.getByText('SCANNED1')).toBeInTheDocument();
    expect(screen.queryByText('SOURCE_ONLY_9')).not.toBeInTheDocument();
    expect(screen.queryByText('99')).not.toBeInTheDocument();
  });

  it('hiển thị — khi không có reference và khi trống', () => {
    render(<ReconciliationTable rows={[row({ id: 'r1', batch_id: 'BX' })]} systemByBatch={new Map()} />);
    expect(screen.getByTestId('recon-row-r1')).toHaveTextContent('—');
    render(<ReconciliationTable rows={[]} systemByBatch={new Map()} />);
    expect(screen.getByTestId('recon-empty')).toBeInTheDocument();
  });
});

