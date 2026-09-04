import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const { submitScan, resolveDuplicate } = vi.hoisted(() => ({
  submitScan: vi.fn(),
  resolveDuplicate: vi.fn(),
}));
vi.mock('../lib/scanApi', () => ({ submitScan, resolveDuplicate }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    }),
  },
}));
vi.mock('../hooks/useScannedData', () => ({ useScannedData: () => ({ rows: [], loading: false, error: null }) }));
vi.mock('../hooks/useReferenceMap', () => ({ useReferenceMap: () => ({ byBatch: new Map(), loading: false }) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('App P5 wiring', () => {
  it('trùng -> toast -> Ghi thêm gọi resolve append rồi đóng toast', async () => {
    const conflict = {
      existingId: 'e1',
      computedStatus: 'ok' as const,
      attempted: { batchId: 'T1', qty: 1, bin: 'C4' },
    };
    submitScan.mockResolvedValue({ kind: 'duplicate', conflict });
    resolveDuplicate.mockResolvedValue({ kind: 'resolved', result: { id: 'n1', status: 'duplicate', resolution: 'appended' } });
    render(<App />);

    const input = screen.getByPlaceholderText('READY TO SCAN...');
    fireEvent.change(input, { target: { value: 'C4' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await screen.findByText('C4');
    fireEvent.change(input, { target: { value: 'T1' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByRole('alertdialog', { name: 'Trùng Tag ID' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi thêm' }));
    await waitFor(() =>
      expect(resolveDuplicate).toHaveBeenCalledWith({
        action: 'append',
        scannedId: 'e1',
        batchId: 'T1',
        qty: 1,
        bin: 'C4',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: 'Trùng Tag ID' })).not.toBeInTheDocument(),
    );
  });
});
