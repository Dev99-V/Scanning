// scan-submit — Phase 3 (Plan.md §4.2-4.3, Skills A/C).
// Nhận { batch_id, qty, bin, is_manual }, gọi RPC scan_submit (compare + lock
// nằm TRONG 1 transaction ở DB — không tách ra JS). Trùng -> error code
// 'duplicate' để frontend hiện toast; các status khác lưu kèm ok:true (inline).
// Contract: { ok, data?, error?: { code, message } }.
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return json(405, { ok: false, error: { code: "method_not_allowed", message: "Use POST with JSON body" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { ok: false, error: { code: "server_misconfigured", message: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" } });
  }

  let body: { batch_id?: unknown; qty?: unknown; bin?: unknown; is_manual?: unknown; stock_code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: { code: "invalid_input", message: "Body must be JSON" } });
  }
  const batchId = typeof body.batch_id === "string" ? body.batch_id.trim() : "";
  const qty = typeof body.qty === "number" ? body.qty : Number(body.qty);
  const bin = typeof body.bin === "string" ? body.bin.trim() : "";
  const isManual = body.is_manual === true;
  const stockCode = typeof body.stock_code === "string" ? body.stock_code.trim() : null;
  if (!batchId || !Number.isFinite(qty) || !bin) {
    return json(400, {
      ok: false,
      error: { code: "invalid_input", message: "Fields required: batch_id (non-empty string), qty (number), bin (non-empty string)" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let scannedBy: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const { data } = await supabase.auth.getUser(authHeader.replace(/^Bearer /i, ""));
      scannedBy = data.user?.id ?? null;
    } catch {
      scannedBy = null;
    }
  }

  const { data, error } = await supabase.rpc("scan_submit", {
    p_batch_id: batchId,
    p_qty: qty,
    p_bin: bin,
    p_is_manual: isManual,
    p_scanned_by: scannedBy,
    p_stock_code: stockCode,
  });
  if (error) {
    return json(500, { ok: false, error: { code: "internal", message: error.message } });
  }
  if (data && (data as { conflict?: boolean }).conflict) {
    const c = data as { existing_id: string; computed_status: string; stock_code?: string };
    return json(409, {
      ok: false,
      error: { code: "duplicate", message: `Tag ID ${batchId} đã được quét — chọn Ghi thêm hoặc Đổi vị trí` },
      data: { existing_id: c.existing_id, computed_status: c.computed_status, stock_code: c.stock_code },
    });
  }
  const r = data as { id: string; status: string; stock_code?: string };
  return json(200, { ok: true, data: { id: r.id, status: r.status, stock_code: r.stock_code } });
});
