from django.urls import path
from .views import (
    AlertDispatchView,
    AlertRetractView,
    SimulateView,
    LocalsActiveView,
    LocalsCheckView,
)

urlpatterns = [
    path("alerts/dispatch", AlertDispatchView.as_view(), name="alerts-dispatch"),
    path("alerts/retract", AlertRetractView.as_view(), name="alerts-retract"),
    path("simulate", SimulateView.as_view(), name="simulate"),
    path("locals/active", LocalsActiveView.as_view(), name="locals-active"),
    path("locals/check", LocalsCheckView.as_view(), name="locals-check"),
]
