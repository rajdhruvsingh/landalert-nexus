import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RoadBadge } from "@/components/RiskBits";
import type { RoadRow, ZoneRow } from "@/lib/monitoring.functions";
import { Route as RouteIcon, Search, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  roads: RoadRow[];
  zones: ZoneRow[];
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelectZone?: (zoneId: number) => void;
}

export function RoadNetworkDialog({
  roads,
  zones,
  trigger,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
  onSelectZone,
}: Props) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? setControlledOpen! : setInternalOpen;

  const zoneMap = useMemo(() => {
    const map = new Map<number, ZoneRow>();
    zones.forEach((z) => map.set(z.id, z));
    return map;
  }, [zones]);

  const blockedCount = useMemo(() => roads.filter((r) => r.status === "blocked").length, [roads]);
  const restrictedCount = useMemo(() => roads.filter((r) => r.status === "restricted").length, [roads]);
  const openCount = useMemo(() => roads.filter((r) => r.status === "open").length, [roads]);

  const filteredRoads = useMemo(() => {
    return roads.filter((r) => {
      const matchesStatus = statusFilter === "all" || r.status === statusFilter;
      const z = zoneMap.get(r.zone_id);
      const q = searchQuery.trim().toLowerCase();
      const matchesQuery =
        !q ||
        r.road_name.toLowerCase().includes(q) ||
        r.segment_label.toLowerCase().includes(q) ||
        (z && z.district.toLowerCase().includes(q)) ||
        (z && z.state.toLowerCase().includes(q));
      return matchesStatus && matchesQuery;
    });
  }, [roads, statusFilter, searchQuery, zoneMap]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-[850px] max-h-[85vh] overflow-hidden flex flex-col bg-surface text-foreground border-border">
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <RouteIcon className="h-5 w-5 text-primary shrink-0" />
            <DialogTitle className="text-xl font-display text-foreground">
              {t("road_network.dialog_title", "Road Connectivity & Arterial Network")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {t(
              "road_network.dialog_desc",
              "Authoritative road network status across North Eastern Region hill corridors and strategic links.",
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Top Summary Metrics */}
        <div className="grid grid-cols-4 gap-2 pt-2 shrink-0">
          <div className="rounded border border-border bg-secondary/30 p-2 text-center">
            <div className="text-lg font-bold font-display text-foreground">{roads.length}</div>
            <div className="text-[0.65rem] text-muted-foreground uppercase">{t("road_network.total_roads", "Total Links")}</div>
          </div>
          <div className="rounded border border-risk-severe/30 bg-risk-severe/10 p-2 text-center">
            <div className="text-lg font-bold font-display text-risk-severe flex items-center justify-center gap-1">
              <ShieldAlert className="h-4 w-4" />
              <span>{blockedCount}</span>
            </div>
            <div className="text-[0.65rem] text-risk-severe uppercase font-semibold">{t("road_network.blocked", "Blocked")}</div>
          </div>
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-center">
            <div className="text-lg font-bold font-display text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1">
              <AlertTriangle className="h-4 w-4" />
              <span>{restrictedCount}</span>
            </div>
            <div className="text-[0.65rem] text-amber-700 dark:text-amber-400 uppercase font-semibold">{t("road_network.restricted", "Restricted")}</div>
          </div>
          <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-center">
            <div className="text-lg font-bold font-display text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1">
              <CheckCircle2 className="h-4 w-4" />
              <span>{openCount}</span>
            </div>
            <div className="text-[0.65rem] text-emerald-700 dark:text-emerald-400 uppercase font-semibold">{t("road_network.passable", "Passable")}</div>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 pb-2 shrink-0 border-b border-border">
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                statusFilter === "all"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("road_network.filter_all", "All ({{count}})", { count: roads.length })}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("blocked")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                statusFilter === "blocked"
                  ? "bg-risk-severe text-white font-semibold"
                  : "bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("road_network.filter_blocked", "Blocked ({{count}})", { count: blockedCount })}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("restricted")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                statusFilter === "restricted"
                  ? "bg-amber-600 text-white font-semibold"
                  : "bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("road_network.filter_restricted", "Restricted ({{count}})", { count: restrictedCount })}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("open")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                statusFilter === "open"
                  ? "bg-emerald-600 text-white font-semibold"
                  : "bg-secondary/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {t("road_network.filter_open", "Open ({{count}})", { count: openCount })}
            </button>
          </div>

          <div className="relative">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("road_network.search_placeholder", "Filter by road, district, state...")}
              className="h-8 w-56 rounded border border-border bg-background px-2.5 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            />
            <Search className="absolute right-2 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Scrollable Table Area */}
        <div className="flex-1 overflow-y-auto mt-2">
          <table className="w-full text-left text-xs border-collapse font-sans">
            <thead className="sticky top-0 bg-secondary/80 backdrop-blur-xs z-10">
              <tr className="border-b border-border text-muted-foreground font-medium">
                <th className="py-2 px-3 whitespace-nowrap">{t("operational_tables.col_road_link", "Road / Link")}</th>
                <th className="py-2 px-3 whitespace-nowrap">{t("operational_tables.col_district_state", "District / State")}</th>
                <th className="py-2 px-3 whitespace-nowrap">{t("operational_tables.col_status", "Status")}</th>
                <th className="py-2 px-3 text-right">{t("common.action", "Action")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredRoads.map((r) => {
                const z = zoneMap.get(r.zone_id);
                return (
                  <tr key={r.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="py-2.5 px-3">
                      <span className="font-semibold text-foreground block font-display">
                        {r.road_name}
                      </span>
                      <span className="text-[0.68rem] text-muted-foreground font-mono">
                        {r.segment_label}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      <span className="font-medium text-foreground block">
                        {z ? z.district : r.segment_label}
                      </span>
                      <span className="text-[0.68rem] text-muted-foreground">
                        {z ? z.state : ""}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <RoadBadge status={r.status} />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {z && onSelectZone ? (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectZone(z.id);
                            setOpen(false);
                          }}
                          className="text-xs text-primary font-medium hover:underline"
                        >
                          {t("road_network.view_zone", "View Zone →")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {filteredRoads.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-muted-foreground text-xs">
                    {t("road_network.no_results", "No road links match your search filter.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-[0.68rem] text-muted-foreground">
            {t("road_network.footer_info", "Showing {{count}} monitored arterial road segments", {
              count: filteredRoads.length,
            })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            className="text-xs"
          >
            {t("common.close", "Close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
