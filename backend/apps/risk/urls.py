from django.urls import path
from .views import (
    RiskPredictionView,
    ForecastProjectionsView,
    PrioritizationView,
    SpatialCellsView,
    SpatialRiskView,
    SpatialCityRiskView,
)

urlpatterns = [
    path("risk-prediction", RiskPredictionView.as_view(), name="risk-prediction"),
    path("forecast/projections", ForecastProjectionsView.as_view(), name="forecast-projections"),
    path("response/prioritization", PrioritizationView.as_view(), name="response-prioritization"),
    path("spatial/cells", SpatialCellsView.as_view(), name="spatial-cells"),
    path("spatial/risk", SpatialRiskView.as_view(), name="spatial-risk"),
    path("spatial/city-risk", SpatialCityRiskView.as_view(), name="spatial-city-risk"),
]
