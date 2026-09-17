// scrollJump — Nhảy TỨC THÌ tới bảng (không animation, không delay).
// Theo yêu cầu: bấm là tới thẳng bảng, đủ view, không dừng ở header.
// Dùng window.scrollTo(x, y) dạng 2 đối số để luôn tức thì
// (không bị ảnh hưởng bởi CSS scroll-behavior).
// Giữ nguyên tên hàm/các nơi gọi để không đổi contract nội bộ.
export function smoothScrollToElementById(targetId: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const el = document.getElementById(targetId);
  if (!el) return;

  const startY =
    typeof window.scrollY === 'number'
      ? window.scrollY
      : document.documentElement?.scrollTop ?? 0;
  const targetY = el.getBoundingClientRect().top + startY - 12;
  window.scrollTo(0, targetY);
}
