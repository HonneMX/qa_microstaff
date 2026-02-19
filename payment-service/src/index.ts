import "./tracing";
import { trace } from "@opentelemetry/api";
import { logger } from "./logger";
import { connectRabbit, closeRabbit } from "./rabbit";
import { connectKafkaAndConsume, disconnectKafka } from "./kafka";
import type { PaymentRequestMessage, PaymentResultMessage } from "./types";

const BANK_DELAY_MS = 15000; // 15 sec for demo

async function processPayment(msg: PaymentRequestMessage): Promise<PaymentResultMessage> {
  const { traceId, orderId, amountCents, testError } = msg;
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute("traceId", traceId);
    span.setAttribute("orderId", orderId);
  }
  logger.info("Processing payment", { traceId, orderId, amountCents, testError });

  // Simulated: bank timeout (long delay)
  if (testError === "bank_timeout") {
    logger.info("Simulated bank delay", {
      traceId,
      orderId,
      simulated_error: "bank_timeout",
      delayMs: BANK_DELAY_MS,
    });
    await new Promise((r) => setTimeout(r, BANK_DELAY_MS));
    return {
      traceId,
      orderId,
      success: false,
      errorCode: "BANK_TIMEOUT",
      errorMessage: "Превышено время ответа от банка (имитация)",
    };
  }

  // Simulated: payment declined
  if (testError === "payment_declined") {
    logger.warn("Simulated payment declined", {
      traceId,
      orderId,
      simulated_error: "payment_declined",
    });
    return {
      traceId,
      orderId,
      success: false,
      errorCode: "INSUFFICIENT_FUNDS",
      errorMessage: "Недостаточно средств (имитация)",
    };
  }

  // Simulated: payment service unavailable (we still respond with error so flow is traceable)
  if (testError === "payment_service_unavailable") {
    logger.error("Simulated payment service unavailable", {
      traceId,
      orderId,
      simulated_error: "payment_service_unavailable",
    });
    return {
      traceId,
      orderId,
      success: false,
      errorCode: "SERVICE_UNAVAILABLE",
      errorMessage: "Сервис оплаты временно недоступен (имитация)",
    };
  }

  // Success
  logger.info("Payment completed", { traceId, orderId });
  return { traceId, orderId, success: true };
}

async function main(): Promise<void> {
  await connectRabbit();
  await connectKafkaAndConsume(processPayment);
  logger.info("Payment service ready: consuming from Kafka (payment_requests), sending results to RabbitMQ (payment_results)");
}

main().catch((err) => {
  logger.error("Startup failed", { error: String(err) });
  process.exit(1);
});

process.on("SIGTERM", () => {
  disconnectKafka();
  closeRabbit();
  process.exit(0);
});
