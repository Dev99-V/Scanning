// ReferenceImportCard — Thẻ import file nguồn (Plan.md §4.1, Stock Balance With Batch.xlsx).
// Nhận file .xlsx, gửi lên Edge Function import-reference (bỏ 4 dòng đầu, header row 5, TRIM cột text).
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface ReferenceImportCardProps {
  onImportSuccess?: () => void;
}

export default function ReferenceImportCard({ onImportSuccess }: ReferenceImportCardProps) {
  const [uploading, setUploading] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.xlsx')) {
      setErrorMessage('Vui lòng chọn file định dạng Excel (.xlsx)');
      return;
    }

    setFileName(file.name);
    setErrorMessage(null);
    setResultMessage(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data, error } = await supabase.functions.invoke('import-reference', {
        body: formData,
      });

      if (error) {
        let msg = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === 'function') {
            const errJson = (await ctx.json()) as { error?: { message?: string } } | null;
            if (errJson?.error?.message) {
              msg = errJson.error.message;
            }
          }
        } catch {
          // ignore
        }
        setErrorMessage(`Lỗi import: ${msg || 'Không thể tải file lên'}`);
        return;
      }

      const body = data as {
        ok?: boolean;
        data?: {
          total_rows_in_file?: number;
          unique_batches?: number;
          upserted?: number;
          skipped?: number;
          total_records?: number;
          skipped_rows?: number;
        };
        error?: { message?: string };
      };

      if (body?.ok) {
        const total = body.data?.total_rows_in_file ?? body.data?.total_records ?? 0;
        const unique = body.data?.unique_batches ?? body.data?.upserted ?? 0;
        const skipped = body.data?.skipped ?? body.data?.skipped_rows ?? 0;
        setResultMessage(
          `✅ Import thành công ${unique.toLocaleString()} batch tồn kho (từ ${total.toLocaleString()} dòng dữ liệu, bỏ qua: ${skipped} dòng trống/lỗi).`
        );
        onImportSuccess?.();
      } else {
        setErrorMessage(`Lỗi từ hệ thống: ${body?.error?.message || 'Không thể xử lý file'}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Lỗi kết nối: ${msg}`);
    } finally {
      setUploading(false);
      // Reset input value to allow re-uploading same file name if needed
      e.target.value = '';
    }
  }

  return (
    <div className="rounded-2xl border border-indigo-500/30 bg-slate-900/80 p-4 sm:p-5 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-2">
            <span>📥</span> Thẻ Import File Nguồn (Stock Balance With Batch.xlsx)
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Tự động nhận diện dòng tiêu đề (Header: Stock Code, Warehouse, BATCH, BIN, Qty).
          </p>
        </div>

        <label
          htmlFor="reference-file-upload"
          className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition shadow-md cursor-pointer ${
            uploading
              ? 'bg-slate-700 cursor-not-allowed opacity-60'
              : 'bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 active:scale-95'
          }`}
        >
          <span>{uploading ? '⏳' : '📁'}</span>
          <span>{uploading ? 'Đang nạp file...' : 'Chọn file Excel nạp vào'}</span>
          <input
            id="reference-file-upload"
            type="file"
            accept=".xlsx"
            disabled={uploading}
            onChange={(e) => void handleFileChange(e)}
            className="hidden"
          />
        </label>
      </div>

      {fileName && (
        <div className="flex items-center gap-2 text-xs text-slate-300 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
          <span className="text-indigo-400">File đã chọn:</span>
          <span className="font-mono font-bold text-cyan-300">{fileName}</span>
        </div>
      )}

      {resultMessage && (
        <div className="mt-3 rounded-xl border border-emerald-500/40 bg-emerald-950/50 p-3 text-xs text-emerald-200">
          {resultMessage}
        </div>
      )}

      {errorMessage && (
        <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-950/50 p-3 text-xs text-rose-200">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
