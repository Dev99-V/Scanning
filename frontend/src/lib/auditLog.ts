// auditLog — kiểu + mô tả tiếng Việt cho 1 dòng scan_audit_log.
// Dùng chung cho thẻ Nhật ký hoạt động (Bảng 2) và export Excel.
// Quy ước new_value/old_value do các RPC ghi (xem migration 20260909091000):
//   - quét PDA:        action 'insert', new {batch_id, qty, bin, status, stock_code}
//   - thêm mã nguồn:   action 'insert', new {kind:'reference_add', batch_id, stock_code,
//                      warehouse, bin, qty, overwrote}
//   - import file:     action 'insert', new {kind:'import', file_name,
//                      total_rows_in_file, upserted, skipped}
//   - ghi thêm trùng:  action 'append',  new {batch_id, qty, bin, ...}
//   - đổi vị trí:      action 'relocate', old/new {bin, qty, status, ...}
//   - sửa lượt quét:   action 'edit',    old/new {batch_id, stock_code, status, qty, bin}
//   - sửa SL/Bin nguồn:action 'edit',    old/new {batch_id, kind:'reference_qty'|'reference_bin', qty|bin}
//   - xóa lượt quét:   action 'delete',  old {batch_id, stock_code, qty, bin, status}
//   - thêm kiểm kê:    action 'insert',  new {kind:'inventory_add', batch_id, stock_code, qty, bin}
//   - sửa kiểm kê:      action 'edit',    old/new {kind:'inventory_update', batch_id, qty, bin}
//   - xóa kiểm kê:     action 'delete',  old {kind:'inventory_delete', batch_id, stock_code, qty, bin}

export interface AuditEntry {
  id: number;
  scanned_id: string | null;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  actor: string | null;
  actor_name: string | null;
  created_at: string;
}

export interface AuditDescription {
  /** Nhãn hành động, vd "Quét PDA", "Thêm mã nguồn", "Import file nguồn". */
  actionLabel: string;
  /** Tag ID liên quan (hoặc '—' với import file). */
  tagId: string;
  /** Chi tiết 1 dòng, vd "SL 5 • Bin C4 • Khớp". */
  detail: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Chờ',
  ok: 'Khớp',
  qty_mismatch: 'Lệch SL',
  bin_mismatch: 'Lệch Bin',
  not_in_reference: 'Ngoài nguồn',
  duplicate: 'Trùng Tag',
};

function str(v: unknown, fallback = '—'): string {
  if (v === null || v === undefined || v === '') return fallback;
  return String(v);
}

function statusLabel(v: unknown): string {
  return STATUS_LABEL[String(v ?? '')] ?? str(v);
}

/** Tên người thực hiện — hệ thống không đăng nhập nên uuid luôn null, dùng tên presence. */
export function actorDisplayName(entry: Pick<AuditEntry, 'actor_name'>): string {
  const n = (entry.actor_name || '').trim();
  return n ? n : 'Ẩn danh';
}

export function describeAuditEntry(entry: Pick<AuditEntry, 'action' | 'old_value' | 'new_value'>): AuditDescription {
  const action = entry.action || '';
  const nv = entry.new_value ?? {};
  const ov = entry.old_value ?? {};
  // kind có thể nằm ở new_value (insert/edit) hoặc old_value (delete).
  const kind =
    typeof nv.kind === 'string'
      ? nv.kind
      : typeof ov.kind === 'string'
        ? ov.kind
        : '';

  if (action === 'insert' && kind === 'import') {
    return {
      actionLabel: 'Import file nguồn',
      tagId: '—',
      detail: `File ${str(nv.file_name, 'Excel')}: ${Number(nv.upserted ?? 0).toLocaleString()} dòng (từ ${Number(nv.total_rows_in_file ?? 0).toLocaleString()} dòng, bỏ qua ${Number(nv.skipped ?? 0)})`,
    };
  }

  if (action === 'insert' && kind === 'reference_add') {
    return {
      actionLabel: nv.overwrote === true ? 'Ghi đè mã nguồn' : 'Thêm mã nguồn',
      tagId: str(nv.batch_id),
      detail: `Mã ${str(nv.stock_code)} • Kho ${str(nv.warehouse)} • Bin ${str(nv.bin)} • SL ${str(nv.qty)}`,
    };
  }

  if (action === 'insert' && kind === 'inventory_add') {
    return {
      actionLabel: 'Thêm kiểm kê',
      tagId: str(nv.batch_id),
      detail: `Mã ${str(nv.stock_code)} • Bin ${str(nv.bin)} • SL ${str(nv.qty)}`,
    };
  }

  if (action === 'insert') {
    return {
      actionLabel: 'Quét PDA',
      tagId: str(nv.batch_id),
      detail: `SL ${str(nv.qty)} • Bin ${str(nv.bin)} • ${statusLabel(nv.status)}`,
    };
  }

  if (action === 'append') {
    return {
      actionLabel: 'Ghi thêm (trùng Tag)',
      tagId: str(nv.batch_id),
      detail: `SL ${str(nv.qty)} • Bin ${str(nv.bin)}`,
    };
  }

  if (action === 'relocate') {
    return {
      actionLabel: 'Đổi vị trí (trùng Tag)',
      tagId: str(nv.batch_id ?? ov.batch_id),
      detail: `Bin ${str(ov.bin)} → ${str(nv.bin)} • SL ${str(nv.qty)} • ${statusLabel(nv.status)}`,
    };
  }

  if (action === 'edit' && (kind === 'reference_qty' || kind === 'reference_bin')) {
    const field = kind === 'reference_qty' ? 'SL nguồn' : 'Bin nguồn';
    return {
      actionLabel: 'Sửa SL/Bin nguồn',
      tagId: str(nv.batch_id ?? ov.batch_id),
      detail: `${field} ${str(kind === 'reference_qty' ? ov.qty : ov.bin)} → ${str(kind === 'reference_qty' ? nv.qty : nv.bin)}`,
    };
  }

  if (action === 'edit' && kind === 'inventory_update') {
    const parts = [`SL ${str(ov.qty)} → ${str(nv.qty)}`];
    if (str(ov.bin) !== str(nv.bin)) parts.push(`Bin ${str(ov.bin)} → ${str(nv.bin)}`);
    return {
      actionLabel: 'Sửa kiểm kê',
      tagId: str(nv.batch_id ?? ov.batch_id),
      detail: parts.join(' • '),
    };
  }

  if (action === 'edit') {
    const tagChanged = str(nv.batch_id) !== str(ov.batch_id);
    return {
      actionLabel: 'Sửa lượt quét',
      tagId: str(nv.batch_id ?? ov.batch_id),
      detail: tagChanged
        ? `Tag ${str(ov.batch_id)} → ${str(nv.batch_id)} • SL ${str(nv.qty)}`
        : `SL ${str(ov.qty)} → ${str(nv.qty)} • ${statusLabel(nv.status)}`,
    };
  }

  if (action === 'delete' && kind === 'inventory_delete') {
    return {
      actionLabel: 'Xóa kiểm kê',
      tagId: str(ov.batch_id),
      detail: `SL ${str(ov.qty)} • Bin ${str(ov.bin)}`,
    };
  }

  if (action === 'delete') {
    return {
      actionLabel: 'Xóa lượt quét',
      tagId: str(ov.batch_id),
      detail: `SL ${str(ov.qty)} • Bin ${str(ov.bin)} • ${statusLabel(ov.status)}`,
    };
  }

  return {
    actionLabel: action || 'Khác',
    tagId: str(nv.batch_id ?? ov.batch_id),
    detail: '',
  };
}
