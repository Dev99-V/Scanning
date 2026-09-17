import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReconciliationTable from '../ReconciliationTable';
import type { ScanRow } from '../../lib/types';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));

const { copyTextMock, smoothMock } = vi.hoisted(() => ({
  copyTextMock: vi.fn(),
  smoothMock: vi.fn(),
}));
vi.mock('../../lib/copyText', () => ({ copyText: copyTextMock }));
vi.mock('../../lib/smoothScroll', () => ({ smoothScrollToElementById: smoothMock }));

function row(partial: Partial<ScanRow> & { id: string; batch_id: string }): ScanRow {
  return {
    qty: 5,
    bin: 'BIN01',
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
  copyTextMock.mockResolvedValue(true);
});

describe('ReconciliationTable — copy nhanh + lối tắt Bảng 2', () => {
  it('mỗi dòng có 3 icon copy TAG / SL / BIN, bấm chỉ copy đúng 1 giá trị', async () => {
    render(
      <ReconciliationTable
        rows={[row({ id: 'r-copy', batch_id: '100006049868', qty: 7, bin: 'BIN77' })]}
        systemByBatch={new Map()}
      />,
    );
    // Bấm TAG -> chỉ copy Tag ID, icon TAG chuyển ✓
    fireEvent.click(screen.getByTestId('copy-tag-r-copy'));
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledWith('100006049868'));
    await waitFor(() => expect(screen.getByTestId('copy-tag-r-copy')).toHaveTextContent('✓'));

    // Bấm SL -> chỉ copy số lượng, icon SL chuyển ✓ (TAG quay về 📋 vì chỉ 1 ô báo ✓ tại 1 thời điểm)
    fireEvent.click(screen.getByTestId('copy-qty-r-copy'));
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledWith('7'));
    await waitFor(() => expect(screen.getByTestId('copy-qty-r-copy')).toHaveTextContent('✓'));

    // Bấm BIN -> chỉ copy Bin
    fireEvent.click(screen.getByTestId('copy-bin-r-copy'));
    await waitFor(() => expect(copyTextMock).toHaveBeenCalledWith('BIN77'));
    await waitFor(() => expect(screen.getByTestId('copy-bin-r-copy')).toHaveTextContent('✓'));
  });

  it('footer Bảng 1 có nút trượt xuống Bảng 2 gọi smooth scroll', () => {
    render(
      <ReconciliationTable rows={[row({ id: 'r1', batch_id: 'B1' })]} systemByBatch={new Map()} />,
    );
    const btn = screen.getByTestId('btn-goto-table2');
    expect(btn).toHaveTextContent('Bảng 2');
    fireEvent.click(btn);
    expect(smoothMock).toHaveBeenCalledWith('bang-2');
  });
});
