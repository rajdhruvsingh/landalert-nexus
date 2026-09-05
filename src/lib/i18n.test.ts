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

  it("maintains complete key parity and non-empty translations across all 4 languages", () => {
    const languages = [
      { code: "as", bundle: as },
      { code: "bn", bundle: bn },
      { code: "ne", bundle: ne },
    ];

    const sections = Object.keys(en);

    for (const section of sections) {
      const enKeys = Object.keys(en[section]);
      expect(enKeys.length, `en.${section} should have translation keys`).toBeGreaterThan(0);

      for (const key of enKeys) {
        const enValue = (en[section] as Record<string, string>)[key];
        expect(enValue && enValue.trim().length > 0, `en.${section}.${key} is empty`).toBe(true);

        for (const { code, bundle } of languages) {
          const sectionBundle = (bundle as any)[section];
          expect(sectionBundle, `${code} missing entire section ${section}`).toBeDefined();

          const localizedValue = sectionBundle[key];
          expect(
            localizedValue !== undefined,
            `Language ${code} missing key "${section}.${key}"`,
          ).toBe(true);
          expect(
            typeof localizedValue === "string" && localizedValue.trim().length > 0,
            `Language ${code} has empty translation for "${section}.${key}"`,
          ).toBe(true);
        }
      }

      // Check no extra keys in any other language
      for (const { code, bundle } of languages) {
        const bundleKeys = Object.keys((bundle as any)[section] || {});
        for (const bKey of bundleKeys) {
          expect(
            (en[section] as Record<string, string>)[bKey],
            `Language ${code} has extra key "${section}.${bKey}" not found in en.${section}`,
          ).toBeDefined();
        }
      }
    }
  });

  it("fails if any user-facing component or route contains hardcoded JSX string literals", () => {
    const fs = awaitImportFs();
    const path = awaitImportPath();
    const rootDir = path.resolve(__dirname, "..");
    const violations: { file: string; line: number; text: string }[] = [];

    function scan(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "ui") continue; // Exclude shadcn headless primitives
          scan(fullPath);
        } else if (entry.name.endsWith(".tsx")) {
          const lines = fs.readFileSync(fullPath, "utf8").split("\n");
          // Match text inside JSX tags: >Some English words<
          const jsxRegex = />\s*([A-Za-z][A-Za-z0-9 ,.?!—–:;'-]{8,})\s*</g;
          lines.forEach((line: string, idx: number) => {
            // Skip comments and imports
            const trimmed = line.trim();
            if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;
            let match;
            while ((match = jsxRegex.exec(line)) !== null) {
              const text = match[1].trim();
              if (text && !text.startsWith("{") && !text.includes("className")) {
                violations.push({
                  file: path.relative(rootDir, fullPath),
                  line: idx + 1,
                  text,
                });
              }
            }
          });
        }
      }
    }

    scan(path.resolve(__dirname, "../routes"));
    scan(path.resolve(__dirname, "../components"));

    expect(
      violations,
      `Found hardcoded JSX string literals without i18n translation:\n${violations
        .map((v) => `  ${v.file}:${v.line} -> "${v.text}"`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

function awaitImportFs() {
  return require("fs");
}

function awaitImportPath() {
  return require("path");
}


