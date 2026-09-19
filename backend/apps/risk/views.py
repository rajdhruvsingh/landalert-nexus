import logging
from datetime import datetime, timezone
from rest_framework.views import APIView
from rest_framework.response import Response

logger = logging.getLogger(__name__)

from apps.core.responses import api_response, api_error
from apps.gis.models import RiskZone
from apps.gis.geography import get_all_cities, get_city_by_id
from .forecast import project_zone_risk_forecast
from .prioritization import get_prioritized_response_ranking
from .spatial import (
    get_all_spatial_cells,
    get_spatial_cells_by_state,
    get_spatial_cells_by_district,
    evaluate_cell_risk,
    evaluate_cells_batch_ml,
    derive_location_spatial_risk,
)

# Global singleton for ML inference
_INFERENCE_ENGINE = None

def get_inference_engine():
    global _INFERENCE_ENGINE
    if _INFERENCE_ENGINE is None:
        from src.lib.ml.inference import LandslideRiskInferenceEngine
        _INFERENCE_ENGINE = LandslideRiskInferenceEngine()
    return _INFERENCE_ENGINE

class RiskPredictionView(APIView):
    def get(self, request):
        zone_id_param = request.query_params.get("zoneId")
        as_of_date = request.query_params.get("asOfDate")

        if not zone_id_param:
            return api_error("Missing zoneId query parameter", "INVALID_ZONE_ID", 400)

        try:
            zone_id = int(zone_id_param)
            if zone_id < 1 or zone_id > 15:
                return api_error("Invalid zone ID (must be between 1 and 15)", "INVALID_ZONE_ID", 400)
        except ValueError:
            return api_error("Invalid zone ID format", "INVALID_ZONE_ID", 400)

        if as_of_date is not None and as_of_date != "":
            from datetime import timedelta
            try:
                parsed_dt = datetime.fromisoformat(as_of_date.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                if parsed_dt > now + timedelta(days=1):
                    return api_error("asOfDate cannot be more than 24 hours into the future", "INVALID_DATE", 400)
            except Exception:
                return api_error("asOfDate must be a valid ISO 8601 date string", "INVALID_DATE", 400)

        local_slope_param = request.query_params.get("localSlope") or request.query_params.get("local_slope_deg")
        facet_type_param = request.query_params.get("facetType") or request.query_params.get("facet_type")
        local_slope = None
        if local_slope_param:
            try:
                local_slope = float(local_slope_param)
            except ValueError:
                pass

        try:
            engine = get_inference_engine()
            res = engine.predict_zone(
                zone_id=zone_id,
                as_of_date=as_of_date,
                local_slope_deg=local_slope,
                facet_type=facet_type_param,
            )
            return api_response(res)
        except Exception as e:
            logger.exception("[ML Inference Exception] Failed predicting risk for zone %s: %s", zone_id, e)
            # Fallback to RiskZone DB row if ML engine fails unexpectedly
            zone = RiskZone.objects.filter(id=zone_id).first()
            if not zone:
                return api_error("Zone not found", "ZONE_NOT_FOUND", 404)
            fallback = {
                "status": "FALLBACK",
                "data_quality": "DEGRADED_FALLBACK",
                "warning": f"ML inference engine exception: {str(e)}",
                "zone_id": zone.id,
                "zone_name": zone.zone_name,
                "district": zone.district,
                "state": zone.state,
                "model_version": "v0.5-rf-xgb-ensemble",
                "probability": round(zone.risk_score / 100.0, 4),
                "risk_score": zone.risk_score,
                "risk_level": zone.current_risk_level,
                "explanation_narrative": zone.explanation or f"Operational risk for zone {zone_id} (fallback degraded)",
                "factor_attribution": {"top_categories": []},
                "canonical_features": {},
                "data_freshness": {"soil_moisture_status": zone.soil_moisture_status},
                "inference_timestamp": datetime.now(timezone.utc).isoformat(),
            }
            return api_response(fallback)

class ForecastProjectionsView(APIView):
    def get(self, request):
        zone_id_param = request.query_params.get("zoneId")
        if not zone_id_param:
            return api_error("Missing zoneId query parameter", "MISSING_ZONE_ID", 400)

        try:
            zone_id = int(zone_id_param)
            zone = RiskZone.objects.filter(id=zone_id).first()
            if not zone:
                return api_error(f"Zone {zone_id} not found", "ZONE_NOT_FOUND", 404)
        except ValueError:
            return api_error("Invalid zone ID format", "INVALID_ZONE_ID", 400)

        # Allow query params for simulated / test rainfall; if omitted, streams live gridded NWP ensemble
        r24 = request.query_params.get("r24")
        r48 = request.query_params.get("r48")
        r72 = request.query_params.get("r72")

        val_24 = float(r24) if r24 is not None else None
        val_48 = float(r48) if r48 is not None else None
        val_72 = float(r72) if r72 is not None else None

        projection = project_zone_risk_forecast(zone, val_24, val_48, val_72)
        return api_response(projection)

class PrioritizationView(APIView):
    def get(self, request):
        result = get_prioritized_response_ranking()
        return api_response(result)

class SpatialCellsView(APIView):
    def get(self, request):
        state = request.query_params.get("state")
        district = request.query_params.get("district")
        if state:
            cells = get_spatial_cells_by_state(state)
        elif district:
            cells = get_spatial_cells_by_district(district)
        else:
            cells = get_all_spatial_cells()
        return api_response({"cells": cells, "count": len(cells)})

class SpatialRiskView(APIView):
    def get(self, request):
        lat_param = request.query_params.get("lat")
        lng_param = request.query_params.get("lng")
        city_name = request.query_params.get("city")
        district_name = request.query_params.get("district")
        state_name = request.query_params.get("state", "")

        active_zones = list(RiskZone.objects.all())

        if lat_param and lng_param:
            try:
                lat = float(lat_param)
                lng = float(lng_param)
            except ValueError:
                return api_error("Invalid lat/lng coordinates", "INVALID_COORDINATES", 400)

            spatial_risk = derive_location_spatial_risk(
                name=city_name or "Custom Coordinate",
                location_type="city" if city_name else "point",
                district=district_name or "Regional",
                state=state_name or "NER",
                coordinates=[lat, lng],
                active_zones=active_zones,
            )
            return api_response(spatial_risk)

        if city_name:
            all_cities = get_all_cities()
            found = None
            for c in all_cities:
                if c.get("name", "").lower() == city_name.strip().lower():
                    if not state_name or c.get("stateName", "").lower() == state_name.strip().lower():
                        found = c
                        break
            if found:
                spatial_risk = derive_location_spatial_risk(
                    name=found.get("name"),
                    location_type=found.get("type", "city"),
                    district=found.get("districtName"),
                    state=found.get("stateName"),
                    coordinates=found.get("centroid"),
                    active_zones=active_zones,
                )
                return api_response(spatial_risk)

        # Return regional spatial risk summary across representative cells
        cells = get_all_spatial_cells()
        evaluations = evaluate_cells_batch_ml(cells, active_zones)
        return api_response({
            "status": "success",
            "evaluated_cells_count": len(evaluations),
            "model_version": "v0.3-spatial-surface",
            "cells": evaluations,
        })

class SpatialCityRiskView(APIView):
    def get(self, request):
        city_id = request.query_params.get("cityId")
        city_name = request.query_params.get("name")
        state_name = request.query_params.get("state", "")

        city = None
        if city_id:
            city = get_city_by_id(city_id)
        elif city_name:
            for c in get_all_cities():
                if c.get("name", "").lower() == city_name.strip().lower():
                    if not state_name or c.get("stateName", "").lower() == state_name.strip().lower():
                        city = c
                        break

        if not city:
            return api_error("City not found in NER geographic registry", "CITY_NOT_FOUND", 404)

        active_zones = list(RiskZone.objects.all())
        spatial_risk = derive_location_spatial_risk(
            name=city.get("name"),
            location_type=city.get("type", "city"),
            district=city.get("districtName"),
            state=city.get("stateName"),
            coordinates=city.get("centroid"),
            active_zones=active_zones,
        )
        return api_response(spatial_risk)
