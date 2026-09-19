import { riskBadgeClass, roadStatusClass } from "@/lib/risk";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { getLocalizedExplanation } from "@/lib/geo-translations";

export function RiskBadge({
  level,
  score,
  className,
}: {
  level: string;
  score?: number | null | undefined;
  className?: string | undefined;
}) {
  const { t } = useTranslation();
  const isUnknown = level === "UNKNOWN";
  const label = isUnknown
    ? t("risk_bits.status_unknown", "Status Unknown — system data unavailable")
    : t(`risk_levels.${level}`, level);

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-display text-xs uppercase tracking-widest",
        riskBadgeClass(level),
        className,
      )}
      title={isUnknown ? label : undefined}
    >
      {label}
      {!isUnknown && score !== undefined && score !== null && (
        <span className="font-mono text-[0.65rem] opacity-80">{score}</span>
      )}
    </span>
  );
}

export function ForecastRiskBadge({
  level,
  leadHours,
  confidence,
  trend,
  className,
}: {
  level: string;
  leadHours: 24 | 48 | 72;
  confidence?: "high" | "medium" | "low";
  trend?: "improving" | "stable" | "elevating" | "critical";
  className?: string;
}) {
  const { t } = useTranslation();
  const trendArrow =
    trend === "critical" || trend === "elevating"
      ? "▲"
      : trend === "improving"
        ? "▼"
        : "•";

  const opacityClass =
    leadHours === 72 ? "opacity-75 border-dashed" : leadHours === 48 ? "opacity-90 border-dashed" : "border-dashed";

  const levelLabel = t(`risk_levels.${level}`, level);

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-display text-xs uppercase tracking-wider",
        riskBadgeClass(level),
        opacityClass,
        className,
      )}
      title={t(
        "risk_bits.forecast_title",
        "+{{hours}}h weather forecast projection ({{confidence}} confidence). Advisory only; does not overwrite current risk.",
        { hours: leadHours, confidence: confidence ?? "medium" },
      )}
    >
      <span className="font-mono text-[0.65rem] opacity-75">+{leadHours}h</span>
      <span>{levelLabel}</span>
      {trend && <span className="text-[0.65rem] font-mono">{trendArrow}</span>}
    </span>
  );
}

export function PrioritizationScoreBadge({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  let colorClass = "border-border text-muted-foreground bg-secondary/50";
  if (score >= 70) {
    colorClass = "border-risk-severe/50 bg-risk-severe/15 text-risk-severe font-bold";
  } else if (score >= 50) {
    colorClass = "border-risk-high/50 bg-risk-high/15 text-risk-high font-semibold";
  } else if (score >= 30) {
    colorClass = "border-risk-moderate/50 bg-risk-moderate/15 text-risk-moderate";
  } else {
    colorClass = "border-risk-low/50 bg-risk-low/15 text-risk-low";
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs",
        colorClass,
        className,
      )}
    >
      <span>{score.toFixed(1)}</span>
      <span className="text-[0.6rem] opacity-70">/100</span>
    </span>
  );
}

export function RoadBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex rounded border px-2 py-0.5 font-mono text-[0.7rem] uppercase",
        roadStatusClass(status),
      )}
    >
      {t(`road_status.${status}`, status)}
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
  title,
}: {
  explanation: string | null;
  title?: string;
}) {
  const { t, i18n } = useTranslation();
  if (!explanation) return null;
  const localized = getLocalizedExplanation(explanation, t, i18n.language);
  return (
    <div className="rounded border border-border bg-surface-raised p-4">
      <div className="label-caps">{title || t("risk_bits.why_this_fired", "Why this fired")}</div>
      <p className="mt-2 text-xs leading-relaxed text-foreground/90">
        {localized}
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
  const { t } = useTranslation();
  let text = label;
  let styleClass = "border-border text-muted-foreground bg-secondary/50";

  if (!text) {
    if (status === "fallback") {
      text = t("risk_bits.fallback_proxy", "⚠ Fallback proxy (50%)");
      styleClass = "border-amber-500/40 bg-amber-500/10 text-amber-400";
    } else if (status === "cached") {
      text = t("risk_bits.offline_cached", "Offline Cached");
      styleClass = "border-blue-500/40 bg-blue-500/10 text-blue-400";
    } else if (ageHours !== undefined && ageHours !== null) {
      if (ageHours < 24) {
        text = t("risk_bits.live_age", "Live ({{time}} ago)", {
          time: ageHours < 1 ? "<1h" : `${ageHours.toFixed(0)}h`,
        });
        styleClass = "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
      } else if (ageHours < 72) {
        text = t("risk_bits.recent_age", "Recent ({{time}} ago)", {
          time: `${(ageHours / 24).toFixed(0)}d`,
        });
        styleClass = "border-amber-500/40 bg-amber-500/10 text-amber-400";
      } else {
        text = t("risk_bits.stale_age", "Stale ({{time}} old)", {
          time: `${(ageHours / 24).toFixed(0)}d`,
        });
        styleClass = "border-risk-severe/40 bg-risk-severe/10 text-risk-severe";
      }
    } else {
      text = status ? t(`risk_bits.${status}`, status) : t("risk_bits.active", "Active");
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
  const { t } = useTranslation();
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary/40 px-2 py-0.5 font-sans text-[0.68rem] text-muted-foreground"
      title={t(
        "risk_bits.scientific_boundary_title",
        "Empirical benchmark evaluated on N=352 confirmed events (14%-16% precision, 1 hit per 6-7 alarms). Human-in-the-loop review mandatory.",
      )}
    >
      <span>
        {t("risk_bits.scientific_boundary_text", "Scientific boundary: N=352 confirmed events (Human review mandatory)")}
      </span>
    </div>
  );
}

export function RegionalGroundTruthQualityBadge({
  tier,
  district,
  state,
  mlOperational,
}: {
  tier?: string;
  district?: string;
  state?: string;
  mlOperational?: boolean;
}) {
  const isMizoTripura =
    tier === "insufficient_data" ||
    state?.toLowerCase().includes("mizoram") ||
    state?.toLowerCase().includes("tripura");
  const isArunachal =
    tier === "low" || state?.toLowerCase().includes("arunachal");

  if (isMizoTripura || mlOperational === false) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-destructive/50 bg-destructive/10 px-2 py-0.5 font-mono text-[0.68rem] text-destructive font-medium"
        title="NO ACTIVE MONITORING BY DESIGN: LandAlert-Nexus provides zero reliable early warning coverage in Mizoram and Tripura due to data starvation (N=33 confirmed events). All alert triggers are suppressed. Absence of alerts must NOT be interpreted as absence of landslide risk."
      >
        <span>⛔ ZERO COVERAGE (Absence of Alerts ≠ Absence of Risk)</span>
      </span>
    );
  }

  if (isArunachal) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.68rem] text-amber-500 font-medium"
        title="Eastern Syntaxis / Arunachal: Only 44 confirmed failure events. ML risk is capped; empirical threshold confirmation mandatory before issuing Severe warnings."
      >
        <span>⚠️ Provisional Ground Truth (N=44)</span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[0.68rem] text-primary font-medium"
      title="Calibrated highway transit corridors (Sikkim, Nagaland, Assam/Meghalaya). Verified ground truth N=72-108."
    >
      <span>✓ Moderate Ground Truth (Highway Corridors)</span>
    </span>
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
  const { t } = useTranslation();
  if (!topCategories.length && !topFeatures.length) return null;

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex items-center justify-between border-b border-border/70 pb-2">
        <div className="label-caps text-primary">
          {t("risk_bits.canonical_ml_title", "Canonical ML Attribution")}
        </div>
        <span className="font-mono text-[0.65rem] text-muted-foreground">
          {t("risk_bits.canonical_ml_model", "Logistic Regression v2")}
        </span>
      </div>

      {topCategories.length > 0 && (
        <div className="mt-3 space-y-2">
          <div className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">
            {t("risk_bits.risk_categories_contrib", "Risk Categories Contribution")}
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
            {t("risk_bits.dominant_trigger_features", "Dominant Trigger Features")}
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
