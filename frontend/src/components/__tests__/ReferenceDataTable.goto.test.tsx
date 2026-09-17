import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceDataTable from '../ReferenceDataTable';

const { smoothMock } = vi.hoisted(() => ({ smoothMock: vi.fn() }));
vi.mock('../../lib/smoothScroll', () => ({ smoothScrollToElementById: smoothMock }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => ({
            range: async () => ({
              data: [
                {
                  batch_id: 'TAG_GOTO_01',
                  stock_code: 'SKU_GOTO',
                  warehouse: 'WH01',
                  bin: 'BIN01',
                  qty: 5,
                  create_date: null,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: async () => {},
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ReferenceDataTable — lối tắt về Bảng 1', () => {
  it('footer Bảng 2 có nút ⬆ Bảng 1 gọi smooth scroll', async () => {
    render(<ReferenceDataTable scannedRows={[]} />);
    const btn = await screen.findByTestId('btn-goto-table1');
    expect(btn).toHaveTextContent('Bảng 1');
    fireEvent.click(btn);
    expect(smoothMock).toHaveBeenCalledWith('bang-1');
  });
});
