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
import { FileText, Download, Calendar } from "lucide-react";

export function ReportsDialog({ trigger }: { trigger?: React.ReactNode }) {
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
            {t("nav.reports", "Reports")}
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px] bg-surface text-foreground border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-display text-foreground">
            {t("reports.dialog_title", "Operational Landslide Reports")}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("reports.dialog_desc", "Official daily bulletins, seasonal risk assessments, and road corridor advisories.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div className="rounded border border-border bg-secondary/20 p-3 flex items-center justify-between">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-xs text-foreground">
                  {t("reports.daily_bulletin", "Daily Regional Landslide Bulletin")}
                </div>
                <div className="flex items-center gap-1.5 text-[0.68rem] text-muted-foreground mt-0.5">
                  <Calendar className="h-3 w-3" />
                  <span>{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
              </div>
            </div>
            <a
              href="/api/sync/package"
              download
              className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs font-mono text-primary hover:bg-secondary transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>PDF/JSON</span>
            </a>
          </div>

          <div className="rounded border border-border bg-secondary/20 p-3 flex items-center justify-between">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-xs text-foreground">
                  {t("reports.road_corridor_report", "NH & State Highway Slope Vulnerability Report")}
                </div>
                <div className="text-[0.68rem] text-muted-foreground mt-0.5">
                  {t("reports.road_corridor_desc", "Current status of 15 vulnerable corridors in Sikkim, Mizoram, Manipur & Meghalaya.")}
                </div>
              </div>
            </div>
            <a
              href="/api/gis/zones.geojson"
              download
              className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-xs font-mono text-primary hover:bg-secondary transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>GeoJSON</span>
            </a>
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
