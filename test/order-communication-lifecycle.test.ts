import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

let db: PGlite

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE settings (id text PRIMARY KEY, value jsonb NOT NULL);
    CREATE TABLE riders (id uuid PRIMARY KEY);
    CREATE TABLE orders (
      id uuid PRIMARY KEY,
      customer_id uuid,
      vendor_id uuid,
      rider_id uuid REFERENCES riders(id),
      status text NOT NULL,
      delivered_at timestamptz,
      cancelled_at timestamptz,
      updated_at timestamptz DEFAULT now()
    );
  `)
  for (const file of [
    '122_order_communication_schema.sql',
    '126_order_communication_lifecycle.sql',
    '129_order_communication_atomic_authorization.sql',
  ]) {
    await db.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8'))
  }
  await db.exec(`
    INSERT INTO riders(id) VALUES
      ('10000000-0000-0000-0000-000000000001'),
      ('10000000-0000-0000-0000-000000000002');
    INSERT INTO orders(id, status)
      VALUES ('20000000-0000-0000-0000-000000000001', 'READY');
  `)
}, 30_000)

describe('migration 126 — order communication lifecycle', () => {
  it('creates both permitted conversations and assignment messages', async () => {
    await db.exec(`
      UPDATE orders SET rider_id = '10000000-0000-0000-0000-000000000001',
        status = 'RIDER_ASSIGNED', updated_at = now()
      WHERE id = '20000000-0000-0000-0000-000000000001';
    `)
    const conversations = await db.query<{ channel: string; is_active: boolean }>(
      `SELECT channel, is_active FROM order_conversations ORDER BY channel`,
    )
    expect(conversations.rows).toEqual([
      { channel: 'CUSTOMER_RIDER', is_active: true },
      { channel: 'VENDOR_RIDER', is_active: true },
    ])
    const messages = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM order_messages WHERE message_type = 'SYSTEM'`,
    )
    expect(messages.rows[0].count).toBe(2)
  })

  it('revokes the prior rider and creates isolated version-two threads', async () => {
    await db.exec(`
      UPDATE orders SET rider_id = '10000000-0000-0000-0000-000000000002',
        updated_at = now()
      WHERE id = '20000000-0000-0000-0000-000000000001';
    `)
    const rows = await db.query<{ rider_id: string; assignment_version: number; is_active: boolean }>(`
      SELECT rider_id::text, assignment_version, is_active
      FROM order_conversations ORDER BY assignment_version, channel
    `)
    expect(rows.rows.filter((row) => row.rider_id.endsWith('1')).every((row) => !row.is_active)).toBe(true)
    expect(rows.rows.filter((row) => row.rider_id.endsWith('2')).every((row) => row.is_active && row.assignment_version === 2)).toBe(true)
  })

  it('adds lifecycle system messages to both current threads', async () => {
    await db.exec(`
      UPDATE orders SET status = 'PICKED_UP', updated_at = now()
      WHERE id = '20000000-0000-0000-0000-000000000001';
    `)
    const rows = await db.query<{ body: string }>(`
      SELECT m.body FROM order_messages m
      JOIN order_conversations c ON c.id = m.conversation_id
      WHERE c.is_active AND m.system_event_key LIKE 'status:PICKED_UP:%'
    `)
    expect(rows.rows).toEqual([
      { body: 'The rider picked up this order.' },
      { body: 'The rider picked up this order.' },
    ])
  })

  it('atomically denies the former rider after reassignment', async () => {
    const denied = await db.query<{ payload: unknown }>(`
      SELECT send_order_chat_message_authorized(
        '20000000-0000-0000-0000-000000000001', 'CUSTOMER_RIDER', 'RIDER',
        '10000000-0000-0000-0000-000000000001', 'stale rider message',
        '40000000-0000-0000-0000-000000000001'
      ) AS payload
    `)
    expect(denied.rows[0].payload).toBeNull()

    const allowed = await db.query<{ payload: { message: { body: string } } }>(`
      SELECT send_order_chat_message_authorized(
        '20000000-0000-0000-0000-000000000001', 'CUSTOMER_RIDER', 'RIDER',
        '10000000-0000-0000-0000-000000000002', 'current rider message',
        '40000000-0000-0000-0000-000000000002'
      ) AS payload
    `)
    expect(allowed.rows[0].payload.message.body).toBe('current rider message')

    const replay = await db.query<{ payload: { replayed: boolean } }>(`
      SELECT send_order_chat_message_authorized(
        '20000000-0000-0000-0000-000000000001', 'CUSTOMER_RIDER', 'RIDER',
        '10000000-0000-0000-0000-000000000002', 'changed replay body',
        '40000000-0000-0000-0000-000000000002'
      ) AS payload
    `)
    expect(replay.rows[0].payload.replayed).toBe(true)
    const count = await db.query<{ count: number }>(`
      SELECT COUNT(*)::int AS count FROM order_messages WHERE body = 'current rider message'
    `)
    expect(count.rows[0].count).toBe(1)
  })

  it('fails closed when the configured post-delivery grace period has expired', async () => {
    await db.exec(`
      UPDATE orders SET status = 'DELIVERED', delivered_at = now() - interval '2 hours', updated_at = now()
      WHERE id = '20000000-0000-0000-0000-000000000001';
    `)
    await expect(db.query(`
      SELECT send_order_chat_message_authorized(
        '20000000-0000-0000-0000-000000000001', 'CUSTOMER_RIDER', 'RIDER',
        '10000000-0000-0000-0000-000000000002', 'too late',
        '40000000-0000-0000-0000-000000000003'
      )
    `)).rejects.toThrow(/chat_read_only/)
  })
})
