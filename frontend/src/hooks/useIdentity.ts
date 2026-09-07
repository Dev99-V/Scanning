// useIdentity — định danh hiển thị cho Presence (avatar streaming).
// Chỉ lưu TÊN HIỂN THỊ + màu + sessionId ở sessionStorage (state UI, không phải
// dữ liệu nghiệp vụ quét — đúng quy tắc "no localStorage cho dữ liệu quét",
// UI state được phép). Mỗi lần mở tab mới = session mới nhưng giữ tên đã nhập.
import { useCallback, useState } from 'react';
import { colorForName, type PresenceIdentity } from './presenceHelpers';

const NAME_KEY = 'pda.presence.name';
const SESSION_KEY = 'pda.presence.session';

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadIdentity(): PresenceIdentity | null {
  try {
    const rawName = sessionStorage.getItem(NAME_KEY)?.trim() ?? '';
    if (rawName.length < 2 || rawName.length > 20) return null;
    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = newSessionId();
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
    return { sessionId, name: rawName, color: colorForName(rawName) };
  } catch {
    return null;
  }
}

export function validateDisplayName(name: string): string | null {
  const clean = (name || '').trim();
  if (!clean) return 'Vui lòng nhập tên để vào hệ thống.';
  if (Array.from(clean).length < 2) return 'Tên cần ít nhất 2 ký tự.';
  if (Array.from(clean).length > 20) return 'Tên tối đa 20 ký tự.';
  return null;
}

export function useIdentity() {
  const [identity, setIdentity] = useState<PresenceIdentity | null>(() => loadIdentity());

  const saveName = useCallback((name: string): string | null => {
    const err = validateDisplayName(name);
    if (err) return err;
    const clean = name.trim();
    try {
      let sessionId = sessionStorage.getItem(SESSION_KEY);
      if (!sessionId) {
        sessionId = newSessionId();
        sessionStorage.setItem(SESSION_KEY, sessionId);
      }
      sessionStorage.setItem(NAME_KEY, clean);
      setIdentity({ sessionId, name: clean, color: colorForName(clean) });
    } catch {
      setIdentity({ sessionId: newSessionId(), name: clean, color: colorForName(clean) });
    }
    return null;
  }, []);

  const rename = useCallback(() => {
    try {
      sessionStorage.removeItem(NAME_KEY);
    } catch {
      /* bỏ qua */
    }
    setIdentity(null);
  }, []);

  return { identity, saveName, rename };
}
