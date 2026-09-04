import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PdaScanPanel from '../PdaScanPanel';

const { submitScan } = vi.hoisted(() => ({ submitScan: vi.fn() }));
vi.mock('../../lib/scanApi', () => ({ submitScan }));

beforeEach(() => submitScan.mockReset());

function scanInput() {
  return screen.getByPlaceholderText('READY TO SCAN...') as HTMLInputElement;
}

async function scanBin(bin: string) {
  fireEvent.change(scanInput(), { target: { value: bin } });
  fireEvent.keyDown(scanInput(), { key: 'Enter', code: 'Enter' });
  await screen.findByText(bin);
}

describe('PdaScanPanel', () => {
  it('quét Bin xong tự chuyển sang mode Tag', async () => {
    render(<PdaScanPanel onScanned={() => {}} onDuplicate={() => {}} />);
    expect(screen.getByTestId('active-bin')).toHaveTextContent('WAITING...');
    await scanBin('C4');
    expect(screen.getByTestId('active-bin')).toHaveTextContent('C4');
    expect(screen.getByText('Scanning: TAG ID')).toBeInTheDocument();
  });

  it('chặn quét Tag khi chưa có Bin (guard WAITING), không gọi API', async () => {
    render(<PdaScanPanel onScanned={() => {}} onDuplicate={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /tag id/i }));
    fireEvent.change(scanInput(), { target: { value: 'TAG1' } });
    fireEvent.keyDown(scanInput(), { key: 'Enter', code: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/quét vị trí trước/i);
    expect(submitScan).not.toHaveBeenCalled();
  });

  it('quét Tag gọi API thật với bin hiện tại, qty mặc định 1', async () => {
    const onScanned = vi.fn();
    submitScan.mockResolvedValue({ kind: 'scanned', result: { id: 'id1', status: 'ok' } });
    render(<PdaScanPanel onScanned={onScanned} onDuplicate={() => {}} />);
    await scanBin('C4');
    fireEvent.change(scanInput(), { target: { value: 'TAG1' } });
    fireEvent.keyDown(scanInput(), { key: 'Enter', code: 'Enter' });
    await waitFor(() =>
      expect(submitScan).toHaveBeenCalledWith({ batchId: 'TAG1', qty: 1, bin: 'C4', isManual: false }),
    );
    expect(onScanned).toHaveBeenCalledWith({ id: 'id1', status: 'ok' });
  });

  it('conflict duplicate đi vào onDuplicate, không vào onScanned', async () => {
    const onScanned = vi.fn();
    const onDuplicate = vi.fn();
    const conflict = { existingId: 'e1', computedStatus: 'ok' as const, attempted: { batchId: 'T', qty: 1, bin: 'C4' } };
    submitScan.mockResolvedValue({ kind: 'duplicate', conflict });
    render(<PdaScanPanel onScanned={onScanned} onDuplicate={onDuplicate} />);
    await scanBin('C4');
    fireEvent.change(scanInput(), { target: { value: 'T' } });
    fireEvent.keyDown(scanInput(), { key: 'Enter', code: 'Enter' });
    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith(conflict));
    expect(onScanned).not.toHaveBeenCalled();
  });

  it('RESET BIN về WAITING + mode location', async () => {
    render(<PdaScanPanel onScanned={() => {}} onDuplicate={() => {}} />);
    await scanBin('C4');
    fireEvent.click(screen.getByRole('button', { name: /reset bin/i }));
    expect(screen.getByTestId('active-bin')).toHaveTextContent('WAITING...');
    expect(screen.getByText('Scanning: LOCATION')).toBeInTheDocument();
  });
});
