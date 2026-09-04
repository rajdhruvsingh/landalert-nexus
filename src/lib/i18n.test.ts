import { describe, it, expect, beforeEach, vi } from "vitest";
import i18n, { setAppLanguage, SUPPORTED_LANGUAGES } from "./i18n";
import en from "@/locales/en.json";
import as from "@/locales/as.json";
import bn from "@/locales/bn.json";
import ne from "@/locales/ne.json";

describe("Multilingual UI (i18n) Support", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, val: string) => store.set(key, val),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    });
  });

  it("supports English, Assamese, Bengali, and Nepali", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(codes).toContain("en");
    expect(codes).toContain("as");
    expect(codes).toContain("bn");
    expect(codes).toContain("ne");
  });

  it("contains consistent emergency risk keys across all translation bundles", () => {
    const bundles = [
      { lang: "en", res: en },
      { lang: "as", res: as },
      { lang: "bn", res: bn },
      { lang: "ne", res: ne },
    ];

    for (const { lang, res } of bundles) {
      expect(res.risk_levels.Low, `Missing Low in ${lang}`).toBeDefined();
      expect(res.risk_levels.Moderate, `Missing Moderate in ${lang}`).toBeDefined();
      expect(res.risk_levels.High, `Missing High in ${lang}`).toBeDefined();
      expect(res.risk_levels.Severe, `Missing Severe in ${lang}`).toBeDefined();

      expect(res.road_status.open, `Missing road open in ${lang}`).toBeDefined();
      expect(res.road_status.blocked, `Missing road blocked in ${lang}`).toBeDefined();

      expect(res.field_observation.consent_notice, `Missing consent in ${lang}`).toBeDefined();
    }
  });

  it("persists language selection across user sessions", () => {
    setAppLanguage("as");
    expect(i18n.language).toBe("as");
    expect(localStorage.getItem("landalert_ui_language")).toBe("as");

    setAppLanguage("ne");
    expect(i18n.language).toBe("ne");
    expect(localStorage.getItem("landalert_ui_language")).toBe("ne");

    // Reset back to English
    setAppLanguage("en");
    expect(i18n.language).toBe("en");
  });
});
