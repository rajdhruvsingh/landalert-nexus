import uuid
from django.db import models

class FieldObservation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4)
    zone_id = models.IntegerField()
    observer_id = models.TextField()
    observed_at = models.DateTimeField()
    client_timestamp = models.DateTimeField()
    rainfall_mm = models.FloatField(null=True, blank=True)
    soil_condition = models.TextField(null=True, blank=True)
    visual_signs = models.TextField(null=True, blank=True)
    road_status = models.TextField(null=True, blank=True)
    synced_at = models.DateTimeField(auto_now_add=True)
    sync_status = models.TextField(default="synced")
    idempotency_key = models.TextField(null=True, blank=True)
    status = models.TextField(default="UNVERIFIED")
    verified_by = models.TextField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verification_notes = models.TextField(null=True, blank=True)
    is_training_eligible = models.BooleanField(default=False)
    evidence_summary = models.JSONField(default=dict)
    actionable_dispatch_id = models.BigIntegerField(null=True, blank=True)
    media_metadata = models.JSONField(null=True, blank=True)
    geo_lat = models.FloatField(null=True, blank=True)
    geo_lng = models.FloatField(null=True, blank=True)
    geo_accuracy_m = models.FloatField(null=True, blank=True)
    geo_captured_at = models.DateTimeField(null=True, blank=True)
    consent_given = models.BooleanField(default=True)
    review_status = models.TextField(default="PENDING")
    source = models.TextField(default="mobile_app")

    class Meta:
        managed = False
        db_table = "field_observations"
        ordering = ["-observed_at"]

    def __str__(self):
        return f"Observation {self.id} for Zone {self.zone_id} [{self.review_status}]"
