import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceDataTable from '../ReferenceDataTable';

const { select, order, range, eq, rpc, chanOn, chanSubscribe, removeChannel } = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  eq: vi.fn(),
  rpc: vi.fn(),
  chanOn: vi.fn(),
  chanSubscribe: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select }),
    rpc,
    channel: () => ({ on: chanOn }),
    removeChannel,
  },
}));

// 1 dòng cũ (trước 28/08/2026) + 2 dòng mới (đúng ngưỡng và sau ngưỡng).
const ROWS = [
  { batch_id: 'TAG_OLD', stock_code: '3400010001', warehouse: '01', bin: '200202', qty: 1000, previous_qty: null, create_date: '2026-08-27' },
  { batch_id: 'TAG_EDGE', stock_code: '3400010002', warehouse: '01', bin: '200203', qty: 500, previous_qty: null, create_date: '2026-08-28' },
  { batch_id: 'TAG_NEW', stock_code: '3400010003', warehouse: '61', bin: '100101', qty: 900, previous_qty: null, create_date: '2026-09-04' },
];

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ order, range, eq });
  range.mockReturnValue(Promise.resolve({ data: ROWS, error: null }));
  eq.mockImplementation(() => ({ range, eq }));
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  chanOn.mockReturnValue({ subscribe: chanSubscribe });
  chanSubscribe.mockReturnValue({});
});

describe('ReferenceDataTable — cảnh báo ngày tạo mới (≥ 28/08/2026)', () => {
  it('chỉ highlight CHỮ ở ô Ngày tạo của dòng mới, dòng cũ giữ nguyên', async () => {
    render(<ReferenceDataTable />);
    await screen.findByText('TAG_OLD');

    // Header badge tổng số dòng mới = 2 (EDGE + NEW).
    expect(screen.getByTestId('ref-recent-badge')).toHaveTextContent(/NGÀY TẠO MỚI.*2 DÒNG/i);

    // 2 ô ngày mới có highlight chữ + nhãn MỚI.
    const recentCells = screen.getAllByTestId('ref-cell-date-recent');
    expect(recentCells).toHaveLength(2);
    const recentBadges = screen.getAllByTestId('ref-badge-recent');
    expect(recentBadges).toHaveLength(2);

    // Dòng cũ không có highlight ngày mới (tổng 3 dòng mà chỉ 2 ô recent).
    // Ngày cũ vẫn render bình thường (27/08/2026 theo locale vi-VN).
    expect(screen.getByText('TAG_OLD')).toBeInTheDocument();
  });

  it('không đè mất highlight nền đã có: dòng vừa khớp Bảng 1 vừa mới vẫn giữ nền khớp', async () => {
    const mockScannedRows = [
      {
        id: 's1',
        batch_id: 'TAG_NEW',
        qty: 900,
        bin: '100101',
        stock_code: '3400010003',
        status: 'ok' as const,
        resolution: null,
        is_manual: false,
        scanned_at: '2026-09-05T00:00:00Z',
      },
    ];

    render(<ReferenceDataTable scannedRows={mockScannedRows} />);
    await screen.findByText('TAG_NEW');

    // Nền khớp vẫn còn (testid matched) + badge ĐÃ KHỚP.
    const matchedRows = screen.getAllByTestId('ref-row-matched');
    expect(matchedRows.length).toBeGreaterThanOrEqual(1);
    expect(matchedRows[0]).toHaveTextContent('TAG_NEW');

    // Đồng thời ô ngày của chính dòng đó vẫn highlight chữ MỚI.
    expect(screen.getAllByTestId('ref-cell-date-recent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId('ref-badge-recent').length).toBeGreaterThanOrEqual(1);
  });

  it('tìm "mới" ở ô thông minh lọc ra đúng dòng ngày tạo mới', async () => {
    render(<ReferenceDataTable />);
    await screen.findByText('TAG_OLD');

    const smartInput = screen.getByLabelText('Tìm kiếm thông minh');
    fireEvent.change(smartInput, { target: { value: 'mới' } });

    await waitFor(() => {
      expect(screen.queryByText('TAG_OLD')).not.toBeInTheDocument();
    });
    expect(screen.getByText('TAG_EDGE')).toBeInTheDocument();
    expect(screen.getByText('TAG_NEW')).toBeInTheDocument();
  });
});
