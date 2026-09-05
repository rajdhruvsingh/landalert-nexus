import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleApiRequest } from "./api.router";

describe("Task 2: MEDIA_UPLOAD_ENABLED Feature Flag & API Endpoint Checks", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("GET /api/field-observations/status reports media upload configuration", async () => {
    process.env["MEDIA_UPLOAD_ENABLED"] = "false";
    const req1 = new Request("http://localhost:3000/api/field-observations/status");
    const res1 = await handleApiRequest(req1);
    expect(res1?.status).toBe(200);
    const body1 = await res1?.json();
    expect(body1).toEqual({ mediaUploadEnabled: false });

    process.env["MEDIA_UPLOAD_ENABLED"] = "true";
    const req2 = new Request("http://localhost:3000/api/field-observations/status");
    const res2 = await handleApiRequest(req2);
    expect(res2?.status).toBe(200);
    const body2 = await res2?.json();
    expect(body2).toEqual({ mediaUploadEnabled: true });
  });

  it("POST /api/field-observations/upload rejects with 403 MEDIA_UPLOAD_DISABLED when flag is false", async () => {
    process.env["MEDIA_UPLOAD_ENABLED"] = "false";

    const formData = new FormData();
    const fakeBlob = new Blob(["fake image data"], { type: "image/jpeg" });
    formData.append("file", fakeBlob, "test.jpg");
    formData.append("zoneId", "1");

    const req = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-authenticated-citizen",
      },
      body: formData,
    });

    const res = await handleApiRequest(req);
    expect(res?.status).toBe(403);
    const body = await res?.json();
    expect(body?.code).toBe("MEDIA_UPLOAD_DISABLED");
  });

  it("POST /api/field-observations/upload rejects unauthenticated requests with 401 UNAUTHORIZED when flag is true", async () => {
    process.env["MEDIA_UPLOAD_ENABLED"] = "true";

    const formData = new FormData();
    const fakeBlob = new Blob(["fake image data"], { type: "image/jpeg" });
    formData.append("file", fakeBlob, "test.jpg");
    formData.append("zoneId", "1");

    // No Authorization header
    const req = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      body: formData,
    });

    const res = await handleApiRequest(req);
    expect(res?.status).toBe(401);
    const body = await res?.json();
    expect(body?.code).toBe("UNAUTHORIZED");
  });

  it("POST /api/field-observations/upload succeeds with 201 when flag is true and session is authenticated", async () => {
    process.env["MEDIA_UPLOAD_ENABLED"] = "true";

    const formData = new FormData();
    const fakeBlob = new Blob(["fake image data"], { type: "image/jpeg" });
    formData.append("file", fakeBlob, "observation_hillside.jpg");
    formData.append("zoneId", "1");

    const req = new Request("http://localhost:3000/api/field-observations/upload", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-authenticated-citizen",
      },
      body: formData,
    });

    const res = await handleApiRequest(req);
    expect(res?.status).toBe(201);
    const body = await res?.json();
    expect(body?.success).toBe(true);
    expect(body?.url).toBeDefined();
    expect(body?.mimeType).toBe("image/jpeg");
  });
});
