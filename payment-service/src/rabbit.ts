import amqp from "amqplib";
import { logger } from "./logger";
import type { PaymentResultMessage } from "./types";

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672";
const QUEUE_PAYMENT_RESULT = "payment_results";

interface AmqpConnection {
  createChannel(): Promise<amqp.Channel>;
  close(): Promise<void>;
}

let connection: AmqpConnection | null = null;
let channel: amqp.Channel | null = null;

export async function connectRabbit(): Promise<void> {
  connection = (await amqp.connect(RABBITMQ_URL)) as unknown as AmqpConnection;
  channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_PAYMENT_RESULT, { durable: true });
  logger.info("RabbitMQ connected");
}

export function getChannel(): amqp.Channel | null {
  return channel;
}

export async function publishPaymentResult(result: PaymentResultMessage): Promise<boolean> {
  if (!channel) return false;
  return channel.sendToQueue(
    QUEUE_PAYMENT_RESULT,
    Buffer.from(JSON.stringify(result)),
    { persistent: true }
  );
}

export async function closeRabbit(): Promise<void> {
  try {
    if (channel) await channel.close();
  } catch (_) {}
  try {
    if (connection) await connection.close();
  } catch (_) {}
}
