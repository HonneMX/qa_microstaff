import amqp from "amqplib";
import { logger } from "./logger";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const QUEUE_ORDER_REQUESTS = "order_requests";
const QUEUE_PAYMENT_RESULT = "payment_results";

interface AmqpConnection {
  createChannel(): Promise<amqp.Channel>;
  close(): Promise<void>;
}

let connection: AmqpConnection | null = null;
let channel: amqp.Channel | null = null;

export interface OrderRequestMessage {
  orderId: string;
  traceId: string;
  items: { id: string; name: string; priceCents: number; quantity: number }[];
  totalAmountCents: number;
  testError?: "bank_timeout" | "payment_declined" | "payment_service_unavailable";
}

export interface PaymentRequestMessage {
  traceId: string;
  orderId: string;
  amountCents: number;
  testError?: "bank_timeout" | "payment_declined" | "payment_service_unavailable";
}

export interface PaymentResultMessage {
  traceId: string;
  orderId: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export async function connectRabbit(): Promise<void> {
  connection = (await amqp.connect(RABBITMQ_URL)) as unknown as AmqpConnection;
  channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_ORDER_REQUESTS, { durable: true });
  await channel.assertQueue(QUEUE_PAYMENT_RESULT, { durable: true });
  logger.info("RabbitMQ connected");
}

export function getChannel(): amqp.Channel | null {
  return channel;
}

export async function publishOrderRequest(msg: OrderRequestMessage): Promise<boolean> {
  if (!channel) return false;
  return channel.sendToQueue(
    QUEUE_ORDER_REQUESTS,
    Buffer.from(JSON.stringify(msg)),
    { persistent: true }
  );
}

export async function consumeOrderRequests(
  onMessage: (msg: OrderRequestMessage) => Promise<void>
): Promise<void> {
  if (!channel) throw new Error("RabbitMQ channel not ready");
  await channel.prefetch(1);
  await channel.consume(QUEUE_ORDER_REQUESTS, async (raw) => {
    if (!raw) return;
    let traceId = "unknown";
    try {
      const msg: OrderRequestMessage = JSON.parse(raw.content.toString());
      traceId = msg.traceId;
      await onMessage(msg);
      channel!.ack(raw);
    } catch (err) {
      logger.error("Failed to process order request", { traceId, error: String(err) });
      channel!.nack(raw, false, true);
    }
  });
}

export async function consumePaymentResults(
  onMessage: (msg: PaymentResultMessage) => Promise<void>
): Promise<void> {
  if (!channel) throw new Error("RabbitMQ channel not ready");
  await channel.consume(QUEUE_PAYMENT_RESULT, async (raw) => {
    if (!raw) return;
    let traceId = "unknown";
    try {
      const msg: PaymentResultMessage = JSON.parse(raw.content.toString());
      traceId = msg.traceId;
      await onMessage(msg);
      channel!.ack(raw);
    } catch (err) {
      logger.error("Failed to process payment result", { traceId, error: String(err) });
      channel!.nack(raw, false, true);
    }
  });
}

export async function closeRabbit(): Promise<void> {
  if (channel) await channel.close();
  if (connection) await connection.close();
}
