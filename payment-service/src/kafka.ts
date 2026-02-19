import { Kafka } from "kafkajs";
import { logger } from "./logger";
import type { PaymentRequestMessage, PaymentResultMessage } from "./types";
import { publishPaymentResult } from "./rabbit";

const KAFKA_BROKERS = process.env.KAFKA_BROKERS || "kafka:9092";
const TOPIC_PAYMENT_REQUESTS = "payment_requests";
const GROUP_ID = "payment-service";

let consumer: Awaited<ReturnType<Kafka["consumer"]>> | null = null;

export async function connectKafkaAndConsume(
  processPayment: (msg: PaymentRequestMessage) => Promise<PaymentResultMessage>
): Promise<void> {
  try {
    const kafka = new Kafka({
      clientId: "payment-service",
      brokers: KAFKA_BROKERS.split(","),
    });
    consumer = kafka.consumer({ groupId: GROUP_ID });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC_PAYMENT_REQUESTS, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        const traceId = message.headers?.traceId?.toString() || "unknown";
        try {
          const msg: PaymentRequestMessage = JSON.parse(message.value?.toString() || "{}");
          const result = await processPayment(msg);
          const sent = await publishPaymentResult(result);
          if (!sent) {
            logger.error("Failed to send payment result to RabbitMQ", { traceId, orderId: msg.orderId });
          }
        } catch (err) {
          logger.error("Failed to process payment request from Kafka", {
            traceId,
            topic,
            partition,
            error: String(err),
          });
        }
      },
    });
    logger.info("Payment service consuming from Kafka topic payment_requests");
  } catch (err) {
    logger.error("Kafka connect/consume failed", { error: String(err) });
    throw err;
  }
}

export async function disconnectKafka(): Promise<void> {
  if (consumer) await consumer.disconnect().catch(() => {});
}
