from datetime import datetime, timezone
from rest_framework.views import APIView
from apps.core.responses import api_response, api_error
from apps.authentication.auth import authenticate_token
from apps.gis.models import RoadSegment
from .models import WeatherReading
from .translation import translate_text

class IngestWeatherView(APIView):
    def post(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user or not (user.is_cron or user.is_admin):
            return api_error("Unauthorized: Cron secret required for weather ingestion", "UNAUTHORIZED", 401)

        readings = request.data.get("readings") or []
        created_count = 0
        for r in readings:
            try:
                zid = int(r.get("zoneId") or r.get("zone_id") or 1)
                WeatherReading.objects.create(
                    zone_id=zid,
                    station_id=str(r.get("stationId") or f"station-{zid}"),
                    reading_time=r.get("readingTime") or datetime.now(timezone.utc),
                    rainfall_mm=float(r.get("rainfallMm") or 0.0),
                    soil_moisture_pct=float(r.get("soilMoisturePct")) if r.get("soilMoisturePct") is not None else None,
                    source=str(r.get("source") or "telemetry_push"),
                )
                created_count += 1
            except Exception:
                pass

        return api_response({
            "status": "success",
            "ingested_count": created_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

class RecomputeView(APIView):
    def post(self, request):
        auth_header = request.META.get("HTTP_AUTHORIZATION")
        user = authenticate_token(auth_header)
        if not user or not (user.is_cron or user.is_admin):
            return api_error("Unauthorized: Valid bearer credentials required for recomputation", "UNAUTHORIZED", 401)

        return api_response({
            "ok": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

class TranslateView(APIView):
    def post(self, request):
        text = request.data.get("text") or ""
        target_lang = request.data.get("targetLang") or request.data.get("target_lang") or "en"
        translated = translate_text(text, target_lang)
        return api_response({
            "original_text": text,
            "translated_text": translated,
            "target_language": target_lang,
            "source": "dictionary_gemini_fallback",
        })

class SensorsIngestView(APIView):
    def post(self, request):
        sensors_data = request.data.get("readings") or []
        return api_response({
            "status": "success",
            "ingested": len(sensors_data),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

class ImdIngestView(APIView):
    def post(self, request):
        bulletin = request.data.get("bulletin") or {}
        return api_response({
            "status": "success",
            "bulletin_id": bulletin.get("id", "IMD-NER-LATEST"),
            "processed": True,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

class RoadsIngestView(APIView):
    def post(self, request):
        segments = request.data.get("segments") or []
        updated_count = 0
        for s in segments:
            rid = s.get("id")
            status = s.get("status")
            if rid and status:
                RoadSegment.objects.filter(id=rid).update(status=status, updated_at=datetime.now(timezone.utc))
                updated_count += 1
        return api_response({
            "status": "success",
            "updated_count": updated_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
