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
