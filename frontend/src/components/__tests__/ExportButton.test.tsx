import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ExportButton from '../ExportButton';

const { downloadReconExcel } = vi.hoisted(() => ({ downloadReconExcel: vi.fn() }));
vi.mock('../../lib/exportExcel', () => ({ downloadReconExcel }));

describe('ExportButton', () => {
  it('click xuất đúng rows + system map', () => {
    const rows = [{ id: 'r1', batch_id: 'B1' }];
    const sys = new Map([['B1', { qty: 1, bin: 'A' }]]);
    render(<ExportButton rows={rows as never} systemByBatch={sys} />);
    fireEvent.click(screen.getByRole('button', { name: /export xls/i }));
    expect(downloadReconExcel).toHaveBeenCalledWith(rows, sys);
  });

  it('disable khi chưa có dòng quét', () => {
    render(<ExportButton rows={[]} systemByBatch={new Map()} />);
    expect(screen.getByRole('button', { name: /export xls/i })).toBeDisabled();
  });
});
