import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useIdentity } from '../useIdentity';

beforeEach(() => {
  sessionStorage.clear();
});

describe('useIdentity', () => {
  it('lưu tên hợp lệ và giữ tên sau khi load lại cùng tab', () => {
    const { result } = renderHook(() => useIdentity());
    expect(result.current.identity).toBeNull();
    let err: string | null = 'unset';
    act(() => {
      err = result.current.saveName('Anh A');
    });
    expect(err).toBeNull();
    expect(result.current.identity?.name).toBe('Anh A');
    const firstSession = result.current.identity?.sessionId;

    // Reload cùng tab (giữ sessionStorage): tên giữ lại nhưng session MỚI
    // để 2 tab duplicate không trùng sessionId rồi tàng hình lẫn nhau.
    const { result: reloaded } = renderHook(() => useIdentity());
    expect(reloaded.current.identity?.name).toBe('Anh A');
    expect(reloaded.current.identity?.sessionId).toBeTruthy();
    expect(reloaded.current.identity?.sessionId).not.toBe(firstSession);
  });

  it('2 tab duplicate (copy sessionStorage) có sessionId khác nhau', () => {
    const { result: tab1 } = renderHook(() => useIdentity());
    act(() => {
      tab1.current.saveName('Anh A');
    });
    // Giả lập duplicate tab: sessionStorage bị copy, JS chạy lại từ đầu.
    const { result: tab2 } = renderHook(() => useIdentity());
    expect(tab2.current.identity?.name).toBe('Anh A');
    expect(tab2.current.identity?.sessionId).not.toBe(tab1.current.identity?.sessionId);
  });
});
