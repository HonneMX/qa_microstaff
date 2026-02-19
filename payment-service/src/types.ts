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
