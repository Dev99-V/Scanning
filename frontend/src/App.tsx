// App — Giao diện chính PDA Scan & Đối Chiếu (Layout mới theo yêu cầu 2026-09-04).
// - Thẻ / Nút nổi bật "Quét Tag" mở giao diện nổi (Modal phong cách scantag.html).
// - Bảng 1: Danh sách đã quét & đối chiếu (Stock code, Tag id, SL quét, Bin quét, SL HT, Bin HT, Note/Cảnh báo) + Export.
// - Bảng 2: Dữ liệu nguồn tra cứu + Thẻ import file mẫu Stock Balance With Batch.xlsx.
// - Cả 2 bảng cuộn chuột 100 dòng tự động tải tiếp, tối ưu cho cả Mobile PDA lẫn PC.
import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import AuthModal from './components/AuthModal';
import ExportButton from './components/ExportButton';
import PdaScanModal from './components/PdaScanModal';
import ReconciliationTable from './components/ReconciliationTable';
import ReferenceDataTable from './components/ReferenceDataTable';
import { useReferenceMap } from './hooks/useReferenceMap';
import { useScannedData } from './hooks/useScannedData';
import { supabase } from './lib/supabase';

export default function App() {
  const { rows, refetch } = useScannedData();
  const { byBatch } = useReferenceMap();
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    void supabase.auth?.getSession?.()?.then(({ data }) => {
      setUser(data?.session?.user ?? null);
    });

    const authSub = supabase.auth?.onAuthStateChange?.((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      authSub?.data?.subscription?.unsubscribe?.();
    };
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // Thống kê nhanh trạng thái quét
  const stats = useMemo(() => {
    let ok = 0;
    let mismatch = 0;
    let notInRef = 0;
    let duplicate = 0;
    for (const r of rows) {
      if (r.status === 'ok') ok++;
      else if (r.status === 'qty_mismatch' || r.status === 'bin_mismatch') mismatch++;
      else if (r.status === 'not_in_reference') notInRef++;
      else if (r.status === 'duplicate') duplicate++;
    }
    return { ok, mismatch, notInRef, duplicate, total: rows.length };
  }, [rows]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-3 sm:p-6">
      {/* Header Futuristic */}
      <header className="flex flex-col items-center justify-between gap-4 rounded-3xl border border-indigo-500/30 bg-slate-900/80 p-5 shadow-2xl backdrop-blur-md sm:flex-row">
        <div className="text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-cyan-400"></span>
            <h1 className="font-cyber text-xl font-black tracking-widest text-white sm:text-2xl">
              PDA AI MAPPING
            </h1>
          </div>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.25em] text-indigo-400">
            Hệ thống Quét &amp; Đối Chiếu Tồn Kho Barcode
          </p>
        </div>

        {/* Auth status & Scan button */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-950/40 px-3.5 py-2.5 text-xs text-emerald-200 shadow-md">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              <span className="font-mono text-[11px] font-bold text-emerald-300 max-w-[140px] truncate sm:max-w-[200px]">
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="ml-1 rounded-lg bg-black/40 px-2 py-1 text-[10px] font-bold text-slate-400 hover:bg-rose-900/60 hover:text-white transition"
              >
                Đăng xuất
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAuthModalOpen(true)}
              className="flex items-center gap-2 rounded-2xl border border-cyan-500/40 bg-slate-950 px-4 py-3 text-xs font-bold uppercase tracking-wider text-cyan-300 shadow-lg hover:border-cyan-400 hover:bg-cyan-950/40 active:scale-95 transition"
            >
              <span>🔐</span>
              <span>ĐĂNG NHẬP</span>
              <span className="rounded-full bg-cyan-500/20 px-1.5 py-0.5 text-[9px] text-cyan-300">
                RLS Auth
              </span>
            </button>
          )}

          {/* Nút Gọi thẻ Quét Tag */}
          <button
            type="button"
            onClick={() => setIsScanModalOpen(true)}
            className="group flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-6 py-3.5 font-cyber text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-indigo-500/30 transition-all hover:scale-[1.02] hover:shadow-cyan-500/40 active:scale-95"
          >
            <span className="text-lg transition-transform group-hover:scale-125">🏷️</span>
            <span>QUÉT TAG (PDA SCAN)</span>
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] tracking-normal">
              Bật Giao Diện Nổi
            </span>
          </button>
        </div>
      </header>

      {/* Cảnh báo chưa đăng nhập (nguyên nhân RLS chặn Bảng 1 & 2) */}
      {!user && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-950/40 p-4 text-xs text-amber-200 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <p className="font-bold text-amber-300">Bạn đang ở trạng thái chưa đăng nhập!</p>
              <p className="text-[11px] text-amber-200/90 mt-0.5">
                Chính sách bảo mật hệ thống (Row Level Security) chỉ cho phép tài khoản đã xác thực truy vấn dữ liệu Bảng 1 (Quét) và Bảng 2 (Nguồn).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsAuthModalOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-950 shadow hover:bg-amber-400 active:scale-95 transition shrink-0"
          >
            <span>🔐</span> Đăng nhập ngay
          </button>
        </div>
      )}

      {/* Thống kê nhanh */}
      <section aria-label="Thống kê" className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3 text-center">
          <span className="text-[10px] font-bold uppercase text-slate-400">Tổng đã quét</span>
          <p className="font-cyber text-xl font-bold text-white">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-center">
          <span className="text-[10px] font-bold uppercase text-emerald-400">Khớp hoàn toàn</span>
          <p className="font-cyber text-xl font-bold text-emerald-300">{stats.ok}</p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-amber-950/20 p-3 text-center">
          <span className="text-[10px] font-bold uppercase text-amber-400">Sai lệch (SL/Bin)</span>
          <p className="font-cyber text-xl font-bold text-amber-300">{stats.mismatch}</p>
        </div>
        <div className="rounded-2xl border border-sky-500/20 bg-sky-950/20 p-3 text-center">
          <span className="text-[10px] font-bold uppercase text-sky-400">Ngoài nguồn</span>
          <p className="font-cyber text-xl font-bold text-sky-300">{stats.notInRef}</p>
        </div>
        <div className="col-span-2 sm:col-span-1 rounded-2xl border border-rose-500/20 bg-rose-950/20 p-3 text-center">
          <span className="text-[10px] font-bold uppercase text-rose-400">Trùng Tag</span>
          <p className="font-cyber text-xl font-bold text-rose-300">{stats.duplicate}</p>
        </div>
      </section>

      {/* Bảng 1: Danh Sách Đã Quét & Đối Chiếu */}
      <section aria-label="Đối chiếu" className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-900/60 p-4 sm:p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200 flex items-center gap-2">
              <span>📋</span> Bảng 1 — Danh Sách Quét &amp; Đối Chiếu ({rows.length})
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              So khớp trực tiếp giữa dữ liệu thực tế quét từ PDA và số liệu nguồn từ hệ thống.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton rows={rows} systemByBatch={byBatch} />
          </div>
        </div>

        <ReconciliationTable rows={rows} systemByBatch={byBatch} />
      </section>

      {/* Bảng 2: Dữ Liệu Nguồn & Thẻ Import */}
      <ReferenceDataTable />

      {/* Giao diện nổi Quét Tag (Modal) */}
      <PdaScanModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        rows={rows}
        systemByBatch={byBatch}
        onScanned={() => void refetch()}
      />

      {/* Modal Đăng nhập / Đăng ký Supabase Auth */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={() => void refetch()}
      />
    </main>
  );
}
