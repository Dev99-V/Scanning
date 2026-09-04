import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DuplicateAlertToast from '../DuplicateAlertToast';

const conflict = {
  existingId: 'e1',
  computedStatus: 'ok' as const,
  attempted: { batchId: 'B1', qty: 2, bin: 'C4' },
};

describe('DuplicateAlertToast', () => {
  it('2 nút Ghi thêm / Đổi vị trí gọi onResolve đúng action', () => {
    const onResolve = vi.fn();
    render(<DuplicateAlertToast conflict={conflict} busy={false} onResolve={onResolve} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ghi thêm' }));
    expect(onResolve).toHaveBeenCalledWith('append');
    fireEvent.click(screen.getByRole('button', { name: 'Đổi vị trí' }));
    expect(onResolve).toHaveBeenCalledWith('relocate');
  });

  it('nút Để sau gọi onDismiss; busy thì disable 2 nút', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <DuplicateAlertToast conflict={conflict} busy={false} onResolve={() => {}} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Để sau' }));
    expect(onDismiss).toHaveBeenCalled();
    rerender(<DuplicateAlertToast conflict={conflict} busy={true} onResolve={() => {}} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ghi thêm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đổi vị trí' })).toBeDisabled();
  });
});
