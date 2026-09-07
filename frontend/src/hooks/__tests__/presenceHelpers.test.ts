import { describe, expect, it } from 'vitest';
import {
  PRESENCE_STALE_MS,
  colorForName,
  editorsOf,
  findLockHolder,
  initialForName,
  isStale,
  parsePresenceState,
  table1RowKey,
  table2RowKey,
  viewersOf,
  type PresencePeer,
} from '../presenceHelpers';

function peer(partial: Partial<PresencePeer> & { sessionId: string }): PresencePeer {
  return {
    name: 'Anh A',
    color: '#fff',
    viewing: null,
    editing: null,
    updatedAt: Date.now(),
    ...partial,
  };
}

describe('presenceHelpers', () => {
  it('key khóa dòng đúng quy ước t1:<id> / t2:<batch>', () => {
    expect(table1RowKey('uuid-1')).toBe('t1:uuid-1');
    expect(table2RowKey('  ABC123  ')).toBe('t2:ABC123');
  });

  it('màu avatar ổn định theo tên, chữ cái đầu hỗ trợ Unicode', () => {
    expect(colorForName('Anh A')).toBe(colorForName('  anh a '));
    expect(colorForName('Anh A')).not.toBe(colorForName('Anh B'));
    expect(initialForName('Anh A')).toBe('A');
    expect(initialForName(' ễnh ương ')).toBe('Ễ');
    expect(initialForName('')).toBe('?');
  });

  it('stale sau 90s không heartbeat', () => {
    const now = Date.now();
    expect(isStale(peer({ sessionId: 's1', updatedAt: now }), now)).toBe(false);
    expect(isStale(peer({ sessionId: 's1', updatedAt: now - PRESENCE_STALE_MS - 1 }), now)).toBe(true);
  });

  it('parsePresenceState bỏ chính mình, bỏ stale, giữ bản mới nhất mỗi session', () => {
    const now = Date.now();
    const state = {
      s1: [{ sessionId: 's1', name: 'Tôi', updatedAt: now }],
      s2: [
        { sessionId: 's2', name: 'Anh A', viewing: 'table1', updatedAt: now - 1000 },
        { sessionId: 's2', name: 'Anh A', viewing: 'table2', updatedAt: now },
      ],
      s3: [{ sessionId: 's3', name: 'Anh B', updatedAt: now - PRESENCE_STALE_MS - 5000 }],
    };
    const peers = parsePresenceState(state, 's1', now);
    expect(peers).toHaveLength(1);
    expect(peers[0].sessionId).toBe('s2');
    expect(peers[0].viewing).toBe('table2');
  });

  it('findLockHolder chỉ khớp đúng bảng + key và bỏ stale', () => {
    const now = Date.now();
    const holder = peer({
      sessionId: 's2',
      name: 'Anh A',
      editing: { table: 'table1', key: 't1:r1', batchId: 'B1' },
      updatedAt: now,
    });
    const stale = peer({
      sessionId: 's3',
      name: 'Anh B',
      editing: { table: 'table1', key: 't1:r1', batchId: 'B1' },
      updatedAt: now - PRESENCE_STALE_MS - 1,
    });
    expect(findLockHolder([holder, stale], 'table1', 't1:r1', now)?.name).toBe('Anh A');
    expect(findLockHolder([holder], 'table1', 't1:khac', now)).toBeNull();
    expect(findLockHolder([holder], 'table2', 't1:r1', now)).toBeNull();
    expect(findLockHolder([stale], 'table1', 't1:r1', now)).toBeNull();
  });

  it('viewersOf/editorsOf lọc đúng bảng (đang sửa cũng tính là đang xem)', () => {
    const now = Date.now();
    const peers = [
      peer({ sessionId: 's2', name: 'A', viewing: 'table1', updatedAt: now }),
      peer({
        sessionId: 's3',
        name: 'B',
        viewing: null,
        editing: { table: 'table2', key: 't2:X', batchId: 'X' },
        updatedAt: now,
      }),
    ];
    expect(viewersOf(peers, 'table1', now).map((p) => p.name)).toEqual(['A']);
    expect(viewersOf(peers, 'table2', now).map((p) => p.name)).toEqual(['B']);
    expect(editorsOf(peers, 'table2', now).map((p) => p.name)).toEqual(['B']);
    expect(editorsOf(peers, 'table1', now)).toEqual([]);
  });
});
