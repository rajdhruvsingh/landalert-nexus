"""
backend/config/urls.py
======================
Main URL configuration for LandAlert-Nexus Django backend.
Routes all REST APIs under /api/* and delegates frontend SPA routes.
"""

from django.urls import path, include, re_path
from apps.core.views import spa_index_view

urlpatterns = [
    # API endpoints
    path("api/", include("apps.monitoring.urls")),
    path("api/", include("apps.risk.urls")),
    path("api/", include("apps.alerts.urls")),
    path("api/", include("apps.observations.urls")),
    path("api/", include("apps.gis.urls")),
    path("api/", include("apps.satellite.urls")),
    path("api/", include("apps.integrations.urls")),

    # SPA Frontend fallback for non-API routes
    re_path(r"^(?!api/).*$", spa_index_view, name="spa-index"),
]
