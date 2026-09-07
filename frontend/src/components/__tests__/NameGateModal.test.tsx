import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NameGateModal from '../NameGateModal';

describe('NameGateModal', () => {
  it('không render khi đã có tên', () => {
    const { container } = render(<NameGateModal open={false} onSubmit={() => null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('báo lỗi khi tên trống / quá ngắn', () => {
    render(<NameGateModal open onSubmit={() => null} />);
    fireEvent.click(screen.getByText('Vào hệ thống →'));
    expect(screen.getByRole('alert')).toHaveTextContent('Vui lòng nhập tên');

    fireEvent.change(screen.getByLabelText(/Tên hiển thị/), { target: { value: 'A' } });
    fireEvent.click(screen.getByText('Vào hệ thống →'));
    expect(screen.getByRole('alert')).toHaveTextContent('ít nhất 2 ký tự');
  });

  it('gọi onSubmit với tên đã trim khi hợp lệ', () => {
    const onSubmit = vi.fn().mockReturnValue(null);
    render(<NameGateModal open onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Tên hiển thị/), { target: { value: '  Anh A  ' } });
    fireEvent.click(screen.getByText('Vào hệ thống →'));
    expect(onSubmit).toHaveBeenCalledWith('Anh A');
  });

  it('hiển thị lỗi từ onSubmit (trùng tên chẳng hạn)', () => {
    render(<NameGateModal open onSubmit={() => 'Tên đã có người dùng.'} />);
    fireEvent.change(screen.getByLabelText(/Tên hiển thị/), { target: { value: 'Anh A' } });
    fireEvent.click(screen.getByText('Vào hệ thống →'));
    expect(screen.getByRole('alert')).toHaveTextContent('Tên đã có người dùng.');
  });
});
