from django.urls import path
from .views import (
    IngestWeatherView,
    RecomputeView,
    TranslateView,
    SensorsIngestView,
    ImdIngestView,
    RoadsIngestView,
)

urlpatterns = [
    path("ingest-weather", IngestWeatherView.as_view(), name="ingest-weather"),
    path("recompute", RecomputeView.as_view(), name="recompute"),
    path("translate", TranslateView.as_view(), name="translate"),
    path("sensors/ingest", SensorsIngestView.as_view(), name="sensors-ingest"),
    path("integrations/imd/ingest", ImdIngestView.as_view(), name="integrations-imd-ingest"),
    path("integrations/roads/ingest", RoadsIngestView.as_view(), name="integrations-roads-ingest"),
]
