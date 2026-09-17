// useTableJumpKeys — Điều hướng nhanh Bảng 1 ↔ Bảng 2 bằng phím ↑ / ↓.
// - Bấm ↑ (ArrowUp): nhảy tức thì lên Bảng 1 (#bang-1).
// - Bấm ↓ (ArrowDown): nhảy tức thì xuống Bảng 2 (#bang-2, thẳng bảng dữ liệu nguồn).
// An toàn PDA: KHÔNG cướp phím khi đang gõ trong ô nhập (scan/tag/tìm kiếm/modal),
// khi focus ở select/textarea/contentEditable, khi kèm Ctrl/Alt/Meta,
// hoặc khi đang mở modal dialog (sửa/xóa/nhập kho).
import { useEffect } from 'react';
import { smoothScrollToElementById } from '../lib/smoothScroll';

function isTypingContext(target: EventTarget | null): boolean {
  if (target instanceof HTMLElement) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
  }
  // Đang mở modal (sửa/xóa/nhập kho/đặt tên) thì giữ nguyên phím cho modal.
  if (typeof document !== 'undefined' && document.querySelector('[role="dialog"]')) return true;
  return false;
}

export function useTableJumpKeys(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingContext(e.target)) return;
      e.preventDefault();
      smoothScrollToElementById(e.key === 'ArrowUp' ? 'bang-1' : 'bang-2');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
