import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Polygon, Rectangle, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { useEffect, useState } from "react";
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

  const selectedZone = zones.find((z) => z.id === selectedId) ?? null;

  useEffect(() => {
    if (typeof window === "undefined") return;
    fetch("/api/satellite/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setSatelliteStatus(data))
      .catch(() => setSatelliteStatus(null));
  }, []);

  const hasSatellite = Boolean(satelliteStatus?.enabled && satelliteStatus?.configured);

  return (
    <div className="relative w-full h-full min-h-[460px]">
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
      </MapContainer>
    </div>
  );
}
