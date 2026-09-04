import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { getOverview } from "@/lib/monitoring.functions";
import { RiskBadge } from "@/components/RiskBits";
import { PanelSkeleton, RouteError } from "@/components/ConsoleShell";

const overviewQuery = queryOptions({
  queryKey: ["overview"],
  queryFn: () => getOverview(),
});

const TEMPLATES: Record<string, { label: string; render: (zone: string, level: string) => string }> = {
  en: {
    label: "English",
    render: (zone, level) =>
      `${level.toUpperCase()} landslide risk in ${zone}. Avoid slope-cut roads. Report cracks or slumping to your district control room.`,
  },
  as: {
    label: "অসমীয়া (Assamese)",
    render: (zone, level) =>
      `${zone}ত ভূমিস্খলনৰ ${level === "Severe" ? "গুৰুতৰ" : "উচ্চ"} আশংকা। পাহাৰীয়া পথ এৰাই চলক। ফাট বা মাটি সৰি পৰা দেখিলে জিলা নিয়ন্ত্ৰণ কক্ষক জনাওক।`,
  },
  bn: {
    label: "বাংলা (Bengali)",
    render: (zone, level) =>
      `${zone}-এ ভূমিধসের ${level === "Severe" ? "মারাত্মক" : "উচ্চ"} ঝুঁকি। পাহাড়ি রাস্তা এড়িয়ে চলুন। ফাটল বা ধস দেখলে জেলা নিয়ন্ত্রণ কক্ষে জানান।`,
  },
  ne: {
    label: "नेपाली (Nepali)",
    render: (zone, level) =>
      `${zone} मा पहिरोको ${level === "Severe" ? "गम्भीर" : "उच्च"} जोखिम। भिरालो सडक नजानुहोस्। चिरा वा पहिरो देखिए जिल्ला नियन्त्रण कक्षलाई खबर गर्नुहोस्।`,
  },
};

export const Route = createFileRoute("/alerts")({
  loader: ({ context }) => context.queryClient.ensureQueryData(overviewQuery),
  head: () => ({
    meta: [
      { title: "Alert Dispatch History — NER Landslide Console" },
      {
        name: "description",
        content:
          "Every landslide alert issued to district administrations and citizens, with the rainfall threshold reasoning and multilingual SMS text behind it.",
      },
      { property: "og:title", content: "Alert Dispatch History" },
      {
        property: "og:description",
        content:
          "Explainable landslide alerts with multilingual SMS and push templates for North East India districts.",
      },
    ],
  }),
  component: AlertsPage,
  pendingComponent: () => <PanelSkeleton label="Loading alert log…" />,
  errorComponent: ({ error, reset }) => <RouteError error={error} reset={reset} />,
});

function AlertsPage() {
  const { data } = useSuspenseQuery(overviewQuery);
  const [lang, setLang] = useState("en");
  const [level, setLevel] = useState("All");

  const alerts = useMemo(
    () => (level === "All" ? data.alerts : data.alerts.filter((a) => a.risk_level === level)),
    [data.alerts, level],
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:px-8">
      <div className="label-caps">Dispatch log</div>
      <h1 className="mt-1 text-3xl font-semibold uppercase tracking-wide">
        Alert Console
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Alerts are raised automatically when a zone crosses into High or Severe. Each
        one carries the threshold arithmetic that triggered it, and ships over SMS and
        push in the recipient's preferred language.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {["All", "Severe", "High"].map((l) => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            className={`rounded border px-3 py-1 font-mono text-xs ${
              level === l
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {l}
          </button>
        ))}
        <span className="mx-2 h-6 w-px bg-border" />
        {Object.entries(TEMPLATES).map(([code, t]) => (
          <button
            key={code}
            onClick={() => setLang(code)}
            className={`rounded border px-3 py-1 font-mono text-xs ${
              lang === code
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {alerts.map((a) => {
          const zone = data.zones.find((z) => z.id === a.zone_id);
          const zoneName = zone ? `${zone.zone_name}, ${zone.state}` : `Zone ${a.zone_id}`;
          return (
            <article key={a.id} className="panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <RiskBadge level={a.risk_level} />
                  <Link
                    to="/zones/$id"
                    params={{ id: String(a.zone_id) }}
                    className="font-display text-sm uppercase tracking-wide hover:text-primary"
                  >
                    {zoneName}
                  </Link>
                </div>
                <span className="font-mono text-[0.7rem] text-muted-foreground">
                  {new Date(a.dispatched_at).toLocaleString()} · {a.channel} ·{" "}
                  {a.dispatched_by}
                </span>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded border border-border bg-surface-raised p-3">
                  <div className="label-caps">SMS · {TEMPLATES[lang]!.label}</div>
                  <p className="mt-2 text-sm leading-relaxed">
                    {TEMPLATES[lang]!.render(zoneName, a.risk_level)}
                  </p>
                </div>
                <div className="rounded border border-primary/35 bg-primary/5 p-3">
                  <div className="label-caps text-primary">Why this fired</div>
                  <p className="mt-2 font-mono text-[0.75rem] leading-relaxed">
                    {a.explanation}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
        {alerts.length === 0 && (
          <p className="text-sm text-muted-foreground">No alerts match this filter.</p>
        )}
      </div>
    </div>
  );
}
