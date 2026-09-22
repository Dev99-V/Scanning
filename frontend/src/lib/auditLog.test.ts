import { describe, expect, it } from 'vitest';
import { actorDisplayName, describeAuditEntry } from './auditLog';

describe('describeAuditEntry', () => {
  it('quét PDA: nhãn + Tag + SL/Bin/trạng thái', () => {
    const d = describeAuditEntry({
      action: 'insert',
      old_value: null,
      new_value: { batch_id: 'T1', qty: 5, bin: 'C4', status: 'ok' },
    });
    expect(d.actionLabel).toBe('Quét PDA');
    expect(d.tagId).toBe('T1');
    expect(d.detail).toContain('SL 5');
    expect(d.detail).toContain('C4');
  });

  it('thêm mã nguồn và ghi đè mã nguồn', () => {
    const add = describeAuditEntry({
      action: 'insert',
      old_value: null,
      new_value: { kind: 'reference_add', batch_id: 'T2', stock_code: 'S', warehouse: '01', bin: 'B', qty: 7, overwrote: false },
    });
    expect(add.actionLabel).toBe('Thêm mã nguồn');
    const over = describeAuditEntry({
      action: 'insert',
      old_value: null,
      new_value: { kind: 'reference_add', batch_id: 'T2', overwrote: true },
    });
    expect(over.actionLabel).toBe('Ghi đè mã nguồn');
  });

  it('import file nguồn: Tag gạch ngang + tóm tắt số dòng', () => {
    const d = describeAuditEntry({
      action: 'insert',
      old_value: null,
      new_value: { kind: 'import', file_name: 'Stock.xlsx', total_rows_in_file: 100, upserted: 90, skipped: 10 },
    });
    expect(d.actionLabel).toBe('Import file nguồn');
    expect(d.tagId).toBe('—');
    expect(d.detail).toContain('90');
  });

  it('sửa SL nguồn và xóa lượt quét', () => {
    const edit = describeAuditEntry({
      action: 'edit',
      old_value: { batch_id: 'T3', kind: 'reference_qty', qty: 5 },
      new_value: { batch_id: 'T3', kind: 'reference_qty', qty: 8 },
    });
    expect(edit.actionLabel).toBe('Sửa SL/Bin nguồn');
    expect(edit.detail).toContain('5 → 8');
    const del = describeAuditEntry({
      action: 'delete',
      old_value: { batch_id: 'T4', qty: 2, bin: 'B', status: 'ok' },
      new_value: null,
    });
    expect(del.actionLabel).toBe('Xóa lượt quét');
    expect(del.tagId).toBe('T4');
  });

  it('tên người làm: có tên hiện tên, null hiện Ẩn danh', () => {
    expect(actorDisplayName({ actor_name: 'Anh A' })).toBe('Anh A');
    expect(actorDisplayName({ actor_name: null })).toBe('Ẩn danh');
    expect(actorDisplayName({ actor_name: '  ' })).toBe('Ẩn danh');
  });

  it('nhật ký kiểm kê: thêm / sửa SL / xóa (kind đọc cả old_value)', () => {
    const add = describeAuditEntry({
      action: 'insert',
      old_value: null,
      new_value: { kind: 'inventory_add', batch_id: 'K1', stock_code: 'S', bin: 'B', qty: 4 },
    });
    expect(add.actionLabel).toBe('Thêm kiểm kê');
    expect(add.tagId).toBe('K1');
    expect(add.detail).toContain('SL 4');
    const edit = describeAuditEntry({
      action: 'edit',
      old_value: { kind: 'inventory_update', batch_id: 'K1', qty: 4, bin: 'B1' },
      new_value: { kind: 'inventory_update', batch_id: 'K1', qty: 9, bin: 'B2' },
    });
    expect(edit.actionLabel).toBe('Sửa kiểm kê');
    expect(edit.detail).toContain('4 → 9');
    expect(edit.detail).toContain('B1 → B2');
    const del = describeAuditEntry({
      action: 'delete',
      old_value: { kind: 'inventory_delete', batch_id: 'K1', qty: 9, bin: 'B' },
      new_value: null,
    });
    expect(del.actionLabel).toBe('Xóa kiểm kê');
    expect(del.tagId).toBe('K1');
  });
});
