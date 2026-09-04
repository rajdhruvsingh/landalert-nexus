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
  const currentLang = (i18n.language?.split("-")[0] || "en") as SupportedLanguage;

  return (
    <div className="flex items-center gap-1">
      <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <Select
        value={currentLang}
        onValueChange={(val) => setAppLanguage(val as SupportedLanguage)}
      >
        <SelectTrigger className="h-8 border-border bg-secondary/30 font-mono text-[0.72rem] tracking-wider uppercase px-2.5 min-w-[90px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-border bg-surface z-[150]">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code} className="font-mono text-xs">
              <span className="font-medium">{lang.nativeName}</span>
              <span className="ml-1.5 text-[0.65rem] text-muted-foreground">({lang.code.toUpperCase()})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
