import { pool } from "./client";

async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      trace_id VARCHAR(36) NOT NULL,
      status VARCHAR(32) NOT NULL,
      amount_cents INTEGER NOT NULL,
      items JSONB NOT NULL DEFAULT '[]',
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_orders_trace_id ON orders(trace_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  `);
  console.log("Migration completed");
  process.exit(0);
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
