// ConnectionBadge — badge realtime thật theo health gom từ resilientSubscribe.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ConnectionBadge from '../ConnectionBadge';
import { __resetRealtimeHealthForTest, reportChannelStatus } from '../../lib/realtime';

beforeEach(() => {
  __resetRealtimeHealthForTest();
});

describe('ConnectionBadge', () => {
  it('chưa có kênh: hiện Đang kết nối', () => {
    render(<ConnectionBadge />);
    expect(screen.getByTestId('realtime-status')).toHaveTextContent(/Đang kết nối/i);
  });

  it('mọi kênh connected: hiện Realtime', () => {
    reportChannelStatus('a', 'connected');
    render(<ConnectionBadge />);
    expect(screen.getByTestId('realtime-status')).toHaveTextContent(/Realtime/i);
    expect(screen.getByTestId('realtime-status')).toHaveAttribute('data-status', 'connected');
  });

  it('1 kênh rớt: hiện Đang nối lại', () => {
    reportChannelStatus('a', 'connected');
    reportChannelStatus('b', 'reconnecting');
    render(<ConnectionBadge />);
    expect(screen.getByTestId('realtime-status')).toHaveTextContent(/Đang nối lại/i);
    expect(screen.getByTestId('realtime-status')).toHaveAttribute('data-status', 'reconnecting');
  });
});
