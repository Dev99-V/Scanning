// OnlineUsersStrip: avatar từng người riêng lẻ + animation trượt + tự co khi đông.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresencePeer } from '../../hooks/presenceHelpers';
import OnlineUsersStrip, { LEAVE_ANIM_MS } from '../OnlineUsersStrip';

function peer(id: string, name: string): PresencePeer {
  return {
    sessionId: id,
    name,
    color: 'hsl(200, 75%, 55%)',
    viewing: 'table1',
    editing: null,
    updatedAt: Date.now(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OnlineUsersStrip', () => {
  it('hiển thị từng người riêng lẻ, không gộp Online (N)', () => {
    render(
      <OnlineUsersStrip peers={[peer('s1', 'Anh A'), peer('s2', 'Chị B')]} onlineCount={3} onOpenList={() => {}} />,
    );
    expect(screen.getByText('Anh A')).toBeInTheDocument();
    expect(screen.getByText('Chị B')).toBeInTheDocument();
    expect(screen.queryByText(/Online \(/)).not.toBeInTheDocument();
  });

  it('chip mới vào có animation trượt từ trái sang', () => {
    render(<OnlineUsersStrip peers={[peer('s1', 'Anh A')]} onlineCount={2} onOpenList={() => {}} />);
    const animated = document.querySelector('.animate-online-in');
    expect(animated).not.toBeNull();
    expect(animated?.textContent).toContain('Anh A');
  });

  it('người thoát: chạy animation trượt sang phải rồi mới biến mất', () => {
    const { rerender } = render(
      <OnlineUsersStrip
        peers={[peer('s1', 'Anh A'), peer('s2', 'Chị B')]}
        onlineCount={3}
        onOpenList={() => {}}
      />,
    );
    rerender(
      <OnlineUsersStrip peers={[peer('s1', 'Anh A')]} onlineCount={2} onOpenList={() => {}} />,
    );

    // Chị B vẫn render 1 nhịp với animation thoát.
    expect(screen.getByText('Chị B')).toBeInTheDocument();
    const leaving = document.querySelector('.animate-online-out');
    expect(leaving).not.toBeNull();
    expect(leaving?.textContent).toContain('Chị B');

    act(() => {
      vi.advanceTimersByTime(LEAVE_ANIM_MS + 50);
    });
    expect(screen.queryByText('Chị B')).not.toBeInTheDocument();
    expect(screen.getByText('Anh A')).toBeInTheDocument();
  });

  it('đông người: co thành mini avatar + badge +N, khung không tràn layout', () => {
    const many = Array.from({ length: 12 }, (_, i) => peer(`s${i}`, `User ${i}`));
    render(<OnlineUsersStrip peers={many} onlineCount={13} onOpenList={() => {}} />);
    expect(screen.getByText('+3')).toBeInTheDocument();
    // Mini: chỉ avatar chữ cái, không còn tên đầy đủ.
    expect(screen.queryByText('User 0')).toBeNull();
    // Khung strip khóa tràn để không đẩy text header khác.
    expect(screen.getByTestId('online-strip').className).toMatch(/overflow-hidden/);
  });

  it('click strip mở danh sách chi tiết', () => {
    const onOpenList = vi.fn();
    render(<OnlineUsersStrip peers={[peer('s1', 'Anh A')]} onlineCount={2} onOpenList={onOpenList} />);
    fireEvent.click(screen.getByTestId('online-strip'));
    expect(onOpenList).toHaveBeenCalledTimes(1);
  });

  it('một mình: hiện gợi ý thay vì dải trống', () => {
    render(<OnlineUsersStrip peers={[]} onlineCount={1} onOpenList={() => {}} />);
    expect(screen.getByText(/Chỉ mình bạn online/i)).toBeInTheDocument();
  });
});
