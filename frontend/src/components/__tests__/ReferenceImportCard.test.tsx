// ReferenceImportCard: phần import giữ nguyên + vùng nhúng bottomContent (khối 7055).
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferenceImportCard from '../ReferenceImportCard';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke } } }));

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ data: { ok: true, data: {} }, error: null });
});

describe('ReferenceImportCard', () => {
  it('render tiêu đề import và nút chọn file', () => {
    render(<ReferenceImportCard />);
    expect(screen.getByText(/Tải Nguồn/i)).toBeInTheDocument();
    expect(screen.getByText(/Chọn file Excel nạp vào/i)).toBeInTheDocument();
  });

  it('hiển thị bottomContent (khối 7055) chung bên dưới phần import', () => {
    render(<ReferenceImportCard bottomContent={<p>Khối 7055 nhúng chung</p>} />);
    expect(screen.getByText(/Tải Nguồn/i)).toBeInTheDocument();
    expect(screen.getByText('Khối 7055 nhúng chung')).toBeInTheDocument();
  });
});
