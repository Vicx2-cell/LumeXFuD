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

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    await db.from('audit_logs').insert(entry)
  } catch (err) {
    // Never throw from audit — log errors silently
    console.error('[audit] failed to write audit log:', err)
  }
}

export async function superAudit(entry: SuperAuditEntry): Promise<void> {
  try {
    const db = createSupabaseAdmin()
    await db.from('super_audit_logs').insert(entry)
  } catch (err) {
    console.error('[superAudit] failed to write super audit log:', err)
  }
}
