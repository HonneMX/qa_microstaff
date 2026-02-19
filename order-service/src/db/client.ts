import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL || "postgresql://marketplace:marketplace_secret@localhost:5432/marketplace";

export const pool = new Pool({ connectionString });

export type OrderStatus = "created" | "sent_to_payment" | "paid" | "payment_failed";

export interface OrderRow {
  id: string;
  trace_id: string;
  status: OrderStatus;
  amount_cents: number;
  items: unknown;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function getOrderById(id: string): Promise<OrderRow | null> {
  const result = await pool.query(
    "SELECT id, trace_id, status, amount_cents, items, error_message, created_at, updated_at FROM orders WHERE id = $1",
    [id]
  );
  return result.rows[0] || null;
}

export async function createOrder(
  id: string,
  traceId: string,
  amountCents: number,
  items: unknown
): Promise<void> {
  await pool.query(
    `INSERT INTO orders (id, trace_id, status, amount_cents, items, created_at, updated_at)
     VALUES ($1, $2, 'created', $3, $4, NOW(), NOW())`,
    [id, traceId, amountCents, JSON.stringify(items)]
  );
}

export async function setOrderSentToPayment(id: string): Promise<void> {
  await pool.query(
    "UPDATE orders SET status = 'sent_to_payment', updated_at = NOW() WHERE id = $1",
    [id]
  );
}

export async function setOrderPaid(id: string): Promise<void> {
  await pool.query(
    "UPDATE orders SET status = 'paid', updated_at = NOW() WHERE id = $1",
    [id]
  );
}

export async function setOrderPaymentFailed(id: string, errorMessage: string): Promise<void> {
  await pool.query(
    "UPDATE orders SET status = 'payment_failed', error_message = $2, updated_at = NOW() WHERE id = $1",
    [id, errorMessage]
  );
}
