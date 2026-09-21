// useInventoryCounts — đọc bảng inventory_counts (Bảng 3 kiểm kê) qua Realtime.
// Không cache bản sao cũ, không localStorage: state là ảnh trực tiếp của
// subscription postgres_changes (INSERT/UPDATE/DELETE) + fetch đầu kỳ.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { resilientSubscribe } from '../lib/realtime';
import type { InventoryRow } from '../lib/types';

export function useInventoryCounts() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const step = 1000;
      let from = 0;
      const all: InventoryRow[] = [];
      while (true) {
        const q = supabase
          .from('inventory_counts')
          .select('id,batch_id,stock_code,qty,bin,is_manual,scanned_at')
          .order('scanned_at', { ascending: false })
          .order('id', { ascending: false });

        const res = await (q.range ? q.range(from, from + step - 1) : (q.limit ? q.limit(step) : q));
        const data = res?.data;
        const err = res?.error;

        if (err) {
          setError(err.message);
          return;
        }
        if (!data || (data as unknown[]).length === 0) break;
        all.push(...(data as InventoryRow[]));
        if ((data as unknown[]).length < step || !q.range) break;
        from += step;
      }

      const unique: InventoryRow[] = [];
      const seen = new Set<string>();
      for (const r of all) {
        if (r?.id && !seen.has(r.id)) {
          seen.add(r.id);
          unique.push(r);
        }
      }
      setRows(unique);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cancelled) await fetchData();
    }
    void load();

    const channelTopic = `inventory_counts_changes_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const onPayload = (payload: { eventType: string; new?: unknown; old?: unknown }) => {
      if (payload.eventType === 'INSERT') {
        const incoming = payload.new as InventoryRow;
        if (!incoming?.id) return;
        setRows((prev) => {
          const idx = prev.findIndex((r) => r.id === incoming.id);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = incoming;
            return next;
          }
          return [incoming, ...prev];
        });
      } else if (payload.eventType === 'UPDATE') {
        const updated = payload.new as InventoryRow;
        if (!updated?.id) return;
        setRows((prev) => {
          const idx = prev.findIndex((r) => r.id === updated.id);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = updated;
            return next;
          }
          return [updated, ...prev];
        });
      } else if (payload.eventType === 'DELETE') {
        const gone = payload.old as { id: string };
        if (!gone?.id) return;
        setRows((prev) => prev.filter((r) => r.id !== gone.id));
      }
    };
    const cleanup = resilientSubscribe({
      id: 'inventory_counts',
      createChannel: () => supabase.channel(channelTopic),
      bindings: [
        {
          type: 'postgres_changes',
          event: '*',
          filter: { event: '*', schema: 'public', table: 'inventory_counts' },
          handler: onPayload as (payload: never) => void,
        },
      ],
      onReconnect: () => {
        void fetchData();
      },
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [fetchData]);

  return { rows, loading, error, refetch: fetchData };
}
