import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip, useMap } from "react-leaflet";
import { useEffect, useState } from "react";
import type { ZoneRow, SlideRow } from "@/lib/monitoring.functions";
import { riskColor, zonePolygon } from "@/lib/risk";
import { useTranslation } from "react-i18next";

function MapResizeHandler({ selectedZone }: { selectedZone?: ZoneRow | null }) {
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
    }
  }, [selectedZone, map]);

  return null;
}

type Props = {
  zones: ZoneRow[];
  slides?: SlideRow[];
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  center?: [number, number];
  zoom?: number;
};

export default function RiskMap({
  zones,
  slides = [],
  selectedId = null,
  onSelect,
  center = [25.6, 92.8],
  zoom = 7,
}: Props) {
  const { t } = useTranslation();
  const [satelliteStatus, setSatelliteStatus] = useState<{
    enabled: boolean;
    configured: boolean;
    attribution?: string;
  } | null>(null);
  const [showTrueColor, setShowTrueColor] = useState(false);
  const [showNdvi, setShowNdvi] = useState(false);

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
      {/* Satellite Imagery Layer Controls (Gracefully hidden if not configured in environment) */}
      {hasSatellite && (
        <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5 rounded border border-border/80 bg-background/90 p-2.5 shadow-lg backdrop-blur text-xs font-mono">
          <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1 mb-1">
            <span className="font-semibold text-primary uppercase text-[0.68rem] tracking-wider">
              {t("risk_map.sentinel_visuals", "🛰 Sentinel-2 Visuals")}
            </span>
            <span
              className="text-[0.65rem] text-muted-foreground cursor-help"
              title={t("risk_map.visual_only_title", "Supplementary visual context only — not automated landslide scar detection or hazard prediction.")}
            >
              {t("risk_map.visual_only", "ℹ Visual Only")}
            </span>
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
        </div>
      )}

      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="isolate w-full h-full min-h-[460px]"
        style={{ height: "100%", width: "100%", minHeight: "460px", zIndex: 1 }}
      >
        <MapResizeHandler selectedZone={selectedZone} />
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
