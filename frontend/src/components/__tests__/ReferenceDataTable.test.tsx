import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceDataTable from '../ReferenceDataTable';

const { select, order, limit, eq } = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select }) },
}));

const ROWS = [
  { stock_code: '3400010001', warehouse: '01', bin: 'C4', qty: 1000 },
  { stock_code: '3400010002', warehouse: '61', bin: 'C2', qty: 900 },
];

function thenable() {
  return { eq, then: (res: (v: unknown) => void) => Promise.resolve({ data: ROWS, error: null }).then(res) };
}

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ limit });
  limit.mockReturnValue(thenable());
  eq.mockImplementation(() => thenable());
});

describe('ReferenceDataTable', () => {
  it('chỉ select cột tra cứu (không lấy batch_id), render dòng', async () => {
    render(<ReferenceDataTable />);
    await waitFor(() => expect(select).toHaveBeenCalledWith('stock_code,warehouse,bin,qty'));
    expect(await screen.findByText('3400010001')).toBeInTheDocument();
    expect(screen.getByText('3400010002')).toBeInTheDocument();
  });

  it('lọc theo kho và vị trí', async () => {
    render(<ReferenceDataTable />);
    await screen.findByText('3400010001');
    fireEvent.change(screen.getByLabelText('Lọc theo kho'), { target: { value: '01' } });
    await waitFor(() => expect(eq).toHaveBeenCalledWith('warehouse', '01'));
    fireEvent.change(screen.getByLabelText('Lọc theo vị trí'), { target: { value: 'C4' } });
    await waitFor(() => expect(eq).toHaveBeenCalledWith('bin', 'C4'));
  });
});
