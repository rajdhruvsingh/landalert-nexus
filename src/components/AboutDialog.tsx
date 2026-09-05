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

export function AboutDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("nav.about", "About")}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px] bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-foreground">
            {t("about.dialog_title", "About LandAlert-Nexus")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("about.dialog_desc", "Landslide Early Warning System for the North Eastern Region of India (SIH26001).")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2 text-xs text-muted-foreground leading-relaxed">
          <p>
            {t("about.mission", "LandAlert-Nexus is an operational early warning platform developed to protect hilly communities, road corridors, and strategic infrastructure across 8 North Eastern states.")}
          </p>
          <div className="rounded border border-border bg-secondary/30 p-3 space-y-1.5 font-mono text-[0.72rem]">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("about.authority", "Operational Authority")}:</span>
              <span className="text-foreground font-semibold">GSI / MoES / NDMA</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("about.model_engine", "Model Engine")}:</span>
              <span className="text-foreground font-semibold">Threshold + Logistic Ensemble v0.2</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("about.coverage", "Monitored Geography")}:</span>
              <span className="text-foreground font-semibold">15 Risk Zones (8 States)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("about.telemetry", "Telemetry Providers")}:</span>
              <span className="text-foreground font-semibold">Open-Meteo IMD-Proxy & In-situ AWS</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex justify-end">
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
