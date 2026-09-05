import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getOverview, dispatchAlertServerFn } from "@/lib/monitoring.functions";
import { RiskBadge } from "@/components/RiskBits";
import { PanelSkeleton, RouteError } from "@/components/ConsoleShell";
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

const overviewQuery = queryOptions({
  queryKey: ["overview"],
  queryFn: () => getOverview(),
});

const TEMPLATES: Record<
  string,
  { label: string; render: (zone: string, level: string) => string }
> = {
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
  const { t } = useTranslation();
  const { data } = useSuspenseQuery(overviewQuery);
  const qc = useQueryClient();
  const [lang, setLang] = useState("en");
  const [level, setLevel] = useState("All");
  const [selectedZoneFilter, setSelectedZoneFilter] = useState<string>("All");

  // Alert dispatch modal state
  const [openDispatch, setOpenDispatch] = useState(false);
  const [targetZoneId, setTargetZoneId] = useState<number>(data.zones[0]?.id ?? 1);
  const [targetLang, setTargetLang] = useState<"en" | "as" | "bn" | "ne">("en");
  const [targetChannel, setTargetChannel] = useState<"sms" | "push" | "both">("both");
  const [justification, setJustification] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);

  const alerts = useMemo(() => {
    return data.alerts.filter((a) => {
      const matchLevel = level === "All" || a.risk_level === level;
      const matchZone = selectedZoneFilter === "All" || String(a.zone_id) === selectedZoneFilter;
      return matchLevel && matchZone;
    });
  }, [data.alerts, level, selectedZoneFilter]);

  async function handleManualDispatch(e: React.FormEvent) {
    e.preventDefault();
    setDispatching(true);
    setDispatchResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await dispatchAlertServerFn({
        data: {
          zoneId: targetZoneId,
          language: targetLang,
          channel: targetChannel,
          justification: justification.trim(),
          ...(session?.access_token ? { userToken: session.access_token } : {}),
        },
      });

      if (res.dispatched) {
        setDispatchResult(`Emergency alert broadcast confirmed (ID: ${res.alertId ?? "Active"}).`);
        await qc.invalidateQueries();
        setTimeout(() => {
          setOpenDispatch(false);
          setDispatchResult(null);
          setJustification("");
        }, 1800);
      } else {
        setDispatchResult(`Alert suppressed by rules engine: ${res.reason}`);
      }
    } catch (err) {
      setDispatchResult(`Dispatch rejected: ${err instanceof Error ? err.message : "Unauthorized"}`);
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="label-caps">{t("alerts.console_tag")}</div>
          <h1 className="mt-1 text-3xl font-semibold uppercase tracking-wide">{t("alerts.console_title")}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {t("alerts.console_desc")}
          </p>
        </div>

        <Dialog open={openDispatch} onOpenChange={setOpenDispatch}>
          <DialogTrigger asChild>
            <Button
              variant="default"
              size="sm"
              className="font-mono text-xs uppercase tracking-wider"
            >
              {t("alerts.dispatch_emergency_alert")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[480px] bg-surface text-foreground border-border">
            <DialogHeader>
              <DialogTitle className="text-xl font-display uppercase tracking-wide">
                {t("alerts.issue_alert_title")}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {t("alerts.issue_alert_desc")}
              </DialogDescription>
            </DialogHeader>

            <div className="rounded border border-primary/20 bg-primary/5 p-2.5 text-[0.7rem] font-mono text-muted-foreground">
              <span className="font-semibold text-primary uppercase tracking-wide">Authority Notice: </span>
              {t("alerts.authority_notice")}
            </div>

            {dispatchResult && (
              <div className="rounded border border-primary/40 bg-primary/10 p-3 text-xs font-mono text-primary">
                {dispatchResult}
              </div>
            )}

            <form onSubmit={handleManualDispatch} className="space-y-4 pt-1">
              <div className="grid gap-2">
                <label className="text-xs font-mono uppercase text-muted-foreground">
                  {t("alerts.target_zone")}
                </label>
                <Select
                  value={String(targetZoneId)}
                  onValueChange={(v) => setTargetZoneId(Number(v))}
                >
                  <SelectTrigger className="bg-secondary/40 border-border font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-surface border-border max-h-56">
                    {data.zones.map((z) => (
                      <SelectItem key={z.id} value={String(z.id)} className="text-xs font-mono">
                        Zone {z.id}: {z.zone_name} ({z.current_risk_level})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <label className="text-xs font-mono uppercase text-muted-foreground">
                    {t("alerts.select_language")}
                  </label>
                  <Select
                    value={targetLang}
                    onValueChange={(v) => setTargetLang(v as "en" | "as" | "bn" | "ne")}
                  >
                    <SelectTrigger className="bg-secondary/40 border-border font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-surface border-border">
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="as">অসমীয়া</SelectItem>
                      <SelectItem value="bn">বাংলা</SelectItem>
                      <SelectItem value="ne">नेपाली</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-mono uppercase text-muted-foreground">
                    {t("alerts.select_channel")}
                  </label>
                  <Select
                    value={targetChannel}
                    onValueChange={(v) => setTargetChannel(v as "sms" | "push" | "both")}
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
                  placeholder="e.g. Field reports and radar confirm slope instability along NH-29"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  minLength={8}
                  required
                  className="bg-secondary/40 border-border font-mono text-xs"
                />
              </div>

              <DialogFooter className="mt-4">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpenDispatch(false)}
                  disabled={dispatching}
                  className="font-mono text-xs"
                >
                  {t("alerts.cancel")}
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="destructive"
                  disabled={dispatching || justification.trim().length < 8}
                  className="font-mono text-xs uppercase"
                >
                  {dispatching ? t("alerts.authorizing") : t("alerts.authorize_dispatch")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>


      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-border/60 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {["All", "Severe", "High"].map((l) => (
            <button
              key={l}
              onClick={() => setLevel(l)}
              className={`rounded border px-3 py-1 font-mono text-xs transition-colors ${
                level === l
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              {l === "All" ? t("alerts.filter_all") : t(`risk_levels.${l}`)}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Select value={selectedZoneFilter} onValueChange={setSelectedZoneFilter}>
            <SelectTrigger className="h-8 w-44 bg-secondary/30 border-border font-mono text-xs">
              <SelectValue placeholder={t("alerts.all_zones")} />
            </SelectTrigger>
            <SelectContent className="bg-surface border-border max-h-56">
              <SelectItem value="All" className="text-xs font-mono">
                {t("alerts.all_zones")}
              </SelectItem>
              {data.zones.map((z) => (
                <SelectItem key={z.id} value={String(z.id)} className="text-xs font-mono">
                  {z.zone_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(TEMPLATES).map(([code, tItem]) => (
            <button
              key={code}
              onClick={() => setLang(code)}
              className={`rounded border px-2.5 py-1 font-mono text-xs transition-colors ${
                lang === code
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:bg-secondary"
              }`}
            >
              {tItem.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {alerts.map((a) => {
          const zone = data.zones.find((z) => z.id === a.zone_id);
          const zoneName = zone ? `${zone.zone_name}, ${zone.state}` : `Zone ${a.zone_id}`;
          const isDelivered = (a as { delivery_status?: string }).delivery_status === "delivered";

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
                <div className="flex items-center gap-2 font-mono text-[0.7rem] text-muted-foreground">
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[0.65rem] uppercase ${
                      isDelivered
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                        : "border-blue-500/40 bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {(a as { delivery_status?: string }).delivery_status ?? "Dispatched"}
                  </span>
                  <span>
                    {new Date(a.dispatched_at).toLocaleString()} · {a.channel} · {a.dispatched_by}
                  </span>
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded border border-border bg-surface-raised p-3">
                  <div className="label-caps">
                    {t("alerts.sms_preview")} ({TEMPLATES[lang]!.label})
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/95">
                    {TEMPLATES[lang]!.render(zoneName, a.risk_level)}
                  </p>
                </div>
                <div className="rounded border border-primary/35 bg-primary/5 p-3">
                  <div className="label-caps text-primary">{t("alerts.hydrological_reasoning")}</div>
                  <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-foreground/90">
                    {a.explanation}
                  </p>
                </div>
              </div>
            </article>
          );
        })}
        {alerts.length === 0 && (
          <div className="panel p-8 text-center">
            <p className="text-sm text-muted-foreground">{t("alerts.no_matching_alerts")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
