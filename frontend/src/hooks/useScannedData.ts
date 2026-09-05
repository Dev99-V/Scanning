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
        setRows((data ?? []) as ScanRow[]);
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

    // Tự động tải lại dữ liệu khi người dùng đăng nhập / đăng xuất (RLS state thay đổi)
    const authSub = supabase.auth?.onAuthStateChange?.(() => {
      void fetchData();
    });

    const channel = supabase
      .channel('scanned_data_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'scanned_data' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setRows((prev) => [payload.new as ScanRow, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as ScanRow;
            setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          } else if (payload.eventType === 'DELETE') {
            const gone = payload.old as { id: string };
            setRows((prev) => prev.filter((r) => r.id !== gone.id));
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      authSub?.data?.subscription?.unsubscribe?.();
      if (channel) void supabase.removeChannel?.(channel);
    };
  }, [fetchData]);

  return { rows, loading, error, refetch: fetchData };
}
