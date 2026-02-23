import "./tracing";
import { logger } from "./logger";
import { pool, createOrder, setOrderSentToPayment, setOrderPaymentFailed } from "./db/client";
import { connectRabbit, consumeOrderRequests, closeRabbit } from "./rabbit";
import { connectKafka, publishPaymentRequest, publishOrderEvent, disconnectKafka } from "./kafka";
import { notifyOrderStatus } from "./notifyOrderApi";

async function main(): Promise<void> {
  await connectRabbit();
  await connectKafka();

  await consumeOrderRequests(async (msg) => {
    const { orderId, traceId, items, totalAmountCents, testError } = msg;
    try {
      await createOrder(orderId, traceId, totalAmountCents, items);
    } catch (err) {
      logger.error("DB error creating order from queue", { traceId, orderId, error: String(err) });
      return;
    }
    const published = await publishPaymentRequest({
      traceId,
      orderId,
      amountCents: totalAmountCents,
      testError,
    });
    if (!published) {
      logger.error("Failed to send payment request to Kafka", { traceId, orderId });
      await setOrderPaymentFailed(orderId, "Failed to send to payment (Kafka)");
      await notifyOrderStatus(orderId, "payment_failed", "Failed to send to payment");
      return;
    }
    await setOrderSentToPayment(orderId);
    await publishOrderEvent("order_created", { traceId, orderId, amountCents: totalAmountCents });
    logger.info("Order sent to payment via Kafka", { traceId, orderId });
  });

  logger.info("Order worker (orders) started: consuming order_requests");
}

main().catch((err) => {
  logger.error("Order worker (orders) startup failed", { error: String(err) });
  process.exit(1);
});

process.on("SIGTERM", () => {
  disconnectKafka();
  closeRabbit();
  pool.end();
  process.exit(0);
});
