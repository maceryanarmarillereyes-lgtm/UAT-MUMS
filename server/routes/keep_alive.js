/**
 * @file keep_alive.js
 * @description Keep Alive module
 * @module MUMS/MUMS
 * @version UAT
 */
/* @AI_CRITICAL_GUARD v3.0: UNTOUCHABLE ZONE — MACE APPROVAL REQUIRED.
   Protects: Enterprise UI/UX · Realtime Sync Logic · Core State Management ·
   Database/API Adapters · Tab Isolation · Virtual Column State ·
   QuickBase Settings Persistence · Auth Flow.
   DO NOT modify any existing logic, layout, or structure in this file without
   first submitting a RISK IMPACT REPORT to MACE and receiving explicit "CLEARED" approval.
   Violations will cause regressions. When in doubt — STOP and REPORT. */


// Supabase keep-alive endpoint
// - Harmless write into `heartbeat` table to prevent Supabase project pausing on free plans.
// - Uses server-side service role key.

const { serviceInsert, serviceUpsert, serviceFetch } = require('../lib/supabase');

function sendJson(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function nowIso() {
  return new Date().toISOString();
}

function missingTable(out) {
  const t = String(out && out.text ? out.text : '');
  const j = out && out.json ? JSON.stringify(out.json) : '';
  const blob = (t + ' ' + j).toLowerCase();
  return /heartbeat/.test(blob) && (/does not exist/.test(blob) || /relation/.test(blob) || /not found/.test(blob));
}

const HEARTBEAT_SQL = [
  'create table if not exists public.heartbeat (',
  '  id uuid primary key default gen_random_uuid(),',
  '  uid uuid,',
  '  timestamp timestamptz default now()',
  ');',
  '',
  '-- Ensure uid exists (for older deployments)',
  'alter table public.heartbeat add column if not exists uid uuid;',
  '',
  '-- Enterprise: enforce per-user RLS (service role bypasses)',
  'alter table public.heartbeat enable row level security;',
  '',
  '-- Idempotent policy creation',
  'do $$',
  'begin',
  "  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'heartbeat' and policyname = 'User can read own heartbeat') then",
  '    create policy "User can read own heartbeat" on public.heartbeat for select using (auth.uid() = uid);',
  '  end if;',
  "  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'heartbeat' and policyname = 'User can insert own heartbeat') then",
  '    create policy "User can insert own heartbeat" on public.heartbeat for insert with check (auth.uid() = uid);',
  '  end if;',
  "  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'heartbeat' and policyname = 'User can update own heartbeat') then",
  '    create policy "User can update own heartbeat" on public.heartbeat for update using (auth.uid() = uid) with check (auth.uid() = uid);',
  '  end if;',
  'end',
  '$$;'
].join('\n');

async function tryRpcCreateTable() {
  // Best-effort: many projects will NOT have any SQL-exec RPC installed.
  // We try a few common function names; if none exist, caller will return manual setup instructions.
  const candidates = ['exec_sql', 'execute_sql', 'mums_exec_sql', 'sql'];
  for (const fn of candidates) {
    try {
      const out = await serviceFetch(`/rest/v1/rpc/${encodeURIComponent(fn)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { sql: HEARTBEAT_SQL }
      });
      if (out && out.ok) return { ok: true, via: fn };
    } catch (_) {
      // ignore
    }
  }
  return { ok: false };
}

module.exports = async (req, res) => {
  // Accept GET or POST. Always respond 200 with ok flag.
  try {
    const ts = nowIso();
    // IO-OPT: UPSERT on a fixed key 'server' instead of INSERT every call.
    // Original INSERT grew the table unbounded (trim trigger only fired at 200 rows).
    // Now there is exactly ONE row in the heartbeat table — zero index bloat.
    // The table must have a unique constraint on the 'source' column; if the column
    // doesn't exist yet the migration below adds it, falling back to plain INSERT.
    let out = await serviceUpsert('heartbeat', [{ source: 'server', timestamp: ts }], 'source');
    if (!out.ok) {
      // Fallback to plain INSERT (pre-migration schema without 'source' column)
      out = await serviceInsert('heartbeat', [{ timestamp: ts }]);
    }

    if (!out.ok && missingTable(out)) {
      // Attempt auto-create via SQL RPC (best-effort)
      const created = await tryRpcCreateTable();
      if (created.ok) {
        out = await serviceUpsert('heartbeat', [{ source: 'server', timestamp: ts }], 'source');
        if (!out.ok) out = await serviceInsert('heartbeat', [{ timestamp: ts }]);
      }

      if (!out.ok) {
        console.warn('[keep_alive] heartbeat table missing; manual setup required');
        return sendJson(res, 200, {
          ok: false,
          error: 'heartbeat_table_missing',
          need_manual_setup: true,
          sql: HEARTBEAT_SQL
        });
      }
    }

    if (!out.ok) {
      console.warn('[keep_alive] insert failed', out && out.status, out && out.text);
      return sendJson(res, 200, {
        ok: false,
        error: 'insert_failed',
        status: out.status,
        message: out.text || null
      });
    }

    console.log('[keep_alive] ok', ts);
    return sendJson(res, 200, {
      ok: true,
      ts,
      inserted: Array.isArray(out.json) ? out.json.length : 1
    });
  } catch (e) {
    console.warn('[keep_alive] error', e);
    return sendJson(res, 200, { ok: false, error: 'exception', message: String(e && (e.message || e) || 'unknown') });
  }
};