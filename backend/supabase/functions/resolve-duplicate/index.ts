// resolve-duplicate — Phase 3 (Plan.md §6, Skills A/C).
// Nhận { action: 'append'|'relocate', scanned_id, batch_id, qty, bin },
// gọi RPC resolve_duplicate (1 transaction ở DB). Cả 2 action đều ghi audit.
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

  let body: {
    action?: unknown; scanned_id?: unknown; batch_id?: unknown;
    qty?: unknown; bin?: unknown; is_manual?: unknown; stock_code?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: { code: "invalid_input", message: "Body must be JSON" } });
  }
  const action = body.action === "append" || body.action === "relocate" ? body.action : "";
  const scannedId = typeof body.scanned_id === "string" ? body.scanned_id : "";
  const batchId = typeof body.batch_id === "string" ? body.batch_id.trim() : "";
  const qty = typeof body.qty === "number" ? body.qty : Number(body.qty);
  const bin = typeof body.bin === "string" ? body.bin.trim() : "";
  const isManual = body.is_manual === true;
  const stockCode = typeof body.stock_code === "string" ? body.stock_code.trim() : null;
  if (!action || !scannedId || !batchId || !Number.isFinite(qty) || !bin) {
    return json(400, {
      ok: false,
      error: {
        code: "invalid_input",
        message: "Fields required: action ('append'|'relocate'), scanned_id (uuid), batch_id, qty (number), bin",
      },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let actor: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const { data } = await supabase.auth.getUser(authHeader.replace(/^Bearer /i, ""));
      actor = data.user?.id ?? null;
    } catch {
      actor = null;
    }
  }

  const { data, error } = await supabase.rpc("resolve_duplicate", {
    p_action: action,
    p_scanned_id: scannedId,
    p_batch_id: batchId,
    p_qty: qty,
    p_bin: bin,
    p_is_manual: isManual,
    p_actor: actor,
    p_stock_code: stockCode,
  });
  if (error) {
    if (error.message.includes("duplicate_target_not_found")) {
      return json(404, { ok: false, error: { code: "not_found", message: "Dòng quét gốc không tồn tại" } });
    }
    return json(500, { ok: false, error: { code: "internal", message: error.message } });
  }
  const r = data as { id: string; status: string; resolution: string; stock_code?: string };
  return json(200, { ok: true, data: { id: r.id, status: r.status, resolution: r.resolution, stock_code: r.stock_code } });
});
