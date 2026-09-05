import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthModal from '../AuthModal';

const signInWithPassword = vi.fn();
const signUp = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signUp: (...args: unknown[]) => signUp(...args),
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AuthModal', () => {
  it('không render khi isOpen = false', () => {
    const { container } = render(<AuthModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('render giao diện đăng nhập khi isOpen = true', () => {
    render(<AuthModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(/ĐĂNG NHẬP HỆ THỐNG/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/user@example.com/i)).toBeInTheDocument();
  });

  it('gọi signInWithPassword khi submit form đăng nhập', async () => {
    signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    const onAuthSuccess = vi.fn();
    const onClose = vi.fn();

    render(<AuthModal isOpen={true} onClose={onClose} onAuthSuccess={onAuthSuccess} />);

    fireEvent.change(screen.getByPlaceholderText(/user@example.com/i), {
      target: { value: 'test@domain.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/••••••••/i), {
      target: { value: 'mypassword123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /ĐĂNG NHẬP NGAY/i }));

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'test@domain.com',
        password: 'mypassword123',
      });
    });
  });

  it('chuyển sang chế độ đăng ký khi bấm tab Tạo tài khoản mới', async () => {
    render(<AuthModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Tạo tài khoản mới/i }));

    expect(screen.getByText(/ĐĂNG KÝ TÀI KHOẢN/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /✨ TẠO TÀI KHOẢN/i })).toBeInTheDocument();
  });
});
