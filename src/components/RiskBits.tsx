import { riskBadgeClass, roadStatusClass } from "@/lib/risk";
import { cn } from "@/lib/utils";

export function RiskBadge({
  level,
  score,
  className,
}: {
  level: string;
  score?: number | null | undefined;
  className?: string | undefined;
}) {
  const isUnknown = level === "UNKNOWN";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-display text-xs uppercase tracking-widest",
        riskBadgeClass(level),
        className,
      )}
      title={isUnknown ? "Status Unknown — system data unavailable" : undefined}
    >
      {isUnknown ? "Status Unknown — system data unavailable" : level}
      {!isUnknown && score !== undefined && score !== null && (
        <span className="font-mono text-[0.65rem] opacity-80">{score}</span>
      )}
    </span>
  );
}

export function RoadBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded border px-2 py-0.5 font-mono text-[0.7rem] uppercase",
        roadStatusClass(status),
      )}
    >
      {status}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string | undefined;
  tone?: string | undefined;
}) {
  return (
    <div className="panel p-4">
      <div className="label-caps">{label}</div>
      <div
        className="mt-1 font-display text-3xl leading-none"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function ExplanationCard({
  explanation,
  title = "Why this fired",
}: {
  explanation: string | null;
  title?: string;
}) {
  if (!explanation) return null;
  return (
    <div className="rounded-lg border border-primary/35 bg-primary/5 p-4">
      <div className="label-caps text-primary">{title}</div>
      <p className="mt-2 font-mono text-[0.8rem] leading-relaxed text-foreground/90">
        {explanation}
      </p>
    </div>
  );
}

export function FreshnessBadge({
  ageHours,
  status,
  label,
}: {
  ageHours?: number | null | undefined;
  status?: "measured" | "stale" | "fallback" | "missing" | "live" | "cached" | undefined;
  label?: string | undefined;
}) {
  let text = label;
  let styleClass = "border-border text-muted-foreground bg-secondary/50";

  if (!text) {
    if (status === "fallback") {
      text = "⚠ Fallback proxy (50%)";
      styleClass = "border-amber-500/40 bg-amber-500/10 text-amber-400";
    } else if (status === "cached") {
      text = "Offline Cached";
      styleClass = "border-blue-500/40 bg-blue-500/10 text-blue-400";
    } else if (ageHours !== undefined && ageHours !== null) {
      if (ageHours < 24) {
        text = `Live (${ageHours < 1 ? "<1h" : `${ageHours.toFixed(0)}h`} ago)`;
        styleClass = "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
      } else if (ageHours < 72) {
        text = `Recent (${(ageHours / 24).toFixed(0)}d ago)`;
        styleClass = "border-amber-500/40 bg-amber-500/10 text-amber-400";
      } else {
        text = `Stale (${(ageHours / 24).toFixed(0)}d old)`;
        styleClass = "border-risk-severe/40 bg-risk-severe/10 text-risk-severe";
      }
    } else {
      text = status ?? "Active";
    }
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[0.65rem] tracking-wider uppercase",
        styleClass,
      )}
    >
      {text}
    </span>
  );
}

export function ScientificLimitationBadge() {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[0.68rem] text-amber-300"
      title="Limited verified positive landslide training samples (N=8 events, 2016-2024). Operational decisions should be coupled with ground-truth inspections."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
      <span>Scientific boundary: N=8 real landslide events (PR-AUC: 0.5934)</span>
    </div>
  );
}

export interface FactorAttributionProps {
  topCategories?: Array<{ category: string; net_contribution: number }> | undefined;
  topFeatures?:
    | Array<{
        feature: string;
        value: number;
        contribution: number;
        direction: "increases_risk" | "decreases_risk";
      }>
    | undefined;
}

export function MLAttributionCard({
  topCategories = [],
  topFeatures = [],
}: FactorAttributionProps) {
  if (!topCategories.length && !topFeatures.length) return null;

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between border-b border-border/70 pb-2">
        <div className="label-caps text-primary">Canonical ML Attribution</div>
        <span className="font-mono text-[0.65rem] text-muted-foreground">
          Logistic Regression v2
        </span>
      </div>

      {topCategories.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
            Risk Categories Contribution
          </div>
          <div className="grid gap-1.5">
            {topCategories.map((c) => {
              const absVal = Math.abs(c.net_contribution);
              const isPositive = c.net_contribution >= 0;
              return (
                <div key={c.category} className="flex items-center justify-between text-xs">
                  <span className="capitalize text-foreground/90">
                    {c.category.replace(/_/g, " ")}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          isPositive ? "bg-risk-severe" : "bg-emerald-500",
                        )}
                        style={{ width: `${Math.min(100, Math.max(8, absVal * 80))}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        "w-12 text-right font-mono text-[0.68rem]",
                        isPositive ? "text-risk-severe" : "text-emerald-400",
                      )}
                    >
                      {isPositive ? "+" : ""}
                      {c.net_contribution.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {topFeatures.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-border/50 pt-3">
          <div className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
            Dominant Trigger Features
          </div>
          <div className="space-y-1">
            {topFeatures.slice(0, 4).map((f) => (
              <div
                key={f.feature}
                className="flex items-center justify-between rounded bg-secondary/30 px-2 py-1 font-mono text-[0.7rem]"
              >
                <span className="truncate max-w-[200px]" title={f.feature}>
                  {f.feature}
                </span>
                <span className="text-muted-foreground">
                  val: {typeof f.value === "number" ? f.value.toFixed(1) : f.value}
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold",
                    f.direction === "increases_risk" ? "text-risk-severe" : "text-emerald-400",
                  )}
                >
                  {f.direction === "increases_risk" ? "▲ +" : "▼ "}
                  {Math.abs(f.contribution).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
