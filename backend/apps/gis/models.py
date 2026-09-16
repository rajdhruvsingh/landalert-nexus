from django.db import models

class RiskZone(models.Model):
    id = models.IntegerField(primary_key=True)
    zone_name = models.TextField()
    district = models.TextField()
    state = models.TextField()
    centroid_lat = models.FloatField()
    centroid_lng = models.FloatField()
    mean_slope_deg = models.FloatField()
    population = models.IntegerField()
    threshold_e_mm = models.FloatField()
    current_risk_level = models.TextField()
    risk_score = models.FloatField()
    explanation = models.TextField(null=True, blank=True)
    last_computed_at = models.DateTimeField()
    threshold_i_coefficient = models.FloatField()
    threshold_i_exponent = models.FloatField()
    threshold_source = models.TextField()
    slope_source = models.TextField(null=True, blank=True)
    soil_moisture_pct = models.FloatField(null=True, blank=True)
    soil_moisture_status = models.TextField()
    soil_moisture_reading_time = models.DateTimeField(null=True, blank=True)
    slope_p90_deg = models.FloatField(null=True, blank=True)
    max_slope_deg = models.FloatField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = "risk_zones"
        ordering = ["id"]

    def __str__(self):
        return f"Zone {self.id}: {self.zone_name} ({self.district}, {self.state})"

class HistoricalLandslide(models.Model):
    id = models.BigAutoField(primary_key=True)
    zone_id = models.IntegerField(null=True, blank=True)
    event_date = models.DateField()
    lat = models.FloatField()
    lng = models.FloatField()
    severity = models.TextField()
    source = models.TextField()
    is_synthetic = models.BooleanField(default=False)
    hazard_type = models.TextField(default="rainfall_slope_failure")

    class Meta:
        managed = False
        db_table = "historical_landslides"
        ordering = ["-event_date"]

    def __str__(self):
        return f"Landslide {self.id} on {self.event_date} ({self.severity})"

class RoadSegment(models.Model):
    id = models.BigAutoField(primary_key=True)
    zone_id = models.IntegerField()
    road_name = models.TextField()
    segment_label = models.TextField()
    status = models.TextField()  # "open", "restricted", "blocked"
    length_km = models.FloatField()
    updated_at = models.DateTimeField()

    class Meta:
        managed = False
        db_table = "road_segments"
        ordering = ["id"]

    def __str__(self):
        return f"{self.road_name} ({self.segment_label}): {self.status}"
