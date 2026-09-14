/** Ngưỡng cảnh báo ngày tạo mới ở Bảng 2: từ 28/08/2026 đến hiện tại. */
export const RECENT_CREATE_DATE_THRESHOLD_ISO = '2026-08-28';

/**
 * Dòng nguồn có ngày tạo mới cần chú ý hay không (create_date >= 28/08/2026).
 * Chỉ dùng để highlight CHỮ ở ô Ngày tạo — không đổi màu nền dòng để không
 * đè mất highlight nghiệp vụ đã có (khớp/lệch/trùng).
 */
export function isRecentCreateDate(createDate?: string | null): boolean {
  if (!createDate) return false;
  const d = new Date(createDate);
  if (isNaN(d.getTime())) return false;
  const threshold = new Date(`${RECENT_CREATE_DATE_THRESHOLD_ISO}T00:00:00`);
  return d.getTime() >= threshold.getTime();
}
