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
        p_new_qty: 5,
        p_new_bin: 'BIN_A',
      });
      expect(onRowUpdated).toHaveBeenCalled();
    });
  });

  it('cho phép chỉnh sửa số lượng đã quét trong modal chỉnh sửa ở Bảng 1', async () => {
    const onRowUpdated = vi.fn();
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-qty-edit', batch_id: 'TAG_001', qty: 2, bin: 'BIN_A' })]}
        systemByBatch={new Map([['TAG_001', { stock_code: 'SKU_1', qty: 5, bin: 'BIN_A' }]])}
        onRowUpdated={onRowUpdated}
      />,
    );

    // Bấm vào ô số lượng quét để mở modal sửa
    const qtyBtn = screen.getByTitle('Bấm để chỉnh sửa lượt quét');
    fireEvent.click(qtyBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Chỉnh Sửa Tag ID, Số Lượng & Vị Trí Quét/i)).toBeInTheDocument();

    // Sửa số lượng quét từ 2 thành 5
    const qtyInput = screen.getByLabelText('Số lượng quét mới');
    expect(qtyInput).toHaveValue(2);
    fireEvent.change(qtyInput, { target: { value: '5' } });

    // Bấm Lưu thay đổi
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('update_scanned_tag_id', {
        p_id: 'r-qty-edit',
        p_new_batch_id: 'TAG_001',
        p_stock_code: 'SKU_1',
        p_new_qty: 5,
        p_new_bin: 'BIN_A',
      });
      expect(onRowUpdated).toHaveBeenCalled();
    });
  });

  it('cho phép sửa nhanh vị trí (Bin) quét trong modal bút ở Bảng 1', async () => {
    const onRowUpdated = vi.fn();
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-bin-edit', batch_id: 'TAG_001', qty: 5, bin: 'BIN_OLD' })]}
        systemByBatch={new Map([['TAG_001', { stock_code: 'SKU_1', qty: 5, bin: 'BIN_NEW_REF' }]])}
        onRowUpdated={onRowUpdated}
      />,
    );

    // Bấm vào ô Bin quét để mở modal sửa nhanh
    const binBtn = screen.getByTitle('Bấm để chỉnh sửa vị trí quét');
    fireEvent.click(binBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const binInput = screen.getByLabelText('Vị trí Bin quét mới');
    expect(binInput).toHaveValue('BIN_OLD');
    fireEvent.change(binInput, { target: { value: 'BIN_NEW_REF' } });

    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('update_scanned_tag_id', {
        p_id: 'r-bin-edit',
        p_new_batch_id: 'TAG_001',
        p_stock_code: 'SKU_1',
        p_new_qty: 5,
        p_new_bin: 'BIN_NEW_REF',
      });
      expect(onRowUpdated).toHaveBeenCalled();
    });
  });

  it('fallback khi backend cloud chưa có p_new_bin: thử lại contract cũ, Tag/SL vẫn lưu', async () => {
    // Lần 1 (kèm p_new_bin) bị PostgREST từ chối vì cloud chưa deploy migration;
    // lần 2 (không p_new_bin) thành công — Bin mới báo rõ là chưa áp dụng.
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: {
          message:
            'Could not find the function public.update_scanned_tag_id(p_actor_name, p_id, p_new_batch_id, p_new_bin, p_new_qty, p_stock_code) in the schema cache',
        },
      })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    const onRowUpdated = vi.fn();
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-fallback', batch_id: 'TAG_001', qty: 5, bin: 'BIN_OLD' })]}
        systemByBatch={new Map([['TAG_001', { stock_code: 'SKU_1', qty: 5, bin: 'BIN_OLD' }]])}
        onRowUpdated={onRowUpdated}
      />,
    );

    fireEvent.click(screen.getByTitle('Bấm để chỉnh sửa vị trí quét'));
    fireEvent.change(screen.getByLabelText('Vị trí Bin quét mới'), { target: { value: 'BIN_NEW' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledTimes(2);
      // Lần 2 không còn p_new_bin để khớp contract cũ trên cloud
      expect(rpc).toHaveBeenLastCalledWith('update_scanned_tag_id', {
        p_id: 'r-fallback',
        p_new_batch_id: 'TAG_001',
        p_stock_code: 'SKU_1',
        p_new_qty: 5,
      });
      expect(onRowUpdated).toHaveBeenCalled();
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/backend cloud chưa deploy migration/i);
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

  it('hiển thị badge 🏷️ 7055 bên cạnh Tag ID ở Bảng 1 khi tag thuộc diện 7055', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-7055', batch_id: 'TAG_IN_THEM_7055', qty: 10, bin: 'C4' })]}
        systemByBatch={new Map([['TAG_IN_THEM_7055', { qty: 10, bin: 'C4', tag_7055: true }]])}
      />,
    );

    const badge = screen.getByTestId('recon-tag-7055-TAG_IN_THEM_7055');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('7055');
  });

  it('nhận diện quét trùng nhiều vị trí: hiển thị duplicate-alert và ghi chú quét X lần', () => {
    const rows = [
      row({ id: 'r-dup-1', batch_id: 'TAG_DUP_01', qty: 10, bin: 'BIN_A', status: 'ok' }),
      row({ id: 'r-dup-2', batch_id: 'TAG_DUP_01', qty: 10, bin: 'BIN_B', status: 'bin_mismatch' }),
    ];

    render(<ReconciliationTable rows={rows} systemByBatch={new Map([['TAG_DUP_01', { qty: 10, bin: 'BIN_A' }]])} />);

    const row1 = screen.getByTestId('recon-row-r-dup-1');
    const row2 = screen.getByTestId('recon-row-r-dup-2');

    expect(row1).toHaveClass('duplicate-alert');
    expect(row2).toHaveClass('duplicate-alert');

    expect(row1).toHaveTextContent(/Trùng Tag/i);
    expect(row2).toHaveTextContent(/Trùng Tag/i);

    expect(row1).toHaveTextContent(/Quét 2 lần ở các vị trí khác nhau/i);
    expect(row2).toHaveTextContent(/Quét 2 lần ở các vị trí khác nhau/i);
  });

  it('BUG ẢNH: status ok stale nhưng BIN lệch nguồn → note Lệch vị trí, KHÔNG "Khớp hoàn toàn"', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-stale', batch_id: 'STALE01', qty: 958, bin: '25', status: 'ok' })]}
        systemByBatch={new Map([['STALE01', { stock_code: 'S1', qty: 958, bin: '01' }]])}
      />,
    );
    const tr = screen.getByTestId('recon-row-r-stale');
    expect(tr).toHaveTextContent(/Lệch vị trí/);
    expect(tr).toHaveTextContent(/Quét: 25 \/ Nguồn: 01/);
    expect(tr).not.toHaveTextContent('Khớp hoàn toàn');
  });

  it('BIN đệm khoảng trắng không báo lệch giả (đồng nhất TRIM với import/RPC)', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-trim', batch_id: 'TRIM01', qty: 5, bin: '25', status: 'ok' })]}
        systemByBatch={new Map([['TRIM01', { stock_code: 'S1', qty: 5, bin: '25 ' }]])}
      />,
    );
    const tr = screen.getByTestId('recon-row-r-trim');
    expect(tr).toHaveTextContent('Khớp hoàn toàn');
    expect(tr).not.toHaveTextContent(/Lệch vị trí/);
  });

  it('mất khỏi nguồn mà status còn ok stale → cảnh báo đỏ, không xanh Khớp hoàn toàn', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-gone', batch_id: 'GONE01', qty: 5, bin: '020101', status: 'ok' })]}
        systemByBatch={new Map()}
      />,
    );
    const tr = screen.getByTestId('recon-row-r-gone');
    expect(tr).toHaveTextContent(/Không còn trong nguồn/);
    expect(tr).not.toHaveTextContent('Khớp hoàn toàn');
    expect(tr.querySelectorAll('.text-rose-400').length).toBeGreaterThan(0);
  });
});

