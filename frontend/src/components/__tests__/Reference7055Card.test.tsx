import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as exportExcel from '../../lib/exportExcel';
import Reference7055Card from '../Reference7055Card';
import type { ReferenceLine } from '../ReferenceDataTable';

const mock7055Rows: ReferenceLine[] = [
  {
    batch_id: '000070550001',
    stock_code: '3400010001',
    warehouse: 'WH01',
    bin: '010101',
    qty: 150,
    create_date: '2026-09-07T00:00:00Z',
    tag_7055: true,
  },
  {
    batch_id: '000070550002',
    stock_code: '3400010002',
    warehouse: 'WH02',
    bin: '020202',
    qty: 250,
    create_date: '2026-09-07T00:00:00Z',
    tag_7055: true,
  },
];

describe('Reference7055Card', () => {
  it('render thẻ với tiêu đề Tag in thêm và số lượng tag đã ghi nhận', () => {
    render(<Reference7055Card rows7055={mock7055Rows} />);
    expect(screen.getByText(/Tag in thêm \(7055\)/i)).toBeInTheDocument();
    expect(screen.getByTestId('ref-7055-badge-count')).toHaveTextContent('2 tag đã ghi nhận');
  });

  it('bấm mở bảng tag in thêm thì modal nổi xuất hiện hiển thị đầy đủ danh sách', () => {
    render(<Reference7055Card rows7055={mock7055Rows} />);

    // Ban đầu modal chưa mở
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Bấm mở modal
    fireEvent.click(screen.getByTestId('btn-open-7055-modal'));

    // Modal xuất hiện
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Bảng Danh Sách Tag In Thêm 7055')).toBeInTheDocument();

    // Hiển thị cả 2 dòng tag
    expect(screen.getByText('000070550001')).toBeInTheDocument();
    expect(screen.getByText('000070550002')).toBeInTheDocument();
    expect(screen.getByText('3400010001')).toBeInTheDocument();
    expect(screen.getByText('3400010002')).toBeInTheDocument();
  });

  it('tìm kiếm bên trong modal nổi lọc đúng dòng', () => {
    render(<Reference7055Card rows7055={mock7055Rows} />);
    fireEvent.click(screen.getByTestId('btn-open-7055-modal'));

    const searchInput = screen.getByPlaceholderText(/Tìm nhanh Tag ID, Mã hàng/i);
    fireEvent.change(searchInput, { target: { value: '000070550002' } });

    expect(screen.getByText('000070550002')).toBeInTheDocument();
    expect(screen.queryByText('000070550001')).not.toBeInTheDocument();
  });

  it('bấm nút xuất Excel gọi hàm download7055Excel', () => {
    const downloadSpy = vi.spyOn(exportExcel, 'download7055Excel').mockImplementation(() => {});
    render(<Reference7055Card rows7055={mock7055Rows} />);

    // Nút xuất Excel nhanh ở thẻ
    const exportBtn = screen.getByTestId('btn-quick-export-7055');
    fireEvent.click(exportBtn);

    expect(downloadSpy).toHaveBeenCalledWith(mock7055Rows);
    downloadSpy.mockRestore();
  });
});
