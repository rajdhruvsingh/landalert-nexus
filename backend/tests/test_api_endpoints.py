"""
backend/tests/test_api_endpoints.py
===================================
Comprehensive test suite for LandAlert-Nexus Django REST Framework backend.
Tests all endpoint contracts, validation rules, status codes, and error envelopes.
"""

import json
import pytest
from django.test import Client

@pytest.fixture
def client():
    return Client()

@pytest.mark.django_db
class TestMonitoringEndpoints:
    def test_health_check(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("healthy", "degraded")
        assert "components" in data
        assert data["components"]["api"]["status"] == "healthy"

    def test_ml_health_check(self, client):
        resp = client.get("/api/ml/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "operational"
        assert "active_model_version" in data
        assert "pr_auc" in data

@pytest.mark.django_db
class TestRiskEndpoints:
    def test_risk_prediction_missing_zone(self, client):
        resp = client.get("/api/risk-prediction")
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "INVALID_ZONE_ID"

    def test_risk_prediction_with_zone(self, client):
        resp = client.get("/api/risk-prediction?zoneId=1")
        assert resp.status_code == 200
        data = resp.json()
        assert "risk_score" in data
        assert "risk_level" in data
        assert "zone_id" in data

    def test_forecast_projections_missing_zone(self, client):
        resp = client.get("/api/forecast/projections")
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "MISSING_ZONE_ID"

    def test_forecast_projections_with_zone(self, client):
        resp = client.get("/api/forecast/projections?zoneId=1")
        assert resp.status_code == 200
        data = resp.json()
        assert "forecastWindows" in data
        assert "currentRiskScore" in data

    def test_response_prioritization(self, client):
        resp = client.get("/api/response/prioritization")
        assert resp.status_code == 200
        data = resp.json()
        assert "rankedZones" in data
        assert isinstance(data["rankedZones"], list)

    def test_spatial_cells(self, client):
        resp = client.get("/api/spatial/cells")
        assert resp.status_code == 200
        data = resp.json()
        assert "cells" in data
        assert data["count"] > 0

    def test_spatial_city_risk(self, client):
        resp = client.get("/api/spatial/city-risk?name=Gangtok")
        assert resp.status_code == 200
        data = resp.json()
        assert data["location"]["name"] == "Gangtok"
        assert "risk_assessment" in data

@pytest.mark.django_db
class TestGISEndpoints:
    def test_zones_geojson(self, client):
        resp = client.get("/api/gis/zones.geojson")
        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"
        assert "features" in data

    def test_villages_geojson(self, client):
        resp = client.get("/api/gis/villages.geojson")
        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"

    def test_landslides_geojson(self, client):
        resp = client.get("/api/gis/landslides.geojson")
        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "FeatureCollection"

    def test_infrastructure_summary_missing_zone(self, client):
        resp = client.get("/api/infrastructure/summary")
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "MISSING_ZONE_ID"

    def test_geo_hierarchy(self, client):
        resp = client.get("/api/geo/hierarchy")
        assert resp.status_code == 200
        data = resp.json()
        assert "states" in data
        assert len(data["states"]) == 8

    def test_geo_states(self, client):
        resp = client.get("/api/geo/states")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["states"]) == 8

    def test_geo_search(self, client):
        resp = client.get("/api/geo/search?q=Kohima")
        assert resp.status_code == 200
        data = resp.json()
        assert "results" in data

@pytest.mark.django_db
class TestSatelliteEndpoints:
    def test_satellite_status(self, client):
        resp = client.get("/api/satellite/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "configured" in data
        assert "enabled" in data

    def test_satellite_health(self, client):
        resp = client.get("/api/satellite/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert "overall_status" in data

    def test_satellite_coverage(self, client):
        resp = client.get("/api/satellite/coverage")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"

@pytest.mark.django_db
class TestAlertsAndObservations:
    def test_locals_active(self, client):
        resp = client.get("/api/locals/active")
        assert resp.status_code == 200
        data = resp.json()
        assert "active_alerts" in data

    def test_field_observations_status(self, client):
        resp = client.get("/api/field-observations/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "total" in data

    def test_sync_package(self, client):
        resp = client.get("/api/sync/package")
        assert resp.status_code == 200
        data = resp.json()
        assert "zones" in data
        assert "active_model" in data

    def test_field_observations_status_has_capability_flag(self, client):
        resp = client.get("/api/field-observations/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("mediaUploadEnabled") is True

    def test_unknown_route_returns_json_404(self, client):
        resp = client.get("/api/unknown-route")
        assert resp.status_code == 404
        data = resp.json()
        assert data["code"] == "NOT_FOUND"
        assert "Endpoint not found" in data["error"]

    def test_locals_resolve_unauthorized(self, client):
        resp = client.post("/api/locals/alert-123/resolve", {"resolution": "CONFIRMED_HAZARD", "note": "Valid hazard confirmed"}, content_type="application/json")
        assert resp.status_code == 401
        data = resp.json()
        assert data["code"] == "UNAUTHORIZED"

    def test_locals_resolve_authorized(self, client):
        # Create a mock active alert first
        from apps.alerts.locals import _ACTIVE_LOCALS_ALERTS
        _ACTIVE_LOCALS_ALERTS.append({"alert_id": "alert-test-1", "zone_id": 1, "status": "ACTIVE"})

        headers = {"HTTP_AUTHORIZATION": "Bearer test-authenticated-official"}
        payload = {"resolution": "CONFIRMED_HAZARD", "note": "Verified field tension cracks"}
        resp = client.post("/api/locals/alert-test-1/resolve", payload, content_type="application/json", **headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        assert data["alert"]["status"] == "RESOLVED"

    def test_locals_resolve_missing_note(self, client):
        headers = {"HTTP_AUTHORIZATION": "Bearer test-authenticated-official"}
        payload = {"resolution": "CONFIRMED_HAZARD", "note": "no"}
        resp = client.post("/api/locals/alert-test-1/resolve", payload, content_type="application/json", **headers)
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "MISSING_NOTE"

    def test_observation_review_requires_rejection_reason(self, client):
        import uuid
        from datetime import datetime, timezone
        from apps.observations.models import FieldObservation
        test_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        FieldObservation.objects.create(id=test_id, zone_id=1, status="SUBMITTED", observed_at=now, client_timestamp=now)

        headers = {"HTTP_AUTHORIZATION": "Bearer test-authenticated-official"}
        payload = {"observation_id": test_id, "new_status": "REJECTED", "verification_notes": "no"}
        resp = client.post("/api/observations/review", payload, content_type="application/json", **headers)
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "MISSING_REJECTION_REASON"

    def test_observation_delete_success(self, client):
        import uuid
        from datetime import datetime, timezone
        from apps.observations.models import FieldObservation
        del_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        FieldObservation.objects.create(id=del_id, zone_id=1, status="SUBMITTED", observed_at=now, client_timestamp=now)

        headers = {"HTTP_AUTHORIZATION": "Bearer test-authenticated-admin"}
        resp = client.delete(f"/api/observations/{del_id}", **headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["deleted"] is True
        assert data["observation_id"] == del_id

    def test_risk_prediction_invalid_date(self, client):
        resp = client.get("/api/risk-prediction?zoneId=1&asOfDate=not-a-valid-date")
        assert resp.status_code == 400
        data = resp.json()
        assert data["code"] == "INVALID_DATE"

    def test_simulate_endpoint_disabled_by_default(self, client):
        resp = client.post("/api/simulate", {"zoneId": 1, "rainfallMm": 45.0}, content_type="application/json")
        assert resp.status_code == 403
        data = resp.json()
        assert data["code"] == "SIMULATION_DISABLED"

    def test_field_observation_upload_disabled_by_flag(self, client, monkeypatch):
        monkeypatch.setenv("MEDIA_UPLOAD_ENABLED", "false")
        from django.core.files.uploadedfile import SimpleUploadedFile
        fake_image = SimpleUploadedFile("test.jpg", b"image data", content_type="image/jpeg")
        headers = {"HTTP_AUTHORIZATION": "Bearer test-authenticated-citizen"}
        resp = client.post("/api/field-observations/upload", {"file": fake_image, "zoneId": 1}, **headers)
        assert resp.status_code == 403
        data = resp.json()
        assert data["code"] == "MEDIA_UPLOAD_DISABLED"

    def test_field_observation_upload_and_retrieve_local(self, client, monkeypatch):
        monkeypatch.setenv("MEDIA_UPLOAD_ENABLED", "true")
        from django.core.files.uploadedfile import SimpleUploadedFile
        fake_image = SimpleUploadedFile("test_sample.jpg", b"\xff\xd8\xff\xe0testjpeg", content_type="image/jpeg")
        headers = {"HTTP_AUTHORIZATION": "Bearer test-authenticated-citizen"}
        resp = client.post("/api/field-observations/upload", {"file": fake_image, "zoneId": 1}, **headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["uploaded"] is True
        assert "fileName" in data
        assert data["storageBackend"] in ("supabase", "local")

        # Retrieve media
        filename = data["fileName"]
        media_resp = client.get(f"/api/field-observations/media/{filename}")
        assert media_resp.status_code in (200, 302)

    def test_field_observation_media_supabase_redirect_when_missing_locally(self, client, monkeypatch):
        from django.conf import settings
        monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.supabase.co")
        resp = client.get("/api/field-observations/media/non-existent-file-999.jpg")
        assert resp.status_code == 302
        assert "https://example.supabase.co/storage/v1/object/public/field-media/non-existent-file-999.jpg" in resp.headers["Location"]

