// useScannedData — đọc scanned_data trực tiếp qua Supabase Realtime (Skills B).
// Không cache bản sao cũ, không localStorage: state chỉ là ảnh trực tiếp của
// subscription postgres_changes (INSERT/UPDATE/DELETE) + fetch đầu kỳ.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ScanRow } from '../lib/types';

export function useScannedData() {
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('scanned_data')
        .select('id,batch_id,qty,bin,status,resolution,is_manual,scanned_at,stock_code')
        .order('scanned_at', { ascending: false })
        .limit(500);

      if (err) {
        setError(err.message);
      } else {
        const unique: ScanRow[] = [];
        const seen = new Set<string>();
        for (const r of (data ?? []) as ScanRow[]) {
          if (r?.id && !seen.has(r.id)) {
            seen.add(r.id);
            unique.push(r);
          }
        }
        setRows(unique);
        setError(null);
      }
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

    // Dùng tên channel riêng biệt kèm timestamp để tránh bị chồng lấn listener khi re-mount
    const channelTopic = `scanned_data_changes_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scanned_data' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const incoming = payload.new as ScanRow;
            if (!incoming?.id) return;
            setRows((prev) => {
              // Chống dup: nếu dòng này đã được nạp qua refetch() hoặc event lặp thì cập nhật thay vì thêm mới
              const existingIdx = prev.findIndex((r) => r.id === incoming.id);
              if (existingIdx !== -1) {
                const next = [...prev];
                next[existingIdx] = incoming;
                return next;
              }
              return [incoming, ...prev];
            });
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as ScanRow;
            if (!updated?.id) return;
            setRows((prev) => {
              const existingIdx = prev.findIndex((r) => r.id === updated.id);
              if (existingIdx !== -1) {
                const next = [...prev];
                next[existingIdx] = updated;
                return next;
              }
              return [updated, ...prev];
            });
          } else if (payload.eventType === 'DELETE') {
            const gone = payload.old as { id: string };
            if (!gone?.id) return;
            setRows((prev) => prev.filter((r) => r.id !== gone.id));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel?.(channel);
    };
  }, [fetchData]);

  return { rows, loading, error, refetch: fetchData };
}
