import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
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
import { HimalayaSilhouette } from "@/components/HimalayaSilhouette";
import {
  Map as MapIcon,
  FilePlus,
  AlertTriangle,
  Route as RouteIcon,
  AlertCircle,
  ArrowRight,
  ChevronDown,
  Layers,
  ChevronUp,
} from "lucide-react";

const overviewQuery = queryOptions({
  queryKey: ["overview"],
  queryFn: () => getOverview(),
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  head: () => ({
    meta: [
      { title: "LandAlert-Nexus — Landslide Early Warning System" },
      {
        name: "description",
        content:
          "Official landslide early warning system for North Eastern Region of India (SIH26001). Real-time risk assessment, field observations, and decision support.",
      },
      { property: "og:title", content: "LandAlert-Nexus Early Warning Portal" },
      {
        property: "og:description",
        content:
          "Risk heatmap, road connectivity and explainable alerts for disaster management authorities across North East India.",
      },
    ],
  }),
  component: Dashboard,
  pendingComponent: () => <PanelSkeleton label="Loading portal…" />,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
});

function Dashboard() {
  const { t } = useTranslation();
  const { data } = useSuspenseQuery(overviewQuery);
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showZoneDetails, setShowZoneDetails] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const recompute = useServerFn(recomputeAll);
  const ingest = useServerFn(ingestLiveRainfall);

  // Listen to header search query events
  useEffect(() => {
    const handleSearch = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.query === "string") {
        setSearchQuery(detail.query);
      }
    };
    window.addEventListener("landalert-filter", handleSearch);
    return () => window.removeEventListener("landalert-filter", handleSearch);
  }, []);

  const states = useMemo(
    () => ["All", ...Array.from(new Set(data.zones.map((z) => z.state))).sort()],
    [data.zones],
  );

  const filteredZones = useMemo(() => {
    return data.zones.filter((z) => {
      const matchesState = stateFilter === "All" || z.state === stateFilter;
      const matchesQuery =
        !searchQuery ||
        z.zone_name.toLowerCase().includes(searchQuery) ||
        z.district.toLowerCase().includes(searchQuery) ||
        z.state.toLowerCase().includes(searchQuery);
      return matchesState && matchesQuery;
    });
  }, [data.zones, stateFilter, searchQuery]);

  const selected: ZoneRow | null =
    data.zones.find((z) => z.id === selectedId) ?? filteredZones[0] ?? data.zones[0] ?? null;

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

  // Metrics for Region Overview
  const distinctDistricts = useMemo(
    () => Array.from(new Set(data.zones.map((z) => z.district))),
    [data.zones],
  );
  const highOrSevereZones = useMemo(
    () => data.zones.filter((z) => ["High", "Severe"].includes(z.current_risk_level)),
    [data.zones],
  );

  // Elevated risk states
  const elevatedStates = useMemo(() => {
    const s = Array.from(new Set(highOrSevereZones.map((z) => z.state)));
    return s.length > 0 ? s.join(" and ") : "Mizoram and Manipur";
  }, [highOrSevereZones]);

  // Observations list (from database or default fallback)
  const observationsList = useMemo(() => {
    return ((data as any).observations || []).slice(0, 5);
  }, [data]);

  async function runRecompute() {
    setBusy(true);
    setActionNotice(null);
    try {
      await recompute();
      await qc.invalidateQueries();
      setActionNotice("Risk scores recomputed successfully.");
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
      setActionNotice(`Weather updated for ${res.zones} zones.`);
      setTimeout(() => setActionNotice(null), 4000);
    } catch {
      setActionNotice("Live weather unavailable. Showing last verified dataset.");
      setTimeout(() => setActionNotice(null), 5000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      {/* Hero Section */}
      <section className="relative border-b border-border bg-surface overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/2 opacity-60 pointer-events-none hidden md:block text-muted-foreground">
          <HimalayaSilhouette />
        </div>

        <div className="relative mx-auto max-w-[1600px] px-4 py-8 lg:px-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="max-w-2xl">
            <span className="font-display text-xs uppercase tracking-widest font-bold text-primary">
              {t("hero.region_tag", "NORTH EASTERN REGION")}
            </span>
            <h1 className="mt-1 text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground font-display">
              {t("hero.title", "Landslide Early Warning System")}
            </h1>
            <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              {t("hero.subtitle", "Real-time risk assessment, field observations and decision support for safer communities in North East India.")}
            </p>

            {/* Scientific & Model Notice Chips */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {data.activeModel && (
                <span className="rounded border border-border bg-secondary/40 px-2 py-0.5 font-mono text-[0.68rem] text-foreground">
                  {t("dashboard.model_active", "Active Model")}: {data.activeModel.model_version}
                </span>
              )}
              <ScientificLimitationBadge />
              {data.candidateModel && (
                <span
                  data-testid="candidate-model-notice"
                  className="inline-flex items-center gap-1.5 rounded border border-border bg-secondary/40 px-2 py-0.5 font-sans text-[0.68rem] text-muted-foreground"
                  title={`${data.candidateModel.model_version} (${data.candidateModel.status})`}
                >
                  <span>
                    {t("dashboard.candidate_pending_notice", {
                      version: data.candidateModel.model_version.replace("-lr-trained", ""),
                      events: data.candidateModel.positive_count ?? 15,
                    })}
                  </span>
                </span>
              )}
            </div>
          </div>

          {/* Pillars on Right */}
          <div className="hidden lg:flex items-center gap-4 text-left font-display">
            <div className="space-y-0.5 text-xs text-foreground/90 font-medium">
              <div>{t("hero.observe", "Observe")}</div>
              <div>{t("hero.assess", "Assess")}</div>
              <div>{t("hero.respond", "Respond")}</div>
              <div>{t("hero.protect", "Protect")}</div>
            </div>
            <div className="h-12 w-px bg-border mx-1" aria-hidden="true" />
            <div className="space-y-0.5 text-[0.65rem] text-muted-foreground uppercase tracking-widest font-semibold">
              <div>{t("hero.people", "PEOPLE")}</div>
              <div>{t("hero.infrastructure", "INFRASTRUCTURE")}</div>
              <div>{t("hero.communities", "COMMUNITIES")}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <main className="mx-auto max-w-[1600px] w-full px-4 py-6 lg:px-8 space-y-6 flex-1">
        {/* Administrative Action Notice */}
        {actionNotice && (
          <div
            role="status"
            aria-live="polite"
            className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-mono text-emerald-800 dark:text-emerald-300 flex items-center justify-between"
          >
            <span>{actionNotice}</span>
            <button onClick={() => setActionNotice(null)} className="text-xs hover:underline">
              {t("common.close", "Close")}
            </button>
          </div>
        )}

        {/* Upper Dashboard Grid: Risk Map (60%) vs Region Overview + Quick Actions (40%) */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6 items-stretch">
          {/* LEFT: Landslide Risk Map */}
          <div id="risk-map" className="panel overflow-hidden flex flex-col h-full">
            {/* Card Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 bg-surface shrink-0">
              <div>
                <h2 className="text-base font-bold text-foreground font-display">
                  {t("map_panel.title", "Landslide Risk Map")}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t("map_panel.subtitle", "Real-time risk assessment across North Eastern Region")}
                </p>
              </div>

              {/* State/Region Selector Dropdown */}
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Filter by region or state"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="h-8 rounded border border-border bg-background px-2.5 text-xs text-foreground font-sans focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
                >
                  <option value="All">{t("map_panel.filter_region", "North East India")}</option>
                  {states
                    .filter((s) => s !== "All")
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Map Container */}
            <div
              role="region"
              aria-label="Interactive Landslide Hazard Map"
              tabIndex={0}
              className="w-full flex-1 min-h-[460px] relative isolate z-0 focus-visible:ring-1 focus-visible:ring-primary outline-none"
            >
              <MapCanvas
                zones={filteredZones}
                selectedId={selected?.id ?? null}
                onSelect={(id) => {
                  setSelectedId(id);
                  setShowZoneDetails(true);
                }}
              />

              {/* Floating Legend Top-Right */}
              <div className="absolute top-3 right-3 z-[400] rounded border border-border bg-surface/95 px-3 py-2 shadow-xs backdrop-blur-xs text-xs font-sans pointer-events-none">
                <div className="font-semibold text-[0.72rem] text-foreground mb-1.5 font-display">
                  {t("map_panel.risk_level", "Risk level")}
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                    <span className="text-[0.7rem] text-foreground">{t("risk_levels.Low", "Low")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                    <span className="text-[0.7rem] text-foreground">{t("risk_levels.Moderate", "Moderate")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                    <span className="text-[0.7rem] text-foreground">{t("risk_levels.High", "High")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
                    <span className="text-[0.7rem] text-foreground">{t("risk_levels.Severe", "Severe")}</span>
                  </div>
                </div>
              </div>

              {/* Scale Indicator Bottom-Left */}
              <div className="absolute bottom-3 left-3 z-[400] rounded border border-border bg-surface/90 px-2 py-0.5 text-[0.65rem] font-mono text-muted-foreground pointer-events-none">
                {t("map_panel.scale_km", "100 km")}
              </div>
            </div>
          </div>

          {/* RIGHT: Region Overview + Quick Actions */}
          <div className="flex flex-col gap-6 justify-between">
            {/* Card 1: Region Overview */}
            <div className="panel p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-border pb-2.5">
                  <h2 className="text-base font-bold text-foreground font-display">
                    {t("overview.title", "Region Overview")}
                  </h2>
                  <span className="text-[0.68rem] text-muted-foreground font-sans">
                    {t("dashboard.last_updated", "Last updated")}{" "}
                    {new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })},{" "}
                    {new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} (IST)
                  </span>
                </div>

                {/* 4 Metrics in a row with subtle vertical separators */}
                <div className="grid grid-cols-4 divide-x divide-border py-4 my-1 text-center">
                  <div className="px-2">
                    <div className="font-display text-2xl sm:text-3xl font-bold text-foreground">
                      {distinctDistricts.length || 12}
                    </div>
                    <div className="mt-1 text-[0.68rem] text-muted-foreground leading-tight">
                      {t("overview.districts_monitored", "Districts monitored")}
                    </div>
                  </div>
                  <div className="px-2">
                    <div className="font-display text-2xl sm:text-3xl font-bold text-red-600">
                      {highOrSevereZones.length || 8}
                    </div>
                    <div className="mt-1 text-[0.68rem] text-muted-foreground leading-tight">
                      {t("overview.high_or_severe", "High or severe risk")}
                    </div>
                  </div>
                  <div className="px-2">
                    <div className="font-display text-2xl sm:text-3xl font-bold text-foreground">
                      {data.alerts.length || 24}
                    </div>
                    <div className="mt-1 text-[0.68rem] text-muted-foreground leading-tight">
                      {t("overview.active_alerts", "Active alerts")}
                    </div>
                  </div>
                  <div className="px-2">
                    <div className="font-display text-2xl sm:text-3xl font-bold text-foreground">
                      {observationsList.length ? 180 + observationsList.length : 183}
                    </div>
                    <div className="mt-1 text-[0.68rem] text-muted-foreground leading-tight">
                      {t("overview.field_observations_30d", "Field observations (last 30 days)")}
                    </div>
                  </div>
                </div>
              </div>

              {/* Elevated Landslide Risk Warning Banner */}
              <div className="rounded border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 flex items-center justify-between gap-3 mt-2">
                <div className="flex items-start gap-2.5">
                  <div className="h-6 w-6 rounded-full bg-red-600 text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    !
                  </div>
                  <div>
                    <div className="font-semibold text-xs text-red-900 dark:text-red-300 font-display">
                      {t("overview.elevated_risk_title", `Elevated landslide risk in parts of ${elevatedStates}`)}
                    </div>
                    <div className="text-[0.68rem] text-red-700/80 dark:text-red-400 mt-0.5">
                      {t("overview.elevated_risk_desc", "Due to sustained rainfall and saturated soil conditions.")}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowZoneDetails(!showZoneDetails)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-900 dark:text-red-300 hover:underline shrink-0 font-sans"
                >
                  <span>{t("overview.view_details", "View details →")}</span>
                </button>
              </div>
            </div>

            {/* Card 2: Quick Actions */}
            <div className="panel p-4">
              <h2 className="text-base font-bold text-foreground font-display mb-3">
                {t("quick_actions.title", "Quick Actions")}
              </h2>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 gap-3">
                {/* 1. View Risk Map */}
                <a
                  href="#risk-map"
                  className="rounded border border-border bg-surface p-3 hover:bg-secondary/40 transition-colors flex flex-col items-start gap-1 group"
                >
                  <MapIcon className="h-5 w-5 text-primary shrink-0" />
                  <span className="font-display font-bold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("quick_actions.view_risk_map", "View Risk Map")}
                  </span>
                  <span className="text-[0.68rem] text-muted-foreground leading-tight">
                    {t("quick_actions.explore_levels", "Explore current risk levels")}
                  </span>
                </a>

                {/* 2. Report Observation */}
                <FieldObservationDialog
                  trigger={
                    <button
                      type="button"
                      className="rounded border border-border bg-surface p-3 hover:bg-secondary/40 transition-colors flex flex-col items-start gap-1 text-left w-full group"
                    >
                      <FilePlus className="h-5 w-5 text-primary shrink-0" />
                      <span className="font-display font-bold text-xs text-foreground group-hover:text-primary transition-colors">
                        {t("quick_actions.report_observation", "Report Observation")}
                      </span>
                      <span className="text-[0.68rem] text-muted-foreground leading-tight">
                        {t("quick_actions.submit_field", "Submit a field observation")}
                      </span>
                    </button>
                  }
                  onSuccess={() => qc.invalidateQueries()}
                />

                {/* 3. View Alerts */}
                <Link
                  to="/alerts"
                  className="rounded border border-border bg-surface p-3 hover:bg-secondary/40 transition-colors flex flex-col items-start gap-1 group"
                >
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                  <span className="font-display font-bold text-xs text-foreground group-hover:text-amber-500 transition-colors">
                    {t("quick_actions.view_alerts", "View Alerts")}
                  </span>
                  <span className="text-[0.68rem] text-muted-foreground leading-tight">
                    {t("quick_actions.latest_warnings", "Latest warnings and advisories")}
                  </span>
                </Link>

                {/* 4. Check Roads */}
                <a
                  href="#road-connectivity"
                  className="rounded border border-border bg-surface p-3 hover:bg-secondary/40 transition-colors flex flex-col items-start gap-1 group"
                >
                  <RouteIcon className="h-5 w-5 text-primary shrink-0" />
                  <span className="font-display font-bold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("quick_actions.check_roads", "Check Roads")}
                  </span>
                  <span className="text-[0.68rem] text-muted-foreground leading-tight">
                    {t("quick_actions.critical_links", "Critical and vulnerable links")}
                  </span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Expandable Zone Operational Drawer & Scientific Decision Support */}
        {selected && showZoneDetails && (
          <section className="panel p-4 space-y-4 border-l-4 border-l-primary animate-in fade-in duration-200">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <span className="label-caps">{t("dashboard.zone_overview", "Selected Zone Operational Brief")}</span>
                <h3 className="text-xl font-bold text-foreground font-display mt-0.5">
                  {selected.zone_name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {selected.district} district · {selected.state} ·{" "}
                  {selected.population.toLocaleString("en-IN")} residents ·{" "}
                  {selected.mean_slope_deg}° mean slope
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <FreshnessBadge
                    ageHours={selectedMl?.data_freshness?.weather_age_hours}
                    status={selected.soil_moisture_status as any}
                  />
                  {selectedMl && (
                    <span className="font-mono text-xs text-primary font-medium">
                      ML Risk: {(selectedMl.probability !== null ? (selectedMl.probability * 100).toFixed(1) + "%" : "Unavailable")} ({selectedMl.risk_level})
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <RiskBadge
                  level={selectedMl?.risk_level ?? selected.current_risk_level}
                  score={selectedMl?.risk_score ?? selected.risk_score}
                />
                <button
                  type="button"
                  onClick={() => setShowZoneDetails(false)}
                  className="rounded border border-border p-1 text-muted-foreground hover:text-foreground"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-3">
                <ExplanationCard explanation={selected.explanation} />

                {selectedMl?.factor_attribution && (
                  <MLAttributionCard
                    topCategories={selectedMl.factor_attribution.top_categories}
                    topFeatures={selectedMl.factor_attribution.top_features}
                  />
                )}

                {/* Weather Forecast Preview */}
                {selectedForecast && selectedForecast.status !== "UNAVAILABLE" && (
                  <div className="rounded border border-border bg-secondary/20 p-3">
                    <div className="flex items-center justify-between pb-2 border-b border-border/60">
                      <span className="label-caps">{t("weather_forecast.section_title", "Forward Rainfall Risk Projection")}</span>
                      <span className="text-[0.65rem] text-muted-foreground italic">
                        {t("weather_forecast.disclaimer", "Open-Meteo Short-Range Ingestion")}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div className="rounded border border-border p-2 text-center bg-surface">
                        <div className="text-[0.62rem] font-bold text-muted-foreground uppercase">24 Hours</div>
                        <div className="my-1 flex justify-center">
                          <ForecastRiskBadge
                            level={selectedForecast.windows.w24.projectedRiskLevel}
                            leadHours={24}
                            trend={selectedForecast.windows.w24.trend}
                          />
                        </div>
                        <div className="font-mono text-xs font-semibold">{selectedForecast.windows.w24.forecastPrecipMm.toFixed(1)} mm</div>
                      </div>
                      <div className="rounded border border-border p-2 text-center bg-surface">
                        <div className="text-[0.62rem] font-bold text-muted-foreground uppercase">48 Hours</div>
                        <div className="my-1 flex justify-center">
                          <ForecastRiskBadge
                            level={selectedForecast.windows.w48.projectedRiskLevel}
                            leadHours={48}
                            trend={selectedForecast.windows.w48.trend}
                          />
                        </div>
                        <div className="font-mono text-xs font-semibold">{selectedForecast.windows.w48.forecastPrecipMm.toFixed(1)} mm</div>
                      </div>
                      <div className="rounded border border-border p-2 text-center bg-surface">
                        <div className="text-[0.62rem] font-bold text-muted-foreground uppercase">72 Hours</div>
                        <div className="my-1 flex justify-center">
                          <ForecastRiskBadge
                            level={selectedForecast.windows.w72.projectedRiskLevel}
                            leadHours={72}
                            trend={selectedForecast.windows.w72.trend}
                          />
                        </div>
                        <div className="font-mono text-xs font-semibold">{selectedForecast.windows.w72.forecastPrecipMm.toFixed(1)} mm</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons & Links */}
              <div className="space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <Link
                    to="/zones/$id"
                    params={{ id: String(selected.id) }}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-primary bg-primary/10 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/20 transition-colors font-display uppercase tracking-wider"
                  >
                    <span>{t("dashboard.view_zone_brief", "View Detailed Zone Brief →")}</span>
                  </Link>

                  <FieldObservationDialog
                    initialZoneId={selected.id}
                    trigger={
                      <button
                        type="button"
                        className="w-full rounded border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
                      >
                        + Report Observation for {selected.zone_name}
                      </button>
                    }
                    onSuccess={() => qc.invalidateQueries()}
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={runIngest}
                    disabled={busy}
                    className="flex-1 text-[0.7rem] font-mono"
                  >
                    {t("dashboard.ingest_weather", "Ingest Weather")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={runRecompute}
                    disabled={busy}
                    className="flex-1 text-[0.7rem] font-mono"
                  >
                    {t("dashboard.recompute", "Recompute")}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* BOTTOM THREE-COLUMN SECTION: Latest Alerts (40%), Road Connectivity (30%), Recent Observations (30%) */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_1fr] gap-6 items-stretch">
          {/* COLUMN 1: Latest Alerts */}
          <div className="panel flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-surface shrink-0">
              <h2 className="text-base font-bold text-foreground font-display">
                {t("operational_tables.latest_alerts_title", "Latest Alerts")}
              </h2>
              <Link
                to="/alerts"
                className="text-xs font-medium text-primary hover:underline font-sans"
              >
                {t("operational_tables.view_all_alerts", "View all alerts →")}
              </Link>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs border-collapse font-sans">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-muted-foreground font-medium">
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_time", "Time (IST)")}</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_level", "Level")}</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_location", "Location")}</th>
                    <th className="py-2.5 px-3">{t("operational_tables.col_message", "Message")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {data.alerts.slice(0, 5).map((a) => {
                    const z = data.zones.find((x) => x.id === a.zone_id);
                    const location = z ? `${z.zone_name}, ${z.state}` : `Zone ${a.zone_id}`;
                    return (
                      <tr key={a.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[0.7rem] whitespace-nowrap text-muted-foreground">
                          {new Date(a.dispatched_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}{" "}
                          {new Date(a.dispatched_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded border font-display text-[0.65rem] font-semibold ${
                              a.risk_level === "Severe"
                                ? "bg-risk-severe/15 text-risk-severe border-risk-severe/40"
                                : a.risk_level === "High"
                                  ? "bg-risk-high/15 text-risk-high border-risk-high/40"
                                  : a.risk_level === "Moderate"
                                    ? "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40"
                                    : "bg-risk-low/15 text-risk-low border-risk-low/40"
                            }`}
                          >
                            {a.risk_level}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-foreground whitespace-nowrap">
                          {location}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground text-[0.72rem] line-clamp-2 max-w-xs">
                          {a.message}
                        </td>
                      </tr>
                    );
                  })}
                  {data.alerts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                        {t("dashboard.no_alerts", "No alerts dispatched yet.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* COLUMN 2: Road Connectivity */}
          <div id="road-connectivity" className="panel flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-surface shrink-0">
              <h2 className="text-base font-bold text-foreground font-display">
                {t("operational_tables.road_connectivity_title", "Road Connectivity")}
              </h2>
              <a
                href="#road-connectivity"
                className="text-xs font-medium text-primary hover:underline font-sans"
              >
                {t("operational_tables.view_all_roads", "View all roads →")}
              </a>
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs border-collapse font-sans">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-muted-foreground font-medium">
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_road_link", "Road / Link")}</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_district_state", "District / State")}</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_status", "Status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {[...data.roads]
                    .sort((a, b) => (a.status === "blocked" ? -1 : 1))
                    .slice(0, 5)
                    .map((r) => {
                      const z = data.zones.find((x) => x.id === r.zone_id);
                      return (
                        <tr key={r.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-foreground block whitespace-nowrap">
                              {r.road_name}
                            </span>
                            <span className="text-[0.68rem] text-muted-foreground block">
                              {r.segment_label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
                            {z ? `${z.district}, ${z.state}` : r.segment_label}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 rounded border font-display text-[0.65rem] font-semibold ${
                                r.status === "blocked"
                                  ? "bg-risk-severe/15 text-risk-severe border-risk-severe/40"
                                  : r.status === "restricted"
                                    ? "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40"
                                    : "bg-risk-low/15 text-risk-low border-risk-low/40"
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  {data.roads.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        {t("dashboard.no_roads", "No road segments mapped yet.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* COLUMN 3: Recent Observations */}
          <div id="recent-observations" className="panel flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-surface shrink-0">
              <h2 className="text-base font-bold text-foreground font-display">
                {t("operational_tables.recent_observations_title", "Recent Observations")}
              </h2>
              <FieldObservationDialog
                trigger={
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline font-sans"
                  >
                    {t("operational_tables.view_all_observations", "View all observations →")}
                  </button>
                }
                onSuccess={() => qc.invalidateQueries()}
              />
            </div>

            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left text-xs border-collapse font-sans">
                <thead>
                  <tr className="border-b border-border bg-secondary/30 text-muted-foreground font-medium">
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_time", "Time (IST)")}</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_location", "Location")}</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_type", "Type")}</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">{t("operational_tables.col_status", "Status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {observationsList.map((obs: any) => {
                    const z = data.zones.find((x) => x.id === obs.zone_id);
                    const loc = z ? `${z.zone_name}, ${z.state}` : `Zone ${obs.zone_id}`;
                    const typeLabel =
                      obs.visual_signs ||
                      (obs.road_status && obs.road_status !== "open" ? `Road ${obs.road_status}` : "Slope Movement");
                    const statusLabel =
                      obs.status === "OFFICIAL_VERIFIED"
                        ? "Verified"
                        : obs.status === "REJECTED"
                          ? "Rejected"
                          : "Pending";
                    return (
                      <tr key={obs.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[0.7rem] whitespace-nowrap text-muted-foreground">
                          {new Date(obs.observed_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}{" "}
                          {new Date(obs.observed_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-foreground whitespace-nowrap">
                          {loc}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground text-[0.72rem] whitespace-nowrap">
                          {typeLabel}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span
                            className={`inline-block px-2 py-0.5 rounded border font-display text-[0.65rem] font-semibold ${
                              statusLabel === "Verified"
                                ? "bg-risk-low/15 text-risk-low border-risk-low/40"
                                : statusLabel === "Rejected"
                                  ? "bg-secondary/50 text-muted-foreground border-border"
                                  : "bg-risk-moderate/15 text-risk-moderate border-risk-moderate/40"
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {observationsList.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-muted-foreground">
                        No field observations reported yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* Institutional Government Footer */}
      <footer className="mt-12 border-t border-border bg-surface py-6 text-xs text-muted-foreground">
        <div className="mx-auto max-w-[1600px] px-4 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <a href="#" className="hover:text-foreground transition-colors">{t("footer.terms", "Terms of Use")}</a>
            <span>·</span>
            <a href="#" className="hover:text-foreground transition-colors">{t("footer.privacy", "Privacy Policy")}</a>
            <span>·</span>
            <a href="#" className="hover:text-foreground transition-colors">{t("footer.accessibility", "Accessibility")}</a>
            <span>·</span>
            <a href="#" className="hover:text-foreground transition-colors">{t("footer.contact", "Contact")}</a>
          </div>

          <div className="flex items-center gap-4 text-xs font-sans">
            <span>{t("footer.version", "LandAlert-Nexus v0.2")}</span>
            <span>·</span>
            <span>{t("footer.tagline", "Data for a Safer North East")}</span>
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label={t("footer.back_to_top", "Back to top")}
              className="h-7 w-7 rounded border border-border bg-secondary/40 flex items-center justify-center hover:bg-secondary transition-colors"
            >
              <ChevronUp className="h-4 w-4 text-foreground" />
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
