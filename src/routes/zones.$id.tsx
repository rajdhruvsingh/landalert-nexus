import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
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
import { getZoneDetail } from "@/lib/monitoring.functions";
import { MapCanvas } from "@/components/MapCanvas";
import { RiskBadge, RoadBadge, Stat, ExplanationCard } from "@/components/RiskBits";
import { PanelSkeleton, RouteError } from "@/components/ConsoleShell";
import {
  intensityThresholdMmPerDay,
  moistureThresholdMm,
  riskColor,
} from "@/lib/risk";

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
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(zoneQuery(Number(id)));
  const zone = data.zone!;

  const daily = aggregateDaily(data.readings);
  const iThr = intensityThresholdMmPerDay(3);
  const eThr = moistureThresholdMm(720);

  const r72 = data.readings
    .filter((r) => Date.now() - new Date(r.reading_time).getTime() < 3 * 864e5)
    .reduce((s, r) => s + r.rainfall_mm, 0);
  const r30 = data.readings.reduce((s, r) => s + r.rainfall_mm, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
      <Link
        to="/"
        className="font-display text-xs uppercase tracking-widest text-primary hover:underline"
      >
        ← Back to console
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-caps">Zone brief</div>
          <h1 className="mt-1 text-3xl font-semibold uppercase tracking-wide">
            {zone.zone_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {zone.district} district · {zone.state} ·{" "}
            {zone.population.toLocaleString("en-IN")} residents
          </p>
        </div>
        <RiskBadge
          level={zone.current_risk_level}
          score={zone.risk_score}
          className="px-3 py-1.5 text-sm"
        />
      </header>

      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="72-hr rainfall"
          value={`${r72.toFixed(0)} mm`}
          hint={`Intensity ${(r72 / 3).toFixed(1)} vs ${iThr.toFixed(1)} mm/day threshold`}
          tone={r72 / 3 > iThr ? riskColor("Severe") : undefined}
        />
        <Stat
          label="30-day antecedent"
          value={`${r30.toFixed(0)} mm`}
          hint={`Moisture threshold ${eThr.toFixed(0)} mm`}
          tone={r30 > eThr ? riskColor("High") : undefined}
        />
        <Stat label="Mean slope" value={`${zone.mean_slope_deg}°`} hint="SRTM-derived terrain" />
        <Stat
          label="Historical slides"
          value={data.slides.length}
          hint="GSI inventory records in zone"
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="panel p-4">
          <div className="label-caps">Rainfall vs threshold · 30 days</div>
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
                <Bar dataKey="rain" fill={riskColor("Moderate")} name="Rainfall (mm)" />
                <Line
                  type="monotone"
                  dataKey="threshold"
                  stroke={riskColor("Severe")}
                  strokeDasharray="4 4"
                  dot={false}
                  name="I-D threshold"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 label-caps">Soil moisture (%)</div>
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
              Zone footprint & slide history
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

          <div className="panel">
            <div className="border-b border-border px-4 py-3 label-caps">
              Road segments
            </div>
            {data.roads.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-sm last:border-0"
              >
                <span>
                  <span className="font-mono text-primary">{r.road_name}</span>{" "}
                  {r.segment_label}
                  <span className="block text-[0.68rem] text-muted-foreground">
                    {r.length_km} km
                  </span>
                </span>
                <RoadBadge status={r.status} />
              </div>
            ))}
            {data.roads.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">No mapped segments.</p>
            )}
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="border-b border-border px-4 py-3 label-caps">
            Historical landslide inventory
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {data.slides.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between border-b border-border/60 px-4 py-2 text-sm"
              >
                <span className="font-mono text-xs">{s.event_date}</span>
                <span className="text-xs text-muted-foreground">{s.source}</span>
                <RiskBadge level={s.severity} />
              </div>
            ))}
            {data.slides.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No recorded events for this zone.
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="border-b border-border px-4 py-3 label-caps">
            Alerts issued for this zone
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
              <p className="text-sm text-muted-foreground">
                No alerts dispatched for this zone.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function aggregateDaily(readings: { reading_time: string; rainfall_mm: number; soil_moisture_pct: number | null }[]) {
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
