import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import {
  getOverview,
  recomputeAll,
  ingestLiveRainfall,
  getRiskPredictionServerFn,
  getZoneWeatherRiskForecastServerFn,
  getResponsePrioritizationServerFn,
  getRiskForLocationServerFn,
  getSpatialGridServerFn,
  type ZoneRow,
} from "@/lib/monitoring.functions";
import { projectZoneRiskForecast } from "@/lib/forecast.service";
import type { RiskLevel } from "@/lib/risk";
import {
  deriveLocationSpatialRisk,
  type LocationSpatialRisk,
  type CellRiskEvaluation,
} from "@/lib/spatial-risk.service";
import SpatialLocationRiskPanel from "@/components/SpatialLocationRiskPanel";
import { MapCanvas } from "@/components/MapCanvas";
import {
  RiskBadge,
  RoadBadge,
  ExplanationCard,
  FreshnessBadge,
  MLAttributionCard,
  ScientificLimitationBadge,
  RegionalGroundTruthQualityBadge,
  ForecastRiskBadge,
  PrioritizationScoreBadge,
} from "@/components/RiskBits";
import {
  getLocalizedZoneName,
  getLocalizedDistrict,
  getLocalizedState,
  getLocalizedAlertMessage,
} from "@/lib/geo-translations";
import { PanelSkeleton, RouteError } from "@/components/ConsoleShell";
import { FieldObservationDialog } from "@/components/FieldObservationDialog";
import { RoadNetworkDialog } from "@/components/RoadNetworkDialog";
import { ObservationDetailsDialog } from "@/components/ObservationDetailsDialog";
import { sanitizeObservationRecord } from "@/lib/observation-sanitizer";
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
  MapPin,
  MapPinOff,
  RotateCw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { useUserLocation } from "@/hooks/useUserLocation";
import { getUserAuthorizationState, type AppUserRole } from "@/lib/auth-domains";
import { getObservationStatusMeta } from "@/lib/observation-status";
import { getOfflineOverviewFallback, getQueuedObservations, getSyncedObservations } from "@/lib/offline-manager";

const overviewQuery = queryOptions({
  queryKey: ["overview"],
  networkMode: "always",
  queryFn: async () => {
    try {
      return await getOverview();
    } catch (err) {
      console.warn("[Overview] Server query failed, using offline fallback:", err);
      return getOfflineOverviewFallback();
    }
  },
  staleTime: 60 * 1000,
});

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    try {
      return await context.queryClient.ensureQueryData(overviewQuery);
    } catch (err) {
      console.warn("[Route Loader] Error fetching overview, falling back to offline data:", err);
      return getOfflineOverviewFallback();
    }
  },
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

import {
  getAllStates,
  getStateByName,
  getDistrictsByState,
  getDistrictByName,
  searchGeography,
  NER_DISTRICTS,
  NORTH_EASTERN_REGION,
} from "@/lib/geography";

function Dashboard() {
  const { t, i18n } = useTranslation();
  const { data } = useSuspenseQuery(overviewQuery);
  const dataZonesRef = useRef(data.zones);
  dataZonesRef.current = data.zones;

  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedSpatialLocation, setSelectedSpatialLocation] = useState<LocationSpatialRisk | null>(null);
  const [selectedCellRisk, setSelectedCellRisk] = useState<CellRiskEvaluation | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("All");
  const [districtFilter, setDistrictFilter] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showZoneDetails, setShowZoneDetails] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const [roadDialogOpen, setRoadDialogOpen] = useState(false);
  const [obsDialogOpen, setObsDialogOpen] = useState(false);
  const [selectedObsId, setSelectedObsId] = useState<number | string | null>(null);

  // Session-derived role for observation review gating (same pattern as AuthDialog)
  const [viewerRole, setViewerRole] = useState<AppUserRole>("PUBLIC_USER");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [locationBannerDismissed, setLocationBannerDismissed] = useState(false);

  // Risk map layer visibility controls (controlled from header dropdown)
  const [showSpatialGrid, setShowSpatialGrid] = useState(true);
  const [showInSarDeformation, setShowInSarDeformation] = useState(false);
  const [showVillages, setShowVillages] = useState(true);
  const [showInfrastructure, setShowInfrastructure] = useState(true);
  const [showTrueColor, setShowTrueColor] = useState(false);
  const [showNdvi, setShowNdvi] = useState(false);
  const [layersDropdownOpen, setLayersDropdownOpen] = useState(false);
  const layersDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (layersDropdownRef.current && !layersDropdownRef.current.contains(event.target as Node)) {
        setLayersDropdownOpen(false);
      }
    }
    if (!layersDropdownOpen) return;
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [layersDropdownOpen]);

  const satelliteQuery = useQuery({
    queryKey: ["satellite-status"],
    queryFn: async () => {
      const res = await fetch("/api/satellite/status");
      if (!res.ok) return null;
      return res.json() as Promise<{ enabled: boolean; configured: boolean }>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const hasSatellite = Boolean(satelliteQuery.data?.enabled && satelliteQuery.data?.configured);

  useEffect(() => {
    // Read initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const authState = getUserAuthorizationState(session?.user ?? null);
      setViewerRole(authState.role);
      setAccessToken(session?.access_token ?? null);
      setCurrentUser(session?.user ?? null);
    });
    // Keep in sync with sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const authState = getUserAuthorizationState(session?.user ?? null);
      setViewerRole(authState.role);
      setAccessToken(session?.access_token ?? null);
      setCurrentUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const isLoggedIn = Boolean(currentUser);
  const userLocation = useUserLocation();

  // On login or on home-page mount if already logged in, request user location
  useEffect(() => {
    if (isLoggedIn) {
      userLocation.requestLocation();
    }
  }, [isLoggedIn]);

  const getRiskForLocationFn = useServerFn(getRiskForLocationServerFn);

  const {
    data: locationRisk,
    isLoading: isRiskLoading,
  } = useQuery({
    queryKey: ["riskForLocation", userLocation.lat, userLocation.lng],
    queryFn: async () => {
      if (userLocation.lat === null || userLocation.lng === null) return null;
      return getRiskForLocationFn({
        data: { lat: userLocation.lat, lng: userLocation.lng },
      });
    },
    enabled: isLoggedIn && userLocation.lat !== null && userLocation.lng !== null,
    staleTime: 60 * 1000,
  });

  const recompute = useServerFn(recomputeAll);
  const ingest = useServerFn(ingestLiveRainfall);

  const [customCenter, setCustomCenter] = useState<[number, number] | null>(null);
  const [customZoom, setCustomZoom] = useState<number | null>(null);
  const [uninstrumentedLocationNotice, setUninstrumentedLocationNotice] = useState<{
    name: string;
    district: string;
    state: string;
  } | null>(null);

  // Continuous 8-State Spatial Prediction Grid query
  const spatialGridQuery = useQuery({
    queryKey: ["spatial-grid", stateFilter, districtFilter],
    queryFn: () =>
      getSpatialGridServerFn({
        data: {
          stateName: stateFilter === "All" ? undefined : stateFilter,
          districtName: districtFilter === "All" ? undefined : districtFilter,
        },
      }),
    staleTime: 5 * 60 * 1000,
  });

  // Listen to header search query, modal trigger events, and URL hash scrolling
  useEffect(() => {
    const handleSearch = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.query === "string") {
        setSearchQuery(detail.query);
      }
      const item =
        detail?.item ||
        (typeof detail?.query === "string" && detail.query.trim().length >= 2
          ? searchGeography(detail.query)[0]
          : undefined);

      if (item) {
        if (item.centroid) {
          setCustomCenter(item.centroid);
          setCustomZoom(item.type === "city" || item.type === "town" || item.type === "locality" ? 11 : item.type === "district" ? 9 : 8);
        }
        if (item.stateName) {
          setStateFilter(item.stateName);
        }
        if (item.districtName) {
          setDistrictFilter(item.districtName);
        }
        if (item.zoneId) {
          setSelectedId(item.zoneId);
        }
        if (item.centroid) {
          const locRisk = deriveLocationSpatialRisk(
            item.name,
            item.type || "city",
            item.districtName || item.name,
            item.stateName || "",
            item.centroid,
            dataZonesRef.current,
          );
          setSelectedSpatialLocation(locRisk);
          setSelectedCellRisk(null);
          setShowZoneDetails(false);
          setUninstrumentedLocationNotice(null);
        }
      }
    };
    const handleOpenRoads = () => setRoadDialogOpen(true);
    const handleOpenObs = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && detail.observationId) {
        setSelectedObsId(detail.observationId);
      } else {
        setSelectedObsId(null);
      }
      setObsDialogOpen(true);
    };

    const handleHashScroll = () => {
      if (typeof window === "undefined") return;
      const rawHash = window.location.hash.replace("#", "");
      if (!rawHash) return;

      const targetId =
        rawHash === "observations"
          ? "recent-observations"
          : rawHash === "road-network" || rawHash === "roads"
          ? "road-connectivity"
          : rawHash;

      const el = document.getElementById(targetId);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: "smooth" });
        }, 120);
      }

      const pendingEvent = sessionStorage.getItem("landalert_pending_event");
      if (pendingEvent) {
        sessionStorage.removeItem("landalert_pending_event");
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent(pendingEvent));
        }, 250);
      }

      const pendingSearch = sessionStorage.getItem("landalert_pending_search");
      const pendingSearchItemStr = sessionStorage.getItem("landalert_pending_search_item");
      if (pendingSearch) {
        sessionStorage.removeItem("landalert_pending_search");
        setSearchQuery(pendingSearch);
      }
      if (pendingSearchItemStr) {
        sessionStorage.removeItem("landalert_pending_search_item");
        try {
          const item = JSON.parse(pendingSearchItemStr);
          if (item.centroid) {
            setCustomCenter(item.centroid);
            setCustomZoom(item.type === "city" || item.type === "town" || item.type === "locality" ? 11 : 9);
          }
          if (item.stateName) setStateFilter(item.stateName);
          if (item.districtName) setDistrictFilter(item.districtName);
          if (item.zoneId) {
            setSelectedId(item.zoneId);
          }
          if (item.centroid) {
            const locRisk = deriveLocationSpatialRisk(
              item.name,
              item.type || "city",
              item.districtName || item.name,
              item.stateName || "",
              item.centroid,
              dataZonesRef.current,
            );
            setSelectedSpatialLocation(locRisk);
            setSelectedCellRisk(null);
            setShowZoneDetails(false);
            setUninstrumentedLocationNotice(null);
          }
        } catch {}
      }
    };

    handleHashScroll();
    window.addEventListener("hashchange", handleHashScroll);
    window.addEventListener("landalert-filter", handleSearch);
    window.addEventListener("landalert-open-roads", handleOpenRoads);
    window.addEventListener("landalert-open-observations", handleOpenObs);

    return () => {
      window.removeEventListener("hashchange", handleHashScroll);
      window.removeEventListener("landalert-filter", handleSearch);
      window.removeEventListener("landalert-open-roads", handleOpenRoads);
      window.removeEventListener("landalert-open-observations", handleOpenObs);
    };
  }, []);

  const states: string[] = useMemo(
    () => ["All", ...getAllStates().map((s) => s.name)],
    [],
  );

  const availableDistricts = useMemo(() => {
    if (stateFilter === "All") return [];
    return getDistrictsByState(stateFilter);
  }, [stateFilter]);

  const mapCenterAndZoom = useMemo<{ center: [number, number]; zoom: number }>(() => {
    if (customCenter) {
      return { center: customCenter, zoom: customZoom ?? 10 };
    }
    if (districtFilter !== "All" && stateFilter !== "All") {
      const dist = getDistrictByName(districtFilter, stateFilter);
      if (dist) {
        return { center: dist.centroid, zoom: 9 };
      }
    }
    if (stateFilter !== "All") {
      const st = getStateByName(stateFilter);
      if (st) {
        return { center: st.centroid, zoom: 8 };
      }
    }
    return { center: [25.6, 92.8], zoom: 7 };
  }, [stateFilter, districtFilter, customCenter, customZoom]);

  const filteredZones = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const matchingRoadZoneIds = new Set(
      q
        ? (data.roads as any[])
            .filter(
              (r: any) =>
                r.road_name.toLowerCase().includes(q) ||
                r.segment_label.toLowerCase().includes(q),
            )
            .map((r: any) => r.zone_id)
        : [],
    );

    return data.zones.filter((z: ZoneRow) => {
      const matchesState = stateFilter === "All" || z.state === stateFilter;
      const matchesDistrict = districtFilter === "All" || z.district === districtFilter;
      const matchesQuery =
        !q ||
        z.zone_name.toLowerCase().includes(q) ||
        z.district.toLowerCase().includes(q) ||
        z.state.toLowerCase().includes(q) ||
        matchingRoadZoneIds.has(z.id);
      return matchesState && matchesDistrict && matchesQuery;
    });
  }, [data.zones, data.roads, stateFilter, districtFilter, searchQuery]);

  const selected: ZoneRow | null =
    data.zones.find((z: ZoneRow) => z.id === selectedId) ?? filteredZones[0] ?? data.zones[0] ?? null;

  const { data: selectedMl } = useQuery({
    queryKey: ["risk-prediction", selected?.id],
    queryFn: () => (selected ? getRiskPredictionServerFn({ data: { zoneId: selected.id } }) : null),
    enabled: !!selected,
  });

  const { data: selectedForecast } = useQuery({
    queryKey: ["weather-forecast", selected?.id],
    queryFn: async () => {
      if (!selected) return null;
      try {
        const serverRes = await getZoneWeatherRiskForecastServerFn({ data: { zoneId: selected.id } });
        if (serverRes && serverRes.forecastStatus === "AVAILABLE" && serverRes.forecastWindows) {
          return serverRes;
        }
      } catch (err) {
        console.warn("[Forecast] Server function failed on homepage, trying direct browser weather fetch:", err);
      }

      // Direct client-side fetch from Open-Meteo as high-resilience fallback
      try {
        const lat = selected.centroid_lat ?? 25.5;
        const lng = selected.centroid_lng ?? 91.8;
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum&forecast_days=4&timezone=UTC`
        );
        if (res.ok) {
          const payload = await res.json();
          const precip = payload?.daily?.precipitation_sum as (number | null)[] | undefined;
          if (precip && precip.length >= 4) {
            const day1 = precip[1] ?? 0;
            const day2 = precip[2] ?? 0;
            const day3 = precip[3] ?? 0;
            return projectZoneRiskForecast({
              zoneId: selected.id,
              zoneName: selected.zone_name,
              district: selected.district,
              state: selected.state,
              currentRiskLevel: (selected.current_risk_level as RiskLevel) ?? "Low",
              currentRiskScore: selected.risk_score ?? 25,
              threshold_e_mm: selected.threshold_e_mm ?? undefined,
              forecast_24h_mm: day1,
              forecast_48h_mm: day1 + day2,
              forecast_72h_mm: day1 + day2 + day3,
            });
          }
        }
      } catch (clientErr) {
        console.warn("[Forecast] Client-side Open-Meteo fallback failed on index:", clientErr);
      }

      return null;
    },
    enabled: !!selected,
  });

  const { data: prioritizationData } = useQuery({
    queryKey: ["response-prioritization"],
    queryFn: () => getResponsePrioritizationServerFn(),
  });

  // Metrics for Region Overview
  const distinctDistricts = useMemo(
    () => Array.from(new Set(data.zones.map((z: ZoneRow) => z.district))),
    [data.zones],
  );
  const highOrSevereZones = useMemo(
    () => data.zones.filter((z: ZoneRow) => ["High", "Severe"].includes(z.current_risk_level)),
    [data.zones],
  );

  // Elevated risk states
  const elevatedStates = useMemo(() => {
    const s = Array.from(new Set(highOrSevereZones.map((z: ZoneRow) => z.state)));
    return s.length > 0 ? s.join(" and ") : "Mizoram and Manipur";
  }, [highOrSevereZones]);

  const [queueUpdateSignal, setQueueUpdateSignal] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleQueueChange = () => setQueueUpdateSignal((prev) => prev + 1);
    window.addEventListener("landalert-queue-updated", handleQueueChange);
    window.addEventListener("storage", handleQueueChange);
    return () => {
      window.removeEventListener("landalert-queue-updated", handleQueueChange);
      window.removeEventListener("storage", handleQueueChange);
    };
  }, []);

  // Observations list (combining offline pending queue, local synced archive, and server observations)
  const observationsList = useMemo(() => {
    const serverObs = (data as any).observations || [];
    const serverKeySet = new Set(
      serverObs.map((s: any) => s.idempotency_key || String(s.id)),
    );

    const queuedObs = getQueuedObservations().map((q) => ({
      id: q.idempotency_key,
      zone_id: q.zone_id,
      observed_at: q.observed_at || q.client_timestamp || new Date().toISOString(),
      rainfall_mm: q.rainfall_mm,
      soil_condition: q.soil_condition,
      visual_signs: q.visual_signs,
      road_status: q.road_status,
      status: "PENDING_SYNC",
      review_status: "PENDING_SYNC",
      is_offline_queued: true,
    }));

    const syncedObs = getSyncedObservations()
      .filter((s) => !serverKeySet.has(s.idempotency_key!))
      .map((s) => ({
        id: s.idempotency_key,
        zone_id: s.zone_id,
        observed_at: s.observed_at || s.client_timestamp || new Date().toISOString(),
        rainfall_mm: s.rainfall_mm,
        soil_condition: s.soil_condition,
        visual_signs: s.visual_signs,
        road_status: s.road_status,
        status: "SYNCED",
        review_status: s.review_status || "OFFICIAL_VERIFIED",
        is_offline_queued: false,
        is_synced: true,
      }));

    return [...queuedObs, ...syncedObs, ...serverObs].slice(0, 8);
  }, [data, queueUpdateSignal]);

  async function runCalculateRisk() {
    setBusy(true);
    setActionNotice(null);
    try {
      let weatherMsg = "";
      try {
        const res = await ingest();
        weatherMsg = `Weather updated for ${res.zones} zones. `;
      } catch {
        weatherMsg = "Live weather unavailable (using cached dataset). ";
      }
      await recompute();
      await qc.invalidateQueries();
      setActionNotice(`${weatherMsg}Risk scores calculated successfully.`);
      setTimeout(() => setActionNotice(null), 4000);
    } catch {
      setActionNotice("Failed to calculate risk scores. Please try again.");
      setTimeout(() => setActionNotice(null), 5000);
    } finally {
      setBusy(false);
    }
  }

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
      <section className="relative border-b border-[#0d233a] bg-[#071a2c] overflow-hidden">
        {/* Full-bleed background art aligned to the right */}
        <div className="absolute inset-0 pointer-events-none select-none z-0 overflow-hidden flex justify-end">
          <img
            src="/hero-banner-art.png"
            alt=""
            aria-hidden="true"
            className="h-full w-auto min-w-[700px] sm:min-w-[950px] lg:min-w-[1200px] object-cover object-right"
            loading="eager"
          />
        </div>

        <div className="relative mx-auto max-w-[1600px] px-4 py-4 sm:py-5 lg:px-8 flex items-center min-h-[120px] sm:min-h-[125px]">
          <div className="max-w-2xl relative z-10">
            <span className="text-[0.65rem] sm:text-[0.7rem] font-bold uppercase tracking-[0.22em] text-[#8fa3bf] font-sans">
              {t("hero.region_tag", "NORTH EASTERN REGION")}
            </span>
            <h1 className="mt-1 text-2xl sm:text-[1.75rem] lg:text-[2rem] font-bold tracking-tight text-white font-sans sm:font-display leading-tight">
              {t("hero.title", "Landslide Early Warning System")}
            </h1>
            <p className="mt-1.5 text-xs sm:text-[0.8rem] text-[#b0c4de] leading-snug max-w-lg">
              {t("hero.subtitle", "Real-time risk assessment, field observations and decision support for safer communities in North East India.")}
            </p>
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

        {/* Location Permission / Unavailable Graceful Banner */}
        {isLoggedIn &&
          (userLocation.permissionDenied || userLocation.error) &&
          !userLocation.lat &&
          !locationBannerDismissed && (
            <div
              role="alert"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-3 animate-in fade-in"
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <div>
                  <span className="font-semibold">
                    {t("location.enable_title", "Enable location to see risk in your area")}
                  </span>
                  <span className="hidden sm:inline text-muted-foreground ml-1">
                    — {t(
                      "location.enable_desc",
                      "Allow location access to view real-time landslide risk and early warnings for your current zone.",
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    userLocation.clearError();
                    userLocation.requestLocation({ force: true });
                  }}
                  className="h-7 text-xs px-2.5 font-medium"
                >
                  {t("location.retry", "Enable Location")}
                </Button>
                <button
                  type="button"
                  onClick={() => setLocationBannerDismissed(true)}
                  aria-label={t("common.close", "Close")}
                  className="text-muted-foreground hover:text-foreground text-sm px-1.5 py-0.5 rounded cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          )}

        {/* Prominent Current Location Risk Card for Logged-In Users */}
        {isLoggedIn && (userLocation.loading || (userLocation.lat !== null && userLocation.lng !== null)) && (
          <div
            id="current-location-card"
            className="panel p-4 sm:p-5 border-l-4 border-l-primary bg-surface/95 shadow-xs space-y-3 animate-in fade-in duration-200"
          >
            {userLocation.loading || isRiskLoading ? (
              <div className="flex items-center justify-between gap-4 py-1">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center text-primary shrink-0">
                    <MapPin className="h-5 w-5 animate-pulse" />
                  </div>
                  <div>
                    <span className="label-caps">{t("location.card_title", "Your Current Location")}</span>
                    <p className="text-sm font-medium text-foreground mt-0.5">
                      {t("location.detecting", "Detecting location and evaluating landslide risk for your current sector…")}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled
                  className="h-8 gap-1.5 text-xs font-mono shrink-0"
                >
                  <RotateCw className="h-3.5 w-3.5 animate-spin" />
                  <span>{t("location.locating", "Locating…")}</span>
                </Button>
              </div>
            ) : locationRisk?.matched && locationRisk.zone ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center text-primary shrink-0 mt-0.5">
                      <MapPin className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="label-caps">{t("location.card_title", "Your Current Location")}</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[0.65rem] font-mono">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {t("location.live_detected", "Sector Verified")}
                        </span>
                      </div>
                      <h2 className="text-xl sm:text-2xl font-bold font-display text-foreground mt-0.5">
                        {locationRisk.zone.zone_name}
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        {locationRisk.zone.district} district · {locationRisk.zone.state} ·{" "}
                        <span className="font-mono">
                          {userLocation.lat?.toFixed(4)}°N, {userLocation.lng?.toFixed(4)}°E
                        </span>
                        {userLocation.accuracy ? ` (±${Math.round(userLocation.accuracy)}m)` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <RiskBadge
                      level={locationRisk.zone.current_risk_level}
                      score={locationRisk.zone.risk_score}
                      className="text-xs sm:text-sm py-1 px-3"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={userLocation.loading}
                      onClick={() => userLocation.requestLocation({ force: true })}
                      className="h-8 gap-1.5 text-xs font-mono shrink-0 cursor-pointer"
                      title={t("location.refresh_title", "Refresh GPS location")}
                    >
                      <RotateCw className={`h-3.5 w-3.5 ${userLocation.loading ? "animate-spin" : ""}`} />
                      <span>{t("location.refresh", "Refresh my location")}</span>
                    </Button>
                  </div>
                </div>

                <div className="rounded border border-border bg-secondary/30 p-3 sm:p-3.5 text-xs sm:text-sm text-foreground space-y-1">
                  <div className="text-[0.68rem] font-bold uppercase tracking-wider text-muted-foreground font-mono">
                    {t("location.assessment_title", "Zone Landslide Risk Assessment")}
                  </div>
                  <p className="leading-relaxed">
                    {locationRisk.zone.explanation ||
                      t("location.no_explanation", "Standard baseline monitoring active. No heightened hazard conditions detected at this time.")}
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-muted-foreground text-[0.72rem]">
                    {t("location.coverage_notice", "Official NER Landslide Early Warning Sector")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (locationRisk.zone) {
                        setSelectedId(locationRisk.zone.id);
                        setShowZoneDetails(true);
                        const mapEl = document.getElementById("risk-map");
                        if (mapEl) mapEl.scrollIntoView({ behavior: "smooth" });
                      }
                    }}
                    className="text-primary hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>{t("location.view_on_map", "Focus zone on map")}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-full bg-secondary text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                      <MapPinOff className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="label-caps">{t("location.card_title", "Your Current Location")}</span>
                      <h2 className="text-lg sm:text-xl font-bold font-display text-foreground mt-0.5">
                        {t("location.outside_region_title", "You're outside our currently monitored region")}
                      </h2>
                      <p className="text-xs text-muted-foreground font-mono">
                        {userLocation.lat?.toFixed(4)}°N, {userLocation.lng?.toFixed(4)}°E
                        {userLocation.accuracy ? ` (±${Math.round(userLocation.accuracy)}m)` : ""}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={userLocation.loading}
                    onClick={() => userLocation.requestLocation({ force: true })}
                    className="h-8 gap-1.5 text-xs font-mono shrink-0 cursor-pointer"
                    title={t("location.refresh_title", "Refresh GPS location")}
                  >
                    <RotateCw className={`h-3.5 w-3.5 ${userLocation.loading ? "animate-spin" : ""}`} />
                    <span>{t("location.refresh", "Refresh my location")}</span>
                  </Button>
                </div>

                <div className="rounded border border-border bg-secondary/20 p-3 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  {t(
                    "location.outside_region_desc",
                    "LandAlert-Nexus currently provides high-resolution early warning coverage for 15 designated hill zones across the North Eastern Region of India (Assam, Arunachal Pradesh, Manipur, Meghalaya, Mizoram, Nagaland, Sikkim, Tripura). Your current coordinates fall outside these monitored operational sectors. You can explore the regional map below to review active alerts and risk levels.",
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Upper Dashboard Grid: Left (Risk Map) vs Right (Quick Actions + Response Priority + Region Overview + Regional Observations) */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
          {/* LEFT: Landslide Risk Map */}
          <div className="space-y-4">
            <div id="risk-map" className="panel overflow-hidden flex flex-col scroll-mt-20">
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

                {/* State/Region, District, Layers & Grid Dropdown, and Risk Level Legend */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="Filter by region or state"
                    value={stateFilter}
                    onChange={(e) => {
                      const st = e.target.value;
                      setStateFilter(st);
                      setDistrictFilter("All");
                      setSelectedSpatialLocation(null);
                      setSelectedCellRisk(null);
                      setUninstrumentedLocationNotice(null);
                      if (st !== "All") {
                        const stateObj = getStateByName(st);
                        if (stateObj) {
                          setCustomCenter(stateObj.centroid);
                          setCustomZoom(8);
                        }
                      } else {
                        setCustomCenter(null);
                        setCustomZoom(null);
                      }
                    }}
                    className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground font-sans focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
                  >
                    <option value="All">{t("map_panel.filter_region", "North East India (All 8 States)")}</option>
                    {states
                      .filter((s: string) => s !== "All")
                      .map((s: string) => (
                        <option key={s} value={s}>
                          {getLocalizedState(s, t)}
                        </option>
                      ))}
                  </select>

                  {stateFilter !== "All" && (
                    <select
                      aria-label="Filter by district"
                      value={districtFilter}
                      onChange={(e) => {
                        const distName = e.target.value;
                        setDistrictFilter(distName);
                        setSelectedCellRisk(null);
                        setUninstrumentedLocationNotice(null);
                        if (distName !== "All") {
                          const distObj = getDistrictByName(distName);
                          if (distObj) {
                            setCustomCenter(distObj.centroid);
                            setCustomZoom(9);
                            const locRisk = deriveLocationSpatialRisk(
                              distObj.name,
                              "district",
                              distObj.name,
                              distObj.stateName,
                              distObj.centroid,
                              dataZonesRef.current,
                            );
                            setSelectedSpatialLocation(locRisk);
                            setShowZoneDetails(false);
                          }
                        } else {
                          setSelectedSpatialLocation(null);
                        }
                      }}
                      className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground font-sans focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer"
                    >
                      <option value="All">{t("map_panel.all_districts", `All Districts in ${getLocalizedState(stateFilter, t)}`)}</option>
                      {availableDistricts.map((d) => (
                        <option key={d.id} value={d.name}>
                          {getLocalizedDistrict(d.name, t)} {d.zoneIds.length > 0 ? `(${d.zoneIds.length} station)` : ""}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Layers & Grid Dropdown (beside North East India dropdown) */}
                  <div className="relative" ref={layersDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setLayersDropdownOpen((prev) => !prev)}
                      className="h-8 flex items-center gap-1.5 rounded border border-border bg-background px-2.5 text-xs text-foreground font-sans hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary cursor-pointer transition-colors"
                      aria-expanded={layersDropdownOpen}
                      aria-haspopup="true"
                    >
                      <Layers className="h-3.5 w-3.5 text-primary" />
                      <span>{t("risk_map.layers_title", "Layers & Grid")}</span>
                      <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${layersDropdownOpen ? "rotate-180" : ""}`} />
                    </button>

                    {layersDropdownOpen && (
                      <div className="absolute right-0 sm:right-auto sm:left-0 top-full mt-1.5 z-50 w-64 rounded-md border border-border bg-surface/98 p-3 shadow-xl backdrop-blur-md text-xs font-mono space-y-2.5">
                        <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                          <span className="font-semibold text-primary uppercase text-[0.68rem] tracking-wider">
                            {t("risk_map.layers_title", "Layers & Grid")}
                          </span>
                          <span
                            className="text-[0.65rem] text-muted-foreground cursor-help"
                            title={t("risk_map.spatial_coverage_info", "Continuous 0.25° spatial landslide risk prediction grid across all 8 Northeast states.")}
                          >
                            {spatialGridQuery.data?.cells?.length ?? 82} cells
                          </span>
                        </div>

                        {/* Spatial Grid Toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={showSpatialGrid}
                            onChange={(e) => setShowSpatialGrid(e.target.checked)}
                            className="rounded border-border text-primary cursor-pointer"
                          />
                          <span className="text-[0.72rem] font-semibold text-foreground">
                            {t("risk_map.show_spatial_surface", "8-State Spatial Risk Surface")}
                          </span>
                        </label>

                        {/* InSAR Ground Deformation Layer Toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={showInSarDeformation}
                            onChange={(e) => setShowInSarDeformation(e.target.checked)}
                            className="rounded border-border text-violet-500 cursor-pointer"
                          />
                          <span className="text-[0.72rem] font-semibold text-foreground flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" />
                            {t("risk_map.show_insar_layer", "InSAR Ground Deformation")}
                          </span>
                        </label>

                        {/* Villages Layer Toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={showVillages}
                            onChange={(e) => setShowVillages(e.target.checked)}
                            className="rounded border-border text-sky-500 cursor-pointer"
                          />
                          <span className="text-[0.72rem] font-semibold text-foreground flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-sky-500 inline-block" />
                            {t("risk_map.show_villages", "Villages & Hamlets")}
                          </span>
                        </label>

                        {/* Critical Infrastructure Layer Toggle */}
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={showInfrastructure}
                            onChange={(e) => setShowInfrastructure(e.target.checked)}
                            className="rounded border-border text-red-500 cursor-pointer"
                          />
                          <span className="text-[0.72rem] font-semibold text-foreground flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                            {t("risk_map.show_infrastructure", "Critical Infrastructure")}
                          </span>
                        </label>

                        {/* Satellite Imagery Layer Controls */}
                        {hasSatellite && (
                          <div className="pt-2 border-t border-border/50 space-y-2">
                            <div className="text-[0.65rem] uppercase text-muted-foreground font-semibold">
                              {t("risk_map.sentinel_visuals", "🛰 Sentinel-2 Visuals")}
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={showTrueColor}
                                onChange={(e) => setShowTrueColor(e.target.checked)}
                                className="rounded border-border text-primary cursor-pointer"
                              />
                              <span className="text-[0.72rem]">{t("risk_map.true_color", "True-Color Imagery")}</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={showNdvi}
                                onChange={(e) => setShowNdvi(e.target.checked)}
                                className="rounded border-border text-primary cursor-pointer"
                              />
                              <span className="text-[0.72rem]">{t("risk_map.ndvi_vegetation", "NDVI Vegetation Index")}</span>
                            </label>
                            <div className="text-[0.62rem] text-muted-foreground/80 pt-0.5 border-t border-border/30">
                              {t("risk_map.sentinel_attribution", "Copernicus Sentinel data 2026")}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Risk Level Inline Legend (written as it is) */}
                  <div className="flex items-center gap-2 rounded border border-border bg-background px-2.5 h-8 text-xs font-sans select-none">
                    <span className="font-semibold text-[0.7rem] text-foreground font-display">
                      {t("map_panel.risk_level", "Risk level")}:
                    </span>
                    <div className="flex items-center gap-2 text-[0.7rem]">
                      <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-emerald-600 inline-block" />
                        <span className="text-foreground">{t("risk_levels.Low", "Low")}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-yellow-500 inline-block" />
                        <span className="text-foreground">{t("risk_levels.Moderate", "Moderate")}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-orange-500 inline-block" />
                        <span className="text-foreground">{t("risk_levels.High", "High")}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-red-600 inline-block" />
                        <span className="text-foreground">{t("risk_levels.Severe", "Severe")}</span>
                      </div>
                    </div>
                  </div>

                  {(stateFilter !== "All" || districtFilter !== "All" || customCenter !== null || selectedSpatialLocation !== null || selectedCellRisk !== null) && (
                    <button
                      type="button"
                      onClick={() => {
                        setStateFilter("All");
                        setDistrictFilter("All");
                        setCustomCenter(null);
                        setCustomZoom(null);
                        setUninstrumentedLocationNotice(null);
                        setSelectedSpatialLocation(null);
                        setSelectedCellRisk(null);
                        setSearchQuery("");
                      }}
                      className="h-8 rounded border border-border bg-secondary/50 px-2 text-[0.68rem] font-mono text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {t("map_panel.reset", "Reset")}
                    </button>
                  )}
                </div>
              </div>

              {/* Notice for Searched Location without active telemetry */}
              {uninstrumentedLocationNotice && (
                <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs font-sans text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
                  <span>
                    {t("map_panel.location_uninstrumented_notice", "Location: {{name}}, {{district}}, {{state}} — No active telemetry station at this locality. Regional situational coverage active.", {
                      name: uninstrumentedLocationNotice.name,
                      district: uninstrumentedLocationNotice.district,
                      state: uninstrumentedLocationNotice.state,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setUninstrumentedLocationNotice(null)}
                    className="text-[0.68rem] font-bold underline cursor-pointer hover:text-amber-950 dark:hover:text-amber-100"
                  >
                    {t("common.close", "Dismiss")}
                  </button>
                </div>
              )}

              {/* Notice for Districts without active monitored zones (only shown when not already covered by specific location notice) */}
              {!uninstrumentedLocationNotice && districtFilter !== "All" && filteredZones.length === 0 && (
                <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 text-xs font-sans text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2">
                  <span>
                    {t("map_panel.uninstrumented_district_notice", "No active monitored telemetry stations registered in {{district}}. District territory is monitored under regional coverage.", {
                      district: districtFilter,
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => setDistrictFilter("All")}
                    className="text-[0.68rem] font-bold underline cursor-pointer hover:text-amber-950 dark:hover:text-amber-100"
                  >
                    {t("map_panel.view_all_state_districts", "View All {{state}} Districts", {
                      state: stateFilter,
                    })}
                  </button>
                </div>
              )}

              {/* Map Container */}
              <div
                role="region"
                aria-label="Interactive Landslide Hazard Map"
                tabIndex={0}
                className="w-full min-h-[460px] lg:min-h-[520px] relative isolate z-0 focus-visible:ring-1 focus-visible:ring-primary outline-none"
              >
                <MapCanvas
                  zones={filteredZones}
                  selectedId={selected?.id ?? null}
                  center={mapCenterAndZoom.center}
                  zoom={mapCenterAndZoom.zoom}
                  spatialCells={spatialGridQuery.data?.cells ?? []}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setSelectedSpatialLocation(null);
                    setSelectedCellRisk(null);
                    setShowZoneDetails(true);
                  }}
                  onSelectCell={(cell) => {
                    setSelectedCellRisk(cell);
                    setSelectedSpatialLocation(null);
                    setShowZoneDetails(false);
                    setCustomCenter(cell.centroid);
                  }}
                  layerControls={{
                    showSpatialGrid,
                    setShowSpatialGrid,
                    showInSarDeformation,
                    setShowInSarDeformation,
                    showVillages,
                    setShowVillages,
                    showInfrastructure,
                    setShowInfrastructure,
                    showTrueColor,
                    setShowTrueColor,
                    showNdvi,
                    setShowNdvi,
                  }}
                  hideFloatingControls={true}
                />

                {/* Scale Indicator Bottom-Left */}
                <div className="absolute bottom-3 left-3 z-[400] rounded border border-border bg-surface/90 px-2 py-0.5 text-[0.65rem] font-mono text-muted-foreground pointer-events-none">
                  {t("map_panel.scale_km", "100 km")}
                </div>
              </div>
            </div>

            {/* Spatial Location Risk Panel (for Searched/Selected Cities or Districts) or Direct Cell Evaluation */}
            {(selectedSpatialLocation || selectedCellRisk) && (
              <SpatialLocationRiskPanel
                locationRisk={selectedSpatialLocation}
                cellRisk={selectedCellRisk}
                onClose={() => {
                  setSelectedSpatialLocation(null);
                  setSelectedCellRisk(null);
                }}
              />
            )}

            {/* Expandable Zone Operational Drawer & Scientific Decision Support */}
            {selected && showZoneDetails && !selectedSpatialLocation && !selectedCellRisk && (
              <div id="zone-details-brief" className="panel p-4 space-y-4 border-l-4 border-l-primary animate-in fade-in duration-200">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                  <div>
                    <span className="label-caps">{t("dashboard.zone_overview", "Selected Zone Operational Brief")}</span>
                    <h3 className="text-xl font-bold text-foreground font-display mt-0.5">
                      {getLocalizedZoneName(selected.id, selected.zone_name, t)}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {getLocalizedDistrict(selected.district, t)} {t("dashboard.district_label", "district")} · {getLocalizedState(selected.state, t)} ·{" "}
                      {selected.population.toLocaleString(i18n.language || "en-IN")} {t("dashboard.residents", "residents")} ·{" "}
                      {selected.mean_slope_deg}° {t("dashboard.mean_slope", "mean slope")}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <FreshnessBadge
                        ageHours={selectedMl?.data_freshness?.weather_age_hours}
                        status={selected.soil_moisture_status as any}
                      />
                      <RegionalGroundTruthQualityBadge
                        tier={selectedMl?.regional_confidence?.tier}
                        district={selected.district}
                        state={selected.state}
                        mlOperational={selectedMl?.regional_confidence?.ml_model_operational}
                      />
                      {selectedMl && (
                        <span className="font-mono text-xs text-primary font-medium">
                          {selectedMl.regional_confidence?.ml_model_operational === false ? "Physics Risk: " : "ML Risk: "}
                          {(selectedMl.probability !== null ? (selectedMl.probability * 100).toFixed(1) + "%" : "Unavailable")} ({selectedMl.risk_level})
                        </span>
                      )}
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

                  <div className="flex items-center gap-2">
                    <RiskBadge
                      level={selectedMl?.risk_level ?? selected.current_risk_level}
                      score={selectedMl?.risk_score ?? selected.risk_score}
                    />
                    <button
                      type="button"
                      onClick={() => setShowZoneDetails(false)}
                      className="rounded border border-border p-1 text-muted-foreground hover:text-foreground cursor-pointer"
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
                    {selectedForecast && selectedForecast.forecastStatus === "AVAILABLE" && selectedForecast.forecastWindows && (
                      <div className="rounded border border-border bg-secondary/20 p-3">
                        <div className="flex items-center justify-between pb-2 border-b border-border/60">
                          <span className="label-caps">{t("weather_forecast.section_title", "Forward Rainfall Risk Projection")}</span>
                          <span className="text-[0.65rem] text-muted-foreground italic">
                            {t("weather_forecast.disclaimer", "Open-Meteo Short-Range Ingestion")}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <div className="rounded border border-border p-2 text-center bg-surface">
                            <div className="text-[0.62rem] font-bold text-muted-foreground uppercase">{t("weather_forecast.hours_24", "24 Hours")}</div>
                            <div className="my-1 flex justify-center">
                              <ForecastRiskBadge
                                level={selectedForecast.forecastWindows["24h"].projectedRiskLevel}
                                leadHours={24}
                                trend={selectedForecast.forecastWindows["24h"].trend}
                              />
                            </div>
                            <div className="font-mono text-xs font-semibold">{selectedForecast.forecastWindows["24h"].forecastRainfallMm.toFixed(1)} mm</div>
                          </div>
                          <div className="rounded border border-border p-2 text-center bg-surface">
                            <div className="text-[0.62rem] font-bold text-muted-foreground uppercase">{t("weather_forecast.hours_48", "48 Hours")}</div>
                            <div className="my-1 flex justify-center">
                              <ForecastRiskBadge
                                level={selectedForecast.forecastWindows["48h"].projectedRiskLevel}
                                leadHours={48}
                                trend={selectedForecast.forecastWindows["48h"].trend}
                              />
                            </div>
                            <div className="font-mono text-xs font-semibold">{selectedForecast.forecastWindows["48h"].forecastRainfallMm.toFixed(1)} mm</div>
                          </div>
                          <div className="rounded border border-border p-2 text-center bg-surface">
                            <div className="text-[0.62rem] font-bold text-muted-foreground uppercase">{t("weather_forecast.hours_72", "72 Hours")}</div>
                            <div className="my-1 flex justify-center">
                              <ForecastRiskBadge
                                level={selectedForecast.forecastWindows["72h"].projectedRiskLevel}
                                leadHours={72}
                                trend={selectedForecast.forecastWindows["72h"].trend}
                              />
                            </div>
                            <div className="font-mono text-xs font-semibold">{selectedForecast.forecastWindows["72h"].forecastRainfallMm.toFixed(1)} mm</div>
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
                            className="w-full rounded border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary transition-colors cursor-pointer"
                          >
                            + {t("dashboard.report_observation_for_zone", "Report Observation for {{zone}}", { zone: getLocalizedZoneName(selected.id, selected.zone_name, t) })}
                          </button>
                        }
                        onSuccess={() => qc.invalidateQueries()}
                      />
                    </div>

                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runCalculateRisk}
                        disabled={busy}
                        className="w-full text-[0.75rem] font-mono font-medium py-2 flex items-center justify-center gap-1.5"
                      >
                        <RotateCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                        {busy
                          ? t("dashboard.calculating_risk", "Calculating Risk...")
                          : t("dashboard.calculate_risk", "Calculate Risk")}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: Quick Actions + Response Priority + Region Overview + Regional Observations */}
          <div className="space-y-4">
            {/* 1. Quick Actions */}
            <div className="panel p-4">
              <h2 className="text-base font-bold text-foreground font-display mb-3">
                {t("quick_actions.title", "Quick Actions")}
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <a
                  href="#risk-map"
                  onClick={(e) => {
                    e.preventDefault();
                    window.history.pushState(null, "", "/#risk-map");
                    const el = document.getElementById("risk-map");
                    if (el) {
                      el.scrollIntoView({ behavior: "smooth" });
                    }
                  }}
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

                <FieldObservationDialog
                  trigger={
                    <button
                      type="button"
                      className="rounded border border-border bg-surface p-3 hover:bg-secondary/40 transition-colors flex flex-col items-start gap-1 text-left w-full group cursor-pointer"
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

                <button
                  type="button"
                  onClick={() => {
                    setRoadDialogOpen(true);
                    window.history.pushState(null, "", "/#road-connectivity");
                    const el = document.getElementById("road-connectivity");
                    if (el) el.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="rounded border border-border bg-surface p-3 hover:bg-secondary/40 transition-colors flex flex-col items-start gap-1 text-left group cursor-pointer"
                >
                  <RouteIcon className="h-5 w-5 text-primary shrink-0" />
                  <span className="font-display font-bold text-xs text-foreground group-hover:text-primary transition-colors">
                    {t("quick_actions.check_roads", "Check Roads")}
                  </span>
                  <span className="text-[0.68rem] text-muted-foreground leading-tight">
                    {t("quick_actions.critical_links", "Critical and vulnerable links")}
                  </span>
                </button>
              </div>
            </div>

            {/* 2. Response Priority (Multi-factor Urgency Ranking) */}
            <div className="panel p-4">
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <div>
                  <h2 className="text-base font-bold text-foreground font-display">
                    {t("response_prioritization.section_title", "Response Priority")}
                  </h2>
                  <p className="text-[0.68rem] text-muted-foreground">
                    {t("response_prioritization.decision_support", "Multi-factor operational urgency ranking for decision support")}
                  </p>
                </div>
                <span className="text-[0.65rem] font-mono text-muted-foreground">
                  {t("response_prioritization.weights_summary", "40% Risk · 25% Pop · 20% Road · 15% Obs")}
                </span>
              </div>

              <div className="mt-2.5 overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse font-sans">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30 text-muted-foreground font-medium">
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("response_prioritization.rank", "Rank")}</th>
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("response_prioritization.zone", "Zone")}</th>
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("response_prioritization.score", "Score")}</th>
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("response_prioritization.road_cutoff", "Roads")}</th>
                      <th className="py-2 px-2.5 text-right">{t("common.action", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {(prioritizationData?.rankedZones ?? []).slice(0, 4).map((item) => (
                      <tr key={item.zoneId} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-2.5 font-display font-bold text-foreground text-center">
                          #{item.rank}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <span className="font-semibold text-foreground block font-display">
                            {getLocalizedZoneName(item.zoneId, item.zoneName, t)}
                          </span>
                          <span className="text-[0.65rem] text-muted-foreground">
                            {getLocalizedDistrict(item.district, t)}, {getLocalizedState(item.state, t)}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <PrioritizationScoreBadge score={item.priorityScore} />
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <RoadBadge status={item.worstRoadStatus} />
                        </td>
                        <td className="py-2.5 px-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(item.zoneId);
                              setShowZoneDetails(true);
                              const el = document.getElementById("risk-map");
                              if (el) el.scrollIntoView({ behavior: "smooth" });
                            }}
                            className="text-xs text-primary font-medium hover:underline cursor-pointer"
                          >
                            {t("road_network.view_zone", "View Zone →")}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(!prioritizationData?.rankedZones || prioritizationData.rankedZones.length === 0) && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-muted-foreground">
                          {t("response_prioritization.no_zones", "No prioritised zones available.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 3. Region Overview */}
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

                {/* Regional Scope Clarification */}
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[0.68rem] text-muted-foreground font-mono">
                  <span>{t("overview.coverage_scope", "Coverage: 8 NER States · 130 Districts · 479 Spatial Grid Cells")}</span>
                  <span className="font-semibold text-primary">{data.zones.length} {t("overview.operational_zones", "Priority Telemetry Stations")}</span>
                </div>

                {/* 6 Metrics Grid with subtle vertical separators */}
                <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-border py-4 my-1 text-center">
                  <div className="px-1.5">
                    <div className="font-display text-xl sm:text-2xl font-bold text-foreground">
                      8
                    </div>
                    <div className="mt-1 text-[0.65rem] text-muted-foreground leading-tight">
                      {t("overview.states_monitored", "States Covered")}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="font-display text-xl sm:text-2xl font-bold text-foreground">
                      {Object.keys(NER_DISTRICTS).length}
                    </div>
                    <div className="mt-1 text-[0.65rem] text-muted-foreground leading-tight">
                      {t("overview.districts_monitored", "Districts Covered")}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="font-display text-xl sm:text-2xl font-bold text-primary">
                      {data.zones.length}
                    </div>
                    <div className="mt-1 text-[0.65rem] text-muted-foreground leading-tight">
                      {t("overview.active_zones", "Active Stations")}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="font-display text-xl sm:text-2xl font-bold text-red-600">
                      {highOrSevereZones.length}
                    </div>
                    <div className="mt-1 text-[0.65rem] text-muted-foreground leading-tight">
                      {t("overview.high_or_severe", "High / Severe")}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="font-display text-xl sm:text-2xl font-bold text-foreground">
                      {data.alerts.length}
                    </div>
                    <div className="mt-1 text-[0.65rem] text-muted-foreground leading-tight">
                      {t("overview.active_alerts", "Active alerts")}
                    </div>
                  </div>
                  <div className="px-1.5">
                    <div className="font-display text-xl sm:text-2xl font-bold text-foreground">
                      {((data as any).observations || []).length}
                    </div>
                    <div className="mt-1 text-[0.65rem] text-muted-foreground leading-tight">
                      {t("overview.field_observations_30d", "Field Reports")}
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
                      {highOrSevereZones.length > 0
                        ? t("overview.elevated_risk_title", `Elevated landslide risk in parts of ${elevatedStates}`)
                        : t("overview.standard_risk_title", "Operational situational monitoring active across North Eastern Region")}
                    </div>
                    <div className="text-[0.68rem] text-red-700/80 dark:text-red-400 mt-0.5">
                      {t("overview.elevated_risk_desc", "Due to sustained rainfall and saturated soil conditions.")}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowZoneDetails(true);
                    window.history.pushState(null, "", "/#risk-map");
                    setTimeout(() => {
                      const el = document.getElementById("zone-details-brief") || document.getElementById("risk-map");
                      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 50);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-red-900 dark:text-red-300 hover:underline shrink-0 font-sans cursor-pointer"
                >
                  <span>{t("overview.view_details", "View details →")}</span>
                </button>
              </div>
            </div>

            {/* 4. Regional Observations (with See Details) */}
            <div id="recent-observations" className="panel p-4 flex flex-col relative scroll-mt-20">
              <span id="observations" className="absolute -top-20" aria-hidden="true" />
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <h2 className="text-base font-bold text-foreground font-display">
                  {t("operational_tables.recent_observations_title", "Regional Observations")}
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedObsId(null);
                    setObsDialogOpen(true);
                    window.history.pushState(null, "", "/#recent-observations");
                  }}
                  className="text-xs font-medium text-primary hover:underline font-sans cursor-pointer"
                >
                  {t("operational_tables.view_all_observations", "View all observations →")}
                </button>
              </div>

              <div className="overflow-x-auto mt-2">
                <table className="w-full text-left text-xs border-collapse font-sans">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30 text-muted-foreground font-medium">
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("operational_tables.col_time", "Time (IST)")}</th>
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("operational_tables.col_location", "Location")}</th>
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("operational_tables.col_type", "Type")}</th>
                      <th className="py-2 px-2.5 whitespace-nowrap">{t("operational_tables.col_status", "Status")}</th>
                      <th className="py-2 px-2.5 text-right">{t("common.action", "Action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {observationsList.map((obs: any) => {
                      const cleanObs = sanitizeObservationRecord(obs);
                      const z = data.zones.find((x: ZoneRow) => x.id === cleanObs.zone_id);
                      const loc = z ? `${getLocalizedZoneName(z.id, z.zone_name, t)}, ${getLocalizedState(z.state, t)}` : t("zones.generic", "Zone {{id}}", { id: cleanObs.zone_id });
                      const typeLabel =
                        cleanObs.visual_signs ||
                        (cleanObs.road_status && cleanObs.road_status !== "open" ? `Road ${cleanObs.road_status}` : "Slope Movement");
                      const statusMeta = getObservationStatusMeta((cleanObs as any).status ?? (cleanObs as any).review_status);
                      return (
                        <tr key={obs.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="py-2.5 px-2.5 font-mono text-[0.7rem] whitespace-nowrap text-muted-foreground">
                            {new Date(obs.observed_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </td>
                          <td className="py-2.5 px-2.5 font-semibold text-foreground whitespace-nowrap">
                            {loc}
                          </td>
                          <td className="py-2.5 px-2.5 text-muted-foreground text-[0.72rem] truncate max-w-[120px]">
                            {typeLabel}
                          </td>
                          <td className="py-2.5 px-2.5 whitespace-nowrap">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded border text-[0.62rem] font-semibold ${statusMeta.badgeClass}`}
                            >
                              {statusMeta.label}
                            </span>
                          </td>
                          <td className="py-2.5 px-2.5 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedObsId(obs.id);
                                setObsDialogOpen(true);
                              }}
                              className="text-xs text-primary font-bold hover:underline cursor-pointer"
                            >
                              {t("observations.see_details", "See Details →")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {observationsList.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">
                          {t("observations.no_records", "No observations found matching the search filter.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* BOTTOM SECTION: Road Connectivity (50%) & Alert Console (50%) */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          {/* Left: Road Connectivity */}
          <div id="road-connectivity" className="panel flex flex-col h-full overflow-hidden relative scroll-mt-20">
            <span id="road-network" className="absolute -top-20" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-surface shrink-0">
              <div>
                <h2 className="text-base font-bold text-foreground font-display">
                  {t("operational_tables.road_connectivity_title", "Road Connectivity")}
                </h2>
                <p className="text-[0.68rem] text-muted-foreground">
                  {t("road_network.arterial_subtitle", "Critical transport links and passability status")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRoadDialogOpen(true);
                  window.history.pushState(null, "", "/#road-connectivity");
                }}
                className="text-xs font-medium text-primary hover:underline font-sans cursor-pointer"
              >
                {t("operational_tables.view_all_roads", "See All Roads →")}
              </button>
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
                    .sort((a, b) => (a.status === "blocked" ? -1 : a.status === "restricted" ? 0 : 1))
                    .slice(0, 6)
                    .map((r) => {
                      const z = data.zones.find((x: ZoneRow) => x.id === r.zone_id);
                      return (
                        <tr key={r.id} className="hover:bg-secondary/20 transition-colors">
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-foreground block whitespace-nowrap font-display">
                              {r.road_name}
                            </span>
                            <span className="text-[0.68rem] text-muted-foreground block font-mono">
                              {r.segment_label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-muted-foreground whitespace-nowrap">
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

          {/* Right: Alert Console */}
          <div id="alert-console" className="panel flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-4 py-3 bg-surface shrink-0">
              <div>
                <h2 className="text-base font-bold text-foreground font-display">
                  {t("operational_tables.alert_console_title", "Alert Console")}
                </h2>
                <p className="text-[0.68rem] text-muted-foreground">
                  {t("operational_tables.alert_console_subtitle", "Active emergency warnings and broadcast advisories")}
                </p>
              </div>
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
                  {data.alerts.slice(0, 6).map((a: any) => {
                    const z = data.zones.find((x: ZoneRow) => x.id === a.zone_id);
                    const location = z ? `${getLocalizedZoneName(z.id, z.zone_name, t)}, ${getLocalizedState(z.state, t)}` : t("zones.generic", "Zone {{id}}", { id: a.zone_id });
                    const displayMessage = z
                      ? getLocalizedAlertMessage(getLocalizedZoneName(z.id, z.zone_name, t), a.risk_level, t)
                      : a.message;
                    return (
                      <tr key={a.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-2.5 px-3 font-mono text-[0.7rem] whitespace-nowrap text-muted-foreground">
                          {new Date(a.dispatched_at).toLocaleDateString(i18n.language || "en-IN", { day: "2-digit", month: "short" })}{" "}
                          {new Date(a.dispatched_at).toLocaleTimeString(i18n.language || "en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <RiskBadge
                            level={a.risk_level}
                            score={a.risk_level === "Severe" ? 90 : a.risk_level === "High" ? 70 : 45}
                          />
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-foreground whitespace-nowrap">
                          {location}
                        </td>
                        <td className="py-2.5 px-3 text-muted-foreground text-[0.72rem] line-clamp-2 max-w-xs">
                          {displayMessage}
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
        </section>

        {/* Dialogs */}
        <RoadNetworkDialog
          roads={data.roads}
          zones={data.zones}
          open={roadDialogOpen}
          onOpenChange={setRoadDialogOpen}
          onSelectZone={(zoneId) => {
            setSelectedId(zoneId);
            setShowZoneDetails(true);
            const el = document.getElementById("risk-map");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }}
        />

        <ObservationDetailsDialog
          observations={(data as any).observations || []}
          zones={data.zones}
          selectedObservationId={selectedObsId}
          open={obsDialogOpen}
          onOpenChange={setObsDialogOpen}
          onSelectZone={(zoneId) => {
            setSelectedId(zoneId);
            setShowZoneDetails(true);
            const el = document.getElementById("risk-map");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }}
          onSuccess={() => qc.invalidateQueries()}
          viewerRole={viewerRole}
          accessToken={accessToken}
        />
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
