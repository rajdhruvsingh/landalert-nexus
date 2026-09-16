from rest_framework.views import APIView
from rest_framework.response import Response
from apps.core.responses import api_response, api_error
from .services import (
    get_zones_geojson,
    get_landslides_geojson,
    get_villages_geojson,
    get_infrastructure_geojson,
    compute_exposure_summary,
)
from .geography import (
    get_all_states,
    get_districts_by_state,
    get_district_by_id,
    get_zones_by_district,
    get_zones_by_state,
    get_all_zones,
    get_complete_hierarchy,
    search_geography,
    get_region,
)

class ZonesGeoJsonView(APIView):
    def get(self, request):
        return api_response(get_zones_geojson())

class LandslidesGeoJsonView(APIView):
    def get(self, request):
        return api_response(get_landslides_geojson())

class VillagesGeoJsonView(APIView):
    def get(self, request):
        return api_response(get_villages_geojson())

class InfrastructureGeoJsonView(APIView):
    def get(self, request):
        return api_response(get_infrastructure_geojson())

class InfrastructureSummaryView(APIView):
    def get(self, request):
        zone_id_param = request.query_params.get("zoneId")
        if not zone_id_param:
            return api_error("Missing zoneId query parameter", "MISSING_ZONE_ID", 400)
        try:
            zone_id = int(zone_id_param)
            if zone_id < 1 or zone_id > 15:
                return api_error("Invalid zone ID (must be 1-15)", "INVALID_ZONE_ID", 400)
        except ValueError:
            return api_error("Invalid zone ID format", "INVALID_ZONE_ID", 400)

        summary = compute_exposure_summary(zone_id)
        return api_response(summary)

class GeoHierarchyView(APIView):
    def get(self, request):
        return api_response(get_complete_hierarchy())

class GeoStatesView(APIView):
    def get(self, request):
        states = get_all_states()
        return api_response({"states": states, "count": len(states)})

class GeoDistrictsView(APIView):
    def get(self, request):
        state_id = request.query_params.get("stateId")
        if state_id:
            districts = get_districts_by_state(state_id)
            return api_response({"districts": districts, "stateId": state_id, "count": len(districts)})
        from .geography import _get_data
        all_districts = list(_get_data().get("NER_DISTRICTS", {}).values())
        return api_response({"districts": all_districts, "count": len(all_districts)})

class GeoZonesView(APIView):
    def get(self, request):
        district_id = request.query_params.get("districtId")
        state_id = request.query_params.get("stateId")
        if district_id:
            zones = get_zones_by_district(district_id)
            return api_response({"zones": zones, "districtId": district_id, "count": len(zones)})
        if state_id:
            zones = get_zones_by_state(state_id)
            return api_response({"zones": zones, "stateId": state_id, "count": len(zones)})
        zones = get_all_zones()
        return api_response({"zones": zones, "count": len(zones)})

class GeoSearchView(APIView):
    def get(self, request):
        q = request.query_params.get("q", "")
        results = search_geography(q)
        return api_response({"query": q, "results": results, "count": len(results)})
