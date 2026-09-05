import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Eye, Keyboard, Palette, Volume2 } from "lucide-react";

export function AccessibilityDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
          >
            {t("nav.accessibility", "Accessibility")}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px] bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-foreground">
            {t("a11y.dialog_title", "Accessibility Statement & Navigation Aids")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("a11y.dialog_desc", "LandAlert-Nexus is built to government portal standards (WCAG 2.1 AA target) to ensure disaster warnings are accessible to all operators and citizens.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <div className="flex gap-3 rounded border border-border bg-secondary/30 p-3">
            <Eye className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-foreground">{t("a11y.visual_title", "High-Contrast Typography & Colors")}</div>
              <p className="mt-1 text-muted-foreground leading-relaxed">
                {t("a11y.visual_desc", "Set in Atkinson Hyperlegible, a typeface designed for maximum legibility. Risk levels are conveyed through redundant indicators (text labels, scores, and icons), never by color alone.")}
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded border border-border bg-secondary/30 p-3">
            <Keyboard className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-foreground">{t("a11y.keyboard_title", "Full Keyboard Operability")}</div>
              <p className="mt-1 text-muted-foreground leading-relaxed">
                {t("a11y.keyboard_desc", "All interactive components—including the map, zone filters, alert triggers, forms, and dialogs—can be navigated using Tab, Enter, Space, and Esc.")}
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded border border-border bg-secondary/30 p-3">
            <Volume2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-foreground">{t("a11y.screen_reader_title", "Live Screen-Reader Announcements")}</div>
              <p className="mt-1 text-muted-foreground leading-relaxed">
                {t("a11y.screen_reader_desc", "Critical system updates, emergency alert broadcasts, and network connection changes utilize aria-live polite regions to keep assistive technologies informed.")}
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded border border-border bg-secondary/30 p-3">
            <Palette className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-foreground">{t("a11y.theme_title", "System, Light & Dark Theme Adaptation")}</div>
              <p className="mt-1 text-muted-foreground leading-relaxed">
                {t("a11y.theme_desc", "Supports OS-level dark/light mode preference by default, while allowing manual toggling without losing layout consistency or contrast ratios.")}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            className="text-xs"
          >
            {t("common.close", "Close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
