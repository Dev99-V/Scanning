// App — Giao diện chính PDA Scan & Đối Chiếu (Layout mới theo yêu cầu 2026-09-04).
// - Thẻ / Nút nổi bật "Quét Tag" mở giao diện nổi (Modal phong cách scantag.html).
// - Bảng 1: Danh sách đã quét & đối chiếu (Stock code, Tag id, SL quét, Bin quét, SL HT, Bin HT, Note/Cảnh báo) + Export.
// - Bảng 2: Dữ liệu nguồn tra cứu + Thẻ import file mẫu Stock Balance With Batch.xlsx.
// - Cả 2 bảng cuộn chuột 100 dòng tự động tải tiếp, tối ưu cho cả Mobile PDA lẫn PC.
import { useMemo, useState } from 'react';
import ExportButton from './components/ExportButton';
import NameGateModal from './components/NameGateModal';
import OnlineUsersModal from './components/OnlineUsersModal';
import OnlineUsersStrip from './components/OnlineUsersStrip';
import PdaScanModal from './components/PdaScanModal';
import PresenceAvatars from './components/PresenceAvatars';
import ReconciliationTable from './components/ReconciliationTable';
import ReferenceDataTable from './components/ReferenceDataTable';
import { useIdentity } from './hooks/useIdentity';
import { usePresence } from './hooks/usePresence';
import { initialForName } from './hooks/presenceHelpers';
import { useReferenceMap } from './hooks/useReferenceMap';
import { useScannedData } from './hooks/useScannedData';

export default function App() {
  const { rows, refetch } = useScannedData();
  const { byBatch, updateBatchQty, updateBatchBin, addBatch, removeBatch } = useReferenceMap();
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  // Hiện diện realtime: bắt buộc đặt tên → avatar streaming + khóa mềm theo dòng.
  const { identity, saveName, rename } = useIdentity();
  const presence = usePresence(identity);
  const [isOnlineUsersOpen, setIsOnlineUsersOpen] = useState(false);

  // Thống kê nhanh trạng thái quét (chống trùng lặp id và nhận diện chính xác tag quét trùng nhiều vị trí)
  const stats = useMemo(() => {
    let ok = 0;
    let mismatch = 0;
    let notInRef = 0;
    let duplicate = 0;
    const seenIds = new Set<string>();
    const batchCounts = new Map<string, number>();

    // Đếm tần suất xuất hiện của từng Tag ID trong danh sách quét
    for (const r of rows) {
      if (!r?.batch_id) continue;
      const b = r.batch_id.trim();
      batchCounts.set(b, (batchCounts.get(b) || 0) + 1);
    }

    for (const r of rows) {
      if (!r) continue;
      if (r.id) {
        if (seenIds.has(r.id)) continue;
        seenIds.add(r.id);
      }
      const b = r.batch_id?.trim();
      const isDuplicate = (b && (batchCounts.get(b) || 0) > 1) || r.status === 'duplicate';
      if (isDuplicate) {
        duplicate++;
      } else if (r.status === 'ok') {
        ok++;
      } else if (r.status === 'qty_mismatch' || r.status === 'bin_mismatch') {
        mismatch++;
      } else if (r.status === 'not_in_reference') {
        notInRef++;
      }
    }
    return { ok, mismatch, notInRef, duplicate, total: seenIds.size || rows.length };
  }, [rows]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-3 sm:p-6">
      {/* Header Futuristic */}
      <header className="flex flex-col items-center justify-between gap-4 rounded-3xl border border-indigo-500/30 bg-slate-900/80 p-5 shadow-2xl backdrop-blur-md sm:flex-row">
        <div className="text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 sm:justify-start">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-cyan-400"></span>
            <h1 className="font-cyber text-xl font-black tracking-widest text-white sm:text-2xl">
              Inventory Discrepancy System
            </h1>
          </div>
          <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.25em] text-indigo-400">
            Hệ thống Kiểm kê &amp; Đối Chiếu Tồn Kho
          </p>
        </div>

        {/* Nút Gọi thẻ Quét Tag */}
        <div className="flex min-w-0 w-full items-center gap-3 sm:w-auto">
          {identity && (
            <div className="flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2">
              <span
                aria-label={`Bạn đang là ${identity.name}`}
                title={`Bạn đang là ${identity.name}`}
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-black text-white"
                style={{ backgroundColor: identity.color }}
              >
                {initialForName(identity.name)}
              </span>
              <div className="leading-tight">
                <p className="text-xs font-bold text-white">{identity.name}</p>
                <p className="text-[10px] text-emerald-400">● Đang online</p>
              </div>
              <button
                type="button"
                onClick={rename}
                title="Đổi tên hiển thị"
                className="ml-1 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-400 hover:text-white"
              >
                Đổi tên
              </button>
            </div>
          )}
          {identity && (
            <OnlineUsersStrip
              peers={presence.peers}
              onlineCount={presence.onlineCount}
              onOpenList={() => setIsOnlineUsersOpen(true)}
            />
          )}
          <button
            type="button"
            onClick={() => setIsScanModalOpen(true)}
          className="group flex shrink-0 items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-500 px-6 py-4 font-cyber text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-indigo-500/30 transition-all hover:scale-[1.02] hover:shadow-cyan-500/40 active:scale-95"
        >
          <span className="text-xl transition-transform group-hover:scale-125">🏷️</span>
          <span>QUÉT TAG</span>
          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] tracking-normal">
            PDA Scanning...
          </span>
          </button>
        </div>
      </header>

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
      <section
        aria-label="Đối chiếu"
        className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-slate-900/60 p-4 sm:p-5 shadow-xl"
        onMouseEnter={() => presence.setViewing('table1')}
        onTouchStart={() => presence.setViewing('table1')}
        onFocusCapture={() => presence.setViewing('table1')}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-200 flex items-center gap-2">
              <span>📋</span> Bảng 1 — Danh Sách Quét &amp; Đối Chiếu ({rows.length})
            </h2>
            <p className="text-[11px] text-slate-400 mt-0.5">
              So sánh trực tiếp giữa dữ liệu thực tế quét từ PDA và dữ liệu nguồn từ hệ thống.
            </p>
            <div className="mt-1">
              <PresenceAvatars users={presence.viewersOfTable('table1')} tableLabel="Bảng 1" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ExportButton rows={rows} systemByBatch={byBatch} />
          </div>
        </div>

        <ReconciliationTable
          rows={rows}
          systemByBatch={byBatch}
          presence={presence}
          actorName={identity?.name ?? null}
          onRowDeleted={() => void refetch()}
          onRowUpdated={() => void refetch()}
        />
      </section>

      {/* Bảng 2: Dữ Liệu Nguồn & Thẻ Import */}
      <div
        onMouseEnter={() => presence.setViewing('table2')}
        onTouchStart={() => presence.setViewing('table2')}
        onFocusCapture={() => presence.setViewing('table2')}
      >
        <ReferenceDataTable
          scannedRows={rows}
          presence={presence}
          presenceHeader={<PresenceAvatars users={presence.viewersOfTable('table2')} tableLabel="Bảng 2" />}
          actorName={identity?.name ?? null}
          onQtyUpdated={updateBatchQty}
          onBinUpdated={(batchId, newBin) => {
            updateBatchBin(batchId, newBin);
            void refetch();
          }}
          onReferenceAdded={(newRow) => {
            addBatch(newRow.batch_id, {
              stock_code: newRow.stock_code,
              qty: newRow.qty,
              bin: newRow.bin,
              tag_7055: newRow.tag_7055,
            });
            void refetch();
          }}
          onReferenceDeleted={(batchId) => {
            removeBatch(batchId);
            void refetch();
          }}
          onQuickImported={() => void refetch()}
        />
      </div>

      {/* Giao diện nổi Quét Tag (Modal) */}
      <PdaScanModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        rows={rows}
        systemByBatch={byBatch}
        actorName={identity?.name ?? null}
        onScanned={() => void refetch()}
      />

      <OnlineUsersModal
        open={isOnlineUsersOpen}
        onClose={() => setIsOnlineUsersOpen(false)}
        currentUser={identity}
        peers={presence.peers}
        onlineCount={presence.onlineCount}
      />

      {/* Cổng đặt tên bắt buộc — avatar streaming realtime */}
      <NameGateModal open={!identity} onSubmit={saveName} />

    </main>
  );
}
