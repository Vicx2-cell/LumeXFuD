import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const route = readFileSync(join(process.cwd(), 'app', 'api', 'orders', '[id]', 'messages', 'route.ts'), 'utf8')
const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '128_order_communication_performance.sql'), 'utf8')
const atomic = readFileSync(join(process.cwd(), 'supabase', 'migrations', '129_order_communication_atomic_authorization.sql'), 'utf8')
const ui = readFileSync(join(process.cwd(), 'components', 'order-chat.tsx'), 'utf8')

describe('order communication performance', () => {
  it('bounds and paginates message history from the newest indexed edge', () => {
    expect(route).toContain(".rpc('get_order_chat_page_authorized'")
    expect(route).toContain('p_limit: 100')
    expect(atomic).toContain('ORDER BY created_at DESC, id DESC')
    expect(atomic).toContain('LIMIT LEAST(100')
    expect(atomic).toContain('p_before IS NULL OR created_at < p_before')
    expect(atomic).toContain("'has_more'")
    expect(ui).toContain('Load earlier messages')
  })

  it('ships partial indexes for unread and current-assignment hot paths', () => {
    expect(migration).toMatch(/order_messages\(conversation_id, created_at DESC, sender_id\)[\s\S]*WHERE message_type = 'USER'/i)
    expect(migration).toMatch(/order_conversations\(order_id, rider_id, channel\)[\s\S]*WHERE is_active/i)
  })

  it('does not reconnect merely because the parent recreates onClose', () => {
    expect(ui).toContain('const onCloseRef = useRef(onClose)')
    expect(ui).toContain('onCloseRef.current()')
    expect(ui).not.toContain('[channel, load, onClose, open, orderId]')
  })
})
