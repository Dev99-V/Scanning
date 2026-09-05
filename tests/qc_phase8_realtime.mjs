// QC Phase 8 helper: chứng minh realtime LIVE end-to-end.
// Đăng nhập user e2e, subscribe INSERT trên scanned_data, tự trigger 1 lượt
// quét qua Edge Function scan-submit, chờ event realtime tới.
// Env: E2E_URL, E2E_ANON, E2E_EMAIL, E2E_PASS, E2E_BATCH, E2E_BIN, E2E_FUNC.
// Exit 0 + in QC8_REALTIME_OK khi nhận đúng event trong 25s.
// Chạy từ frontend/ để resolve '@supabase/supabase-js'.
import { createClient } from '../frontend/node_modules/@supabase/supabase-js/dist/index.mjs';

const URL = process.env.E2E_URL;
const ANON = process.env.E2E_ANON;
const FUNC = process.env.E2E_FUNC;
const BATCH = process.env.E2E_BATCH;
const BIN = process.env.E2E_BIN ?? 'RT-BIN';

const sb = createClient(URL, ANON);
const { error: signErr } = await sb.auth.signInWithPassword({
  email: process.env.E2E_EMAIL,
  password: process.env.E2E_PASS,
});
if (signErr) {
  console.error('signin failed:', signErr.message);
  process.exit(1);
}
const session = (await sb.auth.getSession()).data.session;
if (!session) {
  console.error('no session');
  process.exit(1);
}

let done = false;
const finish = async (ok, msg) => {
  if (done) return;
  done = true;
  clearTimeout(timer);
  console.log(msg);
  await sb.removeAllChannels();
  process.exit(ok ? 0 : 1);
};
const timer = setTimeout(() => void finish(false, 'QC8_REALTIME_TIMEOUT'), 25000);

const ch = sb
  .channel(`qc8_e2e_${Date.now()}`)
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scanned_data' }, (p) => {
    if (p.new && p.new.batch_id === BATCH) void finish(true, 'QC8_REALTIME_OK');
  })
  .subscribe(async (status) => {
    if (status !== 'SUBSCRIBED' || done) return;
    try {
      await fetch(FUNC, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: ANON,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ batch_id: BATCH, qty: 1, bin: BIN }),
      });
    } catch (e) {
      await finish(false, `trigger failed: ${String(e)}`);
    }
  });
