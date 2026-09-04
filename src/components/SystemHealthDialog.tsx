import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getSystemHealthServerFn, getMLHealthServerFn } from "@/lib/monitoring.functions";
import type { SystemHealthReport, MLHealthReport } from "@/lib/health.service";

export function SystemHealthDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [systemHealth, setSystemHealth] = useState<SystemHealthReport | null>(null);
  const [mlHealth, setMLHealth] = useState<MLHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadHealth() {
    setLoading(true);
    setError(null);
    try {
      const [sys, ml] = await Promise.all([getSystemHealthServerFn(), getMLHealthServerFn()]);
      setSystemHealth(sys);
      setMLHealth(ml);
    } catch (err) {
      console.error("Health check error:", err);
      setError(err instanceof Error ? err.message : "Failed to load health telemetry");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      loadHealth();
    }
  }, [open]);

  const overallStatus = systemHealth?.status ?? "healthy";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                overallStatus === "healthy"
                  ? "bg-emerald-400"
                  : overallStatus === "degraded"
                    ? "bg-amber-400"
                    : "bg-risk-severe"
              }`}
            />
            <span>System Health</span>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto bg-surface text-foreground border-border">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-display uppercase tracking-wide">
              Backend & AI/ML Subsystem Health
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={loadHealth}
              disabled={loading}
              className="font-mono text-[0.68rem] uppercase"
            >
              {loading ? "Checking…" : "Refresh"}
            </Button>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Authoritative health report evaluating database latency, weather ingestion freshness, ML
            model artifacts, and alert dispatch services.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-xs font-mono text-destructive">
            {error}
          </div>
        )}

        {systemHealth && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded border border-border bg-secondary/30 p-3">
                <div className="label-caps text-[0.65rem]">API Router</div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-xs uppercase">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span>{systemHealth.components.api.status}</span>
                </div>
                <div className="mt-1 text-[0.65rem] text-muted-foreground">
                  {systemHealth.components.api.message}
                </div>
              </div>

              <div className="rounded border border-border bg-secondary/30 p-3">
                <div className="label-caps text-[0.65rem]">Database (Supabase)</div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-xs uppercase">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      systemHealth.components.database.status === "healthy"
                        ? "bg-emerald-400"
                        : "bg-amber-400"
                    }`}
                  />
                  <span>{systemHealth.components.database.status}</span>
                </div>
                <div className="mt-1 text-[0.65rem] text-muted-foreground">
                  Latency: {systemHealth.components.database.latency_ms}ms
                </div>
              </div>

              <div className="rounded border border-border bg-secondary/30 p-3">
                <div className="label-caps text-[0.65rem]">Weather Telemetry</div>
                <div className="mt-1 flex items-center gap-1.5 font-mono text-xs uppercase">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      systemHealth.components.weather.status === "healthy"
                        ? "bg-emerald-400"
                        : "bg-amber-400"
                    }`}
                  />
                  <span>{systemHealth.components.weather.status}</span>
                </div>
                <div className="mt-1 text-[0.65rem] text-muted-foreground truncate">
                  {systemHealth.components.weather.latest_reading_age_hours != null
                    ? `Age: ${systemHealth.components.weather.latest_reading_age_hours.toFixed(0)}h`
                    : "No reading"}
                </div>
              </div>
            </div>

            {/* ML Subsystem Deep Dive */}
            {mlHealth && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-display uppercase tracking-wider text-sm font-semibold text-primary">
                    Authoritative AI/ML Layer ({mlHealth.active_model_version})
                  </span>
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.65rem] text-emerald-400 uppercase">
                    {mlHealth.artifact_verified ? "Artifact Verified" : "Unverified"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 font-mono text-xs">
                  <div>
                    <div className="text-[0.65rem] text-muted-foreground uppercase">PR-AUC</div>
                    <div className="mt-0.5 font-bold text-foreground">
                      {mlHealth.pr_auc?.toFixed(4) ?? "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[0.65rem] text-muted-foreground uppercase">Recall@80%</div>
                    <div className="mt-0.5 font-bold text-foreground">
                      {mlHealth.recall_at_80_precision?.toFixed(4) ?? "N/A"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[0.65rem] text-muted-foreground uppercase">Features</div>
                    <div className="mt-0.5 font-bold text-foreground">
                      {mlHealth.feature_schema_version} (19 features)
                    </div>
                  </div>
                  <div>
                    <div className="text-[0.65rem] text-muted-foreground uppercase">
                      Monitored Zones
                    </div>
                    <div className="mt-0.5 font-bold text-foreground">
                      {mlHealth.monitored_zones} zones
                    </div>
                  </div>
                </div>

                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-[0.72rem] font-mono leading-relaxed text-amber-300">
                  <strong>Scientific Validation Boundary:</strong> {mlHealth.scientific_status}.
                  Model training relies on N=8 verified historical landslides in the NER corridor.
                  High recall threshold is enforced to prevent false negatives in life-safety
                  operations.
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[0.68rem] font-mono text-muted-foreground border-t border-border pt-3">
              <span>Report timestamp: {new Date(systemHealth.timestamp).toLocaleString()}</span>
              <span>Uptime: {(systemHealth.uptime_seconds / 3600).toFixed(1)} hours</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
