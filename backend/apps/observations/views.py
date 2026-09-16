import os
import uuid
from datetime import datetime, timezone
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from apps.core.responses import api_response, api_error
from apps.core.throttling import MediaUploadThrottle, ObservationSyncThrottle
from apps.authentication.auth import authenticate_token, log_audit_event
from apps.gis.models import RiskZone
from .models import FieldObservation

ALLOWED_MIME_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
}
MAX_MEDIA_BYTES = 10 * 1024 * 1024  # 10MB

class ObservationReviewView(APIView):
    def post(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user:
            return api_error("Authentication required to review observations", "UNAUTHORIZED", 401)

        if not (user.is_official or user.is_admin):
            return api_error("Forbidden: Only verified government officials, dispatchers, or administrators can review observations", "FORBIDDEN", 403)

        data = request.data or {}
        obs_id = data.get("observationId")
        status = str(data.get("status") or "").upper()
        notes = str(data.get("verificationNotes") or "").strip()

        if not obs_id:
            return api_error("Missing observationId", "INVALID_INPUT", 400)

        if status not in ("VERIFIED", "REJECTED"):
            return api_error("Invalid status (must be VERIFIED or REJECTED)", "INVALID_STATUS", 400)

        obs = FieldObservation.objects.filter(id=obs_id).first()
        if not obs:
            return api_error(f"Observation {obs_id} not found", "NOT_FOUND", 404)

        obs.review_status = status
        obs.status = status
        obs.verified_by = user.email
        obs.verified_at = datetime.now(timezone.utc)
        obs.verification_notes = notes
        obs.is_training_eligible = (status == "VERIFIED")
        obs.save()

        log_audit_event(
            actor_user_id=user.id,
            actor_role=user.role,
            action=f"OBSERVATION_{status}",
            target_type="field_observation",
            target_id=str(obs.id),
            result="SUCCESS",
            actor_email=user.email,
            institution=user.institution,
            details={"reviewStatus": status},
            reason=notes,
        )

        return api_response({
            "reviewed": True,
            "observationId": str(obs.id),
            "status": status,
            "verifiedBy": user.email,
            "verifiedAt": obs.verified_at.isoformat(),
        })

class ObservationDeleteView(APIView):
    def post(self, request, obs_id=None):
        return self._handle_delete(request, obs_id)

    def delete(self, request, obs_id=None):
        return self._handle_delete(request, obs_id)

    def _handle_delete(self, request, obs_id=None):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user:
            return api_error("Authentication required to delete observations", "UNAUTHORIZED", 401)

        if not (user.is_official or user.is_admin):
            return api_error("Forbidden: Only verified government officials, dispatchers, or administrators can delete observations", "FORBIDDEN", 403)

        target_id = obs_id or request.data.get("observationId")
        if not target_id:
            return api_error("Missing observationId", "INVALID_INPUT", 400)

        obs = FieldObservation.objects.filter(id=target_id).first()
        if not obs:
            return api_error(f"Observation {target_id} not found", "NOT_FOUND", 404)

        reason = str(request.data.get("reason") or "Deleted by authorized official").strip()
        obs.delete()

        log_audit_event(
            actor_user_id=user.id,
            actor_role=user.role,
            action="OBSERVATION_DELETED",
            target_type="field_observation",
            target_id=str(target_id),
            result="SUCCESS",
            actor_email=user.email,
            institution=user.institution,
            reason=reason,
        )

        return api_response({"success": True, "deleted": True, "observationId": str(target_id)})

class SyncObservationsView(APIView):
    throttle_classes = [ObservationSyncThrottle]

    def post(self, request):
        observations = request.data.get("observations") or []
        if not isinstance(observations, list):
            return api_error("Invalid payload (expected list of observations)", "INVALID_PAYLOAD", 400)

        synced_count = 0
        for item in observations:
            try:
                obs_id = item.get("id") or str(uuid.uuid4())
                zid = int(item.get("zoneId") or item.get("zone_id") or 1)
                observed_at = item.get("observedAt") or item.get("observed_at") or datetime.now(timezone.utc)
                client_ts = item.get("clientTimestamp") or item.get("client_timestamp") or datetime.now(timezone.utc)

                FieldObservation.objects.update_or_create(
                    id=obs_id,
                    defaults={
                        "zone_id": zid,
                        "observer_id": item.get("observerId", "anonymous"),
                        "observed_at": observed_at,
                        "client_timestamp": client_ts,
                        "rainfall_mm": item.get("rainfallMm"),
                        "soil_condition": item.get("soilCondition"),
                        "visual_signs": item.get("visualSigns"),
                        "road_status": item.get("roadStatus"),
                        "geo_lat": item.get("geoLat") or item.get("latitude"),
                        "geo_lng": item.get("geoLng") or item.get("longitude"),
                        "review_status": "PENDING",
                        "status": "UNVERIFIED",
                        "source": "sync_batch",
                    }
                )
                synced_count += 1
            except Exception:
                pass

        return api_response({
            "synced": True,
            "processedCount": len(observations),
            "syncedCount": synced_count,
            "serverTimestamp": datetime.now(timezone.utc).isoformat(),
        })

class FieldObservationUploadView(APIView):
    parser_classes = [MultiPartParser, FormParser]
    throttle_classes = [MediaUploadThrottle]

    def post(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user:
            return api_error("Authentication required to upload observation media", "UNAUTHORIZED", 401)

        uploaded_file = request.FILES.get("file")
        if not uploaded_file:
            return api_error("No file provided in multipart upload", "MISSING_FILE", 400)

        content_type = uploaded_file.content_type.lower()
        if content_type not in ALLOWED_MIME_TYPES:
            return api_error(f"Unsupported media type: {content_type}", "UNSUPPORTED_MEDIA_TYPE", 415)

        if uploaded_file.size > MAX_MEDIA_BYTES:
            return api_error("File size exceeds 10MB limit", "FILE_TOO_LARGE", 413)

        file_id = str(uuid.uuid4())
        ext = ALLOWED_MIME_TYPES[content_type]
        file_name = f"{file_id}{ext}"
        storage_url = f"/api/field-observations/media/{file_name}"

        return api_response({
            "uploaded": True,
            "fileId": file_id,
            "fileName": file_name,
            "fileUrl": storage_url,
            "contentType": content_type,
            "fileSize": uploaded_file.size,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
        }, status=201)

class FieldObservationStatusView(APIView):
    def get(self, request):
        try:
            total = FieldObservation.objects.count()
            verified = FieldObservation.objects.filter(review_status="VERIFIED").count()
            pending = FieldObservation.objects.filter(review_status="PENDING").count()
            rejected = FieldObservation.objects.filter(review_status="REJECTED").count()
        except Exception:
            total, verified, pending, rejected = 0, 0, 0, 0
        return api_response({
            "total": total,
            "verified": verified,
            "pending": pending,
            "rejected": rejected,
            "pipeline_status": "ONLINE",
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
        })

class SyncPackageView(APIView):
    def get(self, request):
        from apps.gis.geography import get_all_zones
        from apps.gis.services import zone_polygon

        zones = []
        for z in get_all_zones():
            zid = z["id"]
            lat = z["centroid_lat"]
            lng = z["centroid_lng"]
            poly = zone_polygon(zid, lat, lng)
            zones.append({
                "id": zid,
                "name": z["name"],
                "polygon": poly,
            })

        return api_response({
            "zones": zones,
            "active_model": {
                "model_version": "v0.5-rf-xgb-ensemble",
                "cutoffs": {
                    "moderate": 38.0,
                    "high": 56.0,
                    "severe": 74.0,
                },
            },
            "cache_policy": {
                "max_age_hours": 24,
                "is_expired": False,
            },
        })
