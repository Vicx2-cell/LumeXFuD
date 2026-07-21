import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const atomic = readFileSync(join(process.cwd(), 'supabase', 'migrations', '129_order_communication_atomic_authorization.sql'), 'utf8')
const messages = readFileSync(join(process.cwd(), 'app', 'api', 'orders', '[id]', 'messages', 'route.ts'), 'utf8')
const read = readFileSync(join(process.cwd(), 'app', 'api', 'orders', '[id]', 'messages', 'read', 'route.ts'), 'utf8')

describe('order communication reassignment race hardening', () => {
  it('locks and rechecks current assignment inside the database transaction', () => {
    expect(atomic).toContain('FROM orders WHERE id = p_order_id FOR SHARE')
    expect(atomic).toContain('v_order.rider_id = p_actor_id')
    expect(atomic).toContain('rider_id = v_order.rider_id')
  })

  it('routes every sensitive operation through the atomic authorization RPCs', () => {
    expect(messages).toContain(".rpc('get_order_chat_page_authorized'")
    expect(messages).toContain(".rpc('send_order_chat_message_authorized'")
    expect(read).toContain(".rpc('mark_order_chat_read_authorized'")
  })

  it('does not expose the atomic helpers to direct clients', () => {
    expect(atomic).toMatch(/REVOKE ALL ON FUNCTION order_chat_ensure_authorized[\s\S]*PUBLIC, anon, authenticated/i)
    expect(atomic).toMatch(/GRANT EXECUTE ON FUNCTION send_order_chat_message_authorized[\s\S]*service_role/i)
  })
})
