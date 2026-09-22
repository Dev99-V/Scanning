// useReferenceMap — tra cứu hệ thống theo batch_id cho bảng đối chiếu.
// Chỉ lấy qty/bin hệ thống để so sánh cạnh số liệu quét; KHÔNG liệt kê Tag ID
// nguồn (Plan.md §4.4: không hiển thị lại Tag ID nguồn trên UI đối chiếu).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { resilientSubscribe } from '../lib/realtime';
import type { ReferenceRow } from '../lib/types';

export interface SystemNumbers {
  stock_code?: string;
  qty: number;
  bin: string;
  tag_7055?: boolean;
}

export function useReferenceMap() {
  const [byBatch, setByBatch] = useState<Map<string, SystemNumbers>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const map = new Map<string, SystemNumbers>();
      const step = 1000;
      let from = 0;
      while (true) {
        // Sort ỔN ĐỊNH theo PK: trước đây không có ORDER BY nào nên thứ tự trang
        // hoàn toàn tùy ý -> trùng/thiếu dòng khi bảng > 1000 dòng (lỗi Bảng 2
        // stock 3428460401: trùng 1 tag + thiếu 1 tag, im lặng).
        const { data, error } = await supabase
          .from('reference_stock')
          .select('batch_id,stock_code,bin,qty,tag_7055')
          .order('batch_id', { ascending: true })
          .range(from, from + step - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data as ReferenceRow[]) {
          if (!r?.batch_id) continue;
          // Trim BIN như import đã TRIM (Plan.md §1): giữ map tra cứu đồng nhất
          // với RPC btrim, tránh "25 " vs "25" báo đỏ giả ở Bảng 1.
          map.set(r.batch_id.trim(), {
            stock_code: r.stock_code,
            qty: r.qty,
            bin: (r.bin ?? '').trim(),
            tag_7055: Boolean(r.tag_7055),
          });
        }
        if (data.length < step) break;
        from += step;
      }
      setByBatch(map);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateBatchQty = useCallback((batchId: string, newQty: number) => {
    const cleanId = (batchId || '').trim();
    setByBatch((prev) => {
      const next = new Map(prev);
      const cur = next.get(cleanId);
      if (cur) {
        next.set(cleanId, { ...cur, qty: newQty });
      }
      return next;
    });
  }, []);

  const updateBatchBin = useCallback((batchId: string, newBin: string) => {
    const cleanId = (batchId || '').trim();
    const cleanBin = (newBin || '').trim();
    setByBatch((prev) => {
      const next = new Map(prev);
      const cur = next.get(cleanId);
      if (cur) {
        next.set(cleanId, { ...cur, bin: cleanBin });
      }
      return next;
    });
  }, []);

  const addBatch = useCallback((batchId: string, item: SystemNumbers) => {
    const cleanId = (batchId || '').trim();
    setByBatch((prev) => {
      const next = new Map(prev);
      next.set(cleanId, item);
      return next;
    });
  }, []);

  const removeBatch = useCallback((batchId: string) => {
    const cleanId = (batchId || '').trim();
    setByBatch((prev) => {
      if (!prev.has(cleanId)) return prev;
      const next = new Map(prev);
      next.delete(cleanId);
      return next;
    });
  }, []);

  // Công tắc 7055: bật/tắt nhãn Tag in thêm ở Bảng 1 hoặc Bảng 2 đều cập nhật
  // cùng 1 map này nên cả 2 bảng + badge đồng bộ tức thì (realtime lo máy khác).
  const updateBatch7055 = useCallback((batchId: string, value: boolean) => {
    const cleanId = (batchId || '').trim();
    setByBatch((prev) => {
      const cur = prev.get(cleanId);
      if (!cur || cur.tag_7055 === value) return prev;
      const next = new Map(prev);
      next.set(cleanId, { ...cur, tag_7055: value });
      return next;
    });
  }, []);

  useEffect(() => {
    void load();

    // Streaming đa người: Bảng 2 phải tự cập nhật khi máy khác sửa SL/Bin,
    // thêm dòng nguồn hoặc import file mới — trước đây hook chỉ load 1 lần
    // lúc mount nên các máy khác im lặng tới khi F5.
    // (Cần kèm migration đưa reference_stock vào publication supabase_realtime.)
    // resilientSubscribe: tự nối lại + refetch bù khi socket rớt.
    const channelTopic = `reference_stock_changes_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const onPayload = (payload: { eventType: string; new?: unknown; old?: unknown }) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        const incoming = payload.new as ReferenceRow & { tag_7055?: boolean };
        const cleanId = (incoming?.batch_id || '').trim();
        if (!cleanId) return;
        setByBatch((prev) => {
          const next = new Map(prev);
          next.set(cleanId, {
            stock_code: incoming.stock_code,
            qty: incoming.qty,
            bin: (incoming.bin ?? '').trim(),
            tag_7055: Boolean(incoming.tag_7055),
          });
          return next;
        });
      } else if (payload.eventType === 'DELETE') {
        const gone = payload.old as { batch_id?: string };
        const cleanId = (gone?.batch_id || '').trim();
        if (!cleanId) return;
        setByBatch((prev) => {
          if (!prev.has(cleanId)) return prev;
          const next = new Map(prev);
          next.delete(cleanId);
          return next;
        });
      }
    };
    const cleanup = resilientSubscribe({
      id: 'reference_stock_map',
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

    return cleanup;
  }, [load]);

  return { byBatch, loading, refetch: load, updateBatchQty, updateBatchBin, addBatch, removeBatch, updateBatch7055 };
}

