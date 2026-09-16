from django.urls import path
from .views import HealthView, MLHealthView

urlpatterns = [
    path("health", HealthView.as_view(), name="health"),
    path("ml/health", MLHealthView.as_view(), name="ml-health"),
]
