// ReferenceDataTable — Bảng 2: dữ liệu hệ thống đã import (Plan.md §7.3).
// Hiển thị đầy đủ tất cả các trường dữ liệu như trong file nguồn (Stock Code, Batch, Warehouse, Bin, Qty, Ngày tạo).
// Lấy toàn bộ dữ liệu từ Supabase qua phân trang range (không bị chặn ở mốc 1000 dòng).
// Bộ lọc thông minh: tự động dò tìm mọi trường, riêng Kho cần thêm tiền tố 'WH' (vd WH01, WH50).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { UsePresenceApi } from '../hooks/usePresence';
import { table2RowKey } from '../hooks/presenceHelpers';
import { resilientSubscribe } from '../lib/realtime';
import { smoothScrollToElementById } from '../lib/smoothScroll';
import { resolveDuplicate, submitScan } from '../lib/scanApi';
import { supabase } from '../lib/supabase';
import type { ScanRow } from '../lib/types';
import ActivityLogCard from './ActivityLogCard';
import ReferenceAddCard from './ReferenceAddCard';
import ReferenceImportCard from './ReferenceImportCard';
import Reference7055Card from './Reference7055Card';
import { isRecentCreateDate } from '../lib/recentCreate';

export interface ReferenceLine {
  batch_id: string;
  stock_code: string;
  warehouse: string;
  bin: string;
  previous_bin?: string | null;
  qty: number;
  previous_qty?: number | null;
  create_date?: string | null;
  tag_7055?: boolean;
}

interface ReferenceDataTableProps {
  scannedRows?: ScanRow[];
  onQtyUpdated?: (batchId: string, newQty: number) => void;
  onBinUpdated?: (batchId: string, newBin: string) => void;
  onReferenceAdded?: (newRow: ReferenceLine) => void;
  onReferenceDeleted?: (batchId: string) => void;
  /** Gọi sau khi nhập kho nhanh thành công để Bảng 1 refetch tức thì (realtime vẫn tự cập nhật). */
  onQuickImported?: () => void;
  /**
   * Gọi sau khi import file nguồn thành công. BẮT BUỘC cho App refetch useReferenceMap:
   * import xóa-nạp lại toàn bảng (DELETE mass + upsert ~nghìn dòng) nên map tra cứu
   * Bảng 1/Bảng 3 KHÔNG thể chỉ trông chờ realtime từng dòng (dễ miss/throttle) —
   * không refetch là đối chiếu sau import lệch im tới khi F5.
   */
  onReferenceImported?: () => void;
  /** Presence realtime (khóa mềm theo dòng). Không bắt buộc để test cũ vẫn chạy. */
  presence?: UsePresenceApi | null;
  /** Dải avatar streaming do App truyền xuống (đã lọc theo Bảng 2). */
  presenceHeader?: React.ReactNode;
  /** Tên hiển thị để ghi nhật ký hoạt động — optional để test cũ vẫn chạy. */
  actorName?: string | null;
}

export default function ReferenceDataTable({
  scannedRows = [],
  onQtyUpdated,
  onBinUpdated,
  onReferenceAdded,
  onReferenceDeleted,
  onQuickImported,
  onReferenceImported,
  presence,
  presenceHeader,
  actorName,
}: ReferenceDataTableProps = {}) {
  const [rows, setRows] = useState<ReferenceLine[]>([]);
  const [smartFilter, setSmartFilter] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [bin, setBin] = useState('');
  const [matchedOnlyFilter, setMatchedOnlyFilter] = useState(false);
  const [excessOnlyFilter, setExcessOnlyFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(100);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Bản đồ các lượt quét theo batch_id để kiểm tra trạng thái khớp với Bảng 1
  const scannedByBatch = useMemo(() => {
    const map = new Map<string, ScanRow[]>();
    if (!scannedRows) return map;
    for (const s of scannedRows) {
      if (!s.batch_id) continue;
      const cleanBatch = s.batch_id.trim();
      const list = map.get(cleanBatch) || [];
      list.push(s);
      map.set(cleanBatch, list);
    }
    return map;
  }, [scannedRows]);

  // Kiểm tra xem 1 dòng nguồn có bị quét trùng (>= 2 lượt quét hoặc status duplicate) hay không
  const isRowDuplicateScanned = React.useCallback(
    (r: ReferenceLine): boolean => {
      const cleanBatch = (r.batch_id || '').trim();
      const scans = scannedByBatch.get(cleanBatch);
      if (!scans || scans.length === 0) return false;
      return scans.length > 1 || scans.some((s) => s.status === 'duplicate');
    },
    [scannedByBatch],
  );

  // Kiểm tra xem 1 dòng nguồn có khớp hoàn toàn với dữ liệu quét ở Bảng 1 hay không
  // BẮT BUỘC: Nếu tag bị quét trùng (>= 2 lần hoặc status duplicate) thì KHÔNG THỂ coi là đã khớp!
  const isRowMatched = React.useCallback(
    (r: ReferenceLine): boolean => {
      if (isRowDuplicateScanned(r)) return false;
      const cleanBatch = (r.batch_id || '').trim();
      const scans = scannedByBatch.get(cleanBatch);
      if (!scans || scans.length !== 1) return false;
      const s = scans[0];
      if (s.status === 'duplicate') return false;
      const cleanRefBin = (r.bin || '').trim().toLowerCase();
      return (
        s.status === 'ok' ||
        ((s.bin || '').trim().toLowerCase() === cleanRefBin && Number(s.qty) === Number(r.qty))
      );
    },
    [scannedByBatch, isRowDuplicateScanned],
  );

  // Kiểm tra xem 1 dòng nguồn có lượt quét ở Bảng 1 nhưng chưa khớp vị trí (bin) hay không
  const isRowBinMismatch = React.useCallback(
    (r: ReferenceLine): boolean => {
      if (isRowMatched(r) || isRowDuplicateScanned(r)) return false;
      const cleanBatch = (r.batch_id || '').trim();
      const scans = scannedByBatch.get(cleanBatch);
      if (!scans || scans.length === 0) return false;
      const cleanRefBin = (r.bin || '').trim().toLowerCase();
      return scans.some(
        (s) => s.status === 'bin_mismatch' || (s.bin || '').trim().toLowerCase() !== cleanRefBin,
      );
    },
    [scannedByBatch, isRowMatched, isRowDuplicateScanned],
  );

  // Kiểm tra xem 1 dòng nguồn có lượt quét ở Bảng 1 nhưng chưa khớp số lượng hay không
  const isRowQtyMismatch = React.useCallback(
    (r: ReferenceLine): boolean => {
      if (isRowMatched(r) || isRowDuplicateScanned(r)) return false;
      const cleanBatch = (r.batch_id || '').trim();
      const scans = scannedByBatch.get(cleanBatch);
      if (!scans || scans.length === 0) return false;
      return scans.some(
        (s) => s.status === 'qty_mismatch' || Number(s.qty) !== Number(r.qty),
      );
    },
    [scannedByBatch, isRowMatched, isRowDuplicateScanned],
  );

  // Đếm tổng số dòng nguồn đã khớp với Bảng 1
  const matchedCount = useMemo(() => {
    let count = 0;
    for (const r of rows) {
      if (isRowMatched(r)) count++;
    }
    return count;
  }, [rows, isRowMatched]);

  // Đếm tổng số dòng nguồn bị quét trùng
  const duplicateCount = useMemo(() => {
    let count = 0;
    for (const r of rows) {
      if (isRowDuplicateScanned(r)) count++;
    }
    return count;
  }, [rows, isRowDuplicateScanned]);

  // Đếm số dòng chưa khớp vị trí (bin)
  const binMismatchCount = useMemo(() => {
    let count = 0;
    for (const r of rows) {
      if (isRowBinMismatch(r)) count++;
    }
    return count;
  }, [rows, isRowBinMismatch]);

  // Đếm số dòng chưa khớp số lượng
  const qtyMismatchCount = useMemo(() => {
    let count = 0;
    for (const r of rows) {
      if (isRowQtyMismatch(r)) count++;
    }
    return count;
  }, [rows, isRowQtyMismatch]);

  // Kiểm tra dòng không được highlight (dữ liệu dư so với thực tế: không khớp, không lệch bin, không lệch sl, không trùng quét)
  const isRowUnhighlighted = React.useCallback(
    (r: ReferenceLine): boolean => {
      return !isRowMatched(r) && !isRowBinMismatch(r) && !isRowQtyMismatch(r) && !isRowDuplicateScanned(r);
    },
    [isRowMatched, isRowBinMismatch, isRowQtyMismatch, isRowDuplicateScanned],
  );

  // Đếm số dòng dữ liệu dư (không được highlight)
  const excessCount = useMemo(() => {
    let count = 0;
    for (const r of rows) {
      if (isRowUnhighlighted(r)) count++;
    }
    return count;
  }, [rows, isRowUnhighlighted]);

  // Đếm số dòng có ngày tạo mới cần chú ý (create_date >= 28/08/2026).
  // Đếm độc lập với highlight nền dòng để không ảnh hưởng khớp/lệch/trùng.
  const recentCreateCount = useMemo(() => {
    let count = 0;
    for (const r of rows) {
      if (isRecentCreateDate(r.create_date)) count++;
    }
    return count;
  }, [rows]);

  // Danh sách các dòng được đánh dấu 7055
  const rows7055 = useMemo(() => {
    return rows.filter((r) => Boolean(r.tag_7055));
  }, [rows]);

  // Trạng thái modal chỉnh sửa số lượng (không có nút xóa)
  const [editingRow, setEditingRow] = useState<ReferenceLine | null>(null);
  const [editQtyInput, setEditQtyInput] = useState('');
  const [qtyOperation, setQtyOperation] = useState<'subtract' | 'add'>('subtract');
  const [isSavingQty, setIsSavingQty] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Trạng thái modal chỉnh sửa vị trí Bin
  const [editingBinRow, setEditingBinRow] = useState<ReferenceLine | null>(null);
  const [editBinInput, setEditBinInput] = useState('');
  const [isSavingBin, setIsSavingBin] = useState(false);
  const [editBinError, setEditBinError] = useState<string | null>(null);

  // Nhập kho nhanh từ Bảng 2 sang Bảng 1: nút "+" mỗi dòng -> modal xác nhận 1 lần
  // (Tag ID + Bin + Qty, giống hệt modal quét tag) -> gọi scan-submit hiện có.
  const [quickRow, setQuickRow] = useState<ReferenceLine | null>(null);
  const [quickBin, setQuickBin] = useState('');
  const [quickQty, setQuickQty] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);
  const [quickConflict, setQuickConflict] = useState<{
    existingId: string;
    existingBin: string;
    action: 'append' | 'relocate' | null;
  } | null>(null);

  // Xóa nhanh dòng nguồn ở Bảng 2 (dùng RPC delete_reference_stock hiện có).
  const [deletingRefRow, setDeletingRefRow] = useState<ReferenceLine | null>(null);
  const [isDeletingRef, setIsDeletingRef] = useState(false);
  const [deleteRefNotice, setDeleteRefNotice] = useState<string | null>(null);

  // Nhả khóa presence khi unmount thật (đóng tab giữa chừng) để dòng nguồn
  // không kẹt. Dùng ref để object presence mới (đổi mỗi khi peers đổi) không
  // kích hoạt nhả khóa sớm làm mất lock khi modal còn mở.
  const presenceRef = useRef(presence);
  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);
  useEffect(() => () => presenceRef.current?.clearEditing(), []);

  function openEditBinModal(row: ReferenceLine) {
    const holder = presence?.getLock('table2', table2RowKey(row.batch_id));
    if (holder) {
      setEditBinError(`🔒 ${holder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới.`);
      return;
    }
    presence?.setEditing({
      table: 'table2',
      key: table2RowKey(row.batch_id),
      batchId: (row.batch_id || '').trim(),
      label: 'sửa Bin Bảng 2',
    });
    setEditingBinRow(row);
    setEditBinInput(row.bin);
    setEditBinError(null);
  }

  function closeEditBinModal() {
    setEditingBinRow(null);
    presence?.clearEditing();
  }

  async function handleSaveBin() {
    if (!editingBinRow) return;
    const cleanBin = editBinInput.trim();
    if (!cleanBin) {
      setEditBinError('Vị trí (Bin) không được để trống');
      return;
    }
    setIsSavingBin(true);
    setEditBinError(null);
    try {
      const { data, error } = await supabase.rpc('update_reference_bin', {
        p_batch_id: editingBinRow.batch_id,
        p_new_bin: cleanBin,
        ...(actorName ? { p_actor_name: actorName } : {}),
      });
      if (error || !data?.ok) {
        setEditBinError(`Lỗi cập nhật: ${error?.message || data?.error || 'Không xác định'}`);
      } else {
        const oldBin = editingBinRow.bin;
        setRows((prev) =>
          prev.map((r) =>
            r.batch_id === editingBinRow.batch_id
              ? { ...r, bin: cleanBin, previous_bin: oldBin }
              : r,
          ),
        );
        onBinUpdated?.(editingBinRow.batch_id, cleanBin);
        closeEditBinModal();
      }
    } catch (e) {
      setEditBinError(`Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSavingBin(false);
    }
  }

  function openEditModal(row: ReferenceLine) {
    const holder = presence?.getLock('table2', table2RowKey(row.batch_id));
    if (holder) {
      setEditError(`🔒 ${holder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới.`);
      return;
    }
    presence?.setEditing({
      table: 'table2',
      key: table2RowKey(row.batch_id),
      batchId: (row.batch_id || '').trim(),
      label: 'sửa SL Bảng 2',
    });
    setEditingRow(row);
    setEditQtyInput('');
    setQtyOperation('subtract');
    setEditError(null);
  }

  function closeEditModal() {
    setEditingRow(null);
    presence?.clearEditing();
  }

  async function handleSaveQty() {
    if (!editingRow) return;
    const cleanInput = editQtyInput.trim();
    if (!cleanInput) {
      setEditError('Vui lòng nhập số lượng điền mới');
      return;
    }
    const delta = Number(cleanInput);
    if (isNaN(delta) || delta < 0) {
      setEditError('Số lượng điền mới phải là một số không âm hợp lệ');
      return;
    }
    const newQ = qtyOperation === 'subtract' ? editingRow.qty - delta : editingRow.qty + delta;
    if (qtyOperation === 'subtract' && newQ < 0) {
      setEditError('Số lượng điền mới không được vượt quá số lượng cũ (tồn kho không được âm)');
      return;
    }
    setIsSavingQty(true);
    setEditError(null);
    try {
      const { data, error } = await supabase.rpc('update_reference_qty', {
        p_batch_id: editingRow.batch_id,
        p_new_qty: newQ,
        ...(actorName ? { p_actor_name: actorName } : {}),
      });
      if (error || !data?.ok) {
        setEditError(`Lỗi cập nhật: ${error?.message || data?.error || 'Không xác định'}`);
      } else {
        const oldQ = editingRow.qty;
        setRows((prev) =>
          prev.map((r) =>
            r.batch_id === editingRow.batch_id
              ? { ...r, qty: newQ, previous_qty: oldQ }
              : r,
          ),
        );
        onQtyUpdated?.(editingRow.batch_id, newQ);
        closeEditModal();
      }
    } catch (e) {
      setEditError(`Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSavingQty(false);
    }
  }

  // ---- Nhập kho nhanh: mở modal xác nhận 1 lần với Tag/Bin/Qty từ dòng nguồn ----
  function openQuickModal(row: ReferenceLine) {
    const holder = presence?.getLock('table2', table2RowKey(row.batch_id));
    if (holder) {
      setQuickNotice(`🔒 ${holder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới.`);
      setQuickRow(row);
      setQuickBin(row.bin);
      setQuickQty(String(row.qty));
      setQuickConflict(null);
      return;
    }
    presence?.setEditing({
      table: 'table2',
      key: table2RowKey(row.batch_id),
      batchId: (row.batch_id || '').trim(),
      label: 'nhập kho nhanh Bảng 2',
    });
    setQuickRow(row);
    setQuickBin(row.bin);
    setQuickQty(String(row.qty));
    setQuickNotice(null);
    // Cảnh báo sớm nếu Tag đã có lượt quét ở Bảng 1 (giống pre-check modal quét tag).
    const cleanBatch = (row.batch_id || '').trim();
    const existingScans = scannedByBatch.get(cleanBatch);
    if (existingScans && existingScans.length > 0) {
      const first = existingScans[0];
      setQuickConflict({ existingId: first.id, existingBin: first.bin, action: null });
    } else {
      setQuickConflict(null);
    }
  }

  function closeQuickModal() {
    setQuickRow(null);
    setQuickConflict(null);
    setQuickNotice(null);
    presence?.clearEditing();
  }

  function chooseQuickDuplicateAction(action: 'append' | 'relocate') {
    setQuickConflict((prev) => (prev ? { ...prev, action } : prev));
    setQuickNotice(
      action === 'append'
        ? 'Đã chọn: GHI THÊM bản ghi mới. Bấm Xác nhận để nhập kho.'
        : `Đã chọn: ĐỔI VỊ TRÍ sang "${quickBin.trim()}". Bấm Xác nhận để nhập kho.`,
    );
  }

  async function handleQuickConfirm() {
    if (!quickRow) return;
    const holder = presence?.getLock('table2', table2RowKey(quickRow.batch_id));
    // Nếu dòng đang bị người khác khóa mà mình chưa giữ lock thì chặn (trừ trường hợp
    // vừa mở modal đã thấy lock — vẫn cho đọc nhưng không cho ghi).
    if (holder) {
      setQuickNotice(`🔒 ${holder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới.`);
      return;
    }
    const batchId = (quickRow.batch_id || '').trim();
    const binVal = quickBin.trim();
    const qtyVal = Number(quickQty.trim());
    if (!batchId) {
      setQuickNotice('⚠️ Tag ID không hợp lệ.');
      return;
    }
    if (!binVal) {
      setQuickNotice('⚠️ Vui lòng nhập Vị trí (Bin).');
      return;
    }
    if (!Number.isFinite(qtyVal) || qtyVal <= 0) {
      setQuickNotice('⚠️ Vui lòng nhập Số lượng hợp lệ (> 0).');
      return;
    }
    setQuickBusy(true);
    setQuickNotice(null);
    try {
      const stockCode = (quickRow.stock_code || '').trim() || null;
      if (quickConflict?.action) {
        const res = await resolveDuplicate({
          action: quickConflict.action,
          scannedId: quickConflict.existingId,
          batchId,
          qty: qtyVal,
          bin: binVal,
          stockCode,
          ...(actorName ? { actorName } : {}),
        });
        if (res.kind === 'resolved') {
          onQuickImported?.();
          closeQuickModal();
        } else {
          setQuickNotice(`❌ Lỗi: ${res.message} (${res.code})`);
        }
      } else {
        const outcome = await submitScan({
          batchId,
          qty: qtyVal,
          bin: binVal,
          isManual: false,
          stockCode,
          ...(actorName ? { actorName } : {}),
        });
        if (outcome.kind === 'scanned') {
          onQuickImported?.();
          closeQuickModal();
        } else if (outcome.kind === 'duplicate') {
          setQuickConflict({
            existingId: outcome.conflict.existingId,
            existingBin: outcome.conflict.attempted.bin,
            action: null,
          });
          setQuickNotice(`⚠️ Tag ID ${batchId} đã có trong Bảng 1 — vui lòng chọn Ghi thêm hoặc Đổi vị trí.`);
        } else {
          setQuickNotice(`❌ Lỗi: ${outcome.message} (${outcome.code})`);
        }
      }
    } catch (e) {
      setQuickNotice(`❌ Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setQuickBusy(false);
    }
  }

  // ---- Xóa nhanh dòng nguồn ----
  function openDeleteRefModal(row: ReferenceLine) {
    const holder = presence?.getLock('table2', table2RowKey(row.batch_id));
    if (holder) return;
    presence?.setEditing({
      table: 'table2',
      key: table2RowKey(row.batch_id),
      batchId: (row.batch_id || '').trim(),
      label: 'xóa dòng nguồn Bảng 2',
    });
    setDeleteRefNotice(null);
    setDeletingRefRow(row);
  }

  function closeDeleteRefModal() {
    setDeletingRefRow(null);
    presence?.clearEditing();
  }

  async function handleConfirmDeleteRef() {
    if (!deletingRefRow) return;
    setIsDeletingRef(true);
    setDeleteRefNotice(null);
    try {
      const { data, error } = await supabase.rpc('delete_reference_stock', {
        p_batch_id: deletingRefRow.batch_id,
      });
      if (error || !data?.ok) {
        setDeleteRefNotice(`❌ Lỗi xóa: ${error?.message || data?.error || 'Không xác định'}`);
      } else {
        const goneId = (deletingRefRow.batch_id || '').trim();
        setRows((prev) => prev.filter((r) => (r.batch_id || '').trim() !== goneId));
        onReferenceDeleted?.(goneId);
        closeDeleteRefModal();
      }
    } catch (e) {
      setDeleteRefNotice(`❌ Lỗi kết nối: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsDeletingRef(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const step = 1000;
      let from = 0;
      const all: ReferenceLine[] = [];
      while (!cancelled) {
        // Sort ỔN ĐỊNH bắt buộc: batch_id (PK) làm tie-breaker sau stock_code.
        // ORDER BY stock_code đơn lẻ + phân trang OFFSET từng gây trùng 1 tag +
        // thiếu 1 tag ở stock 3428460401 (nhóm ties straddle biên trang 1000):
        // SQL không đảm bảo thứ tự ties giữa 2 query trang riêng biệt.
        const q = supabase
          .from('reference_stock')
          .select('batch_id,stock_code,warehouse,bin,previous_bin,qty,previous_qty,create_date,tag_7055')
          .order('stock_code', { ascending: true })
          .order('batch_id', { ascending: true });

        const res = await (q.range ? q.range(from, from + step - 1) : q);
        const data = res?.data;
        const error = res?.error;
        if (cancelled || error || !data || (data as unknown[]).length === 0) break;
        all.push(...(data as ReferenceLine[]));
        if ((data as unknown[]).length < step || !q.range) break;
        from += step;
      }
      if (cancelled) return;
      // Khử trùng phòng thủ theo PK: nếu backend vẫn trả trùng (ghi đồng thời
      // giữa 2 lần fetch trang làm lệch OFFSET), UI không bao giờ render 2 dòng
      // cùng batch_id một cách im lặng.
      const seenBatch = new Set<string>();
      const deduped: ReferenceLine[] = [];
      let dupDropped = 0;
      for (const r of all) {
        const k = (r?.batch_id || '').trim();
        if (!k) continue;
        if (seenBatch.has(k)) {
          dupDropped++;
          continue;
        }
        seenBatch.add(k);
        deduped.push(r);
      }
      if (dupDropped > 0) {
        console.warn(
          `[Bảng 2] đã loại ${dupDropped} dòng trùng batch_id khi tải phân trang (giữ dòng đầu tiên).`,
        );
      }
      setRows(deduped);
      setVisibleCount(100);
      setLoading(false);
    }
    void load();

    // Streaming đa người cho chính danh sách Bảng 2: máy khác sửa SL/Bin,
    // thêm dòng hoặc import file mới thì bảng này tự cập nhật, không cần F5.
    // (Cần kèm migration đưa reference_stock vào publication supabase_realtime.)
    // resilientSubscribe: tự nối lại + tải bù toàn bảng khi socket rớt
    // (import xóa-nạp lại hàng nghìn dòng mà mất event là lệch im).
    const channelTopic = `reference_table_rows_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const onPayload = (payload: { eventType: string; new?: unknown; old?: unknown }) => {
      if (cancelled) return;
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const incoming = payload.new as ReferenceLine;
        const cleanId = (incoming?.batch_id || '').trim();
        if (!cleanId) return;
        setRows((prev) => {
          const idx = prev.findIndex((r) => (r.batch_id || '').trim() === cleanId);
          if (idx !== -1) {
            const next = [...prev];
            // Giữ vết cũ đang hiển thị nếu payload realtime chưa kèm (import/sửa từ máy khác).
            next[idx] = {
              ...incoming,
              previous_bin: incoming.previous_bin ?? next[idx].previous_bin ?? null,
              previous_qty: incoming.previous_qty ?? next[idx].previous_qty ?? null,
            };
            return next;
          }
          return [incoming, ...prev];
        });
      } else if (payload.eventType === 'DELETE') {
        const gone = payload.old as { batch_id?: string };
        const cleanId = (gone?.batch_id || '').trim();
        if (!cleanId) return;
        setRows((prev) => prev.filter((r) => (r.batch_id || '').trim() !== cleanId));
      }
    };
    const cleanupChannel = resilientSubscribe({
      id: 'reference_table_rows',
      createChannel: () => supabase.channel(channelTopic),
      bindings: [
        {
          type: 'postgres_changes',
          event: '*',
          filter: { event: '*', schema: 'public', table: 'reference_stock' },
          handler: onPayload as (payload: never) => void,
        },
      ],
      onReconnect: () => {
        void load();
      },
    });

    return () => {
      cancelled = true;
      cleanupChannel();
    };
  }, [refreshTrigger]);

  // Bộ lọc kết hợp:
  // 1. smartFilter (ô 1): chỉ tìm Tag ID và Mã hàng (Stock Code), không tìm Bin
  // 2. warehouse (ô 2): dùng riêng để tìm Kho (WH)
  // 3. bin (ô 3): lọc các dữ liệu đầu của cột Bin (bắt đầu bằng prefix, vd: gõ 20 lọc 200202)
  const filteredRows = useMemo(() => {
    let list = rows;

    // Lọc dòng đã khớp nếu bật toggle
    if (matchedOnlyFilter) {
      list = list.filter((r) => isRowMatched(r));
    }

    // Lọc dòng dữ liệu dư (không được highlight: không khớp, không lệch bin, không lệch sl, không trùng quét)
    if (excessOnlyFilter) {
      list = list.filter((r) => isRowUnhighlighted(r));
    }

    // Ô thứ 2: Dùng để tìm WH (Kho)
    if (warehouse.trim()) {
      const whTerm = warehouse.trim().toLowerCase();
      const cleanWhTerm = whTerm.replace(/^wh[\s:-]*/i, '');
      list = list.filter((r) => {
        const rowWh = (r.warehouse || '').toLowerCase();
        const cleanRowWh = rowWh.replace(/^wh[\s:-]*/i, '');
        return (
          rowWh.includes(whTerm) ||
          cleanRowWh.includes(cleanWhTerm) ||
          rowWh.includes(cleanWhTerm)
        );
      });
    }

    // Ô thứ 3: Lọc Bin — tự động hiểu để lọc các dữ liệu đầu của cột Bin (bắt đầu bằng)
    if (bin.trim()) {
      const binTerm = bin.trim().toLowerCase();
      list = list.filter((r) => {
        const rowBin = (r.bin || '').trim().toLowerCase();
        return rowBin.startsWith(binTerm);
      });
    }

    // Ô thứ 1: Mục dò tìm đầu tiên — không tìm bin, chỉ tìm Tag ID và Mã hàng (Stock Code)
    if (smartFilter.trim()) {
      const term = smartFilter.trim().toLowerCase();
      const isSearchingMatched = term === 'khớp' || term === 'đã khớp' || term === 'da khop';
      const isSearchingBinMismatch = term === 'lệch bin' || term === 'lech bin' || term === 'lệch vị trí';
      const isSearchingQtyMismatch = term === 'lệch sl' || term === 'lech sl' || term === 'lệch số lượng';
      const isSearchingAnyMismatch = term === 'lệch' || term === 'lech' || term === 'sai lệch';
      const isSearchingDuplicate = term === 'trùng' || term === 'trung' || term === 'trùng tag' || term === 'trùng quét' || term === 'trung quet' || term === 'duplicate';
      const isSearchingRecent =
        term === 'mới' ||
        term === 'moi' ||
        term === 'ngày mới' ||
        term === 'ngay moi' ||
        term === 'ngày tạo mới' ||
        term === 'ngay tao moi';

      list = list.filter((r) => {
        if (isSearchingMatched && isRowMatched(r)) return true;
        if (isSearchingBinMismatch && isRowBinMismatch(r)) return true;
        if (isSearchingQtyMismatch && isRowQtyMismatch(r)) return true;
        if (isSearchingAnyMismatch && (isRowBinMismatch(r) || isRowQtyMismatch(r))) return true;
        if (isSearchingDuplicate && isRowDuplicateScanned(r)) return true;
        if (isSearchingRecent && isRecentCreateDate(r.create_date)) return true;
        return (
          r.stock_code.toLowerCase().includes(term) ||
          r.batch_id.toLowerCase().includes(term)
        );
      });
    }

    return list;
  }, [rows, smartFilter, warehouse, bin, matchedOnlyFilter, excessOnlyFilter, isRowMatched, isRowBinMismatch, isRowQtyMismatch, isRowDuplicateScanned, isRowUnhighlighted]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 80;
    if (nearBottom && visibleCount < filteredRows.length) {
      setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length));
    }
  }

  const displayedRows = filteredRows.slice(0, visibleCount);

  function formatDate(dStr?: string | null) {
    if (!dStr) return '—';
    try {
      const d = new Date(dStr);
      if (isNaN(d.getTime())) return dStr;
      return d.toLocaleDateString('vi-VN');
    } catch {
      return dStr;
    }
  }

  return (
    <section aria-label="Dữ liệu hệ thống" className="flex flex-col gap-4">
      {/* Khu vực thẻ hoạt động Bảng 2: Import (gồm khối 7055 bên trong) + Thẻ Thêm nguồn nới rộng */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Thẻ Import: giữ nguyên phần import, khối Tag 7055 nằm chung bên dưới vạch ngăn */}
        <ReferenceImportCard
          actorName={actorName}
          onImportSuccess={() => {
            setRefreshTrigger((prev) => prev + 1);
            onReferenceImported?.();
          }}
          bottomContent={<Reference7055Card bare rows7055={rows7055} />}
        />
        {/* Thẻ Thêm nguồn kéo dài nửa phải, thẳng hàng với bảng trên/dưới */}
        <ReferenceAddCard
          existingRows={rows}
          actorName={actorName}
          onAddSuccess={(newRow) => {
            setRows((prev) => [newRow, ...prev]);
            onReferenceAdded?.(newRow);
          }}
        />
        {/* Nhật ký hoạt động: full-width ngay dưới các thẻ, chung khu vực thẻ Bảng 2 */}
        <div className="md:col-span-2">
          <ActivityLogCard />
        </div>
      </div>

      {/* Bảng dữ liệu nguồn tra cứu — anchor #bang-2 nằm thẳng ở đây để nút
          ⬇ Bảng 2 nhảy tới đúng bảng dữ liệu, không dừng ở thẻ import/nhật ký. */}
      <div id="bang-2" className="rounded-2xl border border-white/10 bg-slate-900/80 p-4 sm:p-5 shadow-lg scroll-mt-4">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300 flex flex-wrap items-center gap-2">
                <span>📂</span> Bảng 2 — Dữ liệu file nguồn ({rows.length.toLocaleString()} dòng)
                {matchedCount > 0 && (
                  <span
                    data-testid="ref-matched-badge"
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300 shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    ĐÃ KHỚP BẢNG 1: {matchedCount.toLocaleString()} DÒNG
                  </span>
                )}
                {duplicateCount > 0 && (
                  <span
                    data-testid="ref-duplicate-badge"
                    className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/40 bg-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                    TRÙNG QUÉT: {duplicateCount.toLocaleString()} DÒNG
                  </span>
                )}
                {binMismatchCount > 0 && (
                  <span
                    data-testid="ref-bin-mismatch-badge"
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-bold text-amber-300 shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                    LỆCH BIN: {binMismatchCount.toLocaleString()} DÒNG
                  </span>
                )}
                {qtyMismatchCount > 0 && (
                  <span
                    data-testid="ref-qty-mismatch-badge"
                    className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/40 bg-rose-500/20 px-2.5 py-0.5 text-[10px] font-bold text-rose-300 shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse"></span>
                    LỆCH SL: {qtyMismatchCount.toLocaleString()} DÒNG
                  </span>
                )}
                {recentCreateCount > 0 && (
                  <span
                    data-testid="ref-recent-badge"
                    title={`Dòng có ngày tạo từ 28/08/2026 đến nay cần chú ý kiểm tra kỹ`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/40 bg-sky-500/20 px-2.5 py-0.5 text-[10px] font-bold text-sky-300 shadow-sm"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse"></span>
                    ⚠️ NGÀY TẠO MỚI (≥ 28/08): {recentCreateCount.toLocaleString()} DÒNG
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Hiển thị đầy đủ thông tin tồn kho gốc: Stock Code, Tag ID (Batch), Kho, Bin, Số lượng và Ngày tạo. Các dòng khớp Bảng 1 được highlight xanh ngọc; các dòng lệch vị trí (Bin) được highlight vàng cam, lệch số lượng được highlight đỏ. Riêng cảnh báo ngày tạo mới (từ 28/08/2026 đến nay) chỉ highlight CHỮ ở cột Ngày tạo kèm nhãn ⚠️ MỚI để không đè mất màu nền cảnh báo đã có.
              </p>
              {presenceHeader && <div className="mt-1">{presenceHeader}</div>}
            </div>
          </div>

          {/* Hàng bộ lọc: Bộ lọc thông minh & Lọc kho / vị trí & Nút lọc nhanh đã khớp & Chỉ hiển thị dữ liệu dư */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {/* Ô 1: Dò tìm Tag ID hoặc Stock Code */}
            <div className="relative">
              <input
                aria-label="Tìm kiếm thông minh"
                type="text"
                value={smartFilter}
                onChange={(e) => {
                  setSmartFilter(e.target.value);
                  setVisibleCount(100);
                }}
                placeholder="🔍 Tìm Tag ID hoặc Stock Code..."
                className="w-full rounded-xl border border-indigo-500/40 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>

            {/* Ô 2: Dùng để tìm WH (Kho) */}
            <div>
              <input
                aria-label="Lọc theo kho"
                type="text"
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                placeholder="🏢 Tìm Kho (WH) (vd 01, 50, WH01)..."
                className="w-full rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Ô 3: Lọc Bin — tự động hiểu để lọc các dữ liệu đầu của cột Bin (bắt đầu bằng) */}
            <div>
              <input
                aria-label="Lọc theo vị trí"
                type="text"
                value={bin}
                onChange={(e) => setBin(e.target.value)}
                placeholder="📍 Lọc đầu Bin (vd: 10, 20)..."
                className="w-full rounded-xl border border-white/10 bg-black/50 p-2.5 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            {/* Nút lọc nhanh dòng đã khớp */}
            <div>
              <button
                type="button"
                onClick={() => {
                  setMatchedOnlyFilter((prev) => !prev);
                  setExcessOnlyFilter(false);
                  setVisibleCount(100);
                }}
                aria-label="Lọc dòng đã khớp Bảng 1"
                className={`w-full flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-mono text-xs font-bold transition active:scale-95 ${
                  matchedOnlyFilter
                    ? 'border-emerald-500 bg-emerald-500/25 text-emerald-300 shadow-md shadow-emerald-500/20'
                    : 'border-white/10 bg-black/50 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-300'
                }`}
              >
                <span>{matchedOnlyFilter ? '✓' : '🔍'}</span>
                <span>Chỉ hiện đã khớp ({matchedCount})</span>
              </button>
            </div>

            {/* Nút lọc nhanh dòng dữ liệu dư (không được highlight) */}
            <div>
              <button
                type="button"
                data-testid="btn-filter-excess"
                onClick={() => {
                  setExcessOnlyFilter((prev) => !prev);
                  setMatchedOnlyFilter(false);
                  setVisibleCount(100);
                }}
                aria-label="Chỉ hiển thị dữ liệu dư"
                className={`w-full flex items-center justify-center gap-1.5 rounded-xl border p-2.5 font-mono text-xs font-bold transition active:scale-95 ${
                  excessOnlyFilter
                    ? 'border-cyan-500 bg-cyan-500/25 text-cyan-300 shadow-md shadow-cyan-500/20'
                    : 'border-white/10 bg-black/50 text-slate-400 hover:border-cyan-500/40 hover:text-cyan-300'
                }`}
              >
                <span>{excessOnlyFilter ? '✓' : '📦'}</span>
                <span>Hiển thị dữ liệu dư ({excessCount})</span>
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm text-slate-400">⏳ Đang tải toàn bộ dữ liệu nguồn từ hệ thống...</p>
        ) : filteredRows.length === 0 ? (
          <p data-testid="ref-empty" className="p-6 text-center text-sm text-slate-500">
            Không có dòng nào khớp với bộ lọc.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div
              onScroll={handleScroll}
              className="max-h-[440px] overflow-y-auto overflow-x-auto rounded-xl border border-white/10 bg-black/30 custom-scrollbar"
            >
              <table className="w-full min-w-[780px] text-left font-mono text-xs">
                <thead className="sticky top-0 z-10 bg-slate-950 text-slate-400 border-b border-white/10 shadow">
                  <tr>
                    <th className="px-3 py-2.5">STOCK CODE</th>
                    <th className="px-3 py-2.5">TAG ID (BATCH)</th>
                    <th className="px-3 py-2.5">KHO</th>
                    <th className="px-3 py-2.5 text-right">BIN</th>
                    <th className="px-3 py-2.5 text-right">SỐ LƯỢNG</th>
                    <th className="px-3 py-2.5 text-center">NGÀY TẠO</th>
                    <th className="px-3 py-2.5 text-center">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {displayedRows.map((r, i) => {
                    const cleanBatch = (r.batch_id || '').trim();
                    const scans = scannedByBatch.get(cleanBatch);
                    const isDuplicate = isRowDuplicateScanned(r);
                    const isMatched = !isDuplicate && isRowMatched(r);
                    const isBinMismatch = !isDuplicate && !isMatched && isRowBinMismatch(r);
                    const isQtyMismatch = !isDuplicate && !isMatched && isRowQtyMismatch(r);
                    // Khóa mềm realtime: dòng nguồn đang bị người khác sửa thì disable.
                    const lockHolder = presence?.getLock('table2', table2RowKey(r.batch_id)) ?? null;

                    let rowTestId = 'ref-row';
                    if (isDuplicate) {
                      rowTestId = 'ref-row-duplicate';
                    } else if (isMatched) {
                      rowTestId = 'ref-row-matched';
                    } else if (isBinMismatch && isQtyMismatch) {
                      rowTestId = 'ref-row-mismatch-both';
                    } else if (isBinMismatch) {
                      rowTestId = 'ref-row-mismatch-bin';
                    } else if (isQtyMismatch) {
                      rowTestId = 'ref-row-mismatch-qty';
                    }

                    const rowBgClass = isDuplicate
                      ? 'bg-purple-950/40 hover:bg-purple-900/50 border-l-4 border-l-purple-500 text-purple-100 shadow-[inset_0_0_12px_rgba(168,85,247,0.15)]'
                      : isMatched
                      ? 'bg-emerald-950/40 hover:bg-emerald-900/50 border-l-4 border-l-emerald-400 text-emerald-100 shadow-[inset_0_0_12px_rgba(16,185,129,0.12)]'
                      : isBinMismatch && isQtyMismatch
                      ? 'bg-gradient-to-r from-rose-950/35 via-slate-900/50 to-amber-950/35 hover:bg-rose-900/30 border-l-4 border-l-rose-500 text-slate-100 shadow-[inset_0_0_12px_rgba(244,63,94,0.12)]'
                      : isQtyMismatch
                      ? 'bg-rose-950/35 hover:bg-rose-900/40 border-l-4 border-l-rose-500 text-rose-100 shadow-[inset_0_0_12px_rgba(244,63,94,0.12)]'
                      : isBinMismatch
                      ? 'bg-amber-950/35 hover:bg-amber-900/40 border-l-4 border-l-amber-500 text-amber-100 shadow-[inset_0_0_12px_rgba(245,158,11,0.12)]'
                      : 'hover:bg-white/5';

                    return (
                      <tr
                        // Key ổn định theo PK (đã khử trùng khi tải): trùng batch_id
                        // thật sẽ lộ qua cảnh báo React thay vì render im lặng.
                        // (Trước đây key `${batch_id}-${i}` che mất trùng lặp.)
                        key={cleanBatch || `row-${i}`}
                        data-testid={rowTestId}
                        className={`transition-colors ${rowBgClass}`}
                      >
                        <td className="px-3 py-2 font-bold text-slate-200">{r.stock_code}</td>
                        <td className="px-3 py-2 font-bold">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={
                                isDuplicate
                                  ? 'text-purple-300 font-extrabold'
                                  : isMatched
                                  ? 'text-emerald-300 font-extrabold'
                                  : isQtyMismatch && !isBinMismatch
                                  ? 'text-rose-300 font-extrabold'
                                  : isBinMismatch && !isQtyMismatch
                                  ? 'text-amber-300 font-extrabold'
                                  : isBinMismatch && isQtyMismatch
                                  ? 'text-rose-300 font-extrabold'
                                  : 'text-cyan-300'
                              }
                            >
                              {r.batch_id}
                            </span>
                            {r.tag_7055 && (
                              <span
                                data-testid={`ref-tag-7055-${r.batch_id}`}
                                title="Tag in thêm 7055"
                                className="inline-flex items-center gap-1 rounded-full border border-purple-500/50 bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-purple-300 shadow-sm"
                              >
                                <span>🏷️ 7055</span>
                              </span>
                            )}
                            {isDuplicate && (
                              <span
                                data-testid="ref-badge-duplicate"
                                title={`Tag bị quét trùng ${scans?.length || 2} lần tại các vị trí khác nhau trong Bảng 1`}
                                className="inline-flex items-center gap-1 rounded-full border border-purple-500/50 bg-purple-500/25 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-purple-300 shadow-sm"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse"></span>
                                <span>TRÙNG QUÉT ({scans?.length || 2})</span>
                              </span>
                            )}
                            {isMatched && (
                              <span
                                title="Dữ liệu đã khớp hoàn toàn với Bảng 1"
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/25 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-emerald-300 shadow-sm"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span>ĐÃ KHỚP</span>
                              </span>
                            )}
                            {isBinMismatch && (
                              <span
                                data-testid="ref-badge-bin-mismatch"
                                title="Đã quét Tag ID nhưng chưa khớp vị trí Bin với Bảng 1"
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/25 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-amber-300 shadow-sm"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                <span>LỆCH BIN</span>
                              </span>
                            )}
                            {isQtyMismatch && (
                              <span
                                data-testid="ref-badge-qty-mismatch"
                                title="Đã quét Tag ID nhưng chưa khớp số lượng với Bảng 1"
                                className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/25 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-rose-300 shadow-sm"
                              >
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse"></span>
                                <span>LỆCH SL</span>
                              </span>
                            )}
                            {lockHolder && (
                              <span
                                title={`${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới`}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-950/60 px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-amber-300 shadow-sm"
                              >
                                <span>🔒 {lockHolder.name} đang thao tác</span>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-300">{r.warehouse}</td>
                        {/* Vị trí mới kèm note vị trí cũ gần nhất tại cùng vị trí + nút Sửa vị trí */}
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="text-right">
                              {isDuplicate ? (
                                <div>
                                  <span
                                    data-testid="ref-cell-bin-duplicate"
                                    title={`Quét trùng ở các vị trí: ${scans?.map((s) => s.bin).filter(Boolean).join(', ')}`}
                                    className="inline-block rounded border border-purple-500/60 bg-purple-950/70 px-2 py-0.5 font-bold text-purple-300 shadow-sm"
                                  >
                                    {r.bin}
                                  </span>
                                  {scans && scans.length > 0 && (
                                    <span className="block text-[10px] font-medium text-purple-400">
                                      (quét: {scans.map((s) => s.bin).filter(Boolean).join(', ')})
                                    </span>
                                  )}
                                </div>
                              ) : isBinMismatch ? (
                                <span
                                  data-testid="ref-cell-bin-mismatch"
                                  title="Vị trí chưa khớp với lượt quét ở Bảng 1"
                                  className="inline-block rounded border border-amber-500/60 bg-amber-950/70 px-2 py-0.5 font-bold text-amber-300 shadow-sm"
                                >
                                  {r.bin}
                                </span>
                              ) : (
                                <span className="font-semibold text-emerald-300">{r.bin}</span>
                              )}
                              {r.previous_bin && (
                                <span className="block text-[10px] font-medium text-amber-400/90">
                                  (cũ: {r.previous_bin})
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => openEditBinModal(r)}
                              disabled={Boolean(lockHolder)}
                              title={lockHolder ? `${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới` : 'Chỉnh sửa vị trí (Bin)'}
                              aria-label={`Chỉnh sửa vị trí ${r.batch_id}`}
                              className="rounded-lg border border-white/10 bg-white/5 p-1 text-slate-400 transition hover:border-emerald-500/40 hover:bg-emerald-950/60 hover:text-emerald-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              ✏️
                            </button>
                          </div>
                        </td>

                        {/* Số lượng mới kèm note số lượng cũ gần nhất tại cùng vị trí + nút Sửa (không có nút xóa) */}
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="text-right">
                              {isQtyMismatch ? (
                                <span
                                  data-testid="ref-cell-qty-mismatch"
                                  title="Số lượng chưa khớp với lượt quét ở Bảng 1"
                                  className="inline-block rounded border border-rose-500/60 bg-rose-950/70 px-2 py-0.5 font-bold text-rose-300 shadow-sm text-xs"
                                >
                                  {r.qty}
                                </span>
                              ) : (
                                <span
                                  className={`font-bold text-xs ${
                                    isMatched ? 'text-emerald-200 font-extrabold' : 'text-white'
                                  }`}
                                >
                                  {r.qty}
                                </span>
                              )}
                              {r.previous_qty !== null && r.previous_qty !== undefined && (
                                <span className="block text-[10px] font-medium text-amber-400/90">
                                  (cũ: {r.previous_qty})
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => openEditModal(r)}
                              disabled={Boolean(lockHolder)}
                              title={lockHolder ? `${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới` : 'Chỉnh sửa số lượng'}
                              aria-label={`Chỉnh sửa số lượng ${r.batch_id}`}
                              className="rounded-lg border border-white/10 bg-white/5 p-1 text-slate-400 transition hover:border-cyan-500/40 hover:bg-cyan-950/60 hover:text-cyan-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              ✏️
                            </button>
                          </div>
                        </td>

                        <td className="px-3 py-2 text-center text-[11px]">
                          {(() => {
                            // Cảnh báo ngày tạo mới: CHỈ highlight chữ trong ô này,
                            // tuyệt đối không đổi màu nền dòng để giữ nguyên
                            // highlight khớp/lệch/trùng đã có.
                            const isRecentCreate = isRecentCreateDate(r.create_date);
                            if (!isRecentCreate) {
                              return <span className="text-slate-400">{formatDate(r.create_date)}</span>;
                            }
                            return (
                              <span className="inline-flex flex-col items-center gap-0.5">
                                <span
                                  data-testid="ref-cell-date-recent"
                                  title="⚠️ Ngày tạo từ 28/08/2026 đến nay — chú ý kiểm tra kỹ"
                                  className="font-extrabold text-sky-300 underline decoration-sky-400/60 decoration-dotted underline-offset-2"
                                >
                                  {formatDate(r.create_date)}
                                </span>
                                <span
                                  data-testid="ref-badge-recent"
                                  title="Ngày tạo mới từ 28/08/2026 — chú ý kiểm tra kỹ"
                                  className="inline-flex items-center gap-1 rounded-full border border-sky-500/50 bg-sky-500/20 px-1.5 py-px text-[9px] font-extrabold tracking-wide text-sky-300 shadow-sm"
                                >
                                  <span>⚠️ MỚI</span>
                                </span>
                              </span>
                            );
                          })()}
                        </td>

                        {/* Thao tác nhanh: nhập kho sang Bảng 1 (+) + xóa dòng nguồn */}
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => openQuickModal(r)}
                              title="Nhập kho nhanh sang Bảng 1 (Tag + Bin + SL)"
                              aria-label={`Nhập kho nhanh ${r.batch_id}`}
                              className="rounded-lg border border-emerald-500/40 bg-emerald-950/60 px-2 py-1 text-sm font-black text-emerald-300 transition hover:bg-emerald-900 hover:text-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={() => openDeleteRefModal(r)}
                              disabled={Boolean(lockHolder)}
                              title={lockHolder ? `${lockHolder.name} đang thao tác dòng này — vui lòng chờ cập nhật mới` : 'Xóa dòng nguồn này'}
                              aria-label={`Xóa dòng nguồn ${r.batch_id}`}
                              className="rounded-lg border border-transparent p-1.5 text-slate-400 transition hover:border-rose-500/40 hover:bg-rose-950/60 hover:text-rose-300 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-transparent disabled:hover:bg-transparent"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer thanh trạng thái: đếm dòng + tải tiếp + lối tắt về Bảng 1 */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-slate-400">
              <span>
                Đang hiển thị <strong className="text-cyan-300">{displayedRows.length}</strong> /{' '}
                <strong className="text-white">{filteredRows.length.toLocaleString()}</strong> dòng
                {filteredRows.length !== rows.length && (
                  <span className="text-slate-500"> (Tổng nguồn: {rows.length.toLocaleString()} dòng)</span>
                )}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {visibleCount < filteredRows.length && (
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => Math.min(prev + 100, filteredRows.length))}
                    className="font-bold text-indigo-400 hover:text-indigo-300 transition underline"
                  >
                    Cuộn xuống hoặc bấm tải tiếp(còn {(filteredRows.length - visibleCount).toLocaleString()} dòng)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => smoothScrollToElementById('bang-1')}
                  title="Trượt nhanh về Bảng 1 — danh sách quét & đối chiếu (phím ↑)"
                  aria-label="Trượt nhanh về Bảng 1"
                  data-testid="btn-goto-table1"
                  className="rounded-xl border border-cyan-500/40 bg-cyan-950/60 px-3 py-1.5 font-bold text-cyan-300 shadow-sm transition hover:bg-cyan-900 active:scale-95"
                >
                  ⬆ Bảng 1
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal UI nổi chỉnh sửa số lượng Bảng 2 */}
      {editingRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-qty-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-cyan-500/50 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✏️</span>
                <div>
                  <h3 id="edit-qty-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Chỉnh Sửa Số Lượng Nguồn
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                    Cập nhật số lượng đồng bộ database
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingQty}
                onClick={() => closeEditModal()}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              {/* Thông tin mặt hàng */}
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng (Stock Code):</span>
                  <span className="font-bold text-slate-200">{editingRow.stock_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID (Batch):</span>
                  <span className="font-bold text-cyan-300">{editingRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kho / Vị trí:</span>
                  <span className="font-bold text-emerald-300">{editingRow.warehouse} / {editingRow.bin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng hiện tại:</span>
                  <span className="font-bold text-white text-xs">
                    {editingRow.qty}
                    {editingRow.previous_qty !== null && editingRow.previous_qty !== undefined && (
                      <span className="ml-2 font-normal text-amber-400">(cũ: {editingRow.previous_qty})</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Chọn phép tính: Trừ (mặc định) hoặc Cộng */}
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/40 px-3.5 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Phép tính:
                </span>
                <div className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-black/70 p-1">
                  <button
                    type="button"
                    data-testid="ref-op-subtract"
                    onClick={() => setQtyOperation('subtract')}
                    className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                      qtyOperation === 'subtract'
                        ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50 shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    − Trừ (mặc định)
                  </button>
                  <button
                    type="button"
                    data-testid="ref-op-add"
                    onClick={() => setQtyOperation('add')}
                    className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                      qtyOperation === 'add'
                        ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    + Cộng
                  </button>
                </div>
              </div>

              {/* Hàng 2 ô: Ô số lượng cũ (giữ lại) và Ô số lượng điền mới bên cạnh */}
              <div className="grid grid-cols-2 gap-3">
                {/* Ô số lượng cũ */}
                <div>
                  <label className="mb-1.5 block font-bold uppercase tracking-wider text-slate-400 text-[11px]">
                    Số lượng cũ:
                  </label>
                  <div
                    data-testid="ref-old-qty-box"
                    className="w-full rounded-xl border border-white/20 bg-black/60 p-3 text-center font-mono text-xl font-bold text-slate-200 select-none"
                  >
                    {editingRow.qty}
                  </div>
                </div>

                {/* Ô số lượng điền mới bên cạnh */}
                <div>
                  <label htmlFor="edit-new-qty-input" className="mb-1.5 block font-bold uppercase tracking-wider text-cyan-400 text-[11px]">
                    Số lượng điền mới:
                  </label>
                  <input
                    id="edit-new-qty-input"
                    aria-label="Số lượng điền mới"
                    type="number"
                    min={0}
                    step="any"
                    value={editQtyInput}
                    disabled={isSavingQty}
                    onChange={(e) => setEditQtyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSaveQty();
                    }}
                    autoFocus
                    className="w-full rounded-xl border-2 border-cyan-500/50 bg-black/70 p-3 text-center font-mono text-xl font-bold text-cyan-300 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                    placeholder="Nhập SL..."
                  />
                </div>
              </div>

              {/* Tự động tính toán: Lấy số lượng cũ trừ hoặc cộng số lượng mới điền cho ra kết quả mới */}
              {(() => {
                const delta = editQtyInput.trim() === '' ? 0 : Number(editQtyInput);
                const calcResult = qtyOperation === 'subtract' ? editingRow.qty - delta : editingRow.qty + delta;
                const isNegative = qtyOperation === 'subtract' && !isNaN(delta) && calcResult < 0;
                return (
                  <div
                    className={`rounded-2xl border p-3 font-mono text-xs transition-colors ${
                      isNegative
                        ? 'border-rose-500/50 bg-rose-950/40 text-rose-200'
                        : 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">
                        {qtyOperation === 'subtract' ? 'Công thức trừ tự động:' : 'Công thức cộng:'}
                      </span>
                      <span className="font-bold">
                        {editingRow.qty} {qtyOperation === 'subtract' ? '-' : '+'} {delta} ={' '}
                        <strong
                          data-testid="ref-calculated-qty"
                          className={isNegative ? 'text-rose-400 font-extrabold' : 'text-emerald-300 font-extrabold'}
                        >
                          {calcResult}
                        </strong>
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px]">
                      <span className="text-slate-400">Kết quả tồn mới:</span>
                      <span className="text-sm font-extrabold text-white">{calcResult}</span>
                    </div>
                    {isNegative && (
                      <p className="mt-1.5 text-[10px] font-bold text-rose-400">
                        ⚠️ Số lượng điền mới không được lớn hơn số lượng cũ (tồn kho không được âm).
                      </p>
                    )}
                  </div>
                );
              })()}

              <p className="text-[11px] text-slate-400 italic">
                * Hệ thống tự động lấy số lượng cũ ({editingRow.qty}) {qtyOperation === 'subtract' ? 'trừ đi' : 'cộng thêm'} số lượng mới điền. Sau khi lưu, kết quả mới sẽ hiển thị tại cột Số lượng và số lượng cũ được ghi chú bên dưới (cũ: {editingRow.qty}).
              </p>

              {editError && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {editError}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                disabled={isSavingQty}
                onClick={() => closeEditModal()}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isSavingQty}
                onClick={() => void handleSaveQty()}
                className="rounded-xl bg-gradient-to-r from-cyan-600 via-teal-600 to-emerald-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-cyan-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
              >
                {isSavingQty ? 'Đang lưu...' : '💾 Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal UI nổi chỉnh sửa vị trí Bin Bảng 2 */}
      {editingBinRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-bin-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-emerald-500/50 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✏️</span>
                <div>
                  <h3 id="edit-bin-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Chỉnh Sửa Vị Trí Nguồn (Bin)
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Cập nhật vị trí Bin đồng bộ database
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isSavingBin}
                onClick={() => closeEditBinModal()}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              {/* Thông tin mặt hàng */}
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng (Stock Code):</span>
                  <span className="font-bold text-slate-200">{editingBinRow.stock_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID (Batch):</span>
                  <span className="font-bold text-cyan-300">{editingBinRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kho (Warehouse):</span>
                  <span className="font-bold text-slate-300">{editingBinRow.warehouse}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Vị trí hiện tại:</span>
                  <span className="font-bold text-emerald-300">
                    {editingBinRow.bin}
                    {editingBinRow.previous_bin && (
                      <span className="ml-2 font-normal text-amber-400">(cũ: {editingBinRow.previous_bin})</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng:</span>
                  <span className="font-bold text-white">{editingBinRow.qty}</span>
                </div>
              </div>

              {/* Ô nhập vị trí Bin mới */}
              <div>
                <label htmlFor="edit-new-bin-input" className="mb-1.5 block font-bold uppercase tracking-wider text-emerald-400 text-[11px]">
                  Vị trí Bin mới:
                </label>
                <input
                  id="edit-new-bin-input"
                  type="text"
                  value={editBinInput}
                  disabled={isSavingBin}
                  onChange={(e) => setEditBinInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveBin();
                  }}
                  autoFocus
                  className="w-full rounded-xl border-2 border-emerald-500/50 bg-black/70 p-3 text-center font-mono text-xl font-bold uppercase text-emerald-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                  placeholder="Nhập vị trí Bin mới..."
                />
              </div>

              <p className="text-[11px] text-slate-400 italic">
                * Sau khi lưu, vị trí hiện tại ({editingBinRow.bin}) sẽ được note lại là vị trí cũ gần nhất ngay tại cột BIN.
              </p>

              {editBinError && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {editBinError}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                disabled={isSavingBin}
                onClick={() => closeEditBinModal()}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isSavingBin || !editBinInput.trim()}
                onClick={() => void handleSaveBin()}
                className="rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-emerald-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
              >
                {isSavingBin ? 'Đang lưu...' : '💾 Lưu thay đổi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nhập kho nhanh từ Bảng 2 sang Bảng 1 (xác nhận 1 lần) */}
      {quickRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-import-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-emerald-500/50 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <h3 id="quick-import-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Nhập Kho Nhanh Sang Bảng 1
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    Xác nhận 1 lần — Tag + Bin + SL như quét tag
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={quickBusy}
                onClick={() => closeQuickModal()}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng:</span>
                  <span className="font-bold text-slate-200">{quickRow.stock_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID:</span>
                  <span className="font-bold text-cyan-300">{quickRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kho:</span>
                  <span className="font-bold text-slate-300">{quickRow.warehouse}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="quick-bin-input" className="mb-1.5 block font-bold uppercase tracking-wider text-emerald-400 text-[11px]">
                    Vị trí (Bin):
                  </label>
                  <input
                    id="quick-bin-input"
                    aria-label="Vị trí Bin nhập kho nhanh"
                    type="text"
                    value={quickBin}
                    disabled={quickBusy}
                    onChange={(e) => setQuickBin(e.target.value)}
                    className="w-full rounded-xl border-2 border-emerald-500/50 bg-black/70 p-2.5 text-center font-mono text-sm font-bold uppercase text-emerald-300 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="quick-qty-input" className="mb-1.5 block font-bold uppercase tracking-wider text-emerald-400 text-[11px]">
                    Số lượng:
                  </label>
                  <input
                    id="quick-qty-input"
                    aria-label="Số lượng nhập kho nhanh"
                    type="number"
                    min={0}
                    step="any"
                    value={quickQty}
                    disabled={quickBusy}
                    onChange={(e) => setQuickQty(e.target.value)}
                    className="w-full rounded-xl border-2 border-emerald-500/50 bg-black/70 p-2.5 text-center font-mono text-sm font-bold text-emerald-300 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              </div>

              {quickConflict && (
                <div className="rounded-xl border border-rose-500/60 bg-rose-950/40 p-3 text-xs">
                  <p className="font-bold text-rose-300">
                    ⚠️ Tag {quickRow.batch_id} đã có trong Bảng 1 tại vị trí &quot;{quickConflict.existingBin}&quot; — chọn cách xử lý:
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => chooseQuickDuplicateAction('append')}
                      className={`flex-1 rounded-lg py-2 font-bold transition ${
                        quickConflict.action === 'append'
                          ? 'bg-rose-600 text-white shadow-lg'
                          : 'bg-rose-950/80 text-rose-200 hover:bg-rose-900'
                      }`}
                    >
                      ➕ Ghi thêm
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseQuickDuplicateAction('relocate')}
                      className={`flex-1 rounded-lg py-2 font-bold transition ${
                        quickConflict.action === 'relocate'
                          ? 'bg-amber-600 text-white shadow-lg'
                          : 'bg-amber-950/80 text-amber-200 hover:bg-amber-900'
                      }`}
                    >
                      🔄 Đổi vị trí
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-400 italic">
                * Sau khi xác nhận, hệ thống đối chiếu Bảng 1 ↔ Bảng 2 bình thường: sai thì cảnh báo, đúng thì báo khớp.
              </p>

              {quickNotice && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {quickNotice}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                disabled={quickBusy}
                onClick={() => closeQuickModal()}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={quickBusy || !quickBin.trim() || !quickQty.trim()}
                onClick={() => void handleQuickConfirm()}
                className="rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-emerald-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
              >
                {quickBusy ? 'Đang nhập...' : '⚡ Xác nhận nhập kho'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal xác nhận xóa dòng nguồn Bảng 2 */}
      {deletingRefRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-ref-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
        >
          <div className="glass-panel relative flex w-full max-w-md flex-col rounded-3xl border border-rose-500/50 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-rose-500/20 pb-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <div>
                  <h3 id="delete-ref-title" className="font-cyber text-sm font-bold uppercase tracking-wider text-white">
                    Xác Nhận Xóa Dòng Nguồn
                  </h3>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                    Xóa dữ liệu nguồn Bảng 2
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={isDeletingRef}
                onClick={() => closeDeleteRefModal()}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              <p className="text-slate-300">
                Bạn có chắc chắn muốn xóa dòng nguồn này? Dữ liệu sẽ bị loại khỏi hệ thống và Bảng 1 sẽ đối chiếu lại ngay.
              </p>
              <div className="space-y-1.5 rounded-2xl border border-white/10 bg-black/60 p-3.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Mã hàng:</span>
                  <span className="font-bold text-slate-200">{deletingRefRow.stock_code}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tag ID:</span>
                  <span className="font-bold text-cyan-300">{deletingRefRow.batch_id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Kho / Bin:</span>
                  <span className="font-bold text-emerald-300">{deletingRefRow.warehouse} / {deletingRefRow.bin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Số lượng:</span>
                  <span className="font-bold text-white">{deletingRefRow.qty}</span>
                </div>
              </div>
              {deleteRefNotice && (
                <p role="alert" className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-2.5 text-xs text-rose-200">
                  {deleteRefNotice}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                disabled={isDeletingRef}
                onClick={() => closeDeleteRefModal()}
                className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700 transition"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={isDeletingRef}
                onClick={() => void handleConfirmDeleteRef()}
                className="rounded-xl bg-gradient-to-r from-rose-600 via-red-600 to-rose-700 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-rose-900/50 hover:opacity-90 active:scale-95 transition disabled:opacity-50"
              >
                {isDeletingRef ? 'Đang xóa...' : '🗑️ Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
