/**
 * src/lib/sms.test.ts
 * ===================
 * Automated Smoke and Unit Test Suite for LandAlert-Nexus SMS Gateway.
 *
 * NOTE: Uses a dedicated test-only mocked HTTP client (clearly labeled MOCK_TEST_CLIENT).
 * No mock code exists in production paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Msg91Provider } from "./sms/msg91.provider";
import type { SendSmsRequest } from "./sms/types";

describe("SMS Gateway Subsystem & MSG91 Provider", () => {
  const sampleRequest: SendSmsRequest = {
    recipients: ["9876543210", "919123456789"],
    message: "SEVERE landslide risk in Tamenglong, Manipur. Avoid slope-cut roads.",
    language: "en",
    metadata: {
      zone_id: 1,
      zone_name: "Tamenglong",
      risk_level: "Severe",
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports SMS_PROVIDER_NOT_CONFIGURED when MSG91_AUTH_KEY is absent", async () => {
    const provider = new Msg91Provider({
      authKey: "",
      enabled: true,
      sandboxMode: false,
    });

    expect(provider.isConfigured()).toBe(false);
    const result = await provider.send(sampleRequest);

    expect(result.success).toBe(false);
    expect(result.status).toBe("SMS_PROVIDER_NOT_CONFIGURED");
    expect(result.error).toContain("MSG91_AUTH_KEY is not set");
  });

  it("reports SMS_PROVIDER_NOT_CONFIGURED when SMS_ENABLED is false", async () => {
    const provider = new Msg91Provider({
      authKey: "dummy_auth_key_123",
      enabled: false,
      sandboxMode: false,
    });

    expect(provider.isConfigured()).toBe(false);
    const result = await provider.send(sampleRequest);

    expect(result.success).toBe(false);
    expect(result.status).toBe("SMS_PROVIDER_NOT_CONFIGURED");
    expect(result.error).toContain("SMS_ENABLED feature flag is set to false");
  });

  it("operates in SMS_SANDBOX_MODE by default, suppressing billable outbound HTTP calls", async () => {
    const MOCK_TEST_FETCH = vi.fn();

    const provider = new Msg91Provider({
      authKey: "test_msg91_key_9999",
      enabled: true,
      sandboxMode: true,
      fetchClient: MOCK_TEST_FETCH as unknown as typeof fetch,
    });

    expect(provider.isConfigured()).toBe(true);
    expect(provider.isSandbox()).toBe(true);

    const result = await provider.send(sampleRequest);

    expect(result.success).toBe(true);
    expect(result.status).toBe("SMS_SANDBOX_LOGGED");
    expect(result.messageId).toContain("SANDBOX-MSG91-");
    expect(MOCK_TEST_FETCH).not.toHaveBeenCalled();
  });

  it("dispatches real HTTP payload to MSG91 when configured and sandbox is disabled", async () => {
    let capturedUrl = "";
    let capturedOptions: any = undefined;

    // Test-only mock HTTP client
    const MOCK_TEST_FETCH = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedOptions = init;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          type: "success",
          message: "MSG91-REQ-778899",
        }),
      } as Response;
    });

    const provider = new Msg91Provider({
      authKey: "real_format_msg91_auth_key_abc",
      senderId: "LNDALT",
      enabled: true,
      sandboxMode: false,
      fetchClient: MOCK_TEST_FETCH as unknown as typeof fetch,
    });

    const result = await provider.send(sampleRequest);

    expect(result.success).toBe(true);
    expect(result.status).toBe("SENT");
    expect(result.messageId).toBe("MSG91-REQ-778899");
    expect(capturedUrl).toBe("https://control.msg91.com/api/v5/flow/");

    const headers = capturedOptions?.headers as Record<string, string>;
    expect(headers["authkey"]).toBe("real_format_msg91_auth_key_abc");
    expect(headers["Content-Type"]).toBe("application/json");

    const sentBody = JSON.parse(capturedOptions?.body as string);
    expect(sentBody.sender).toBe("LNDALT");
    expect(sentBody.recipients.length).toBe(2);
    expect(sentBody.recipients[0].mobiles).toBe("919876543210");
  });

  it("handles MSG91 API error responses with descriptive error details", async () => {
    const MOCK_TEST_FETCH_ERROR = vi.fn(async () => {
      return {
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({
          type: "error",
          message: "Invalid Auth Key or IP not whitelisted",
        }),
      } as Response;
    });

    const provider = new Msg91Provider({
      authKey: "invalid_key",
      enabled: true,
      sandboxMode: false,
      fetchClient: MOCK_TEST_FETCH_ERROR as unknown as typeof fetch,
    });

    const result = await provider.send(sampleRequest);

    expect(result.success).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("Invalid Auth Key or IP not whitelisted");
  });

  it("gracefully catches low-level network failures", async () => {
    const MOCK_TEST_FETCH_THROW = vi.fn(async () => {
      throw new Error("DNS resolution failed for control.msg91.com");
    });

    const provider = new Msg91Provider({
      authKey: "valid_key",
      enabled: true,
      sandboxMode: false,
      fetchClient: MOCK_TEST_FETCH_THROW as unknown as typeof fetch,
    });

    const result = await provider.send(sampleRequest);

    expect(result.success).toBe(false);
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("Network failure connecting to MSG91");
  });
});
