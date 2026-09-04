import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getOverview,
  recomputeAll,
  ingestLiveRainfall,
  getRiskPredictionServerFn,
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

  const counts = RISK_LEVELS.map((lvl) => ({
    lvl,
    n: data.zones.filter((z) => z.current_risk_level === lvl).length,
  }));

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
            Landslide Early Warning Console
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Rainfall, soil-moisture and terrain fused with published NE-Himalaya threshold
            equations. Every risk level carries the reasoning that produced it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {data.activeModel && (
              <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[0.68rem] text-primary">
                Active Model: {data.activeModel.model_version}
              </span>
            )}
            <ScientificLimitationBadge />
            <span className="rounded border border-border bg-secondary/50 px-2 py-0.5 font-mono text-[0.68rem] text-muted-foreground">
              Observation Trust: Official Review Required
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
            Ingest Open-Meteo
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runRecompute}
            disabled={busy}
            className="font-mono text-xs uppercase"
          >
            Recompute risk
          </Button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {counts.map((c) => (
          <Stat key={c.lvl} label={`${c.lvl} zones`} value={c.n} tone={riskColor(c.lvl)} />
        ))}
        <Stat
          label="Population exposed"
          value={atRisk.toLocaleString("en-IN")}
          hint="Residents in High or Severe zones"
        />
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[1.6fr_1fr] items-stretch">
        <div className="panel overflow-hidden flex flex-col h-full">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
            <div className="label-caps">Risk heatmap</div>
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
          <div className="w-full flex-1 min-h-[460px] relative">
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
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {selected && (
            <div className="panel p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="label-caps">Selected zone</div>
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
                      <span className="font-mono text-[0.68rem] text-primary">
                        ML Risk: {(selectedMl.probability * 100).toFixed(1)}% (
                        {selectedMl.risk_level})
                      </span>
                    )}
                  </div>
                </div>
                <RiskBadge level={selected.current_risk_level} score={selected.risk_score} />
              </div>

              <div>
                <ExplanationCard explanation={selected.explanation} />
              </div>

              {selectedMl?.factor_attribution && (
                <MLAttributionCard
                  topCategories={selectedMl.factor_attribution.top_categories}
                  topFeatures={selectedMl.factor_attribution.top_features}
                />
              )}

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
                  Open zone brief →
                </Link>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="border-b border-border px-4 py-3 label-caps">Response priority</div>
            <div className="max-h-[300px] overflow-y-auto">
              {zones.map((z) => (
                <button
                  key={z.id}
                  onClick={() => setSelectedId(z.id)}
                  className={`flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 text-left transition-colors hover:bg-secondary/60 ${
                    selected?.id === z.id ? "bg-secondary/70" : ""
                  }`}
                >
                  <span>
                    <span className="block text-sm">{z.zone_name}</span>
                    <span className="block font-mono text-[0.68rem] text-muted-foreground">
                      {z.state} · {z.population.toLocaleString("en-IN")} residents
                    </span>
                  </span>
                  <RiskBadge level={z.current_risk_level} score={z.risk_score} />
                </button>
              ))}
              {zones.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  No monitored zones in {stateFilter}.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="label-caps">Road connectivity</span>
            <span className="font-mono text-xs text-muted-foreground">
              {blocked.length} blocked · {restricted.length} restricted
            </span>
          </div>
          <div className="max-h-[260px] overflow-y-auto">
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
              <p className="p-4 text-sm text-muted-foreground">No road segments mapped yet.</p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="label-caps">Alert console</span>
            <Link
              to="/alerts"
              className="font-display text-xs uppercase tracking-widest text-primary hover:underline"
            >
              Full history →
            </Link>
          </div>
          <div className="max-h-[260px] space-y-3 overflow-y-auto p-4">
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
              <p className="text-sm text-muted-foreground">No alerts dispatched yet.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
