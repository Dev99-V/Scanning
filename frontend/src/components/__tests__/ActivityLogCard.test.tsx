// Thẻ Nhật ký hoạt động: render log, lọc tìm kiếm, export Excel.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ActivityLogCard from '../ActivityLogCard';

const { downloadAuditExcel } = vi.hoisted(() => ({ downloadAuditExcel: vi.fn() }));
vi.mock('../../lib/exportExcel', () => ({ downloadAuditExcel }));

const { select, order, range, chanOn, chanSubscribe, removeChannel } = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  chanOn: vi.fn(),
  chanSubscribe: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({ select }),
    channel: () => ({ on: chanOn }),
    removeChannel,
  },
}));

const ROWS = [
  { id: 2, scanned_id: null, action: 'insert', old_value: null, new_value: { kind: 'reference_add', batch_id: 'TAG9', stock_code: 'S', warehouse: '01', bin: 'B', qty: 5, overwrote: false }, actor: null, actor_name: 'Anh B', created_at: '2026-09-08T02:00:00Z' },
  { id: 1, scanned_id: 's1', action: 'insert', old_value: null, new_value: { batch_id: 'TAG1', qty: 3, bin: 'C4', status: 'ok' }, actor: null, actor_name: 'Anh A', created_at: '2026-09-08T01:00:00Z' },
];

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ range });
  range.mockResolvedValue({ data: ROWS, error: null });
  chanOn.mockReturnValue({ subscribe: chanSubscribe });
  chanSubscribe.mockReturnValue({});
});

describe('ActivityLogCard', () => {
  it('hiển thị tên người làm + hành động + Tag ID', async () => {
    render(<ActivityLogCard />);
    expect(await screen.findByText('Anh A')).toBeInTheDocument();
    expect(screen.getByText('Anh B')).toBeInTheDocument();
    expect(screen.getByText('Quét PDA')).toBeInTheDocument();
    expect(screen.getByText('Thêm mã nguồn')).toBeInTheDocument();
    expect(screen.getByText('TAG1')).toBeInTheDocument();
  });

  it('ô tìm kiếm lọc theo tên người làm', async () => {
    render(<ActivityLogCard />);
    await screen.findByText('Anh A');
    fireEvent.change(screen.getByLabelText('Tìm kiếm nhật ký'), { target: { value: 'Anh B' } });
    expect(screen.queryByText('Anh A')).not.toBeInTheDocument();
    expect(screen.getByText('Anh B')).toBeInTheDocument();
  });

  it('nút Export xuất đúng các dòng đang lọc', async () => {
    render(<ActivityLogCard />);
    await screen.findByText('Anh A');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    await waitFor(() => expect(downloadAuditExcel).toHaveBeenCalledTimes(1));
    const exported = downloadAuditExcel.mock.calls[0][0] as unknown[];
    expect(exported).toHaveLength(2);
  });
});
