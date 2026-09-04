// Wrapper gọi Edge Function scan-submit / resolve-duplicate (Skills B/C).
// Chuẩn hóa contract { ok, data?, error?: { code, message } } thành union type
// để component rẽ nhánh theo error.code, không parse message.
import { supabase } from './supabase';

export type ScanStatus =
  | 'pending'
  | 'ok'
  | 'qty_mismatch'
  | 'bin_mismatch'
  | 'not_in_reference'
  | 'duplicate';

export interface ScanSuccess {
  id: string;
  status: ScanStatus;
}

export interface ScanAttempt {
  batchId: string;
  qty: number;
  bin: string;
}

export interface DuplicateConflict {
  existingId: string;
  computedStatus: ScanStatus;
  attempted: ScanAttempt;
}

export type ScanOutcome =
  | { kind: 'scanned'; result: ScanSuccess }
  | { kind: 'duplicate'; conflict: DuplicateConflict }
  | { kind: 'error'; code: string; message: string };

export interface ResolveResult {
  id: string;
  status: ScanStatus;
  resolution: 'appended' | 'relocated';
}

export type ResolveOutcome =
  | { kind: 'resolved'; result: ResolveResult }
  | { kind: 'error'; code: string; message: string };

function scanErr(code: string, message: string): ScanOutcome {
  return { kind: 'error', code, message };
}

function resolveErr(code: string, message: string): ResolveOutcome {
  return { kind: 'error', code, message };
}

async function readContractError(
  invokeError: { context?: unknown },
): Promise<{ code: string; message: string; data?: Record<string, unknown> }> {
  try {
    const ctx = invokeError.context as { json?: () => Promise<unknown> } | undefined;
    const body = (await ctx?.json?.()) as
      | { error?: { code?: unknown; message?: unknown }; data?: Record<string, unknown> }
      | undefined;
    const code = typeof body?.error?.code === 'string' ? body.error.code : 'network_error';
    const message =
      typeof body?.error?.message === 'string' ? body.error.message : 'Request failed';
    return { code, message, data: body?.data };
  } catch {
    return { code: 'network_error', message: 'Request failed' };
  }
}

export async function submitScan(input: {
  batchId: string;
  qty: number;
  bin: string;
  isManual: boolean;
}): Promise<ScanOutcome> {
  const { data, error } = await supabase.functions.invoke('scan-submit', {
    body: { batch_id: input.batchId, qty: input.qty, bin: input.bin, is_manual: input.isManual },
  });
  if (error) {
    const info = await readContractError(error as { context?: unknown });
    if (info.code === 'duplicate') {
      const d = info.data ?? {};
      return {
        kind: 'duplicate',
        conflict: {
          existingId: typeof d.existing_id === 'string' ? d.existing_id : '',
          computedStatus: (d.computed_status as ScanStatus) ?? 'pending',
          attempted: { batchId: input.batchId, qty: input.qty, bin: input.bin },
        },
      };
    }
    return scanErr(info.code, info.message);
  }
  const body = data as { ok?: unknown; data?: { id?: unknown; status?: unknown } };
  if (body?.ok === true) {
    return {
      kind: 'scanned',
      result: {
        id: String(body.data?.id ?? ''),
        status: (body.data?.status as ScanStatus) ?? 'pending',
      },
    };
  }
  return scanErr('bad_response', 'Unexpected response from scan-submit');
}

export async function resolveDuplicate(input: {
  action: 'append' | 'relocate';
  scannedId: string;
  batchId: string;
  qty: number;
  bin: string;
}): Promise<ResolveOutcome> {
  const { data, error } = await supabase.functions.invoke('resolve-duplicate', {
    body: {
      action: input.action,
      scanned_id: input.scannedId,
      batch_id: input.batchId,
      qty: input.qty,
      bin: input.bin,
    },
  });
  if (error) {
    const info = await readContractError(error as { context?: unknown });
    return resolveErr(info.code, info.message);
  }
  const body = data as {
    ok?: unknown;
    data?: { id?: unknown; status?: unknown; resolution?: unknown };
  };
  if (body?.ok === true) {
    return {
      kind: 'resolved',
      result: {
        id: String(body.data?.id ?? ''),
        status: (body.data?.status as ScanStatus) ?? 'pending',
        resolution: body.data?.resolution === 'relocated' ? 'relocated' : 'appended',
      },
    };
  }
  return resolveErr('bad_response', 'Unexpected response from resolve-duplicate');
}
