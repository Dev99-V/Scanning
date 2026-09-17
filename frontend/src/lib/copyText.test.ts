import { describe, expect, it, vi, afterEach } from 'vitest';
import { copyText } from './copyText';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('copyText', () => {
  it('dùng Clipboard API khi có', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const ok = await copyText('100006049868');
    expect(writeText).toHaveBeenCalledWith('100006049868');
    expect(ok).toBe(true);
  });

  it('fallback execCommand khi không có Clipboard API', async () => {
    vi.stubGlobal('navigator', {});
    const execMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: execMock,
      configurable: true,
      writable: true,
    });
    const ok = await copyText('BIN01');
    expect(execMock).toHaveBeenCalledWith('copy');
    expect(ok).toBe(true);
  });
});
