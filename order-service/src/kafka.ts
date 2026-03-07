import { Kafka } from "kafkajs";
import { logger } from "./logger";

const KAFKA_BROKERS = process.env.KAFKA_BROKERS || "kafka:9092";
const TOPIC_ORDER_EVENTS = "order-events";
const TOPIC_PAYMENT_REQUESTS = "payment_requests";

let kafka: Kafka | null = null;
let producer: Awaited<ReturnType<Kafka["producer"]>> | null = null;

export async function connectKafka(): Promise<void> {
  try {
    const clientId = process.env.SERVICE_NAME || "order-service";
    kafka = new Kafka({
      clientId,
      brokers: KAFKA_BROKERS.split(","),
    });
    producer = kafka.producer();
    await producer.connect();
    logger.info("Kafka producer connected");
  } catch (err) {
    logger.warn("Kafka unavailable, events will not be published", { error: String(err) });
  }
}

async function reconnectProducer(): Promise<boolean> {
  if (!kafka) return false;
  try {
    if (producer) await producer.disconnect().catch(() => {});
    producer = kafka.producer();
    await producer.connect();
    logger.info("Kafka producer reconnected");
    return true;
  } catch (err) {
    logger.warn("Kafka producer reconnect failed", { error: String(err) });
    return false;
  }
}

export interface PaymentRequestMessage {
  traceId: string;
  orderId: string;
  amountCents: number;
  testError?: "bank_timeout" | "payment_declined" | "payment_service_unavailable";
}

export async function publishPaymentRequest(msg: PaymentRequestMessage): Promise<boolean> {
  const send = async (): Promise<boolean> => {
    if (!producer) return false;
    await producer.send({
      topic: TOPIC_PAYMENT_REQUESTS,
      messages: [
        { key: msg.orderId, value: JSON.stringify(msg), headers: { traceId: msg.traceId } },
      ],
    });
    logger.debug("Kafka payment request published", { orderId: msg.orderId });
    return true;
  };
  try {
    return await send();
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes("disconnected") && (await reconnectProducer())) {
      try {
        return await send();
      } catch (retryErr) {
        logger.warn("Failed to publish payment request to Kafka after reconnect", { orderId: msg.orderId, error: String(retryErr) });
        return false;
      }
    }
    logger.warn("Failed to publish payment request to Kafka", { orderId: msg.orderId, error: errStr });
    return false;
  }
}

export async function publishOrderEvent(
  event: "order_created" | "order_paid" | "order_payment_failed",
  payload: { traceId: string; orderId: string; [key: string]: unknown }
): Promise<void> {
  const send = async (): Promise<void> => {
    if (!producer) return;
    await producer.send({
      topic: TOPIC_ORDER_EVENTS,
      messages: [
        {
          key: payload.orderId,
          value: JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() }),
          headers: { traceId: payload.traceId },
        },
      ],
    });
    logger.debug("Kafka event published", { event, orderId: payload.orderId });
  };
  try {
    await send();
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes("disconnected") && (await reconnectProducer())) {
      try {
        await send();
      } catch (retryErr) {
        logger.warn("Failed to publish Kafka event after reconnect", { event, error: String(retryErr) });
      }
      return;
    }
    logger.warn("Failed to publish Kafka event", { event, error: errStr });
  }
}

export async function disconnectKafka(): Promise<void> {
  if (producer) await producer.disconnect().catch(() => {});
}
