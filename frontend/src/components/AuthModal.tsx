// AuthModal — Giao diện đăng nhập / đăng ký tài khoản Supabase Auth (Skills B/C).
// Cần thiết để giải quyết phân quyền RLS: chỉ người dùng authenticated mới có quyền
// truy vấn Bảng 1 (scanned_data) và Bảng 2 (reference_stock) theo Plan.md §3 + §10.
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess?: () => void;
}

export default function AuthModal({ isOpen, onClose, onAuthSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMessage('Vui lòng điền đầy đủ email và mật khẩu.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });

        if (error) {
          if (error.message.includes('Invalid login credentials')) {
            setErrorMessage('Sai email hoặc mật khẩu. Vui lòng kiểm tra lại.');
          } else if (error.message.includes('Email not confirmed')) {
            setErrorMessage('Email chưa được xác thực. Vui lòng kiểm tra hộp thư hoặc kích hoạt user trong Supabase Dashboard.');
          } else {
            setErrorMessage(error.message);
          }
          return;
        }

        setSuccessMessage('✅ Đăng nhập thành công! Đang đồng bộ dữ liệu...');
        setTimeout(() => {
          onAuthSuccess?.();
          onClose();
        }, 600);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (error) {
          setErrorMessage(error.message);
          return;
        }

        if (data.session) {
          setSuccessMessage('✅ Đăng ký và đăng nhập thành công!');
          setTimeout(() => {
            onAuthSuccess?.();
            onClose();
          }, 600);
        } else {
          setSuccessMessage(
            '✅ Tạo tài khoản thành công! Nếu hệ thống yêu cầu xác thực email, vui lòng kiểm tra hòm thư hoặc xác nhận user trong Dashboard.'
          );
          setMode('signin');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Lỗi kết nối: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
    >
      <div className="relative w-full max-w-md rounded-3xl border border-indigo-500/40 bg-slate-950 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔐</span>
            <div>
              <h2 id="auth-modal-title" className="font-cyber text-base font-bold tracking-wider text-white">
                {mode === 'signin' ? 'ĐĂNG NHẬP HỆ THỐNG' : 'ĐĂNG KÝ TÀI KHOẢN'}
              </h2>
              <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">
                Xác thực tài khoản người dùng
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng modal"
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-xs font-bold text-slate-400 hover:bg-rose-900/60 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Tab switch */}
        <div className="my-4 flex rounded-xl bg-slate-900/90 p-1 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setMode('signin');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
              mode === 'signin'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 rounded-lg py-2 text-xs font-bold transition ${
              mode === 'signup'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Tạo tài khoản mới
          </button>
        </div>

        <p className="text-[11px] text-slate-400 mb-4 bg-slate-900/50 p-2.5 rounded-xl border border-white/5">
          💡 <strong>Chính sách bảo mật RLS:</strong> Để xem dữ liệu Bảng 1 (dữ liệu quét) và Bảng 2 (tồn kho nguồn), bạn cần đăng nhập tài khoản người dùng đã tạo trong hệ thống.
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
              Email đăng nhập:
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-300 mb-1">
              Mật khẩu:
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-xs text-cyan-300 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
            />
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/60 p-3 text-xs text-rose-200">
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/60 p-3 text-xs text-emerald-200">
              {successMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 py-3 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-indigo-500/30 transition hover:opacity-95 active:scale-95 disabled:opacity-50"
          >
            {loading ? 'Đang xử lý...' : mode === 'signin' ? '🔐 ĐĂNG NHẬP NGAY' : '✨ TẠO TÀI KHOẢN'}
          </button>
        </form>
      </div>
    </div>
  );
}
