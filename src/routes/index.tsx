import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import {
  getOverview,
  recomputeAll,
  ingestLiveRainfall,
  getRiskPredictionServerFn,
  getZoneWeatherRiskForecastServerFn,
  getResponsePrioritizationServerFn,
  type ZoneRow,
} from "@/lib/monitoring.functions";
import { MapCanvas } from "@/components/MapCanvas";
import {
  RiskBadge,
  RoadBadge,
  Stat,
  ExplanationCard,
  FreshnessBadge,
  MLAttributionCard,
  ScientificLimitationBadge,
  ForecastRiskBadge,
  PrioritizationScoreBadge,
} from "@/components/RiskBits";
import { PanelSkeleton, RouteError } from "@/components/ConsoleShell";
import { FieldObservationDialog } from "@/components/FieldObservationDialog";
import { riskColor, RISK_LEVELS } from "@/lib/risk";
import { Button } from "@/components/ui/button";

const overviewQuery = queryOptions({
  queryKey: ["overview"],
  queryFn: () => getOverview(),
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  head: () => ({
    meta: [
      { title: "NER Landslide Risk Console — Live Zone Monitoring" },
      {
        name: "description",
        content:
          "Live landslide risk levels for North East India hill zones, computed from published NE-Himalaya rainfall thresholds with a plain-language reason for every alert.",
      },
      { property: "og:title", content: "NER Landslide Risk Console" },
      {
        property: "og:description",
        content:
          "Risk heatmap, road connectivity and explainable alerts for district disaster management authorities across the North Eastern Region.",
      },
    ],
  }),
  component: Dashboard,
  pendingComponent: () => <PanelSkeleton label="Loading risk console…" />,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
});

function Dashboard() {
  const { t } = useTranslation();
  const { data } = useSuspenseQuery(overviewQuery);
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("All");
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const recompute = useServerFn(recomputeAll);
  const ingest = useServerFn(ingestLiveRainfall);

  const states = useMemo(
    () => ["All", ...Array.from(new Set(data.zones.map((z) => z.state))).sort()],
    [data.zones],
  );

  const zones = useMemo(
    () => (stateFilter === "All" ? data.zones : data.zones.filter((z) => z.state === stateFilter)),
    [data.zones, stateFilter],
  );

  const selected: ZoneRow | null = data.zones.find((z) => z.id === selectedId) ?? zones[0] ?? null;

  const { data: selectedMl } = useQuery({
    queryKey: ["risk-prediction", selected?.id],
    queryFn: () => (selected ? getRiskPredictionServerFn({ data: { zoneId: selected.id } }) : null),
    enabled: !!selected,
  });

  const { data: selectedForecast } = useQuery({
    queryKey: ["weather-forecast", selected?.id],
    queryFn: () =>
      selected ? getZoneWeatherRiskForecastServerFn({ data: { zoneId: selected.id } }) : null,
    enabled: !!selected,
  });

  const { data: prioritizationData } = useQuery({
    queryKey: ["response-prioritization"],
    queryFn: () => getResponsePrioritizationServerFn(),
  });

  const counts = RISK_LEVELS.map((lvl) => ({
    lvl,
    n: data.zones.filter((z) => z.current_risk_level === lvl).length,
  }));
  const unknownZonesCount = data.zones.filter((z) => z.current_risk_level === "UNKNOWN").length;

  const blocked = data.roads.filter((r) => r.status === "blocked");
  const restricted = data.roads.filter((r) => r.status === "restricted");
  const atRisk = data.zones
    .filter((z) => ["High", "Severe"].includes(z.current_risk_level))
    .reduce((s, z) => s + z.population, 0);

  async function runRecompute() {
    setBusy(true);
    setActionNotice(null);
    try {
      await recompute();
      await qc.invalidateQueries();
      setActionNotice("Authoritative risk scores recomputed across all 15 zones.");
      setTimeout(() => setActionNotice(null), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function runIngest() {
    setBusy(true);
    setActionNotice(null);
    try {
      const res = await ingest();
      await qc.invalidateQueries();
      setActionNotice(
        `Ingested live weather for ${res.zones} zones (${res.readings} rainfall, ${res.soilReadings} soil rows).`,
      );
      setTimeout(() => setActionNotice(null), 4000);
    } catch {
      setActionNotice("Live weather ingestion unavailable. Showing the last verified dataset.");
      setTimeout(() => setActionNotice(null), 5000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="label-caps">SIH26001 · North Eastern Region</div>
          <h1 className="mt-1 text-3xl font-semibold uppercase tracking-wide">
            {t("dashboard.risk_heatmap", "Landslide Early Warning Console")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Rainfall, soil-moisture and terrain fused with published NE-Himalaya threshold
            equations. Every risk level carries the reasoning that produced it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {data.activeModel && (
              <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[0.68rem] text-primary">
                {t("dashboard.model_active", "Active Model")}: {data.activeModel.model_version}
              </span>
            )}
            <ScientificLimitationBadge />
            {data.candidateModel && (
              <span
                data-testid="candidate-model-notice"
                className="inline-flex items-center gap-1.5 rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 font-mono text-[0.68rem] text-sky-300"
                title={`${data.candidateModel.model_version} (${data.candidateModel.status})`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                <span>
                  {t("dashboard.candidate_pending_notice", {
                    version: data.candidateModel.model_version.replace("-lr-trained", ""),
                    events: data.candidateModel.positive_count ?? 15,
                  })}
                </span>
              </span>
            )}
            <span className="rounded border border-border bg-secondary/50 px-2 py-0.5 font-mono text-[0.68rem] text-muted-foreground">
              {t("dashboard.observation_trust")}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actionNotice && (
            <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs text-emerald-400">
              {actionNotice}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={runIngest}
            disabled={busy}
            className="font-mono text-xs uppercase"
          >
            {t("dashboard.ingest_weather", "Ingest Open-Meteo")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runRecompute}
            disabled={busy}
            className="font-mono text-xs uppercase"
          >
            {t("dashboard.recompute", "Recompute risk")}
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {counts.map((c) => (
          <Stat
            key={c.lvl}
            label={`${t(`risk_levels.${c.lvl}`, c.lvl)} ${t("dashboard.monitored_zones", "zones")}`}
            value={c.n}
            tone={riskColor(c.lvl)}
          />
        ))}
        {unknownZonesCount > 0 && (
          <Stat
            label="Status Unknown"
            value={unknownZonesCount}
            hint="System data unavailable"
            tone={riskColor("UNKNOWN")}
          />
        )}
        <Stat
          label="Population exposed"
          value={atRisk.toLocaleString("en-IN")}
          hint="Residents in High or Severe zones"
        />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr] items-stretch">
        <div className="panel overflow-hidden flex flex-col h-full">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
            <div className="label-caps">{t("dashboard.risk_heatmap", "Risk heatmap")}</div>
            <div className="flex flex-wrap gap-1">
              {states.map((s) => (
                <button
                  key={s}
                  onClick={() => setStateFilter(s)}
                  className={`rounded border px-2 py-1 font-mono text-[0.7rem] transition-colors ${
                    stateFilter === s
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="w-full flex-1 min-h-[500px] relative isolate z-0">
            <MapCanvas zones={zones} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-border px-4 py-2 shrink-0 bg-surface/40">
            {RISK_LEVELS.map((l) => (
              <span key={l} className="flex items-center gap-2 text-xs">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: riskColor(l) }}
                />
                {l}
              </span>
            ))}
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: riskColor("UNKNOWN") }}
              />
              Unknown
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {selected && (
            <div className="panel p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label-caps">{t("dashboard.zone_overview", "Selected zone")}</div>
                  <h2 className="mt-1 text-xl font-semibold">{selected.zone_name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {selected.district} district · {selected.state} ·{" "}
                    {selected.population.toLocaleString("en-IN")} residents ·{" "}
                    {selected.mean_slope_deg}° mean slope
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <FreshnessBadge
                      ageHours={selectedMl?.data_freshness?.weather_age_hours}
                      status={
                        selected.soil_moisture_status as
                          "measured" | "stale" | "fallback" | "missing"
                      }
                    />
                    {selectedMl && (
                      <span
                        className={`font-mono text-[0.68rem] ${
                          selectedMl.risk_level === "UNKNOWN"
                            ? "text-muted-foreground"
                            : "text-primary"
                        }`}
                      >
                        {selectedMl.risk_level === "UNKNOWN"
                          ? "ML Risk: Unavailable (Status Unknown)"
                          : `ML Risk: ${
                              selectedMl.probability !== null
                                ? `${(selectedMl.probability * 100).toFixed(1)}%`
                                : "Unavailable"
                            } (${selectedMl.risk_level})`}
                      </span>
                    )}
                  </div>
                </div>
                <RiskBadge
                  level={selectedMl?.risk_level ?? selected.current_risk_level}
                  score={selectedMl?.risk_score ?? selected.risk_score}
                />
              </div>

              {selectedMl?.status === "STALE" && (
                <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 font-mono text-[0.7rem] text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span>
                    Last computed at{" "}
                    {selectedMl.data_freshness.latest_weather_timestamp ??
                      selectedMl.inference_timestamp}
                    , may be stale.
                  </span>
                </div>
              )}

              {selectedMl?.risk_level === "UNKNOWN" && (
                <div className="flex items-center gap-2 rounded border border-border bg-secondary/60 px-2.5 py-1 font-mono text-[0.7rem] text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span>{t("dashboard.status_unknown_desc")}</span>
                </div>
              )}

              <div>
                <ExplanationCard explanation={selected.explanation} />
              </div>

              {selectedMl?.factor_attribution && (
                <MLAttributionCard
                  topCategories={selectedMl.factor_attribution.top_categories}
                  topFeatures={selectedMl.factor_attribution.top_features}
                />
              )}

              {/* Weather-Linked Risk Forecast Preview */}
              <div className="rounded border border-border/70 bg-card/50 p-3">
                <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="label-caps">{t("weather_forecast.section_title")}</span>
                    <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[0.62rem] text-primary">
                      Forecast Guidance
                    </span>
                  </div>
                  <span className="text-[0.65rem] text-muted-foreground italic">
                    {t("weather_forecast.disclaimer")}
                  </span>
                </div>

                {!selectedForecast || selectedForecast.status === "UNAVAILABLE" ? (
                  <p className="pt-2 text-center font-mono text-xs text-muted-foreground">
                    ⚠ {t("weather_forecast.forecast_unavailable")}
                  </p>
                ) : (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div className="rounded border border-primary/30 bg-primary/5 p-2 text-center">
                      <div className="text-[0.62rem] font-semibold uppercase text-primary">
                        {t("weather_forecast.projected_24h")}
                      </div>
                      <div className="my-1 flex justify-center">
                        <ForecastRiskBadge
                          level={selectedForecast.windows.w24.projectedRiskLevel}
                          leadHours={24}
                          trend={selectedForecast.windows.w24.trend}
                          confidence={selectedForecast.windows.w24.confidence}
                        />
                      </div>
                      <div className="font-mono text-[0.68rem] text-foreground font-semibold">
                        {selectedForecast.windows.w24.forecastPrecipMm.toFixed(1)} mm
                      </div>
                      <div className="mt-0.5 text-[0.58rem] text-emerald-400 font-mono">
                        {t("weather_forecast.skill_high")}
                      </div>
                    </div>

                    <div className="rounded border border-border/80 bg-card/60 p-2 text-center">
                      <div className="text-[0.62rem] font-semibold uppercase text-muted-foreground">
                        {t("weather_forecast.projected_48h")}
                      </div>
                      <div className="my-1 flex justify-center">
                        <ForecastRiskBadge
                          level={selectedForecast.windows.w48.projectedRiskLevel}
                          leadHours={48}
                          trend={selectedForecast.windows.w48.trend}
                          confidence={selectedForecast.windows.w48.confidence}
                        />
                      </div>
                      <div className="font-mono text-[0.68rem] text-foreground font-semibold">
                        {selectedForecast.windows.w48.forecastPrecipMm.toFixed(1)} mm
                      </div>
                      <div className="mt-0.5 text-[0.58rem] text-amber-400 font-mono">
                        {t("weather_forecast.skill_medium")}
                      </div>
                    </div>

                    <div className="rounded border border-dashed border-border/60 bg-card/30 p-2 text-center opacity-90">
                      <div className="text-[0.62rem] font-semibold uppercase text-muted-foreground">
                        {t("weather_forecast.projected_72h")}
                      </div>
                      <div className="my-1 flex justify-center">
                        <ForecastRiskBadge
                          level={selectedForecast.windows.w72.projectedRiskLevel}
                          leadHours={72}
                          trend={selectedForecast.windows.w72.trend}
                          confidence={selectedForecast.windows.w72.confidence}
                        />
                      </div>
                      <div className="font-mono text-[0.68rem] text-foreground font-semibold">
                        {selectedForecast.windows.w72.forecastPrecipMm.toFixed(1)} mm
                      </div>
                      <div className="mt-0.5 text-[0.58rem] text-slate-400 font-mono">
                        {t("weather_forecast.skill_low")}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border/60 pt-2">
                <FieldObservationDialog
                  initialZoneId={selected.id}
                  trigger={
                    <button
                      type="button"
                      className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground hover:text-foreground underline"
                    >
                      + Report ground observation
                    </button>
                  }
                  onSuccess={() => qc.invalidateQueries()}
                />
                <Link
                  to="/zones/$id"
                  params={{ id: String(selected.id) }}
                  className="font-display text-xs uppercase tracking-widest text-primary hover:underline"
                >
                  {t("dashboard.view_zone_brief", "Open zone brief →")}
                </Link>
              </div>
            </div>
          )}

          {/* Emergency Response Prioritisation Panel */}
          <div className="panel">
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="label-caps">{t("response_prioritization.section_title")}</span>
                <span className="rounded border border-border bg-secondary/60 px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
                  {t("response_prioritization.decision_support")}
                </span>
              </div>
              <p className="mt-1 text-[0.68rem] text-muted-foreground leading-relaxed">
                {t("response_prioritization.section_caption")}
              </p>
            </div>

            <div className="max-h-[380px] overflow-y-auto">
              {/* Ranked Zones */}
              {prioritizationData?.ranked
                ?.filter((r) => stateFilter === "All" || r.state === stateFilter)
                .map((r) => (
                  <button
                    key={r.zoneId}
                    onClick={() => setSelectedId(r.zoneId)}
                    className={`flex w-full flex-col gap-1.5 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-secondary/60 ${
                      selected?.id === r.zoneId ? "bg-secondary/70" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/10 font-mono text-xs font-bold text-primary">
                          #{r.rank}
                        </span>
                        <span className="text-sm font-semibold">{r.zoneName}</span>
                        <span className="font-mono text-[0.68rem] text-muted-foreground">
                          {r.district}, {r.state}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <RiskBadge level={r.currentRiskLevel} />
                        <PrioritizationScoreBadge score={r.compositeUrgencyScore} />
                      </div>
                    </div>

                    {/* Drivers Breakdown Chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[0.65rem] font-mono">
                      <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-foreground/90 border border-border/50">
                        {r.driverBreakdown.severity}
                      </span>
                      <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-foreground/90 border border-border/50">
                        {r.driverBreakdown.population}
                      </span>
                      <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-foreground/90 border border-border/50">
                        {r.driverBreakdown.roads}
                      </span>
                      {r.driverBreakdown.observations && (
                        <span className="rounded bg-amber-500/10 text-amber-300 px-1.5 py-0.5 border border-amber-500/30">
                          {r.driverBreakdown.observations}
                        </span>
                      )}
                    </div>
                  </button>
                ))}

              {/* Unranked Zones (Status Unknown) */}
              {prioritizationData?.unranked && prioritizationData.unranked.length > 0 && (
                <div className="border-t-2 border-border/80 bg-secondary/20 p-3">
                  <div className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    <span>⚠</span>
                    <span>{t("response_prioritization.unranked_title")}</span>
                  </div>
                  <p className="mt-0.5 text-[0.65rem] text-muted-foreground leading-relaxed">
                    {t("response_prioritization.unranked_desc")}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {prioritizationData.unranked
                      .filter((u) => stateFilter === "All" || u.state === stateFilter)
                      .map((u) => (
                        <button
                          key={u.zoneId}
                          onClick={() => setSelectedId(u.zoneId)}
                          className={`flex w-full items-center justify-between rounded border border-border/60 p-2 text-left text-xs hover:bg-secondary/60 ${
                            selected?.id === u.zoneId ? "bg-secondary/70" : ""
                          }`}
                        >
                          <div>
                            <span className="font-semibold">{u.zoneName}</span>
                            <span className="ml-1 text-[0.68rem] text-muted-foreground">
                              ({u.district}, {u.state})
                            </span>
                            <span className="block text-[0.62rem] text-muted-foreground/80 mt-0.5">
                              {u.reason}
                            </span>
                          </div>
                          <RiskBadge level={u.currentRiskLevel} />
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {(!prioritizationData?.ranked || prioritizationData.ranked.length === 0) && (
                <p className="p-4 text-sm text-muted-foreground">
                  {t("response_prioritization.no_zones")}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="xl:col-span-2 grid gap-4 lg:grid-cols-2">
          <div className="panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="label-caps">{t("dashboard.road_status", "Road connectivity")}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {blocked.length} blocked · {restricted.length} restricted
              </span>
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {[...data.roads]
                .sort((a, b) => a.status.localeCompare(b.status))
                .map((r) => {
                  const z = data.zones.find((x) => x.id === r.zone_id);
                  return (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-sm"
                    >
                      <span>
                        <span className="font-mono text-primary">{r.road_name}</span>{" "}
                        {r.segment_label}
                        <span className="block text-[0.68rem] text-muted-foreground">
                          {z?.state} · {r.length_km} km
                        </span>
                      </span>
                      <RoadBadge status={r.status} />
                    </div>
                  );
                })}
              {data.roads.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">{t("dashboard.no_roads")}</p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="label-caps">{t("dashboard.recent_alerts", "Alert console")}</span>
              <Link
                to="/alerts"
                className="font-display text-xs uppercase tracking-widest text-primary hover:underline"
              >
                {t("alerts.full_history")}
              </Link>
            </div>
            <div className="max-h-[280px] space-y-3 overflow-y-auto p-4">
              {data.alerts.slice(0, 6).map((a) => (
                <div key={a.id} className="rounded border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <RiskBadge level={a.risk_level} />
                    <span className="font-mono text-[0.68rem] text-muted-foreground">
                      {new Date(a.dispatched_at).toLocaleString()} · {a.channel}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{a.message}</p>
                  <p className="mt-1 font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
                    {a.explanation}
                  </p>
                </div>
              ))}
              {data.alerts.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("dashboard.no_alerts")}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

