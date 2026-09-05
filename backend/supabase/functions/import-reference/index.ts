// import-reference — Phase 2 (Plan.md §4.1, Skills A).
// Nhận file `Stock Balance With Batch.xlsx` (multipart field `file`),
// bỏ 4 dòng đầu, TRIM cột text (giữ cột raw audit), upsert vào
// reference_stock theo batch_id. Đếm động — không hardcode số dòng.
// Contract: { ok, data?, error?: { code, message } } (Skills C).
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const SHEET_NAME = "Stock Balance With Batch";
const EXPECTED_HEADER = ["Stock Code", "Warehouse", "CREATEDATE", "BATCH", "BIN", "Qty"];
const BATCH_SIZE = 500;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json(405, { ok: false, error: { code: "method_not_allowed", message: "Use POST multipart with field 'file'" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { ok: false, error: { code: "server_misconfigured", message: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" } });
  }

  let buf: ArrayBuffer;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json(400, { ok: false, error: { code: "missing_file", message: "Multipart field 'file' (.xlsx) is required" } });
    }
    buf = await file.arrayBuffer();
  } catch {
    return json(400, { ok: false, error: { code: "bad_request", message: "Cannot read multipart body" } });
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  } catch {
    return json(400, { ok: false, error: { code: "invalid_excel", message: "File is not a valid .xlsx" } });
  }
  const ws = wb.Sheets[SHEET_NAME] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) {
    return json(400, {
      ok: false,
      error: { code: "sheet_not_found", message: `Sheet '${SHEET_NAME}' not found` },
    });
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];

  // Tìm header row linh hoạt trong 15 dòng đầu
  const reqCols = ["stock code", "warehouse", "batch", "bin", "qty"];
  let headerRowIdx = -1;
  const colMap: Record<string, number> = {};

  for (let idx = 0; idx < Math.min(15, rows.length); idx++) {
    const row = rows[idx];
    if (!Array.isArray(row)) continue;
    const rowStr = row.map((c) => String(c ?? "").trim().toLowerCase());
    const found: Record<string, number> = {};
    for (const req of reqCols) {
      const colIdx = rowStr.findIndex((c) => c.includes(req));
      if (colIdx >= 0) found[req] = colIdx;
    }
    if (Object.keys(found).length === reqCols.length) {
      headerRowIdx = idx;
      Object.assign(colMap, found);
      // Optional createdate
      const cdIdx = rowStr.findIndex((c) => c.includes("createdate") || c.includes("create_date"));
      if (cdIdx >= 0) colMap["createdate"] = cdIdx;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return json(400, {
      ok: false,
      error: {
        code: "invalid_header",
        message: "Không tìm thấy dòng tiêu đề chứa các cột: Stock Code, Warehouse, BATCH, BIN, Qty (kiểm tra 15 dòng đầu)",
      },
    });
  }

  const dataRows = rows.slice(headerRowIdx + 1);
  const recordMap = new Map<string, Record<string, unknown>>();
  const skipped: { row: number; reason: string }[] = [];

  dataRows.forEach((r, i) => {
    const excelRow = headerRowIdx + 2 + i; // dòng Excel thật (1-based)
    const rowArr = r as unknown[];
    if (!Array.isArray(rowArr)) return;

    const stockCode = rowArr[colMap["stock code"]];
    const warehouse = rowArr[colMap["warehouse"]];
    const createDate = colMap["createdate"] !== undefined ? rowArr[colMap["createdate"]] : null;
    const batch = rowArr[colMap["batch"]];
    const bin = rowArr[colMap["bin"]];
    const qty = rowArr[colMap["qty"]];

    if ([stockCode, warehouse, batch, bin, qty].every((v) => v === null || v === undefined || String(v).trim() === "")) return; // dòng trống

    const batchId = asText(batch)?.trim() ?? "";
    if (!batchId || batchId.toLowerCase() === "none") {
      skipped.push({ row: excelRow, reason: "empty BATCH" });
      return;
    }
    const qtyNum = typeof qty === "number" ? qty : Number(String(qty ?? "").trim());
    if (!Number.isFinite(qtyNum)) {
      skipped.push({ row: excelRow, reason: "invalid Qty" });
      return;
    }
    const rawStock = asText(stockCode) ?? "";
    const rawBin = asText(bin) ?? "";
    let createIso: string | null = null;
    if (createDate instanceof Date && !isNaN(createDate.getTime())) {
      createIso = createDate.toISOString();
    } else if (createDate !== null && createDate !== undefined && createDate !== "") {
      const d = new Date(String(createDate));
      if (!isNaN(d.getTime())) createIso = d.toISOString();
    }

    recordMap.set(batchId, {
      batch_id: batchId,
      stock_code: rawStock.trim(),
      stock_code_raw: rawStock,
      warehouse: asText(warehouse)?.trim() ?? "",
      bin: rawBin.trim(),
      bin_raw: rawBin,
      qty: qtyNum,
      create_date: createIso,
    });
  });

  const records = Array.from(recordMap.values());
  const supabase = createClient(supabaseUrl, serviceKey);
  let upserted = 0;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("reference_stock").upsert(chunk, { onConflict: "batch_id" });
    if (error) {
      return json(500, { ok: false, error: { code: "upsert_failed", message: error.message } });
    }
    upserted += chunk.length;
  }

  return json(200, {
    ok: true,
    data: {
      total_rows_in_file: dataRows.length,
      unique_batches: records.length,
      upserted,
      skipped: skipped.length,
      skipped_rows: skipped.slice(0, 20),
    },
  });
});
