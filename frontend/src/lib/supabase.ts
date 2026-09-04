// Supabase client duy nhất cho frontend (Skills B/C).
// Chỉ dùng VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY — KHÔNG BAO GIỜ
// service_role ở bundle frontend (Rules.md §1).
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Không throw để build/test không crash khi thiếu env; mọi call API sẽ lỗi
  // rõ ràng ở runtime. Dev/CI điền qua .env.local / GitHub Secrets.
  console.warn('[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key');
