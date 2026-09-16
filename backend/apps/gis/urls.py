from django.urls import path
from .views import (
    ZonesGeoJsonView,
    LandslidesGeoJsonView,
    VillagesGeoJsonView,
    InfrastructureGeoJsonView,
    InfrastructureSummaryView,
    GeoHierarchyView,
    GeoStatesView,
    GeoDistrictsView,
    GeoZonesView,
    GeoSearchView,
)

urlpatterns = [
    path("gis/zones.geojson", ZonesGeoJsonView.as_view(), name="gis-zones"),
    path("gis/landslides.geojson", LandslidesGeoJsonView.as_view(), name="gis-landslides"),
    path("gis/villages.geojson", VillagesGeoJsonView.as_view(), name="gis-villages"),
    path("gis/infrastructure.geojson", InfrastructureGeoJsonView.as_view(), name="gis-infrastructure"),
    path("infrastructure/summary", InfrastructureSummaryView.as_view(), name="infrastructure-summary"),
    path("geo/hierarchy", GeoHierarchyView.as_view(), name="geo-hierarchy"),
    path("geo/states", GeoStatesView.as_view(), name="geo-states"),
    path("geo/districts", GeoDistrictsView.as_view(), name="geo-districts"),
    path("geo/zones", GeoZonesView.as_view(), name="geo-zones"),
    path("geo/search", GeoSearchView.as_view(), name="geo-search"),
]
