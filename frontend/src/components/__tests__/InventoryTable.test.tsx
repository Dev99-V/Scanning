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

  it('xóa dòng qua modal xác nhận custom (không window.confirm)', async () => {
    const onChanged = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');
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
    // Modal custom hiện, window.confirm không được gọi
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Xác Nhận Xóa Lượt Kiểm Kê')).toBeInTheDocument();
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('🗑️ Xác nhận xóa'));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('delete_inventory_row', { p_id: 'i2' }));
    expect(onChanged).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('chưa có dữ liệu → empty state', () => {
    render(
      <InventoryTable inventoryRows={[]} scannedRows={[]} systemByBatch={new Map()} onOpenScan={() => {}} />,
    );
    expect(screen.getByTestId('inventory-empty')).toBeInTheDocument();
  });

  it('bấm nút sửa mở modal chỉnh sửa SL+Bin KK và gọi update_inventory_row', async () => {
    const onChanged = vi.fn();
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByLabelText('Chỉnh sửa lượt kiểm kê TAG2'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Chỉnh Sửa Lượt Kiểm Kê')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Số lượng kiểm kê mới'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Vị trí Bin kiểm kê mới'), { target: { value: 'BIN_NEW' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('update_inventory_row', {
        p_id: 'i2',
        p_new_qty: 5,
        p_new_bin: 'BIN_NEW',
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('SL sai (0) hoặc Bin trống thì báo lỗi và không gọi RPC', () => {
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Chỉnh sửa lượt kiểm kê TAG2'));

    fireEvent.change(screen.getByLabelText('Số lượng kiểm kê mới'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));
    expect(screen.getByRole('alert')).toHaveTextContent('Số lượng kiểm kê');
    expect(mockRpc).not.toHaveBeenCalledWith('update_inventory_row', expect.anything());

    fireEvent.change(screen.getByLabelText('Số lượng kiểm kê mới'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Vị trí Bin kiểm kê mới'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));
    expect(screen.getByRole('alert')).toHaveTextContent('Vị trí (Bin)');
    expect(mockRpc).not.toHaveBeenCalledWith('update_inventory_row', expect.anything());
  });

  it('Bin sửa nhập thường b4 → RPC nhận B4 đã UPPER', async () => {
    const onChanged = vi.fn();
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
        onChanged={onChanged}
      />,
    );
    fireEvent.click(screen.getByLabelText('Chỉnh sửa lượt kiểm kê TAG2'));
    fireEvent.change(screen.getByLabelText('Số lượng kiểm kê mới'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Vị trí Bin kiểm kê mới'), { target: { value: 'b4' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('update_inventory_row', {
        p_id: 'i2',
        p_new_qty: 5,
        p_new_bin: 'B4',
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('dòng trùng Tag nội bộ gom xuống cuối bảng, cảnh báo dòng đơn giữ nguyên', () => {
    const dupRows: InventoryRow[] = [
      { id: 'd1', batch_id: 'DUP', stock_code: 'ST', qty: 1, bin: 'B1', is_manual: false, scanned_at: '' },
      { id: 's1', batch_id: 'SINGLE', stock_code: 'ST', qty: 1, bin: 'B1', is_manual: false, scanned_at: '' },
      { id: 'd2', batch_id: 'DUP', stock_code: 'ST', qty: 1, bin: 'B1', is_manual: false, scanned_at: '' },
    ];
    const { container } = render(
      <InventoryTable inventoryRows={dupRows} scannedRows={[]} systemByBatch={new Map()} onOpenScan={() => {}} />,
    );
    const ids = Array.from(container.querySelectorAll('[data-testid^="inventory-row-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(ids).toEqual(['inventory-row-s1', 'inventory-row-d1', 'inventory-row-d2']);
  });

  it('bấm ô TAG ID mở modal sửa và đổi TAG gửi p_new_batch_id', async () => {
    const onChanged = vi.fn();
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
        onChanged={onChanged}
      />,
    );
    // Ô TAG ID là nút bấm mở modal (mở qua nút sửa dòng TAG2 cho xác định)
    fireEvent.click(screen.getByLabelText('Chỉnh sửa lượt kiểm kê TAG2'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Ô TAG ID trong bảng cũng là nút bấm
    expect(screen.getAllByTitle('Bấm để chỉnh sửa TAG ID kiểm kê')).toHaveLength(2);
    expect(screen.getByLabelText('TAG ID kiểm kê mới')).toHaveValue('TAG2');

    fireEvent.change(screen.getByLabelText('TAG ID kiểm kê mới'), { target: { value: 'TAG1' } });
    // Gợi ý tra cứu nguồn hiện mã hàng của TAG mới
    expect(screen.getByText(/Có trong nguồn: Mã hàng ST_A/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('update_inventory_row', {
        p_id: 'i2',
        p_new_qty: 3,
        p_new_bin: 'BIN_X',
        p_new_batch_id: 'TAG1',
      }),
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('TAG trống thì báo lỗi và không gọi RPC', () => {
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Chỉnh sửa lượt kiểm kê TAG2'));
    fireEvent.change(screen.getByLabelText('TAG ID kiểm kê mới'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));
    expect(screen.getByRole('alert')).toHaveTextContent('TAG ID');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('TAG trùng dòng khác → báo chống trùng, TAG ngoài nguồn → báo nguồn (không đóng modal)', async () => {
    render(
      <InventoryTable
        inventoryRows={inventoryRows}
        scannedRows={scannedRows}
        systemByBatch={sys}
        onOpenScan={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText('Chỉnh sửa lượt kiểm kê TAG2'));

    // Trùng cứng
    mockRpc.mockResolvedValueOnce({ data: { ok: false, error: 'duplicate_batch_id' }, error: null });
    fireEvent.change(screen.getByLabelText('TAG ID kiểm kê mới'), { target: { value: 'TAG1' } });
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('dòng kiểm kê khác'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Ngoài nguồn
    mockRpc.mockResolvedValueOnce({ data: { ok: false, error: 'not_in_reference' }, error: null });
    fireEvent.change(screen.getByLabelText('TAG ID kiểm kê mới'), { target: { value: 'TAG_LẠ' } });
    expect(screen.getByText(/không có trong nguồn/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('💾 Lưu thay đổi'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bảng 2'));
  });
});
