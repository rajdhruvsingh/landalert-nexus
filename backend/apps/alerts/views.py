from datetime import datetime, timezone
from rest_framework.views import APIView
from apps.core.responses import api_response, api_error
from apps.core.throttling import AlertDispatchThrottle
from apps.authentication.auth import authenticate_token, log_audit_event
from apps.gis.models import RiskZone
from .models import Alert
from .sms import dispatch_sms
from .locals import get_active_locals_alerts, evaluate_observations_for_locals_escalation

class AlertDispatchView(APIView):
    throttle_classes = [AlertDispatchThrottle]

    def post(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user:
            return api_error("Authentication required for emergency dispatch", "UNAUTHORIZED", 401)

        if not (user.is_dispatcher or user.is_admin or user.is_cron):
            log_audit_event(
                actor_user_id=user.id,
                actor_role=user.role,
                action="SECURITY_ALERT_DISPATCH_REJECTED",
                target_type="alert",
                target_id="dispatch_attempt",
                result="FORBIDDEN",
                actor_email=user.email,
                institution=user.institution,
                reason=f"User role {user.role} is not an authorized security official.",
            )
            return api_error("Forbidden: Emergency dispatch requires authorized DISPATCHER or ADMIN credentials", "FORBIDDEN", 403)

        data = request.data or {}
        zone_id = data.get("zoneId")
        if zone_id is None:
            return api_error("Missing zoneId", "INVALID_ZONE_ID", 400)

        try:
            zid = int(zone_id)
            if zid < 1 or zid > 15:
                return api_error("Invalid zone ID (must be between 1 and 15)", "INVALID_ZONE_ID", 400)
        except (ValueError, TypeError):
            return api_error("Invalid zone ID format", "INVALID_ZONE_ID", 400)

        justification = str(data.get("justification") or "").strip()
        if len(justification) < 8:
            return api_error("An official operational justification (min 8 chars) is required for emergency dispatch", "INVALID_JUSTIFICATION", 400)

        language = data.get("language", "en")
        channel = data.get("channel", "both")
        idempotency_key = data.get("idempotencyKey")

        zone = RiskZone.objects.filter(id=zid).first()
        risk_level = zone.current_risk_level if zone else "High"
        zone_name = zone.zone_name if zone else f"Zone {zid}"

        message = (
            f"[OFFICIAL ALERT - {risk_level.upper()}] Landslide threat elevated in {zone_name}. "
            f"Follow local disaster management authority instructions. Ref: {justification[:40]}"
        )

        # Dispatch SMS
        sms_res = dispatch_sms(
            recipients=["+919876543210"],
            message=message,
        )

        # Create alert in DB
        alert = Alert.objects.create(
            zone_id=zid,
            risk_level=risk_level,
            message=message,
            language=language,
            channel=channel,
            explanation=justification,
            dispatched_by=user.email,
            status="sent",
            recipient_group="all_residents",
            idempotency_key=idempotency_key,
            delivery_attempts=1,
            authorizing_official_id=user.id,
            authorizing_official_role=user.role,
            authorizing_institution=user.institution,
            dispatch_status="dispatched",
            justification=justification,
            provider_response=sms_res,
        )

        log_audit_event(
            actor_user_id=user.id,
            actor_role=user.role,
            action="EMERGENCY_DISPATCH_AUTHORIZED",
            target_type="alert",
            target_id=str(alert.id),
            result="SUCCESS",
            actor_email=user.email,
            institution=user.institution,
            details={"zoneId": zid, "riskLevel": risk_level, "channel": channel},
            reason=justification,
        )

        return api_response({
            "dispatched": True,
            "alertId": alert.id,
            "zoneId": zid,
            "riskLevel": risk_level,
            "channel": channel,
            "recipientCount": 1,
            "status": "sent",
            "justification": justification,
            "dispatchedAt": alert.dispatched_at.isoformat(),
        }, status=201)

class AlertRetractView(APIView):
    throttle_classes = [AlertDispatchThrottle]

    def post(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user:
            return api_error("Authentication required for alert retraction", "UNAUTHORIZED", 401)

        if not (user.is_dispatcher or user.is_admin or user.is_cron):
            return api_error("Forbidden: Alert retraction requires DISPATCHER or ADMIN credentials", "FORBIDDEN", 403)

        data = request.data or {}
        alert_id = data.get("alertId")
        if not alert_id:
            return api_error("Missing alertId", "MISSING_ALERT_ID", 400)

        reason = str(data.get("reason") or "").strip()
        if len(reason) < 8:
            return api_error("An operational retraction reason (min 8 chars) is required", "INVALID_RETRACTION_REASON", 400)

        alert = Alert.objects.filter(id=alert_id).first()
        if not alert:
            return api_error(f"Alert {alert_id} not found", "ALERT_NOT_FOUND", 404)

        # Retract alert - NEVER delete from DB!
        alert.status = "retracted"
        alert.dispatch_status = "retracted"
        alert.last_error = f"Retracted by {user.email}: {reason}"
        alert.save()

        # Follow-up correction broadcast via SMS gateway
        correction_msg = f"[ALERT CANCELLED] Previous alert #{alert_id} for Zone {alert.zone_id} has been retracted. Reason: {reason}"
        dispatch_sms(recipients=["+919876543210"], message=correction_msg)

        log_audit_event(
            actor_user_id=user.id,
            actor_role=user.role,
            action="EMERGENCY_DISPATCH_REJECTED",
            target_type="alert",
            target_id=str(alert.id),
            result="SUCCESS",
            actor_email=user.email,
            institution=user.institution,
            details={"action": "retraction", "alertId": alert_id},
            reason=reason,
        )

        return api_response({
            "retracted": True,
            "alertId": alert.id,
            "status": "retracted",
            "reason": reason,
            "retractedAt": datetime.now(timezone.utc).isoformat(),
        })

class SimulateView(APIView):
    def post(self, request):
        import os
        if os.getenv("ENABLE_SIMULATION") != "true":
            return api_error(
                "Simulation functionality is disabled in production environment",
                "SIMULATION_DISABLED",
                403,
            )

        data = request.data or {}
        try:
            zone_id = int(data.get("zoneId"))
            rainfall_mm = float(data.get("rainfallMm"))
            if zone_id < 1 or zone_id > 15 or rainfall_mm < 0:
                return api_error("Invalid zoneId or rainfallMm", "INVALID_INPUT", 400)
        except (ValueError, TypeError):
            return api_error("Invalid zoneId or rainfallMm", "INVALID_INPUT", 400)

        return api_response({
            "simulated": True,
            "zoneId": zone_id,
            "rainfallMm": rainfall_mm,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

class LocalsActiveView(APIView):
    def get(self, request):
        alerts = get_active_locals_alerts()
        return api_response({"ok": True, "active_alerts": alerts, "alerts": alerts, "count": len(alerts)})

class LocalsCheckView(APIView):
    def post(self, request):
        observations = request.data.get("observations") or []
        res = evaluate_observations_for_locals_escalation(observations)
        return api_response({
            "ok": True,
            "created_count": res.get("new_alerts_count", 0),
            "created_alerts": res.get("active_alerts", []),
            **res,
        })

class LocalsResolveView(APIView):
    def post(self, request, alert_id):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user:
            return api_error("Authentication required to resolve LOCALS alert", "UNAUTHORIZED", 401)

        if not (user.is_official or user.is_admin or user.is_cron):
            return api_error("Forbidden: Only VERIFIED_OFFICIAL, DISPATCHER, or ADMIN may resolve LOCALS alerts", "FORBIDDEN", 403)

        data = request.data or {}
        resolution = str(data.get("resolution") or "").strip()
        if resolution not in ("CONFIRMED_HAZARD", "FALSE_PATTERN"):
            return api_error("resolution must be 'CONFIRMED_HAZARD' or 'FALSE_PATTERN'", "INVALID_RESOLUTION", 400)

        note = str(data.get("note") or "").strip()
        if len(note) < 5:
            return api_error("A resolution note of at least 5 characters is required", "MISSING_NOTE", 400)

        from .locals import resolve_locals_alert
        resolve_res = resolve_locals_alert(alert_id, resolution, note)
        if not resolve_res.get("success"):
            return api_error(resolve_res.get("error") or "Resolution failed", "RESOLUTION_FAILED", 400)

        log_audit_event(
            actor_user_id=user.id,
            actor_role=user.role,
            action=f"LOCALS_ALERT_RESOLVED_{resolution}",
            target_type="locals_alert",
            target_id=str(alert_id),
            result="SUCCESS",
            actor_email=user.email,
            institution=user.institution,
            reason=note,
        )

        return api_response({
            "ok": True,
            "alert": resolve_res.get("alert"),
            "resolved_at": datetime.now(timezone.utc).isoformat(),
        })
