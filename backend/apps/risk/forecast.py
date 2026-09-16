import math
from datetime import datetime, timezone
from apps.gis.models import RiskZone

def moisture_threshold_mm(duration_hours: float) -> float:
    """Monga & Ganguli (2024/2026): E(mm) = -11.10 + 0.62 * D(hr)"""
    return -11.10 + 0.62 * duration_hours

def intensity_threshold_mm_per_day(duration_days: float) -> float:
    """Sikkim / NE-Himalaya: I = 43.26 * D^(-0.78)"""
    return 43.26 * math.pow(duration_days, -0.78)

def project_zone_risk_forecast(zone: RiskZone, forecast_24h_mm: float = None, forecast_48h_mm: float = None, forecast_72h_mm: float = None):
    disclaimer = (
        "Weather-linked forecast projections represent forward-looking guidance based on Open-Meteo numerical weather prediction. "
        "Forecast skill degrades with lead time. Projections do NOT alter authoritative current risk levels."
    )

    if forecast_24h_mm is None or forecast_48h_mm is None or forecast_72h_mm is None:
        return {
            "zoneId": zone.id,
            "zoneName": zone.zone_name,
            "district": zone.district,
            "state": zone.state,
            "currentRiskLevel": zone.current_risk_level,
            "currentRiskScore": zone.risk_score,
            "forecastStatus": "UNAVAILABLE",
            "forecastTimestamp": datetime.now(timezone.utc).isoformat(),
            "forecastWindows": None,
            "explanation": "Short-range precipitation forecast unavailable for this zone.",
            "disclaimer": disclaimer,
        }

    windows = [
        (24, max(0.0, float(forecast_24h_mm)), "high", "24h short-range skill is highest (uncertainty ±15%)."),
        (48, max(0.0, float(forecast_48h_mm)), "medium", "48h medium-range skill is moderate (uncertainty ±30%)."),
        (72, max(0.0, float(forecast_72h_mm)), "low", "72h extended skill has lower confidence (uncertainty ±45%)."),
    ]

    window_results = {}
    lead_times = ["24h", "48h", "72h"]

    for i, (lead_hours, rain_mm, conf, conf_notes) in enumerate(windows):
        duration_days = lead_hours / 24.0
        intensity_day = rain_mm / duration_days
        i_thr = intensity_threshold_mm_per_day(duration_days)
        e_thr = moisture_threshold_mm(float(lead_hours))
        ratio = intensity_day / i_thr if i_thr > 0 else 0.0

        if ratio >= 1.5:
            proj_level = "Severe"
            trend = "critical"
        elif ratio >= 1.0:
            proj_level = "High"
            trend = "elevating"
        elif ratio >= 0.6:
            proj_level = "Moderate"
            trend = "stable"
        else:
            proj_level = "Low"
            trend = "improving"

        narrative = (
            f"{lead_hours}h outlook: {rain_mm:.1f}mm expected ({intensity_day:.1f}mm/day rate, "
            f"{ratio:.2f}x threshold). Trend is {trend}."
        )

        window_results[lead_times[i]] = {
            "leadHours": lead_hours,
            "forecastRainfallMm": round(rain_mm, 1),
            "intensityMmPerDay": round(intensity_day, 1),
            "intensityThresholdMmPerDay": round(i_thr, 1),
            "moistureThresholdMm": round(e_thr, 1),
            "intensityRatio": round(ratio, 2),
            "projectedRiskLevel": proj_level,
            "trend": trend,
            "confidence": conf,
            "confidenceNotes": conf_notes,
            "narrative": narrative,
        }

    explanation = (
        f"Zone {zone.id} ({zone.district}): 24h risk projected {window_results['24h']['projectedRiskLevel']} "
        f"({window_results['24h']['forecastRainfallMm']}mm). Authoritative current risk: {zone.current_risk_level}."
    )

    return {
        "zoneId": zone.id,
        "zoneName": zone.zone_name,
        "district": zone.district,
        "state": zone.state,
        "currentRiskLevel": zone.current_risk_level,
        "currentRiskScore": zone.risk_score,
        "forecastStatus": "AVAILABLE",
        "forecastTimestamp": datetime.now(timezone.utc).isoformat(),
        "forecastWindows": window_results,
        "explanation": explanation,
        "disclaimer": disclaimer,
    }
