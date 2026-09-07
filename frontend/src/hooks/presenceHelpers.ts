// presenceHelpers — logic thuần cho hiện diện realtime (khóa dòng Bảng 1/2).
// Tách riêng khỏi Supabase channel để test được mà không cần mock realtime.
// Quy ước khóa dòng:
//   - Bảng 1 (scanned_data): key = `t1:<id>` (uuid từng lượt quét — chính xác
//     cả khi 1 batch_id bị quét trùng nhiều dòng).
//   - Bảng 2 (reference_stock): key = `t2:<batch_id.trim()>` (PK nguồn).
// Chặn mềm ở frontend (disable nút + badge) kết hợp khóa cứng sẵn có ở DB
// (pg_advisory_xact_lock trong RPC scan_submit/resolve — Plan §5,
// concurrency_strategy=db_row_lock_rpc). Không thêm bảng lock/queue mới.

export type PresenceTable = 'table1' | 'table2';

export interface PresenceEditing {
  table: PresenceTable;
  /** Khóa dòng: `t1:<id>` hoặc `t2:<batch>` */
  key: string;
  /** Tag ID hiển thị (để badge ghi rõ đang sửa Tag nào) */
  batchId: string;
  label?: string;
}

export interface PresenceIdentity {
  sessionId: string;
  name: string;
  color: string;
}

export interface PresencePeer extends PresenceIdentity {
  viewing: PresenceTable | null;
  editing: PresenceEditing | null;
  updatedAt: number;
}

/** TTL coi 1 presence là hết hạn (mất heartbeat / đóng tab mà server chưa kick). */
export const PRESENCE_STALE_MS = 90_000;

/** Topic channel dùng chung cho mọi client (phải giống nhau mới thấy nhau). */
export const PRESENCE_TOPIC = 'presence:reconciliation:v1';

export function table1RowKey(id: string): string {
  return `t1:${id}`;
}

export function table2RowKey(batchId: string): string {
  return `t2:${(batchId || '').trim()}`;
}

/** Màu avatar ổn định theo tên (HSL) — cùng tên luôn cùng màu mọi máy. */
export function colorForName(name: string): string {
  const clean = (name || '').trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < clean.length; i++) {
    h = (h * 31 + clean.charCodeAt(i)) % 360;
  }
  return `hsl(${h}, 75%, 55%)`;
}

/** Chữ cái đầu avatar (hỗ trợ Unicode tiếng Việt). */
export function initialForName(name: string): string {
  const clean = (name || '').trim();
  if (!clean) return '?';
  return Array.from(clean)[0]?.toUpperCase() ?? '?';
}

export function isStale(peer: Pick<PresencePeer, 'updatedAt'>, now = Date.now()): boolean {
  return now - peer.updatedAt > PRESENCE_STALE_MS;
}

/**
 * Gom presenceState() thô của Supabase thành danh sách peer phẳng.
 * Supabase trả `{ [key]: PresencePayload[] }` — mỗi key có thể có nhiều
 * presence (nhiều tab cùng session). Lấy bản mới nhất mỗi key, bỏ chính mình,
 * bỏ bản stale.
 */
export function parsePresenceState(
  state: Record<string, unknown>,
  selfSessionId: string,
  now = Date.now(),
): PresencePeer[] {
  const out: PresencePeer[] = [];
  for (const presences of Object.values(state)) {
    const list = Array.isArray(presences) ? presences : [presences];
    for (const p of list) {
      const peer = p as Partial<PresencePeer> & { session_id?: string; sessionId?: string };
      const sessionId = peer.sessionId ?? peer.session_id ?? '';
      if (!sessionId || sessionId === selfSessionId) continue;
      if (!peer.name) continue;
      const candidate: PresencePeer = {
        sessionId,
        name: String(peer.name).slice(0, 20),
        color: typeof peer.color === 'string' ? peer.color : colorForName(String(peer.name)),
        viewing: peer.viewing === 'table1' || peer.viewing === 'table2' ? peer.viewing : null,
        editing:
          peer.editing && typeof peer.editing.key === 'string'
            ? {
                table: peer.editing.table === 'table2' ? 'table2' : 'table1',
                key: peer.editing.key,
                batchId: String(peer.editing.batchId ?? ''),
                label: typeof peer.editing.label === 'string' ? peer.editing.label : undefined,
              }
            : null,
        updatedAt: typeof peer.updatedAt === 'number' ? peer.updatedAt : now,
      };
      if (isStale(candidate, now)) continue;
      out.push(candidate);
    }
  }
  // Mỗi session chỉ giữ bản mới nhất (nhiều tab cùng tên).
  const latest = new Map<string, PresencePeer>();
  for (const peer of out) {
    const cur = latest.get(peer.sessionId);
    if (!cur || peer.updatedAt > cur.updatedAt) latest.set(peer.sessionId, peer);
  }
  return [...latest.values()];
}

/** Tìm người đang khóa dòng (table+key), bỏ qua bản stale. */
export function findLockHolder(
  peers: PresencePeer[],
  table: PresenceTable,
  key: string,
  now = Date.now(),
): PresencePeer | null {
  let best: PresencePeer | null = null;
  for (const peer of peers) {
    if (isStale(peer, now)) continue;
    if (!peer.editing || peer.editing.table !== table || peer.editing.key !== key) continue;
    if (!best || peer.updatedAt > best.updatedAt) best = peer;
  }
  return best;
}

/** Ai đang xem bảng nào (để hiện avatar ở header Bảng 1/2 kiểu Excel). */
export function viewersOf(peers: PresencePeer[], table: PresenceTable, now = Date.now()): PresencePeer[] {
  return peers.filter((p) => !isStale(p, now) && (p.viewing === table || p.editing?.table === table));
}

/** Ai đang sửa dòng nào trong 1 bảng (badge tổng ở header). */
export function editorsOf(peers: PresencePeer[], table: PresenceTable, now = Date.now()): PresencePeer[] {
  return peers.filter((p) => !isStale(p, now) && p.editing?.table === table);
}
