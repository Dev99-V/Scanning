// smoothScroll — Trượt mượt 60fps tới anchor Bảng 1 / Bảng 2.
// Dùng requestAnimationFrame (đồng bộ vsync 60fps) + easing easeInOutCubic.
// Tôn trọng prefers-reduced-motion: nhảy tức thì cho người dùng cần giảm chuyển động.
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function smoothScrollToElementById(targetId: string, durationMs = 650): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const el = document.getElementById(targetId);
  if (!el) return;

  const reduceMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) {
    el.scrollIntoView();
    return;
  }

  const raf =
    typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);

  const startY =
    typeof window.scrollY === 'number'
      ? window.scrollY
      : document.documentElement?.scrollTop ?? 0;
  const targetY = el.getBoundingClientRect().top + startY - 12;
  const distance = targetY - startY;
  if (Math.abs(distance) < 2) return;

  // Thời gian tỉ lệ theo quãng đường để tốc độ đều, kẹp 350–800ms.
  const duration = Math.min(800, Math.max(350, durationMs));
  const startTime = performance.now();

  function step(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeInOutCubic(progress);
    window.scrollTo(0, startY + distance * eased);
    if (progress < 1) raf(step);
  }
  raf(step);
}
