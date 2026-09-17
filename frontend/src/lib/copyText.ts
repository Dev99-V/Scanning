// copyText — Sao chép nhanh 1 giá trị ô trong Bảng 1 (TAG ID / SL quét / Bin quét).
// Ưu tiên Clipboard API hiện đại; fallback textarea + execCommand cho WebView PDA cũ
// hoặc ngữ cảnh không phải secure-context.
export async function copyText(text: string): Promise<boolean> {
  const value = text ?? '';
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Rơi xuống fallback bên dưới.
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
