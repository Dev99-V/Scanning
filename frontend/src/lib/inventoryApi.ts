// inventoryApi — helper gọi RPC kiểm kê (Bảng 3) dùng chung cho InventoryTable
// (bảng full cuối trang) và InventoryScanModal (bảng streaming trong modal).
// Gom 1 chỗ để không trùng logic xóa/sửa ở 2 component (debt 2026-09-22).
import { supabase } from './supabase';

export type InventoryResult = { ok: true } | { ok: false; message: string; code?: string };

function errCode(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const e = (data as { error: unknown }).error;
    return typeof e === 'string' ? e : undefined;
  }
  return undefined;
}

function errMessage(err: unknown, data: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  if (typeof data === 'object' && data !== null && 'error' in data) {
    return String((data as { error: unknown }).error);
  }
  return 'Không xác định';
}

/** Xóa 1 dòng kiểm kê nhập nhầm qua RPC SECURITY DEFINER (phiên anon). */
export async function deleteInventoryRow(id: string, actorName?: string | null): Promise<InventoryResult> {
  try {
    const { data, error } = await supabase.rpc('delete_inventory_row', {
      p_id: id,
      ...(actorName ? { p_actor_name: actorName } : {}),
    });
    if (error || (data as { ok?: unknown } | null)?.ok !== true) {
      return { ok: false, message: errMessage(error, data) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Sửa 1 dòng kiểm kê qua RPC update_inventory_row.
 * - qty/bin: SL + Bin KK (bắt buộc ở tầng UI, RPC NULL = giữ cũ).
 * - newBatchId: TAG ID mới (optional — undefined/null = giữ TAG cũ).
 *   TAG mới phải có trong nguồn (Bảng 2) và chưa trùng dòng kiểm kê khác,
 *   nếu không RPC trả error.code not_in_reference / duplicate_batch_id
 *   (đúng Skills C: frontend rẽ nhánh theo error.code, không parse message).
 */
export async function updateInventoryRow(
  id: string,
  qty: number,
  bin: string,
  actorName?: string | null,
  newBatchId?: string | null,
): Promise<InventoryResult> {
  try {
    const { data, error } = await supabase.rpc('update_inventory_row', {
      p_id: id,
      p_new_qty: qty,
      p_new_bin: bin,
      ...(actorName ? { p_actor_name: actorName } : {}),
      ...(newBatchId != null && newBatchId !== '' ? { p_new_batch_id: newBatchId } : {}),
    });
    if (error || (data as { ok?: unknown } | null)?.ok !== true) {
      return { ok: false, message: errMessage(error, data), code: errCode(data) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
