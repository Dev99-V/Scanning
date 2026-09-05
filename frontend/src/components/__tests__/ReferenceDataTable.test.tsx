import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceDataTable from '../ReferenceDataTable';

const { select, order, range, eq } = vi.hoisted(() => ({
  select: vi.fn(),
  order: vi.fn(),
  range: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select }) },
}));

const ROWS = [
  { batch_id: 'TAG001', stock_code: '3400010001', warehouse: '01', bin: 'C4', qty: 1000, create_date: '2026-09-04' },
  { batch_id: 'TAG002', stock_code: '3400010002', warehouse: '61', bin: 'C2', qty: 900, create_date: '2026-09-04' },
];

function thenable() {
  return {
    eq,
    range,
    then: (res: (v: unknown) => void) => Promise.resolve({ data: ROWS, error: null }).then(res),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ order });
  order.mockReturnValue({ range, eq });
  range.mockReturnValue(Promise.resolve({ data: ROWS, error: null }));
  eq.mockImplementation(() => ({ range, eq, thenable: thenable() }));
});

describe('ReferenceDataTable', () => {
  it('select đầy đủ cột nguồn bao gồm batch_id, render các dòng', async () => {
    render(<ReferenceDataTable />);
    await waitFor(() =>
      expect(select).toHaveBeenCalledWith('batch_id,stock_code,warehouse,bin,qty,create_date')
    );
    expect(await screen.findByText('3400010001')).toBeInTheDocument();
    expect(screen.getByText('TAG001')).toBeInTheDocument();
    expect(screen.getByText('3400010002')).toBeInTheDocument();
    expect(screen.getByText('TAG002')).toBeInTheDocument();
  });

  it('lọc thông minh với tiền tố WH cho kho và tìm kiếm thông thường', async () => {
    render(<ReferenceDataTable />);
    await screen.findByText('3400010001');

    // Lọc thông minh theo Kho với tiền tố WH
    const smartInput = screen.getByLabelText('Tìm kiếm thông minh');
    fireEvent.change(smartInput, { target: { value: 'WH01' } });
    expect(screen.getByText('3400010001')).toBeInTheDocument();
    expect(screen.queryByText('3400010002')).not.toBeInTheDocument();

    // Lọc thông thường theo Tag ID
    fireEvent.change(smartInput, { target: { value: 'TAG002' } });
    expect(screen.getByText('3400010002')).toBeInTheDocument();
    expect(screen.queryByText('3400010001')).not.toBeInTheDocument();
  });
});
