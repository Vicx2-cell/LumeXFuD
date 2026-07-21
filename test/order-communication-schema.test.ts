import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

let db: PGlite

beforeAll(async () => {
  db = await PGlite.create()
  await db.exec(`
    CREATE TABLE settings (id text PRIMARY KEY, value jsonb NOT NULL);
    CREATE TABLE riders (id uuid PRIMARY KEY);
    CREATE TABLE orders (id uuid PRIMARY KEY);
  `)
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '122_order_communication_schema.sql'),
    'utf8',
  )
  await db.exec(sql)
}, 30_000)

describe('migration 122 — order communication schema', () => {
  it('installs the configured post-order grace period', async () => {
    const result = await db.query<{ minutes: number }>(
      `SELECT (value->>'minutes')::int AS minutes FROM settings WHERE id = 'order_chat_grace_period'`,
    )
    expect(result.rows).toEqual([{ minutes: 60 }])
  })

  it('only accepts the two rider-scoped channels', async () => {
    await db.exec(`
      INSERT INTO riders(id) VALUES ('10000000-0000-0000-0000-000000000001');
      INSERT INTO orders(id) VALUES ('20000000-0000-0000-0000-000000000001');
      INSERT INTO order_conversations(order_id, channel, rider_id, assignment_version)
      VALUES (
        '20000000-0000-0000-0000-000000000001',
        'CUSTOMER_RIDER',
        '10000000-0000-0000-0000-000000000001',
        1
      );
    `)

    await expect(db.exec(`
      INSERT INTO order_conversations(order_id, channel, rider_id, assignment_version)
      VALUES (
        '20000000-0000-0000-0000-000000000001',
        'CUSTOMER_VENDOR',
        '10000000-0000-0000-0000-000000000001',
        1
      );
    `)).rejects.toThrow()
  })

  it('prevents two active conversations for one order channel', async () => {
    await expect(db.exec(`
      INSERT INTO order_conversations(order_id, channel, rider_id, assignment_version)
      VALUES (
        '20000000-0000-0000-0000-000000000001',
        'CUSTOMER_RIDER',
        '10000000-0000-0000-0000-000000000001',
        2
      );
    `)).rejects.toThrow()
  })

  it('enforces immutable message identity shape and idempotency', async () => {
    const conversation = await db.query<{ id: string }>(
      `SELECT id::text FROM order_conversations LIMIT 1`,
    )
    const id = conversation.rows[0].id
    const insert = `
      INSERT INTO order_messages(
        conversation_id, order_id, sender_id, sender_type, body, client_message_id
      ) VALUES (
        '${id}',
        '20000000-0000-0000-0000-000000000001',
        '30000000-0000-0000-0000-000000000001',
        'CUSTOMER',
        'Where are you?',
        '40000000-0000-0000-0000-000000000001'
      );
    `
    await db.exec(insert)
    await expect(db.exec(insert)).rejects.toThrow()
    await expect(db.exec(`UPDATE order_messages SET body = 'tampered'`)).rejects.toThrow(
      /immutable/i,
    )

    await expect(db.exec(`
      INSERT INTO order_messages(conversation_id, order_id, sender_type, message_type, body)
      VALUES (
        '${id}',
        '20000000-0000-0000-0000-000000000001',
        'CUSTOMER',
        'SYSTEM',
        'invalid identity'
      );
    `)).rejects.toThrow()
  })

  it('cannot attach a message or read cursor to the wrong conversation', async () => {
    await db.exec(`
      INSERT INTO orders(id) VALUES ('20000000-0000-0000-0000-000000000002');
      INSERT INTO order_conversations(order_id, channel, rider_id, assignment_version)
      VALUES (
        '20000000-0000-0000-0000-000000000002',
        'VENDOR_RIDER',
        '10000000-0000-0000-0000-000000000001',
        1
      );
    `)
    const conversations = await db.query<{ id: string; order_id: string }>(
      `SELECT id::text, order_id::text FROM order_conversations ORDER BY order_id`,
    )
    await expect(db.exec(`
      INSERT INTO order_messages(conversation_id, order_id, sender_id, sender_type, body)
      VALUES (
        '${conversations.rows[0].id}',
        '${conversations.rows[1].order_id}',
        '30000000-0000-0000-0000-000000000001',
        'CUSTOMER',
        'cross-order injection'
      );
    `)).rejects.toThrow()
  })
})
