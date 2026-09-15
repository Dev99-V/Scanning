// Khóa mềm realtime Bảng 1: dòng bị người khác giữ thì disable nút + badge,
// hết khóa thì thao tác bình thường.
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsePresenceApi } from '../../hooks/usePresence';
import type { ScanRow } from '../../lib/types';
import ReconciliationTable from '../ReconciliationTable';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));

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

function presenceStub(holder: { name: string } | null): UsePresenceApi {
  return {
    peers: [],
    onlineCount: 1,
    setViewing: vi.fn(),
    setEditing: vi.fn(),
    clearEditing: vi.fn(),
    getLock: vi.fn().mockReturnValue(
      holder ? { sessionId: 's2', name: holder.name, color: 'red', viewing: 'table1', editing: { table: 'table1', key: 't1:r1', batchId: 'B1' }, updatedAt: Date.now() } : null,
    ),
    viewersOfTable: vi.fn().mockReturnValue([]),
    editorsOfTable: vi.fn().mockReturnValue([]),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe('ReconciliationTable presence lock', () => {
  it('dòng bị khóa: disable nút sửa/xóa + hiện badge tên người giữ', () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r1', batch_id: 'B1' })]}
        systemByBatch={new Map()}
        presence={presenceStub({ name: 'Anh A' })}
      />,
    );
    expect(screen.getByText(/Anh A đang thao tác/)).toBeInTheDocument();
    expect(screen.getByLabelText('Chỉnh sửa Tag ID B1')).toBeDisabled();
    expect(screen.getByLabelText('Xóa lượt quét B1')).toBeDisabled();
  });

  it('dòng không bị khóa: vẫn mở được modal sửa và track editing', () => {
    const presence = presenceStub(null);
    render(
      <ReconciliationTable
        rows={[row({ id: 'r1', batch_id: 'B1' })]}
        systemByBatch={new Map()}
        presence={presence}
      />,
    );
    fireEvent.click(screen.getByLabelText('Chỉnh sửa Tag ID B1'));
    expect(screen.getByText('Chỉnh Sửa Tag ID, Số Lượng & Vị Trí Quét')).toBeInTheDocument();
    expect(presence.setEditing).toHaveBeenCalledWith(
      expect.objectContaining({ table: 'table1', key: 't1:r1', batchId: 'B1' }),
    );
  });
});
