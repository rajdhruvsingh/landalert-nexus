import { describe, it, expect } from "vitest";

describe("Task 4: Mandatory Consent Checkbox Gate Logic", () => {
  function canSubmitForm(opts: {
    hasMedia: boolean;
    consentChecked: boolean;
    submitting: boolean;
  }): boolean {
    if (opts.submitting) return false;
    if (opts.hasMedia && !opts.consentChecked) return false;
    return true;
  }

  function getConsentGiven(opts: {
    hasMedia: boolean;
    consentChecked: boolean;
  }): boolean {
    return opts.hasMedia ? opts.consentChecked : true;
  }

  it("blocks submission when media is attached and consent is not checked", () => {
    const canSubmit = canSubmitForm({
      hasMedia: true,
      consentChecked: false,
      submitting: false,
    });
    expect(canSubmit).toBe(false);
  });

  it("allows submission when media is attached and consent is checked", () => {
    const canSubmit = canSubmitForm({
      hasMedia: true,
      consentChecked: true,
      submitting: false,
    });
    expect(canSubmit).toBe(true);

    const consentGiven = getConsentGiven({
      hasMedia: true,
      consentChecked: true,
    });
    expect(consentGiven).toBe(true);
  });

  it("does not require consent checkbox when submission is text-only (no media)", () => {
    const canSubmit = canSubmitForm({
      hasMedia: false,
      consentChecked: false,
      submitting: false,
    });
    expect(canSubmit).toBe(true);

    const consentGiven = getConsentGiven({
      hasMedia: false,
      consentChecked: false,
    });
    expect(consentGiven).toBe(true);
  });
});
