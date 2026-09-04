/**
 * src/lib/i18n.ts
 * ================
 * Multilingual Internationalization (i18n) Engine for LandAlert-Nexus.
 *
 * Supports:
 * - English (en) - Default
 * - Assamese / অসমীয়া (as)
 * - Bengali / বাংলা (bn)
 * - Nepali / नेपाली (ne)
 *
 * Persisted per user session in localStorage under 'landalert_ui_language'.
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import as from "@/locales/as.json";
import bn from "@/locales/bn.json";
import ne from "@/locales/ne.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "as", name: "Assamese", nativeName: "অসমীয়া" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "ne", name: "Nepali", nativeName: "नेपाली" },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const STORAGE_KEY = "landalert_ui_language";

function getStorage(): Storage | null {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as unknown as { localStorage?: Storage }).localStorage
  ) {
    return (globalThis as unknown as { localStorage: Storage }).localStorage;
  }
  return null;
}

function getInitialLanguage(): SupportedLanguage {
  const storage = getStorage();
  if (storage) {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved && ["en", "as", "bn", "ne"].includes(saved)) {
      return saved as SupportedLanguage;
    }
  }
  return "en";
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      as: { translation: as },
      bn: { translation: bn },
      ne: { translation: ne },
    },
    lng: getInitialLanguage(),
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already safe from XSS
    },
    react: {
      useSuspense: false,
    },
  });
}

export function setAppLanguage(lang: SupportedLanguage): void {
  i18n.changeLanguage(lang);
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, lang);
    } catch (err) {
      console.warn("Unable to save UI language to localStorage:", err);
    }
  }
}

export default i18n;
