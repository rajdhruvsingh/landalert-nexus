import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getUserAuthorizationState } from "@/lib/official-auth.service";
import {
  Area,
  AreaChart,
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import {
  getZoneDetail,
  getRiskPredictionServerFn,
  dispatchAlertServerFn,
  getZoneWeatherRiskForecastServerFn,
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
} from "@/components/RiskBits";
import { PanelSkeleton, RouteError } from "@/components/ConsoleShell";
import { FieldObservationDialog } from "@/components/FieldObservationDialog";
import { intensityThresholdMmPerDay, moistureThresholdMm, riskColor } from "@/lib/risk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const zoneQuery = (id: number) =>
  queryOptions({
    queryKey: ["zone", id],
    queryFn: () => getZoneDetail({ data: { id } }),
  });

export const Route = createFileRoute("/zones/$id")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(zoneQuery(Number(params.id)));
    if (!data.zone) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData?.zone) {
      return {
        meta: [
          { title: "Zone unavailable — NER Landslide Console" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const z = loaderData.zone;
    const title = `${z.zone_name}, ${z.state} — ${z.current_risk_level} Landslide Risk`;
    const description = `Risk score ${z.risk_score}/100 for ${z.zone_name} in ${z.district} district. Rainfall trend, terrain slope, historical slides and the threshold reasoning behind the current alert.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  component: ZonePage,
  pendingComponent: () => <PanelSkeleton label="Loading zone brief…" />,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
});

function ZonePage() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(zoneQuery(Number(id)));
  const qc = useQueryClient();
  const zone = data.zone!;

  const { data: mlPrediction, isLoading: mlLoading } = useQuery({
    queryKey: ["risk-prediction", Number(id)],
    queryFn: () => getRiskPredictionServerFn({ data: { zoneId: Number(id) } }),
  });

  const { data: forecastData, isLoading: forecastLoading } = useQuery({
    queryKey: ["weather-forecast", Number(id)],
    queryFn: () => getZoneWeatherRiskForecastServerFn({ data: { zoneId: Number(id) } }),
  });

  const [alertOpen, setAlertOpen] = useState(false);
  const [alertLang, setAlertLang] = useState<"en" | "as" | "bn" | "ne">("en");
  const [alertChannel, setAlertChannel] = useState<"sms" | "push" | "both">("both");
  const [justification, setJustification] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<string>("PUBLIC_USER");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) {
        const authState = getUserAuthorizationState({ email: session.user.email, user_metadata: session.user.user_metadata });
        setViewerRole(authState.role);
      }
    });
  }, []);

  const daily = aggregateDaily(data.readings);
  const iThr = intensityThresholdMmPerDay(3);
  const eThr = moistureThresholdMm(720);

  const r72 = data.readings
    .filter((r) => Date.now() - new Date(r.reading_time).getTime() < 3 * 864e5)
    .reduce((s, r) => s + r.rainfall_mm, 0);
  const r30 = data.readings.reduce((s, r) => s + r.rainfall_mm, 0);

  async function handleDispatchAlert() {
    setDispatching(true);
    setDispatchStatus(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res: any = await dispatchAlertServerFn({
        data: {
          zoneId: zone.id,
          language: alertLang,
          channel: alertChannel,
          justification: justification.trim(),
          ...(session?.access_token ? { userToken: session.access_token } : {}),
        },
      });
      setDispatchStatus(
        res.dispatched
          ? `Alert dispatched successfully via ${alertChannel.toUpperCase()} (Record ID: ${res.alertId ?? "Logged"}).`
          : `Alert suppressed: ${res.reason}`,
      );
      await qc.invalidateQueries();
      setTimeout(() => {
        if (res.dispatched) {
          setAlertOpen(false);
          setJustification("");
        }
      }, 2000);
    } catch (err) {
      setDispatchStatus(`Dispatch rejected: ${err instanceof Error ? err.message : "Unauthorized"}`);
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/"
          className="font-display text-xs uppercase tracking-widest text-primary hover:underline"
        >
          {t("zone_detail.back_to_console")}
        </Link>
        <div className="flex items-center gap-2">
          <FieldObservationDialog
            initialZoneId={zone.id}
            trigger={
              <Button variant="outline" size="sm" className="font-mono text-xs uppercase">
                {t("nav.report_field_reading")}
              </Button>
            }
            onSuccess={() => qc.invalidateQueries()}
          />
          <Dialog open={alertOpen} onOpenChange={setAlertOpen}>
            <DialogTrigger asChild>
              <Button
                variant={
                  ["High", "Severe"].includes(zone.current_risk_level) ? "destructive" : "secondary"
                }
                size="sm"
                className="font-mono text-xs uppercase tracking-wider"
              >
                {t("alerts.dispatch_alert")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px] bg-surface text-foreground border-border">
              <DialogHeader>
                <DialogTitle className="text-xl font-display uppercase tracking-wide">
                  {t("alerts.dispatch_alert")}: {zone.zone_name}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  {t("alerts.dispatcher_decision_notice")}
                </DialogDescription>
              </DialogHeader>

              <div className="rounded border border-primary/20 bg-primary/5 p-2.5 text-[0.7rem] font-mono text-muted-foreground">
                <span className="font-semibold text-primary uppercase tracking-wide">{t("alerts.authority_notice")}: </span>
                {t("alerts.authority_notice_body")}
              </div>

              {dispatchStatus && (
                <div className="rounded border border-primary/40 bg-primary/10 p-3 text-xs font-mono text-primary">
                  {dispatchStatus}
                </div>
              )}

              <div className="space-y-4 pt-1">
                <div className="flex items-center justify-between rounded border border-border bg-secondary/30 p-3">
                  <div>
                    <div className="label-caps text-[0.68rem]">{t("zone_detail.authoritative_risk_level")}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <RiskBadge level={mlPrediction?.risk_level ?? zone.current_risk_level} score={mlPrediction?.risk_score ?? zone.risk_score} />
                      <span className="font-mono text-xs text-muted-foreground">
                        {t("zone_detail.ml_probability")}:{" "}
                        {mlPrediction
                          ? mlPrediction.probability !== null
                            ? `${(mlPrediction.probability * 100).toFixed(1)}%`
                            : "Unavailable"
                          : "Loading…"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      {t("alerts.language")}
                    </label>
                    <Select
                      value={alertLang}
                      onValueChange={(v) => setAlertLang(v as "en" | "as" | "bn" | "ne")}
                    >
                      <SelectTrigger className="bg-secondary/40 border-border font-mono text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-surface border-border">
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="as">অসমীয়া (Assamese)</SelectItem>
                        <SelectItem value="bn">বাংলা (Bengali)</SelectItem>
                        <SelectItem value="ne">नेपाली (Nepali)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs font-mono uppercase text-muted-foreground">
                      {t("alerts.channel")}
                    </label>
                    <Select
                      value={alertChannel}
                      onValueChange={(v) => setAlertChannel(v as "sms" | "push" | "both")}
                    >
                      <SelectTrigger className="bg-secondary/40 border-border font-mono text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-surface border-border">
                        <SelectItem value="both">{t("alerts.channel_both")}</SelectItem>
                        <SelectItem value="sms">{t("alerts.channel_sms")}</SelectItem>
                        <SelectItem value="push">{t("alerts.channel_push")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-mono uppercase text-muted-foreground">
                    {t("alerts.justification_required")}
                  </label>
                  <Input
                    type="text"
                    placeholder="e.g. Field verification and radar confirm high debris-flow hazard"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    minLength={8}
                    required
                    className="bg-secondary/40 border-border font-mono text-xs"
                  />
                </div>

                <div className="rounded border border-border/80 bg-secondary/20 p-3 font-mono text-xs space-y-1">
                  <div className="label-caps text-[0.65rem]">{t("zone_detail.recipient_group")}</div>
                  <div className="text-foreground">
                    {t("zone_detail.recipients_desc")}
                  </div>
                  <div className="text-[0.68rem] text-muted-foreground">
                    {t("zone_detail.population_in_coverage")}: {zone.population.toLocaleString("en-IN")}
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAlertOpen(false)}
                  disabled={dispatching}
                  className="font-mono text-xs"
                >
                  {t("alerts.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDispatchAlert}
                  disabled={dispatching || justification.trim().length < 8}
                  className="font-mono text-xs uppercase"
                >
                  {dispatching ? t("alerts.authorizing") : t("alerts.authorize_dispatch")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-caps">{t("zone_detail.zone_brief")}</div>
          <h1 className="mt-1 text-3xl font-semibold uppercase tracking-wide">{zone.zone_name}</h1>
          <p className="text-sm text-muted-foreground">
            {zone.district} district · {zone.state} · {zone.population.toLocaleString("en-IN")}{" "}
            {t("zone_detail.residents")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {data.activeModel && (
              <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[0.68rem] text-primary">
                {t("zone_detail.model")}: {data.activeModel.model_version}
              </span>
            )}
            <ScientificLimitationBadge />
            <FreshnessBadge
              ageHours={mlPrediction?.data_freshness?.weather_age_hours}
              status={zone.soil_moisture_status as "measured" | "stale" | "fallback" | "missing"}
            />
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <RiskBadge
            level={mlPrediction?.risk_level ?? zone.current_risk_level}
            score={mlPrediction?.risk_score ?? zone.risk_score}
            className="px-3 py-1.5 text-sm"
          />
          {mlPrediction && (
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              {mlPrediction.probability !== null
                ? `${t("zone_detail.ml_probability")}: ${(mlPrediction.probability * 100).toFixed(1)}%`
                : "ML Probability: Unavailable"}
            </span>
          )}
        </div>
      </header>

      {mlPrediction?.status === "STALE" && (
        <div className="mt-3 flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-xs text-amber-300">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="font-semibold uppercase tracking-wider">⚠ Stale Telemetry</span>
          <span className="text-amber-200">
            — last computed at {mlPrediction.data_freshness.latest_weather_timestamp ?? mlPrediction.inference_timestamp}, may be stale.
          </span>
        </div>
      )}

      {mlPrediction?.risk_level === "UNKNOWN" && (
        <div className="mt-3 flex items-center gap-2 rounded border border-border bg-secondary/60 px-3 py-1.5 font-mono text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-slate-400" />
          <span className="font-semibold uppercase tracking-wider">{t("risk_levels.UNKNOWN")}</span>
          <span>— {t("risk_bits.status_unknown_unavailable")}</span>
        </div>
      )}

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label={t("zone_detail.stat_rainfall_72h")}
          value={`${r72.toFixed(0)} mm`}
          hint={`Intensity ${(r72 / 3).toFixed(1)} vs ${iThr.toFixed(1)} mm/day threshold`}
          tone={r72 / 3 > iThr ? riskColor("Severe") : undefined}
        />
        <Stat
          label={t("zone_detail.stat_antecedent_30d")}
          value={`${r30.toFixed(0)} mm`}
          hint={`Moisture threshold ${eThr.toFixed(0)} mm`}
          tone={r30 > eThr ? riskColor("High") : undefined}
        />
        <Stat
          label={t("zone_detail.stat_ml_inferred")}
          value={
            mlPrediction
              ? mlPrediction.probability !== null
                ? `${(mlPrediction.probability * 100).toFixed(1)}%`
                : "Unavailable"
              : "…"
          }
          hint={mlPrediction?.risk_level === "UNKNOWN" ? "Telemetry unavailable" : "Logistic Regression v2 (19 features)"}
          tone={mlPrediction && mlPrediction.probability !== null && mlPrediction.probability >= 0.65 ? riskColor("Severe") : undefined}
        />
        <Stat
          label={t("zone_detail.stat_mean_slope")}
          value={`${zone.mean_slope_deg}°`}
          hint="Slope source in zone data; see docs/DATA_SOURCES.md"
        />
        <Stat
          label={t("zone_detail.stat_historical_slides")}
          value={data.slides.length}
          hint="Synthetic fixture — illustrative only, not from GSI Bhukosh"
        />
      </section>

      {/* Weather-Linked Risk Forecast Section */}
      <section className="mt-4 panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="label-caps">{t("weather_forecast.section_title")}</span>
              <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[0.65rem] text-primary">
                Open-Meteo Guidance
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("weather_forecast.section_desc")}
            </p>
          </div>
          <span className="text-[0.68rem] text-muted-foreground italic">
            {t("weather_forecast.disclaimer")}
          </span>
        </div>

        {forecastLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground font-mono">
            Loading forecast projections…
          </div>
        ) : !forecastData || forecastData.forecastStatus === "UNAVAILABLE" || !forecastData.forecastWindows ? (
          <div className="mt-3 rounded border border-border/80 bg-secondary/30 p-4 text-center">
            <p className="font-mono text-xs text-muted-foreground">
              ⚠ {t("weather_forecast.forecast_unavailable")}
            </p>
            {forecastData?.explanation && (
              <p className="mt-1 text-[0.7rem] text-muted-foreground/80">
                {forecastData.explanation}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Current Authoritative Level Card */}
            <div className="rounded border border-border/80 bg-card p-3 shadow-sm">
              <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("weather_forecast.current_level")}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <RiskBadge
                  level={forecastData.currentRiskLevel}
                  score={forecastData.currentRiskScore}
                />
              </div>
              <p className="mt-2 text-[0.72rem] text-muted-foreground">
                Authoritative current state derived from ground telemetry.
              </p>
            </div>

            {/* +24h Window Card */}
            <div className="rounded border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-primary">
                  {t("weather_forecast.projected_24h")}
                </span>
                <span className="text-[0.62rem] text-emerald-400 font-mono">
                  {t("weather_forecast.skill_high")}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <ForecastRiskBadge
                  level={forecastData.forecastWindows["24h"].projectedRiskLevel}
                  leadHours={24}
                  trend={forecastData.forecastWindows["24h"].trend}
                  confidence={forecastData.forecastWindows["24h"].confidence}
                />
                <span className="font-mono text-xs text-foreground font-semibold">
                  {forecastData.forecastWindows["24h"].forecastRainfallMm.toFixed(1)} mm
                </span>
              </div>
              <p className="mt-2 text-[0.72rem] text-muted-foreground">
                {forecastData.forecastWindows["24h"].narrative}
              </p>
            </div>

            {/* +48h Window Card */}
            <div className="rounded border border-border/80 bg-card/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("weather_forecast.projected_48h")}
                </span>
                <span className="text-[0.62rem] text-amber-400 font-mono">
                  {t("weather_forecast.skill_medium")}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <ForecastRiskBadge
                  level={forecastData.forecastWindows["48h"].projectedRiskLevel}
                  leadHours={48}
                  trend={forecastData.forecastWindows["48h"].trend}
                  confidence={forecastData.forecastWindows["48h"].confidence}
                />
                <span className="font-mono text-xs text-foreground font-semibold">
                  {forecastData.forecastWindows["48h"].forecastRainfallMm.toFixed(1)} mm
                </span>
              </div>
              <p className="mt-2 text-[0.72rem] text-muted-foreground">
                {forecastData.forecastWindows["48h"].narrative}
              </p>
            </div>

            {/* +72h Window Card */}
            <div className="rounded border border-dashed border-border/60 bg-card/30 p-3 opacity-90">
              <div className="flex items-center justify-between">
                <span className="text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("weather_forecast.projected_72h")}
                </span>
                <span className="text-[0.62rem] text-slate-400 font-mono">
                  {t("weather_forecast.skill_low")}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <ForecastRiskBadge
                  level={forecastData.forecastWindows["72h"].projectedRiskLevel}
                  leadHours={72}
                  trend={forecastData.forecastWindows["72h"].trend}
                  confidence={forecastData.forecastWindows["72h"].confidence}
                />
                <span className="font-mono text-xs text-foreground font-semibold">
                  {forecastData.forecastWindows["72h"].forecastRainfallMm.toFixed(1)} mm
                </span>
              </div>
              <p className="mt-2 text-[0.72rem] text-muted-foreground">
                {forecastData.forecastWindows["72h"].narrative}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel p-4">
          <div className="label-caps">{t("zone_detail.chart_rainfall_title")}</div>
          <div className="mt-3 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily}>
                <CartesianGrid strokeOpacity={0.12} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="currentColor" />
                <YAxis tick={{ fontSize: 10 }} stroke="currentColor" />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="rain" fill={riskColor("Moderate")} name={t("zone_detail.chart_rainfall_series")} />
                <Line
                  type="monotone"
                  dataKey="threshold"
                  stroke={riskColor("Severe")}
                  strokeDasharray="4 4"
                  dot={false}
                  name={t("zone_detail.chart_threshold_series")}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="label-caps">{t("zone_detail.chart_soil_title")}</span>
            {zone.soil_moisture_status === "fallback" ? (
              <span
                className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.65rem] text-amber-400"
                title="ERA5-Land historical soil moisture was unavailable for this region; fallback proxy 50% used."
              >
                {t("zone_detail.soil_fallback_badge")}
              </span>
            ) : zone.soil_moisture_status === "measured" ? (
              <span
                className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.65rem] text-emerald-400"
                title="ERA5-Land 0-3cm normalized to 0.40 m³/m³ field capacity"
              >
                {t("zone_detail.soil_observed_badge")}
              </span>
            ) : zone.soil_moisture_status === "stale" ? (
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.65rem] text-amber-400">
                {t("zone_detail.soil_stale_badge")}
              </span>
            ) : null}
          </div>
          <div className="mt-2 h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
                <CartesianGrid strokeOpacity={0.12} vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="currentColor" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="currentColor" />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface-raised)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="moisture"
                  stroke={riskColor("High")}
                  fill={riskColor("High")}
                  fillOpacity={0.2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel overflow-hidden">
            <div className="border-b border-border px-4 py-3 label-caps">
              {t("zone_detail.zone_footprint")}
            </div>
            <div className="h-[240px]">
              <MapCanvas
                zones={[zone]}
                slides={data.slides}
                selectedId={zone.id}
                center={[zone.centroid_lat, zone.centroid_lng]}
                zoom={11}
              />
            </div>
          </div>

          <ExplanationCard explanation={zone.explanation} />

          <MLAttributionCard
            topCategories={mlPrediction?.factor_attribution?.top_categories}
            topFeatures={mlPrediction?.factor_attribution?.top_features}
          />

          <div className="panel">
            <div className="border-b border-border px-4 py-3 label-caps">{t("zone_detail.road_segments")}</div>
            {data.roads.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-sm last:border-0"
              >
                <span>
                  <span className="font-mono text-primary">{r.road_name}</span> {r.segment_label}
                  <span className="block text-[0.68rem] text-muted-foreground">
                    {r.length_km} km
                  </span>
                </span>
                <RoadBadge status={r.status} />
              </div>
            ))}
            {data.roads.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">{t("zone_detail.no_road_segments")}</p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="label-caps">{t("zone_detail.historical_inventory")}</span>
              {/* Gap 3: Clearly mark synthetic data so judges/teammates cannot mistake it for real GSI Bhukosh records */}
              <span
                className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[0.65rem] text-amber-400"
                title="These events were generated programmatically for demonstration purposes. They do not represent real GSI Bhukosh records. See docs/DATA_SOURCES.md for how to replace them with real inventory data."
              >
                {t("zone_detail.synthetic_badge")}
              </span>
            </div>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {data.slides.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-sm"
              >
                <span className="font-mono text-xs">{s.event_date}</span>
                <span
                  className="max-w-[180px] truncate text-[0.68rem] text-amber-400/80"
                  title={s.source}
                >
                  ⚠ synthetic
                </span>
                <RiskBadge level={s.severity} />
              </div>
            ))}
            {data.slides.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">{t("zone_detail.no_historical_slides")}</p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="border-b border-border px-4 py-3 label-caps">
            {t("zone_detail.alerts_issued")}
          </div>
          <div className="max-h-[240px] space-y-3 overflow-y-auto p-4">
            {data.alerts.map((a) => (
              <div key={a.id} className="rounded border border-border p-3">
                <div className="flex items-center justify-between">
                  <RiskBadge level={a.risk_level} />
                  <span className="font-mono text-[0.68rem] text-muted-foreground">
                    {new Date(a.dispatched_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-sm">{a.message}</p>
              </div>
            ))}
            {data.alerts.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("zone_detail.no_alerts_issued")}</p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-4 panel">
        <div className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="label-caps">{t("zone_detail.field_observations_title")}</span>
            <span className="font-mono text-xs text-muted-foreground">
              ({data.observations?.length || 0} {t("zone_detail.reports")})
            </span>
          </div>
          <span className="font-mono text-[0.68rem] text-muted-foreground">
            {t("zone_detail.official_approval_notice")}
          </span>
        </div>
        <div className="p-4 space-y-4">
          {(!data.observations || data.observations.length === 0) && (
            <p className="text-sm text-muted-foreground py-2">{t("zone_detail.no_observations")}</p>
          )}
          {data.observations?.map((obs: any) => {
            const isApproved = obs.review_status === "APPROVED" || obs.status === "OFFICIAL_VERIFIED";
            const isOfficialViewer = ["DISPATCHER", "ADMIN", "VERIFIED_OFFICIAL"].includes(viewerRole);
            const canViewMedia = isApproved || isOfficialViewer;

            return (
              <div key={obs.id} className="rounded border border-border/70 bg-card/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">
                      {obs.observer_id || "Field Observer"}
                    </span>
                    <span className="text-muted-foreground text-xs">•</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(obs.observed_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isApproved ? (
                      <span className="inline-flex items-center rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[0.68rem] text-emerald-400 border border-emerald-500/30">
                        {t("zone_detail.verified_official")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[0.68rem] text-amber-400 border border-amber-500/30">
                        {t("zone_detail.unverified_pending")}
                      </span>
                    )}
                    {obs.road_status && <RoadBadge status={obs.road_status} />}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono mb-3 text-muted-foreground">
                  {obs.rainfall_mm !== null && obs.rainfall_mm !== undefined && (
                    <div>{t("zone_detail.label_rainfall")} <span className="text-foreground">{obs.rainfall_mm} mm/h</span></div>
                  )}
                  {obs.soil_condition && (
                    <div>{t("zone_detail.label_soil")} <span className="text-foreground">{obs.soil_condition}</span></div>
                  )}
                  {obs.visual_signs && (
                    <div className="col-span-2">{t("zone_detail.label_signs")} <span className="text-amber-300">{obs.visual_signs}</span></div>
                  )}
                  {obs.geo_lat && obs.geo_lng && (
                    <div className="col-span-2 text-primary">
                      {t("zone_detail.label_gps")} {obs.geo_lat.toFixed(4)}°N, {obs.geo_lng.toFixed(4)}°E (±{Math.round(obs.geo_accuracy_m || 0)}m)
                    </div>
                  )}
                </div>

                {obs.media_urls && obs.media_urls.length > 0 && (
                  <div>
                    {canViewMedia ? (
                      <div className="flex flex-wrap gap-3 mt-2">
                        {obs.media_urls.map((url: string, idx: number) => {
                          const isVideo = url.endsWith(".mp4") || url.endsWith(".webm") || url.includes("video");
                          return (
                            <div key={idx} className="relative rounded overflow-hidden border border-border bg-black/40 h-24 w-36 flex items-center justify-center">
                              {isVideo ? (
                                <video src={url} controls className="h-full w-full object-cover" />
                              ) : (
                                <a href={url} target="_blank" rel="noopener noreferrer">
                                  <img src={url} alt={`Observation media ${idx + 1}`} className="h-full w-full object-cover hover:scale-105 transition-transform" />
                                </a>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded bg-secondary/30 p-2 text-xs font-mono text-muted-foreground border border-border/50 mt-2">
                        {t("zone_detail.media_quarantined")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function aggregateDaily(
  readings: { reading_time: string; rainfall_mm: number; soil_moisture_pct: number | null }[],
) {
  const map = new Map<string, { rain: number; moisture: number; n: number }>();
  for (const r of readings) {
    const day = new Date(r.reading_time).toISOString().slice(5, 10);
    const cur = map.get(day) ?? { rain: 0, moisture: 0, n: 0 };
    cur.rain += r.rainfall_mm;
    cur.moisture += r.soil_moisture_pct ?? 0;
    cur.n += 1;
    map.set(day, cur);
  }
  const threshold = intensityThresholdMmPerDay(1);
  return Array.from(map.entries()).map(([day, v]) => ({
    day,
    rain: Number(v.rain.toFixed(1)),
    moisture: Number((v.moisture / Math.max(v.n, 1)).toFixed(1)),
    threshold: Number(threshold.toFixed(1)),
  }));
}
