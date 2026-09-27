import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteInventoryRow, updateInventoryRow } from './inventoryApi';

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('./supabase', () => ({
  supabase: { rpc: mockRpc },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inventoryApi', () => {
  it('deleteInventoryRow ok → { ok:true }', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(deleteInventoryRow('id1', 'Anh A')).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('delete_inventory_row', { p_id: 'id1', p_actor_name: 'Anh A' });
  });

  it('deleteInventoryRow lỗi RPC → { ok:false, message }', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: 'not_found' }, error: null });
    const res = await deleteInventoryRow('id1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('not_found');
    // Không có actorName thì không gửi p_actor_name
    expect(mockRpc).toHaveBeenCalledWith('delete_inventory_row', { p_id: 'id1' });
  });

  it('updateInventoryRow ok → { ok:true } + đủ params', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(updateInventoryRow('id2', 7, 'BIN_X')).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('update_inventory_row', {
      p_id: 'id2',
      p_new_qty: 7,
      p_new_bin: 'BIN_X',
    });
  });

  it('updateInventoryRow throw → { ok:false }', async () => {
    mockRpc.mockRejectedValue(new Error('mất mạng'));
    const res = await updateInventoryRow('id2', 7, 'BIN_X');
    expect(res).toEqual({ ok: false, message: 'mất mạng' });
  });

  it('updateInventoryRow đổi TAG → gửi p_new_batch_id', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(updateInventoryRow('id3', 5, 'BIN_Y', 'Anh A', 'TAG_NEW')).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('update_inventory_row', {
      p_id: 'id3',
      p_new_qty: 5,
      p_new_bin: 'BIN_Y',
      p_actor_name: 'Anh A',
      p_new_batch_id: 'TAG_NEW',
    });
  });

  it('updateInventoryRow không đổi TAG → không gửi p_new_batch_id (tương thích ngược)', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    await updateInventoryRow('id3', 5, 'BIN_Y');
    expect(mockRpc).toHaveBeenCalledWith('update_inventory_row', {
      p_id: 'id3',
      p_new_qty: 5,
      p_new_bin: 'BIN_Y',
    });
  });

  it('updateInventoryRow lỗi duplicate/not_in_reference → { ok:false, code } để UI rẽ nhánh', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: 'duplicate_batch_id' }, error: null });
    const dup = await updateInventoryRow('id3', 5, 'BIN_Y', null, 'TAG_DUP');
    expect(dup).toEqual({ ok: false, message: 'duplicate_batch_id', code: 'duplicate_batch_id' });

    mockRpc.mockResolvedValue({ data: { ok: false, error: 'not_in_reference' }, error: null });
    const out = await updateInventoryRow('id3', 5, 'BIN_Y', null, 'TAG_LA');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('not_in_reference');
  });
});
