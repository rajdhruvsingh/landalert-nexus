from django.db import models

class InSarDeformationProduct(models.Model):
    cell_id = models.CharField(max_length=64, primary_key=True)
    bounds = models.JSONField()
    centroid = models.JSONField()
    status = models.CharField(max_length=32)
    measurement_type = models.CharField(max_length=64)
    unit = models.CharField(max_length=16)
    los_velocity_mean_mm_year = models.FloatField(null=True, blank=True)
    los_velocity_max_mm_year = models.FloatField(null=True, blank=True)
    cumulative_displacement_mm = models.FloatField(null=True, blank=True)
    temporal_trend = models.CharField(max_length=64)
    temporal_baseline_days = models.IntegerField(null=True, blank=True)
    coherence_mean = models.FloatField(null=True, blank=True)
    spatial_coverage_pct = models.FloatField(null=True, blank=True)
    sensor = models.CharField(max_length=64)
    orbit_pass = models.CharField(max_length=32, null=True, blank=True)
    quality = models.CharField(max_length=32)
    unavailable_reason = models.TextField(null=True, blank=True)
    processing_pipeline = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        managed = False
        db_table = "insar_deformation_products"

class SatelliteProcessingJob(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    cell_id = models.CharField(max_length=64)
    status = models.CharField(max_length=32)
    progress_pct = models.IntegerField(default=0)
    stage = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "satellite_processing_jobs"
