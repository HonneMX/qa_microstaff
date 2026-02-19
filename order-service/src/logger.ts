const SERVICE_NAME = process.env.SERVICE_NAME || "order-service";
const LOKI_URL = process.env.LOKI_URL || "";

export interface LogContext {
  traceId?: string;
  orderId?: string;
  [key: string]: unknown;
}

function formatLog(level: string, msg: string, context?: LogContext): string {
  const log = {
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    msg,
    ...(context || {}),
  };
  return JSON.stringify(log);
}

function pushToLoki(line: string, level: string, context?: LogContext): void {
  if (!LOKI_URL) return;
  const stream: Record<string, string> = { service: SERVICE_NAME, level };
  if (context?.traceId) stream.traceId = String(context.traceId);
  if (context?.orderId) stream.orderId = String(context.orderId);
  const body = {
    streams: [
      {
        stream,
        values: [[String(Date.now() * 1_000_000), line]],
      },
    ],
  };
  fetch(`${LOKI_URL.replace(/\/$/, "")}/loki/api/v1/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

export const logger = {
  info(msg: string, context?: LogContext): void {
    const line = formatLog("info", msg, context);
    process.stdout.write(line + "\n");
    pushToLoki(line, "info", context);
  },
  error(msg: string, context?: LogContext): void {
    const line = formatLog("error", msg, context);
    process.stderr.write(line + "\n");
    pushToLoki(line, "error", context);
  },
  warn(msg: string, context?: LogContext): void {
    const line = formatLog("warn", msg, context);
    process.stdout.write(line + "\n");
    pushToLoki(line, "warn", context);
  },
  debug(msg: string, context?: LogContext): void {
    if (process.env.NODE_ENV !== "production") {
      const line = formatLog("debug", msg, context);
      process.stdout.write(line + "\n");
      pushToLoki(line, "debug", context);
    }
  },
};
