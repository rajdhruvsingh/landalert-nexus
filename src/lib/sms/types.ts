/**
 * src/lib/sms/types.ts
 * ====================
 * Authoritative Type Definitions for LandAlert-Nexus SMS Gateway Subsystem.
 */

export interface SmsRecipient {
  phone: string;
  name?: string;
  district?: string;
}

export interface SendSmsRequest {
  recipients: (string | SmsRecipient)[];
  message: string;
  language?: "en" | "as" | "bn" | "ne" | string;
  templateId?: string;
  senderId?: string;
  metadata?: Record<string, unknown>;
}

export type SmsDeliveryStatus =
  | "SENT"
  | "DELIVERED"
  | "FAILED"
  | "SMS_PROVIDER_NOT_CONFIGURED"
  | "SMS_SANDBOX_LOGGED";

export interface SendSmsResponse {
  success: boolean;
  provider: string;
  status: SmsDeliveryStatus;
  messageId?: string;
  rawResponse?: unknown;
  error?: string;
  details?: Record<string, unknown>;
}

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  isSandbox(): boolean;
  send(request: SendSmsRequest): Promise<SendSmsResponse>;
}
