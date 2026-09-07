// useReferenceMap — tra cứu hệ thống theo batch_id cho bảng đối chiếu.
// Chỉ lấy qty/bin hệ thống để so sánh cạnh số liệu quét; KHÔNG liệt kê Tag ID
// nguồn (Plan.md §4.4: không hiển thị lại Tag ID nguồn trên UI đối chiếu).
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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
        const { data, error } = await supabase
          .from('reference_stock')
          .select('batch_id,stock_code,bin,qty,tag_7055')
          .range(from, from + step - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data as ReferenceRow[]) {
          if (!r?.batch_id) continue;
          map.set(r.batch_id.trim(), {
            stock_code: r.stock_code,
            qty: r.qty,
            bin: r.bin,
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
    setByBatch((prev) => {
      const next = new Map(prev);
      const cur = next.get(cleanId);
      if (cur) {
        next.set(cleanId, { ...cur, bin: newBin });
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

  useEffect(() => {
    void load();
  }, [load]);

  return { byBatch, loading, refetch: load, updateBatchQty, updateBatchBin, addBatch };
}

