import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { easeInOutCubic, smoothScrollToElementById } from './smoothScroll';

describe('smoothScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('easeInOutCubic đúng biên 0/0.5/1', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 5);
  });

  it('gọi rAF + scrollTo tới phần tử #bang-2', () => {
    const el = document.createElement('div');
    el.id = 'bang-2-test';
    document.body.appendChild(el);
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 500, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 500, toJSON: () => ({}),
    });
    const rafSpy = vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now() + 700);
      return 1;
    });
    Object.defineProperty(window, 'requestAnimationFrame', {
      value: rafSpy, configurable: true, writable: true,
    });
    const scrollSpy = vi.fn();
    Object.defineProperty(window, 'scrollTo', {
      value: scrollSpy, configurable: true, writable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockReturnValue({ matches: false }),
      configurable: true, writable: true,
    });

    smoothScrollToElementById('bang-2-test', 600);

    expect(rafSpy).toHaveBeenCalled();
    expect(scrollSpy).toHaveBeenCalled();
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
