import { describe, expect, it } from 'vitest';
import { RECENT_CREATE_DATE_THRESHOLD_ISO, isRecentCreateDate } from './recentCreate';

describe('isRecentCreateDate (cảnh báo ngày tạo mới Bảng 2)', () => {
  it('ngưỡng đúng 28/08/2026', () => {
    expect(RECENT_CREATE_DATE_THRESHOLD_ISO).toBe('2026-08-28');
  });

  it('ngày trước ngưỡng không cảnh báo', () => {
    expect(isRecentCreateDate('2026-08-27')).toBe(false);
    expect(isRecentCreateDate('2026-08-27T23:59:59')).toBe(false);
    expect(isRecentCreateDate('2026-01-01')).toBe(false);
  });

  it('đúng ngưỡng và sau ngưỡng đều cảnh báo', () => {
    expect(isRecentCreateDate('2026-08-28')).toBe(true);
    expect(isRecentCreateDate('2026-08-28T00:00:00')).toBe(true);
    expect(isRecentCreateDate('2026-08-29')).toBe(true);
    expect(isRecentCreateDate('2026-09-04')).toBe(true);
    expect(isRecentCreateDate('2026-09-14T08:00:00')).toBe(true);
  });

  it('null/rỗng/sai định dạng không cảnh báo (không crash)', () => {
    expect(isRecentCreateDate(null)).toBe(false);
    expect(isRecentCreateDate(undefined)).toBe(false);
    expect(isRecentCreateDate('')).toBe(false);
    expect(isRecentCreateDate('không-phải-ngày')).toBe(false);
  });
});
