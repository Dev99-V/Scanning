// useAuditLog — đọc scan_audit_log mới nhất + streaming realtime cho thẻ log.
// Hiển thị tối đa LATEST_LIMIT dòng mới nhất; realtime prepend có khử trùng id
// và cắt trần CLIENT_CAP để state không phình khi bảng log lớn dần.
import { useCallback, useEffect, useState } from 'react';
import type { AuditEntry } from '../lib/auditLog';
import { supabase } from '../lib/supabase';

export const AUDIT_LATEST_LIMIT = 300;
const CLIENT_CAP = 500;

const COLUMNS = 'id,scanned_id,action,old_value,new_value,actor,actor_name,created_at';

export function useAuditLog() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('scan_audit_log')
        .select(COLUMNS)
        .order('id', { ascending: false })
        .range(0, AUDIT_LATEST_LIMIT - 1);
      if (err) {
        setError(err.message);
        return;
      }
      setEntries((data as AuditEntry[]) ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await fetchData();
    })();

    const channelTopic = `audit_log_changes_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const channel = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'scan_audit_log' },
        (payload) => {
          if (cancelled) return;
          const incoming = payload.new as AuditEntry;
          if (!incoming?.id) return;
          setEntries((prev) => {
            if (prev.some((e) => e.id === incoming.id)) return prev;
            return [incoming, ...prev].slice(0, CLIENT_CAP);
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel?.(channel);
    };
  }, [fetchData]);

  return { entries, loading, error, refetch: fetchData };
}
