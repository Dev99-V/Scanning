import { render, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableJumpKeys } from '../useTableJumpKeys';

const { jumpMock } = vi.hoisted(() => ({ jumpMock: vi.fn() }));
vi.mock('../../lib/smoothScroll', () => ({ smoothScrollToElementById: jumpMock }));

function press(key: string, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true });
  Object.defineProperty(e, 'target', { value: target });
  window.dispatchEvent(e);
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('useTableJumpKeys — phím ↑/↓ nhảy Bảng 1/Bảng 2', () => {
  it('phím ↑ nhảy lên #bang-1, phím ↓ nhảy xuống #bang-2', () => {
    renderHook(() => useTableJumpKeys(true));
    press('ArrowUp');
    expect(jumpMock).toHaveBeenCalledWith('bang-1');
    press('ArrowDown');
    expect(jumpMock).toHaveBeenCalledWith('bang-2');
  });

  it('không cướp phím khi đang gõ trong ô nhập', () => {
    render(<input aria-label="ô quét" />);
    const input = document.body.querySelector('input') as HTMLInputElement;
    renderHook(() => useTableJumpKeys(true));
    press('ArrowUp', input);
    press('ArrowDown', input);
    expect(jumpMock).not.toHaveBeenCalled();
  });

  it('không cướp phím khi đang mở modal dialog', () => {
    render(<div role="dialog" aria-label="modal sửa" />);
    renderHook(() => useTableJumpKeys(true));
    press('ArrowUp');
    press('ArrowDown');
    expect(jumpMock).not.toHaveBeenCalled();
  });

  it('phím khác và enabled=false thì không nhảy', () => {
    const on = renderHook(() => useTableJumpKeys(true));
    press('Enter');
    press('a');
    expect(jumpMock).not.toHaveBeenCalled();
    on.unmount();
    renderHook(() => useTableJumpKeys(false));
    press('ArrowUp');
    expect(jumpMock).not.toHaveBeenCalled();
  });
});
