import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PresencePeer } from '../../hooks/presenceHelpers';
import PresenceAvatars from '../PresenceAvatars';

const now = Date.now();
function peer(partial: Partial<PresencePeer> & { sessionId: string; name: string }): PresencePeer {
  return {
    color: 'hsl(200, 75%, 55%)',
    viewing: 'table1',
    editing: null,
    updatedAt: now,
    ...partial,
  };
}

describe('PresenceAvatars', () => {
  it('không render khi không có ai', () => {
    const { container } = render(<PresenceAvatars users={[]} tableLabel="Bảng 1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('hiện tên người đang xem + trạng thái đang sửa Tag nào', () => {
    render(
      <PresenceAvatars
        tableLabel="Bảng 1"
        users={[
          peer({ sessionId: 's2', name: 'Anh A', viewing: 'table1' }),
          peer({
            sessionId: 's3',
            name: 'Anh B',
            viewing: 'table1',
            editing: { table: 'table1', key: 't1:r1', batchId: 'TAG001' },
          }),
        ]}
      />,
    );
    expect(screen.getByLabelText('Đang hoạt động ở Bảng 1')).toBeInTheDocument();
    expect(screen.getByText('Anh A')).toBeInTheDocument();
    expect(screen.getByText('Anh B')).toBeInTheDocument();
    expect(screen.getByText(/đang sửa/)).toBeInTheDocument();
    expect(screen.getByText('TAG001')).toBeInTheDocument();
    expect(screen.getByText(/dòng đang bị khóa/)).toBeInTheDocument();
  });
});
