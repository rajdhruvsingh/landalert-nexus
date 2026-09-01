import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Polygon, CircleMarker, Tooltip } from "react-leaflet";
import type { ZoneRow, SlideRow } from "@/lib/monitoring.functions";
import { riskColor, zonePolygon } from "@/lib/risk";

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
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
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
                {z.zone_name} — {z.current_risk_level} ({z.risk_score})
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
              {s.severity} slide · {s.event_date}
            </span>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
