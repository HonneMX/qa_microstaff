import { logger } from "./logger";

const ORDER_API_URL = process.env.ORDER_API_URL || "http://localhost:8080";

export async function notifyOrderStatus(
  orderId: string,
  status: "paid" | "payment_failed",
  detail?: string
): Promise<void> {
  const url = `${ORDER_API_URL.replace(/\/$/, "")}/internal/order-events`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, status, detail }),
    });
    if (!res.ok) {
      logger.warn("Order API internal/order-events non-OK", { orderId, status, statusCode: res.status });
    }
  } catch (err) {
    logger.warn("Failed to notify Order API (SSE)", { orderId, status, error: String(err) });
  }
}
