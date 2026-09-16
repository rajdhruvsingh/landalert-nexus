from django.urls import path
from .views import (
    SatelliteStatusView,
    SatelliteTilesView,
    SatelliteDeformationView,
    SatelliteCoverageView,
    SatelliteAcquisitionsView,
    SatelliteHealthView,
    SatelliteJobsView,
    SatelliteTimeseriesView,
)

urlpatterns = [
    path("satellite/status", SatelliteStatusView.as_view(), name="satellite-status"),
    path("satellite/tiles", SatelliteTilesView.as_view(), name="satellite-tiles"),
    path("satellite/deformation", SatelliteDeformationView.as_view(), name="satellite-deformation"),
    path("satellite/coverage", SatelliteCoverageView.as_view(), name="satellite-coverage"),
    path("satellite/acquisitions", SatelliteAcquisitionsView.as_view(), name="satellite-acquisitions"),
    path("satellite/health", SatelliteHealthView.as_view(), name="satellite-health"),
    path("satellite/jobs", SatelliteJobsView.as_view(), name="satellite-jobs"),
    path("satellite/timeseries", SatelliteTimeseriesView.as_view(), name="satellite-timeseries"),
]
