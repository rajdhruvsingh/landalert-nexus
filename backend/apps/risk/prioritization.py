from datetime import datetime, timezone
from apps.gis.models import RiskZone, RoadSegment

PRIORITIZATION_WEIGHTS = {
    "severity_weight": 0.40,
    "population_weight": 0.25,
    "road_cutoff_weight": 0.20,
    "field_observation_weight": 0.15,
}

def severity_rank(level: str) -> int | None:
    l = str(level).capitalize()
    if l == "Low":
        return 1
    elif l == "Moderate":
        return 2
    elif l == "High":
        return 3
    elif l == "Severe":
        return 4
    return None

def score_zone_prioritization(zone: RiskZone, road_segments: list, pending_obs_count: int = 0):
    rank = severity_rank(zone.current_risk_level)
    if rank is None:
        # STRICT REQUIREMENT: UNKNOWN must NOT be ranked or coerced
        return None

    drivers = []

    # 1. Severity points (Max 40.0)
    norm_severity = rank / 4.0
    severity_pts = round(norm_severity * PRIORITIZATION_WEIGHTS["severity_weight"] * 100, 1)
    drivers.append(f"{zone.current_risk_level} risk tier ({severity_pts} pts)")

    # 2. Population points (Max 25.0, saturated at 100k)
    pop_clamped = min(100000, max(0, zone.population))
    norm_pop = pop_clamped / 100000.0
    population_pts = round(norm_pop * PRIORITIZATION_WEIGHTS["population_weight"] * 100, 1)
    drivers.append(f"Population exposure: {zone.population} ({population_pts} pts)")

    # 3. Road connectivity points (Max 20.0)
    worst_road_status = "none"
    road_pts = 0.0
    if road_segments:
        statuses = [r.status for r in road_segments]
        if "blocked" in statuses:
            worst_road_status = "blocked"
            road_pts = 20.0
            drivers.append("Critical corridor blocked (20.0 pts)")
        elif "restricted" in statuses:
            worst_road_status = "restricted"
            road_pts = 10.0
            drivers.append("Corridor restricted (10.0 pts)")
        else:
            worst_road_status = "open"
            road_pts = 0.0
            drivers.append("Corridors open (0.0 pts)")

    # 4. Field observation intensity points (Max 15.0)
    obs_factor = min(1.0, pending_obs_count / 3.0)
    observation_pts = round(obs_factor * PRIORITIZATION_WEIGHTS["field_observation_weight"] * 100, 1)
    if pending_obs_count > 0:
        drivers.append(f"{pending_obs_count} pending field report(s) ({observation_pts} pts)")

    total_score = round(severity_pts + population_pts + road_pts + observation_pts, 1)

    return {
        "score": total_score,
        "worst_road_status": worst_road_status,
        "breakdown": {
            "severityPoints": severity_pts,
            "populationPoints": population_pts,
            "roadPoints": road_pts,
            "observationPoints": observation_pts,
            "totalScore": total_score,
            "topContributingDrivers": drivers,
        },
    }

def get_prioritized_response_ranking():
    try:
        zones = list(RiskZone.objects.all())
        roads = list(RoadSegment.objects.all())
    except Exception:
        zones = []
        roads = []

    roads_by_zone = {}
    for r in roads:
        roads_by_zone.setdefault(r.zone_id, []).append(r)

    ranked = []
    unranked = []

    for z in zones:
        scored = score_zone_prioritization(z, roads_by_zone.get(z.id, []))
        if scored is None:
            unranked.append({
                "zoneId": z.id,
                "zoneName": z.zone_name,
                "district": z.district,
                "state": z.state,
                "currentRiskLevel": z.current_risk_level,
                "population": z.population,
                "reason": "Risk level UNKNOWN cannot be prioritized numerically. Field inspection required.",
            })
        else:
            ranked.append({
                "zoneId": z.id,
                "zoneName": z.zone_name,
                "district": z.district,
                "state": z.state,
                "currentRiskLevel": z.current_risk_level,
                "population": z.population,
                "priorityScore": scored["score"],
                "factors": scored["breakdown"],
                "worstRoadStatus": scored["worst_road_status"],
                "pendingObservationCount": 0,
            })

    # Sort descending by priorityScore
    ranked.sort(key=lambda item: item["priorityScore"], reverse=True)
    for i, item in enumerate(ranked):
        item["rank"] = i + 1

    return {
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        "rankedZones": ranked,
        "unrankedZones": unranked,
        "weights": {
            "severityWeight": PRIORITIZATION_WEIGHTS["severity_weight"],
            "populationWeight": PRIORITIZATION_WEIGHTS["population_weight"],
            "roadCutoffWeight": PRIORITIZATION_WEIGHTS["road_cutoff_weight"],
            "fieldObservationWeight": PRIORITIZATION_WEIGHTS["field_observation_weight"],
        },
        "disclaimer": "Emergency prioritization provides decision support for resource staging. It does NOT automatically trigger alerts.",
    }
