from django.urls import path
from .views import (
    ObservationReviewView,
    ObservationDeleteView,
    SyncObservationsView,
    FieldObservationUploadView,
    FieldObservationStatusView,
    SyncPackageView,
)

urlpatterns = [
    path("observations/review", ObservationReviewView.as_view(), name="observations-review"),
    path("observations/delete", ObservationDeleteView.as_view(), name="observations-delete"),
    path("observations/<str:obs_id>", ObservationDeleteView.as_view(), name="observations-delete-param"),
    path("sync/observations", SyncObservationsView.as_view(), name="sync-observations"),
    path("sync/package", SyncPackageView.as_view(), name="sync-package"),
    path("field-observations/upload", FieldObservationUploadView.as_view(), name="field-observations-upload"),
    path("field-observations/status", FieldObservationStatusView.as_view(), name="field-observations-status"),
]
