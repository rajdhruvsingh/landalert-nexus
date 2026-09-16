from django.urls import path
from .views import (
    AlertDispatchView,
    AlertRetractView,
    SimulateView,
    LocalsActiveView,
    LocalsCheckView,
    LocalsResolveView,
)

urlpatterns = [
    path("alerts/dispatch", AlertDispatchView.as_view(), name="alerts-dispatch"),
    path("alerts/retract", AlertRetractView.as_view(), name="alerts-retract"),
    path("simulate", SimulateView.as_view(), name="simulate"),
    path("locals/active", LocalsActiveView.as_view(), name="locals-active"),
    path("locals/check", LocalsCheckView.as_view(), name="locals-check"),
    path("locals/<str:alert_id>/resolve", LocalsResolveView.as_view(), name="locals-resolve"),
]
