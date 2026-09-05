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
}

export function useReferenceMap() {
  const [byBatch, setByBatch] = useState<Map<string, SystemNumbers>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from('reference_stock').select('batch_id,stock_code,bin,qty');
      const map = new Map<string, SystemNumbers>();
      for (const r of (data ?? []) as ReferenceRow[]) {
        map.set(r.batch_id, { stock_code: r.stock_code, qty: r.qty, bin: r.bin });
      }
      setByBatch(map);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { byBatch, loading, refetch: load };
}
