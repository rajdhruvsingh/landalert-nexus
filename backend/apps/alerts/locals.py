from datetime import datetime, timezone
import math

LOCALS_CLUSTER_THRESHOLD = 10
LOCALS_RADIUS_METERS = 500

_ACTIVE_LOCALS_ALERTS = []
_ALERT_ID_COUNTER = 1

def get_active_locals_alerts():
    return list(_ACTIVE_LOCALS_ALERTS)

def evaluate_observations_for_locals_escalation(observations: list):
    global _ALERT_ID_COUNTER
    if not observations or len(observations) < LOCALS_CLUSTER_THRESHOLD:
        return {
            "escalated": False,
            "new_alerts_count": 0,
            "active_alerts": list(_ACTIVE_LOCALS_ALERTS),
        }

    # Group by zone_id
    by_zone = {}
    for obs in observations:
        zid = obs.get("zone_id") or 1
        by_zone.setdefault(zid, []).append(obs)

    new_alerts = []
    for zid, group in by_zone.items():
        if len(group) >= LOCALS_CLUSTER_THRESHOLD:
            # Check existing
            already_active = any(a["zone_id"] == zid for a in _ACTIVE_LOCALS_ALERTS)
            if not already_active:
                alert = {
                    "alert_id": f"locals-alert-{_ALERT_ID_COUNTER}",
                    "zone_id": zid,
                    "report_type": group[0].get("visual_signs", "TENSION_CRACK"),
                    "status": "ACTIVE",
                    "detection_method": "ZONE_FALLBACK",
                    "contributing_observations_count": len(group),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "recommended_action": "PRIORITY_FIELD_INSPECTION",
                }
                _ALERT_ID_COUNTER += 1
                _ACTIVE_LOCALS_ALERTS.append(alert)
                new_alerts.append(alert)

    return {
        "escalated": len(new_alerts) > 0,
        "new_alerts_count": len(new_alerts),
        "active_alerts": list(_ACTIVE_LOCALS_ALERTS),
    }

def resolve_locals_alert(alert_id: str, action: str, notes: str = None):
    for a in _ACTIVE_LOCALS_ALERTS:
        if a["alert_id"] == alert_id:
            a["status"] = "RESOLVED"
            a["resolution"] = {
                "action": action,
                "notes": notes,
                "resolved_at": datetime.now(timezone.utc).isoformat(),
            }
            return {"success": True, "alert": a}
    return {"success": False, "error": f"Alert {alert_id} not found"}
