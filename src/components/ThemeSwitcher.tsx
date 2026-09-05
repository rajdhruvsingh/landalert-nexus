import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getStoredTheme, setTheme, initThemeListener, type ThemeMode } from "@/lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sun, Moon, Monitor } from "lucide-react";

export function ThemeSwitcher() {
  const { t } = useTranslation();
  const [theme, setCurrentTheme] = useState<ThemeMode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCurrentTheme(getStoredTheme());
    const cleanup = initThemeListener();
    return cleanup;
  }, []);

  const handleSelect = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    setTheme(mode);
  };

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Theme selector"
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground rounded transition-colors"
      >
        <Monitor className="h-3.5 w-3.5" />
        <span className="capitalize">{t("theme.system", "System")}</span>
      </button>
    );
  }

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("theme.select_theme", "Select color theme")}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <Icon className="h-3.5 w-3.5 text-primary" />
          <span className="capitalize">
            {theme === "system"
              ? t("theme.system", "System")
              : theme === "light"
                ? t("theme.light", "Light")
                : t("theme.dark", "Dark")}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36 z-[150] bg-surface text-foreground border-border">
        <DropdownMenuItem
          onClick={() => handleSelect("system")}
          className={`flex items-center gap-2 text-xs cursor-pointer ${theme === "system" ? "font-semibold text-primary" : ""}`}
        >
          <Monitor className="h-3.5 w-3.5" />
          <span>{t("theme.system", "System")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleSelect("light")}
          className={`flex items-center gap-2 text-xs cursor-pointer ${theme === "light" ? "font-semibold text-primary" : ""}`}
        >
          <Sun className="h-3.5 w-3.5" />
          <span>{t("theme.light", "Light")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleSelect("dark")}
          className={`flex items-center gap-2 text-xs cursor-pointer ${theme === "dark" ? "font-semibold text-primary" : ""}`}
        >
          <Moon className="h-3.5 w-3.5" />
          <span>{t("theme.dark", "Dark")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
