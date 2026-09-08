// Khóa mềm realtime Bảng 2: dòng nguồn bị người khác giữ thì disable 2 nút sửa.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsePresenceApi } from '../../hooks/usePresence';
import ReferenceDataTable from '../ReferenceDataTable';

const { select, order, range, rpc, chanOn, chanSubscribe, removeChannel } = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
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

const ROWS = [
  { batch_id: 'TAG9', stock_code: 'SC1', warehouse: '01', bin: 'B1', qty: 5, previous_bin: null, previous_qty: null, create_date: null },
];

function presenceStub(locked: boolean): UsePresenceApi {
  return {
    peers: [],
    onlineCount: 1,
    setViewing: vi.fn(),
    setEditing: vi.fn(),
    clearEditing: vi.fn(),
    getLock: vi.fn().mockReturnValue(
      locked
        ? { sessionId: 's2', name: 'Anh B', color: 'blue', viewing: 'table2', editing: { table: 'table2', key: 't2:TAG9', batchId: 'TAG9' }, updatedAt: Date.now() }
        : null,
    ),
    viewersOfTable: vi.fn().mockReturnValue([]),
    editorsOfTable: vi.fn().mockReturnValue([]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ range });
  range.mockResolvedValue({ data: ROWS, error: null });
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  chanOn.mockReturnValue({ subscribe: chanSubscribe });
  chanSubscribe.mockReturnValue({});
});

describe('ReferenceDataTable presence lock', () => {
  it('dòng bị khóa: disable nút sửa + badge tên người giữ', async () => {
    render(<ReferenceDataTable scannedRows={[]} presence={presenceStub(true)} />);
    expect(await screen.findByText(/Anh B đang thao tác/)).toBeInTheDocument();
    expect(screen.getByLabelText('Chỉnh sửa vị trí TAG9')).toBeDisabled();
    expect(screen.getByLabelText('Chỉnh sửa số lượng TAG9')).toBeDisabled();
  });

  it('dòng không bị khóa: nút sửa bấm được', async () => {
    render(<ReferenceDataTable scannedRows={[]} presence={presenceStub(false)} />);
    expect(await screen.findByText('TAG9')).toBeInTheDocument();
    expect(screen.getByLabelText('Chỉnh sửa vị trí TAG9')).not.toBeDisabled();
    expect(screen.getByLabelText('Chỉnh sửa số lượng TAG9')).not.toBeDisabled();
  });
});
