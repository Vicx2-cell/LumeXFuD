import { createSupabaseAdmin } from './supabase/server'

export interface AuditEntry {
  actor_id: string
  actor_role: string
  action: string
  target_table?: string
  target_id?: string
  old_value?: Record<string, unknown>
  new_value?: Record<string, unknown>
  ip_address?: string
  user_agent?: string
}

export interface SuperAuditEntry extends AuditEntry {
  amount_kobo?: number
}

// Money actions whose audit row is a compliance requirement (rule #30: "every
// refund must go through audit_logs"). If the audit insert for one of these
// fails, the action still happened but left no trail — that must NOT be silent.
const MONEY_ACTION_RE = /refund|payout|wallet|withdraw|adjust|reversal|clawback|disburse/i

// supabase-js resolves with { error } on a constraint/permission failure (it does
// NOT throw), so we must inspect it — the old code only caught thrown/network
// errors and silently dropped DB-rejected inserts.
async function alertMoneyAuditFailure(table: string, entry: AuditEntry, reason: string): Promise<void> {
  console.error(`[audit] MONEY-PATH audit write FAILED (${table}, action=${entry.action}):`, reason)
  const adminPhone = process.env.ADMIN_PHONE
  if (!adminPhone) return
  try {
    // Dynamic import avoids a static cycle (notify → templates → …).
    const { sendWhatsAppWithFallback } = await import('./notify')
    await sendWhatsAppWithFallback({
      to: adminPhone,
      message:
        `🚨 Audit write FAILED for a money action (${entry.action}) on ` +
        `${entry.target_table ?? table}/${entry.target_id ?? '?'} by ${entry.actor_id}. ` +
        `The action proceeded but is NOT in the audit log — investigate (rule #30).`,
    })
  } catch (e) {
    console.error('[audit] money-audit alert failed:', e)
  }
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    const { error } = await db.from('audit_logs').insert(entry)
    if (error) {
      if (MONEY_ACTION_RE.test(entry.action)) await alertMoneyAuditFailure('audit_logs', entry, error.message)
      else console.error('[audit] failed to write audit log:', error.message)
    }
  } catch (err) {
    // Never throw from audit — but a money-path failure still gets alerted.
    if (MONEY_ACTION_RE.test(entry.action)) await alertMoneyAuditFailure('audit_logs', entry, String(err))
    else console.error('[audit] failed to write audit log:', err)
  }
}

export async function superAudit(entry: SuperAuditEntry): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    const { error } = await db.from('super_audit_logs').insert(entry)
    if (error) {
      if (MONEY_ACTION_RE.test(entry.action)) await alertMoneyAuditFailure('super_audit_logs', entry, error.message)
      else console.error('[superAudit] failed to write super audit log:', error.message)
    }
  } catch (err) {
    if (MONEY_ACTION_RE.test(entry.action)) await alertMoneyAuditFailure('super_audit_logs', entry, String(err))
    else console.error('[superAudit] failed to write super audit log:', err)
  }
}
