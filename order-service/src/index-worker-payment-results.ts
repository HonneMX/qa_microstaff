import "./tracing";
import { logger } from "./logger";
import { pool, setOrderPaid, setOrderPaymentFailed } from "./db/client";
import { connectRabbit, consumePaymentResults, closeRabbit } from "./rabbit";
import { connectKafka, publishOrderEvent, disconnectKafka } from "./kafka";
import { notifyOrderStatus } from "./notifyOrderApi";

async function main(): Promise<void> {
  await connectRabbit();
  await connectKafka();

  await consumePaymentResults(async (msg) => {
    const { orderId, success, errorMessage, errorCode } = msg;
    logger.info("Payment result received", { traceId: msg.traceId, orderId, success });
    if (success) {
      await setOrderPaid(orderId);
      await publishOrderEvent("order_paid", { traceId: msg.traceId, orderId });
      await notifyOrderStatus(orderId, "paid");
    } else {
      await setOrderPaymentFailed(orderId, errorMessage || "Payment declined");
      await publishOrderEvent("order_payment_failed", { traceId: msg.traceId, orderId, errorMessage: errorMessage || errorCode });
      await notifyOrderStatus(orderId, "payment_failed", errorMessage);
    }
  });

  logger.info("Order worker (payment results) started: consuming payment_results");
}

main().catch((err) => {
  logger.error("Order worker (payment results) startup failed", { error: String(err) });
  process.exit(1);
});

process.on("SIGTERM", () => {
  disconnectKafka();
  closeRabbit();
  pool.end();
  process.exit(0);
});
