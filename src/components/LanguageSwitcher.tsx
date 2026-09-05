/**
 * src/components/LanguageSwitcher.tsx
 * ===================================
 * Session-persisted multilingual language switcher for LandAlert-Nexus.
 * Allows instant switching between English, Assamese, Bengali, and Nepali.
 */

import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES, setAppLanguage, type SupportedLanguage } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const rawLang = i18n.resolvedLanguage || i18n.language || "en";
  const currentCode = (rawLang.split("-")[0] || "en") as SupportedLanguage;
  const currentLangObj =
    SUPPORTED_LANGUAGES.find((l) => l.code === currentCode) || SUPPORTED_LANGUAGES[0];

  return (
    <div className="flex items-center gap-1">
      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <Select
        value={currentCode}
        onValueChange={(val) => {
          if (val) {
            setAppLanguage(val as SupportedLanguage);
          }
        }}
      >
        <SelectTrigger
          aria-label="Select interface language"
          className="h-8 border-border bg-secondary/30 font-mono text-[0.72rem] tracking-wider uppercase px-2.5 min-w-[100px] flex items-center justify-between"
        >
          <span className="truncate">{currentLangObj.nativeName}</span>
        </SelectTrigger>
        <SelectContent className="border-border bg-surface z-[150] max-h-72">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code} className="font-mono text-xs cursor-pointer">
              <span className="font-medium">{lang.nativeName}</span>
              <span className="ml-1.5 text-[0.65rem] text-muted-foreground">({lang.name})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
