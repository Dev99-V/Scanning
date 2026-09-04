import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDuplicate, submitScan } from './scanApi';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke } } }));

function httpError(body: unknown) {
  return { message: 'Error', context: { json: async () => body } };
}

beforeEach(() => invoke.mockReset());

describe('submitScan', () => {
  it('trả scanned khi ok', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { id: 'abc', status: 'ok' } }, error: null });
    const r = await submitScan({ batchId: 'B1', qty: 2, bin: 'C4', isManual: false });
    expect(invoke).toHaveBeenCalledWith('scan-submit', {
      body: { batch_id: 'B1', qty: 2, bin: 'C4', is_manual: false },
    });
    expect(r).toEqual({ kind: 'scanned', result: { id: 'abc', status: 'ok' } });
  });

  it('trả duplicate kèm attempted khi conflict 409', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError({
        ok: false,
        error: { code: 'duplicate', message: 'đã quét' },
        data: { existing_id: 'e1', computed_status: 'bin_mismatch' },
      }),
    });
    const r = await submitScan({ batchId: 'B1', qty: 2, bin: 'C4', isManual: true });
    expect(r).toEqual({
      kind: 'duplicate',
      conflict: {
        existingId: 'e1',
        computedStatus: 'bin_mismatch',
        attempted: { batchId: 'B1', qty: 2, bin: 'C4' },
      },
    });
  });

  it('trả error theo error.code, không parse message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError({ ok: false, error: { code: 'invalid_input', message: 'x' } }),
    });
    const r = await submitScan({ batchId: '', qty: NaN, bin: '', isManual: false });
    expect(r).toEqual({ kind: 'error', code: 'invalid_input', message: 'x' });
  });

  it('network_error khi không đọc được body lỗi', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const r = await submitScan({ batchId: 'B1', qty: 1, bin: 'A', isManual: false });
    expect(r).toEqual({ kind: 'error', code: 'network_error', message: 'Request failed' });
  });
});

describe('resolveDuplicate', () => {
  it('trả resolved khi ok', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, data: { id: 'n1', status: 'duplicate', resolution: 'appended' } },
      error: null,
    });
    const r = await resolveDuplicate({ action: 'append', scannedId: 's1', batchId: 'B1', qty: 1, bin: 'A' });
    expect(invoke).toHaveBeenCalledWith('resolve-duplicate', {
      body: { action: 'append', scanned_id: 's1', batch_id: 'B1', qty: 1, bin: 'A' },
    });
    expect(r).toEqual({
      kind: 'resolved',
      result: { id: 'n1', status: 'duplicate', resolution: 'appended' },
    });
  });

  it('trả error not_found', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: httpError({ ok: false, error: { code: 'not_found', message: 'không tồn tại' } }),
    });
    const r = await resolveDuplicate({ action: 'relocate', scannedId: 's9', batchId: 'B1', qty: 1, bin: 'A' });
    expect(r).toEqual({ kind: 'error', code: 'not_found', message: 'không tồn tại' });
  });
});
