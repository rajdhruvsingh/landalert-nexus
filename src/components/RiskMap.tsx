import "leaflet/dist/leaflet.css";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Rectangle,
  CircleMarker,
  Marker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import { useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Hospital, Stethoscope, GraduationCap, Route, Zap } from "lucide-react";
import type { ZoneRow, SlideRow } from "@/lib/monitoring.functions";
import { riskColor, zonePolygon } from "@/lib/risk";
import { useTranslation } from "react-i18next";
import type { CellRiskEvaluation } from "@/lib/spatial-risk.service";

function MapResizeHandler({
  selectedZone,
  center,
  zoom,
}: {
  selectedZone?: ZoneRow | null;
  center?: [number, number];
  zoom?: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const t1 = setTimeout(() => map.invalidateSize(), 50);
    const t2 = setTimeout(() => map.invalidateSize(), 250);
    const t3 = setTimeout(() => map.invalidateSize(), 700);
    const container = map.getContainer();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            map.invalidateSize();
          })
        : null;
    if (observer && container) {
      observer.observe(container);
    }
    const onResize = () => map.invalidateSize();
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      if (observer) observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [map]);

  useEffect(() => {
    if (selectedZone && selectedZone.centroid_lat && selectedZone.centroid_lng) {
      map.flyTo([selectedZone.centroid_lat, selectedZone.centroid_lng], Math.max(map.getZoom(), 8), {
        duration: 0.8,
      });
    } else if (center) {
      map.flyTo(center, zoom ?? map.getZoom(), {
        duration: 0.8,
      });
    }
  }, [selectedZone, center, zoom, map]);

  return null;
}

type Props = {
  zones: ZoneRow[];
  slides?: SlideRow[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  center?: [number, number];
  zoom?: number;
  spatialCells?: CellRiskEvaluation[];
  onSelectCell?: (cell: CellRiskEvaluation) => void;
};

type VillageFeature = {
  type: "Feature";
  id?: string | number;
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    name: string;
    district: string | null;
    state: string | null;
    population: number | null;
    zone_id: number | null;
    distance_km_to_zone: number | null;
    osm_place_tag: string | null;
  };
};

type InfrastructureFeature = {
  type: "Feature";
  id?: string | number;
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: {
    name: string;
    type: "hospital" | "clinic" | "school" | "bridge" | "power";
    zone_id: number | null;
    distance_km_to_zone: number | null;
  };
};

type GeoJsonFeatureCollection<T> = {
  type: "FeatureCollection";
  features: T[];
};

export default function RiskMap({
  zones,
  slides = [],
  selectedId = null,
  onSelect,
  center = [25.6, 92.8],
  zoom = 7,
  spatialCells = [],
  onSelectCell,
}: Props) {
  const { t } = useTranslation();
  const [satelliteStatus, setSatelliteStatus] = useState<{
    enabled: boolean;
    configured: boolean;
    attribution?: string;
  } | null>(null);
  const [showTrueColor, setShowTrueColor] = useState(false);
  const [showNdvi, setShowNdvi] = useState(false);
  const [showSpatialGrid, setShowSpatialGrid] = useState(true);
  const [showInSarDeformation, setShowInSarDeformation] = useState(false);
  const [showVillages, setShowVillages] = useState(true);
  const [showInfrastructure, setShowInfrastructure] = useState(true);
  const [villagesData, setVillagesData] = useState<GeoJsonFeatureCollection<VillageFeature> | null>(null);
  const [infrastructureData, setInfrastructureData] = useState<GeoJsonFeatureCollection<InfrastructureFeature> | null>(null);
  const [villagesError, setVillagesError] = useState<string | null>(null);
  const [infrastructureError, setInfrastructureError] = useState<string | null>(null);

  const selectedZone = zones.find((z) => z.id === selectedId) ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let isMounted = true;

    fetch("/api/satellite/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted) setSatelliteStatus(data);
      })
      .catch(() => {
        if (isMounted) setSatelliteStatus(null);
      });

    fetch("/api/gis/villages.geojson")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (isMounted && data && Array.isArray(data.features)) {
          setVillagesData(data);
          setVillagesError(null);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.warn("[RiskMap] Failed to load villages GeoJSON:", err);
          setVillagesError("Failed to load villages layer");
        }
      });

    fetch("/api/gis/infrastructure.geojson")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (isMounted && data && Array.isArray(data.features)) {
          setInfrastructureData(data);
          setInfrastructureError(null);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.warn("[RiskMap] Failed to load infrastructure GeoJSON:", err);
          setInfrastructureError("Failed to load infrastructure layer");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const infraIcons = useMemo(() => {
    if (typeof window === "undefined") return null;

    try {
      const createIcon = (bg: string, iconElement: React.ReactElement) => {
        const svgString = renderToStaticMarkup(iconElement);
        return L.divIcon({
          className: "",
          html: `<div style="background-color:${bg};color:#ffffff;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.9);">${svgString}</div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          popupAnchor: [0, -9],
        });
      };

      return {
        hospital: createIcon("#dc2626", <Hospital size={10} strokeWidth={2.5} />),
        clinic: createIcon("#ea580c", <Stethoscope size={10} strokeWidth={2.5} />),
        school: createIcon("#2563eb", <GraduationCap size={10} strokeWidth={2.5} />),
        bridge: createIcon("#7c3aed", <Route size={10} strokeWidth={2.5} />),
        power: createIcon("#d97706", <Zap size={10} strokeWidth={2.5} />),
      };
    } catch {
      return null;
    }
  }, []);

  const villageMarkers = useMemo(() => {
    if (!showVillages || !villagesData?.features?.length) return null;

    return villagesData.features.map((feature, idx) => {
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) return null;
      const [lng, lat] = coords;
      if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) return null;

      const props = feature.properties;
      const isHamlet = props.osm_place_tag === "hamlet";
      const key = feature.id ?? `village-${props.name}-${idx}`;

      return (
        <CircleMarker
          key={key}
          center={[lat, lng]}
          radius={isHamlet ? 2.5 : 4}
          pathOptions={{
            color: isHamlet ? "#64748b" : "#0284c7",
            fillColor: isHamlet ? "#94a3b8" : "#38bdf8",
            fillOpacity: isHamlet ? 0.65 : 0.85,
            weight: isHamlet ? 1 : 1.5,
          }}
        >
          <Tooltip direction="top">
            <span className="font-mono text-xs">
              {props.name} ({isHamlet ? "Hamlet" : "Village"})
            </span>
          </Tooltip>
          <Popup className="gis-popup">
            <div className="font-sans text-xs leading-snug space-y-1 text-slate-200">
              <div className="font-bold text-sm text-white tracking-tight leading-tight">
                {props.name}
              </div>
              <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-sky-400">
                {isHamlet ? "Hamlet" : "Village"}
              </div>
              {(props.district || props.state) && (
                <div className="text-[0.72rem] text-slate-300">
                  {[props.district, props.state].filter(Boolean).join(", ")}
                </div>
              )}
              {props.population !== null && props.population !== undefined && (
                <div className="text-[0.7rem] text-slate-400">
                  Population:{" "}
                  <span className="font-semibold text-slate-200">
                    {props.population.toLocaleString()}
                  </span>
                </div>
              )}
              {props.distance_km_to_zone !== null && props.distance_km_to_zone !== undefined && (
                <div className="text-[0.7rem] text-slate-400 pt-0.5 border-t border-slate-700/60">
                  <span className="font-semibold text-slate-200">
                    {props.distance_km_to_zone.toFixed(1)} km
                  </span>{" "}
                  from risk zone
                </div>
              )}
            </div>
          </Popup>
        </CircleMarker>
      );
    });
  }, [showVillages, villagesData]);

  const infrastructureMarkers = useMemo(() => {
    if (!showInfrastructure || !infrastructureData?.features?.length) return null;

    const colorMap: Record<string, { stroke: string; fill: string }> = {
      hospital: { stroke: "#b91c1c", fill: "#dc2626" },
      clinic: { stroke: "#c2410c", fill: "#ea580c" },
      school: { stroke: "#1d4ed8", fill: "#2563eb" },
      bridge: { stroke: "#6d28d9", fill: "#7c3aed" },
      power: { stroke: "#b45309", fill: "#d97706" },
    };

    return infrastructureData.features.map((feature, idx) => {
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) return null;
      const [lng, lat] = coords;
      if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) return null;

      const props = feature.properties;
      const type = props.type;
      const key = feature.id ?? `infra-${props.name}-${idx}`;
      const icon = infraIcons?.[type];

      const typeLabel =
        type === "hospital"
          ? "Hospital"
          : type === "clinic"
          ? "Clinic"
          : type === "school"
          ? "School"
          : type === "bridge"
          ? "Bridge"
          : type === "power"
          ? "Power Facility"
          : type;

      const typeColorClass =
        type === "hospital"
          ? "text-red-400"
          : type === "clinic"
          ? "text-orange-400"
          : type === "school"
          ? "text-blue-400"
          : type === "bridge"
          ? "text-purple-400"
          : "text-amber-400";

      if (icon) {
        return (
          <Marker key={key} position={[lat, lng]} icon={icon}>
            <Tooltip direction="top">
              <span className="font-mono text-xs">
                {props.name} ({typeLabel})
              </span>
            </Tooltip>
            <Popup className="gis-popup">
              <div className="font-sans text-xs leading-snug space-y-1 text-slate-200">
                <div className="font-bold text-sm text-white tracking-tight leading-tight">
                  {props.name}
                </div>
                <div className={`text-[0.68rem] font-semibold uppercase tracking-wider ${typeColorClass}`}>
                  {typeLabel}
                </div>
                {props.distance_km_to_zone !== null && props.distance_km_to_zone !== undefined && (
                  <div className="text-[0.7rem] text-slate-400 pt-0.5 border-t border-slate-700/60">
                    <span className="font-semibold text-slate-200">
                      {props.distance_km_to_zone.toFixed(1)} km
                    </span>{" "}
                    from risk zone
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        );
      }

      const colors = colorMap[type] ?? { stroke: "#b91c1c", fill: "#dc2626" };

      return (
        <CircleMarker
          key={key}
          center={[lat, lng]}
          radius={5}
          pathOptions={{
            color: colors.stroke,
            fillColor: colors.fill,
            fillOpacity: 0.9,
            weight: 1.5,
          }}
        >
          <Tooltip direction="top">
            <span className="font-mono text-xs">
              {props.name} ({typeLabel})
            </span>
          </Tooltip>
          <Popup className="gis-popup">
            <div className="font-sans text-xs leading-snug space-y-1 text-slate-200">
              <div className="font-bold text-sm text-white tracking-tight leading-tight">
                {props.name}
              </div>
              <div className={`text-[0.68rem] font-semibold uppercase tracking-wider ${typeColorClass}`}>
                {typeLabel}
              </div>
              {props.distance_km_to_zone !== null && props.distance_km_to_zone !== undefined && (
                <div className="text-[0.7rem] text-slate-400 pt-0.5 border-t border-slate-700/60">
                  <span className="font-semibold text-slate-200">
                    {props.distance_km_to_zone.toFixed(1)} km
                  </span>{" "}
                  from risk zone
                </div>
              )}
            </div>
          </Popup>
        </CircleMarker>
      );
    });
  }, [showInfrastructure, infrastructureData, infraIcons]);

  const hasSatellite = Boolean(satelliteStatus?.enabled && satelliteStatus?.configured);

  return (
    <div className="relative w-full h-full min-h-[460px]">
      <style>{`
        .gis-popup .leaflet-popup-content-wrapper {
          background-color: #0b1329 !important;
          color: #f8fafc !important;
          border: 1px solid #1e293b !important;
          border-radius: 6px !important;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6) !important;
          padding: 0 !important;
        }
        .gis-popup .leaflet-popup-content {
          margin: 10px 14px !important;
          line-height: 1.35 !important;
          min-width: 180px !important;
          max-width: 240px !important;
        }
        .gis-popup .leaflet-popup-tip {
          background-color: #0b1329 !important;
          border: 1px solid #1e293b !important;
          box-shadow: none !important;
        }
        .gis-popup a.leaflet-popup-close-button {
          color: #94a3b8 !important;
          padding: 6px 8px 0 0 !important;
          font-size: 16px !important;
          font-weight: bold !important;
        }
        .gis-popup a.leaflet-popup-close-button:hover {
          color: #ffffff !important;
        }
      `}</style>
      {/* Layer Controls Panel (Satellite & Spatial Grid) */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5 rounded border border-border/80 bg-background/95 p-2.5 shadow-lg backdrop-blur text-xs font-mono">
        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1 mb-1">
          <span className="font-semibold text-primary uppercase text-[0.68rem] tracking-wider">
            {t("risk_map.layers_title", "Layers & Grid")}
          </span>
          <span
            className="text-[0.65rem] text-muted-foreground cursor-help"
            title={t("risk_map.spatial_coverage_info", "Continuous 0.25° spatial landslide risk prediction grid across all 8 Northeast states.")}
          >
            {spatialCells.length} cells
          </span>
        </div>

        {/* Spatial Grid Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showSpatialGrid}
            onChange={(e) => setShowSpatialGrid(e.target.checked)}
            className="rounded border-border text-primary"
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
            className="rounded border-border text-violet-500"
          />
          <span className="text-[0.72rem] font-semibold text-foreground flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block"></span>
            {t("risk_map.show_insar_layer", "InSAR Ground Deformation")}
          </span>
        </label>

        {/* Villages Layer Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showVillages}
            onChange={(e) => setShowVillages(e.target.checked)}
            className="rounded border-border text-sky-500"
          />
          <span className="text-[0.72rem] font-semibold text-foreground flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-sky-500 inline-block"></span>
            {t("risk_map.show_villages", "Villages & Hamlets")}
            {villagesData && (
              <span className="text-[0.65rem] text-muted-foreground">({villagesData.features.length})</span>
            )}
            {villagesError && (
              <span className="text-[0.65rem] text-amber-500" title={villagesError}>(unavailable)</span>
            )}
          </span>
        </label>

        {/* Critical Infrastructure Layer Toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInfrastructure}
            onChange={(e) => setShowInfrastructure(e.target.checked)}
            className="rounded border-border text-red-500"
          />
          <span className="text-[0.72rem] font-semibold text-foreground flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500 inline-block"></span>
            {t("risk_map.show_infrastructure", "Critical Infrastructure")}
            {infrastructureData && (
              <span className="text-[0.65rem] text-muted-foreground">({infrastructureData.features.length})</span>
            )}
            {infrastructureError && (
              <span className="text-[0.65rem] text-amber-500" title={infrastructureError}>(unavailable)</span>
            )}
          </span>
        </label>

        {/* Satellite Imagery Layer Controls */}
        {hasSatellite && (
          <>
            <div className="border-t border-border/40 pt-1 mt-0.5 text-[0.65rem] uppercase text-muted-foreground font-semibold">
              {t("risk_map.sentinel_visuals", "🛰 Sentinel-2 Visuals")}
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showTrueColor}
                onChange={(e) => setShowTrueColor(e.target.checked)}
                className="rounded border-border text-primary"
              />
              <span className="text-[0.72rem]">{t("risk_map.true_color", "True-Color Imagery")}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showNdvi}
                onChange={(e) => setShowNdvi(e.target.checked)}
                className="rounded border-border text-primary"
              />
              <span className="text-[0.72rem]">{t("risk_map.ndvi_vegetation", "NDVI Vegetation Index")}</span>
            </label>
            <div className="text-[0.62rem] text-muted-foreground/80 pt-0.5 border-t border-border/30">
              {t("risk_map.sentinel_attribution", "Copernicus Sentinel data 2026")}
            </div>
          </>
        )}
      </div>

      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="isolate w-full h-full min-h-[460px]"
        style={{ height: "100%", width: "100%", minHeight: "460px", zIndex: 1 }}
      >
        <MapResizeHandler selectedZone={selectedZone} center={center} zoom={zoom} />
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Sentinel-2 True-Color Imagery Overlay */}
        {hasSatellite && showTrueColor && (
          <TileLayer
            attribution="&copy; Copernicus Sentinel data 2026 / Sentinel Hub | Supplementary Visual Context"
            url="/api/satellite/tiles?layer=TRUE-COLOR&z={z}&x={x}&y={y}"
            maxZoom={16}
            opacity={0.9}
          />
        )}

        {/* Sentinel-2 NDVI Vegetation Overlay */}
        {hasSatellite && showNdvi && (
          <TileLayer
            attribution="&copy; Copernicus Sentinel data 2026 / Sentinel Hub | NDVI Vegetation Overlay"
            url="/api/satellite/tiles?layer=NDVI&z={z}&x={x}&y={y}"
            maxZoom={16}
            opacity={0.65}
          />
        )}
        {/* Continuous 8-State Spatial Prediction Grid Surface */}
        {showSpatialGrid && spatialCells.map((c) => {
          const hasInSar = c.provenance.satellite_deformation?.status === "AVAILABLE";
          const strokeColor = showInSarDeformation && hasInSar ? "#8b5cf6" : riskColor(c.risk_level);
          const fillColor = showInSarDeformation && hasInSar ? "#a78bfa" : riskColor(c.risk_level);
          const weight = showInSarDeformation && hasInSar ? 2.0 : 0.6;
          const fillOpacity = showInSarDeformation && hasInSar ? 0.38 : 0.22;

          return (
            <Rectangle
              key={c.cell_id}
              bounds={c.bounds}
              pathOptions={{
                color: strokeColor,
                weight,
                fillColor,
                fillOpacity,
              }}
              eventHandlers={{
                click: () => onSelectCell?.(c),
              }}
            >
              <Tooltip direction="top" opacity={0.95}>
                <div className="font-mono text-xs leading-snug">
                  <div className="font-bold">{c.district}, {c.state} <span className="font-normal opacity-70">({c.cell_id})</span></div>
                  <div>Risk: <span className="font-semibold">{t(`risk_levels.${c.risk_level}`, c.risk_level)}</span> (Score: {c.final_risk_score}/100)</div>
                  <div className="text-[0.65rem] text-muted-foreground">Susceptibility: {(c.static_susceptibility * 100).toFixed(0)}% · Elev: {c.elevation_m}m · Slope: {c.slope_deg}°</div>
                  {hasInSar ? (
                    <div className="text-[0.68rem] text-violet-400 font-bold mt-0.5 border-t border-border/40 pt-0.5">
                      🛰 InSAR:{" "}
                      {c.provenance.satellite_deformation!.los_velocity_mean_mm_year !== null
                        ? `${c.provenance.satellite_deformation!.los_velocity_mean_mm_year} mm/yr (Velocity)`
                        : `${c.provenance.satellite_deformation!.cumulative_displacement_mm} mm (Pair LOS)`}{" "}
                      ({c.provenance.satellite_deformation!.sensor})
                    </div>
                  ) : (
                    <div className="text-[0.62rem] text-muted-foreground/70 mt-0.5 border-t border-border/30 pt-0.5">
                      InSAR: UNAVAILABLE ({c.provenance.satellite_deformation?.unavailable_reason === "SAR_DECORRELATION_DENSE_CANOPY" ? "Canopy decorrelation" : "Processing pending"})
                    </div>
                  )}
                </div>
              </Tooltip>
            </Rectangle>
          );
        })}

      {zones.map((z) => {
        const active = selectedId === z.id;
        return (
          <Polygon
            key={z.id}
            positions={zonePolygon(z.id, z.centroid_lat, z.centroid_lng)}
            pathOptions={{
              color: riskColor(z.current_risk_level),
              weight: active ? 3 : 1.5,
              fillColor: riskColor(z.current_risk_level),
              fillOpacity: active ? 0.55 : 0.3,
            }}
            eventHandlers={{ click: () => onSelect?.(z.id) }}
          >
            <Tooltip direction="top" opacity={1}>
              <span className="font-mono text-xs">
                {z.zone_name} — {t(`risk_levels.${z.current_risk_level}`, z.current_risk_level)} ({z.risk_score})
              </span>
            </Tooltip>
          </Polygon>
        );
      })}
      {slides.map((s) => (
        <CircleMarker
          key={s.id}
          center={[s.lat, s.lng]}
          radius={4}
          pathOptions={{ color: "#e6e6e6", weight: 1, fillOpacity: 0.9 }}
        >
          <Tooltip direction="top">
            <span className="font-mono text-xs">
              {t("risk_map.slide_tooltip", "{{severity}} slide · {{date}}", { severity: s.severity, date: s.event_date })}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Villages & Hamlets Layer */}
      {villageMarkers}

      {/* Critical Infrastructure Layer */}
      {infrastructureMarkers}
      </MapContainer>
    </div>
  );
}
