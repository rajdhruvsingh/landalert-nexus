import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStoredTheme, setTheme, initThemeListener, applyTheme, type ThemeMode } from "@/lib/theme";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Sun, Moon, Monitor } from "lucide-react";

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const [theme, setCurrentTheme] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = getStoredTheme();
    setCurrentTheme(stored);
    applyTheme(stored);
    const cleanup = initThemeListener();
    return cleanup;
  }, []);

  const handleSelect = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    setTheme(mode);
  };

  if (!mounted) {
    return (
      <div className="flex items-center gap-1">
        <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="h-8 border border-border bg-secondary/30 rounded px-2.5 flex items-center text-xs text-muted-foreground">
          {t("theme.system", "System")}
        </div>
      </div>
    );
  }

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <div className="flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
      <Select
        value={theme}
        onValueChange={(val) => {
          if (val) handleSelect(val as ThemeMode);
        }}
      >
        <SelectTrigger
          aria-label={t("theme.select_theme", "Select color theme")}
          className="h-8 border-border bg-secondary/30 font-sans text-xs px-2.5 min-w-[88px] flex items-center justify-between"
        >
          <span className="capitalize font-medium">
            {theme === "system"
              ? t("theme.system", "System")
              : theme === "light"
                ? t("theme.light", "Light")
                : t("theme.dark", "Dark")}
          </span>
        </SelectTrigger>
        <SelectContent className="border-border bg-surface z-[150]">
          <SelectItem value="system" className="text-xs cursor-pointer">
            <span className="flex items-center gap-2">
              <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t("theme.system", "System")}</span>
            </span>
          </SelectItem>
          <SelectItem value="light" className="text-xs cursor-pointer">
            <span className="flex items-center gap-2">
              <Sun className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t("theme.light", "Light")}</span>
            </span>
          </SelectItem>
          <SelectItem value="dark" className="text-xs cursor-pointer">
            <span className="flex items-center gap-2">
              <Moon className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{t("theme.dark", "Dark")}</span>
            </span>
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
