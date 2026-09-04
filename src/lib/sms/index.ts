/**
 * src/lib/sms/index.ts
 * ====================
 * Entry point and factory for SMS gateway providers.
 */

import type { SmsProvider, SendSmsRequest, SendSmsResponse } from "./types";
import { Msg91Provider } from "./msg91.provider";

export * from "./types";
export * from "./msg91.provider";

let defaultProvider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (!defaultProvider) {
    defaultProvider = new Msg91Provider();
  }
  return defaultProvider;
}

export function setSmsProvider(provider: SmsProvider): void {
  defaultProvider = provider;
}

/**
 * High-level helper to dispatch an alert SMS through the active provider.
 */
export async function sendAlertSms(request: SendSmsRequest): Promise<SendSmsResponse> {
  const provider = getSmsProvider();
  return await provider.send(request);
}
