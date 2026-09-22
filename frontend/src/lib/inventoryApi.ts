// inventoryApi — helper gọi RPC kiểm kê (Bảng 3) dùng chung cho InventoryTable
// (bảng full cuối trang) và InventoryScanModal (bảng streaming trong modal).
// Gom 1 chỗ để không trùng logic xóa/sửa ở 2 component (debt 2026-09-22).
import { supabase } from './supabase';

export type InventoryResult = { ok: true } | { ok: false; message: string };

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

/** Sửa SL + Bin KK của 1 dòng kiểm kê (Tag/Mã hàng khóa) qua RPC. */
export async function updateInventoryRow(
  id: string,
  qty: number,
  bin: string,
  actorName?: string | null,
): Promise<InventoryResult> {
  try {
    const { data, error } = await supabase.rpc('update_inventory_row', {
      p_id: id,
      p_new_qty: qty,
      p_new_bin: bin,
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
