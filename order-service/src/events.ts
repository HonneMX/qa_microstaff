import { Response } from "express";
import { logger } from "./logger";

const orderListeners = new Map<string, Response>();

export function addOrderListener(orderId: string, res: Response): void {
  orderListeners.set(orderId, res);
  res.on("close", () => orderListeners.delete(orderId));
}

export function notifyOrderStatus(
  orderId: string,
  status: "paid" | "payment_failed",
  detail?: string
): void {
  const res = orderListeners.get(orderId);
  if (!res) return;
  try {
    const payload = JSON.stringify({ orderId, status, detail });
    res.write(`data: ${payload}\n\n`);
    res.end();
  } catch (err) {
    logger.error("Failed to send SSE", { orderId, error: String(err) });
  }
  orderListeners.delete(orderId);
}
