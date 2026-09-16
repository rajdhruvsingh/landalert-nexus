import math
from datetime import datetime, timezone
from .models import RiskZone, HistoricalLandslide, RoadSegment

def zone_polygon(zone_id: int, lat: float, lng: float) -> list[list[float]]:
    points = []
    sides = 7
    for i in range(sides):
        angle = (2 * math.pi * i) / sides + zone_id * 0.37
        wobble = 0.72 + 0.42 * abs(math.sin(zone_id * 3.1 + i * 1.7))
        r = 0.17 * wobble
        points.append([lat + r * math.sin(angle), lng + r * math.cos(angle) * 1.12])
    return points

def get_zones_geojson():
    try:
        zones = list(RiskZone.objects.all())
    except Exception:
        zones = []
    features = []
    for z in zones:
        lat_lngs = zone_polygon(z.id, z.centroid_lat, z.centroid_lng)
        # RFC 7946 standard requires [lng, lat]
        ring = [[lng, lat] for lat, lng in lat_lngs]
        if ring:
            ring.append([ring[0][0], ring[0][1]])

        features.append({
            "type": "Feature",
            "id": z.id,
            "geometry": {
                "type": "Polygon",
                "coordinates": [ring],
            },
            "properties": {
                "id": z.id,
                "zone_name": z.zone_name,
                "district": z.district,
                "state": z.state,
                "population": z.population,
                "mean_slope_deg": z.mean_slope_deg,
                "current_risk_level": z.current_risk_level,
                "risk_score": z.risk_score,
                "soil_moisture_pct": z.soil_moisture_pct,
                "soil_moisture_status": z.soil_moisture_status,
                "explanation": z.explanation,
                "last_computed_at": z.last_computed_at.isoformat() if z.last_computed_at else None,
                "active_model_version": "v0.5-rf-xgb-ensemble",
                "centroid_lat": z.centroid_lat,
                "centroid_lng": z.centroid_lng,
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "zone_count": len(features),
            "spatial_reference": "EPSG:4326 (WGS84)",
            "data_layer": "LandAlert-Nexus Monitored Hill Zones",
        },
    }

def get_landslides_geojson():
    try:
        slides = list(HistoricalLandslide.objects.all()[:1000])
    except Exception:
        slides = []
    features = []
    for s in slides:
        features.append({
            "type": "Feature",
            "id": s.id,
            "geometry": {
                "type": "Point",
                "coordinates": [s.lng, s.lat],
            },
            "properties": {
                "id": s.id,
                "event_date": s.event_date.isoformat() if s.event_date else None,
                "severity": s.severity,
                "source": s.source,
                "hazard_type": s.hazard_type,
                "is_synthetic": s.is_synthetic,
                "zone_id": s.zone_id,
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "event_count": len(features),
            "spatial_reference": "EPSG:4326 (WGS84)",
            "data_layer": "LandAlert-Nexus Historical Landslides",
        },
    }

def get_villages_geojson():
    return {
        "type": "FeatureCollection",
        "features": [],
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "village_count": 0,
            "spatial_reference": "EPSG:4326 (WGS84)",
            "data_layer": "LandAlert-Nexus Villages",
        },
    }

def get_infrastructure_geojson():
    roads = RoadSegment.objects.all()
    features = []
    for r in roads:
        zone = RiskZone.objects.filter(id=r.zone_id).first()
        lat = zone.centroid_lat if zone else 26.0
        lng = zone.centroid_lng if zone else 92.0
        features.append({
            "type": "Feature",
            "id": r.id,
            "geometry": {
                "type": "Point",
                "coordinates": [lng, lat],
            },
            "properties": {
                "name": f"{r.road_name} ({r.segment_label})",
                "type": "road",
                "status": r.status,
                "length_km": r.length_km,
                "zone_id": r.zone_id,
            },
        })

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "infrastructure_count": len(features),
            "spatial_reference": "EPSG:4326 (WGS84)",
            "data_layer": "LandAlert-Nexus Critical Infrastructure",
        },
    }

def compute_exposure_summary(zone_id: int):
    roads = RoadSegment.objects.filter(zone_id=zone_id)
    return {
        "zoneId": zone_id,
        "villageCount": 0,
        "estimatedPopulationExposed": 0,
        "populationDataCompleteness": 0,
        "villagesWithPopulationData": 0,
        "infrastructureCount": roads.count(),
        "infrastructureByType": {
            "hospital": 0,
            "clinic": 0,
            "school": 0,
            "bridge": 0,
            "power": 0,
            "road": roads.count(),
        },
        "nearestVillage": None,
        "nearestInfrastructure": None,
    }
