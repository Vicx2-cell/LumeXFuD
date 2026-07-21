-- Bind an order idempotency key to the server-authoritative checkout intent.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_intent_hash TEXT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_intent_hash_format;
ALTER TABLE orders ADD CONSTRAINT orders_intent_hash_format
  CHECK (order_intent_hash IS NULL OR order_intent_hash ~ '^[0-9a-f]{64}$');
