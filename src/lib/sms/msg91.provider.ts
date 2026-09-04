/**
 * src/lib/sms/msg91.provider.ts
 * ==============================
 * MSG91 SMS Gateway Provider Implementation for LandAlert-Nexus.
 *
 * Implements:
 * - Direct HTTP integration with MSG91 API
 * - Sandboxing via SMS_SANDBOX_MODE (default true) to prevent billable dispatch in dev
 * - Feature flag gating via SMS_ENABLED (default false)
 * - Honest unconfigured state reporting (SMS_PROVIDER_NOT_CONFIGURED)
 * - Injected fetch client for clean unit testing without monkey-patching globals
 */

import type { SmsProvider, SendSmsRequest, SendSmsResponse } from "./types";

export interface Msg91Config {
  authKey?: string | undefined;
  senderId?: string | undefined;
  enabled?: boolean | undefined;
  sandboxMode?: boolean | undefined;
  fetchClient?: typeof fetch | undefined;
}

export class Msg91Provider implements SmsProvider {
  readonly name = "msg91";
  private authKey: string;
  private senderId: string;
  private enabled: boolean;
  private sandboxMode: boolean;
  private fetchClient: typeof fetch;

  constructor(config?: Msg91Config) {
    this.authKey = config?.authKey ?? process.env["MSG91_AUTH_KEY"] ?? "";
    this.senderId = config?.senderId ?? process.env["MSG91_SENDER_ID"] ?? "LNDALT";
    this.enabled = config?.enabled ?? (process.env["SMS_ENABLED"] === "true");
    // Default to true if not explicitly set to "false"
    const sandboxEnv = process.env["SMS_SANDBOX_MODE"];
    this.sandboxMode = config?.sandboxMode ?? (sandboxEnv === undefined || sandboxEnv !== "false");
    this.fetchClient = config?.fetchClient ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.authKey && this.authKey.trim().length > 0 && this.enabled);
  }

  isSandbox(): boolean {
    return this.sandboxMode;
  }

  async send(request: SendSmsRequest): Promise<SendSmsResponse> {
    const rawRecipients = request.recipients
      .map((r) => (typeof r === "string" ? r.trim() : r.phone.trim()))
      .filter(Boolean);

    if (rawRecipients.length === 0) {
      return {
        success: false,
        provider: this.name,
        status: "FAILED",
        error: "No valid recipient phone numbers provided.",
      };
    }

    // Normalise Indian mobile numbers to 10-12 digits
    const cleanedRecipients = rawRecipients.map((phone) => {
      const digits = phone.replace(/\D/g, "");
      if (digits.length === 10) return `91${digits}`;
      return digits;
    });

    // 1. Honesty check: Credentials missing or SMS disabled
    if (!this.isConfigured()) {
      const reason = !this.authKey
        ? "MSG91_AUTH_KEY is not set in environment."
        : "SMS_ENABLED feature flag is set to false.";
      console.warn(`[SMS Gateway] Discarding SMS dispatch: ${reason}`);
      return {
        success: false,
        provider: this.name,
        status: "SMS_PROVIDER_NOT_CONFIGURED",
        error: `SMS provider not configured: ${reason}`,
        details: {
          recipientsCount: cleanedRecipients.length,
          configured: false,
        },
      };
    }

    // 2. Sandbox mode check: Log payload and return simulated success without HTTP request
    if (this.sandboxMode) {
      console.info(
        `[SMS Sandbox] SMS_SANDBOX_MODE=true. Outgoing message to ${cleanedRecipients.length} recipients suppressed:`,
        {
          recipients: cleanedRecipients,
          senderId: this.senderId,
          messagePreview: request.message.slice(0, 80) + (request.message.length > 80 ? "…" : ""),
          language: request.language ?? "en",
        },
      );
      return {
        success: true,
        provider: this.name,
        status: "SMS_SANDBOX_LOGGED",
        messageId: `SANDBOX-MSG91-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        details: {
          simulated: true,
          recipients: cleanedRecipients,
          senderId: this.senderId,
        },
      };
    }

    // 3. Real Production HTTP Dispatch via MSG91 API
    try {
      const endpoint = "https://control.msg91.com/api/v5/flow/";
      const payload = {
        template_id: request.templateId ?? process.env["MSG91_DLT_TE_ID"] ?? "1007160000000000",
        sender: this.senderId,
        short_url: "0",
        recipients: cleanedRecipients.map((mob) => ({
          mobiles: mob,
          message: request.message,
          zone: request.metadata?.["zone_name"] ?? "NER Zone",
          level: request.metadata?.["risk_level"] ?? "Alert",
        })),
      };

      const response = await this.fetchClient(endpoint, {
        method: "POST",
        headers: {
          "authkey": this.authKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({ status: response.status }));

      if (!response.ok || (data && data.type === "error")) {
        const errMsg = data?.message || `MSG91 HTTP ${response.status} ${response.statusText}`;
        console.error("[SMS Gateway] MSG91 API error response:", errMsg);
        return {
          success: false,
          provider: this.name,
          status: "FAILED",
          error: errMsg,
          rawResponse: data,
        };
      }

      const messageId = (data?.message as string) || (data?.request_id as string) || `MSG91-${Date.now()}`;
      return {
        success: true,
        provider: this.name,
        status: "SENT",
        messageId,
        rawResponse: data,
        details: {
          recipients: cleanedRecipients,
          senderId: this.senderId,
        },
      };
    } catch (networkError) {
      const errorMsg = networkError instanceof Error ? networkError.message : String(networkError);
      console.error("[SMS Gateway] Network error dispatching to MSG91:", errorMsg);
      return {
        success: false,
        provider: this.name,
        status: "FAILED",
        error: `Network failure connecting to MSG91: ${errorMsg}`,
      };
    }
  }
}
