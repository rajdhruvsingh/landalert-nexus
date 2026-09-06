import { describe, it, expect } from "vitest";
import { SUPPORTED_LANGUAGES } from "./i18n";
import en from "@/locales/en.json";
import hi from "@/locales/hi.json";
import bn from "@/locales/bn.json";
import as from "@/locales/as.json";
import ne from "@/locales/ne.json";
import mni from "@/locales/mni.json";
import lus from "@/locales/lus.json";
import kha from "@/locales/kha.json";
import grt from "@/locales/grt.json";

describe("i18n Localization Integrity", () => {
  it("supports all 9 required languages with correct native representations", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(codes).toContain("en");
    expect(codes).toContain("hi");
    expect(codes).toContain("bn");
    expect(codes).toContain("as");
    expect(codes).toContain("ne");
    expect(codes).toContain("mni");
    expect(codes).toContain("lus");
    expect(codes).toContain("kha");
    expect(codes).toContain("grt");

    // Native display names required by user
    const langMap = Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l.code, l.nativeName]));
    expect(langMap["en"]).toBe("English");
    expect(langMap["hi"]).toBe("हिन्दी");
    expect(langMap["bn"]).toBe("বাংলা");
    expect(langMap["as"]).toBe("অসমীয়া");
    expect(langMap["ne"]).toBe("नेपाली");
    expect(langMap["mni"]).toBe("মণিপুরী");
    expect(langMap["lus"]).toBe("Mizo");
    expect(langMap["kha"]).toBe("Khasi");
    expect(langMap["grt"]).toBe("Garo");
  });

  it("maintains top-level section key parity across all locales", () => {
    const enSections = Object.keys(en).sort();
    const allLocales = [
      { code: "hi", dict: hi },
      { code: "bn", dict: bn },
      { code: "as", dict: as },
      { code: "ne", dict: ne },
      { code: "mni", dict: mni },
      { code: "lus", dict: lus },
      { code: "kha", dict: kha },
      { code: "grt", dict: grt },
    ];

    for (const { code, dict } of allLocales) {
      for (const sec of enSections) {
        expect(dict, `Locale ${code} missing top-level section ${sec}`).toHaveProperty(sec);
      }
    }
  });

  it("has translated core UI keys without English fallback in all non-English locales", () => {
    const nonEnLocales = [
      { code: "hi", dict: hi as Record<string, any> },
      { code: "bn", dict: bn as Record<string, any> },
      { code: "as", dict: as as Record<string, any> },
      { code: "ne", dict: ne as Record<string, any> },
      { code: "mni", dict: mni as Record<string, any> },
      { code: "lus", dict: lus as Record<string, any> },
      { code: "kha", dict: kha as Record<string, any> },
      { code: "grt", dict: grt as Record<string, any> },
    ];

    for (const { code, dict } of nonEnLocales) {
      // nav.home should not be English 'Home'
      expect(dict["nav"].home).not.toBe("Home");
      // risk_levels.High should not be 'High'
      expect(dict["risk_levels"].High).not.toBe("High");
      // header.gov_title should not be English
      expect(dict["header"].gov_title).not.toBe("GOVERNMENT OF INDIA");
    }
  });
});
