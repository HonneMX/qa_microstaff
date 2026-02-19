import "./tracing";
import "express";
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { trace } from "@opentelemetry/api";
import { logger } from "./logger";
import { pool, createOrder, getOrderById, setOrderSentToPayment, setOrderPaid, setOrderPaymentFailed, OrderRow } from "./db/client";
import { connectRabbit, publishOrderRequest, consumeOrderRequests, consumePaymentResults, closeRabbit } from "./rabbit";
import { connectKafka, publishPaymentRequest, publishOrderEvent, disconnectKafka } from "./kafka";
import { addOrderListener, notifyOrderStatus } from "./events";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./swagger";

const app = express();
const PORT = Number(process.env.PORT) || 8080;

type RequestWithTraceId = express.Request & { traceId: string };
function getTraceId(req: express.Request): string {
  return (req as unknown as RequestWithTraceId).traceId;
}

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const traceId = (req.headers["x-trace-id"] as string) || uuidv4();
  (req as unknown as RequestWithTraceId).traceId = traceId;
  res.setHeader("X-Trace-Id", traceId);
  const span = trace.getActiveSpan();
  if (span) span.setAttribute("traceId", traceId);
  next();
});

// Swagger UI (OpenAPI) — браузер: http://localhost:8080/api-docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
// Сырая спецификация для импорта в Postman: GET http://localhost:8080/api-docs.json
app.get("/api-docs.json", (_req, res) => res.json(openApiDocument));

// Health
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// GET order
app.get("/api/orders/:id", async (req, res) => {
  const traceId = getTraceId(req);
  const order = await getOrderById(req.params.id);
  if (!order) {
    logger.info("Order not found", { traceId, orderId: req.params.id });
    return res.status(404).json({ error: "Order not found", traceId });
  }
  res.json(orderToResponse(order));
});

// SSE: order status updates
app.get("/api/orders/:id/events", (req, res) => {
  const orderId = req.params.id;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  addOrderListener(orderId, res);
});

type CreateOrderBody = {
  items?: { id: string; name: string; priceCents: number; quantity: number }[];
  totalAmountCents?: number;
  simulateBankDelay?: boolean;
  simulatePaymentDeclined?: boolean;
};

// POST create order
app.post("/api/orders", async (req, res) => {
  const traceId = getTraceId(req);
  const testError = req.headers["x-test-error"] as string | undefined;
  const body = req.body as CreateOrderBody;

  logger.info("Create order request", { traceId, testError });

  const otelTraceId = trace.getActiveSpan()?.spanContext().traceId;

  // 1) Simulated error: order processing failure
  if (testError === "order_processing_failure") {
    logger.error("Simulated error: order_processing_failure", {
      traceId,
      simulated_error: "order_processing_failure",
    });
    return res.status(500).json({
      error: "Order processing failed (simulated)",
      traceId,
      simulated: true,
      ...(otelTraceId && { otelTraceId }),
    });
  }

  // 2) Validation: invalid payload
  const items = body?.items ?? [];
  const totalAmountCents = body?.totalAmountCents ?? items.reduce((s: number, i: { priceCents: number; quantity: number }) => s + i.priceCents * i.quantity, 0);
  if (items.length === 0 || totalAmountCents <= 0) {
    logger.warn("Validation failed: empty cart or invalid amount", { traceId, items: items.length, totalAmountCents });
    return res.status(400).json({
      error: "Invalid order: empty cart or invalid amount",
      traceId,
      ...(otelTraceId && { otelTraceId }),
    });
  }

  const orderId = uuidv4();
  const paymentTestError =
    testError === "bank_timeout"
      ? "bank_timeout"
      : testError === "payment_declined"
      ? "payment_declined"
      : testError === "payment_service_unavailable"
      ? "payment_service_unavailable"
      : body?.simulateBankDelay
      ? "bank_timeout"
      : body?.simulatePaymentDeclined
      ? "payment_declined"
      : undefined;

  const published = await publishOrderRequest({
    orderId,
    traceId,
    items,
    totalAmountCents,
    testError: paymentTestError,
  });
  if (!published) {
    logger.error("Failed to publish order to RabbitMQ", { traceId, orderId });
    return res.status(503).json({
      error: "Order service busy (RabbitMQ unavailable)",
      traceId,
      orderId,
      ...(otelTraceId && { otelTraceId }),
    });
  }

  logger.info("Order submitted to queue", { traceId, orderId });
  res.status(202).json({
    orderId,
    traceId,
    ...(otelTraceId && { otelTraceId }),
    status: "submitted",
  });
});

// Test endpoint: trigger error (returns traceId for investigation)
app.post("/api/test/trigger-error", (req, res) => {
  const traceId = getTraceId(req);
  const type = (req.query.type as string) || req.body?.type;
  const validTypes = ["order_processing_failure", "bank_timeout", "payment_declined", "payment_service_unavailable"];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({
      error: "Invalid type",
      traceId,
      allowed: validTypes,
    });
  }
  logger.error("Test error triggered", { traceId, simulated_error: type });
  if (type === "order_processing_failure") {
    return res.status(500).json({ error: "Simulated: order_processing_failure", traceId, simulated: true });
  }
  res.json({
    message: "Use X-Test-Error header when creating order",
    traceId,
    header: "X-Test-Error",
    value: type,
  });
});

function orderToResponse(row: OrderRow): object {
  return {
    id: row.id,
    traceId: row.trace_id,
    status: row.status,
    amountCents: row.amount_cents,
    items: row.items,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function runMigration(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
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
    logger.info("DB migration completed");
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  await runMigration();
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
      notifyOrderStatus(orderId, "payment_failed", "Failed to send to payment");
      return;
    }
    await setOrderSentToPayment(orderId);
    await publishOrderEvent("order_created", { traceId, orderId, amountCents: totalAmountCents });
    logger.info("Order sent to payment via Kafka", { traceId, orderId });
  });

  await consumePaymentResults(async (msg) => {
    const { orderId, success, errorMessage } = msg;
    logger.info("Payment result received", { traceId: msg.traceId, orderId, success });
    if (success) {
      await setOrderPaid(orderId);
      await publishOrderEvent("order_paid", { traceId: msg.traceId, orderId });
      notifyOrderStatus(orderId, "paid");
    } else {
      await setOrderPaymentFailed(orderId, errorMessage || "Payment declined");
      await publishOrderEvent("order_payment_failed", { traceId: msg.traceId, orderId, errorMessage: errorMessage || msg.errorCode });
      notifyOrderStatus(orderId, "payment_failed", errorMessage);
    }
  });

  app.listen(PORT, () => {
    logger.info("Order service listening", { port: PORT });
  });
}

main().catch((err) => {
  logger.error("Startup failed", { error: String(err) });
  process.exit(1);
});

process.on("SIGTERM", () => {
  disconnectKafka();
  closeRabbit();
  pool.end();
  process.exit(0);
});
