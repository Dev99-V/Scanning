import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest không bật globals nên RTL không tự cleanup sau mỗi test —
// đăng ký tường minh để các render không rò sang test khác.
afterEach(() => cleanup());
