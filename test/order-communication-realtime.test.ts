import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const route = readFileSync(
  join(process.cwd(), 'app', 'api', 'orders', '[id]', 'messages', 'stream', 'route.ts'),
  'utf8',
)
const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '124_order_communication_realtime.sql'),
  'utf8',
)

describe('order communication realtime transport', () => {
  it('publishes only through an authenticated server event stream', () => {
    expect(route).toContain('getCurrentUser()')
    expect(route).toContain("'Content-Type': 'text/event-stream; charset=utf-8'")
    expect(route).not.toContain('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  })

  it('revalidates session liveness and current assignment during the stream', () => {
    expect(route).toContain('isSessionLive(session.sessionId)')
    expect(route).toContain('authorizeOrderConversation(session, latestOrder')
    expect(route).toContain("send('access_revoked'")
  })

  it('publishes the required tables without duplicating existing publication entries', () => {
    expect(migration).toContain("pubname = 'supabase_realtime'")
    expect(migration).toContain("'order_messages'")
    expect(migration).toContain("'order_message_reads'")
    expect(migration).toMatch(/IF NOT EXISTS[\s\S]*ALTER PUBLICATION/i)
  })
})
