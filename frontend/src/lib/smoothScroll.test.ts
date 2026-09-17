import { describe, expect, it, vi, afterEach } from 'vitest';
import { smoothScrollToElementById } from './smoothScroll';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('smoothScroll (nhảy tức thì, không delay)', () => {
  it('gọi đúng 1 lần scrollTo tới vị trí bảng, không dùng rAF', () => {
    const el = document.createElement('div');
    el.id = 'bang-2-test';
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 500, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 500, toJSON: () => ({}),
    });
    const scrollSpy = vi.fn();
    Object.defineProperty(window, 'scrollTo', {
      value: scrollSpy, configurable: true, writable: true,
    });
    const rafSpy = vi.fn();
    Object.defineProperty(window, 'requestAnimationFrame', {
      value: rafSpy, configurable: true, writable: true,
    });

    smoothScrollToElementById('bang-2-test');

    // Nhảy thẳng 1 lần, không animation frames
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(rafSpy).not.toHaveBeenCalled();
    document.body.removeChild(el);
  });

  it('không làm gì khi id không tồn tại', () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(window, 'scrollTo', {
      value: scrollSpy, configurable: true, writable: true,
    });
    smoothScrollToElementById('khong-ton-tai-xyz');
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
