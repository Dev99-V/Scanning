import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ManualEntryForm from '../ManualEntryForm';

const { submitScan } = vi.hoisted(() => ({ submitScan: vi.fn() }));
vi.mock('../../lib/scanApi', () => ({ submitScan }));

beforeEach(() => submitScan.mockReset());

describe('ManualEntryForm', () => {
  it('ghi nhận với isManual=true', async () => {
    const onScanned = vi.fn();
    submitScan.mockResolvedValue({ kind: 'scanned', result: { id: 'm1', status: 'not_in_reference' } });
    render(<ManualEntryForm onScanned={onScanned} onDuplicate={() => {}} />);
    fireEvent.change(screen.getByLabelText('Tag ID'), { target: { value: 'MAN1' } });
    fireEvent.change(screen.getByLabelText('Vị trí'), { target: { value: 'B2' } });
    fireEvent.click(screen.getByRole('button', { name: /ghi nhận/i }));
    await waitFor(() =>
      expect(submitScan).toHaveBeenCalledWith({ batchId: 'MAN1', qty: 1, bin: 'B2', isManual: true }),
    );
    expect(onScanned).toHaveBeenCalledWith({ id: 'm1', status: 'not_in_reference' });
  });

  it('thiếu Tag/Bin thì cảnh báo, không gọi API', async () => {
    render(<ManualEntryForm onScanned={() => {}} onDuplicate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /ghi nhận/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/nhập đủ/i);
    expect(submitScan).not.toHaveBeenCalled();
  });
});
