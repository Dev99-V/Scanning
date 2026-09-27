// pagedFetch — tải full 1 bảng qua PostgREST `.range()` theo SÓNG SONG SONG
// (wave) thay vì từng trang nối tiếp (user báo reload chờ lâu 2026-09-27).
// Mỗi reload tải full scanned_data / reference_stock (×2) / inventory_counts,
// mỗi bảng 3–8 round-trip nối tiếp trên wifi kho trễ cao → cộng dồn thành chờ lâu.
// Sóng 4 song song cắt số lượt chờ nối tiếp còn ~1/4 mà vẫn:
// - Giữ NGUYÊN thứ tự trang (ghép theo chỉ số trang, không theo thứ tự resolve)
//   nên tương đương vòng lặp cũ từng dòng.
// - Giữ ORDER BY ổn định ở caller (PK tie-breaker) + khử trùng PK ở caller
//   (bài học OFFSET 2026-09-09) — helper không tự ý bỏ dòng.
// - Tương thích mock test cũ: chỉ gọi đúng API `.range(from, to)` đã có.
// - Không cache localStorage (hiến pháp: dữ liệu nghiệp vụ luôn tươi + realtime).
export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

export interface PagedFetchResult<T> {
  items: T[];
  error: string | null;
}

const DEFAULT_STEP = 1000;
const DEFAULT_WAVE_SIZE = 4;
/** Trần an toàn: tránh vòng vô hạn nếu server cứ trả trang đầy mãi. */
const MAX_WAVES = 100;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<PageResult<T>>,
  step = DEFAULT_STEP,
  waveSize = DEFAULT_WAVE_SIZE,
): Promise<PagedFetchResult<T>> {
  const items: T[] = [];
  let base = 0;
  for (let wave = 0; wave < MAX_WAVES; wave++) {
    const offsets = Array.from({ length: waveSize }, (_, i) => base + i * step);
    const pages = await Promise.all(
      offsets.map(async (from, i) => {
        try {
          const res = await fetchPage(from, from + step - 1);
          return { index: i, data: res?.data ?? [], error: res?.error ?? null };
        } catch (e) {
          return {
            index: i,
            data: [] as T[],
            error: { message: e instanceof Error ? e.message : String(e) },
          };
        }
      }),
    );
    // Ghép theo chỉ số trang (không theo thứ tự resolve) + dừng ở trang
    // ngắn (< step) đầu tiên — các trang sau nó trong sóng là rỗng theo ngữ
    // nghĩa OFFSET (DB ổn định). DB đang ghi đồng thời thì caller đã khử
    // trùng PK + realtime bù event như trước.
    let stop = false;
    for (const p of pages) {
      if (p.error) {
        return { items, error: p.error.message };
      }
      if (!stop) {
        items.push(...p.data);
        if (p.data.length < step) stop = true;
      }
    }
    if (stop) return { items, error: null };
    base += waveSize * step;
  }
  return { items, error: null };
}
